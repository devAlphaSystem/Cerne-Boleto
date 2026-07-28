import { ExtractionFailure } from "./errors";
import type { ResolvedOptions } from "./options";
import { elapsedMilliseconds, startTimer, type MonotonicTimestamp } from "./timing";

/**
 * Converts an aborted signal into the categorized failure that stopped the work.
 *
 * A deadline reached inside {@link WorkGuard} is re-derived by the caller's own `check`, so this helper only
 * needs to report the generic cancellation unless the reason already carries a category.
 *
 * @param {AbortSignal} [signal] - The signal to inspect, which may be absent.
 * @returns {ExtractionFailure|null} The failure to raise, or `null` when the signal is absent or still active.
 */
export function failureFromSignal(signal: AbortSignal | undefined): ExtractionFailure | null {
  if (signal?.aborted !== true) {
    return null;
  }
  return signal.reason instanceof ExtractionFailure ? signal.reason : new ExtractionFailure("ABORTED", "Extraction was aborted.", { cause: signal.reason });
}

/**
 * Coordinates extraction deadlines and caller-requested cancellation through a shared abort signal.
 *
 * @class
 */
export class WorkGuard {
  readonly #startedAt: MonotonicTimestamp;
  readonly #options: ResolvedOptions;
  readonly #controller = new AbortController();
  readonly #abortListener?: () => void;
  readonly #timeout?: NodeJS.Timeout;
  #stopReason: "aborted" | "timeout" | null = null;

  /**
   * Creates a guard for one extraction run.
   *
   * @param {ResolvedOptions} options - The resolved timeout and cancellation settings.
   * @param {MonotonicTimestamp} [startedAt=startTimer()] - The run's monotonic start timestamp.
   */
  public constructor(options: ResolvedOptions, startedAt = startTimer()) {
    this.#options = options;
    this.#startedAt = startedAt;

    if (options.signal?.aborted === true) {
      this.#stop("aborted");
    } else if (options.signal !== undefined) {
      this.#abortListener = (): void => {
        this.#stop("aborted");
      };
      options.signal.addEventListener("abort", this.#abortListener, { once: true });
    }

    if (options.timeoutMs > 0 && this.#stopReason === null) {
      const elapsed = elapsedMilliseconds(this.#startedAt);
      this.#timeout = setTimeout(
        () => {
          this.#stop("timeout");
        },
        Math.max(0, options.timeoutMs - elapsed),
      );
      this.#timeout.unref();
    }
  }

  public get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /**
   * Verifies that the extraction may continue before an expensive unit of work begins.
   *
   * @throws {ExtractionFailure} If the caller aborted the run or its configured deadline expired.
   */
  public check(): void {
    if (this.#options.signal?.aborted === true || this.#stopReason === "aborted") {
      this.#stop("aborted");
      throw new ExtractionFailure("ABORTED", "Extraction was aborted.");
    }
    if (this.#stopReason === "timeout" || (this.#options.timeoutMs > 0 && elapsedMilliseconds(this.#startedAt) >= this.#options.timeoutMs)) {
      this.#stop("timeout");
      throw new ExtractionFailure("TIMEOUT", "Extraction exceeded its configured deadline.");
    }
  }

  /**
   * Releases the timeout and external abort listener owned by the guard.
   */
  public dispose(): void {
    if (this.#timeout !== undefined) {
      clearTimeout(this.#timeout);
    }
    if (this.#abortListener !== undefined && this.#options.signal !== undefined) {
      this.#options.signal.removeEventListener("abort", this.#abortListener);
    }
  }

  #stop(reason: "aborted" | "timeout"): void {
    if (this.#stopReason !== null) {
      return;
    }
    this.#stopReason = reason;
    this.#controller.abort();
  }
}
