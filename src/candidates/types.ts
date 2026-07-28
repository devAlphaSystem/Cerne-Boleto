export type CandidateSource = "pdf-text" | "pdf-text-reconstructed" | "itf" | "ocr";

export interface NormalizedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BoletoLayout = "cobranca" | "arrecadacao";

export interface CandidateEvidence {
  rawValue: string;
  barcode: string;
  digitableLine: string;
  formattedDigitableLine: string;
  layout: BoletoLayout;
  page: number;
  source: CandidateSource;
  pass: number;
  nearLabel: boolean;
  bounds?: NormalizedBounds;
  ocrConfidence?: number;
  corrections?: number;
}

export type FieldKind = "institution" | "beneficiary" | "finalBeneficiary" | "payer" | "taxId" | "dueDate" | "amount" | "ourNumber" | "documentNumber" | "documentDate";

export type PartyRole = "beneficiary" | "final-beneficiary" | "payer";

export interface FieldCandidate {
  kind: FieldKind;
  value: string;
  rawValue: string;
  page: number;
  source: Exclude<CandidateSource, "itf">;
  pass: number;
  confidence: number;
  bounds: NormalizedBounds | null;
  partyRole?: PartyRole;
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
  pass: number;
  confidence: number;
  bounds: NormalizedBounds | null;
  words?: readonly CandidateTextWord[];
}
