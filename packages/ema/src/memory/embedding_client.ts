import { GoogleGenAI } from "@google/genai";
import type { GoogleGenAIOptions } from "@google/genai";
import OpenAI from "openai";

import { GlobalConfig, type EmbeddingConfig } from "../config";
import {
  buildGoogleVertexAIOptions,
  GenAI,
  GOOGLE_AI_API_VERSION,
  isGoogleVertexCredentialsJson,
} from "./google_auth";
import { FetchWithProxy } from "../shared/proxy";

export interface EmbeddingVectorProbeResult {
  values: number[];
  dimensions: number;
}

export class EmbeddingClient {
  private readonly googleClient?: GoogleGenAI;
  private readonly openaiClient?: OpenAI;
  private readonly model: string;
  private readonly config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = GlobalConfig.resolveRuntimeEmbeddingConfig(config);
    if (this.config.provider === "google") {
      if (!this.config.model) {
        throw new Error("Google embedding model is required.");
      }
      if (!this.config.apiKey) {
        throw new Error(
          "Google API key or Vertex AI credentials JSON is required.",
        );
      }
      this.model = this.config.model;
      const googleAIOptions: GoogleGenAIOptions = {
        apiVersion: GOOGLE_AI_API_VERSION,
        vertexai: false,
        apiKey: this.config.apiKey,
      };
      if (
        this.config.baseUrl &&
        this.config.baseUrl !== "https://generativelanguage.googleapis.com"
      ) {
        googleAIOptions.httpOptions = {
          baseUrl: this.config.baseUrl,
        };
      }
      const options = isGoogleVertexCredentialsJson(this.config.apiKey)
        ? buildGoogleVertexAIOptions({ credentialsJson: this.config.apiKey })
        : googleAIOptions;
      this.googleClient = new GenAI(
        options,
        new FetchWithProxy(GlobalConfig.httpsProxy).createFetcher(),
      );
      return;
    }

    this.model = this.config.model;
    if (!this.model || !this.config.apiKey) {
      throw new Error("OpenAI embedding model and API key are required.");
    }
    this.openaiClient = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      fetch: new FetchWithProxy(GlobalConfig.httpsProxy).createFetcher(),
    });
  }

  async createEmbedding(
    dim: number | undefined,
    input: string,
  ): Promise<number[] | undefined> {
    const embeddingContent = input.trim();
    if (!embeddingContent) {
      return undefined;
    }

    if (this.googleClient) {
      const response = await this.googleClient.models.embedContent({
        model: this.model,
        contents: [embeddingContent],
        config: {
          taskType: "RETRIEVAL_QUERY",
          ...(dim ? { outputDimensionality: dim } : {}),
        },
      });
      return response.embeddings?.[0]?.values;
    }

    if (!this.openaiClient) {
      throw new Error(
        `Unsupported embedding provider: ${this.config.provider}`,
      );
    }
    const response = await this.openaiClient.embeddings.create({
      model: this.model,
      input: embeddingContent,
      ...(dim ? { dimensions: dim } : {}),
    });
    return response.data[0]?.embedding;
  }

  async probe(
    input = "EMA embedding probe",
  ): Promise<EmbeddingVectorProbeResult> {
    const values = await this.createEmbedding(undefined, input);
    if (!values?.length) {
      throw new Error("Embedding provider returned an empty vector.");
    }
    return {
      values,
      dimensions: values.length,
    };
  }
}
