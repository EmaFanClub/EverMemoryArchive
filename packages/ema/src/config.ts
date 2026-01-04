/**
 * Configuration management module
 *
 * Provides unified configuration loading and management functionality.
 *
 * See {@link Config} for more details.
 *
 * @module config
 */

import fs from "node:fs";
import path from "node:path";
import envPaths from "env-paths";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

import { RetryConfig } from "./retry";
import type { Tool } from "./tools/base";
import { FinalReplyTool } from "./tools/final_reply_tool";

export { RetryConfig } from "./retry";

/**
 * MongoDB configuration.
 *
 * @example
 * ```yaml
 * # Configure to use memory MongoDB in config.yaml
 * mongo:
 *   kind: "memory"
 *   db_name: "ema"
 * ```
 *
 * @example
 * ```yaml
 * # Configure to use remote MongoDB in config.yaml
 * mongo:
 *   kind: "remote"
 *   uri: "mongodb://localhost:27017"
 *   db_name: "ema"
 * ```
 */
export class MongoConfig {
  constructor(
    /**
     * The MongoDB kind.
     *
     * If under development mode, it will be "memory" by default.
     * If under production mode, it will be "remote" by default.
     */
    public readonly kind: "memory" | "remote" = "memory",
    /**
     * The MongoDB URI.
     *
     * Unused if mongo kind is set to "memory".
     */
    public readonly uri: string = "mongodb://localhost:27017",
    /**
     * The MongoDB database name.
     */
    public readonly db_name: string = "ema",
  ) {}
}

/**
 * System configuration.
 */
export class SystemConfig {
  constructor(
    /**
     * The data root directory.
     */
    public readonly data_root: string = ".data",
    /**
     * The HTTPS proxy.
     *
     * If environment variable `HTTPS_PROXY` or `https_proxy` is set, it will be used first.
     * If it is empty, no proxy will be used.
     */
    public https_proxy: string = "",
  ) {}
}

/**
 * API configuration for LLM providers.
 */
export interface LLMApiConfig {
  /**
   * API key for the LLM provider.
   */
  key: string;
  /**
   * Base URL for the LLM provider.
   */
  base_url: string;
}

/**
 * API Configuration for the OpenAI provider.
 *
 * @example
 * ```yaml
 * # Configure in config.yaml
 * llm:
 *   openai:
 *     key: "sk-1234567890"
 *     base_url: "https://api.openai.com/v1"
 * ```
 *
 * @example
 * ```env
 * # Configure in .env (suggested)
 * OPENAI_API_KEY=sk-1234567890
 * OPENAI_API_BASE=https://api.openai.com/v1
 * ```
 */
export class OpenAIApiConfig implements LLMApiConfig {
  constructor(
    /**
     * API key for the OpenAI provider.
     *
     * If environment variable OPENAI_API_KEY is set, it will be used first.
     */
    public key: string = "",
    /**
     * Base URL for the OpenAI provider.
     *
     * If environment variable OPENAI_API_BASE is set, it will be used first.
     */
    public base_url: string = "https://api.openai.com/v1",
  ) {}
}

/**
 * API Configuration for the Google Generative AI provider.
 *
 * @example
 * ```yaml
 * # Configure in config.yaml
 * llm:
 *   google:
 *     key: "sk-1234567890"
 *     base_url: "https://generativelanguage.googleapis.com"
 * ```
 *
 * @example
 * ```env
 * # Configure in .env (suggested)
 * GEMINI_API_KEY=sk-1234567890
 * GEMINI_API_BASE=https://generativelanguage.googleapis.com
 * ```
 */
export class GoogleApiConfig implements LLMApiConfig {
  constructor(
    /**
     * API key for the Google Generative AI provider.
     *
     * If environment variable GEMINI_API_KEY is set, it will be used first.
     */
    public key: string = "",
    /**
     * Base URL for the Google Generative AI provider.
     *
     * If environment variable GEMINI_API_BASE is set, it will be used first.
     */
    public base_url: string = "https://generativelanguage.googleapis.com",
  ) {}
}

/**
 * LLM configuration.
 */
export class LLMConfig {
  constructor(
    /**
     * OpenAI API configuration.
     */
    public readonly openai: OpenAIApiConfig = new OpenAIApiConfig(),
    /**
     * Google API configuration
     */
    public readonly google: GoogleApiConfig = new GoogleApiConfig(),
    /**
     * Provider name used for chat agent.
     * If environment variable EMA_CHAT_PROVIDER is set, it will be used first.
     *
     * @example
     * ```yaml
     * # Configure to use Google Generative AI in config.yaml
     * llm:
     *   chat_provider: "google"
     *   google:
     *     key: "sk-1234567890"
     * ```
     *
     * @example
     * ```yaml
     * # Configure to use model "gemini-2.5-flash" and Google Generative AI in config.yaml
     * llm:
     *   chat_provider: "google"
     *   chat_model: "gemini-2.5-flash"
     *   google:
     *     key: "sk-1234567890"
     * ```
     *
     * @example
     * ```env
     * # Configure to use deepseek in .env
     * EMA_CHAT_PROVIDER=openai
     * EMA_CHAT_MODEL=deepseek-chat
     * OPENAI_API_KEY=sk-1234567890
     * OPENAI_API_BASE=https://api.deepseek.com
     * ```
     */
    public chat_provider: "google" | "openai" = "google",
    /**
     * Model name used for chat agent.
     * If environment variable EMA_CHAT_MODEL is set, it will be used first.
     *
     * @see {@link chat_provider} for examples.
     */
    public chat_model: string = "gemini-2.5-flash",
    /**
     * Retry configuration for the LLM provider.
     */
    public readonly retry: RetryConfig = new RetryConfig(),
  ) {}
}

/**
 * Agent configuration.
 */
export class AgentConfig {
  constructor(
    /**
     * The maximum number of steps the agent can take.
     */
    public readonly maxSteps: number = 50,
    /**
     * The workspace directory for the agent.
     */
    public readonly workspaceDir: string = "./workspace",
    /**
     * The system prompt file for the agent.
     */
    public readonly systemPromptFile: string = "system_prompt.md",
    /**
     * The token limit for the agent.
     */
    public readonly tokenLimit: number = 80000,
  ) {}
}

/**
 * Tools configuration.
 */
export class ToolsConfig {
  constructor(
    /**
     * Whether to enable file tools.
     */
    public readonly enable_file_tools: boolean = true,
    /**
     * Whether to enable bash tools.
     *
     * For security reasons, bash tools are disabled by default (`false`).
     */
    public readonly enable_bash: boolean = false,
    /**
     * Whether to enable note tools.
     */
    public readonly enable_note: boolean = true,
    /**
     * The skills directory.
     */
    public readonly skills_dir: string = "./skills",
    /**
     * Whether to enable MCP tools.
     */
    public readonly enable_mcp: boolean = true,
    /**
     * The MCP config path.
     */
    public readonly mcp_config_path: string = "mcp.json",
  ) {}
}

/**
 * This class contains definition of all the configuration for the EMA.
 *
 * The default load paths is given by {@link Config.findConfigFile}.
 *
 * @example
 * ```js
 * // Loads configuration from the default load paths.
 * const config = Config.load();
 * ```
 *
 * @example
 * ```js
 * // Loads configuration in YAML format from a specific file.
 * const config = Config.fromYaml("/path/to/config.yaml");
 * ```
 */
export class Config {
  constructor(
    /**
     * LLM configuration
     */
    public readonly llm: LLMConfig,
    /**
     * Agent configuration
     */
    public readonly agent: AgentConfig,
    /**
     * Tools configuration
     */
    public readonly tools: ToolsConfig,
    /**
     * MongoDB configuration
     */
    public readonly mongo: MongoConfig,
    /**
     * System configuration
     */
    public readonly system: SystemConfig,
  ) {}

  /**
   * Loads configuration from the default search path.
   */
  static load(): Config {
    const configPath = this.getDefaultConfigPath();
    if (!fs.existsSync(configPath)) {
      const defaultContent = this.getDefaultConfig().toYAML();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, defaultContent, "utf-8");
    }
    const config = this.fromYaml(configPath).assignEnv();

    // todo: validate in better position.
    if (!config.llm.openai.key && !config.llm.google.key) {
      throw new Error("OPENAI_API_KEY or GEMINI_API_KEY env is not set");
    }

    return config;
  }

  /**
   * Assigns environment variables to the config.
   */
  assignEnv(): this {
    if (process.env.EMA_CHAT_PROVIDER) {
      this.llm.chat_provider = process.env.EMA_CHAT_PROVIDER as
        | "google"
        | "openai";
    }
    if (process.env.EMA_CHAT_MODEL) {
      this.llm.chat_model = process.env.EMA_CHAT_MODEL;
    }
    if (process.env.OPENAI_API_KEY) {
      this.llm.openai.key = process.env.OPENAI_API_KEY;
    }
    if (process.env.OPENAI_API_BASE) {
      this.llm.openai.base_url = process.env.OPENAI_API_BASE;
    }
    if (process.env.GEMINI_API_KEY) {
      this.llm.google.key = process.env.GEMINI_API_KEY;
    }
    if (process.env.GEMINI_API_BASE) {
      this.llm.google.base_url = process.env.GEMINI_API_BASE;
    }
    if (process.env.HTTPS_PROXY) {
      this.system.https_proxy = process.env.HTTPS_PROXY;
    } else if (process.env.https_proxy) {
      this.system.https_proxy = process.env.https_proxy;
    }
    return this;
  }

  /**
   * Loads configuration from YAML file
   *
   * @param configPath Configuration file path
   * @returns Config instance
   */
  static fromYaml(configPath: string): Config {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file does not exist: ${configPath}`);
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const data = yaml.load(content) as any;

    if (!data) {
      throw new Error("Configuration file is empty");
    }

    const isDev = ["development", "test"].includes(process.env.NODE_ENV || "");
    return new Config(
      deepMerge(new LLMConfig(), data?.llm),
      deepMerge(new AgentConfig(), data?.agent),
      deepMerge(new ToolsConfig(), data?.tools),
      deepMerge(new MongoConfig(isDev ? "memory" : "remote"), data?.mongo),
      deepMerge(new SystemConfig(), data?.system),
    );

    /**
     * Deep merges two objects, if the value is nullish, it will be ignored.
     * If the value is not object (array, boolean, number, string, etc.), it will be shallow merged.
     *
     * @param target - The target object to merge into.
     * @param source - The source object to merge from.
     * @returns The merged object.
     */
    function deepMerge(target: any, source: any): any {
      if (typeof target !== "object" || isNullish(target)) {
        return source;
      }
      if (typeof source !== "object" || isNullish(source)) {
        return target;
      }
      const result = { ...target };
      for (const key in source) {
        if (!isNullish(source[key])) {
          result[key] = deepMerge(result[key], source[key]);
        }
      }
      return result;
    }
    /**
     * Checks if the value is nullish (undefined or null).
     *
     * @param value - The value to check.
     * @returns True if the value is nullish, false otherwise.
     */
    function isNullish(value: any): boolean {
      return value === undefined || value === null;
    }
  }

  /**
   * Gets the system prompt file path.
   */
  get systemPrompt(): string {
    const path = Config.findConfigFile(this.agent.systemPromptFile);
    if (!path) {
      throw new Error(
        `System prompt file not found: ${this.agent.systemPromptFile}`,
      );
    }
    return fs.readFileSync(path, "utf-8");
  }

  // TODO: populate with concrete tool instances when tool wiring is ready.
  get baseTools(): Tool[] {
    return [new FinalReplyTool()];
  }

  /**
   * Get the package installation directory
   *
   * @returns Path to the mini_agent package directory
   */
  static getPackageDir(): string {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  }

  /**
   * Find configuration file with priority order
   *
   * Search for config file in the following order of priority:
   * 1) `packages/ema/src/config/{filename}` in current directory (development mode)
   * 2) `{data}/ema/config/{filename}` in user home directory
   * 3) `{package}/config/{filename}` in package installation directory
   *
   * The table below shows the `{data}` directory for different platforms:
   * | Platform | Value                                    | Example                                  |
   * | ------- | ---------------------------------------- | ---------------------------------------- |
   * | Linux   | `$XDG_DATA_HOME` or `$HOME`/.local/share | /home/alice/.local/share                 |
   * | macOS   | `$HOME`/Library/Application Support      | /Users/Alice/Library/Application Support |
   * | Windows | `{FOLDERID_LocalAppData}`                | C:\Users\Alice\AppData\Local             |
   *
   * @param filename Configuration file name (e.g., "config.yaml", "mcp.json", "system_prompt.md")
   * @returns Path to found config file, or null if not found
   */
  static findConfigFile(filename: string): string | null {
    // Priority 1: Development mode - config/ under package source (stable regardless of cwd)
    const devConfig = path.join(this.getPackageDir(), "config", filename);
    if (fs.existsSync(devConfig)) {
      return devConfig;
    }

    // Priority 2: User config directory
    const paths = envPaths("ema");
    const userConfig = path.join(paths.data, "config", filename);
    if (fs.existsSync(userConfig)) {
      return userConfig;
    }

    return null;
  }

  /**
   * Get the default config file path with priority search
   *
   * @returns Path to config.yaml (prioritizes: dev config/ > user config/ > package config/)
   */
  static getDefaultConfigPath(): string {
    const configPath = this.findConfigFile("config.yaml");
    if (configPath) {
      return configPath;
    }

    // Fallback to package config directory for error message purposes
    return path.join(this.getPackageDir(), "config", "config.yaml");
  }

  private static getDefaultConfig(): Config {
    return new Config(
      new LLMConfig(),
      new AgentConfig(),
      new ToolsConfig(),
      new MongoConfig(),
      new SystemConfig(),
    );
  }

  private toYAML(): string {
    return yaml.dump({
      llm: this.llm,
      agent: this.agent,
      tools: this.tools,
      mongo: this.mongo,
      system: this.system,
    });
  }
}
