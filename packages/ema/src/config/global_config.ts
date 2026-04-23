import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml } from "smol-toml";
import { z } from "zod";

import type { Fs } from "../fs";
import { RealFs } from "../fs";
import {
  cloneConfig,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_CHANNEL_CONFIG,
  DEFAULT_DEV_SEED,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_LLM_CONFIG,
  DEFAULT_MONGO_CONFIG,
  DEFAULT_SYSTEM_CONFIG,
  DEFAULT_WEB_SEARCH_CONFIG,
  type AgentConfig,
  type ChannelConfig,
  type DevSeedConfig,
  type EmbeddingConfig,
  type LLMConfig,
  type MongoConfig,
  type SystemConfig,
  type WebSearchConfig,
} from "./base";

const DEFAULT_OPENAI_LLM_ENV_KEY = "OPENAI_API_KEY";
const DEFAULT_GOOGLE_LLM_ENV_KEY = "GEMINI_API_KEY";
const DEFAULT_OPENAI_EMBEDDING_ENV_KEY = "OPENAI_API_KEY";
const DEFAULT_GOOGLE_EMBEDDING_ENV_KEY = "GEMINI_API_KEY";
const DEFAULT_GOOGLE_PROJECT_ENV_KEY = "GOOGLE_CLOUD_PROJECT";
const DEFAULT_GOOGLE_LOCATION_ENV_KEY = "GOOGLE_CLOUD_LOCATION";

const RawOpenAILLMSchema = z
  .object({
    mode: z.enum(["chat", "responses"]).default(DEFAULT_LLM_CONFIG.openai.mode),
    model: z.string().default(DEFAULT_LLM_CONFIG.openai.model),
    base_url: z.string().default(DEFAULT_LLM_CONFIG.openai.baseUrl),
    api_key: z.string().optional(),
    env_key: z.string().default(DEFAULT_OPENAI_LLM_ENV_KEY),
  })
  .default({} as any);

const RawGoogleLLMSchema = z
  .object({
    model: z.string().default(DEFAULT_LLM_CONFIG.google.model),
    base_url: z.string().default(DEFAULT_LLM_CONFIG.google.baseUrl),
    api_key: z.string().optional(),
    env_key: z.string().default(DEFAULT_GOOGLE_LLM_ENV_KEY),
    use_vertex_ai: z.boolean().default(DEFAULT_LLM_CONFIG.google.useVertexAi),
    project: z.string().optional(),
    project_env_key: z.string().default(DEFAULT_GOOGLE_PROJECT_ENV_KEY),
    location: z.string().optional(),
    location_env_key: z.string().default(DEFAULT_GOOGLE_LOCATION_ENV_KEY),
  })
  .default({} as any);

const RawOpenAIEmbeddingSchema = z
  .object({
    model: z.string().default(DEFAULT_EMBEDDING_CONFIG.openai.model),
    base_url: z.string().default(DEFAULT_EMBEDDING_CONFIG.openai.baseUrl),
    api_key: z.string().optional(),
    env_key: z.string().default(DEFAULT_OPENAI_EMBEDDING_ENV_KEY),
  })
  .default({} as any);

const RawGoogleEmbeddingSchema = z
  .object({
    model: z.string().default(DEFAULT_EMBEDDING_CONFIG.google.model),
    base_url: z.string().default(DEFAULT_EMBEDDING_CONFIG.google.baseUrl),
    api_key: z.string().optional(),
    env_key: z.string().default(DEFAULT_GOOGLE_EMBEDDING_ENV_KEY),
    use_vertex_ai: z
      .boolean()
      .default(DEFAULT_EMBEDDING_CONFIG.google.useVertexAi),
    project: z.string().optional(),
    project_env_key: z.string().default(DEFAULT_GOOGLE_PROJECT_ENV_KEY),
    location: z.string().optional(),
    location_env_key: z.string().default(DEFAULT_GOOGLE_LOCATION_ENV_KEY),
  })
  .default({} as any);

const RawConfigSchema = z.object({
  system: z
    .object({
      mode: z.enum(["dev", "prod"]).default(DEFAULT_SYSTEM_CONFIG.mode),
      data_root: z.string().default(DEFAULT_SYSTEM_CONFIG.dataRoot),
      logs_dir: z.string().default(DEFAULT_SYSTEM_CONFIG.logsDir),
      https_proxy: z.string().default(DEFAULT_SYSTEM_CONFIG.httpsProxy),
      dev: z
        .object({
          restore_default_snapshot: z
            .boolean()
            .default(DEFAULT_SYSTEM_CONFIG.dev.restoreDefaultSnapshot),
          require_dev_seed: z
            .boolean()
            .default(DEFAULT_SYSTEM_CONFIG.dev.requireDevSeed),
        })
        .default({} as any),
    })
    .default({} as any),
  mongo: z
    .object({
      kind: z.enum(["memory", "remote"]).default(DEFAULT_MONGO_CONFIG.kind),
      uri: z.string().default(DEFAULT_MONGO_CONFIG.uri),
      db_name: z.string().default(DEFAULT_MONGO_CONFIG.dbName),
    })
    .default({} as any),
  agent: z
    .object({
      workspace_dir: z.string().default(DEFAULT_AGENT_CONFIG.workspaceDir),
    })
    .default({} as any),
  default_llm: z
    .object({
      provider: z
        .enum(["openai", "google"])
        .default(DEFAULT_LLM_CONFIG.provider),
      openai: RawOpenAILLMSchema,
      google: RawGoogleLLMSchema,
    })
    .default({} as any),
  default_embedding: z
    .object({
      provider: z
        .enum(["openai", "google"])
        .default(DEFAULT_EMBEDDING_CONFIG.provider),
      openai: RawOpenAIEmbeddingSchema,
      google: RawGoogleEmbeddingSchema,
    })
    .default({} as any),
});

type RawConfig = z.infer<typeof RawConfigSchema>;

type EnvGetter = (name: string) => string | undefined;

export type GlobalConfigErrorCode =
  | "config_not_found"
  | "config_parse_failed"
  | "config_invalid";

/**
 * Structured error raised when loading config/config.toml fails.
 */
export class GlobalConfigError extends Error {
  constructor(
    readonly code: GlobalConfigErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GlobalConfigError";
  }
}

const RuntimeOpenAILLMSchema = z
  .object({
    mode: z.enum(["chat", "responses"]),
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
  })
  .strict();

const RuntimeGoogleLLMSchema = z
  .object({
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
    useVertexAi: z.boolean(),
    project: z.string(),
    location: z.string(),
  })
  .strict();

const RuntimeLLMSchema = z
  .object({
    provider: z.enum(["openai", "google"]),
    openai: RuntimeOpenAILLMSchema,
    google: RuntimeGoogleLLMSchema,
  })
  .strict();

const RuntimeWebSearchSchema = z
  .object({
    enabled: z.boolean(),
    tavilyApiKey: z.string(),
  })
  .strict();

const RuntimeChannelSchema = z
  .object({
    qq: z
      .object({
        enabled: z.boolean(),
        wsUrl: z.string(),
        accessToken: z.string(),
      })
      .strict(),
  })
  .strict();

const RawDevSeedSchema = z.object({
  users: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      email: z.string().min(1),
      description: z.string(),
      avatar: z.string(),
    }),
  ),
  roles: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      prompt: z.string().min(1),
    }),
  ),
  actors: z.array(
    z
      .object({
        id: z.number().int().positive(),
        roleId: z.number().int().positive(),
        llmConfig: RuntimeLLMSchema.optional(),
        webSearchConfig: RuntimeWebSearchSchema.optional(),
        channelConfig: RuntimeChannelSchema.optional(),
      })
      .strict(),
  ),
  userOwnActors: z.array(
    z.object({
      userId: z.number().int().positive(),
      actorId: z.number().int().positive(),
    }),
  ),
  identityBindings: z.array(
    z.object({
      userId: z.number().int().positive(),
      channel: z.enum(["web", "qq"]),
      uid: z.string().min(1),
    }),
  ),
  conversations: z.array(
    z.object({
      actorId: z.number().int().positive(),
      channel: z.enum(["web", "qq"]),
      type: z.enum(["chat", "group"]),
      uid: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      allowProactive: z.boolean(),
    }),
  ),
});

/** Process-wide configuration loaded from config/config.toml. */
export class GlobalConfig {
  private static instance: GlobalConfig | null = null;

  constructor(
    readonly system: SystemConfig,
    readonly mongo: MongoConfig,
    readonly agent: AgentConfig,
    readonly defaultLlm: LLMConfig,
    readonly defaultEmbedding: EmbeddingConfig,
  ) {}

  /** Absolute path to the default config.toml file. */
  static get configPath(): string {
    return path.join(getWorkspaceRoot(), "config", "config.toml");
  }

  /** Absolute path to the development seed JSON file. */
  static get devSeedPath(): string {
    return path.join(getWorkspaceRoot(), "config", "dev.seed.json");
  }

  /** Example config.toml content used for first-run file creation and tests. */
  static get example(): string {
    return buildExampleToml();
  }

  /** Example dev.seed.json content used for first-run file creation and tests. */
  static get devSeedExample(): string {
    return JSON.stringify(DEFAULT_DEV_SEED, null, 2);
  }

  /** Loads the singleton configuration from config.toml. */
  static async load(fs: Fs = new RealFs()): Promise<Readonly<GlobalConfig>> {
    if (this.instance) {
      return this.instance;
    }

    await loadDotEnvFile(fs);

    const configPath = this.configPath;
    if (!(await fs.exists(configPath))) {
      await fs.write(configPath, this.example);
      throw new GlobalConfigError(
        "config_not_found",
        [
          "EMA config not found.",
          "",
          "A template config file has been created at:",
          `  ${configPath}`,
          "",
          "Please edit this file and restart the server.",
        ].join("\n"),
      );
    }

    const content = await fs.read(configPath);
    let parsed: unknown;
    try {
      parsed = parseToml(content);
    } catch (error) {
      throw new GlobalConfigError(
        "config_parse_failed",
        [
          "Failed to parse EMA config:",
          `  ${configPath}`,
          "",
          "Reason:",
          `  ${(error as Error).message}`,
        ].join("\n"),
      );
    }

    const rawResult = RawConfigSchema.safeParse(parsed);
    if (!rawResult.success) {
      const issues = rawResult.error.issues.map(
        (issue) => `  - ${issue.path.join(".") || "config"}: ${issue.message}`,
      );
      throw new GlobalConfigError(
        "config_invalid",
        [
          "Invalid EMA config:",
          `  ${configPath}`,
          "",
          "Issues:",
          ...issues,
        ].join("\n"),
      );
    }

    this.instance = fromRawConfig(rawResult.data, getProcessEnv);
    return this.instance;
  }

  static get system(): SystemConfig {
    return this.loaded.system;
  }

  static get mongo(): MongoConfig {
    return this.loaded.mongo;
  }

  static get agent(): AgentConfig {
    return this.loaded.agent;
  }

  static get defaultLlm(): LLMConfig {
    return this.loaded.defaultLlm;
  }

  static get defaultEmbedding(): EmbeddingConfig {
    return this.loaded.defaultEmbedding;
  }

  static get defaultWebSearch(): WebSearchConfig {
    return cloneConfig(DEFAULT_WEB_SEARCH_CONFIG);
  }

  static get defaultChannel(): ChannelConfig {
    return cloneConfig(DEFAULT_CHANNEL_CONFIG);
  }

  /**
   * Loads development seed data from config/dev.seed.json.
   * Returns null when the seed file is absent.
   */
  static async loadDevSeed(
    fs: Fs = new RealFs(),
  ): Promise<DevSeedConfig | null> {
    const seedPath = this.devSeedPath;
    if (!(await fs.exists(seedPath))) {
      return null;
    }

    const content = await fs.read(seedPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(
        [
          "Failed to parse EMA dev seed:",
          `  ${seedPath}`,
          "",
          "Reason:",
          `  ${(error as Error).message}`,
        ].join("\n"),
      );
    }

    const result = RawDevSeedSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(
        (issue) => `  - ${issue.path.join(".") || "devSeed"}: ${issue.message}`,
      );
      throw new Error(
        [
          "Invalid EMA dev seed:",
          `  ${seedPath}`,
          "",
          "Issues:",
          ...issues,
        ].join("\n"),
      );
    }
    return result.data as DevSeedConfig;
  }

  /** Clears the loaded singleton for tests. Production code must not call this. */
  static resetForTests(): void {
    this.instance = null;
  }

  private static get loaded(): GlobalConfig {
    if (!this.instance) {
      throw new Error(
        "GlobalConfig has not been loaded. Call GlobalConfig.load(fs) before accessing it.",
      );
    }
    return this.instance;
  }
}

function fromRawConfig(raw: RawConfig, env: EnvGetter): GlobalConfig {
  return new GlobalConfig(
    {
      mode: raw.system.mode,
      dataRoot: resolveWorkspacePath(raw.system.data_root),
      logsDir: resolveWorkspacePath(raw.system.logs_dir),
      httpsProxy: resolveHttpsProxy(raw.system.https_proxy, env),
      dev: {
        restoreDefaultSnapshot: raw.system.dev.restore_default_snapshot,
        requireDevSeed: raw.system.dev.require_dev_seed,
      },
    },
    {
      kind: raw.mongo.kind,
      uri: raw.mongo.uri,
      dbName: raw.mongo.db_name,
    },
    {
      workspaceDir: resolveWorkspacePath(raw.agent.workspace_dir),
    },
    {
      provider: raw.default_llm.provider,
      openai: {
        mode: raw.default_llm.openai.mode,
        model: raw.default_llm.openai.model,
        baseUrl: raw.default_llm.openai.base_url,
        apiKey: resolveSecret(
          raw.default_llm.openai.api_key,
          raw.default_llm.openai.env_key,
          env,
        ),
      },
      google: {
        model: raw.default_llm.google.model,
        baseUrl: raw.default_llm.google.base_url,
        apiKey: resolveSecret(
          raw.default_llm.google.api_key,
          raw.default_llm.google.env_key,
          env,
        ),
        useVertexAi: raw.default_llm.google.use_vertex_ai,
        project: resolveSecret(
          raw.default_llm.google.project,
          raw.default_llm.google.project_env_key,
          env,
        ),
        location: resolveSecret(
          raw.default_llm.google.location,
          raw.default_llm.google.location_env_key,
          env,
        ),
      },
    },
    {
      provider: raw.default_embedding.provider,
      openai: {
        model: raw.default_embedding.openai.model,
        baseUrl: raw.default_embedding.openai.base_url,
        apiKey: resolveSecret(
          raw.default_embedding.openai.api_key,
          raw.default_embedding.openai.env_key,
          env,
        ),
      },
      google: {
        model: raw.default_embedding.google.model,
        baseUrl: raw.default_embedding.google.base_url,
        apiKey: resolveSecret(
          raw.default_embedding.google.api_key,
          raw.default_embedding.google.env_key,
          env,
        ),
        useVertexAi: raw.default_embedding.google.use_vertex_ai,
        project: resolveSecret(
          raw.default_embedding.google.project,
          raw.default_embedding.google.project_env_key,
          env,
        ),
        location: resolveSecret(
          raw.default_embedding.google.location,
          raw.default_embedding.google.location_env_key,
          env,
        ),
      },
    },
  );
}

function resolveWorkspacePath(value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.join(getWorkspaceRoot(), value);
}

function resolveSecret(
  directValue: string | undefined,
  envKey: string | undefined,
  env: EnvGetter,
): string {
  const direct = directValue?.trim();
  if (direct) {
    return direct;
  }
  const key = envKey?.trim();
  if (!key) {
    return "";
  }
  return env(key)?.trim() ?? "";
}

function resolveHttpsProxy(value: string, env: EnvGetter): string {
  const direct = value.trim();
  if (direct) {
    return direct;
  }
  return (
    env("HTTPS_PROXY")?.trim() ||
    env("https_proxy")?.trim() ||
    env("HTTP_PROXY")?.trim() ||
    env("http_proxy")?.trim() ||
    ""
  );
}

function getProcessEnv(name: string): string | undefined {
  return process.env[name];
}

function buildExampleToml(): string {
  return `# EMA configuration file.\n# Fill API keys through environment variables referenced by env_key.\n\n[system]\nmode = "${DEFAULT_SYSTEM_CONFIG.mode}"\ndata_root = "${DEFAULT_SYSTEM_CONFIG.dataRoot}"\nlogs_dir = "${DEFAULT_SYSTEM_CONFIG.logsDir}"\n# Leave empty to fallback to HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy.\nhttps_proxy = "${DEFAULT_SYSTEM_CONFIG.httpsProxy}"\n\n[system.dev]\nrestore_default_snapshot = ${DEFAULT_SYSTEM_CONFIG.dev.restoreDefaultSnapshot}\nrequire_dev_seed = ${DEFAULT_SYSTEM_CONFIG.dev.requireDevSeed}\n\n[mongo]\nkind = "${DEFAULT_MONGO_CONFIG.kind}"\nuri = "${DEFAULT_MONGO_CONFIG.uri}"\ndb_name = "${DEFAULT_MONGO_CONFIG.dbName}"\n\n[agent]\nworkspace_dir = "${DEFAULT_AGENT_CONFIG.workspaceDir}"\n\n[default_llm]\nprovider = "${DEFAULT_LLM_CONFIG.provider}"\n\n[default_llm.openai]\nmode = "${DEFAULT_LLM_CONFIG.openai.mode}"\nmodel = "${DEFAULT_LLM_CONFIG.openai.model}"\nbase_url = "${DEFAULT_LLM_CONFIG.openai.baseUrl}"\nenv_key = "${DEFAULT_OPENAI_LLM_ENV_KEY}"\n\n[default_llm.google]\nmodel = "${DEFAULT_LLM_CONFIG.google.model}"\nbase_url = "${DEFAULT_LLM_CONFIG.google.baseUrl}"\nenv_key = "${DEFAULT_GOOGLE_LLM_ENV_KEY}"\nuse_vertex_ai = ${DEFAULT_LLM_CONFIG.google.useVertexAi}\nproject_env_key = "${DEFAULT_GOOGLE_PROJECT_ENV_KEY}"\nlocation_env_key = "${DEFAULT_GOOGLE_LOCATION_ENV_KEY}"\n\n[default_embedding]\nprovider = "${DEFAULT_EMBEDDING_CONFIG.provider}"\n\n[default_embedding.openai]\nmodel = "${DEFAULT_EMBEDDING_CONFIG.openai.model}"\nbase_url = "${DEFAULT_EMBEDDING_CONFIG.openai.baseUrl}"\nenv_key = "${DEFAULT_OPENAI_EMBEDDING_ENV_KEY}"\n\n[default_embedding.google]\nmodel = "${DEFAULT_EMBEDDING_CONFIG.google.model}"\nbase_url = "${DEFAULT_EMBEDDING_CONFIG.google.baseUrl}"\nenv_key = "${DEFAULT_GOOGLE_EMBEDDING_ENV_KEY}"\nuse_vertex_ai = ${DEFAULT_EMBEDDING_CONFIG.google.useVertexAi}\nproject_env_key = "${DEFAULT_GOOGLE_PROJECT_ENV_KEY}"\nlocation_env_key = "${DEFAULT_GOOGLE_LOCATION_ENV_KEY}"\n`;
}

function getWorkspaceRoot(): string {
  let current = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  for (;;) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

async function loadDotEnvFile(fs: Fs): Promise<void> {
  const envPath = path.join(getWorkspaceRoot(), ".env");
  if (!(await fs.exists(envPath))) {
    return;
  }
  const content = await fs.read(envPath);
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const matched = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u,
    );
    if (!matched) {
      continue;
    }
    const [, key, rawValue] = matched;
    if (typeof process.env[key] === "string" && process.env[key] !== "") {
      continue;
    }
    process.env[key] = stripEnvQuotes(rawValue.trim());
  }
}

function stripEnvQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
