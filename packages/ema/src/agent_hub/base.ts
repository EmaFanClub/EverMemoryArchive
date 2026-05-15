import type {
  PromptCaching as AgentHubPromptCaching,
  ThinkingLevel as AgentHubThinkingLevel,
} from "@prismshadow/agenthub";

import type { Message, ModelMessage, ToolDefinition } from "./schema";
import { RetryConfig, wrapWithRetry } from "./retry";

export type ThinkingLevel = AgentHubThinkingLevel;
export const ThinkingLevel = {
  NONE: "none" as ThinkingLevel,
  LOW: "low" as ThinkingLevel,
  MEDIUM: "medium" as ThinkingLevel,
  HIGH: "high" as ThinkingLevel,
} as const;

export type PromptCaching = AgentHubPromptCaching;
export const PromptCaching = {
  ENABLE: "enable" as PromptCaching,
  DISABLE: "disable" as PromptCaching,
  ENHANCE: "enhance" as PromptCaching,
} as const;

/**
 * User-provided configuration used to create an LLM client.
 *
 * This is intentionally small: caller input identifies the model and provides
 * complete endpoint credentials prepared by the upper configuration layer.
 */
export interface LLMConfig {
  /** User-facing model identifier, such as `gpt-5.5` or `kimi-k2.5`. */
  model: string;
  /** Provider credential passed through to AgentHub's concrete client. */
  apiKey: string;
  /** Provider-compatible base URL for the selected endpoint. */
  baseUrl: string;
  /** Requested reasoning level when the selected model supports it. */
  thinkingLevel?: ThinkingLevel;
}

/**
 * Capabilities supported by one registered model.
 *
 * These flags describe the EMA-facing feature surface. Provider-specific
 * details remain inside the AgentHub adapter.
 */
export interface LLMModelCapabilities {
  /** Reasoning levels accepted for this model. */
  thinkingLevels: readonly ThinkingLevel[];
  /** Whether tool definitions can be sent with a request. */
  tools: boolean;
  /** Whether image content can be sent as model input. */
  images: boolean;
}

/**
 * Default request settings applied after a model has been resolved.
 *
 * These values map to AgentHub `UniConfig` fields during request adaptation.
 */
export interface LLMRequestDefaults {
  /** Default reasoning level for the model. */
  thinkingLevel?: ThinkingLevel;
  /** Whether to request a concise thinking summary when supported. */
  thinkingSummary?: boolean;
  /** Prompt caching mode to pass through to AgentHub. */
  promptCaching?: PromptCaching;
  /** Default sampling temperature for models that allow it. */
  temperature?: number;
  /** Default maximum output token count. */
  maxTokens?: number;
}

/**
 * Runtime model configuration produced from `LLMConfig`.
 *
 * This is the configuration consumed by concrete clients. It includes the
 * AgentHub routing hint and validated request defaults.
 */
export interface LLMModelConfig {
  /** User-facing model identifier selected by the caller. */
  model: string;
  /** Provider credential passed through to the concrete client. */
  apiKey: string;
  /** Provider-compatible base URL resolved by the upper configuration layer. */
  baseUrl: string;
  /** AgentHub routing hint passed to AutoLLMClient. */
  clientType: string;
  /** Feature capabilities for this model. */
  capabilities: LLMModelCapabilities;
  /** Validated default settings for generation requests. */
  requestDefaults: LLMRequestDefaults;
}

/**
 * Per-call generation options accepted by EMA's LLM facade.
 *
 * Request-scoped values such as `traceId` belong here instead of `LLMConfig`.
 */
export interface LLMGenerateOptions {
  /** Ordered EMA messages to send to the model. */
  messages: Message[];
  /** Optional tool definitions available during this turn. */
  tools?: ToolDefinition[];
  /** Optional system instruction for this request. */
  systemPrompt?: string;
  /** Optional request trace id forwarded to AgentHub tracing. */
  traceId?: string;
  /** Optional abort signal for cancellation-aware adapters. */
  signal?: AbortSignal;
}

/**
 * Contract for translating between EMA schema and a concrete SDK schema.
 *
 * @typeParam TSDKMessage - Message shape accepted by the target SDK.
 * @typeParam TSDKTool - Tool shape accepted by the target SDK.
 * @typeParam TSDKResponse - Response shape returned by the target SDK.
 */
export interface SchemaAdapter<TSDKMessage, TSDKTool, TSDKResponse> {
  /** Converts an EMA message to the SDK request shape. */
  adaptMessageToSDK(message: Message): TSDKMessage;
  /** Converts an EMA tool definition to the SDK request shape. */
  adaptToolToSDK(tool: ToolDefinition): TSDKTool;
  /** Converts an SDK response back to EMA's normalized assistant message. */
  adaptResponseFromSDK(response: TSDKResponse): ModelMessage;
}

/**
 * Base class for LLM clients that adapt EMA schema to a concrete SDK.
 *
 * Subclasses implement the schema conversion and the final SDK request. This
 * base class owns retry handling and normalized response construction.
 */
export abstract class LLMClientBase<
  TSDKMessage,
  TSDKTool,
  TSDKResponse,
> implements SchemaAdapter<TSDKMessage, TSDKTool, TSDKResponse> {
  private retryCallback:
    | ((exception: Error, attempt: number) => void)
    | undefined;

  constructor(
    protected readonly retryConfig: RetryConfig = new RetryConfig(),
  ) {}

  /**
   * Sets the callback invoked before retrying SDK requests.
   *
   * @param callback - Retry callback, or `undefined` to clear it.
   */
  setRetryCallback(
    callback: ((exception: Error, attempt: number) => void) | undefined,
  ): void {
    this.retryCallback = callback;
  }

  /**
   * Generates a single normalized model response.
   *
   * @param options - EMA request options for this model turn.
   * @returns Normalized assistant message produced from the SDK response.
   */
  async generate(options: LLMGenerateOptions): Promise<ModelMessage> {
    const sdkMessages = this.adaptMessagesToSDK(options.messages);
    const sdkTools = options.tools
      ? this.adaptToolsToSDK(options.tools)
      : undefined;
    const request = wrapWithRetry(
      this.makeSDKRequest.bind(this),
      this.retryConfig,
      this.retryCallback,
    );
    const sdkResponse = await request({
      ...options,
      messages: sdkMessages,
      tools: sdkTools,
    });
    return this.adaptResponseFromSDK(sdkResponse);
  }

  /**
   * Converts an EMA message to the target SDK message shape.
   *
   * @param message - EMA message to convert.
   * @returns SDK-compatible message.
   */
  abstract adaptMessageToSDK(message: Message): TSDKMessage;

  /**
   * Converts an EMA tool definition to the target SDK tool shape.
   *
   * @param tool - EMA tool definition to convert.
   * @returns SDK-compatible tool definition.
   */
  abstract adaptToolToSDK(tool: ToolDefinition): TSDKTool;

  /**
   * Converts a raw SDK response to EMA's normalized assistant message.
   *
   * @param response - SDK response to normalize.
   * @returns Normalized assistant message.
   */
  abstract adaptResponseFromSDK(response: TSDKResponse): ModelMessage;

  /**
   * Sends an already-adapted request through the concrete SDK.
   *
   * @param options - Request options after message/tool schema conversion.
   * @returns Raw SDK response to be normalized by `adaptResponseFromSDK`.
   */
  protected abstract makeSDKRequest(
    options: LLMGenerateSDKOptions<TSDKMessage, TSDKTool>,
  ): Promise<TSDKResponse>;

  /**
   * Converts multiple EMA messages to the target SDK message shape.
   *
   * @param messages - EMA messages to convert.
   * @returns SDK-compatible messages.
   */
  protected adaptMessagesToSDK(messages: Message[]): TSDKMessage[] {
    return messages.map((message) => this.adaptMessageToSDK(message));
  }

  /**
   * Converts multiple EMA tool definitions to the target SDK shape.
   *
   * @param tools - EMA tool definitions to convert.
   * @returns SDK-compatible tool definitions.
   */
  protected adaptToolsToSDK(tools: ToolDefinition[]): TSDKTool[] {
    return tools.map((tool) => this.adaptToolToSDK(tool));
  }
}

/**
 * Request options after messages and tools have been adapted to SDK shape.
 *
 * @typeParam TSDKMessage - Message shape accepted by the target SDK.
 * @typeParam TSDKTool - Tool shape accepted by the target SDK.
 */
export type LLMGenerateSDKOptions<TSDKMessage, TSDKTool> = Omit<
  LLMGenerateOptions,
  "messages" | "tools"
> & {
  messages: TSDKMessage[];
  tools?: TSDKTool[];
};
