import path from "node:path";

import {
  AutoLLMClient,
  type ContentItem,
  type ToolSchema,
  type UniConfig,
  type UniEvent,
  type UniMessage,
  type UsageMetadata as AgentHubUsageMetadata,
} from "@prismshadow/agenthub";

import { GlobalConfig } from "../config";
import { LLMClientBase } from "./base";
import type { LLMGenerateSDKOptions, LLMModelConfig } from "./base";
import { RetryConfig } from "./retry";
import type {
  Content,
  ImageItem,
  InlineDataItem,
  Message,
  MessageMetadata,
  ModelMessage,
  ToolDefinition,
  UsageMetadata,
} from "./schema";
import {
  collapseContentsForTextOnlyModel,
  isImageMime,
  isSupportedMime,
} from "./utils";

/**
 * AgentHub-backed client that adapts EMA schema to AgentHub schema.
 *
 * This class is the only layer that should know about AgentHub request and
 * response shapes. Business code should depend on `LLMClient` instead.
 */
export class AgentHubClient extends LLMClientBase<
  UniMessage,
  ToolSchema,
  UniMessage
> {
  private readonly client: AutoLLMClient;

  /**
   * Creates an AgentHub-backed client from a resolved model config.
   *
   * @param modelConfig - Runtime model configuration resolved from the registry.
   * @param retryConfig - Retry settings applied around AgentHub requests.
   */
  constructor(
    protected readonly modelConfig: LLMModelConfig,
    retryConfig: RetryConfig = new RetryConfig(),
  ) {
    super(retryConfig);
    process.env.AGENTHUB_CACHE_DIR = path.join(
      GlobalConfig.paths.logsDir,
      "agent",
    );
    this.client = new AutoLLMClient({
      model: modelConfig.model,
      apiKey: modelConfig.apiKey,
      baseUrl: modelConfig.baseUrl,
      clientType: modelConfig.clientType,
    });
  }

  /**
   * Converts an EMA message to AgentHub's universal message shape.
   *
   * @param message - EMA message to convert.
   * @returns AgentHub-compatible message.
   */
  adaptMessageToSDK(message: Message): UniMessage {
    const contents = this.modelConfig.capabilities.images
      ? message.contents
      : collapseContentsForTextOnlyModel(message.contents);
    return {
      role: message.role === "model" ? "assistant" : "user",
      content_items: contents.map((content) => this.adaptContentToSDK(content)),
      ...this.adaptMessageMetadataToSDK(message.metadata),
    };
  }

  /**
   * Converts an EMA tool definition to AgentHub's tool schema.
   *
   * @param tool - EMA tool definition to convert.
   * @returns AgentHub-compatible tool schema.
   */
  adaptToolToSDK(tool: ToolDefinition): ToolSchema {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    };
  }

  /**
   * Converts an AgentHub response message to EMA's normalized message shape.
   *
   * @param response - AgentHub response to normalize.
   * @returns Normalized EMA assistant message.
   */
  adaptResponseFromSDK(response: UniMessage): ModelMessage {
    if (response.role !== "assistant") {
      throw new Error(`Unexpected AgentHub response role: ${response.role}`);
    }
    return {
      role: "model",
      contents: response.content_items.map((content) =>
        this.adaptContentFromSDK(content),
      ),
      ...this.adaptMessageMetadataFromSDK(response),
    };
  }

  /**
   * Sends an adapted request through AgentHub.
   *
   * @param options - Request options after EMA schema has been adapted.
   * @returns Raw AgentHub response.
   */
  protected async makeSDKRequest(
    options: LLMGenerateSDKOptions<UniMessage, ToolSchema>,
  ): Promise<UniMessage> {
    const config = this.buildUniConfig(options);
    const events: UniEvent[] = [];
    for await (const event of this.client.streamingResponse({
      messages: options.messages,
      config,
      signal: options.signal,
    })) {
      events.push(event);
    }
    return this.client.concatUniEventsToUniMessage(events);
  }

  private adaptContentToSDK(content: Content): ContentItem {
    switch (content.type) {
      case "text":
        return {
          type: "text",
          text: content.text,
          phase: content.phase,
          signature: content.signature,
        };
      case "thinking":
        return {
          type: "thinking",
          thinking: content.thinking,
          signature: content.signature,
        };
      case "image_url":
        return {
          type: "image_url",
          image_url: content.url,
        };
      case "inline_data":
        return this.adaptInlineDataToSDK(content);
      case "tool_call":
        return {
          type: "tool_call",
          name: content.name,
          arguments: content.arguments,
          tool_call_id: content.toolCallId,
          signature: content.signature,
        };
      case "tool_result":
        return {
          type: "tool_result",
          text: content.result.text,
          ...(content.result.images?.length
            ? {
                images: content.result.images.map((image) =>
                  this.adaptToolResultImageToSDK(image),
                ),
              }
            : {}),
          tool_call_id: content.toolCallId,
        };
    }
  }

  private adaptContentFromSDK(content: ContentItem): Content {
    switch (content.type) {
      case "text":
        return {
          type: "text",
          text: content.text,
          phase: content.phase,
          signature: content.signature,
        };
      case "thinking":
        return {
          type: "thinking",
          thinking: content.thinking,
          signature: content.signature,
        };
      case "inline_thinking":
        throw new Error(
          "AgentHub returned inline_thinking, which is not supported by EMA schema yet.",
        );
      case "image_url":
        return {
          type: "image_url",
          url: content.image_url,
        };
      case "inline_data":
        if (!isSupportedMime(content.mime_type)) {
          throw new Error(
            `AgentHub returned unsupported MIME type: ${content.mime_type}`,
          );
        }
        return {
          type: "inline_data",
          data: content.data.toString("base64"),
          mimeType: content.mime_type,
          signature: content.signature,
        };
      case "tool_call":
        return {
          type: "tool_call",
          name: content.name,
          arguments: content.arguments,
          toolCallId: content.tool_call_id,
          signature: content.signature,
        };
      case "tool_result":
        throw new Error(
          "AgentHub returned tool_result in an assistant response, which EMA does not support.",
        );
      case "embedding":
        throw new Error(
          "AgentHub returned embedding content in an assistant response, which EMA does not support.",
        );
    }
  }

  private adaptToolResultImageToSDK(image: ImageItem): string {
    if (image.type === "image_url") {
      return image.url;
    }
    return `data:${image.mimeType};base64,${image.data}`;
  }

  private adaptInlineDataToSDK(content: InlineDataItem): ContentItem {
    if (!content.signature && isImageMime(content.mimeType)) {
      return {
        type: "image_url",
        image_url: this.formatInlineImageDataUrl(content),
      };
    }
    return {
      type: "inline_data",
      data: Buffer.from(content.data, "base64"),
      mime_type: content.mimeType,
      signature: content.signature,
    };
  }

  private formatInlineImageDataUrl(content: InlineDataItem): string {
    return `data:${content.mimeType};base64,${content.data}`;
  }

  private buildUniConfig(
    options: LLMGenerateSDKOptions<UniMessage, ToolSchema>,
  ): UniConfig {
    return {
      max_tokens: this.modelConfig.requestDefaults.maxTokens,
      temperature: this.modelConfig.requestDefaults.temperature,
      tools: options.tools?.length ? options.tools : undefined,
      thinking_summary: this.modelConfig.requestDefaults.thinkingSummary,
      thinking_level: this.modelConfig.requestDefaults.thinkingLevel,
      system_prompt: options.systemPrompt,
      prompt_caching: this.modelConfig.requestDefaults.promptCaching,
      trace_id: options.traceId,
    };
  }

  private adaptMessageMetadataToSDK(
    metadata: MessageMetadata | undefined,
  ): Pick<UniMessage, "usage_metadata" | "finish_reason" | "created_at"> {
    if (!metadata) {
      return {};
    }
    return {
      ...(metadata.usageMetadata
        ? {
            usage_metadata: this.adaptUsageMetadataToSDK(
              metadata.usageMetadata,
            ),
          }
        : {}),
      ...(metadata.finishReason !== undefined
        ? {
            finish_reason: metadata.finishReason as UniMessage["finish_reason"],
          }
        : {}),
      ...(metadata.createdAt !== undefined
        ? { created_at: metadata.createdAt }
        : {}),
    };
  }

  private adaptMessageMetadataFromSDK(message: UniMessage): {
    metadata?: MessageMetadata;
  } {
    const usageMetadata = this.adaptUsageMetadataFromSDK(
      message.usage_metadata,
    );
    const metadata: MessageMetadata = {
      ...(usageMetadata ? { usageMetadata } : {}),
      ...(message.finish_reason !== null && message.finish_reason !== undefined
        ? { finishReason: message.finish_reason }
        : {}),
      ...(message.created_at !== undefined
        ? { createdAt: message.created_at }
        : {}),
    };
    return Object.keys(metadata).length > 0 ? { metadata } : {};
  }

  private adaptUsageMetadataToSDK(
    usageMetadata: UsageMetadata,
  ): AgentHubUsageMetadata {
    return {
      cached_tokens: usageMetadata.cachedTokens ?? null,
      prompt_tokens: usageMetadata.promptTokens ?? null,
      thoughts_tokens: usageMetadata.thoughtTokens ?? null,
      response_tokens: usageMetadata.responseTokens ?? null,
    };
  }

  private adaptUsageMetadataFromSDK(
    usageMetadata: AgentHubUsageMetadata | null | undefined,
  ): UsageMetadata | undefined {
    if (!usageMetadata) {
      return undefined;
    }
    const metadata: UsageMetadata = {
      ...(usageMetadata.cached_tokens !== null
        ? { cachedTokens: usageMetadata.cached_tokens }
        : {}),
      ...(usageMetadata.prompt_tokens !== null
        ? { promptTokens: usageMetadata.prompt_tokens }
        : {}),
      ...(usageMetadata.thoughts_tokens !== null
        ? { thoughtTokens: usageMetadata.thoughts_tokens }
        : {}),
      ...(usageMetadata.response_tokens !== null
        ? { responseTokens: usageMetadata.response_tokens }
        : {}),
    };
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }
}
