import { validateHeaderName, validateHeaderValue } from "node:http";
import { resolve as resolvePath } from "node:path";

import type { DocumentFormat, ExtractOptions, OcrMode, PerformanceProfile, StreamStorage } from "./types";

const MEBIBYTE = 1024 * 1024;

const BLOCKED_REQUEST_HEADERS = new Set(["accept-encoding", "connection", "content-length", "expect", "host", "if-range", "keep-alive", "proxy-connection", "range", "te", "trailer", "transfer-encoding", "upgrade"]);

/**
 * Keeps a streamed input in memory until it grows large enough to be worth a temporary file.
 *
 * A boleto, whether native PDF or a photograph of one, sits far below this threshold, so the common case never
 * touches the disk while an unexpectedly large upload stops competing with the render surfaces that dominate
 * extraction memory.
 */
export const DEFAULT_STREAM_MEMORY_THRESHOLD_BYTES = 8 * MEBIBYTE;

/**
 * Selects the storage policy applied to stream inputs when the caller does not choose one.
 */
export const DEFAULT_STREAM_STORAGE: StreamStorage = "auto";

interface ProfileDefaults {
  passes: number;
  ocr: OcrMode;
  maxPages: number;
  maxPixelsPerPage: number;
  maxSourceImagePixels: number;
  timeoutMs: number;
}

const PROFILE_DEFAULTS: Record<PerformanceProfile, ProfileDefaults> = {
  fast: {
    passes: 1,
    ocr: "never",
    maxPages: 10,
    maxPixelsPerPage: 8_000_000,
    maxSourceImagePixels: 40_000_000,
    timeoutMs: 30_000,
  },
  balanced: {
    passes: 2,
    ocr: "fallback",
    maxPages: 30,
    maxPixelsPerPage: 12_000_000,
    maxSourceImagePixels: 60_000_000,
    timeoutMs: 120_000,
  },
  accurate: {
    passes: 3,
    ocr: "fallback",
    maxPages: 50,
    maxPixelsPerPage: 20_000_000,
    maxSourceImagePixels: 100_000_000,
    timeoutMs: 300_000,
  },
};

/**
 * Defines the complete extraction settings after defaults and validation are applied.
 */
export interface ResolvedOptions {
  /**
   * Selects the resource and accuracy profile used by the pipeline.
   */
  performance: PerformanceProfile;
  /**
   * Limits the number of rendering recipes attempted per page.
   */
  passes: number;
  /**
   * Controls whether optical character recognition is disabled, conditional, or mandatory.
   */
  ocr: OcrMode;
  /**
   * Limits how many pages may be processed from one document.
   */
  maxPages: number;
  /**
   * Limits the accepted source size in bytes.
   */
  maxFileSizeBytes: number;
  /**
   * Selects where a stream input is held while it is consumed; path, URL, and in-memory inputs ignore it.
   */
  streamStorage: StreamStorage;
  /**
   * Sets the byte count an `auto` stream may hold in memory before migrating to a temporary file.
   */
  streamMemoryThresholdBytes: number;
  /**
   * Stores the resolved directory that receives extractor-owned temporary stream files, when the caller supplied one.
   */
  streamTempDirectory?: string;
  /**
   * Limits the pixel area of each rendered page.
   */
  maxPixelsPerPage: number;
  /**
   * Limits the decoded pixel area of source images.
   */
  maxSourceImagePixels: number;
  /**
   * Sets the extraction deadline in milliseconds, with zero disabling the deadline.
   */
  timeoutMs: number;
  /**
   * Indicates whether processing may stop after the first validated boleto.
   */
  stopAfterFirst: boolean;
  /**
   * Provides normalized HTTP headers for remote document requests.
   */
  requestHeaders?: Readonly<Record<string, string>>;
  /**
   * Provides the caller-controlled cancellation signal.
   */
  signal?: AbortSignal;
}

/**
 * Represents an invalid or unsupported extraction option value.
 *
 * @class
 */
export class InvalidOptionsError extends Error {
  /**
   * Creates an extraction-options validation error.
   *
   * @param {string} message - The validation failure message.
   */
  public constructor(message: string) {
    super(message);
    this.name = "InvalidOptionsError";
  }
}

function integerInRange(name: string, value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new InvalidOptionsError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function normalizeRequestHeaders(requestHeaders: ExtractOptions["requestHeaders"]): Readonly<Record<string, string>> | undefined {
  if (requestHeaders === undefined) {
    return undefined;
  }
  if (typeof requestHeaders !== "object" || requestHeaders === null || Array.isArray(requestHeaders)) {
    throw new InvalidOptionsError("requestHeaders must be a record of strings.");
  }

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(requestHeaders) as object | null;
  } catch {
    throw new InvalidOptionsError("requestHeaders could not be read.");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidOptionsError("requestHeaders must be a record of strings.");
  }

  const normalized = Object.create(null) as Record<string, string>;
  let entries: [string, unknown][];
  try {
    entries = Object.entries(requestHeaders);
  } catch {
    throw new InvalidOptionsError("requestHeaders could not be read.");
  }

  for (const [name, value] of entries) {
    const normalizedName = name.toLowerCase();
    if (typeof value !== "string") {
      throw new InvalidOptionsError("Every requestHeaders value must be a string.");
    }
    try {
      validateHeaderName(name);
      validateHeaderValue(name, value);
    } catch {
      throw new InvalidOptionsError("requestHeaders contains an invalid header.");
    }
    if (BLOCKED_REQUEST_HEADERS.has(normalizedName)) {
      throw new InvalidOptionsError("requestHeaders contains a header that cannot be overridden.");
    }
    if (Object.hasOwn(normalized, normalizedName)) {
      throw new InvalidOptionsError("requestHeaders contains duplicate case-insensitive names.");
    }
    normalized[normalizedName] = value;
  }
  return Object.freeze(normalized);
}

function validateSignal(signal: ExtractOptions["signal"]): void {
  if (signal === undefined) {
    return;
  }
  if (typeof signal !== "object" || signal === null || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function") {
    throw new InvalidOptionsError("signal must be an AbortSignal.");
  }
}

function normalizeTempDirectory(directory: ExtractOptions["streamTempDirectory"]): string | undefined {
  if (directory === undefined) {
    return undefined;
  }
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new InvalidOptionsError("streamTempDirectory must be a non-empty path to an existing directory.");
  }
  return resolvePath(directory);
}

function booleanOrDefault(name: string, value: boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new InvalidOptionsError(`${name} must be a boolean.`);
  }
  return value;
}

/**
 * Resolves extraction options into a validated, fully populated configuration.
 *
 * @param {ExtractOptions} [options={}] - The caller-provided extraction overrides.
 * @returns {ResolvedOptions} The validated options with profile defaults applied.
 * @throws {InvalidOptionsError} If an option is outside its supported range, request headers are unsafe, the cancellation signal is not an AbortSignal, or a flag is not a boolean.
 */
export function resolveOptions(options: ExtractOptions = {}): ResolvedOptions {
  const performance = options.performance ?? "balanced";
  if (!Object.hasOwn(PROFILE_DEFAULTS, performance)) {
    throw new InvalidOptionsError("performance must be fast, balanced, or accurate.");
  }

  const profile = PROFILE_DEFAULTS[performance];
  const ocr = options.ocr ?? profile.ocr;
  if (!["never", "fallback", "always"].includes(ocr)) {
    throw new InvalidOptionsError("ocr must be never, fallback, or always.");
  }

  const streamStorage = options.streamStorage ?? DEFAULT_STREAM_STORAGE;
  if (!["memory", "file", "auto"].includes(streamStorage)) {
    throw new InvalidOptionsError("streamStorage must be memory, file, or auto.");
  }

  const requestHeaders = normalizeRequestHeaders(options.requestHeaders);
  const streamTempDirectory = normalizeTempDirectory(options.streamTempDirectory);
  validateSignal(options.signal);

  return {
    performance,
    passes: integerInRange("passes", options.passes, profile.passes, 1, 5),
    ocr,
    maxPages: integerInRange("maxPages", options.maxPages, profile.maxPages, 1, 10_000),
    maxFileSizeBytes: integerInRange("maxFileSizeBytes", options.maxFileSizeBytes, 30 * MEBIBYTE, 1, 1024 * MEBIBYTE),
    streamStorage,
    streamMemoryThresholdBytes: integerInRange("streamMemoryThresholdBytes", options.streamMemoryThresholdBytes, DEFAULT_STREAM_MEMORY_THRESHOLD_BYTES, 1, 1024 * MEBIBYTE),
    ...(streamTempDirectory === undefined ? {} : { streamTempDirectory }),
    maxPixelsPerPage: integerInRange("maxPixelsPerPage", options.maxPixelsPerPage, profile.maxPixelsPerPage, 250_000, 100_000_000),
    maxSourceImagePixels: integerInRange("maxSourceImagePixels", options.maxSourceImagePixels, profile.maxSourceImagePixels, 250_000, 200_000_000),
    timeoutMs: integerInRange("timeoutMs", options.timeoutMs, profile.timeoutMs, 0, 3_600_000),
    stopAfterFirst: booleanOrDefault("stopAfterFirst", options.stopAfterFirst, false),
    ...(requestHeaders === undefined ? {} : { requestHeaders }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

/**
 * Defines one page-rendering attempt used by barcode recognition or OCR.
 */
export interface RenderRecipe {
  /**
   * Specifies the PDF rendering scale or the neutral image scale.
   */
  scale: number;
  /**
   * Specifies the clockwise rotation applied before recognition.
   */
  rotation: 0 | 90 | 180 | 270;
  /**
   * Indicates whether surrounding low-information pixels should be cropped.
   */
  crop?: boolean;
  /**
   * Indicates whether the rendered pixels should be converted to grayscale.
   */
  grayscale?: boolean;
  /**
   * Indicates whether percentile-based contrast stretching should be attempted.
   */
  contrast?: boolean;
  /**
   * Indicates whether small images may be enlarged for recognition.
   */
  upscale?: boolean;
  /**
   * Specifies the maximum output pixel area targeted by the recipe.
   */
  targetPixels?: number;
}

const RECIPES: Record<PerformanceProfile, readonly RenderRecipe[]> = {
  fast: [
    { scale: 1.25, rotation: 0 },
    { scale: 1.6, rotation: 0 },
    { scale: 2, rotation: 0 },
    { scale: 1.6, rotation: 90 },
    { scale: 1.6, rotation: 270 },
  ],
  balanced: [
    { scale: 1.5, rotation: 0 },
    { scale: 2, rotation: 0 },
    { scale: 2.5, rotation: 0 },
    { scale: 2, rotation: 90 },
    { scale: 2, rotation: 270 },
  ],
  accurate: [
    { scale: 1.75, rotation: 0 },
    { scale: 2.25, rotation: 0 },
    { scale: 3, rotation: 0 },
    { scale: 2.25, rotation: 90 },
    { scale: 2.25, rotation: 270 },
  ],
};

const IMAGE_RECIPES: Record<PerformanceProfile, readonly RenderRecipe[]> = {
  fast: [
    { scale: 1, rotation: 0 },
    { scale: 1, rotation: 0, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 950_000 },
    { scale: 1, rotation: 90, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 950_000 },
    { scale: 1, rotation: 270, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 950_000 },
    { scale: 1, rotation: 180, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 950_000 },
  ],
  balanced: [
    { scale: 1, rotation: 0 },
    { scale: 1, rotation: 0, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 1_450_000 },
    { scale: 1, rotation: 90, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 1_450_000 },
    { scale: 1, rotation: 270, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 1_450_000 },
    { scale: 1, rotation: 180, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 1_450_000 },
  ],
  accurate: [
    { scale: 1, rotation: 0 },
    { scale: 1, rotation: 0, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 2_200_000 },
    { scale: 1, rotation: 90, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 2_200_000 },
    { scale: 1, rotation: 270, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 2_200_000 },
    { scale: 1, rotation: 180, crop: true, grayscale: true, contrast: true, upscale: true, targetPixels: 2_200_000 },
  ],
};

/**
 * Returns the ordered rendering recipes allowed by the selected profile and document format.
 *
 * @param {ResolvedOptions} options - The validated extraction configuration.
 * @param {DocumentFormat} [format="pdf"] - The source format that determines the recipe family.
 * @returns {Array<RenderRecipe>} A new array capped to the configured number of passes.
 */
export function getRenderRecipes(options: ResolvedOptions, format: DocumentFormat = "pdf"): RenderRecipe[] {
  const recipes = format === "pdf" ? RECIPES[options.performance] : IMAGE_RECIPES[options.performance];
  return recipes.slice(0, options.passes);
}
