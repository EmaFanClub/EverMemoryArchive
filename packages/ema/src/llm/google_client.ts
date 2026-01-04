import { LLMClientBase } from "./base";
import {
  type SchemaAdapter,
  isModelMessage,
  isToolMessage,
  isUserMessage,
} from "../schema";
import { GoogleGenAI } from "@google/genai";
import { type GoogleGenAIOptions, ThinkingLevel } from "@google/genai";
import type { Tool } from "../tools/base";
import { wrapWithRetry } from "../retry";
import type {
  ToolCall,
  Content,
  Message,
  ModelMessage,
  LLMResponse,
} from "../schema";
import type { LLMApiConfig, RetryConfig } from "../config";

/** Google Generative AI client that adapts EMA schema to the native Gemini API format. */
export class GoogleClient extends LLMClientBase implements SchemaAdapter {
  private readonly client: GoogleGenAI;

  constructor(
    readonly model: string,
    readonly config: LLMApiConfig,
    readonly retryConfig: RetryConfig,
  ) {
    super();
    const options: GoogleGenAIOptions = {
      apiKey: config.key,
      httpOptions: {
        baseUrl: config.base_url,
      },
    };
    this.client = new GoogleGenAI(options);
  }

  /** Map EMA message shape to Gemini request content. */
  adaptMessageToAPI(message: Message): Record<string, unknown> {
    if (isUserMessage(message)) {
      const parts: any[] = message.contents.map((content) => {
        if (content.type === "text") {
          return { text: content.text };
        }
        throw new Error(`Unsupported content type: ${content.type}`);
      });
      return { role: "user", parts: parts };
    }
    if (isModelMessage(message)) {
      const parts: any[] = message.contents.map((content) => {
        if (content.type === "text") {
          return { text: content.text };
        }
        throw new Error(`Unsupported content type: ${content.type}`);
      });
      (message.toolCalls ?? []).forEach((toolCall) => {
        parts.push({
          functionCall: {
            name: toolCall.name,
            args: toolCall.args,
          },
          thoughtSignature: toolCall.thoughtSignature,
        });
      });
      return { role: "model", parts: parts };
    }
    if (isToolMessage(message)) {
      const parts: any[] = [
        {
          functionResponse: {
            name: message.name,
            response: message.result,
          },
        },
      ];
      return { role: "user", parts: parts };
    }
    throw new Error(
      `Unsupported message with role "${String(
        (message as any)?.role,
      )}": ${JSON.stringify(message)}`,
    );
  }

  /** Map tool definition to Gemini function declaration. */
  adaptToolToAPI(tool: Tool): Record<string, unknown> {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    };
  }

  /** Convert a batch of EMA messages. */
  adaptMessages(messages: Message[]): Record<string, unknown>[] {
    const apiMessages = messages.map((message) =>
      this.adaptMessageToAPI(message),
    );
    return apiMessages;
  }

  /** Convert a batch of tools. */
  adaptTools(tools: Tool[]): Record<string, unknown>[] {
    return tools.map((tool) => this.adaptToolToAPI(tool));
  }

  /** Normalize Gemini response back into EMA schema. */
  adaptResponseFromAPI(response: any): LLMResponse {
    const candidate = response.candidates?.[0];
    if (!candidate?.content) {
      throw new Error("Invalid Google response: missing message");
    }
    const message = candidate.content;
    const contents: Content[] = [];
    const toolCalls: ToolCall[] = [];
    if (candidate.content.parts) {
      for (const part of message.parts) {
        if (part.text !== undefined) {
          contents.push({ type: "text", text: part.text });
        } else if (part.functionCall) {
          toolCalls.push({
            name: part.functionCall.name,
            args: part.functionCall.args,
            thoughtSignature: part.thoughtSignature,
          });
        } else {
          console.warn(`Unknown message part: ${JSON.stringify(part)}`);
        }
      }
    }
    const modelMessage: ModelMessage = {
      role: "model",
      contents: contents,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    return {
      message: modelMessage,
      finishReason: response.candidates[0].finishReason,
      totalTokens: response.usageMetadata?.totalTokenCount,
    };
  }

  /** Execute a Gemini content-generation request. */
  makeApiRequest(
    apiMessages: Record<string, unknown>[],
    apiTools?: Record<string, unknown>[],
    systemPrompt?: string,
  ): Promise<any> {
    return this.client.models.generateContent({
      model: this.model,
      contents: apiMessages,
      config: {
        candidateCount: 1,
        systemInstruction: systemPrompt,
        tools: apiTools ? [{ functionDeclarations: apiTools }] : [],
        thinkingConfig: ["gemini-3-flash-preview", "gemini-3-flash"].includes(
          this.model,
        )
          ? {
              thinkingLevel: ThinkingLevel.MINIMAL,
            }
          : undefined,
      },
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

    const executor = this.retryConfig.enabled
      ? wrapWithRetry(
          this.makeApiRequest.bind(this),
          this.retryConfig,
          this.retryCallback,
        )
      : this.makeApiRequest.bind(this);

    const response = await executor(apiMessages, apiTools, systemPrompt);

    return this.adaptResponseFromAPI(response);
  }
}
