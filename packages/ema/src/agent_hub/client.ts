import type { LLMClientBase, LLMGenerateOptions } from "./base";
import { AgentHubClient } from "./agenthub_client";
import type { LLMConfig } from "./base";
import { resolveLLMModelConfig } from "./models";
import { RetryConfig } from "./retry";
import type { ModelMessage } from "./schema";

/**
 * Facade for EMA's AgentHub-backed LLM layer.
 *
 * The facade accepts EMA request/config schemas and delegates provider-specific
 * behavior to the concrete internal client.
 */
export class LLMClient {
  private readonly client: LLMClientBase<unknown, unknown, unknown>;

  /**
   * Creates an LLM client from user-facing configuration.
   *
   * @param config - User-provided model and endpoint configuration.
   * @param retryConfig - Retry settings applied to provider requests.
   */
  constructor(
    readonly config: LLMConfig,
    retryConfig: RetryConfig = new RetryConfig(),
  ) {
    this.client = new AgentHubClient(
      resolveLLMModelConfig(config),
      retryConfig,
    );
  }

  /**
   * Sets the callback invoked before retrying provider requests.
   *
   * @param callback - Retry callback, or `undefined` to clear it.
   */
  setRetryCallback(
    callback: ((exception: Error, attempt: number) => void) | undefined,
  ): void {
    this.client.setRetryCallback(callback);
  }

  /**
   * Proxies a generation request to the resolved client.
   *
   * @param options - EMA request options for this model turn.
   * @returns Normalized assistant message.
   */
  generate(options: LLMGenerateOptions): Promise<ModelMessage> {
    return this.client.generate(options);
  }
}
