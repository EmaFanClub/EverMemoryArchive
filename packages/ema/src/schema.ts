import type { Tool, ToolResult } from "./tools/base";

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
}

export interface TextItem {
  type: "text";
  text: string;
  thoughtSignature?: string;
}

/**
 * Single content block within a chat message.
 * TODO: extend with other types if necessary.
 */
export type InputContent = TextItem;

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
