import type { EmbeddingConfig } from "../config";

export type EmbeddingProvider = "google";

export interface EmbeddingModelCapabilities {
  dimensions: number[];
}

export interface EmbeddingRequestDefaults {
  dimensions?: number;
}

export interface EmbeddingModelDefinition {
  model: string;
  provider: EmbeddingProvider;
  clientType: string;
  defaultBaseUrl: string;
  capabilities: EmbeddingModelCapabilities;
  requestDefaults: EmbeddingRequestDefaults;
}

export interface EmbeddingModelConfig extends EmbeddingConfig {
  provider: EmbeddingProvider;
  clientType: string;
  capabilities: EmbeddingModelCapabilities;
  requestDefaults: EmbeddingRequestDefaults;
}

const RECOMMENDED_GEMINI_EMBEDDING_DIMENSIONS = [768, 1536, 3072];

export const EMBEDDING_MODEL_DEFINITIONS = [
  {
    model: "gemini-embedding-2",
    provider: "google",
    clientType: "gemini-embedding",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    capabilities: {
      dimensions: RECOMMENDED_GEMINI_EMBEDDING_DIMENSIONS,
    },
    requestDefaults: {
      dimensions: 3072,
    },
  },
  {
    model: "gemini-embedding-001",
    provider: "google",
    clientType: "gemini-embedding",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    capabilities: {
      dimensions: RECOMMENDED_GEMINI_EMBEDDING_DIMENSIONS,
    },
    requestDefaults: {
      dimensions: 3072,
    },
  },
] as const satisfies readonly EmbeddingModelDefinition[];

export type EmbeddingModel =
  (typeof EMBEDDING_MODEL_DEFINITIONS)[number]["model"];

export function resolveEmbeddingModelDefinition(
  model: string,
): EmbeddingModelDefinition {
  const definition = EMBEDDING_MODEL_DEFINITIONS.find(
    (candidate) => candidate.model === model,
  );
  if (!definition) {
    throw new Error(`Unsupported embedding model: ${model}`);
  }
  return definition;
}

export function listEmbeddingModelDefinitions(): EmbeddingModelDefinition[] {
  return EMBEDDING_MODEL_DEFINITIONS.map((definition) => ({
    ...definition,
    capabilities: {
      dimensions: [...definition.capabilities.dimensions],
    },
    requestDefaults: {
      ...definition.requestDefaults,
    },
  }));
}

export function resolveEmbeddingModelConfig(
  config: EmbeddingConfig,
): EmbeddingModelConfig {
  const definition = resolveEmbeddingModelDefinition(config.model);
  const dimensions = config.dimensions ?? definition.requestDefaults.dimensions;
  if (
    dimensions !== undefined &&
    !definition.capabilities.dimensions.includes(dimensions)
  ) {
    throw new Error(
      `${config.model} does not support embedding dimensions: ${dimensions}`,
    );
  }

  return {
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    ...(dimensions !== undefined ? { dimensions } : {}),
    provider: definition.provider,
    clientType: definition.clientType,
    capabilities: {
      dimensions: [...definition.capabilities.dimensions],
    },
    requestDefaults: {
      ...definition.requestDefaults,
    },
  };
}
