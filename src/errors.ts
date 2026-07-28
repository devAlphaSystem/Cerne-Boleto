import type { ExtractionErrorCode } from "./types";

/**
 * Represents a categorized failure that can be exposed through an extraction result.
 *
 * @class
 */
export class ExtractionFailure extends Error {
  /**
   * Identifies the stable machine-readable failure category.
   */
  public readonly code: ExtractionErrorCode;

  /**
   * Creates a categorized extraction failure while preserving an optional underlying cause.
   *
   * @param {ExtractionErrorCode} code - The stable failure category.
   * @param {string} message - The human-readable failure message.
   * @param {ErrorOptions} [options] - Native error options such as the underlying cause.
   */
  public constructor(code: ExtractionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExtractionFailure";
    this.code = code;
  }
}

/**
 * Returns an error message suitable for diagnostics without assuming the thrown value is an `Error`.
 *
 * @param {unknown} error - The caught value to describe.
 * @returns {string} The native error message or a stable fallback for non-error values.
 */
export function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown processing error.";
}
