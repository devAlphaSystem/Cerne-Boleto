import { validateBoletoCode } from "../validation/boleto";
import type { CandidateEvidence, CandidateSource, NormalizedBounds } from "./types";

const SEPARATOR_PATTERN = /[\t \u00a0.\-_/]/u;
const LABEL_PATTERN = /(?:LINHA\s+DIGITAVEL|CODIGO\s+DE\s+BARRAS|REPRESENTACAO\s+NUMERICA|BOLETO)/u;

export interface TextCandidateOptions {
  source?: Exclude<CandidateSource, "itf">;
  pass?: number;
  bounds?: NormalizedBounds;
  nearLabel?: boolean;
}

export interface PositionedCandidateLine {
  text: string;
  bounds: NormalizedBounds;
}

export interface ValidatedCandidateContext {
  page: number;
  source: CandidateSource;
  pass: number;
  nearLabel: boolean;
  /** Numeric value to validate when rawValue contains corrected OCR glyphs. */
  normalizedValue?: string;
  bounds?: NormalizedBounds;
  ocrConfidence?: number;
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

export function findCandidatesInPositionedText(lines: readonly PositionedCandidateLine[], page: number, source: Extract<CandidateSource, "pdf-text" | "pdf-text-reconstructed"> = "pdf-text-reconstructed"): CandidateEvidence[] {
  return lines.flatMap((line) =>
    findCandidatesInText(line.text, page, {
      source,
      bounds: line.bounds,
    }),
  );
}

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
