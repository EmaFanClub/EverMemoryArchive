export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/gif",
  "image/svg+xml",
  "image/tiff",
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

export const DEFAULT_MIME_TYPES = ["application/octet-stream"] as const;

export type ImageMIME = (typeof IMAGE_MIME_TYPES)[number];
export type VideoMIME = (typeof VIDEO_MIME_TYPES)[number];
export type AudioMIME = (typeof AUDIO_MIME_TYPES)[number];
export type DocumentMIME = (typeof DOCUMENT_MIME_TYPES)[number];
export type DefaultMIME = (typeof DEFAULT_MIME_TYPES)[number];
export type MIME =
  | ImageMIME
  | VideoMIME
  | AudioMIME
  | DocumentMIME
  | DefaultMIME;

/**
 * Tool definition exposed to the LLM for tool calling.
 *
 * The shape is intentionally provider-neutral and is adapted to AgentHub's
 * `ToolSchema` when a request is sent.
 */
export interface ToolDefinition {
  /** Stable tool name used by model-emitted calls. */
  name: string;
  /** Natural-language description of when and how the tool should be used. */
  description: string;
  /** JSON schema describing the expected tool arguments. */
  parameters?: Record<string, unknown>;
}

/** Text content block within a chat message. */
export interface TextItem {
  type: "text";
  /** UTF-8 text sent to or produced by the model. */
  text: string;
  /** Provider-specific text phase used to preserve structured response output. */
  phase?: string | null;
  /** Provider-specific signature used to preserve signed model context. */
  signature?: string;
}

/**
 * Reasoning/thinking content block within a chat message.
 *
 * Thinking content is kept separate from normal text so adapters can preserve
 * provider-specific reasoning fields instead of flattening them into replies.
 */
export interface ThinkingItem {
  type: "thinking";
  /** Reasoning text produced by the model. */
  thinking: string;
  /** Provider-specific signature used to continue signed reasoning context. */
  signature?: string;
}

/**
 * Image URL content block within a chat message.
 *
 * URL media is kept distinct from inline media because some providers and tools
 * can consume URLs directly without converting them to base64.
 */
export interface ImageUrlItem {
  type: "image_url";
  /** URL or data URL pointing to the image payload. */
  url: string;
  /** Optional text label used when media must be represented as text. */
  text?: string;
}

/**
 * Inline media content block within a chat message.
 *
 * The payload is base64 encoded so it can be stored and transported without
 * depending on provider-specific binary representations.
 */
export interface InlineDataItem {
  type: "inline_data";
  /** MIME type describing the inline payload. */
  mimeType: MIME;
  /** Base64-encoded inline payload. */
  data: string;
  /** Optional text label used when media must be represented as text. */
  text?: string;
  /** Provider-specific signature used to preserve signed model context. */
  signature?: string;
}

/** Media content that may be attached to messages. */
export type MediaItem = ImageUrlItem | InlineDataItem;

/** Image content that may be attached to tool results. */
export type ImageItem =
  | ImageUrlItem
  | (InlineDataItem & { mimeType: ImageMIME });

/** Content block that may appear in user-authored input. */
export type InputContent = TextItem | MediaItem;

/**
 * Tool invocation request emitted by the LLM.
 *
 * A runtime caller is responsible for executing the tool and returning a
 * matching `ToolResult`.
 */
export interface ToolCall {
  type: "tool_call";
  /** Stable id used to link this call with its result. */
  toolCallId: string;
  /** Tool name to invoke. */
  name: string;
  /** JSON arguments passed to the tool. */
  arguments: Record<string, unknown>;
  /** Provider-specific signature associated with this tool call. */
  signature?: string;
}

/**
 * Tool execution result payload returned to the LLM.
 *
 * `text` is the model-readable summary, and `images` carries image
 * attachments visible to the model.
 */
export interface ToolResultContent {
  /** Text summary of the execution result. */
  text: string;
  /** Optional image attachments returned by the tool. */
  images?: ImageItem[];
}

/**
 * Tool execution result returned to the LLM.
 *
 * `toolCallId` should match the originating `ToolCall.toolCallId`.
 */
export interface ToolResult {
  type: "tool_result";
  /** Stable id linking this result to the originating tool call. */
  toolCallId: string;
  /** Name of the tool that produced the result. */
  name: string;
  /** Execution outcome payload. */
  result: ToolResultContent;
}

/** Content block that may appear in any EMA LLM message. */
export type Content =
  | TextItem
  | ThinkingItem
  | MediaItem
  | ToolCall
  | ToolResult;

/** User-originated message in EMA's provider-neutral schema. */
export interface UserMessage {
  /** Role marker. */
  role: "user";
  /** Ordered list of content blocks. */
  contents: Content[];
  /** Optional provider/trace metadata associated with this message. */
  metadata?: MessageMetadata;
}

/** LLM-generated message in EMA's provider-neutral schema. */
export interface ModelMessage {
  /** Role marker. */
  role: "model";
  /** Assistant-authored content blocks. */
  contents: Content[];
  /** Optional provider/trace metadata associated with this message. */
  metadata?: MessageMetadata;
}

/** Union of all supported message kinds. */
export type Message = UserMessage | ModelMessage;

/**
 * Token usage metadata normalized from provider responses.
 *
 * Fields are optional because providers vary in what they report.
 */
export interface UsageMetadata {
  /** Number of prompt tokens served from cache. */
  cachedTokens?: number;
  /** Number of non-cached prompt/input tokens. */
  promptTokens?: number;
  /** Number of reasoning/thinking tokens. */
  thoughtTokens?: number;
  /** Number of generated response tokens. */
  responseTokens?: number;
}

/** Optional provider/trace metadata attached to a message. */
export interface MessageMetadata {
  /** Optional detailed usage counts when returned by the provider. */
  usageMetadata?: UsageMetadata;
  /** Provider-specific finish reason for assistant messages. */
  finishReason?: string;
  /** Message creation timestamp in milliseconds since Unix epoch. */
  createdAt?: number;
}
