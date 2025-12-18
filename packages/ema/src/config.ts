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

export class RetryConfig {
  /** Retry configuration */

  enabled: boolean;
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  exponentialBase: number;

  constructor({
    enabled = true,
    maxRetries = 3,
    initialDelay = 1.0,
    maxDelay = 60.0,
    exponentialBase = 2.0,
  }: Partial<RetryConfig> = {}) {
    this.enabled = enabled;
    this.maxRetries = maxRetries;
    this.initialDelay = initialDelay;
    this.maxDelay = maxDelay;
    this.exponentialBase = exponentialBase;
  }
}

export class LLMConfig {
  /** LLM configuration */

  apiKey: string;
  apiBase: string;
  model: string;
  provider: string; // "anthropic" or "openai"
  retry: RetryConfig;

  constructor({
    apiKey,
    apiBase = "https://generativelanguage.googleapis.com/v1beta/openai/",
    model = "gemini-2.5-flash",
    provider = "openai",
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
  systemPromptPath: string;

  constructor({
    maxSteps = 50,
    workspaceDir = "./workspace",
    systemPromptPath = "system_prompt.md",
  }: Partial<AgentConfig> = {}) {
    this.maxSteps = maxSteps;
    this.workspaceDir = workspaceDir;
    this.systemPromptPath = systemPromptPath;
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

  constructor({
    llm,
    agent,
    tools,
  }: {
    llm: LLMConfig;
    agent: AgentConfig;
    tools: ToolsConfig;
  }) {
    this.llm = llm;
    this.agent = agent;
    this.tools = tools;
  }

  /**
   * Load configuration from the default search path.
   */
  static load(): Config {
    const configPath = this.getDefaultConfigPath();
    if (!fs.existsSync(configPath)) {
      throw new Error(`${configPath} file not found.`);
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

    // Parse LLM configuration
    if (!("api_key" in data)) {
      throw new Error("Configuration file missing required field: api_key");
    }

    if (!data.api_key || data.api_key === "YOUR_API_KEY_HERE") {
      throw new Error("Please configure a valid API Key");
    }

    // Parse retry configuration
    const retryData = data.retry ?? {};
    const retryConfig = new RetryConfig({
      enabled: retryData.enabled,
      maxRetries: retryData.max_retries,
      initialDelay: retryData.initial_delay,
      maxDelay: retryData.max_delay,
      exponentialBase: retryData.exponential_base,
    });

    const llmConfig = new LLMConfig({
      apiKey: data.api_key,
      apiBase: data.api_base,
      model: data.model,
      provider: data.provider,
      retry: retryConfig,
    });

    // Parse Agent configuration
    const agentConfig = new AgentConfig({
      maxSteps: data.max_steps,
      workspaceDir: data.workspace_dir,
      systemPromptPath: data.system_prompt_path,
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

    return new Config({
      llm: llmConfig,
      agent: agentConfig,
      tools: toolsConfig,
    });
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
    // Priority 1: Development mode - current directory's config/ subdirectory
    const devConfig = path.join(
      process.cwd(),
      "packages",
      "ema",
      "src",
      "config",
      filename,
    );
    if (fs.existsSync(devConfig)) {
      return devConfig;
    }

    // Priority 2: User config directory
    const userConfig = path.join(os.homedir(), ".ema", "config", filename);
    if (fs.existsSync(userConfig)) {
      return userConfig;
    }

    // Priority 3: Package installation directory's config/ subdirectory
    const packageConfig = path.join(this.getPackageDir(), "config", filename);
    if (fs.existsSync(packageConfig)) {
      return packageConfig;
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
}
