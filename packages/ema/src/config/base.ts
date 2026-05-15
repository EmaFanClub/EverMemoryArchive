import type { LLMConfig } from "../llm/base";

export type { LLMConfig };

/** Supported embedding providers. */
export type EmbeddingProvider = "openai" | "google";

/** MongoDB configuration resolved before the server can start. */
export interface MongoConfig {
  readonly kind: "memory" | "remote";
  readonly uri: string;
  readonly dbName: string;
}

/** Runtime paths derived from the fixed data root. */
export interface RuntimePaths {
  readonly dataRoot: string;
  readonly logsDir: string;
  readonly workspaceDir: string;
}

/** Development-only bootstrap behavior derived from mode and Mongo kind. */
export interface DevBootstrapConfig {
  readonly restoreDefaultSnapshot: boolean;
}

/** Process bootstrap configuration that is not stored in the database. */
export interface BootstrapConfig {
  readonly mode: "dev" | "prod";
  readonly mongo: MongoConfig;
  readonly paths: RuntimePaths;
  readonly httpsProxy: string;
  readonly devBootstrap?: DevBootstrapConfig;
}

/** Complete embedding configuration used at runtime. */
export interface EmbeddingConfig {
  readonly provider: EmbeddingProvider;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

/** Actor-scoped web search configuration. */
export interface WebSearchConfig {
  readonly enabled: boolean;
  readonly tavilyApiKey: string;
}

/** Actor-scoped channel configuration. */
export interface ChannelConfig {
  readonly qq: QQChannelConfig;
}

/** QQ channel configuration. */
export interface QQChannelConfig {
  readonly enabled: boolean;
  readonly wsUrl: string;
  readonly accessToken: string;
}

/** Database-backed global runtime configuration. */
export interface GlobalConfigRecord {
  readonly id: "global";
  readonly version: 1;
  readonly accessToken?: string;
  readonly defaultLlm: LLMConfig;
  readonly defaultEmbedding: EmbeddingConfig;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  enabled: false,
  tavilyApiKey: "",
};

export const DEFAULT_CHANNEL_CONFIG: ChannelConfig = {
  qq: {
    enabled: false,
    wsUrl: "ws://127.0.0.1:3001",
    accessToken: "",
  },
};

/** Returns a detached copy of a JSON-like config object. */
export function cloneConfig<T>(value: T): T {
  return structuredClone(value);
}
