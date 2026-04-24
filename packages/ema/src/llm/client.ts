import type { LLMClientBase } from "./base";
import type { LLMConfig } from "../config/index";
import { GoogleClient } from "./google_client";
import { OpenAIClient } from "./openai_client";
import type { LLMResponse } from "../shared/schema";
import type { Message } from "../shared/schema";
import type { Tool } from "../tools/base";
import { RetryConfig } from "./retry";

export enum LLMProvider {
  GOOGLE = "google",
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
}

/** Factory that routes calls to the provider-specific LLM client. */
export class LLMClient {
  private readonly client: LLMClientBase;

  constructor(readonly config: LLMConfig) {
    switch (this.config.provider) {
      case LLMProvider.GOOGLE:
        if (!this.config.google.useVertexAi && !this.config.google.apiKey) {
          throw new Error("Google API key is required.");
        }
        this.client = new GoogleClient(this.config.google, new RetryConfig());
        break;
      case LLMProvider.OPENAI:
        if (!this.config.openai.apiKey) {
          throw new Error("OpenAI API key is required.");
        }
        this.client = new OpenAIClient(this.config.openai, new RetryConfig());
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  /**
   * Sets a callback invoked before retrying provider requests.
   * @param callback - Retry callback, or undefined to clear it.
   */
  setRetryCallback(
    callback: ((exception: Error, attempt: number) => void) | undefined,
  ): void {
    this.client.retryCallback = callback;
  }

  /**
   * Proxy a generate request to the selected provider.
   * @param messages Internal message array (EMA schema)
   * @param tools Optional tool definitions (EMA schema)
   * @param systemPrompt Optional system instruction text
   */
  generate(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    return this.client.generate(messages, tools, systemPrompt, signal);
  }
}
