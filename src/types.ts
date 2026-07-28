import type { BoletoComponents, BoletoLayout } from "./validation/boleto";

export type DocumentInput = string | ArrayBuffer | Uint8Array;

export type PdfInput = DocumentInput;

export type DocumentFormat = "pdf" | "jpeg" | "png";

export type PerformanceProfile = "fast" | "balanced" | "accurate";

export type OcrMode = "never" | "fallback" | "always";

export type ExtractionStatus = "success" | "not_found" | "partial" | "error";

export type ExtractionSource = "pdf-text" | "pdf-text-reconstructed" | "itf" | "ocr";

export type BoletoFieldSource = "encoded" | "pdf-text" | "ocr";

export type ExtractionErrorCode = "INVALID_INPUT" | "FILE_NOT_FOUND" | "FILE_TOO_LARGE" | "DOWNLOAD_ERROR" | "INVALID_OPTIONS" | "INVALID_PDF" | "UNSUPPORTED_FORMAT" | "INVALID_IMAGE" | "PASSWORD_REQUIRED" | "TIMEOUT" | "ABORTED" | "RESOURCE_LIMIT" | "PROCESSING_ERROR";

export interface ExtractOptions {
  performance?: PerformanceProfile;
  passes?: number;
  ocr?: OcrMode;
  maxPages?: number;
  maxFileSizeBytes?: number;
  maxPixelsPerPage?: number;
  maxSourceImagePixels?: number;
  timeoutMs?: number;
  stopAfterFirst?: boolean;
  requestHeaders?: Readonly<Record<string, string>>;
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
  inputFormat?: DocumentFormat;
  passesRequested: number;
  passesUsed: number;
  pagesTotal: number;
  pagesProcessed: number;
  pagesRendered: number;
  renderAttempts?: number;
  ocrPages: number;
  fileSizeBytes: number;
  sourceImageWidth?: number;
  sourceImageHeight?: number;
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
  input: DocumentInput;
  requestHeaders?: Readonly<Record<string, string>>;
}

export type BoletoBatchInput = DocumentInput | BoletoBatchSourceDescriptor;

export type BatchExtractOptions = Omit<ExtractOptions, "requestHeaders" | "signal"> & {
  concurrency?: number;
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
