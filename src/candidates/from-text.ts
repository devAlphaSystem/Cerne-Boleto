import { validateBoletoCode } from "../validation/boleto";
import type { CandidateEvidence, CandidateSource, NormalizedBounds } from "./types";

const SEPARATOR_PATTERN = /[\t \u00a0.\-_/]/u;
const LABEL_PATTERN = /(?:LINHA\s+DIGITAVEL|CODIGO\s+DE\s+BARRAS|REPRESENTACAO\s+NUMERICA|BOLETO)/u;

/**
 * Configures provenance and positioning for candidates parsed from text.
 */
export interface TextCandidateOptions {
  /** Selects the text extraction channel, defaulting to native PDF text. */
  source?: Exclude<CandidateSource, "itf">;
  /** Identifies pass zero for native text or a 1-based rendered recognition pass, defaulting to zero. */
  pass?: number;
  /** Applies a shared page-relative region to every candidate in the text. */
  bounds?: NormalizedBounds;
  /** Overrides automatic detection of nearby boleto labels. */
  nearLabel?: boolean;
}

/**
 * Associates a candidate-bearing text line with its page-relative position.
 */
export interface PositionedCandidateLine {
  /** Stores the text content to inspect for boleto representations. */
  text: string;
  /** Locates the line relative to the page dimensions. */
  bounds: NormalizedBounds;
}

/**
 * Supplies provenance and optional OCR metadata for validated boleto evidence.
 */
export interface ValidatedCandidateContext {
  /** Identifies the 1-based page that contains the candidate. */
  page: number;
  /** Identifies the extraction channel that produced the candidate. */
  source: CandidateSource;
  /** Identifies pass zero for native text or the 1-based rendered recognition pass. */
  pass: number;
  /** Controls whether the candidate is marked as having nearby label context. */
  nearLabel: boolean;
  /** Supplies an already-normalized numeric value when it differs from the raw text. */
  normalizedValue?: string;
  /** Locates the candidate relative to the page dimensions. */
  bounds?: NormalizedBounds;
  /** Records OCR confidence on a scale from zero to 100. */
  ocrConfidence?: number;
  /** Records how many OCR character substitutions produced the normalized value. */
  corrections?: number;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\u00a0/gu, " ");
}

function labelComparable(value: string): string {
  return normalizedText(value).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

function isNearLabel(text: string, start: number): boolean {
  const context = labelComparable(text.slice(Math.max(0, start - 160), Math.min(text.length, start + 24)));
  return LABEL_PATTERN.test(context);
}

function isSeparator(character: string | undefined): boolean {
  return character !== undefined && SEPARATOR_PATTERN.test(character);
}

function numericClusters(text: string): Array<{ rawValues: string[]; start: number }> {
  const output: Array<{ rawValues: string[]; start: number }> = [];

  for (let start = 0; start < text.length; start += 1) {
    if (!/[0-9]/u.test(text[start] ?? "")) {
      continue;
    }

    let cursor = start;
    let digitCount = 0;
    const rawValues: string[] = [];
    while (cursor < text.length && cursor - start <= 128) {
      const character = text[cursor];
      if (/[0-9]/u.test(character ?? "")) {
        digitCount += 1;
        if (digitCount === 44 || digitCount === 47 || digitCount === 48) {
          rawValues.unshift(text.slice(start, cursor + 1));
        }
      } else if (!isSeparator(character)) {
        break;
      }

      cursor += 1;
      if (digitCount >= 48) {
        break;
      }
    }

    if (rawValues.length > 0) {
      output.push({
        rawValues,
        start,
      });
    }
  }

  return output;
}

/**
 * Validates a raw boleto representation and attaches its extraction provenance.
 *
 * @param {string} rawValue - The source text or decoded barcode value to validate.
 * @param {ValidatedCandidateContext} context - The page, source, pass, and optional positional metadata.
 * @returns {CandidateEvidence|null} The normalized evidence, or `null` when the value is not a valid boleto representation.
 *
 * @example
 * const candidate = createValidatedCandidate(decodedValue, {
 *   page: 1,
 *   source: "itf",
 *   pass: 1,
 *   nearLabel: true,
 * });
 */
export function createValidatedCandidate(rawValue: string, context: ValidatedCandidateContext): CandidateEvidence | null {
  const numericValue = context.normalizedValue ?? rawValue.replace(/[^0-9]/gu, "");
  const validation = validateBoletoCode(numericValue);
  if (!validation.isValid || validation.barcode === null || validation.digitableLine === null || validation.formattedDigitableLine === null || validation.layout === null) {
    return null;
  }

  return {
    rawValue: rawValue.trim(),
    barcode: validation.barcode,
    digitableLine: validation.digitableLine,
    formattedDigitableLine: validation.formattedDigitableLine,
    layout: validation.layout,
    page: context.page,
    source: context.source,
    pass: context.pass,
    nearLabel: context.nearLabel,
    ...(context.bounds === undefined ? {} : { bounds: context.bounds }),
    ...(context.ocrConfidence === undefined ? {} : { ocrConfidence: context.ocrConfidence }),
    ...(context.corrections === undefined ? {} : { corrections: context.corrections }),
  };
}

function candidateSignature(candidate: CandidateEvidence): string {
  const bounds = candidate.bounds === undefined ? "" : `${candidate.bounds.x.toFixed(4)}:${candidate.bounds.y.toFixed(4)}:${candidate.bounds.width.toFixed(4)}:${candidate.bounds.height.toFixed(4)}`;
  return `${candidate.barcode}:${candidate.source}:${candidate.pass}:${bounds}`;
}

/**
 * Finds unique, validated boleto representations embedded in unpositioned text.
 *
 * @param {string} text - The document text to scan for numeric representations.
 * @param {number} page - The 1-based page associated with the text.
 * @param {TextCandidateOptions} [options={}] - Provenance and positioning overrides for the discovered candidates.
 * @returns {Array<CandidateEvidence>} The validated candidates in discovery order.
 *
 * @example
 * const candidates = findCandidatesInText(pageText, 1, {
 *   source: "pdf-text",
 *   pass: 0,
 *   nearLabel: true,
 * });
 */
export function findCandidatesInText(text: string, page: number, options: TextCandidateOptions = {}): CandidateEvidence[] {
  const normalized = normalizedText(text);
  const output: CandidateEvidence[] = [];
  const seen = new Set<string>();
  const source = options.source ?? "pdf-text";
  const pass = options.pass ?? 0;

  for (const cluster of numericClusters(normalized)) {
    for (const rawValue of cluster.rawValues) {
      const candidate = createValidatedCandidate(rawValue, {
        page,
        source,
        pass,
        nearLabel: options.nearLabel ?? isNearLabel(normalized, cluster.start),
        ...(options.bounds === undefined ? {} : { bounds: options.bounds }),
      });
      if (candidate === null) {
        continue;
      }

      const signature = candidateSignature(candidate);
      if (!seen.has(signature)) {
        seen.add(signature);
        output.push(candidate);
      }
      break;
    }
  }

  return output;
}

/**
 * Finds validated boleto representations while preserving each line's bounds.
 *
 * @param {ReadonlyArray<PositionedCandidateLine>} lines - The positioned text lines to scan.
 * @param {number} page - The 1-based page associated with the lines.
 * @param {"pdf-text"|"pdf-text-reconstructed"} [source="pdf-text-reconstructed"] - The text extraction channel to record.
 * @returns {Array<CandidateEvidence>} The validated candidates with their source-line bounds.
 */
export function findCandidatesInPositionedText(lines: readonly PositionedCandidateLine[], page: number, source: Extract<CandidateSource, "pdf-text" | "pdf-text-reconstructed"> = "pdf-text-reconstructed"): CandidateEvidence[] {
  return lines.flatMap((line) =>
    findCandidatesInText(line.text, page, {
      source,
      bounds: line.bounds,
    }),
  );
}

/**
 * Validates a decoded ITF value and records its barcode extraction context.
 *
 * @param {string} value - The decoded numeric barcode value.
 * @param {number} page - The 1-based page that contains the barcode.
 * @param {"itf"} source - The barcode extraction channel.
 * @param {number} pass - The 1-based rendered barcode pass that produced the value.
 * @param {NormalizedBounds} [bounds] - The optional page-relative barcode bounds.
 * @returns {Array<CandidateEvidence>} A single validated candidate, or an empty array when validation fails.
 */
export function findCandidatesInDecodedValue(value: string, page: number, source: "itf", pass: number, bounds?: NormalizedBounds): CandidateEvidence[] {
  const candidate = createValidatedCandidate(value, {
    page,
    source,
    pass,
    nearLabel: true,
    ...(bounds === undefined ? {} : { bounds }),
  });
  return candidate === null ? [] : [candidate];
}
