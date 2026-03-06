import { LLMClientBase, MessageHistory } from "./base";
import type { Content, LLMResponse, Message, SchemaAdapter } from "../schema";
import type { Tool } from "../tools";
import { FetchWithProxy } from "./proxy";
import {
  GenerateContentResponse as GenAIResponse,
  GoogleGenAI,
  ThinkingLevel,
} from "@google/genai";
import type {
  GoogleGenAIOptions,
  Part as GenAIContent,
  FunctionDeclaration,
} from "@google/genai";
import type { LLMApiConfig, RetryConfig } from "../config";

export interface GenAIMessage {
  role: "user" | "model";
  parts: GenAIContent[];
}

/**
 * A wrapper around the GoogleGenAI class that uses a custom fetch implementation.
 */
export class GenAI extends GoogleGenAI {
  constructor(
    options: GoogleGenAIOptions,
    private readonly fetcher: (
      url: string,
      requestInit?: RequestInit,
    ) => Promise<Response>,
  ) {
    super({ ...options });
    if (!(this.apiClient as any).apiCall) {
      throw new Error("apiCall cannot be patched");
    }
    // Monkey patches apiCall to use our fetch.
    (this.apiClient as any).apiCall = async (url: string, requestInit: any) => {
      return this.fetcher(url, requestInit).catch((e) => {
        throw new Error(`exception ${e} sending request`);
      });
    };
  }
}

/** Google Generative AI client that adapts EMA schema to the native Gemini API format. */
export class GoogleClient
  extends LLMClientBase<GenAIMessage>
  implements SchemaAdapter
{
  private readonly client: GoogleGenAI;

  private readonly thinkingLevelMap = new Map<string, ThinkingLevel>([
    ["gemini-3-flash-preview", ThinkingLevel.MINIMAL],
    ["gemini-3-flash", ThinkingLevel.MINIMAL],
    ["gemini-3-pro-preview", ThinkingLevel.LOW],
    ["gemini-3-pro", ThinkingLevel.LOW],
  ]);

  constructor(
    readonly model: string,
    readonly config: LLMApiConfig,
    readonly retryConfig: RetryConfig,
  ) {
    super();
    const vertexAIOptions: GoogleGenAIOptions = {
      apiVersion: "v1",
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
    };
    const googleAIOptions: GoogleGenAIOptions = {
      apiVersion: "v1",
      apiKey: config.key,
      httpOptions: {
        baseUrl: config.base_url,
      },
    };
    const options: GoogleGenAIOptions =
      process.env.GOOGLE_GENAI_USE_VERTEXAI === "True"
        ? vertexAIOptions
        : googleAIOptions;
    console.log("GoogleClient options:", options);
    this.client = new GenAI(
      options,
      new FetchWithProxy(
        process.env.HTTPS_PROXY || process.env.https_proxy,
      ).createFetcher(),
    );
  }

  /** Adapts an EMA message to a Gemini request content. */
  adaptMessageToAPI(message: Message): GenAIMessage {
    if (message.role !== "user" && message.role !== "model") {
      throw new Error(`Unsupported message role: ${(message as Message).role}`);
    }
    return {
      role: message.role,
      parts: message.contents.map((content): GenAIContent => {
        switch (content.type) {
          case "function_response":
            return {
              functionResponse: {
                name: content.name,
                response: content.result,
              },
            };
          case "function_call":
            return {
              functionCall: {
                name: content.name,
                args: content.args,
              },
            };
          case "text":
            return {
              text: content.text,
              thoughtSignature: content.thoughtSignature,
            };
          default:
            /** Additional content types can be handled here. */
            console.warn(
              `Unsupported content type in message: ${JSON.stringify(content)}`,
            );
            return {};
        }
      }),
    };
  }

  /** Map tool definition to Gemini function declaration. */
  adaptToolToAPI(tool: Tool): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.parameters,
    };
  }

  /** Convert a batch of EMA messages. */
  appendMessage(history: GenAIMessage[], message: Message): GenAIMessage[] {
    const converted = this.adaptMessageToAPI(message);
    const lastMsg = history[history.length - 1];
    if (lastMsg && lastMsg.role === converted.role) {
      lastMsg.parts.push(...converted.parts);
    } else {
      history.push(converted);
    }
    return history;
  }

  /** Convert a batch of tools. */
  adaptTools(tools: Tool[]): FunctionDeclaration[] {
    return tools.map((tool) => this.adaptToolToAPI(tool));
  }

  /** Normalize Gemini response back into EMA schema. */
  adaptResponseFromAPI(response: GenAIResponse): LLMResponse {
    const usageMetadata = response.usageMetadata;
    const candidate = response.candidates?.[0];
    /** Handle some invalid response cases. */
    if (!usageMetadata || typeof usageMetadata.totalTokenCount !== "number") {
      throw new Error(
        `Missing or invalid usage metadata in response: ${JSON.stringify(response)}`,
      );
    }
    if (!candidate || !candidate.content || !candidate.content.parts) {
      console.warn(
        `No valid candidate in response: ${JSON.stringify(response)}`,
      );
      return {
        message: {
          role: "model",
          contents: [],
        },
        finishReason: "NO_CANDIDATE",
        totalTokens: usageMetadata.totalTokenCount,
      };
    }
    if (!candidate.finishReason || candidate.finishReason !== "STOP") {
      console.warn(
        `Non-stop finish reason in response: ${JSON.stringify(response)}`,
      );
      return {
        message: {
          role: "model",
          contents: [],
        },
        finishReason: candidate.finishReason ?? "UNKNOWN",
        totalTokens: usageMetadata.totalTokenCount,
      };
    }
    /** Handle valid response content parts in response. */
    const contents: Content[] = [];
    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        if (!part.functionCall.name || !part.functionCall.args) {
          console.warn(
            `Invalid function call part in response: ${JSON.stringify(part)}`,
          );
          continue;
        }
        contents.push({
          type: "function_call",
          id: part.functionCall.id,
          name: part.functionCall.name,
          args: part.functionCall.args,
          thoughtSignature: part.thoughtSignature,
        });
        continue;
      }
      if (part.text) {
        contents.push({
          type: "text",
          text: part.text,
          thoughtSignature: part.thoughtSignature,
        });
        continue;
      }
      /** Additional part types can be handled here. */
      console.warn(`Unsupported part in response: ${JSON.stringify(part)}`);
    }
    return {
      message: {
        role: "model",
        contents: contents,
      },
      finishReason: candidate.finishReason,
      totalTokens: usageMetadata.totalTokenCount,
    };
  }

  /** Execute a Gemini content-generation request. */
  async makeApiRequest(
    history: MessageHistory<GenAIMessage>,
    apiTools?: FunctionDeclaration[],
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    return this.adaptResponseFromAPI(
      await this.client.models.generateContent({
        model: this.model,
        contents: history.getApiMessagesForClient(this),
        config: {
          candidateCount: 1,
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations: apiTools }],
          abortSignal: signal,
          thinkingConfig: {
            thinkingLevel: this.thinkingLevelMap.get(this.model),
          },
        },
      }),
    );
  }
}
