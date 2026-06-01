import { AutoLLMClient, type UniEvent } from "@prismshadow/agenthub";

import { GlobalConfig, type EmbeddingConfig } from "../config";
import { resolveEmbeddingModelConfig } from "./embedding_models";

export interface EmbeddingVectorProbeResult {
  values: number[];
  dimensions: number;
}

export class EmbeddingClient {
  private readonly client: AutoLLMClient;
  private readonly config: ReturnType<typeof resolveEmbeddingModelConfig>;

  constructor(config: EmbeddingConfig) {
    this.config = resolveEmbeddingModelConfig(
      GlobalConfig.resolveRuntimeEmbeddingConfig(config),
    );
    this.client = new AutoLLMClient({
      model: this.config.model,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      clientType: this.config.clientType,
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

    const dimensions = dim ?? this.config.dimensions;
    const events: UniEvent[] = [];
    for await (const event of this.client.streamingResponse({
      messages: [
        {
          role: "user",
          content_items: [{ type: "text", text: embeddingContent }],
        },
      ],
      config: {
        embedding_config: dimensions !== undefined ? { dimensions } : undefined,
      },
    })) {
      events.push(event);
    }

    return events
      .flatMap((event) => event.content_items)
      .find((item) => item.type === "embedding")?.embedding;
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
