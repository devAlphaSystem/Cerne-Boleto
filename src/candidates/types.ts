export type CandidateSource = "pdf-text" | "pdf-text-reconstructed" | "itf" | "ocr";

/**
 * A top-left-origin rectangle normalized to the page/image dimensions.
 * Every component is clamped to the inclusive range from 0 through 1.
 */
export interface NormalizedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BoletoLayout = "cobranca" | "arrecadacao";

export interface CandidateEvidence {
  /** The exact fragment which produced this evidence. */
  rawValue: string;
  /** Canonical 44-digit barcode representation. */
  barcode: string;
  /** Canonical 47- or 48-digit digitable line. */
  digitableLine: string;
  formattedDigitableLine: string;
  layout: BoletoLayout;
  page: number;
  source: CandidateSource;
  /** One-based render/OCR pass, or zero for native PDF text. */
  pass: number;
  nearLabel: boolean;
  bounds?: NormalizedBounds;
  /** Tesseract confidence on its native 0..100 scale. */
  ocrConfidence?: number;
  /** Count of conservative OCR character substitutions. */
  corrections?: number;
}

export type FieldKind = "institution" | "beneficiary" | "finalBeneficiary" | "payer" | "taxId" | "dueDate" | "amount" | "ourNumber" | "documentNumber" | "documentDate";

export type PartyRole = "beneficiary" | "final-beneficiary" | "payer";

export interface FieldCandidate {
  kind: FieldKind;
  /** Locale-independent normalized value. */
  value: string;
  /** Value as it appeared in the document, with surrounding whitespace removed. */
  rawValue: string;
  page: number;
  source: Exclude<CandidateSource, "itf">;
  /** Zero for native PDF text; otherwise the one-based render/OCR pass. */
  pass: number;
  /** Confidence normalized to 0..1. */
  confidence: number;
  bounds: NormalizedBounds | null;
  partyRole?: PartyRole;
  /** True for layout-heuristic candidates, used only by arrecadação results. */
  heuristic?: boolean;
}

export interface CandidateTextWord {
  text: string;
  confidence: number;
  bounds: NormalizedBounds;
}

export interface CandidateTextLine {
  text: string;
  page: number;
  source: Exclude<CandidateSource, "itf">;
  /** Zero for native PDF text; otherwise the one-based render/OCR pass. */
  pass: number;
  confidence: number;
  bounds: NormalizedBounds | null;
  words?: readonly CandidateTextWord[];
}
