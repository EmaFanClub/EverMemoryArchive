import OpenAI from "openai";
import type { ClientOptions } from "openai";
import { LLMClientBase } from "./base";
import type { SchemaAdapter } from "../schema";
import type {
  Content,
  LLMResponse,
  Message,
  ModelMessage,
  ToolCall,
  ToolMessage,
  UserMessage,
} from "../schema";
import type { Tool } from "../tools/base";
import { wrapWithRetry } from "../retry";
import { LLMConfig } from "../config";

/** OpenAI-compatible client that adapts EMA schema to Chat Completions. */
export class OpenAIClient extends LLMClientBase implements SchemaAdapter {
  private readonly client: OpenAI;

  constructor(config: LLMConfig) {
    super(config);
    const options: ClientOptions = {
      apiKey: config.apiKey,
      baseURL: config.apiBase,
    };
    this.client = new OpenAI(options);
  }

  /** Map EMA message shape to OpenAI chat format. */
  adaptMessageToAPI(message: Message): Record<string, unknown> {
    if (message.role === "user") {
      const userMessage = message as UserMessage;
      return {
        role: "user",
        content: userMessage.contents.map((content) => ({
          type: "text",
          text: content.text,
        })),
      };
    }
    if (message.role === "model") {
      const modelMessage = message as ModelMessage;
      const content = modelMessage.contents.map((item) => ({
        type: "text",
        text: item.text,
      }));
      const toolCalls = (modelMessage.toolCalls ?? []).map(
        (toolCall, index) => ({
          id: toolCall.id ?? `call_${index}`,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.args ?? {}),
          },
        }),
      );
      return {
        role: "assistant",
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    }
    if (message.role === "tool") {
      const toolMessage = message as ToolMessage;
      return {
        role: "tool",
        tool_call_id: toolMessage.id ?? toolMessage.name,
        content: JSON.stringify(toolMessage.result),
      };
    }
    throw new Error(`Unsupported message: ${message}`);
  }

  /** Map tool definition to OpenAI tool schema. */
  adaptToolToAPI(tool: Tool): Record<string, unknown> {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  /** Convert a batch of EMA messages. */
  adaptMessages(messages: Message[]): Record<string, unknown>[] {
    return messages.map((message) => this.adaptMessageToAPI(message));
  }

  /** Convert a batch of tools. */
  adaptTools(tools: Tool[]): Record<string, unknown>[] {
    return tools.map((tool) => this.adaptToolToAPI(tool));
  }

  /** Normalize OpenAI response into EMA schema. */
  adaptResponseFromAPI(response: any): LLMResponse {
    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new Error("Invalid OpenAI response: missing message");
    }

    const apiMessage = choice.message;
    const contents: Content[] = [];
    if (Array.isArray(apiMessage.content)) {
      for (const part of apiMessage.content) {
        if (part?.type === "text" && typeof part.text === "string") {
          contents.push({ type: "text", text: part.text });
        }
      }
    } else if (typeof apiMessage.content === "string") {
      contents.push({ type: "text", text: apiMessage.content });
    }

    const toolCalls: ToolCall[] = [];
    if (Array.isArray(apiMessage.tool_calls)) {
      for (const call of apiMessage.tool_calls) {
        if (call.function) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs =
              typeof call.function.arguments === "string"
                ? JSON.parse(call.function.arguments)
                : (call.function.arguments as Record<string, unknown>);
          } catch (error) {
            console.warn(
              `Failed to parse tool call arguments: ${call.function.arguments}`,
            );
          }
          toolCalls.push({
            id: call.id,
            name: call.function.name,
            args: parsedArgs ?? {},
          });
        }
      }
    }

    const modelMessage: ModelMessage = {
      role: "model",
      contents,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };

    return {
      message: modelMessage,
      finishReason: choice.finish_reason ?? "",
      totalTokens: response.usage.total_tokens,
    };
  }

  /** Execute a Chat Completions request. */
  makeApiRequest(
    apiMessages: Record<string, unknown>[],
    apiTools?: Record<string, unknown>[],
    systemPrompt?: string,
  ): Promise<any> {
    const messages = [
      { role: "system", content: systemPrompt },
      ...apiMessages,
    ];

    return this.client.chat.completions.create({
      model: this.config.model,
      messages: messages as any[],
      tools: apiTools as any[],
    });
  }

  /** Public generate entrypoint matching LLMClientBase. */
  async generate(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string,
  ): Promise<LLMResponse> {
    const apiMessages = this.adaptMessages(messages);
    const apiTools = tools ? this.adaptTools(tools) : undefined;

    const executor = this.config.retry.enabled
      ? wrapWithRetry(
          this.makeApiRequest.bind(this),
          this.config.retry,
          this.retryCallback,
        )
      : this.makeApiRequest.bind(this);

    const response = await executor(apiMessages, apiTools, systemPrompt);

    return this.adaptResponseFromAPI(response);
  }
}
