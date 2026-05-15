/** Retry policy applied to provider requests. */
export class RetryConfig {
  /**
   * Creates retry policy settings.
   *
   * @param enabled - Whether retry is enabled.
   * @param maxRetries - Maximum number of retry attempts after the first call.
   * @param initialDelay - Initial retry delay in seconds.
   * @param maxDelay - Maximum retry delay in seconds.
   * @param exponentialBase - Exponential backoff multiplier.
   */
  constructor(
    public readonly enabled: boolean = true,
    public readonly maxRetries: number = 3,
    public readonly initialDelay: number = 1.0,
    public readonly maxDelay: number = 60.0,
    public readonly exponentialBase: number = 2.0,
  ) {}
}

/**
 * Calculates the next retry delay using exponential backoff.
 *
 * @param attempt - Zero-based retry attempt.
 * @param initialDelay - Initial retry delay in seconds.
 * @param exponentialBase - Exponential backoff multiplier.
 * @param maxDelay - Maximum retry delay in seconds.
 * @returns Delay in seconds.
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  exponentialBase: number,
  maxDelay: number,
): number {
  const delay = initialDelay * Math.pow(exponentialBase, attempt);
  return Math.min(delay, maxDelay);
}

/** Error thrown when all retry attempts have been exhausted. */
export class RetryExhaustedError extends Error {
  /**
   * Creates a retry exhaustion error.
   *
   * @param lastException - Last error thrown by the wrapped operation.
   * @param attempts - Total number of attempts performed.
   */
  constructor(
    public readonly lastException: Error,
    public readonly attempts: number,
  ) {
    super(
      `Retry failed after ${attempts} attempts. Last error: ${lastException.message}`,
    );
    this.name = "RetryExhaustedError";
  }
}

/**
 * Checks whether an error represents request cancellation.
 *
 * @param error - Unknown thrown value to inspect.
 * @returns `true` when the error should bypass retry handling.
 */
export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" || error.message.toLowerCase().includes("abort")
  );
}

/**
 * Wraps an async function with retry handling.
 *
 * Abort errors are never retried. Other errors are retried according to the
 * supplied `RetryConfig`.
 *
 * @typeParam T - Async function type to wrap.
 * @param originalMethod - Async function to execute with retry.
 * @param config - Retry policy.
 * @param onRetry - Callback invoked before each retry attempt.
 * @returns A function with the same signature as `originalMethod`.
 */
export function wrapWithRetry<T extends (...args: any[]) => Promise<any>>(
  originalMethod: T,
  config: RetryConfig = new RetryConfig(),
  onRetry?: (exception: Error, attempt: number) => void,
): T {
  if (!config.enabled) {
    return originalMethod;
  }
  if (config.maxRetries <= 0) {
    throw new Error("Max retries must be greater than 0");
  }

  return async function (...args: any[]) {
    let lastException: Error | undefined;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await originalMethod(...args);
      } catch (exception) {
        lastException = exception as Error;
        if (isAbortError(lastException)) {
          throw lastException;
        }
        if (attempt >= config.maxRetries) {
          throw new RetryExhaustedError(lastException, attempt + 1);
        }
        onRetry?.(lastException, attempt + 1);
        const delay = calculateDelay(
          attempt,
          config.initialDelay,
          config.exponentialBase,
          config.maxDelay,
        );
        await new Promise((resolve) => setTimeout(resolve, delay * 1000));
      }
    }
    if (lastException) {
      throw lastException;
    }
    throw new Error("Unknown retry error");
  } as T;
}
