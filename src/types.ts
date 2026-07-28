import type { BoletoComponents, BoletoLayout } from "./validation/boleto";

/** A local path, HTTP(S) URL, or in-memory PDF byte source. */
export type PdfInput = string | ArrayBuffer | Uint8Array;

export type PerformanceProfile = "fast" | "balanced" | "accurate";

export type OcrMode = "never" | "fallback" | "always";

export type ExtractionStatus = "success" | "not_found" | "partial" | "error";

export type ExtractionSource = "pdf-text" | "pdf-text-reconstructed" | "itf" | "ocr";

export type BoletoFieldSource = "encoded" | "pdf-text" | "ocr";

export type ExtractionErrorCode = "INVALID_INPUT" | "FILE_NOT_FOUND" | "FILE_TOO_LARGE" | "DOWNLOAD_ERROR" | "INVALID_OPTIONS" | "INVALID_PDF" | "PASSWORD_REQUIRED" | "TIMEOUT" | "ABORTED" | "RESOURCE_LIMIT" | "PROCESSING_ERROR";

export interface ExtractOptions {
  /** Processing/cost profile. Defaults to `balanced`. */
  performance?: PerformanceProfile;
  /** Distinct visual render attempts, from 1 through 5. */
  passes?: number;
  /** OCR policy. Profile defaults are `never`, `fallback`, and `fallback`. */
  ocr?: OcrMode;
  /** Maximum pages processed from the beginning of the PDF. */
  maxPages?: number;
  /** Maximum accepted input size. Defaults to 30 MiB. */
  maxFileSizeBytes?: number;
  /** Maximum render area per page, after scale and rotation. */
  maxPixelsPerPage?: number;
  /** Maximum decoded source-image area accepted from a PDF page. */
  maxSourceImagePixels?: number;
  /** Overall deadline in milliseconds. Network I/O aborts; CPU stages check cooperatively. */
  timeoutMs?: number;
  /** Stop after the first validated boleto. */
  stopAfterFirst?: boolean;
  /** Optional request headers used only when the input is an HTTP(S) URL. */
  requestHeaders?: Readonly<Record<string, string>>;
  /** Standard cancellation signal, including an in-progress URL download. */
  signal?: AbortSignal;
}

export interface ExtractedBoletoField<TValue extends string = string> {
  value: TValue;
  rawValue: string;
  precisionScore: number;
  pages: number[];
  sources: BoletoFieldSource[];
}

export interface BoletoPartyInfo {
  name: ExtractedBoletoField | null;
  taxId: ExtractedBoletoField | null;
}

export interface BoletoGeneralInfo {
  institution: ExtractedBoletoField | null;
  beneficiary: BoletoPartyInfo | null;
  finalBeneficiary: BoletoPartyInfo | null;
  payer: BoletoPartyInfo | null;
  dueDate: ExtractedBoletoField | null;
  amount: ExtractedBoletoField | null;
  ourNumber: ExtractedBoletoField | null;
  documentNumber: ExtractedBoletoField | null;
  documentDate: ExtractedBoletoField | null;
}

export interface ExtractedBoleto {
  barcode: string;
  digitableLine: string;
  formattedDigitableLine: string;
  layout: BoletoLayout;
  isValid: true;
  precisionScore: number;
  pages: number[];
  sources: ExtractionSource[];
  occurrences: number;
  components: BoletoComponents;
  generalInfo: BoletoGeneralInfo;
}

export interface ExtractionMetadata {
  performance: PerformanceProfile;
  ocrMode: OcrMode;
  passesRequested: number;
  passesUsed: number;
  pagesTotal: number;
  pagesProcessed: number;
  pagesRendered: number;
  ocrPages: number;
  fileSizeBytes: number;
  maxPixelsPerPage: number;
  maxSourceImagePixels: number;
  durationMs: number;
  complete: boolean;
  confidenceVersion: "1.2.0";
}

export interface ExtractionErrorInfo {
  code: ExtractionErrorCode;
  message: string;
}

export interface ExtractionResult {
  status: ExtractionStatus;
  success: boolean;
  precisionScore: number;
  bestMatch: ExtractedBoleto | null;
  results: ExtractedBoleto[];
  metadata: ExtractionMetadata;
  warnings: string[];
  error: ExtractionErrorInfo | null;
}

export interface BoletoBatchSourceDescriptor {
  input: PdfInput;
  /** Per-source headers prevent credentials from being shared with unrelated URLs. */
  requestHeaders?: Readonly<Record<string, string>>;
}

export type BoletoBatchInput = PdfInput | BoletoBatchSourceDescriptor;

export type BatchExtractOptions = Omit<ExtractOptions, "requestHeaders" | "signal"> & {
  /** Maximum inputs processed concurrently. Defaults to 1 and accepts 1 through 8. */
  concurrency?: number;
  /** Cancels active inputs and prevents pending inputs from starting. */
  signal?: AbortSignal;
};

export interface BatchExtractionItem {
  inputIndex: number;
  result: ExtractionResult;
}

export interface BatchMatchedBoleto {
  inputIndex: number;
  boleto: ExtractedBoleto;
}

export interface BatchExtractionSummary {
  inputsTotal: number;
  inputsSucceeded: number;
  inputsNotFound: number;
  inputsPartial: number;
  inputsFailed: number;
  boletosFound: number;
  concurrency: number;
  durationMs: number;
}

export interface BatchExtractionResult {
  status: ExtractionStatus;
  success: boolean;
  precisionScore: number;
  bestMatch: BatchMatchedBoleto | null;
  results: BatchMatchedBoleto[];
  metadata: ExtractionMetadata;
  items: BatchExtractionItem[];
  summary: BatchExtractionSummary;
  warnings: string[];
  error: ExtractionErrorInfo | null;
}
