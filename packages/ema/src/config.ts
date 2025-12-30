/**
 * Configuration management module
 *
 * Provides unified configuration loading and management functionality
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

import { RetryConfig } from "./retry";
import type { Tool } from "./tools/base";
import { FinalReplyTool } from "./tools/final_reply_tool";

export class MongoConfig {
  /** MongoDB configuration */
  uri: string;
  dbName: string;
  kind: "memory" | "remote";

  constructor({
    uri = process.env.MONGO_URI || "mongodb://localhost:27017",
    dbName = process.env.MONGO_DB_NAME || "ema",
    kind,
  }: Partial<MongoConfig> = {}) {
    this.uri = uri;
    this.dbName = dbName;
    if (kind) {
      this.kind = kind;
    } else {
      const isDev = ["development", "test"].includes(
        process.env.NODE_ENV || "",
      );
      this.kind =
        (process.env.MONGO_KIND as "memory" | "remote") ||
        (isDev ? "memory" : "remote");
    }
  }
}

export class SystemConfig {
  /** System configuration */
  dataRoot: string;
  httpsProxy: string;

  constructor({
    dataRoot = process.env.DATA_ROOT || ".data",
    httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || "",
  }: Partial<SystemConfig> = {}) {
    this.dataRoot = dataRoot;
    this.httpsProxy = httpsProxy;
  }
}

export class LLMConfig {
  /** LLM configuration */

  apiKey: string;
  apiBase: string;
  model: string;
  provider: string; // "google" or "openai"
  retry: RetryConfig;

  constructor({
    apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || "",
    apiBase = process.env.OPENAI_API_BASE ||
      process.env.GEMINI_API_BASE ||
      "https://generativelanguage.googleapis.com",
    model = process.env.OPENAI_MODEL ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash",
    provider = "google",
    retry = new RetryConfig(),
  }: {
    apiKey: string;
    apiBase?: string;
    model?: string;
    provider?: string;
    retry?: RetryConfig;
  }) {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
    this.model = model;
    this.provider = provider;
    this.retry = retry;
  }
}

export class AgentConfig {
  /** Agent configuration */

  maxSteps: number;
  workspaceDir: string;
  systemPromptFile: string;
  tokenLimit: number;

  constructor({
    maxSteps = 50,
    workspaceDir = "./workspace",
    systemPromptFile = "system_prompt.md",
    tokenLimit = 80000,
  }: Partial<AgentConfig> = {}) {
    this.maxSteps = maxSteps;
    this.workspaceDir = workspaceDir;
    this.systemPromptFile = systemPromptFile;
    this.tokenLimit = tokenLimit;
  }
}

export class ToolsConfig {
  /** Tools configuration */

  // Basic tools (file operations, bash)
  enableFileTools: boolean;
  enableBash: boolean;
  enableNote: boolean;

  // Skills
  enableSkills: boolean;
  skillsDir: string;

  // MCP tools
  enableMcp: boolean;
  mcpConfigPath: string;

  constructor({
    enableFileTools = true,
    enableBash = true,
    enableNote = true,
    enableSkills = true,
    skillsDir = "./skills",
    enableMcp = true,
    mcpConfigPath = "mcp.json",
  }: Partial<ToolsConfig> = {}) {
    this.enableFileTools = enableFileTools;
    this.enableBash = enableBash;
    this.enableNote = enableNote;
    this.enableSkills = enableSkills;
    this.skillsDir = skillsDir;
    this.enableMcp = enableMcp;
    this.mcpConfigPath = mcpConfigPath;
  }
}

export class Config {
  /** Main configuration class */

  llm: LLMConfig;
  agent: AgentConfig;
  tools: ToolsConfig;
  mongo: MongoConfig;
  system: SystemConfig;

  constructor({
    llm,
    agent,
    tools,
    mongo,
    system,
  }: {
    llm: LLMConfig;
    agent: AgentConfig;
    tools: ToolsConfig;
    mongo: MongoConfig;
    system: SystemConfig;
  }) {
    this.llm = llm;
    this.agent = agent;
    this.tools = tools;
    this.mongo = mongo;
    this.system = system;
  }

  /**
   * Load configuration from the default search path.
   */
  static load(): Config {
    const configPath = this.getDefaultConfigPath();
    if (!fs.existsSync(configPath)) {
      const defaultConfig = this.getDefaultConfig();
      const defaultContent = this.getConfigYAMLContent(defaultConfig);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, defaultContent, "utf-8");
    }
    return this.fromYaml(configPath);
  }

  /**
   * Load configuration from YAML file
   *
   * @param configPath Configuration file path
   * @returns Config instance
   * @throws Error Configuration file does not exist
   * @throws Error Invalid configuration format or missing required fields
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

    const llmData = data.llm ?? {};

    // Parse retry configuration
    const retryData = llmData.retry ?? {};
    const retryConfig = new RetryConfig({
      enabled: retryData.enabled,
      maxRetries: retryData.max_retries,
      initialDelay: retryData.initial_delay,
      maxDelay: retryData.max_delay,
      exponentialBase: retryData.exponential_base,
    });

    const llmConfig = new LLMConfig({
      apiKey: llmData.api_key || undefined, // undefined triggers default value in constructor
      apiBase: llmData.api_base,
      model: llmData.model,
      provider: llmData.provider,
      retry: retryConfig,
    });

    // Parse Agent configuration
    const agentData = data.agent ?? {};
    const agentConfig = new AgentConfig({
      maxSteps: agentData.max_steps,
      workspaceDir: agentData.workspace_dir,
      systemPromptFile: agentData.system_prompt_file,
      tokenLimit: agentData.token_limit,
    });

    // Parse tools configuration
    const toolsData = data.tools ?? {};
    const toolsConfig = new ToolsConfig({
      enableFileTools: toolsData.enable_file_tools,
      enableBash: toolsData.enable_bash,
      enableNote: toolsData.enable_note,
      enableSkills: toolsData.enable_skills,
      skillsDir: toolsData.skills_dir,
      enableMcp: toolsData.enable_mcp,
      mcpConfigPath: toolsData.mcp_config_path,
    });

    // Parse Mongo configuration
    const mongoData = data.mongo ?? {};
    const mongoConfig = new MongoConfig({
      uri: mongoData.uri,
      dbName: mongoData.db_name,
      kind: mongoData.kind,
    });

    // Parse System configuration
    const systemData = data.system ?? {};
    const systemConfig = new SystemConfig({
      dataRoot: systemData.data_root,
      httpsProxy: systemData.https_proxy,
    });

    return new Config({
      llm: llmConfig,
      agent: agentConfig,
      tools: toolsConfig,
      mongo: mongoConfig,
      system: systemConfig,
    });
  }

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
   * 1) packages/ema/src/config/{filename} in current directory (development mode)
   * 2) ~/.ema/config/{filename} in user home directory
   * 3) {package}/config/{filename} in package installation directory
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
    const userConfig = path.join(os.homedir(), ".ema", "config", filename);
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
    return new Config({
      llm: new LLMConfig({ apiKey: "" }),
      agent: new AgentConfig(),
      tools: new ToolsConfig(),
      mongo: new MongoConfig(),
      system: new SystemConfig(),
    });
  }

  private static getConfigYAMLContent(config: Config): string {
    const llmConfig = config.llm;
    const agentConfig = config.agent;
    const toolsConfig = config.tools;
    const mongoConfig = config.mongo;
    const systemConfig = config.system;
    return yaml.dump({
      llm: {
        api_key: llmConfig.apiKey,
        api_base: llmConfig.apiBase,
        model: llmConfig.model,
        provider: llmConfig.provider,
        retry: {
          enabled: llmConfig.retry.enabled,
          max_retries: llmConfig.retry.maxRetries,
          initial_delay: llmConfig.retry.initialDelay,
          max_delay: llmConfig.retry.maxDelay,
          exponential_base: llmConfig.retry.exponentialBase,
        },
      },
      agent: {
        max_steps: agentConfig.maxSteps,
        workspace_dir: agentConfig.workspaceDir,
        system_prompt_file: agentConfig.systemPromptFile,
        token_limit: agentConfig.tokenLimit,
      },
      tools: {
        enable_file_tools: toolsConfig.enableFileTools,
        enable_bash: toolsConfig.enableBash,
        enable_note: toolsConfig.enableNote,
        enable_skills: toolsConfig.enableSkills,
        skills_dir: toolsConfig.skillsDir,
        enable_mcp: toolsConfig.enableMcp,
        mcp_config_path: toolsConfig.mcpConfigPath,
      },
      mongo: {
        uri: mongoConfig.uri,
        db_name: mongoConfig.dbName,
        kind: mongoConfig.kind,
      },
      system: {
        data_root: systemConfig.dataRoot,
        https_proxy: systemConfig.httpsProxy,
      },
    });
  }
}
