import { createValidatedCandidate, findCandidatesInText } from "./from-text";
import type { CandidateEvidence, NormalizedBounds } from "./types";

const OCR_TO_DIGIT: Readonly<Record<string, string>> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  "|": "1",
  Z: "2",
  S: "5",
  G: "6",
  B: "8",
};
const OCR_CHARACTER_PATTERN = /[0-9OQDILZSG|]/u;
const OCR_SEPARATOR_PATTERN = /[\t \u00a0.\-_/]/u;
const MAX_CORRECTIONS = 2;

interface OcrCluster {
  rawValue: string;
  correctedValue: string;
  corrections: number;
}

function isOcrCharacter(character: string | undefined): boolean {
  return character !== undefined && OCR_CHARACTER_PATTERN.test(character);
}

function isSeparator(character: string | undefined): boolean {
  return character !== undefined && OCR_SEPARATOR_PATTERN.test(character);
}

function correctedClusters(text: string): OcrCluster[][] {
  const output: OcrCluster[][] = [];

  for (let start = 0; start < text.length; start += 1) {
    if (!isOcrCharacter(text[start])) {
      continue;
    }

    let cursor = start;
    let characterCount = 0;
    let corrections = 0;
    let correctedValue = "";
    const alternatives: OcrCluster[] = [];

    while (cursor < text.length && cursor - start <= 128) {
      const character = text[cursor];
      if (/[0-9]/u.test(character ?? "")) {
        correctedValue += character;
        characterCount += 1;
      } else if (isOcrCharacter(character)) {
        const replacement = OCR_TO_DIGIT[character!];
        if (replacement === undefined) {
          break;
        }
        correctedValue += replacement;
        characterCount += 1;
        corrections += 1;
      } else if (!isSeparator(character)) {
        break;
      }

      if (corrections > 0 && corrections <= MAX_CORRECTIONS && (characterCount === 44 || characterCount === 47 || characterCount === 48)) {
        alternatives.unshift({
          rawValue: text.slice(start, cursor + 1),
          correctedValue,
          corrections,
        });
      }
      cursor += 1;
      if (characterCount >= 48 || corrections > MAX_CORRECTIONS) {
        break;
      }
    }

    if (alternatives.length > 0) {
      output.push(alternatives);
    }
  }

  return output;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Finds validated boleto representations in OCR text, including unambiguous
 * candidates recovered through limited character substitution.
 *
 * @param {string} text - The OCR text to scan for boleto representations.
 * @param {number} page - The 1-based page associated with the text.
 * @param {number} pass - The 1-based rendered OCR pass that produced the text.
 * @param {number} confidence - The OCR confidence to clamp to the zero-to-100 range.
 * @param {NormalizedBounds} [bounds] - The optional page-relative bounds shared by the text.
 * @returns {Array<CandidateEvidence>} The exact and uniquely corrected candidates in discovery order.
 */
export function findCandidatesInOcrText(text: string, page: number, pass: number, confidence: number, bounds?: NormalizedBounds): CandidateEvidence[] {
  const normalized = text
    .normalize("NFKC")
    .replace(/\u00a0/gu, " ")
    .toUpperCase();
  const ocrConfidence = clampConfidence(confidence);
  const exact = findCandidatesInText(normalized, page, {
    source: "ocr",
    pass,
    ...(bounds === undefined ? {} : { bounds }),
  }).map((candidate) => ({
    ...candidate,
    ocrConfidence,
  }));
  const output: CandidateEvidence[] = [...exact];
  const seen = new Set(exact.map((candidate) => candidate.barcode));

  for (const alternatives of correctedClusters(normalized)) {
    const validAlternatives = new Map<string, CandidateEvidence>();
    for (const cluster of alternatives) {
      const candidate = createValidatedCandidate(cluster.rawValue, {
        page,
        source: "ocr",
        pass,
        nearLabel: false,
        normalizedValue: cluster.correctedValue,
        ocrConfidence,
        corrections: cluster.corrections,
        ...(bounds === undefined ? {} : { bounds }),
      });
      if (candidate !== null) {
        validAlternatives.set(candidate.barcode, candidate);
      }
    }

    if (validAlternatives.size !== 1) {
      continue;
    }
    const unique = [...validAlternatives.values()][0]!;
    if (!seen.has(unique.barcode)) {
      seen.add(unique.barcode);
      output.push(unique);
    }
  }

  return output;
}
