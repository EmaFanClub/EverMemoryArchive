/** Base class for LLM clients.
 * This class defines the interface that all LLM clients must implement,
 * regardless of the underlying API protocol (Anthropic, OpenAI, etc.).
 */

import type { Tool } from "../tools/base";
import type {
  Message,
  LLMResponse,
  FunctionResponse,
  Content,
} from "../schema";

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
    // public readonly retryable_exceptions: Array<typeof Error> = [Error],
  ) {}
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "AbortError") {
    return true;
  }
  return error.message.toLowerCase().includes("abort");
}

/**
 * Abstract base class for LLM clients.
 *
 * This class defines the interface that all LLM clients must implement,
 * regardless of the underlying API protocol (Anthropic, OpenAI, etc.).
 */
export abstract class LLMClientBase<M = any> {
  retryCallback: ((exception: Error, attempt: number) => void) | undefined =
    undefined;

  abstract adaptTools(tools: Tool[]): any[];

  abstract appendMessage(history: M[], message: Message): M[];

  abstract makeApiRequest(
    history: MessageHistory<M>,
    apiTools?: any[],
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<LLMResponse>;
}

/**
 * Holds the messages for the specific LLM provider.
 */
export class MessageHistory<M = any> {
  messages: Message[] = [];
  private apiMessages: M[] = [];

  constructor(private readonly client: LLMClientBase<M>) {}

  getApiMessagesForClient(client: LLMClientBase<M>): M[] {
    if (client !== this.client) {
      // this ensures that we always give correct message format to the client
      throw new Error(
        `Client mismatch: converted to ${this.client.constructor.name} while expected ${client.constructor.name}`,
      );
    }
    return this.apiMessages;
  }

  /** Adds a user message to context. */
  addUserMessage(contents: Content[]): void {
    this.appendMessage({ role: "user", contents: contents });
  }

  /** Adds an model message to context. */
  addModelMessage(response: LLMResponse): void {
    this.appendMessage(response.message);
  }

  /** Adds a tool result message to context. */
  addToolMessage(contents: FunctionResponse[]): void {
    this.appendMessage({ role: "user", contents: contents });
  }

  appendMessage(message: Message): this {
    this.messages.push(message);
    this.apiMessages = this.client.appendMessage(this.apiMessages, message);
    return this;
  }
}
