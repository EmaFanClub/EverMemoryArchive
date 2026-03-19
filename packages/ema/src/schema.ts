import type { Tool, ToolResult } from "./tools/base";

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-flv",
  "video/webm",
  "video/x-ms-wmv",
  "video/3gpp",
] as const;

export const AUDIO_MIME_TYPES = [
  "audio/wav",
  "audio/mpeg",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
] as const;

export const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/html",
] as const;

export type ImageMIME = (typeof IMAGE_MIME_TYPES)[number];
export type VideoMIME = (typeof VIDEO_MIME_TYPES)[number];
export type AudioMIME = (typeof AUDIO_MIME_TYPES)[number];
export type DocumentMIME = (typeof DOCUMENT_MIME_TYPES)[number];
export type MIME = ImageMIME | VideoMIME | AudioMIME | DocumentMIME;

/** Tool invocation request emitted by the LLM. */
export interface FunctionCall {
  type: "function_call";
  /** Optional call id used to link request/response pairs. */
  id?: string;
  /** Tool name to invoke. */
  name: string;
  /** JSON arguments passed to the tool. */
  args: Record<string, unknown>;
  /** Optional thought signature associated with this tool call. */
  thoughtSignature?: string;
}

/** Tool execution result returned to the LLM. */
export interface FunctionResponse {
  type: "function_response";
  /** Optional id matching the originating tool call. */
  id?: string;
  /** Name of the tool that produced the result. */
  name: string;
  /** Execution outcome payload. */
  result: ToolResult;
  /** Optional media parts returned by the tool for multimodal providers. */
  parts?: InlineDataItem[];
}

export interface TextItem {
  type: "text";
  text: string;
  thoughtSignature?: string;
}

export interface InlineDataItem {
  type: "inline_data";
  mimeType: MIME;
  data: string;
}

/**
 * Single content block within a chat message.
 */
export type InputContent = TextItem | InlineDataItem;

export type Content = InputContent | FunctionCall | FunctionResponse;

/** User-originated message. */
export interface UserMessage {
  /** Role marker. */
  role: "user";
  /** Ordered list of content blocks. */
  contents: Content[];
}

/** LLM-generated message. */
export interface ModelMessage {
  /** Role marker. */
  role: "model";
  /** Assistant-authored content blocks. */
  contents: Content[];
}

/** Union of all supported message kinds. */
export type Message = UserMessage | ModelMessage;

/** Normalized LLM response envelope. */
export interface LLMResponse {
  /** Final assistant message for this turn. */
  message: ModelMessage;
  /** Provider-specific finish reason (e.g., stop, length, tool_calls). */
  finishReason: string;
  /** Total tokens counted by the provider for this call. */
  totalTokens: number;
}

/** Adapter contract for translating between EMA schema and provider schema. */
export interface SchemaAdapter {
  /** Converts an internal message to the provider request shape. */
  adaptMessageToAPI(message: Message): any;
  /** Converts a tool definition to the provider request shape. */
  adaptToolToAPI(tool: Tool): any;
  /** Converts a provider response back to the EMA schema. */
  adaptResponseFromAPI(response: any): LLMResponse;
}

/** Type guard for model messages. */
export function isModelMessage(message: Message): message is ModelMessage {
  return message.role === "model";
}

/** Type guard for user messages. */
export function isUserMessage(message: Message): message is UserMessage {
  return message.role === "user";
}

/** Type guard for tool response content. */
export function isTextItem(content: Content): content is TextItem {
  return content.type === "text";
}

/** Type guard for inline data content. */
export function isInlineDataItem(content: Content): content is InlineDataItem {
  return content.type === "inline_data";
}

/**
 * Collapses contents for prompt rendering.
 */
export function collapseContents(
  contents: InputContent[],
  preserveInlineImages = true,
): InputContent[] {
  return contents.map((content): InputContent => {
    if (
      content.type === "text" ||
      (preserveInlineImages && content.mimeType.startsWith("image/"))
    ) {
      return content;
    }
    return {
      type: "text",
      text: `（${content.mimeType}）`,
    };
  });
}

/** Type guard for function call content. */
export function isFunctionCall(content: Content): content is FunctionCall {
  return content.type === "function_call";
}

/** Type guard for function response content. */
export function isFunctionResponse(
  content: Content,
): content is FunctionResponse {
  return content.type === "function_response";
}
