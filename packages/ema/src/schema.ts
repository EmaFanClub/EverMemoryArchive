import type { Tool, ToolResult } from "./tools/base";

/** Tool invocation request emitted by the LLM. */
export interface ToolCall {
  /** Optional call id used to link request/response pairs. */
  id?: string;
  /** Tool name to invoke. */
  name: string;
  /** JSON arguments passed to the tool. */
  args: Record<string, unknown>;
  /** Optional thought signature associated with this tool call. */
  thoughtSignature?: string;
}

/**
 * Single content block within a chat message.
 * TODO: extend with other types if necessary.
 */
export type Content = { type: "text"; text: string };

/** User-originated message. */
export interface UserMessage {
  /** Role marker. */
  role: "user";
  /** Ordered list of content blocks. */
  contents: Content[];
}

/** LLM-generated message, optionally containing tool calls. */
export interface ModelMessage {
  /** Role marker. */
  role: "model";
  /** Assistant-authored content blocks. */
  contents: Content[];
  /** Optional tool calls requested by the model. */
  toolCalls?: ToolCall[];
  // TODO: other fields if necessary
}

/** Tool execution result returned to the LLM. */
export interface ToolMessage {
  /** Role marker. */
  role: "tool";
  /** Compatible with other messages */
  contents?: Content[];
  /** Optional id matching the originating tool call. */
  id?: string;
  /** Name of the tool that produced the result. */
  name: string;
  /** Execution outcome payload. */
  result: ToolResult;
}

/** Union of all supported message kinds. */
export type Message = UserMessage | ModelMessage | ToolMessage;

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
  adaptMessageToAPI(message: Message): Record<string, unknown>;
  /** Converts a tool definition to the provider request shape. */
  adaptToolToAPI(tool: Tool): Record<string, unknown>;
  /** Converts a provider response back to the EMA schema. */
  adaptResponseFromAPI(response: any): LLMResponse;
}

/** Type guard for tool messages. */
export function isToolMessage(message: Message): message is ToolMessage {
  return message.role === "tool";
}

/** Type guard for model messages. */
export function isModelMessage(message: Message): message is ModelMessage {
  return message.role === "model";
}

/** Type guard for user messages. */
export function isUserMessage(message: Message): message is UserMessage {
  return message.role === "user";
}
