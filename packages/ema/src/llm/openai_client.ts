/**
 * OpenAI LLM client implementation.
 */

import type { Tool } from "./base";
import { LLMClientBase } from "./base";
import { RetryConfig } from "../retry";
import type { Message, LLMResponse } from "../schema";
import { OpenAI } from "openai";
import { ProxyAgent, fetch } from "undici";
// import { asyncRetry } from "../retry";

/**
 * LLM client using OpenAI's protocol.
 *
 * This client uses the official OpenAI SDK and supports:
 * - Reasoning content (via reasoning_split=True)
 * - Tool calling
 * - Retry logic
 */
export class OpenAIClient extends LLMClientBase {
  private readonly client: OpenAI;

  constructor(
    /**
     * API key for authentication
     */
    apiKey: string,
    /**
     * Base URL for the API
     */
    apiBase: string,
    /**
     * Model name to use
     */
    model: string,
    /**
     * Optional retry configuration
     */
    retryConfig?: RetryConfig,
  ) {
    super(apiKey, apiBase, model, retryConfig);
    // Uses proxy if HTTPS_PROXY or https_proxy is set
    const https_proxy =
      process.env.HTTPS_PROXY || process.env.https_proxy || "";
    console.log(`[OpenAIClient] apiBase: ${apiBase}`);
    const dispatcher = https_proxy ? new ProxyAgent(https_proxy) : undefined;
    this.client = new OpenAI({
      apiKey,
      baseURL: apiBase,
      ...(https_proxy
        ? {
            fetch: (input: any, init: any) => {
              init.dispatcher = dispatcher;
              return fetch(input, init) as any;
            },
          }
        : {}),
    });
  }

  /**
   * Executes API request (core method that can be retried).
   *
   * @param apiMessages - List of messages in OpenAI format
   * @param tools - Optional list of tools
   * @returns OpenAI ChatCompletion response (full response including usage)
   */
  async _makeApiRequest(
    apiMessages: Record<string, unknown>[],
    tools?: Tool[],
  ): Promise<any> {
    return this.client.chat.completions.create({
      model: this.model,
      messages: apiMessages as any,
      tools: tools ? this._convertTools(tools) : undefined,
      // todo: Platforms' behaviors vary. For example, Minimax requires a extra_body={"reasoning_split": True} and use reasoning_details. Ollama use reasoning.
      // Enable reasoning_split to separate thinking content
      //@ts-ignore
      // reasoning_split: true,
    });
  }

  /**
   * Converts tools to OpenAI format.
   *
   * @param tools - List of Tool objects or dicts
   * @returns List of tools in OpenAI dict format
   */
  private _convertTools(tools: Tool[]): any[] {
    return tools.map((tool) => {
      if ("to_openai_schema" in tool) {
        return tool.to_openai_schema();
      } else if (tool.type === "function") {
        return tool;
      } else if (
        "name" in tool &&
        "description" in tool &&
        "input_schema" in tool
      ) {
        // Assume it's in Anthropic format, convert to OpenAI
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        };
      } else {
        throw new Error(`Unsupported tool type: ${typeof tool}`);
      }
    });
  }

  /**
   * Parses OpenAI response into LLMResponse.
   *
   * @param response - OpenAI ChatCompletion response (full response object)
   * @returns LLMResponse object
   */
  _parseResponse(response: any): LLMResponse {
    // Gets message from response
    const message = response.choices[0].message;
    // Extracts text content
    const textContent = message.content || "";

    // Extracts thinking content from reasoning_details
    const thinkingContent =
      message.reasoning_details?.map((detail: any) => detail.text)?.join("") ||
      "";
    // Extracts tool calls
    const toolCalls = message.tool_calls?.map((toolCall: any) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.function.name,
        // todo: handle exception on malformed JSON string (may be caused by network errors).
        // Parses arguments from JSON string
        arguments: JSON.parse(toolCall.function.arguments),
      },
    }));
    // Extracts token usage from response
    const usage = response.usage
      ? {
          prompt_tokens: response.usage.prompt_tokens || 0,
          completion_tokens: response.usage.completion_tokens || 0,
          total_tokens: response.usage.total_tokens || 0,
        }
      : undefined;
    return {
      content: textContent,
      thinking: thinkingContent ?? undefined,
      tool_calls: toolCalls,
      // OpenAI doesn't provide finish_reason in the message
      finish_reason: "stop",
      usage: usage,
    };
  }

  /**
   * Converts internal messages to OpenAI format.
   * Note: OpenAI includes system message in the messages array
   *
   * @param messages - List of internal Message objects
   * @returns Tuple of (system_message, api_messages)
   */
  _convertMessages(
    messages: Message[],
  ): [string | undefined, Record<string, unknown>[]] {
    const apiMessages = messages.map((message) => {
      if (message.role === "system") {
        // OpenAI includes system message in messages array
        return {
          role: "system",
          content: message.content,
        };
      } else if (message.role === "user") {
        // For user messages
        return {
          role: "user",
          content: message.content,
        };
      } else if (message.role === "assistant") {
        // For assistant messages
        return {
          role: "assistant",
          content: message.content,
          tool_calls: message.tool_calls?.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.function.name,
              arguments: JSON.stringify(toolCall.function.arguments),
            },
          })),
          // IMPORTANT: Adds reasoning_details if thinking is present
          // This is CRITICAL for Interleaved Thinking to work properly!
          // The complete response_message (including reasoning_details) must be
          // preserved in Message History and passed back to the model in the next turn.
          // This ensures the model's chain of thought is not interrupted.
          // Adds reasoning details if present
          reasoning_details: message.thinking
            ? [{ text: message.thinking }]
            : undefined,
        };
      } else if (message.role === "tool") {
        // For tool result messages
        return {
          role: "tool",
          tool_call_id: message.tool_call_id,
          content: message.content,
        };
      } else {
        throw new Error(`Unsupported message role: ${message.role}`);
      }
    });
    return [undefined, apiMessages];
  }

  /**
   * Prepares the request for OpenAI API.
   *
   * @param messages - List of conversation messages
   * @param tools - Optional list of available tools
   * @returns Dictionary containing request parameters
   */
  _prepareRequest(
    messages: Message[],
    tools?: Tool[],
  ): { apiMessages: Record<string, unknown>[]; tools?: Tool[] } {
    // TODO: Why does mini-agent ignore systemMessage?
    const [systemMessage, apiMessages] = this._convertMessages(messages);
    return {
      apiMessages,
      tools,
    };
  }

  /**
   * Generates response from OpenAI LLM.
   *
   * @param messages - List of conversation messages
   * @param tools - Optional list of available tools
   * @returns LLMResponse containing the generated content
   */
  async generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    const requestParams = this._prepareRequest(messages, tools);
    if (this.retryConfig.enabled) {
      //             # Applies retry logic
      //             retry_decorator = asyncRetry(config=self.retry_config, on_retry=self.retry_callback)
      //             api_call = retry_decorator(self._makeApiRequest)
      //             response = await api_call(
      //                 request_params["api_messages"],
      //                 request_params["tools"],
      //             )
      //   const retryDecorator = asyncRetry(this.retryConfig, this.retryCallback);
      //   const apiCall = retryDecorator(this._makeApiRequest);
      //   const response = await apiCall(requestParams);
      //   return this._parseResponse(response);
      console.warn("Retry is not implemented");
    }
    const response = await this._makeApiRequest(
      requestParams.apiMessages,
      requestParams.tools,
    );
    return this._parseResponse(response);
  }
}
