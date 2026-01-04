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

  abstract adaptTools(tools: Tool[]): Record<string, unknown>[];

  abstract adaptMessages(messages: Message[]): Record<string, unknown>[];

  abstract makeApiRequest(
    apiMessages: Record<string, unknown>[],
    apiTools?: Record<string, unknown>[],
    systemPrompt?: string,
  ): Promise<any>;

  abstract generate(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string,
  ): Promise<LLMResponse>;
}
