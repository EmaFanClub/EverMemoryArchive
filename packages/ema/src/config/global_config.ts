import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { ThinkingLevel } from "../llm/base";
import type { Fs } from "../shared/fs";
import { RealFs } from "../shared/fs";
import {
  cloneConfig,
  type BootstrapConfig,
  type EmbeddingConfig,
  type GlobalConfigRecord,
  type LLMConfig,
  type MongoConfig,
  type RuntimePaths,
} from "./base";

const DEFAULT_DB_NAME = "ema";
const DEFAULT_DATA_ROOT = ".ema";
const DEFAULT_DEV_DATA_ROOT = ".ema_dev";
const DEFAULT_MEMORY_MONGO_URI = "mongodb://localhost:27017";

type EnvGetter = (name: string) => string | undefined;

export interface BootstrapConfigInput {
  readonly mode?: "dev" | "prod";
  readonly mongoUri?: string;
  readonly mongoKind?: "memory" | "remote";
  readonly mongoDb?: string;
  readonly dataRoot?: string;
  readonly httpsProxy?: string;
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

const RuntimeThinkingLevelSchema = z.enum([
  ThinkingLevel.NONE,
  ThinkingLevel.LOW,
  ThinkingLevel.MEDIUM,
  ThinkingLevel.HIGH,
  ThinkingLevel.XHIGH,
]);

const RuntimeLLMSchema = z
  .object({
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
    thinkingLevel: RuntimeThinkingLevelSchema.optional(),
  })
  .strict()
  .transform(trimLlmConfig);

const LegacyOpenAILLMSchema = z
  .object({
    mode: z.enum(["chat", "responses"]),
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
  })
  .strict();

const LegacyGoogleLLMSchema = z
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

const LegacyRuntimeLLMSchema = z
  .object({
    provider: z.enum(["openai", "google"]),
    openai: LegacyOpenAILLMSchema,
    google: LegacyGoogleLLMSchema,
  })
  .strict()
  .transform(normalizeLegacyLlmConfig);

const RuntimeOrLegacyLLMSchema = z.union([
  RuntimeLLMSchema,
  LegacyRuntimeLLMSchema,
]);

const RuntimeEmbeddingSchema = z
  .object({
    model: z.string(),
    baseUrl: z.string(),
    apiKey: z.string(),
    dimensions: z.number().int().positive().optional(),
  })
  .strict()
  .transform(trimEmbeddingConfig);

const GlobalConfigRecordSchema = z
  .object({
    id: z.literal("global"),
    version: z.literal(1),
    system: z
      .object({
        httpsProxy: z.string().optional(),
        accessToken: z.string().default(""),
      })
      .passthrough()
      .optional(),
    accessToken: z.string().optional(),
    defaultLlm: RuntimeOrLegacyLLMSchema,
    defaultEmbedding: RuntimeEmbeddingSchema,
    defaultWebSearch: z.unknown().optional(),
    defaultChannel: z.unknown().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  })
  .passthrough()
  .transform(normalizeGlobalConfigRecord);

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
  static applyRecord(record: unknown): void {
    this.record = parseGlobalConfigRecord(record);
  }

  static updateDefaultLlm(config: LLMConfig): void {
    this.updateRecord({ defaultLlm: cloneConfig(config) });
  }

  static get hasRuntimeConfig(): boolean {
    return Boolean(this.record);
  }

  static get bootstrapConfig(): BootstrapConfig {
    return this.loadedBootstrap;
  }

  static get mode(): "dev" | "prod" {
    return this.loadedBootstrap.mode;
  }

  static get mongo(): MongoConfig {
    return this.loadedBootstrap.mongo;
  }

  static get paths(): RuntimePaths {
    return cloneConfig(this.loadedBootstrap.paths);
  }

  static get httpsProxy(): string {
    return this.loadedBootstrap.httpsProxy;
  }

  static get accessToken(): string | undefined {
    return this.loadedRecord.accessToken;
  }

  static get defaultLlm(): LLMConfig {
    return cloneConfig(this.loadedRecord.defaultLlm);
  }

  static get defaultEmbedding(): EmbeddingConfig {
    return cloneConfig(this.loadedRecord.defaultEmbedding);
  }

  static resolveRuntimeEmbeddingConfig(
    config: EmbeddingConfig,
  ): EmbeddingConfig {
    return normalizeEmbeddingConfig(config);
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
    input.dataRoot ?? env("EMA_SERVER_DATA_ROOT") ?? defaultDataRootFor(mode),
  );
  const httpsProxy = resolveHttpsProxy(
    input.httpsProxy ?? env("EMA_SERVER_HTTPS_PROXY") ?? "",
    env,
  );

  return {
    mode,
    mongo: {
      kind: mongoKind,
      uri:
        mongoKind === "memory"
          ? DEFAULT_MEMORY_MONGO_URI
          : explicitMongoUri.trim(),
      dbName: mongoDbName,
    },
    paths: {
      dataRoot,
      logsDir: path.join(dataRoot, "logs"),
      workspaceDir: path.join(dataRoot, "workspace"),
    },
    httpsProxy,
  };
}

function defaultDataRootFor(mode: "dev" | "prod"): string {
  if (mode === "prod") {
    return DEFAULT_DATA_ROOT;
  }
  return path.join(DEFAULT_DEV_DATA_ROOT, formatRunTimestamp());
}

function formatRunTimestamp(date = new Date()): string {
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
      pad(date.getMilliseconds(), 3),
    ].join("-"),
  ].join("_");
}

export function getWorkspaceRoot(): string {
  const configuredRoot = process.env.EMA_WORKSPACE_ROOT?.trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  const sourceRoot = findWorkspaceRootFrom(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  if (sourceRoot) {
    return sourceRoot;
  }

  return findWorkspaceRootFrom(process.cwd()) ?? process.cwd();
}

function findWorkspaceRootFrom(...segments: string[]): string | null {
  let current = path.resolve(...segments);
  for (;;) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function parseGlobalConfigRecord(record: unknown): GlobalConfigRecord {
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

export function normalizeLLMConfig(config: unknown): LLMConfig {
  const result = RuntimeOrLegacyLLMSchema.safeParse(config);
  if (!result.success) {
    const message = result.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "llmConfig"}: ${issue.message}`,
      )
      .join("; ");
    throw new GlobalConfigError(
      "global_config_invalid",
      `Invalid EMA LLM config: ${message}`,
    );
  }
  return result.data;
}

export function normalizeEmbeddingConfig(config: unknown): EmbeddingConfig {
  const result = RuntimeEmbeddingSchema.safeParse(config);
  if (!result.success) {
    const message = result.error.issues
      .map(
        (issue) =>
          `${issue.path.join(".") || "embeddingConfig"}: ${issue.message}`,
      )
      .join("; ");
    throw new GlobalConfigError(
      "global_config_invalid",
      `Invalid EMA embedding config: ${message}`,
    );
  }
  return result.data;
}

function normalizeGlobalConfigRecord(config: {
  id: "global";
  version: 1;
  system?: {
    accessToken?: string;
  };
  accessToken?: string;
  defaultLlm: LLMConfig;
  defaultEmbedding: EmbeddingConfig;
  createdAt?: number;
  updatedAt?: number;
}): GlobalConfigRecord {
  const accessToken = (
    config.accessToken ??
    config.system?.accessToken ??
    ""
  ).trim();
  return {
    id: "global",
    version: 1,
    ...(accessToken ? { accessToken } : {}),
    defaultLlm: config.defaultLlm,
    defaultEmbedding: config.defaultEmbedding,
    ...(config.createdAt !== undefined ? { createdAt: config.createdAt } : {}),
    ...(config.updatedAt !== undefined ? { updatedAt: config.updatedAt } : {}),
  };
}

function trimLlmConfig(config: LLMConfig): LLMConfig {
  return {
    model: config.model.trim(),
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    ...(config.thinkingLevel !== undefined
      ? { thinkingLevel: config.thinkingLevel }
      : {}),
  };
}

function normalizeLegacyLlmConfig(config: {
  provider: "openai" | "google";
  openai: {
    model: string;
    baseUrl: string;
    apiKey: string;
  };
  google: {
    model: string;
    baseUrl: string;
    apiKey: string;
    useVertexAi: boolean;
    credentialsFile: string;
  };
}): LLMConfig {
  if (config.provider === "openai") {
    return trimLlmConfig({
      model: config.openai.model,
      baseUrl: config.openai.baseUrl,
      apiKey: config.openai.apiKey,
    });
  }
  return trimLlmConfig({
    model: config.google.model,
    baseUrl: config.google.baseUrl,
    apiKey: config.google.useVertexAi
      ? config.google.credentialsFile
      : config.google.apiKey,
  });
}

function trimEmbeddingConfig(config: EmbeddingConfig): EmbeddingConfig {
  return {
    model: config.model.trim(),
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    ...(config.dimensions !== undefined
      ? { dimensions: config.dimensions }
      : {}),
  };
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
