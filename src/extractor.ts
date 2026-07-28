import { extractFieldCandidates } from "./candidates/fields";
import { findCandidatesInOcrText } from "./candidates/from-ocr";
import { findCandidatesInDecodedValue, findCandidatesInPositionedText, findCandidatesInText } from "./candidates/from-text";
import type { CandidateEvidence, CandidateTextLine, FieldCandidate, NormalizedBounds } from "./candidates/types";
import { WorkGuard } from "./deadline";
import { loadDocumentInput, type LoadedInput } from "./document/load-input";
import { openDocument } from "./document/open-document";
import { isAsyncByteSource } from "./document/read-stream";
import type { DocumentHandle, DocumentPageLike, ExtractedPageText, RenderedPage } from "./document/types";
import { ExtractionFailure } from "./errors";
import { getRenderRecipes, InvalidOptionsError, resolveOptions, type RenderRecipe, type ResolvedOptions } from "./options";
import type { OcrRecognition, OcrSession } from "./recognition/ocr-reader";
import { mergeEvidence } from "./scoring/merge-results";
import { elapsedMilliseconds, startTimer, type MonotonicTimestamp } from "./timing";
import type { BatchExtractOptions, BatchExtractionItem, BatchExtractionResult, BatchMatchedBoleto, BoletoBatchInput, DocumentFormat, DocumentInput, ExtractOptions, ExtractionErrorCode, ExtractionErrorInfo, ExtractionMetadata, ExtractionResult, ExtractionStatus } from "./types";

interface MutableRunState {
  evidence: CandidateEvidence[];
  fields: FieldCandidate[];
  warnings: string[];
  inputFormat: DocumentFormat | null;
  pagesTotal: number;
  pagesProcessed: number;
  renderedPages: Set<number>;
  renderAttempts: number;
  ocrPages: Set<number>;
  nativeTextPages: Set<number>;
  passesUsed: number;
  fileSizeBytes: number;
  sourceImageWidth: number | null;
  sourceImageHeight: number | null;
  complete: boolean;
}

interface ResolvedBatchSource {
  input: DocumentInput;
  requestHeaders?: Readonly<Record<string, string>>;
}

class RenderReuse {
  readonly #wanted: RenderRecipe | null;
  #pageNumber = 0;
  #rendered: RenderedPage | null = null;

  public constructor(wanted: RenderRecipe | null) {
    this.#wanted = wanted;
  }

  public offer(pageNumber: number, recipe: RenderRecipe, rendered: RenderedPage): void {
    if (recipe !== this.#wanted) {
      rendered.dispose();
      return;
    }
    this.dispose();
    rendered.releasePixels();
    this.#pageNumber = pageNumber;
    this.#rendered = rendered;
  }

  public take(pageNumber: number, recipe: RenderRecipe): RenderedPage | null {
    if (this.#rendered === null || recipe !== this.#wanted || pageNumber !== this.#pageNumber) {
      return null;
    }
    const rendered = this.#rendered;
    this.#rendered = null;
    return rendered;
  }

  public dispose(): void {
    this.#rendered?.dispose();
    this.#rendered = null;
  }
}

function emptyState(): MutableRunState {
  return {
    evidence: [],
    fields: [],
    warnings: [],
    inputFormat: null,
    pagesTotal: 0,
    pagesProcessed: 0,
    renderedPages: new Set(),
    renderAttempts: 0,
    ocrPages: new Set(),
    nativeTextPages: new Set(),
    passesUsed: 0,
    fileSizeBytes: 0,
    sourceImageWidth: null,
    sourceImageHeight: null,
    complete: true,
  };
}

function metadata(options: ResolvedOptions, state: MutableRunState, startedAt: MonotonicTimestamp): ExtractionMetadata {
  return {
    performance: options.performance,
    ocrMode: options.ocr,
    ...(state.inputFormat === null ? {} : { inputFormat: state.inputFormat }),
    passesRequested: options.passes,
    passesUsed: state.passesUsed,
    pagesTotal: state.pagesTotal,
    pagesProcessed: state.pagesProcessed,
    pagesRendered: state.renderedPages.size,
    renderAttempts: state.renderAttempts,
    ocrPages: state.ocrPages.size,
    fileSizeBytes: state.fileSizeBytes,
    ...(state.sourceImageWidth === null ? {} : { sourceImageWidth: state.sourceImageWidth }),
    ...(state.sourceImageHeight === null ? {} : { sourceImageHeight: state.sourceImageHeight }),
    maxPixelsPerPage: options.maxPixelsPerPage,
    maxSourceImagePixels: options.maxSourceImagePixels,
    durationMs: elapsedMilliseconds(startedAt),
    complete: state.complete,
    confidenceVersion: "1.2.0",
  };
}

function resultFromState(options: ResolvedOptions, state: MutableRunState, startedAt: MonotonicTimestamp, error: ExtractionErrorInfo | null = null): ExtractionResult {
  const merged = mergeEvidence(state.evidence, state.fields);
  let status: ExtractionStatus;
  if (error !== null) {
    status = merged.results.length > 0 ? "partial" : "error";
  } else if (!state.complete) {
    status = "partial";
  } else {
    status = merged.results.length > 0 ? "success" : "not_found";
  }
  const precisionScore = merged.results.length === 0 ? 0 : Math.min(...merged.results.map((candidate) => candidate.precisionScore));

  return {
    status,
    success: merged.results.length > 0,
    precisionScore: Number(precisionScore.toFixed(3)),
    bestMatch: merged.results[0] ?? null,
    results: merged.results,
    metadata: metadata(options, state, startedAt),
    warnings: [...new Set([...state.warnings, ...merged.warnings])],
    error,
  };
}

function finalizeResultDuration<T extends ExtractionResult>(result: T, startedAt: MonotonicTimestamp): T {
  result.metadata.durationMs = elapsedMilliseconds(startedAt);
  return result;
}

function failureResult(code: ExtractionErrorCode, message: string, options: ResolvedOptions = resolveOptions(), startedAt = startTimer()): ExtractionResult {
  const state = emptyState();
  state.complete = false;
  return finalizeResultDuration(resultFromState(options, state, startedAt, { code, message }), startedAt);
}

function invalidOptionsResult(error: InvalidOptionsError, startedAt: MonotonicTimestamp): ExtractionResult {
  return failureResult("INVALID_OPTIONS", error.message, resolveOptions(), startedAt);
}

/**
 * Runs one synchronous cleanup step without letting it replace the structured result.
 *
 * Cleanup runs in `finally`, after the outcome is already decided. A throwing step must neither
 * reject the promise the contract promises to resolve nor prevent the remaining steps from running.
 *
 * @param {() => void} step - The release operation to attempt.
 */
function disposeQuietly(step: () => void): void {
  try {
    step();
  } catch {
    return;
  }
}

/**
 * Runs one asynchronous cleanup step without letting it replace the structured result.
 *
 * @param {() => Promise<void> | void} step - The release operation to attempt.
 * @returns {Promise<void>} Resolves after the step settles, successfully or not.
 */
async function releaseQuietly(step: () => Promise<void> | void): Promise<void> {
  try {
    await step();
  } catch {
    return;
  }
}

class PageCursor {
  readonly #handle: DocumentHandle;
  #pageNumber = 0;
  #page: DocumentPageLike | null = null;

  public constructor(handle: DocumentHandle) {
    this.#handle = handle;
  }

  public async use<T>(pageNumber: number, work: (page: DocumentPageLike) => Promise<T>): Promise<T> {
    if (this.#pageNumber !== pageNumber) {
      this.release();
    }
    this.#page ??= await this.#handle.getPage(pageNumber);
    this.#pageNumber = pageNumber;
    return work(this.#page);
  }

  public release(): void {
    const page = this.#page;
    this.#page = null;
    page?.cleanup();
  }
}

function nativeCandidateLines(pageText: ExtractedPageText, page: number): CandidateTextLine[] {
  return pageText.lines.map((line) => ({
    text: line.text,
    page,
    source: "pdf-text-reconstructed",
    pass: 0,
    confidence: 1,
    bounds: line.bounds,
    words: line.words.map((word) => ({
      text: word.text,
      confidence: 1,
      bounds: word.bounds,
    })),
  }));
}

function textEvidence(
  pageText: ExtractedPageText,
  page: number,
): {
  evidence: CandidateEvidence[];
  fields: FieldCandidate[];
} {
  const evidence = [
    ...findCandidatesInText(pageText.orderedText, page, {
      source: "pdf-text",
    }),
    ...findCandidatesInPositionedText(pageText.lines, page),
  ];
  const unique = new Map<string, CandidateEvidence>();
  for (const candidate of evidence) {
    const bounds = candidate.bounds === undefined ? "" : `${candidate.bounds.x.toFixed(4)}:${candidate.bounds.y.toFixed(4)}:${candidate.bounds.width.toFixed(4)}:${candidate.bounds.height.toFixed(4)}`;
    const signature = `${candidate.barcode}:${candidate.source}:${bounds}`;
    const current = unique.get(signature);
    if (current === undefined || (!current.nearLabel && candidate.nearLabel)) {
      unique.set(signature, candidate);
    }
  }

  return {
    evidence: [...unique.values()],
    fields: extractFieldCandidates(nativeCandidateLines(pageText, page)),
  };
}

function hasPageEvidence(evidence: CandidateEvidence[], page: number): boolean {
  return evidence.some((candidate) => candidate.page === page);
}

async function collectTextEvidence(cursor: PageCursor, state: MutableRunState, pageLimit: number, guard: WorkGuard, stopAfterFirst: boolean): Promise<number[]> {
  const processedPages: number[] = [];
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    guard.check();
    const pageResult = await cursor.use(pageNumber, async (page) => {
      const nativeText = page.nativeText();
      if (nativeText === null) {
        return null;
      }
      const pageText = await nativeText;
      return {
        pageText,
        candidates: textEvidence(pageText, pageNumber),
      };
    });
    guard.check();
    if (pageResult !== null) {
      if (pageResult.pageText.hasText) {
        state.nativeTextPages.add(pageNumber);
      }
      state.evidence.push(...pageResult.candidates.evidence);
      state.fields.push(...pageResult.candidates.fields);
    }
    state.pagesProcessed += 1;
    processedPages.push(pageNumber);
    if (stopAfterFirst && pageResult !== null && pageResult.candidates.evidence.length > 0) {
      break;
    }
  }
  return processedPages;
}

async function collectBarcodeEvidence(handle: DocumentHandle, cursor: PageCursor, state: MutableRunState, pages: number[], recipes: RenderRecipe[], options: ResolvedOptions, guard: WorkGuard, reuse: RenderReuse): Promise<void> {
  if (pages.length === 0 || recipes.length === 0) {
    return;
  }

  const { readBarcodes } = await import("./recognition/barcode-reader");

  for (let passIndex = 0; passIndex < recipes.length; passIndex += 1) {
    const recipe = recipes[passIndex];
    if (recipe === undefined) {
      continue;
    }
    state.passesUsed = Math.max(state.passesUsed, passIndex + 1);
    for (const pageNumber of pages) {
      guard.check();
      const candidates = await cursor.use(pageNumber, async (page) => {
        const rendered = await page.render(recipe, options.maxPixelsPerPage);
        state.renderAttempts += 1;
        state.renderedPages.add(pageNumber);
        try {
          const decoded = await readBarcodes(rendered, {
            photoEnhancements: handle.format !== "pdf",
            checkpoint: () => guard.check(),
          });
          return decoded.flatMap((barcode) => findCandidatesInDecodedValue(barcode.text, pageNumber, barcode.source, passIndex + 1, rendered.mapBoundsToPage(barcode.bounds)));
        } finally {
          reuse.offer(pageNumber, recipe, rendered);
        }
      });
      guard.check();
      state.evidence.push(...candidates);
      if (options.stopAfterFirst && candidates.length > 0) {
        return;
      }
    }
  }
}

function ocrRecipes(recipes: RenderRecipe[], options: ResolvedOptions, format: DocumentFormat): RenderRecipe[] {
  if (format !== "pdf") {
    return recipes;
  }
  const unrotated = recipes.filter((recipe) => recipe.rotation === 0).sort((left, right) => right.scale - left.scale)[0];
  const selected = unrotated === undefined ? [] : [unrotated];
  if (options.performance === "accurate") {
    selected.push(...recipes.filter((recipe) => recipe.rotation !== 0));
  }
  return selected;
}

function ocrCandidateLines(recognition: OcrRecognition, page: number, pass: number, rendered: RenderedPage): CandidateTextLine[] {
  return recognition.lines.map((line) => ({
    text: line.text,
    page,
    source: "ocr",
    pass,
    confidence: line.confidence,
    bounds: rendered.mapBoundsToPage(line.bounds),
    words: line.words.map((word) => ({
      ...word,
      bounds: rendered.mapBoundsToPage(word.bounds),
    })),
  }));
}

function ocrLineEvidence(recognition: OcrRecognition, page: number, pass: number, rendered: RenderedPage): CandidateEvidence[] {
  return recognition.lines.flatMap((line) => findCandidatesInOcrText(line.text, page, pass, line.confidence, rendered.mapBoundsToPage(line.bounds)));
}

function expandRegion(bounds: NormalizedBounds): NormalizedBounds {
  const x = Math.max(0, bounds.x - 0.025);
  const y = Math.max(0, bounds.y - 0.012);
  const right = Math.min(1, bounds.x + bounds.width + 0.025);
  const bottom = Math.min(1, bounds.y + bounds.height + 0.012);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function numericCandidateRegions(recognition: OcrRecognition): NormalizedBounds[] {
  const candidates = [...recognition.lines, ...recognition.blocks].filter((item) => {
    const compact = item.text.replace(/\s/gu, "");
    const numericCharacters = item.text.match(/[0-9OQDILZSG|]/giu)?.length ?? 0;
    return numericCharacters >= 24 && numericCharacters / Math.max(1, compact.length) >= 0.55;
  }).map((item) => expandRegion(item.bounds));
  const unique = new Map<string, NormalizedBounds>();
  for (const region of candidates) {
    const signature = `${region.x.toFixed(3)}:${region.y.toFixed(3)}:${region.width.toFixed(3)}:${region.height.toFixed(3)}`;
    unique.set(signature, region);
    if (unique.size >= 8) {
      break;
    }
  }
  return [...unique.values()];
}

function uniquePageEvidence(evidence: CandidateEvidence[]): CandidateEvidence[] {
  const unique = new Map<string, CandidateEvidence>();
  for (const candidate of evidence) {
    const bounds = candidate.bounds === undefined ? "" : `${candidate.bounds.x.toFixed(4)}:${candidate.bounds.y.toFixed(4)}:${candidate.bounds.width.toFixed(4)}:${candidate.bounds.height.toFixed(4)}`;
    const signature = `${candidate.barcode}:${candidate.source}:${candidate.pass}:${bounds}`;
    if (!unique.has(signature)) {
      unique.set(signature, candidate);
    }
  }
  return [...unique.values()];
}

async function digitRegionEvidence(session: OcrSession, image: Buffer, recognition: OcrRecognition, page: number, pass: number, rendered: RenderedPage, guard: WorkGuard): Promise<CandidateEvidence[]> {
  const evidence: CandidateEvidence[] = [];
  for (const region of numericCandidateRegions(recognition)) {
    guard.check();
    const retried = await session.recognizeDigits(image, region);
    guard.check();
    evidence.push(...findCandidatesInOcrText(retried.text, page, pass, retried.confidence, rendered.mapBoundsToPage(region)));
  }
  return uniquePageEvidence(evidence);
}

async function collectOcrEvidence(handle: DocumentHandle, cursor: PageCursor, state: MutableRunState, pages: number[], recipes: RenderRecipe[], options: ResolvedOptions, guard: WorkGuard, reuse: RenderReuse): Promise<OcrSession | null> {
  if (options.ocr === "never") {
    return null;
  }
  const pending = options.ocr === "always" ? pages : pages.filter((page) => !hasPageEvidence(state.evidence, page) || !state.nativeTextPages.has(page));
  if (pending.length === 0) {
    return null;
  }

  const selectedRecipes = ocrRecipes(recipes, options, handle.format);
  if (selectedRecipes.length === 0) {
    return null;
  }

  const { createOcrSession } = await import("./recognition/ocr-reader");
  const session = await createOcrSession();
  try {
    for (const pageNumber of pending) {
      for (const recipe of selectedRecipes) {
        guard.check();
        const pass = recipes.indexOf(recipe) + 1;
        state.passesUsed = Math.max(state.passesUsed, pass);
        const pageResult = await cursor.use(pageNumber, async (page) => {
          const rendered = reuse.take(pageNumber, recipe) ?? (await page.render(recipe, options.maxPixelsPerPage));
          state.renderAttempts += 1;
          state.renderedPages.add(pageNumber);
          state.ocrPages.add(pageNumber);
          try {
            const image = await rendered.toPng();
            guard.check();
            const recognized = await session.recognize(image);
            const candidates = uniquePageEvidence([...ocrLineEvidence(recognized, pageNumber, pass, rendered), ...findCandidatesInOcrText(recognized.text, pageNumber, pass, recognized.confidence)]);
            const retried = candidates.length === 0 ? await digitRegionEvidence(session, image, recognized, pageNumber, pass, rendered, guard) : [];
            return {
              evidence: [...candidates, ...retried],
              fields: extractFieldCandidates(ocrCandidateLines(recognized, pageNumber, pass, rendered)),
            };
          } finally {
            rendered.dispose();
          }
        });
        guard.check();
        state.evidence.push(...pageResult.evidence);
        state.fields.push(...pageResult.fields);
        if (options.stopAfterFirst && pageResult.evidence.length > 0) {
          return session;
        }
      }
    }
    return session;
  } catch (error) {
    await session.terminate().catch(() => undefined);
    throw error;
  }
}

/**
 * Extracts validated boleto codes and visible payment fields from one local, remote, or in-memory document.
 *
 * Processing failures are represented in the returned result instead of rejecting the promise.
 *
 * @param {DocumentInput} input - The file path, HTTP(S) URL, `ArrayBuffer`, or byte array to process.
 * @param {ExtractOptions} [optionsInput={}] - The resource, OCR, timeout, and request settings for this run.
 * @returns {Promise<ExtractionResult>} Resolves with validated matches, metadata, warnings, and any structured failure.
 * @since 0.1.0
 *
 * @example
 * const result = await extractBoletos("./boleto.pdf", {
 *   performance: "balanced",
 *   ocr: "fallback",
 * });
 */
export async function extractBoletos(input: DocumentInput, optionsInput: ExtractOptions = {}): Promise<ExtractionResult> {
  const startedAt = startTimer();
  let options: ResolvedOptions;
  try {
    options = resolveOptions(optionsInput);
  } catch (error) {
    if (error instanceof InvalidOptionsError) {
      return finalizeResultDuration(invalidOptionsResult(error, startedAt), startedAt);
    }
    return finalizeResultDuration(invalidOptionsResult(new InvalidOptionsError("Extraction options are invalid."), startedAt), startedAt);
  }

  const state = emptyState();
  let guard: WorkGuard | null = null;
  let handle: DocumentHandle | null = null;
  let ocrSession: OcrSession | null = null;
  let cursor: PageCursor | null = null;
  let reuse: RenderReuse | null = null;
  let loaded: LoadedInput | null = null;
  let result: ExtractionResult;

  try {
    guard = new WorkGuard(options, startedAt);
    guard.check();
    loaded = await loadDocumentInput(input, options.maxFileSizeBytes, {
      ...(options.requestHeaders === undefined ? {} : { requestHeaders: options.requestHeaders }),
      signal: guard.signal,
      streamStorage: options.streamStorage,
      streamMemoryThresholdBytes: options.streamMemoryThresholdBytes,
      ...(options.streamTempDirectory === undefined ? {} : { streamTempDirectory: options.streamTempDirectory }),
    });
    guard.check();
    state.fileSizeBytes = loaded.size;
    state.inputFormat = loaded.format;
    handle = await openDocument(loaded, options.maxSourceImagePixels, options.maxPixelsPerPage);
    guard.check();
    state.sourceImageWidth = handle.sourceImageDimensions?.width ?? null;
    state.sourceImageHeight = handle.sourceImageDimensions?.height ?? null;
    state.pagesTotal = handle.numPages;
    const pageLimit = Math.min(state.pagesTotal, options.maxPages);
    if (pageLimit < state.pagesTotal) {
      state.complete = false;
      state.warnings.push(`Only the first ${pageLimit} of ${state.pagesTotal} pages were processed because of maxPages.`);
    }

    cursor = new PageCursor(handle);
    const processedPages = await collectTextEvidence(cursor, state, pageLimit, guard, options.stopAfterFirst);
    if (!(options.stopAfterFirst && state.evidence.length > 0)) {
      const recipes = getRenderRecipes(options, handle.format);
      reuse = new RenderReuse(options.ocr === "never" ? null : (ocrRecipes(recipes, options, handle.format)[0] ?? null));
      await collectBarcodeEvidence(handle, cursor, state, processedPages, recipes, options, guard, reuse);
      if (!(options.stopAfterFirst && state.evidence.length > 0)) {
        ocrSession = await collectOcrEvidence(handle, cursor, state, processedPages, recipes, options, guard, reuse);
      }
    }

    guard.check();
    if (options.stopAfterFirst && state.evidence.length > 0) {
      state.complete = true;
    }
    result = resultFromState(options, state, startedAt);
  } catch (error) {
    state.complete = false;
    let resolvedError: unknown = error;
    try {
      guard?.check();
    } catch (guardError) {
      resolvedError = guardError;
    }
    const failure = resolvedError instanceof ExtractionFailure ? resolvedError : new ExtractionFailure("PROCESSING_ERROR", "The document could not be processed.", { cause: resolvedError });
    result = resultFromState(options, state, startedAt, {
      code: failure.code,
      message: failure.message,
    });
  } finally {
    disposeQuietly(() => guard?.dispose());
    disposeQuietly(() => reuse?.dispose());
    disposeQuietly(() => cursor?.release());
    await Promise.all([releaseQuietly(() => ocrSession?.terminate()), releaseQuietly(() => handle?.close())]);
    await releaseQuietly(() => loaded?.cleanup());
  }
  return finalizeResultDuration(result, startedAt);
}

/**
 * Reports whether a batch item is itself a document source rather than a source descriptor.
 *
 * A `Readable` and an async generator are ordinary objects, so this check has to run before the descriptor
 * branch: otherwise a streamed batch item would be rejected for not being a plain object with an `input` key.
 *
 * @param {unknown} value - The batch item or descriptor field to classify.
 * @returns {boolean} `true` when the value is a supported document input.
 */
function isDocumentInput(value: unknown): value is DocumentInput {
  return typeof value === "string" || value instanceof ArrayBuffer || value instanceof Uint8Array || isAsyncByteSource(value);
}

function resolveBatchSource(value: BoletoBatchInput): ResolvedBatchSource {
  if (isDocumentInput(value)) {
    return { input: value };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ExtractionFailure("INVALID_INPUT", "Each batch item must be a document source or a source descriptor.");
  }

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw new ExtractionFailure("INVALID_INPUT", "A batch source descriptor could not be read.");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ExtractionFailure("INVALID_INPUT", "A batch source descriptor must be a plain object.");
  }

  const inputDescriptor = Object.getOwnPropertyDescriptor(value, "input");
  const headersDescriptor = Object.getOwnPropertyDescriptor(value, "requestHeaders");
  if (inputDescriptor === undefined || !("value" in inputDescriptor) || !isDocumentInput(inputDescriptor.value)) {
    throw new ExtractionFailure("INVALID_INPUT", "A batch source descriptor must contain a document input.");
  }
  if (headersDescriptor !== undefined && (!("value" in headersDescriptor) || (headersDescriptor.value !== undefined && (typeof headersDescriptor.value !== "object" || headersDescriptor.value === null || Array.isArray(headersDescriptor.value))))) {
    throw new ExtractionFailure("INVALID_OPTIONS", "A batch source descriptor contains invalid requestHeaders.");
  }

  return {
    input: inputDescriptor.value,
    ...(headersDescriptor?.value === undefined
      ? {}
      : {
          requestHeaders: headersDescriptor.value as Readonly<Record<string, string>>,
        }),
  };
}

function batchMetadata(options: ResolvedOptions, items: BatchExtractionItem[], startedAt: MonotonicTimestamp, complete: boolean): ExtractionMetadata {
  return {
    performance: options.performance,
    ocrMode: options.ocr,
    passesRequested: options.passes,
    passesUsed: Math.max(0, ...items.map((item) => item.result.metadata.passesUsed)),
    pagesTotal: items.reduce((sum, item) => sum + item.result.metadata.pagesTotal, 0),
    pagesProcessed: items.reduce((sum, item) => sum + item.result.metadata.pagesProcessed, 0),
    pagesRendered: items.reduce((sum, item) => sum + item.result.metadata.pagesRendered, 0),
    renderAttempts: items.reduce((sum, item) => sum + (item.result.metadata.renderAttempts ?? 0), 0),
    ocrPages: items.reduce((sum, item) => sum + item.result.metadata.ocrPages, 0),
    fileSizeBytes: items.reduce((sum, item) => sum + item.result.metadata.fileSizeBytes, 0),
    maxPixelsPerPage: options.maxPixelsPerPage,
    maxSourceImagePixels: options.maxSourceImagePixels,
    durationMs: elapsedMilliseconds(startedAt),
    complete,
    confidenceVersion: "1.2.0",
  };
}

function emptyBatchResult(message: string, inputsTotal: number, concurrency: number, startedAt: MonotonicTimestamp): BatchExtractionResult {
  const options = resolveOptions();
  const result: BatchExtractionResult = {
    status: "error",
    success: false,
    precisionScore: 0,
    bestMatch: null,
    results: [],
    metadata: batchMetadata(options, [], startedAt, false),
    items: [],
    summary: {
      inputsTotal,
      inputsSucceeded: 0,
      inputsNotFound: 0,
      inputsPartial: 0,
      inputsFailed: inputsTotal,
      boletosFound: 0,
      concurrency,
      durationMs: 0,
    },
    warnings: [],
    error: {
      code: "INVALID_OPTIONS",
      message,
    },
  };
  const durationMs = elapsedMilliseconds(startedAt);
  result.metadata.durationMs = durationMs;
  result.summary.durationMs = durationMs;
  return result;
}

/**
 * Extracts boletos from multiple document sources with bounded concurrency and stable input ordering.
 *
 * Invalid batch settings and per-source failures are represented in the returned result instead of rejecting the promise.
 *
 * @param {ReadonlyArray<BoletoBatchInput>} inputs - The document inputs or source descriptors to process.
 * @param {BatchExtractOptions} [optionsInput={}] - The shared extraction settings and batch concurrency limit.
 * @returns {Promise<BatchExtractionResult>} Resolves with per-input results, flattened matches, summary counts, and metadata.
 * @since 0.1.0
 *
 * @example
 * const result = await extractBoletoBatch(
 *   ["./boleto.pdf", { input: "https://example.com/conta.png" }],
 *   { concurrency: 2 },
 * );
 */
export async function extractBoletoBatch(inputs: readonly BoletoBatchInput[], optionsInput: BatchExtractOptions = {}): Promise<BatchExtractionResult> {
  const startedAt = startTimer();
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return emptyBatchResult("inputs must be a non-empty array.", Array.isArray(inputs) ? inputs.length : 0, 1, startedAt);
  }

  let concurrency: number;
  let extractOptions: ExtractOptions;
  let resolvedOptions: ResolvedOptions;
  try {
    concurrency = optionsInput.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
      return emptyBatchResult("concurrency must be an integer between 1 and 8.", inputs.length, 1, startedAt);
    }
    if (Object.hasOwn(optionsInput as BatchExtractOptions & Record<string, unknown>, "requestHeaders")) {
      return emptyBatchResult("Batch requestHeaders must be supplied on each source descriptor.", inputs.length, concurrency, startedAt);
    }

    extractOptions = {
      ...(optionsInput.performance === undefined ? {} : { performance: optionsInput.performance }),
      ...(optionsInput.passes === undefined ? {} : { passes: optionsInput.passes }),
      ...(optionsInput.ocr === undefined ? {} : { ocr: optionsInput.ocr }),
      ...(optionsInput.maxPages === undefined ? {} : { maxPages: optionsInput.maxPages }),
      ...(optionsInput.maxFileSizeBytes === undefined ? {} : { maxFileSizeBytes: optionsInput.maxFileSizeBytes }),
      ...(optionsInput.maxPixelsPerPage === undefined ? {} : { maxPixelsPerPage: optionsInput.maxPixelsPerPage }),
      ...(optionsInput.maxSourceImagePixels === undefined ? {} : { maxSourceImagePixels: optionsInput.maxSourceImagePixels }),
      ...(optionsInput.timeoutMs === undefined ? {} : { timeoutMs: optionsInput.timeoutMs }),
      ...(optionsInput.stopAfterFirst === undefined ? {} : { stopAfterFirst: optionsInput.stopAfterFirst }),
      ...(optionsInput.signal === undefined ? {} : { signal: optionsInput.signal }),
    };
    resolvedOptions = resolveOptions(extractOptions);
  } catch (error) {
    const message = error instanceof InvalidOptionsError ? error.message : "Batch extraction options are invalid.";
    return emptyBatchResult(message, inputs.length, 1, startedAt);
  }

  const itemResults = new Array<BatchExtractionItem>(inputs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (extractOptions.signal?.aborted === true) {
        return;
      }
      const inputIndex = nextIndex;
      nextIndex += 1;
      if (inputIndex >= inputs.length) {
        return;
      }

      const source = inputs[inputIndex]!;
      let result: ExtractionResult;
      try {
        const resolved = resolveBatchSource(source);
        result = await extractBoletos(resolved.input, {
          ...extractOptions,
          ...(resolved.requestHeaders === undefined ? {} : { requestHeaders: resolved.requestHeaders }),
        });
      } catch (error) {
        const failure = error instanceof ExtractionFailure ? error : new ExtractionFailure("INVALID_INPUT", "A batch source descriptor could not be processed.", { cause: error });
        result = failureResult(failure.code, failure.message, resolvedOptions);
      }
      itemResults[inputIndex] = { inputIndex, result };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, async () => worker()));

  if (extractOptions.signal?.aborted === true) {
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
      itemResults[inputIndex] ??= {
        inputIndex,
        result: failureResult("ABORTED", "Extraction was aborted.", resolvedOptions, startedAt),
      };
    }
  }

  const items = itemResults.filter((item): item is BatchExtractionItem => item !== undefined);
  const results: BatchMatchedBoleto[] = items.flatMap((item) =>
    item.result.results.map((boleto) => ({
      inputIndex: item.inputIndex,
      boleto,
    })),
  );
  results.sort((left, right) => {
    if (left.inputIndex !== right.inputIndex) {
      return left.inputIndex - right.inputIndex;
    }
    return right.boleto.precisionScore - left.boleto.precisionScore;
  });

  const inputsSucceeded = items.filter((item) => item.result.status === "success").length;
  const inputsNotFound = items.filter((item) => item.result.status === "not_found").length;
  const inputsPartial = items.filter((item) => item.result.status === "partial").length;
  const inputsFailed = items.filter((item) => item.result.status === "error").length;
  const hasIncomplete = inputsPartial > 0 || inputsFailed > 0;
  const status: ExtractionStatus = results.length > 0 ? (hasIncomplete ? "partial" : "success") : inputsPartial > 0 ? "partial" : inputsFailed > 0 ? "error" : "not_found";
  const precisionScore = results.length === 0 ? 0 : Math.min(...results.map((item) => item.boleto.precisionScore));
  const bestMatch =
    [...results].sort((left, right) => {
      if (right.boleto.precisionScore !== left.boleto.precisionScore) {
        return right.boleto.precisionScore - left.boleto.precisionScore;
      }
      return left.inputIndex - right.inputIndex;
    })[0] ?? null;
  const firstError = items.find((item) => item.result.error !== null)?.result.error ?? null;
  const complete = items.length === inputs.length && items.every((item) => item.result.metadata.complete);

  const result: BatchExtractionResult = {
    status,
    success: results.length > 0,
    precisionScore: Number(precisionScore.toFixed(3)),
    bestMatch,
    results,
    metadata: batchMetadata(resolvedOptions, items, startedAt, complete),
    items,
    summary: {
      inputsTotal: inputs.length,
      inputsSucceeded,
      inputsNotFound,
      inputsPartial,
      inputsFailed,
      boletosFound: results.length,
      concurrency,
      durationMs: 0,
    },
    warnings: items.flatMap((item) => item.result.warnings.map((warning) => `Input ${item.inputIndex}: ${warning}`)),
    error: firstError,
  };
  const durationMs = elapsedMilliseconds(startedAt);
  result.metadata.durationMs = durationMs;
  result.summary.durationMs = durationMs;
  return result;
}
