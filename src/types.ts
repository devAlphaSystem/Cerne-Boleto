import type { BoletoComponents, BoletoLayout } from "./validation/boleto";

/**
 * Represents a local path, HTTP(S) URL, or in-memory byte source accepted for document extraction.
 *
 * @since 0.2.0
 */
export type DocumentInput = string | ArrayBuffer | Uint8Array;

/**
 * Represents a document input through the PDF-oriented public alias.
 *
 * @since 0.1.0
 */
export type PdfInput = DocumentInput;

/**
 * Identifies a document format supported by the extraction pipeline.
 *
 * @since 0.2.0
 */
export type DocumentFormat = "pdf" | "jpeg" | "png";

/**
 * Selects the resource and accuracy trade-off used during extraction.
 *
 * @since 0.1.0
 */
export type PerformanceProfile = "fast" | "balanced" | "accurate";

/**
 * Controls when optical character recognition participates in extraction.
 *
 * @since 0.1.0
 */
export type OcrMode = "never" | "fallback" | "always";

/**
 * Identifies the overall outcome of a single or batch extraction operation.
 *
 * @since 0.1.0
 */
export type ExtractionStatus = "success" | "not_found" | "partial" | "error";

/**
 * Identifies the channel that produced encoded boleto evidence.
 *
 * @since 0.1.0
 */
export type ExtractionSource = "pdf-text" | "pdf-text-reconstructed" | "itf" | "ocr";

/**
 * Identifies the channel that supplied a descriptive boleto field.
 *
 * @since 0.1.0
 */
export type BoletoFieldSource = "encoded" | "pdf-text" | "ocr";

/**
 * Identifies a stable failure category reported by the extraction API.
 *
 * @since 0.1.0
 */
export type ExtractionErrorCode = "INVALID_INPUT" | "FILE_NOT_FOUND" | "FILE_TOO_LARGE" | "DOWNLOAD_ERROR" | "INVALID_OPTIONS" | "INVALID_PDF" | "UNSUPPORTED_FORMAT" | "INVALID_IMAGE" | "PASSWORD_REQUIRED" | "TIMEOUT" | "ABORTED" | "RESOURCE_LIMIT" | "PROCESSING_ERROR";

/**
 * Configures document loading, rendering, recognition, and early termination for one extraction.
 *
 * @since 0.1.0
 */
export interface ExtractOptions {
  /** Selects the performance profile whose defaults apply when individual limits are omitted. */
  performance?: PerformanceProfile;
  /** Sets the maximum number of render recipes used per page, from 1 through 5. */
  passes?: number;
  /** Controls whether OCR is disabled, used as a fallback, or always attempted. */
  ocr?: OcrMode;
  /** Limits the number of document pages processed, from 1 through 10,000. */
  maxPages?: number;
  /** Limits the accepted source size in bytes, including downloaded content. */
  maxFileSizeBytes?: number;
  /** Limits the pixel area allocated for each rendered page. */
  maxPixelsPerPage?: number;
  /** Limits the declared pixel area of a source image before it is decoded. */
  maxSourceImagePixels?: number;
  /** Sets the extraction deadline in milliseconds, where zero disables the deadline. */
  timeoutMs?: number;
  /** Stops remaining passes and pages after the first valid boleto evidence is found. */
  stopAfterFirst?: boolean;
  /** Supplies caller-controlled headers for an HTTP(S) source after safety validation. */
  requestHeaders?: Readonly<Record<string, string>>;
  /** Aborts document loading and processing when the signal is triggered. */
  signal?: AbortSignal;
}

/**
 * Represents a resolved boleto field together with its source evidence and confidence.
 *
 * @template {string} TValue - Specifies the normalized string type stored in the field.
 * @since 0.1.0
 */
export interface ExtractedBoletoField<TValue extends string = string> {
  /** Contains the normalized value selected for the field. */
  value: TValue;
  /** Preserves the source representation associated with the selected value. */
  rawValue: string;
  /** Reports the normalized confidence score from zero through one. */
  precisionScore: number;
  /** Lists the 1-based document pages that support the selected value. */
  pages: number[];
  /** Lists the distinct extraction channels that support the selected value. */
  sources: BoletoFieldSource[];
}

/**
 * Groups the resolved identity fields for a boleto party.
 *
 * @since 0.1.0
 */
export interface BoletoPartyInfo {
  /** Contains the resolved party name, or `null` when no reliable name was found. */
  name: ExtractedBoletoField | null;
  /** Contains the resolved CPF or CNPJ, or `null` when no reliable identifier was found. */
  taxId: ExtractedBoletoField | null;
}

/**
 * Collects descriptive fields read from visible content or authoritative encoded data.
 *
 * @since 0.1.0
 */
export interface BoletoGeneralInfo {
  /** Contains the issuing institution resolved from encoded or visible evidence. */
  institution: ExtractedBoletoField | null;
  /** Contains the primary beneficiary identity when reliable evidence is available. */
  beneficiary: BoletoPartyInfo | null;
  /** Contains the final beneficiary identity when reliable evidence is available. */
  finalBeneficiary: BoletoPartyInfo | null;
  /** Contains the payer identity when reliable evidence is available. */
  payer: BoletoPartyInfo | null;
  /** Contains the due date in `YYYY-MM-DD` form when it can be resolved. */
  dueDate: ExtractedBoletoField | null;
  /** Contains the decimal monetary amount without a currency symbol when it can be resolved. */
  amount: ExtractedBoletoField | null;
  /** Contains the visible "nosso número" identifier when it can be resolved. */
  ourNumber: ExtractedBoletoField | null;
  /** Contains the visible document or invoice identifier when it can be resolved. */
  documentNumber: ExtractedBoletoField | null;
  /** Contains the document issue date in `YYYY-MM-DD` form when it can be resolved. */
  documentDate: ExtractedBoletoField | null;
}

/**
 * Represents one validated boleto consolidated from all matching document evidence.
 *
 * @since 0.1.0
 */
export interface ExtractedBoleto {
  /** Contains the canonical 44-digit barcode representation. */
  barcode: string;
  /** Contains the canonical unformatted 47- or 48-digit line representation. */
  digitableLine: string;
  /** Contains the canonical human-readable line representation. */
  formattedDigitableLine: string;
  /** Identifies the cobrança or arrecadação layout. */
  layout: BoletoLayout;
  /** Confirms that all supported structural, semantic, and check-digit rules passed. */
  isValid: true;
  /** Reports the consolidated confidence score from zero through one. */
  precisionScore: number;
  /** Lists the 1-based pages containing evidence for the boleto. */
  pages: number[];
  /** Lists the distinct channels that produced matching encoded evidence. */
  sources: ExtractionSource[];
  /** Counts evidence occurrences after spatial deduplication within each page-and-source group. */
  occurrences: number;
  /** Contains structured boleto fields parsed from the code and reconciled with reliable visible date evidence. */
  components: BoletoComponents;
  /** Contains descriptive fields consolidated from encoded and visible evidence. */
  generalInfo: BoletoGeneralInfo;
}

/**
 * Describes the resolved configuration, resource usage, and completeness of an extraction.
 *
 * @since 0.1.0
 */
export interface ExtractionMetadata {
  /** Identifies the resolved performance profile. */
  performance: PerformanceProfile;
  /** Identifies the resolved OCR mode. */
  ocrMode: OcrMode;
  /** Identifies the detected input format after the source is loaded. */
  inputFormat?: DocumentFormat;
  /** Reports the maximum number of render passes requested per page. */
  passesRequested: number;
  /** Reports the highest render pass attempted during extraction. */
  passesUsed: number;
  /** Reports the total page count declared by the document. */
  pagesTotal: number;
  /** Reports the number of pages whose native text stage was processed. */
  pagesProcessed: number;
  /** Reports the number of distinct pages rendered for barcode or OCR analysis. */
  pagesRendered: number;
  /** Reports the number of recognition attempts that used a rendered page surface. */
  renderAttempts?: number;
  /** Reports the number of distinct pages submitted to OCR. */
  ocrPages: number;
  /** Reports the number of bytes in the loaded source. */
  fileSizeBytes: number;
  /** Reports the decoded source-image width in pixels for JPEG and PNG inputs. */
  sourceImageWidth?: number;
  /** Reports the decoded source-image height in pixels for JPEG and PNG inputs. */
  sourceImageHeight?: number;
  /** Reports the resolved pixel-area limit for each rendered page. */
  maxPixelsPerPage: number;
  /** Reports the resolved pixel-area limit for a source image. */
  maxSourceImagePixels: number;
  /** Reports total elapsed extraction time in milliseconds. */
  durationMs: number;
  /** Indicates whether extraction completed under its termination policy without an error or `maxPages` truncation. */
  complete: boolean;
  /** Identifies the scoring-contract version used for confidence values. */
  confidenceVersion: "1.2.0";
}

/**
 * Represents a structured extraction failure safe to return to callers.
 *
 * @since 0.1.0
 */
export interface ExtractionErrorInfo {
  /** Identifies the stable failure category. */
  code: ExtractionErrorCode;
  /** Explains the failure without exposing the original exception object. */
  message: string;
}

/**
 * Represents the complete outcome of extracting boletos from one document source.
 *
 * @since 0.1.0
 */
export interface ExtractionResult {
  /** Identifies whether extraction succeeded, found nothing, completed partially, or failed. */
  status: ExtractionStatus;
  /** Indicates whether at least one validated boleto is present in `results`. */
  success: boolean;
  /** Reports the lowest confidence score among returned boletos, or zero when none were found. */
  precisionScore: number;
  /** Contains the highest-ranked boleto, or `null` when none were found. */
  bestMatch: ExtractedBoleto | null;
  /** Lists validated boletos in descending confidence order with deterministic tie-breaking. */
  results: ExtractedBoleto[];
  /** Describes resolved options, work performed, limits, and elapsed time. */
  metadata: ExtractionMetadata;
  /** Lists non-fatal conditions and evidence conflicts observed during extraction. */
  warnings: string[];
  /** Contains the terminal processing failure when one occurred, otherwise `null`. */
  error: ExtractionErrorInfo | null;
}

/**
 * Associates one batch document source with headers used only for that source.
 *
 * @since 0.1.0
 */
export interface BoletoBatchSourceDescriptor {
  /** Contains the local path, HTTP(S) URL, or in-memory bytes to extract. */
  input: DocumentInput;
  /** Supplies caller-controlled headers when `input` is an HTTP(S) URL. */
  requestHeaders?: Readonly<Record<string, string>>;
}

/**
 * Represents either a bare document input or a source descriptor with per-input controls.
 *
 * @since 0.1.0
 */
export type BoletoBatchInput = DocumentInput | BoletoBatchSourceDescriptor;

/**
 * Configures bounded concurrent extraction for a non-empty batch of document sources.
 *
 * @since 0.1.0
 */
export type BatchExtractOptions = Omit<ExtractOptions, "requestHeaders" | "signal"> & {
  /** Limits concurrent source extractions from 1 through 8. */
  concurrency?: number;
  /** Stops scheduling new inputs and aborts active extraction when triggered. */
  signal?: AbortSignal;
};

/**
 * Associates a single-document extraction result with its original batch position.
 *
 * @since 0.1.0
 */
export interface BatchExtractionItem {
  /** Identifies the source's zero-based position in the input array. */
  inputIndex: number;
  /** Contains the complete extraction result for that source. */
  result: ExtractionResult;
}

/**
 * Associates one validated boleto with the batch source that produced it.
 *
 * @since 0.1.0
 */
export interface BatchMatchedBoleto {
  /** Identifies the source's zero-based position in the input array. */
  inputIndex: number;
  /** Contains the validated boleto extracted from that source. */
  boleto: ExtractedBoleto;
}

/**
 * Summarizes source outcomes, matched boletos, concurrency, and elapsed batch time.
 *
 * @since 0.1.0
 */
export interface BatchExtractionSummary {
  /** Reports the number of sources supplied to the batch. */
  inputsTotal: number;
  /** Reports the number of sources whose extraction status is `success`. */
  inputsSucceeded: number;
  /** Reports the number of sources that completed without finding a boleto. */
  inputsNotFound: number;
  /** Reports the number of sources whose extraction status is `partial`. */
  inputsPartial: number;
  /** Reports the number of sources counted as failed, including every input when batch validation fails. */
  inputsFailed: number;
  /** Reports the total number of validated boletos across all sources. */
  boletosFound: number;
  /** Reports the resolved concurrency limit for the batch. */
  concurrency: number;
  /** Reports total elapsed batch time in milliseconds. */
  durationMs: number;
}

/**
 * Represents the aggregate outcome and per-source details for a batch extraction.
 *
 * @since 0.1.0
 */
export interface BatchExtractionResult {
  /** Identifies the aggregate success, not-found, partial, or error outcome. */
  status: ExtractionStatus;
  /** Indicates whether at least one validated boleto is present in `results`. */
  success: boolean;
  /** Reports the lowest confidence score among matched boletos, or zero when none were found. */
  precisionScore: number;
  /** Contains the highest-ranked boleto and its source index, or `null` when none were found. */
  bestMatch: BatchMatchedBoleto | null;
  /** Lists every matched boleto grouped by source order and ranked within each source. */
  results: BatchMatchedBoleto[];
  /** Aggregates resource usage and completion state across processed sources. */
  metadata: ExtractionMetadata;
  /** Lists processed source results in input order, or an empty array when batch validation prevents processing. */
  items: BatchExtractionItem[];
  /** Summarizes source outcomes, total matches, concurrency, and elapsed time. */
  summary: BatchExtractionSummary;
  /** Lists per-source warnings prefixed with their zero-based input index. */
  warnings: string[];
  /** Contains a batch-level error or the first per-source error, otherwise `null`. */
  error: ExtractionErrorInfo | null;
}
