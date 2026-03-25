import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino, { type Logger as PinoLogger, type LoggerOptions } from "pino";
import pinoPretty from "pino-pretty";

/** Runtime log levels exposed by the wrapper. */
export type LogLevel = "debug" | "info" | "warn" | "error";
/** Logger level configuration; "full" maps to pino's "debug". */
export type LoggerLevel = "full" | LogLevel | "silent";
/** Supported transports for this logger wrapper. */
export type Transport = "console" | "file" | "db";

/** Logger construction config. */
export interface LoggerConfig {
  /** Logger name shown in output. */
  name: string;
  /** Minimum level to emit. */
  level: LoggerLevel;
  /** Transport target(s); defaults to "console". */
  transport?: Transport | Transport[];
  /** File path required when using the "file" transport. */
  filePath?: string;
  /** Additional pino options (passed through). */
  options?: LoggerOptions;
}

/** Thin wrapper over a pino logger with a fixed "data" payload field. */
export class Logger {
  readonly name: string;
  readonly level: LoggerLevel;
  private readonly logger: PinoLogger;

  /** Use Logger.create to build instances with configured transports. */
  constructor(name: string, level: LoggerLevel, logger: PinoLogger) {
    this.name = name;
    this.level = level;
    this.logger = logger;
  }

  /** Log a debug message with optional data. */
  debug(message: string, data?: unknown): void {
    if (data === undefined) {
      this.logger.debug(message);
      return;
    }
    this.logger.debug({ data }, message);
  }

  /** Log an info message with optional data. */
  info(message: string, data?: unknown): void {
    if (data === undefined) {
      this.logger.info(message);
      return;
    }
    this.logger.info({ data }, message);
  }

  /** Log a warning message with optional data. */
  warn(message: string, data?: unknown): void {
    if (data === undefined) {
      this.logger.warn(message);
      return;
    }
    this.logger.warn({ data }, message);
  }

  /** Log an error message with optional data. */
  error(message: string, data?: unknown): void {
    if (data === undefined) {
      this.logger.error(message);
      return;
    }
    this.logger.error({ data }, message);
  }

  /** Log with an explicit level, matching pino's API. */
  log(level: LogLevel, message: string, data?: unknown): void {
    if (data === undefined) {
      this.logger[level](message);
      return;
    }
    this.logger[level]({ data }, message);
  }

  /** Create a child logger with bound fields. */
  child(bindings: Record<string, unknown>): Logger {
    const child = this.logger.child(bindings);
    return new Logger(this.name, this.level, child);
  }

  /** Access the underlying pino logger directly. */
  raw(): PinoLogger {
    return this.logger;
  }

  /** Factory to create a Logger with the configured transports. */
  static create(config: LoggerConfig): Logger {
    const transports: Transport[] = config.transport
      ? Array.isArray(config.transport)
        ? config.transport
        : [config.transport]
      : ["console"];
    const transport = buildTransport(transports, config.level, config.filePath);
    const logger = pino(
      {
        ...config.options,
        name: config.name,
        level: config.level === "full" ? "debug" : config.level,
      },
      transport,
    );
    return new Logger(config.name, config.level, logger);
  }
}

/** Build a pino transport config from the selected transports. */
function buildTransport(
  transports: Transport[],
  level: LoggerLevel,
  filePath?: string,
) {
  const logsRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "logs",
  );
  const hasConsole = transports.includes("console");
  const hasFile = transports.includes("file");
  const hasDb = transports.includes("db");
  if (hasDb) {
    throw new Error("db transport is not supported yet.");
  }
  if (hasFile && !filePath) {
    throw new Error("filePath is required for file transport.");
  }
  const resolvedFilePath =
    hasFile && filePath ? resolveLogFilePath(filePath, logsRoot) : undefined;
  // "full" means multiline output; other levels keep a single line.
  const singleLine = level !== "full";
  const prettyOptions = {
    translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
    ignore: "pid,hostname",
    singleLine,
  };
  const consoleStream = pinoPretty({
    colorize: true,
    ...prettyOptions,
  });
  if (hasConsole && hasFile) {
    const fileStream = pinoPretty({
      colorize: false,
      destination: resolvedFilePath,
      mkdir: true,
      ...prettyOptions,
    });
    return pino.multistream([
      { stream: consoleStream },
      { stream: fileStream },
    ]);
  }
  if (hasFile) {
    return pinoPretty({
      colorize: false,
      destination: resolvedFilePath,
      mkdir: true,
      ...prettyOptions,
    });
  }
  if (hasConsole) {
    return consoleStream;
  }
  throw new Error("at least one transport must be specified.");
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
