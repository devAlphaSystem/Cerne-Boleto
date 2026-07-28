/**
 * Identifies the extraction channel that produced boleto evidence.
 */
export type CandidateSource = "pdf-text" | "pdf-text-reconstructed" | "itf" | "ocr";

/**
 * Describes a rectangular region using page-relative coordinates from zero to one.
 */
export interface NormalizedBounds {
  /** Specifies the horizontal offset from the left edge of the page. */
  x: number;
  /** Specifies the vertical offset from the top edge of the page. */
  y: number;
  /** Specifies the region width relative to the page width. */
  width: number;
  /** Specifies the region height relative to the page height. */
  height: number;
}

/**
 * Identifies the FEBRABAN layout represented by a boleto candidate.
 */
export type BoletoLayout = "cobranca" | "arrecadacao";

/**
 * Captures a validated boleto representation together with its extraction provenance.
 */
export interface CandidateEvidence {
  /** Preserves the source text or decoded value before normalization. */
  rawValue: string;
  /** Stores the normalized 44-digit barcode representation. */
  barcode: string;
  /** Stores the normalized 47- or 48-digit digitable-line representation. */
  digitableLine: string;
  /** Stores the human-readable digitable line with separators. */
  formattedDigitableLine: string;
  /** Identifies the validated boleto layout. */
  layout: BoletoLayout;
  /** Identifies the 1-based page where the evidence was found. */
  page: number;
  /** Identifies the extraction channel that produced the evidence. */
  source: CandidateSource;
  /** Identifies pass zero for native text or the 1-based rendered recognition pass. */
  pass: number;
  /** Records whether the extraction channel marked the evidence as having nearby label context. */
  nearLabel: boolean;
  /** Locates the candidate on the page when positional data is available. */
  bounds?: NormalizedBounds;
  /** Records the OCR engine confidence on a scale from zero to 100. */
  ocrConfidence?: number;
  /** Records how many OCR character substitutions were required. */
  corrections?: number;
}

/**
 * Identifies a general boleto field that can be extracted from document text.
 */
export type FieldKind = "institution" | "beneficiary" | "finalBeneficiary" | "payer" | "taxId" | "dueDate" | "amount" | "ourNumber" | "documentNumber" | "documentDate";

/**
 * Identifies the boleto party associated with an extracted identity field.
 */
export type PartyRole = "beneficiary" | "final-beneficiary" | "payer";

/**
 * Captures a normalized boleto field together with its source and position.
 */
export interface FieldCandidate {
  /** Identifies the semantic field represented by the candidate. */
  kind: FieldKind;
  /** Stores the normalized field value. */
  value: string;
  /** Preserves the field value before normalization. */
  rawValue: string;
  /** Identifies the 1-based page where the field was found. */
  page: number;
  /** Identifies the text extraction channel that produced the field. */
  source: Exclude<CandidateSource, "itf">;
  /** Identifies pass zero for native text or the 1-based rendered recognition pass. */
  pass: number;
  /** Records the field confidence normalized to a scale from zero through one. */
  confidence: number;
  /** Locates the field on the page, or is `null` when position is unavailable. */
  bounds: NormalizedBounds | null;
  /** Identifies the party associated with identity-related fields. */
  partyRole?: PartyRole;
  /** Indicates whether the field was inferred from document-layout heuristics. */
  heuristic?: boolean;
}

/**
 * Represents an OCR or PDF text word with confidence and page-relative bounds.
 */
export interface CandidateTextWord {
  /** Stores the recognized word content. */
  text: string;
  /** Records full confidence as one for native text or the OCR engine score from zero through 100. */
  confidence: number;
  /** Locates the word relative to the page dimensions. */
  bounds: NormalizedBounds;
}

/**
 * Represents a text line prepared for boleto candidate and field extraction.
 */
export interface CandidateTextLine {
  /** Stores the extracted and trimmed line content supplied for matching. */
  text: string;
  /** Identifies the 1-based page that contains the line. */
  page: number;
  /** Identifies the text extraction channel that produced the line. */
  source: Exclude<CandidateSource, "itf">;
  /** Identifies pass zero for native text or the 1-based rendered recognition pass. */
  pass: number;
  /** Records full confidence as one for native text or the OCR engine score from zero through 100. */
  confidence: number;
  /** Locates the line on the page, or is `null` when position is unavailable. */
  bounds: NormalizedBounds | null;
  /** Provides the positioned words used to derive the line when available. */
  words?: readonly CandidateTextWord[];
}
