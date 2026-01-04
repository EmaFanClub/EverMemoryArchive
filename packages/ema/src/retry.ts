/**
 * Elegant retry mechanism module
 *
 * Provides decorators and utility functions to support retry logic for async functions.
 *
 * Features:
 * - Supports exponential backoff strategy
 * - Configurable retry count and intervals
 * - Supports specifying retryable exception types
 * - Detailed logging
 * - Fully decoupled, non-invasive to business code
 */
export class RetryConfig {
  constructor(
    /**
     * Whether to enable retry mechanism
     */
    public readonly enabled: boolean = true,
    /**
     * Maximum number of retries
     */
    public readonly max_retries: number = 3,
    /**
     * Initial delay time (seconds)
     */
    public readonly initial_delay: number = 1.0,
    /**
     * Maximum delay time (seconds)
     */
    public readonly max_delay: number = 60.0,
    /**
     * Exponential backoff base
     */
    public readonly exponential_base: number = 2.0,
    /**
     * Retryable exception types
     */
    public readonly retryable_exceptions: Array<typeof Error> = [Error],
  ) {}

  /**
   * Calculate delay time (exponential backoff)
   *
   * @param attempt - Current attempt number (starting from 0)
   * @returns Delay time (seconds)
   */
  public calculateDelay(attempt: number): number {
    const delay = this.initial_delay * Math.pow(this.exponential_base, attempt);
    return Math.min(delay, this.max_delay);
  }
}

export class RetryExhaustedError extends Error {
  public lastException: Error;
  public attempts: number;

  constructor(lastException: Error, attempts: number) {
    super(
      `Retry failed after ${attempts} attempts. Last error: ${lastException.message}`,
    );
    this.name = "RetryExhaustedError";
    this.lastException = lastException;
    this.attempts = attempts;
  }
}

/**
 * Async function retry decorator.
 */
export function asyncRetry(
  /**
   * Retry configuration
   */
  config: RetryConfig = new RetryConfig(),
  /**
   * Callback function on retry, receives exception and current attempt number
   */
  onRetry?: (exception: Error, attempt: number) => void,
): (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) => PropertyDescriptor {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      let lastException: Error | undefined;
      for (let attempt = 0; attempt <= config.max_retries; attempt++) {
        try {
          return await originalMethod.apply(this, args);
        } catch (exception) {
          lastException = exception as Error;
          if (attempt >= config.max_retries) {
            console.error(
              `Function ${propertyKey} retry failed, reached maximum retry count ${config.max_retries}`,
            );
            throw new RetryExhaustedError(lastException, attempt + 1);
          }
          const delay = config.calculateDelay(attempt);
          console.warn(
            `Function ${propertyKey} call ${attempt + 1} failed: ${lastException.message}, retrying attempt ${attempt + 2} after ${delay.toFixed(2)} seconds`,
          );
          // Call callback function
          if (onRetry) {
            onRetry(lastException, attempt + 1);
          }
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
        }
      }
      if (lastException) {
        throw lastException;
      }
      throw new Error("Unknown error");
    };
    return descriptor;
  };
}

/**
 * Wrap a standalone async function with retry logic (non-decorator usage).
 * Useful when you want a callable instead of applying a class method decorator.
 */
export function wrapWithRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: RetryConfig = new RetryConfig(),
  onRetry?: (exception: Error, attempt: number) => void,
): T {
  const decorator = asyncRetry(config, onRetry);
  const descriptor: PropertyDescriptor = { value: fn };
  const wrappedDescriptor = decorator({}, "wrapped", descriptor) ?? descriptor;
  return (wrappedDescriptor.value ?? fn) as T;
}
