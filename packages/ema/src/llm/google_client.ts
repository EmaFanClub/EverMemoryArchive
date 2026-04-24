import { LLMClientBase } from "./base";
import {
  isModelMessage,
  isUserMessage,
  isFunctionCall,
  isFunctionResponse,
  isInlineDataItem,
  isTextItem,
} from "../shared/schema";
import type {
  Content,
  LLMResponse,
  Message,
  SchemaAdapter,
} from "../shared/schema";
import type { Tool } from "../tools";
import { wrapWithRetry } from "./retry";
import { FetchWithProxy } from "./proxy";
import {
  DEFAULT_GOOGLE_BASE_URL,
  GlobalConfig,
  type GoogleLLMConfig,
  type RetryConfig,
} from "../config/index";
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

export interface GenAIMessage {
  role: "user" | "model";
  parts: GenAIContent[];
}

export const GOOGLE_AI_API_VERSION = "v1beta";
export const VERTEX_AI_API_VERSION = "v1";

/** Appends the API version when a custom Google base URL omits it. */
export function withGoogleApiVersion(
  baseUrl: string,
  apiVersion: string,
): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/v\d+(beta|alpha)?$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/${apiVersion}`;
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
    const restoreEnv = suppressGoogleApiKeyEnvForVertex(options);
    try {
      super({ ...options });
    } finally {
      restoreEnv();
    }
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

function suppressGoogleApiKeyEnvForVertex(
  options: GoogleGenAIOptions,
): () => void {
  if (!options.vertexai) {
    return () => {};
  }

  const googleApiKey = process.env.GOOGLE_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;

  return () => {
    if (googleApiKey === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = googleApiKey;
    }
    if (geminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = geminiApiKey;
    }
  };
}

/** Google Generative AI client that adapts EMA schema to the native Gemini API format. */
export class GoogleClient extends LLMClientBase implements SchemaAdapter {
  private readonly client: GoogleGenAI;

  private readonly thinkingLevelMap = new Map<string, ThinkingLevel>([
    ["gemini-3.1-flash-lite-preview", ThinkingLevel.HIGH],
    ["gemini-3.1-pro-preview-customtools", ThinkingLevel.LOW],
    ["gemini-3.1-pro-preview", ThinkingLevel.LOW],
  ]);

  constructor(
    readonly config: GoogleLLMConfig,
    readonly retryConfig: RetryConfig,
  ) {
    super();
    const vertexAIOptions: GoogleGenAIOptions = {
      apiVersion: VERTEX_AI_API_VERSION,
      vertexai: true,
      project: config.project,
      location: config.location,
    };
    const googleAIOptions: GoogleGenAIOptions = {
      apiVersion: GOOGLE_AI_API_VERSION,
      vertexai: false,
      apiKey: config.apiKey,
    };
    if (config.baseUrl && config.baseUrl !== DEFAULT_GOOGLE_BASE_URL) {
      googleAIOptions.httpOptions = {
        baseUrl: withGoogleApiVersion(config.baseUrl, GOOGLE_AI_API_VERSION),
      };
    }
    const options: GoogleGenAIOptions = config.useVertexAi
      ? vertexAIOptions
      : googleAIOptions;
    this.client = new GenAI(
      options,
      new FetchWithProxy(GlobalConfig.system.httpsProxy).createFetcher(),
    );
  }

  /** Map EMA message shape to Gemini request content. */
  adaptMessageToAPI(message: Message): GenAIMessage {
    /** Handle user messages by converting tool responses and contents to Gemini parts. */
    if (isUserMessage(message)) {
      const contents: GenAIContent[] = [];
      for (const content of message.contents) {
        if (isFunctionResponse(content)) {
          contents.push({
            functionResponse: {
              name: content.name,
              response: content.result,
              ...(content.parts
                ? {
                    parts: content.parts.map((part) => ({
                      inlineData: {
                        mimeType: part.mimeType,
                        data: part.data,
                      },
                    })),
                  }
                : {}),
            },
          });
          continue;
        }
        if (isTextItem(content)) {
          contents.push({
            text: content.text,
            thoughtSignature: content.thoughtSignature,
          });
          continue;
        }
        if (isInlineDataItem(content)) {
          contents.push({
            inlineData: {
              mimeType: content.mimeType,
              data: content.data,
            },
          });
          continue;
        }
        /** Additional content types can be handled here. */
      }
      return { role: "user", parts: contents };
    }
    /** Handle model messages by converting contents and tool calls to Gemini parts. */
    if (isModelMessage(message)) {
      const contents: GenAIContent[] = [];
      for (const content of message.contents) {
        if (isFunctionCall(content)) {
          contents.push({
            functionCall: {
              name: content.name,
              args: content.args,
            },
            thoughtSignature: content.thoughtSignature,
          });
          continue;
        }
        if (isTextItem(content)) {
          contents.push({
            text: content.text,
            thoughtSignature: content.thoughtSignature,
          });
          continue;
        }
        if (isInlineDataItem(content)) {
          contents.push({
            inlineData: {
              mimeType: content.mimeType,
              data: content.data,
            },
          });
          continue;
        }
        /** Additional content types can be handled here. */
      }
      return { role: "model", parts: contents };
    }
    throw new Error(`Unsupported message role: ${(message as Message).role}`);
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
  adaptMessages(messages: Message[]): GenAIMessage[] {
    const history: GenAIMessage[] = [];
    for (const msg of messages) {
      const converted = this.adaptMessageToAPI(msg);
      const lastMsg = history[history.length - 1];
      if (lastMsg && lastMsg.role === converted.role) {
        lastMsg.parts.push(...converted.parts);
      } else {
        history.push(converted);
      }
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
  makeApiRequest(
    apiMessages: GenAIMessage[],
    apiTools?: FunctionDeclaration[],
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<GenAIResponse> {
    return this.client.models.generateContent({
      model: this.config.model,
      contents: apiMessages,
      config: {
        candidateCount: 1,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: apiTools }],
        abortSignal: signal,
        thinkingConfig: {
          thinkingLevel: this.thinkingLevelMap.get(this.config.model),
        },
      },
    });
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
