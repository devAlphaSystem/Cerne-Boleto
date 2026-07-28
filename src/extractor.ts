import { performance } from "node:perf_hooks";

import { extractFieldCandidates } from "./candidates/fields";
import { findCandidatesInOcrText } from "./candidates/from-ocr";
import { findCandidatesInDecodedValue, findCandidatesInPositionedText, findCandidatesInText } from "./candidates/from-text";
import type { CandidateEvidence, CandidateTextLine, FieldCandidate, NormalizedBounds } from "./candidates/types";
import { WorkGuard } from "./deadline";
import { ExtractionFailure } from "./errors";
import { getRenderRecipes, InvalidOptionsError, resolveOptions, type RenderRecipe, type ResolvedOptions } from "./options";
import { extractPageText, type ExtractedPageText } from "./pdf/extract-text";
import { loadPdfInput } from "./pdf/load-input";
import { openPdfDocument } from "./pdf/open-document";
import type { PdfHandle, PdfPageLike } from "./pdf/types";
import type { OcrRecognition, OcrSession } from "./recognition/ocr-reader";
import { mergeEvidence } from "./scoring/merge-results";
import type { BatchExtractOptions, BatchExtractionItem, BatchExtractionResult, BatchMatchedBoleto, BoletoBatchInput, ExtractOptions, ExtractionErrorCode, ExtractionErrorInfo, ExtractionMetadata, ExtractionResult, ExtractionStatus, PdfInput } from "./types";

interface MutableRunState {
  evidence: CandidateEvidence[];
  fields: FieldCandidate[];
  warnings: string[];
  pagesTotal: number;
  pagesProcessed: number;
  renderedPages: Set<number>;
  ocrPages: Set<number>;
  nativeTextPages: Set<number>;
  passesUsed: number;
  fileSizeBytes: number;
  complete: boolean;
}

interface ResolvedBatchSource {
  input: PdfInput;
  requestHeaders?: Readonly<Record<string, string>>;
}

function emptyState(): MutableRunState {
  return {
    evidence: [],
    fields: [],
    warnings: [],
    pagesTotal: 0,
    pagesProcessed: 0,
    renderedPages: new Set(),
    ocrPages: new Set(),
    nativeTextPages: new Set(),
    passesUsed: 0,
    fileSizeBytes: 0,
    complete: true,
  };
}

function metadata(options: ResolvedOptions, state: MutableRunState, startedAt: number): ExtractionMetadata {
  return {
    performance: options.performance,
    ocrMode: options.ocr,
    passesRequested: options.passes,
    passesUsed: state.passesUsed,
    pagesTotal: state.pagesTotal,
    pagesProcessed: state.pagesProcessed,
    pagesRendered: state.renderedPages.size,
    ocrPages: state.ocrPages.size,
    fileSizeBytes: state.fileSizeBytes,
    maxPixelsPerPage: options.maxPixelsPerPage,
    maxSourceImagePixels: options.maxSourceImagePixels,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    complete: state.complete,
    confidenceVersion: "1.2.0",
  };
}

function resultFromState(options: ResolvedOptions, state: MutableRunState, startedAt: number, error: ExtractionErrorInfo | null = null): ExtractionResult {
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

function failureResult(code: ExtractionErrorCode, message: string, startedAt = performance.now()): ExtractionResult {
  const state = emptyState();
  state.complete = false;
  return resultFromState(resolveOptions(), state, startedAt, { code, message });
}

function invalidOptionsResult(error: InvalidOptionsError, startedAt: number): ExtractionResult {
  return failureResult("INVALID_OPTIONS", error.message, startedAt);
}

async function withPage<T>(handle: PdfHandle, pageNumber: number, work: (page: PdfPageLike) => Promise<T>): Promise<T> {
  const page = await handle.document.getPage(pageNumber);
  try {
    return await work(page);
  } finally {
    page.cleanup();
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

/**
 * A render recipe rotates relative to the PDF's normal display orientation.
 * Convert recognition coordinates back to that base orientation before
 * comparing them with native PDF text coordinates.
 */
function baseOrientationBounds(bounds: NormalizedBounds, rotation: RenderRecipe["rotation"]): NormalizedBounds {
  switch (rotation) {
    case 0:
      return bounds;
    case 90:
      return {
        x: bounds.y,
        y: 1 - bounds.x - bounds.width,
        width: bounds.height,
        height: bounds.width,
      };
    case 270:
      return {
        x: 1 - bounds.y - bounds.height,
        y: bounds.x,
        width: bounds.height,
        height: bounds.width,
      };
  }
}

async function collectTextEvidence(handle: PdfHandle, state: MutableRunState, pageLimit: number, guard: WorkGuard, stopAfterFirst: boolean): Promise<number[]> {
  const processedPages: number[] = [];
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    guard.check();
    const pageResult = await withPage(handle, pageNumber, async (page) => {
      const pageText = await extractPageText(page);
      return {
        pageText,
        candidates: textEvidence(pageText, pageNumber),
      };
    });
    guard.check();
    if (pageResult.pageText.hasText) {
      state.nativeTextPages.add(pageNumber);
    }
    state.evidence.push(...pageResult.candidates.evidence);
    state.fields.push(...pageResult.candidates.fields);
    state.pagesProcessed += 1;
    processedPages.push(pageNumber);
    if (stopAfterFirst && pageResult.candidates.evidence.length > 0) {
      break;
    }
  }
  return processedPages;
}

async function collectBarcodeEvidence(handle: PdfHandle, state: MutableRunState, pages: number[], recipes: RenderRecipe[], options: ResolvedOptions, guard: WorkGuard): Promise<void> {
  if (pages.length === 0 || recipes.length === 0) {
    return;
  }

  const [{ renderPage }, { readBarcodes }] = await Promise.all([import("./pdf/render-page"), import("./recognition/barcode-reader")]);

  for (let passIndex = 0; passIndex < recipes.length; passIndex += 1) {
    const recipe = recipes[passIndex];
    if (recipe === undefined) {
      continue;
    }
    state.passesUsed = Math.max(state.passesUsed, passIndex + 1);
    for (const pageNumber of pages) {
      guard.check();
      const candidates = await withPage(handle, pageNumber, async (page) => {
        const rendered = await renderPage(page, recipe, options.maxPixelsPerPage);
        state.renderedPages.add(pageNumber);
        const decoded = await readBarcodes(rendered);
        return decoded.flatMap((barcode) => findCandidatesInDecodedValue(barcode.text, pageNumber, barcode.source, passIndex + 1, baseOrientationBounds(barcode.bounds, recipe.rotation)));
      });
      guard.check();
      state.evidence.push(...candidates);
      if (options.stopAfterFirst && candidates.length > 0) {
        return;
      }
    }
  }
}

function ocrRecipes(recipes: RenderRecipe[], options: ResolvedOptions): RenderRecipe[] {
  const unrotated = recipes.filter((recipe) => recipe.rotation === 0).sort((left, right) => right.scale - left.scale)[0];
  const selected = unrotated === undefined ? [] : [unrotated];
  if (options.performance === "accurate") {
    selected.push(...recipes.filter((recipe) => recipe.rotation !== 0));
  }
  return selected;
}

function ocrCandidateLines(recognition: OcrRecognition, page: number, pass: number, rotation: RenderRecipe["rotation"]): CandidateTextLine[] {
  return recognition.lines.map((line) => ({
    text: line.text,
    page,
    source: "ocr",
    pass,
    confidence: line.confidence,
    bounds: baseOrientationBounds(line.bounds, rotation),
    words: line.words.map((word) => ({
      ...word,
      bounds: baseOrientationBounds(word.bounds, rotation),
    })),
  }));
}

function ocrLineEvidence(recognition: OcrRecognition, page: number, pass: number, rotation: RenderRecipe["rotation"]): CandidateEvidence[] {
  return recognition.lines.flatMap((line) => findCandidatesInOcrText(line.text, page, pass, line.confidence, baseOrientationBounds(line.bounds, rotation)));
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

async function digitRegionEvidence(session: OcrSession, image: Buffer, recognition: OcrRecognition, page: number, pass: number, rotation: RenderRecipe["rotation"], guard: WorkGuard): Promise<CandidateEvidence[]> {
  const evidence: CandidateEvidence[] = [];
  for (const region of numericCandidateRegions(recognition)) {
    guard.check();
    const retried = await session.recognizeDigits(image, region);
    guard.check();
    evidence.push(...findCandidatesInOcrText(retried.text, page, pass, retried.confidence, baseOrientationBounds(region, rotation)));
  }
  return uniquePageEvidence(evidence);
}

async function collectOcrEvidence(handle: PdfHandle, state: MutableRunState, pages: number[], recipes: RenderRecipe[], options: ResolvedOptions, guard: WorkGuard): Promise<OcrSession | null> {
  if (options.ocr === "never") {
    return null;
  }
  const pending = options.ocr === "always" ? pages : pages.filter((page) => !hasPageEvidence(state.evidence, page) || !state.nativeTextPages.has(page));
  if (pending.length === 0) {
    return null;
  }

  const selectedRecipes = ocrRecipes(recipes, options);
  if (selectedRecipes.length === 0) {
    return null;
  }

  const [{ renderPage }, { createOcrSession }] = await Promise.all([import("./pdf/render-page"), import("./recognition/ocr-reader")]);
  const session = await createOcrSession();
  try {
    for (const pageNumber of pending) {
      for (const recipe of selectedRecipes) {
        guard.check();
        const pass = recipes.indexOf(recipe) + 1;
        state.passesUsed = Math.max(state.passesUsed, pass);
        const pageResult = await withPage(handle, pageNumber, async (page) => {
          const rendered = await renderPage(page, recipe, options.maxPixelsPerPage);
          state.renderedPages.add(pageNumber);
          state.ocrPages.add(pageNumber);
          const image = rendered.toPng();
          const recognized = await session.recognize(image);
          const candidates = uniquePageEvidence([...ocrLineEvidence(recognized, pageNumber, pass, recipe.rotation), ...findCandidatesInOcrText(recognized.text, pageNumber, pass, recognized.confidence)]);
          const retried = candidates.length === 0 ? await digitRegionEvidence(session, image, recognized, pageNumber, pass, recipe.rotation, guard) : [];
          return {
            evidence: [...candidates, ...retried],
            fields: extractFieldCandidates(ocrCandidateLines(recognized, pageNumber, pass, recipe.rotation)),
          };
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
 * Extracts validated cobrança and arrecadação boletos from one local path,
 * direct HTTP(S) PDF URL, or in-memory PDF.
 *
 * Expected input and processing failures resolve to a JSON-safe result.
 */
export async function extractBoletos(input: PdfInput, optionsInput: ExtractOptions = {}): Promise<ExtractionResult> {
  const startedAt = performance.now();
  let options: ResolvedOptions;
  try {
    options = resolveOptions(optionsInput);
  } catch (error) {
    if (error instanceof InvalidOptionsError) {
      return invalidOptionsResult(error, startedAt);
    }
    return invalidOptionsResult(new InvalidOptionsError("Extraction options are invalid."), startedAt);
  }

  const state = emptyState();
  const guard = new WorkGuard(options, startedAt);
  let handle: PdfHandle | null = null;
  let ocrSession: OcrSession | null = null;

  try {
    guard.check();
    const loaded = await loadPdfInput(input, options.maxFileSizeBytes, {
      ...(options.requestHeaders === undefined ? {} : { requestHeaders: options.requestHeaders }),
      signal: guard.signal,
    });
    guard.check();
    state.fileSizeBytes = loaded.size;
    handle = await openPdfDocument(loaded.data, options.maxSourceImagePixels, options.maxPixelsPerPage);
    guard.check();
    state.pagesTotal = handle.document.numPages;
    const pageLimit = Math.min(state.pagesTotal, options.maxPages);
    if (pageLimit < state.pagesTotal) {
      state.complete = false;
      state.warnings.push(`Only the first ${pageLimit} of ${state.pagesTotal} pages were processed because of maxPages.`);
    }

    const processedPages = await collectTextEvidence(handle, state, pageLimit, guard, options.stopAfterFirst);
    if (!(options.stopAfterFirst && state.evidence.length > 0)) {
      const recipes = getRenderRecipes(options);
      await collectBarcodeEvidence(handle, state, processedPages, recipes, options, guard);
      if (!(options.stopAfterFirst && state.evidence.length > 0)) {
        ocrSession = await collectOcrEvidence(handle, state, processedPages, recipes, options, guard);
      }
    }

    guard.check();
    if (options.stopAfterFirst && state.evidence.length > 0) {
      state.complete = true;
    }
    return resultFromState(options, state, startedAt);
  } catch (error) {
    state.complete = false;
    let resolvedError: unknown = error;
    try {
      guard.check();
    } catch (guardError) {
      resolvedError = guardError;
    }
    const failure = resolvedError instanceof ExtractionFailure ? resolvedError : new ExtractionFailure("PROCESSING_ERROR", "The PDF could not be processed.", { cause: resolvedError });
    return resultFromState(options, state, startedAt, {
      code: failure.code,
      message: failure.message,
    });
  } finally {
    guard.dispose();
    await ocrSession?.terminate().catch(() => undefined);
    await handle?.close().catch(() => undefined);
  }
}

function isSimplePdfInput(value: unknown): value is PdfInput {
  return typeof value === "string" || value instanceof ArrayBuffer || value instanceof Uint8Array;
}

function resolveBatchSource(value: BoletoBatchInput): ResolvedBatchSource {
  if (isSimplePdfInput(value)) {
    return { input: value };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ExtractionFailure("INVALID_INPUT", "Each batch item must be a PDF source or a source descriptor.");
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
  if (inputDescriptor === undefined || !("value" in inputDescriptor) || !isSimplePdfInput(inputDescriptor.value)) {
    throw new ExtractionFailure("INVALID_INPUT", "A batch source descriptor must contain a PDF input.");
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

function batchMetadata(options: ResolvedOptions, items: BatchExtractionItem[], startedAt: number, complete: boolean): ExtractionMetadata {
  return {
    performance: options.performance,
    ocrMode: options.ocr,
    passesRequested: options.passes,
    passesUsed: Math.max(0, ...items.map((item) => item.result.metadata.passesUsed)),
    pagesTotal: items.reduce((sum, item) => sum + item.result.metadata.pagesTotal, 0),
    pagesProcessed: items.reduce((sum, item) => sum + item.result.metadata.pagesProcessed, 0),
    pagesRendered: items.reduce((sum, item) => sum + item.result.metadata.pagesRendered, 0),
    ocrPages: items.reduce((sum, item) => sum + item.result.metadata.ocrPages, 0),
    fileSizeBytes: items.reduce((sum, item) => sum + item.result.metadata.fileSizeBytes, 0),
    maxPixelsPerPage: options.maxPixelsPerPage,
    maxSourceImagePixels: options.maxSourceImagePixels,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    complete,
    confidenceVersion: "1.2.0",
  };
}

function emptyBatchResult(message: string, inputsTotal: number, concurrency: number, startedAt: number): BatchExtractionResult {
  const options = resolveOptions();
  return {
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
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    },
    warnings: [],
    error: {
      code: "INVALID_OPTIONS",
      message,
    },
  };
}

/**
 * Extracts boletos from an ordered batch. Inputs are processed with bounded
 * concurrency and are represented in the result only by their zero-based index.
 */
export async function extractBoletoBatch(inputs: readonly BoletoBatchInput[], optionsInput: BatchExtractOptions = {}): Promise<BatchExtractionResult> {
  const startedAt = performance.now();
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
        result = failureResult(failure.code, failure.message);
      }
      itemResults[inputIndex] = { inputIndex, result };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, async () => worker()));

  if (extractOptions.signal?.aborted === true) {
    for (let inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
      itemResults[inputIndex] ??= {
        inputIndex,
        result: failureResult("ABORTED", "Extraction was aborted."),
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
  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  const complete = items.length === inputs.length && items.every((item) => item.result.metadata.complete);

  return {
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
      durationMs,
    },
    warnings: items.flatMap((item) => item.result.warnings.map((warning) => `Input ${item.inputIndex}: ${warning}`)),
    error: firstError,
  };
}
