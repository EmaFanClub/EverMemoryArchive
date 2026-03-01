import type { LLMClientBase } from "./base";
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

  constructor(readonly config: LLMConfig) {
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
