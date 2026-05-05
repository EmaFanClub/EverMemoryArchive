/** Supported chat LLM providers. */
export type LLMProvider = "openai" | "google";

/** Supported embedding providers. */
export type EmbeddingProvider = "openai" | "google";

/** Runtime system configuration resolved from bootstrap and database config. */
export interface SystemConfig {
  readonly mode: "dev" | "prod";
  readonly dataRoot: string;
  readonly logsDir: string;
  readonly httpsProxy: string;
}

/** MongoDB configuration resolved before the server can start. */
export interface MongoConfig {
  readonly kind: "memory" | "remote";
  readonly uri: string;
  readonly dbName: string;
}

/** Agent runtime configuration derived from the data root. */
export interface AgentConfig {
  readonly workspaceDir: string;
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
  readonly devBootstrap: DevBootstrapConfig;
}

/** OpenAI-compatible chat LLM configuration. */
export interface OpenAILLMConfig {
  readonly mode: "chat" | "responses";
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

/** Google chat LLM configuration. */
export interface GoogleLLMConfig {
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly useVertexAi: boolean;
  readonly project: string;
  readonly location: string;
  /** Raw Vertex AI credentials JSON. Field name is kept for stored config compatibility. */
  readonly credentialsFile: string;
}

/** Complete chat LLM configuration used at runtime. */
export interface LLMConfig {
  readonly provider: LLMProvider;
  readonly openai: OpenAILLMConfig;
  readonly google: GoogleLLMConfig;
}

/** OpenAI embedding configuration. */
export interface OpenAIEmbeddingConfig {
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

/** Google embedding configuration. */
export interface GoogleEmbeddingConfig {
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly useVertexAi: boolean;
  readonly project: string;
  readonly location: string;
  /** Raw Vertex AI credentials JSON. Field name is kept for stored config compatibility. */
  readonly credentialsFile: string;
}

/** Complete embedding configuration used at runtime. */
export interface EmbeddingConfig {
  readonly provider: EmbeddingProvider;
  readonly openai: OpenAIEmbeddingConfig;
  readonly google: GoogleEmbeddingConfig;
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
  readonly system: {
    readonly httpsProxy: string;
  };
  readonly defaultLlm: LLMConfig;
  readonly defaultEmbedding: EmbeddingConfig;
  readonly defaultWebSearch: WebSearchConfig;
  readonly defaultChannel: ChannelConfig;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

/** Hardcoded maximum number of agent loop steps. */
export const DEFAULT_AGENT_MAX_STEPS = 50;

/** Hardcoded token limit for agent context management. */
export const DEFAULT_AGENT_TOKEN_LIMIT = 80000;

/** Default OpenAI base URL. */
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Default Google Generative AI base URL. */
export const DEFAULT_GOOGLE_BASE_URL =
  "https://generativelanguage.googleapis.com";

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  mode: "dev",
  dataRoot: ".ema",
  logsDir: ".ema/logs",
  httpsProxy: "",
};

export const DEFAULT_MONGO_CONFIG: MongoConfig = {
  kind: "memory",
  uri: "mongodb://localhost:27017",
  dbName: "ema",
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  workspaceDir: ".ema/workspace",
};

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: "google",
  openai: {
    mode: "responses",
    model: "gpt-5.4",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKey: "",
  },
  google: {
    model: "gemini-3.1-pro-preview",
    baseUrl: DEFAULT_GOOGLE_BASE_URL,
    apiKey: "",
    useVertexAi: false,
    project: "",
    location: "",
    credentialsFile: "",
  },
};

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "google",
  openai: {
    model: "text-embedding-3-large",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKey: "",
  },
  google: {
    model: "gemini-embedding-001",
    baseUrl: DEFAULT_GOOGLE_BASE_URL,
    apiKey: "",
    useVertexAi: false,
    project: "",
    location: "",
    credentialsFile: "",
  },
};

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
