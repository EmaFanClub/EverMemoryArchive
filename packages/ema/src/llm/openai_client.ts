import OpenAI from "openai";
import type { ClientOptions } from "openai";
import type {
  ResponseInputItem,
  ResponseFunctionToolCall,
  EasyInputMessage,
  Response as OpenAIResponse,
  FunctionTool,
} from "openai/resources/responses/responses";
import { LLMClientBase } from "./base";
import {
  type SchemaAdapter,
  isModelMessage,
  isUserMessage,
  isFunctionCall,
  isFunctionResponse,
  isTextItem,
} from "../schema";
import type { Content, LLMResponse, Message, ModelMessage } from "../schema";
import type { Tool } from "../tools/base";
import { wrapWithRetry } from "./retry";
import type { LLMApiConfig, RetryConfig } from "../config";
import { FetchWithProxy } from "./proxy";

type OpenAIMessage =
  | ResponseFunctionToolCall
  | ResponseInputItem.FunctionCallOutput
  | EasyInputMessage;

/** OpenAI-compatible client that adapts EMA schema to Responses API. */
export class OpenAIClient extends LLMClientBase implements SchemaAdapter {
  private readonly client: OpenAI;

  constructor(
    readonly model: string,
    readonly config: LLMApiConfig,
    readonly retryConfig: RetryConfig,
  ) {
    super();
    const options: ClientOptions = {
      apiKey: config.key,
      baseURL: config.base_url,
      fetch: new FetchWithProxy(
        process.env.HTTPS_PROXY || process.env.https_proxy,
      ).createFetcher(),
    };
    this.client = new OpenAI(options);
  }

  /** Map EMA message shape to OpenAI Responses input items. */
  adaptMessageToAPI(message: Message): OpenAIMessage[] {
    const items: OpenAIMessage[] = [];
    if (isUserMessage(message)) {
      for (const content of message.contents) {
        if (isFunctionResponse(content)) {
          items.push({
            type: "function_call_output",
            call_id: content.id!,
            output: JSON.stringify(content.result),
          });
          continue;
        }
        if (isTextItem(content)) {
          const lastItem = items[items.length - 1];
          if (
            lastItem &&
            lastItem.type === "message" &&
            lastItem.role === "user" &&
            Array.isArray(lastItem.content)
          ) {
            lastItem.content.push({
              type: "input_text",
              text: content.text,
            });
          } else {
            items.push({
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: content.text }],
            });
          }
          continue;
        }
        /** Additional content types can be handled here. */
        console.warn(
          `Unsupported content type in user message: ${JSON.stringify(content)}`,
        );
      }
      return items;
    }
    if (isModelMessage(message)) {
      for (const content of message.contents) {
        if (isFunctionCall(content)) {
          items.push({
            type: "function_call",
            call_id: content.id!,
            name: content.name,
            arguments: JSON.stringify(content.args),
          });
          continue;
        }
        if (isTextItem(content)) {
          const lastItem = items[items.length - 1];
          if (
            lastItem &&
            lastItem.type === "message" &&
            lastItem.role === "assistant" &&
            Array.isArray(lastItem.content)
          ) {
            lastItem.content.push({
              type: "input_text",
              text: content.text,
            });
          } else {
            items.push({
              type: "message",
              role: "assistant",
              content: [{ type: "input_text", text: content.text }],
            });
          }
          continue;
        }
        /** Additional content types can be handled here. */
        console.warn(
          `Unsupported content type in model message: ${JSON.stringify(content)}`,
        );
      }
      return items;
    }
    throw new Error(`Unsupported message role: ${(message as Message).role}`);
  }

  /** Map tool definition to OpenAI Responses tool schema. */
  adaptToolToAPI(tool: Tool): FunctionTool {
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? null,
      strict: true,
    };
  }

  /** Convert a batch of EMA messages. */
  adaptMessages(messages: Message[]): OpenAIMessage[] {
    const history: OpenAIMessage[] = [];
    for (const message of messages) {
      history.push(...this.adaptMessageToAPI(message));
    }
    return history;
  }

  /** Convert a batch of tools. */
  adaptTools(tools: Tool[]): FunctionTool[] {
    return tools.map((tool) => this.adaptToolToAPI(tool));
  }

  /** Normalize OpenAI response into EMA schema. */
  adaptResponseFromAPI(response: OpenAIResponse): LLMResponse {
    const usage = response.usage;
    const output = response.output;
    /** Handle some invalid response cases. */
    if (!usage || typeof usage.total_tokens !== "number") {
      throw new Error(
        `Missing or invalid usage in response: ${JSON.stringify(response)}`,
      );
    }
    if (!Array.isArray(output)) {
      console.warn(`No valid output in response: ${JSON.stringify(response)}`);
      return {
        message: {
          role: "model",
          contents: [],
        },
        finishReason: "NO_OUTPUT",
        totalTokens: usage.total_tokens,
      };
    }
    if (!response.status || response.status !== "completed") {
      console.warn(
        `Non-stop finish reason in response: ${JSON.stringify(response)}`,
      );
      return {
        message: {
          role: "model",
          contents: [],
        },
        finishReason: response.status ?? "UNKNOWN",
        totalTokens: usage.total_tokens,
      };
    }
    /** Handle valid response content parts in response. */
    const contents: Content[] = [];
    for (const item of output) {
      if (item.type === "function_call") {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(item.arguments);
        } catch (error) {
          console.warn(
            `Failed to parse tool call arguments: ${item.arguments}`,
          );
        }
        contents.push({
          type: "function_call",
          id: item.call_id,
          name: item.name!,
          args: parsedArgs ?? {},
        });
        continue;
      }
      if (item.type === "message") {
        for (const content of item.content) {
          if (content.type === "output_text") {
            contents.push({ type: "text", text: content.text });
            continue;
          }
          /** Additional content types can be handled here. */
          console.warn(
            `Unsupported content in response: ${JSON.stringify(content)}`,
          );
        }
        continue;
      }
      /** Additional output types can be handled here. */
      console.warn(`Unsupported output in response: ${JSON.stringify(item)}`);
    }
    return {
      message: {
        role: "model",
        contents: contents,
      },
      finishReason: response.status,
      totalTokens: usage.total_tokens,
    };
  }

  /** Execute a Responses API request. */
  makeApiRequest(
    apiMessages: OpenAIMessage[],
    apiTools?: FunctionTool[],
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<OpenAIResponse> {
    console.log("API Request Messages:", JSON.stringify(apiMessages, null, 2));
    return this.client.responses.create(
      {
        model: this.model,
        input: apiMessages,
        tools: apiTools,
        instructions: systemPrompt,
      },
      { signal },
    );
  }

  /** Public generate entrypoint matching LLMClientBase. */
  async generate(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    const apiMessages = this.adaptMessages(messages);
    const apiTools = tools ? this.adaptTools(tools) : undefined;

    const executor = this.retryConfig.enabled
      ? wrapWithRetry(
        this.makeApiRequest.bind(this),
        this.retryConfig,
        this.retryCallback,
      )
      : this.makeApiRequest.bind(this);

    const response = await executor(
      apiMessages,
      apiTools,
      systemPrompt,
      signal,
    );

    return this.adaptResponseFromAPI(response);
  }
}
