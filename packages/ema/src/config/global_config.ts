import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { Fs } from "../shared/fs";
import { RealFs } from "../shared/fs";
import {
  cloneConfig,
  DEFAULT_MONGO_CONFIG,
  type AgentConfig,
  type BootstrapConfig,
  type ChannelConfig,
  type EmbeddingConfig,
  type GlobalConfigRecord,
  type LLMConfig,
  type MongoConfig,
  type SystemConfig,
  type WebSearchConfig,
} from "./base";

const DEFAULT_DB_NAME = "ema";
const DEFAULT_DATA_ROOT = ".ema";

type EnvGetter = (name: string) => string | undefined;

export interface BootstrapConfigInput {
  readonly mode?: "dev" | "prod";
  readonly mongoUri?: string;
  readonly mongoKind?: "memory" | "remote";
  readonly mongoDb?: string;
  readonly dataRoot?: string;
}

export type GlobalConfigErrorCode =
  | "bootstrap_invalid"
  | "global_config_invalid"
  | "global_config_not_loaded";

/** Structured error raised when bootstrap or runtime config cannot be loaded. */
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
    credentialsFile: z.string().default(""),
  })
  .strict();

const RuntimeLLMSchema = z
  .object({
    provider: z.enum(["openai", "google"]),
    openai: RuntimeOpenAILLMSchema,
    google: RuntimeGoogleLLMSchema,
  })
  .strict();

const RuntimeOpenAIEmbeddingSchema = z
  .object({
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
  })
  .strict();

const RuntimeGoogleEmbeddingSchema = z
  .object({
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
    useVertexAi: z.boolean(),
    project: z.string(),
    location: z.string(),
    credentialsFile: z.string().default(""),
  })
  .strict();

const RuntimeEmbeddingSchema = z
  .object({
    provider: z.enum(["openai", "google"]),
    openai: RuntimeOpenAIEmbeddingSchema,
    google: RuntimeGoogleEmbeddingSchema,
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

const GlobalConfigRecordSchema = z
  .object({
    id: z.literal("global"),
    version: z.literal(1),
    system: z
      .object({
        httpsProxy: z.string(),
      })
      .strict(),
    defaultLlm: RuntimeLLMSchema,
    defaultEmbedding: RuntimeEmbeddingSchema,
    defaultWebSearch: RuntimeWebSearchSchema,
    defaultChannel: RuntimeChannelSchema,
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  })
  .strict();

export interface GlobalConfigLoadOptions {
  readonly bootstrap?: BootstrapConfig;
}

/**
 * Process-wide configuration facade.
 *
 * Bootstrap values are process-local and loaded before database connection.
 * Runtime values are database-backed and must be applied after setup.
 */
export class GlobalConfig {
  private static bootstrap: BootstrapConfig | null = null;
  private static record: GlobalConfigRecord | null = null;

  /** Loads process bootstrap configuration. This does not load runtime config. */
  static async load(
    fs: Fs = new RealFs(),
    options: GlobalConfigLoadOptions = {},
  ): Promise<void> {
    if (this.bootstrap) {
      return;
    }

    await loadDotEnvFile(fs);
    this.bootstrap = options.bootstrap ?? createBootstrapConfig();
    this.record = null;
  }

  /** Applies a database-backed global config record to the loaded bootstrap. */
  static applyRecord(record: GlobalConfigRecord): void {
    this.record = parseGlobalConfigRecord(record);
  }

  static updateDefaultLlm(config: LLMConfig): void {
    this.updateRecord({ defaultLlm: cloneConfig(config) });
  }

  static updateDefaultWebSearch(config: WebSearchConfig): void {
    this.updateRecord({ defaultWebSearch: cloneConfig(config) });
  }

  static updateDefaultChannel(config: ChannelConfig): void {
    this.updateRecord({ defaultChannel: cloneConfig(config) });
  }

  static updateSystemConfig(config: GlobalConfigRecord["system"]): void {
    this.updateRecord({ system: cloneConfig(config) });
  }

  static get hasRuntimeConfig(): boolean {
    return Boolean(this.record);
  }

  static get bootstrapConfig(): BootstrapConfig {
    return this.loadedBootstrap;
  }

  static get system(): SystemConfig {
    const bootstrap = this.loadedBootstrap;
    return {
      mode: bootstrap.mode,
      dataRoot: bootstrap.paths.dataRoot,
      logsDir: bootstrap.paths.logsDir,
      httpsProxy: resolveHttpsProxy(
        this.record?.system.httpsProxy ?? "",
        getProcessEnv,
      ),
    };
  }

  static get mongo(): MongoConfig {
    return this.loadedBootstrap.mongo;
  }

  static get agent(): AgentConfig {
    return {
      workspaceDir: this.loadedBootstrap.paths.workspaceDir,
    };
  }

  static get defaultLlm(): LLMConfig {
    return cloneConfig(this.loadedRecord.defaultLlm);
  }

  static resolveRuntimeLlmConfig(config: LLMConfig): LLMConfig {
    return {
      provider: config.provider,
      openai: {
        mode: config.openai.mode,
        model: config.openai.model.trim(),
        baseUrl: config.openai.baseUrl.trim(),
        apiKey: this.resolveEnvValue(config.openai.apiKey),
      },
      google: {
        model: config.google.model.trim(),
        baseUrl: config.google.baseUrl.trim(),
        apiKey: this.resolveEnvValue(config.google.apiKey),
        useVertexAi: config.google.useVertexAi,
        project: this.resolveEnvValue(config.google.project),
        location: this.resolveEnvValue(config.google.location),
        credentialsFile: this.resolveEnvValue(config.google.credentialsFile),
      },
    };
  }

  static get defaultEmbedding(): EmbeddingConfig {
    return cloneConfig(this.loadedRecord.defaultEmbedding);
  }

  static resolveRuntimeEmbeddingConfig(
    config: EmbeddingConfig,
  ): EmbeddingConfig {
    return {
      provider: config.provider,
      openai: {
        model: config.openai.model.trim(),
        baseUrl: config.openai.baseUrl.trim(),
        apiKey: this.resolveEnvValue(config.openai.apiKey),
      },
      google: {
        model: config.google.model.trim(),
        baseUrl: config.google.baseUrl.trim(),
        apiKey: this.resolveEnvValue(config.google.apiKey),
        useVertexAi: config.google.useVertexAi,
        project: this.resolveEnvValue(config.google.project),
        location: this.resolveEnvValue(config.google.location),
        credentialsFile: this.resolveEnvValue(config.google.credentialsFile),
      },
    };
  }

  static get defaultWebSearch(): WebSearchConfig {
    return cloneConfig(this.loadedRecord.defaultWebSearch);
  }

  static get defaultChannel(): ChannelConfig {
    return cloneConfig(this.loadedRecord.defaultChannel);
  }

  /** Clears the loaded singleton for tests. Production code must not call this. */
  static resetForTests(): void {
    this.bootstrap = null;
    this.record = null;
  }

  private static get loadedBootstrap(): BootstrapConfig {
    if (!this.bootstrap) {
      throw new GlobalConfigError(
        "bootstrap_invalid",
        "GlobalConfig bootstrap has not been loaded. Call GlobalConfig.load(fs) before accessing it.",
      );
    }
    return this.bootstrap;
  }

  private static get loadedRecord(): GlobalConfigRecord {
    if (!this.record) {
      throw new GlobalConfigError(
        "global_config_not_loaded",
        "Database-backed GlobalConfig has not been loaded. Complete setup or call GlobalConfig.applyRecord(record).",
      );
    }
    return this.record;
  }

  private static updateRecord(
    patch: Partial<Omit<GlobalConfigRecord, "id" | "version">>,
  ): void {
    this.record = parseGlobalConfigRecord({
      ...this.loadedRecord,
      ...patch,
    });
  }

  private static resolveEnvValue(name: string): string {
    const key = name.trim();
    return key ? (process.env[key]?.trim() ?? "") : "";
  }
}

export function createBootstrapConfig(
  input: BootstrapConfigInput = {},
  env: EnvGetter = getProcessEnv,
): BootstrapConfig {
  const mode = input.mode ?? parseMode(env("EMA_SERVER_MODE")) ?? "prod";
  const explicitMongoUri = input.mongoUri ?? env("EMA_SERVER_MONGO_URI") ?? "";
  const mongoKind =
    input.mongoKind ??
    parseMongoKind(env("EMA_SERVER_MONGO_KIND")) ??
    (mode === "dev" && !explicitMongoUri.trim() ? "memory" : "remote");
  const mongoDbName =
    (input.mongoDb ?? env("EMA_SERVER_MONGO_DB") ?? DEFAULT_DB_NAME).trim() ||
    DEFAULT_DB_NAME;

  if (mode === "prod" && mongoKind !== "remote") {
    throw new GlobalConfigError(
      "bootstrap_invalid",
      "Production mode requires remote MongoDB.",
    );
  }
  if (mode === "prod" && !explicitMongoUri.trim()) {
    throw new GlobalConfigError(
      "bootstrap_invalid",
      "Production mode requires --mongo <uri>.",
    );
  }

  const dataRoot = resolveWorkspacePath(
    input.dataRoot ?? env("EMA_SERVER_DATA_ROOT") ?? DEFAULT_DATA_ROOT,
  );
  const useDevMemory = mode === "dev" && mongoKind === "memory";

  return {
    mode,
    mongo: {
      kind: mongoKind,
      uri:
        mongoKind === "memory"
          ? DEFAULT_MONGO_CONFIG.uri
          : explicitMongoUri.trim(),
      dbName: mongoDbName,
    },
    paths: {
      dataRoot,
      logsDir: path.join(dataRoot, "logs"),
      workspaceDir: path.join(dataRoot, "workspace"),
    },
    devBootstrap: {
      restoreDefaultSnapshot: useDevMemory,
    },
  };
}

export function getWorkspaceRoot(): string {
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

export function parseGlobalConfigRecord(
  record: GlobalConfigRecord,
): GlobalConfigRecord {
  const result = GlobalConfigRecordSchema.safeParse(record);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) =>
        `  - ${issue.path.join(".") || "globalConfig"}: ${issue.message}`,
    );
    throw new GlobalConfigError(
      "global_config_invalid",
      ["Invalid EMA global config:", "", "Issues:", ...issues].join("\n"),
    );
  }
  return result.data;
}

function parseMode(value: string | undefined): "dev" | "prod" | null {
  if (value === "dev" || value === "prod") {
    return value;
  }
  return null;
}

function parseMongoKind(value: string | undefined): "memory" | "remote" | null {
  if (value === "memory" || value === "remote") {
    return value;
  }
  return null;
}

function resolveWorkspacePath(value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.join(getWorkspaceRoot(), value);
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
