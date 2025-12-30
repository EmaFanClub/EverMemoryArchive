import type { LLMClientBase } from "./base";
import { LLMConfig } from "../config";
import { GoogleClient } from "./google_client";
import { OpenAIClient } from "./openai_client";
import type { LLMResponse } from "../schema";

export enum LLMProvider {
  GOOGLE = "google",
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
}

/** Factory that routes calls to the provider-specific LLM client. */
export class LLMClient {
  private readonly client: LLMClientBase;

  constructor(readonly config: LLMConfig) {
    if (!this.config.apiKey) {
      throw new Error("LLM API key is required.");
    }
    if (!this.config.provider) {
      throw new Error("Missing LLM provider.");
    }
    switch (this.config.provider) {
      case LLMProvider.GOOGLE:
        this.client = new GoogleClient(this.config);
        break;
      case LLMProvider.OPENAI:
        this.client = new OpenAIClient(this.config);
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  /**
   * Proxy a generate request to the selected provider.
   * @param messages Internal message array (EMA schema)
   * @param tools Optional tool definitions (EMA schema)
   * @param systemPrompt Optional system instruction text
   */
  generate(
    messages: any,
    tools?: any,
    systemPrompt?: string,
  ): Promise<LLMResponse> {
    return this.client.generate(messages, tools, systemPrompt);
  }
}
