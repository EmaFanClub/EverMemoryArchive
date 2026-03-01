/** Base class for LLM clients.
 * This class defines the interface that all LLM clients must implement,
 * regardless of the underlying API protocol (Anthropic, OpenAI, etc.).
 */

import type { Tool } from "../tools/base";
import type { Message, LLMResponse } from "../schema";

/**
 * Abstract base class for LLM clients.
 *
 * This class defines the interface that all LLM clients must implement,
 * regardless of the underlying API protocol (Anthropic, OpenAI, etc.).
 */
export abstract class LLMClientBase {
  retryCallback: ((exception: Error, attempt: number) => void) | undefined =
    undefined;

  abstract adaptTools(tools: Tool[]): any[];

  abstract adaptMessages(messages: Message[]): any[];

  abstract makeApiRequest(
    apiMessages: any[],
    apiTools?: any[],
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<any>;

  abstract generate(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<LLMResponse>;
}
