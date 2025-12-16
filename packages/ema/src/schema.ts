/**
 * LLM provider types.
 */
export enum LLMProvider {
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
}

// TODO: pydantic?
// from pydantic import BaseModel
// class FunctionCall(BaseModel):

/**
 * Function call details.
 */
export interface FunctionCall {
  /**
   * Function name.
   */
  name: string;
  /**
   * Function arguments.
   */
  arguments: Record<string, unknown>;
}

/**
 * Tool call structure.
 */
export interface ToolCall {
  /**
   * Tool call ID.
   */
  id: string;
  /**
   * Tool call type.
   */
  type: string;
  /**
   * Function call.
   */
  function: FunctionCall;
}

/**
 * Chat message.
 */
export interface Message {
  /**
   * Message role.
   */
  role: string;
  /**
   * Message content.
   */
  content: string | Record<string, unknown>[];
  /**
   * Extended thinking content for assistant messages.
   */
  thinking: string | null;
  /**
   * Tool calls.
   */
  tool_calls: ToolCall[] | null;

  /**
   * Tool call ID.
   */
  tool_call_id: string | null;
  /**
   * For tool role.
   */
  name: string | null;
}

/**
 * Token usage statistics from LLM API response.
 */
export interface TokenUsage {
  /**
   * Prompt tokens.
   */
  prompt_tokens: number;
  /**
   * Completion tokens.
   */
  completion_tokens: number;
  /**
   * Total tokens.
   */
  total_tokens: number;
}

/**
 * LLM response.
 */
export interface LLMResponse {
  /**
   * Content.
   */
  content: string;
  /**
   * Extended thinking blocks.
   */
  thinking: string | null;
  /**
   * Tool calls.
   */
  tool_calls: ToolCall[] | null;
  /**
   * Finish reason.
   */
  finish_reason: string;
  /**
   * Token usage from API response.
   */
  usage: TokenUsage | null;
}
