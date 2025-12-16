/** Base class for LLM clients.
 * This class defines the interface that all LLM clients must implement,
 * regardless of the underlying API protocol (Anthropic, OpenAI, etc.).
 */

import { RetryConfig } from "../retry";
import type { Message, LLMResponse } from "../schema";

// TODO: definition of tools.
type Tool = any;

/**
 * Abstract base class for LLM clients.
 *
 * This class defines the interface that all LLM clients must implement,
 * regardless of the underlying API protocol (Anthropic, OpenAI, etc.).
 */
export abstract class LLMClientBase {
  retryCallback: ((exception: Error, attempt: number) => void) | undefined =
    undefined;

  constructor(
    /**
     * API key for authentication
     */
    protected readonly apiKey: string,
    /**
     * Base URL for the API
     */
    protected readonly apiBase: string,
    /**
     * Model name to use
     */
    protected readonly model: string,
    /**
     * Optional retry configuration
     */
    protected readonly retryConfig: RetryConfig = new RetryConfig()
  ) {}

  /**
   * Generates response from LLM.
   *
   * @param messages - List of conversation messages
   * @param tools - Optional list of Tool objects or dicts
   * @returns LLMResponse containing the generated content, thinking, and tool calls
   */
  abstract generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;

  /**
   * Prepares the request payload for the API.
   *
   * @param messages - List of conversation messages
   * @param tools - Optional list of Tool objects or dicts
   * @returns Dictionary containing the request payload
   */
  abstract _prepareRequest(
    messages: Message[],
    tools?: Tool[]
  ): Promise<Record<string, unknown>>;

  /**
   * Converts internal message format to API-specific format.
   *
   * @param messages - List of internal Message objects
   * @returns Tuple of (system_message, api_messages)
   */
  abstract _convertMessages(
    messages: Message[]
  ): [string | undefined, Record<string, unknown>[]];
}
