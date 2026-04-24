import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";

import { GlobalConfig } from "../config/global_config";

/** Runtime log levels exposed by the wrapper. */
export type LogLevel = "debug" | "info" | "warn" | "error";
/** Logger level configuration; "full" maps to "debug". */
export type LoggerLevel = "full" | LogLevel | "silent";
/** Supported legacy transports for this logger wrapper. */
export type Transport = "console" | "file" | "db";
/** Output formatting style. */
export type LoggerOutputFormat = "pretty" | "jsonl";

/** One output sink with an independent minimum level. */
export type LoggerOutput =
  | {
      /** Human-readable console output. */
      type: "console";
      /** Minimum level emitted to this output. */
      level: LoggerLevel;
      /** Console format. Defaults to pretty. */
      format?: Extract<LoggerOutputFormat, "pretty" | "jsonl">;
    }
  | {
      /** File output. */
      type: "file";
      /** Minimum level emitted to this output. */
      level: LoggerLevel;
      /**
       * File path relative to GlobalConfig.system.logsDir unless absolute.
       *
       * When omitted, the record is written to the process-wide server log:
       * logs/server/{date}/{startedAt}.jsonl.
       */
      filePath?: string;
      /** File format. Defaults to jsonl. */
      format?: Extract<LoggerOutputFormat, "pretty" | "jsonl">;
    };

/** Logger construction config. */
export interface LoggerConfig {
  /** Logger name shown in output. */
  name: string;
  /** Context fields attached to every record produced by this logger. */
  context?: Record<string, unknown>;
  /** Output sinks with independent minimum levels. */
  outputs?: LoggerOutput[];

  /** Legacy minimum level. Prefer outputs[].level for new code. */
  level?: LoggerLevel;
  /** Legacy transport target(s). Prefer outputs[] for new code. */
  transport?: Transport | Transport[];
  /** Legacy file path for the "file" transport. Omit to use the server log. */
  filePath?: string;
}

/** Serializable shape written to file outputs. */
export interface LogRecord {
  time: string;
  level: LogLevel;
  name: string;
  context?: Record<string, unknown>;
  message: string;
  data?: unknown;
}

interface ResolvedLoggerOutput {
  type: "console" | "file";
  level: LoggerLevel;
  format: LoggerOutputFormat;
  /** Configured file path. Undefined means the process-wide server log. */
  filePath?: string;
  resolvedFilePath?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const CONSOLE_DATA_MAX_LENGTH = 1_000;
const ENABLE_CONSOLE_COLORS =
  process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  blue: "\u001b[34m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
} as const;

let defaultServerLogFilePath: string | null = null;
const fileStreams = new Map<string, fs.WriteStream>();

/** Lightweight structured logger with per-output level filtering. */
export class Logger {
  readonly name: string;
  readonly level: LoggerLevel;
  readonly context: Record<string, unknown>;
  private readonly outputs: ResolvedLoggerOutput[];

  /** Use Logger.create to build instances with configured outputs. */
  constructor(
    name: string,
    level: LoggerLevel,
    outputs: ResolvedLoggerOutput[],
    context: Record<string, unknown> = {},
  ) {
    this.name = name;
    this.level = level;
    this.outputs = outputs;
    this.context = context;
  }

  /** Log a debug message with optional data. */
  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }

  /** Log an info message with optional data. */
  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  /** Log a warning message with optional data. */
  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  /** Log an error message with optional data. */
  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }

  /** Log with an explicit level. */
  log(level: LogLevel, message: string, data?: unknown): void {
    const record: LogRecord = {
      time: new Date().toISOString(),
      level,
      name: this.name,
      ...(Object.keys(this.context).length > 0
        ? { context: normalizeValue(this.context) as Record<string, unknown> }
        : {}),
      message,
      ...(data !== undefined ? { data: normalizeValue(data) } : {}),
    };

    for (const output of this.outputs) {
      if (!shouldEmit(level, output.level)) {
        continue;
      }
      writeRecord(output, record);
    }
  }

  /** Access the logger instance for legacy code paths that expect raw(). */
  raw(): Logger {
    return this;
  }

  /** Factory to create a Logger with the configured outputs. */
  static create(config: LoggerConfig): Logger {
    const outputs = resolveOutputs(config);
    const level = config.level ?? minOutputLevel(outputs);
    return new Logger(
      config.name,
      level,
      outputs,
      normalizeValue(config.context ?? {}) as Record<string, unknown>,
    );
  }
}

function resolveOutputs(config: LoggerConfig): ResolvedLoggerOutput[] {
  if (config.outputs) {
    if (config.outputs.length === 0) {
      throw new Error("at least one logger output must be specified.");
    }
    return config.outputs.map(resolveOutput);
  }

  const level = config.level ?? "info";
  const transports: Transport[] = config.transport
    ? Array.isArray(config.transport)
      ? config.transport
      : [config.transport]
    : ["console"];

  return transports.map((transport) => {
    if (transport === "db") {
      throw new Error("db logger output is not supported yet.");
    }
    if (transport === "file") {
      return resolveOutput({
        type: "file",
        level,
        filePath: config.filePath,
        format: "jsonl",
      });
    }
    return resolveOutput({
      type: "console",
      level,
      format: "pretty",
    });
  });
}

function resolveOutput(output: LoggerOutput): ResolvedLoggerOutput {
  if (output.type === "console") {
    return {
      type: "console",
      level: output.level,
      format: output.format ?? "pretty",
    };
  }

  return {
    type: "file",
    level: output.level,
    format: output.format ?? "jsonl",
    filePath: output.filePath,
  };
}

function minOutputLevel(outputs: ResolvedLoggerOutput[]): LoggerLevel {
  const levels = outputs
    .map((output) => normalizeLevel(output.level))
    .filter((level): level is LogLevel => level !== null);
  if (levels.length === 0) {
    return "silent";
  }
  return levels.reduce((lowest, current) =>
    LEVEL_ORDER[current] < LEVEL_ORDER[lowest] ? current : lowest,
  );
}

function normalizeLevel(level: LoggerLevel): LogLevel | null {
  if (level === "silent") {
    return null;
  }
  return level === "full" ? "debug" : level;
}

function shouldEmit(level: LogLevel, minimum: LoggerLevel): boolean {
  const normalizedMinimum = normalizeLevel(minimum);
  if (!normalizedMinimum) {
    return false;
  }
  return LEVEL_ORDER[level] >= LEVEL_ORDER[normalizedMinimum];
}

function writeRecord(output: ResolvedLoggerOutput, record: LogRecord): void {
  if (output.type === "console") {
    const line =
      output.format === "jsonl"
        ? JSON.stringify(record)
        : formatConsoleRecord(record, ENABLE_CONSOLE_COLORS);
    const stream = record.level === "error" ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
    return;
  }

  const line =
    output.format === "pretty"
      ? formatConsoleRecord(record, false)
      : JSON.stringify(record);
  if (shouldSkipFileWrite()) {
    return;
  }
  getFileStream(resolveOutputFilePath(output)).write(`${line}\n`);
}

function formatConsoleRecord(record: LogRecord, colorize: boolean): string {
  const time = color(
    `[${formatConsoleTime(new Date(record.time))}]`,
    ANSI.dim,
    colorize,
  );
  const level = color(
    `[${record.level.toUpperCase()}]`,
    getLevelColor(record.level),
    colorize,
  );
  const scope = color(
    `[${formatScope(record.name, record.context)}]`,
    ANSI.cyan,
    colorize,
  );
  const data =
    record.data === undefined
      ? ""
      : ` ${color(truncate(formatData(record.data)), ANSI.dim, colorize)}`;
  return `${time}${level}${scope} ${record.message}${data}`;
}

function getLevelColor(level: LogLevel): string {
  switch (level) {
    case "debug":
      return ANSI.blue;
    case "info":
      return ANSI.green;
    case "warn":
      return ANSI.yellow;
    case "error":
      return ANSI.red;
  }
}

function color(value: string, code: string, enabled: boolean): string {
  return enabled && value.length > 0 ? `${code}${value}${ANSI.reset}` : value;
}

function formatScope(
  name: string,
  context: Record<string, unknown> | undefined,
): string {
  if (!context || Object.keys(context).length === 0) {
    return name;
  }
  const parts = Object.entries(context).map(
    ([key, value]) => `${key}=${formatContextValue(value)}`,
  );
  return `${name} ${parts.join(" ")}`;
}

function formatContextValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return inspect(data, { depth: 3, breakLength: Infinity });
  }
}

function truncate(value: string): string {
  return value.length <= CONSOLE_DATA_MAX_LENGTH
    ? value
    : `${value.slice(0, CONSOLE_DATA_MAX_LENGTH - 1)}…`;
}

function normalizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, seen));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = normalizeValue(nested, seen);
  }
  return result;
}

function resolveLogFilePath(filePath: string, logsRoot: string): string {
  const resolved = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(logsRoot, filePath);
  const normalizedRoot = path.normalize(logsRoot + path.sep);
  if (!resolved.startsWith(normalizedRoot)) {
    throw new Error(`filePath must be under ${logsRoot}`);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function getLogsRoot(): string {
  try {
    return GlobalConfig.system.logsDir;
  } catch {
    return path.resolve(getWorkspaceRootFallback(), "logs");
  }
}

function getWorkspaceRootFallback(): string {
  let current = process.cwd();
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

function getDefaultServerLogFilePath(): string {
  if (defaultServerLogFilePath) {
    return defaultServerLogFilePath;
  }
  const startedAt = formatLogTimestamp();
  const date = startedAt.slice(0, 10);
  defaultServerLogFilePath = resolveLogFilePath(
    `server/${date}/${startedAt}.jsonl`,
    getLogsRoot(),
  );
  return defaultServerLogFilePath;
}

function shouldSkipFileWrite(): boolean {
  if (process.env.EMA_LOG_DISABLE_FILE === "1") {
    return true;
  }
  if (process.env.EMA_LOG_ENABLE_FILE_IN_TEST === "1") {
    return false;
  }
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

function resolveOutputFilePath(output: ResolvedLoggerOutput): string {
  if (output.resolvedFilePath) {
    return output.resolvedFilePath;
  }
  output.resolvedFilePath = output.filePath
    ? resolveLogFilePath(output.filePath, getLogsRoot())
    : getDefaultServerLogFilePath();
  return output.resolvedFilePath;
}

function getFileStream(filePath: string): fs.WriteStream {
  const existing = fileStreams.get(filePath);
  if (existing) {
    return existing;
  }
  const stream = fs.createWriteStream(filePath, { flags: "a" });
  fileStreams.set(filePath, stream);
  return stream;
}

function formatConsoleTime(date: Date): string {
  return (
    [
      pad(date.getFullYear(), 4),
      pad(date.getMonth() + 1, 2),
      pad(date.getDate(), 2),
    ].join("-") +
    " " +
    [
      pad(date.getHours(), 2),
      pad(date.getMinutes(), 2),
      pad(date.getSeconds(), 2),
    ].join(":") +
    `.${pad(date.getMilliseconds(), 3)}`
  );
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/**
 * Formats a local timestamp for log file names.
 *
 * Example: 2026-04-24_16-16-06-075.
 */
export function formatLogTimestamp(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);
  return (
    [
      pad(date.getFullYear(), 4),
      pad(date.getMonth() + 1, 2),
      pad(date.getDate(), 2),
    ].join("-") +
    "_" +
    [
      pad(date.getHours(), 2),
      pad(date.getMinutes(), 2),
      pad(date.getSeconds(), 2),
    ].join("-") +
    `-${pad(date.getMilliseconds(), 3)}`
  );
}
