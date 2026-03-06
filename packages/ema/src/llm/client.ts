import { MessageHistory } from "./base";
import type { LLMClientBase } from "./base";
import { isAbortError, RetryConfig, RetryExhaustedError } from "./base";
import { LLMConfig } from "../config";
import { GoogleClient } from "./google_client";
import { OpenAIClient } from "./openai_client";
import type { LLMResponse } from "../schema";
import type { Message } from "../schema";
import type { Tool } from "../tools/base";

export enum LLMProvider {
  GOOGLE = "google",
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
}

/** Factory that routes calls to the provider-specific LLM client. */
export class LLMClient {
  private readonly client: LLMClientBase;

  constructor(private readonly config: LLMConfig) {
    if (!this.config.chat_provider) {
      throw new Error("Missing LLM provider.");
    }
    switch (this.config.chat_provider) {
      case LLMProvider.GOOGLE:
        if (!this.config.google.key) {
          throw new Error("Google API key is required.");
        }
        this.client = new GoogleClient(
          this.config.chat_model,
          this.config.google,
          this.config.retry,
        );
        break;
      case LLMProvider.OPENAI:
        if (!this.config.openai.key) {
          throw new Error("OpenAI API key is required.");
        }
        this.client = new OpenAIClient(
          this.config.chat_model,
          this.config.openai,
          this.config.retry,
        );
        break;
      default:
        throw new Error(
          `Unsupported LLM provider: ${this.config.chat_provider}`,
        );
    }
  }

  /**
   * Builds a message history.
   */
  createHistory(): MessageHistory {
    return new MessageHistory(this.client);
  }

  /**
   * Builds a generator request handler.
   * @param tools Optional tool definitions (EMA schema)
   * @param systemPrompt Optional system instruction text
   */
  buildHandler(tools?: Tool[], systemPrompt?: string) {
    const client = this.client;
    const apiTools = tools ? client.adaptTools(tools) : undefined;

    const handler = withRetry(
      client.makeApiRequest.bind(client),
      this.config.retry,
      client.retryCallback,
    );
    return {
      /**
       * Proxies a generate request to the selected provider.
       * @param messages Internal message array (schema compatible with the selected provider)
       * @param signal Optional abort signal
       */
      generate(
        messages: MessageHistory,
        signal?: AbortSignal,
      ): Promise<LLMResponse> {
        return handler(messages, apiTools, systemPrompt, signal);
      },
    };
  }
}

/**
 * Wrap a standalone async function with retry logic (non-decorator usage).
 * Useful when you want a callable instead of applying a class method decorator.
 *
 * WARN: the function `fn` must not modify arguments, otherwise the retry logic will not work as expected.
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  /**
   * Retry configuration
   */
  config: RetryConfig = new RetryConfig(),
  /**
   * Callback function on retry, receives exception and current attempt number
   */
  onRetry?: (exception: Error, attempt: number) => void,
): T {
  return async function (...args: any[]) {
    if (config.max_retries <= 0) {
      throw new Error("Max retries must be greater than 0");
    }
    if (!config.enabled) {
      return await fn(...args);
    }

    let lastException: Error | undefined;
    for (let attempt = 0; attempt <= config.max_retries; attempt++) {
      try {
        return await fn(...args);
      } catch (exception) {
        lastException = exception as Error;
        if (isAbortError(lastException)) {
          throw lastException;
        }
        if (attempt >= config.max_retries) {
          console.error(
            `Function retry failed, reached maximum retry count ${config.max_retries}`,
          );
          throw new RetryExhaustedError(lastException, attempt + 1);
        }
        // Calculates delay time (exponential backoff)
        const delay = Math.min(
          config.initial_delay * Math.pow(config.exponential_base, attempt),
          config.max_delay,
        );
        console.warn(
          `Function call ${attempt + 1} failed: ${lastException.message}, retrying attempt ${attempt + 2} after ${delay.toFixed(2)} seconds`,
        );
        // Calls callback function
        if (onRetry) {
          onRetry(lastException, attempt + 1);
        }
        // Waits before retry
        await new Promise((resolve) => setTimeout(resolve, delay * 1000));
      }
    }
    if (lastException) {
      throw lastException;
    }
    throw new Error("Unknown error");
  } as T;
}
