import type { Message, LLMResponse } from "../schema";

/**
 * {@link EmaLLMClient} is a stateless client for the LLM, holding a physical network connection to the LLM.
 *
 * TODO: remove mini-agent's LLMClient definition.
 */
export interface EmaLLMClient {
  /**
   * Generates response from LLM.
   *
   * @param messages - List of conversation messages
   * @param tools - Optional list of Tool objects or dicts
   * @returns LLMResponse containing the generated content, thinking, and tool calls
   */
  generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
}

// TODO: definition of tools.
export type Tool = any;
