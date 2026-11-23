/**
 * @prism-shadow/ema - Global & Agent-Specific TOML Configuration Loader
 *
 * Principles:
 * 1. Configuration is driven by global `config.toml` (`~/.penguin/data/ema/config.toml`)
 *    and agent-specific `config.toml` (`<app_data_dir>/agents/<agentId>/agent_state/config.toml`).
 *    No environment variable (`process.env`) lookups.
 * 2. Fail fast (panic) on missing or malformed configuration instead of silent fallbacks.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

export const DEFAULT_GLOBAL_CONFIG_PATH = path.join(
  os.homedir(),
  ".penguin",
  "data",
  "ema",
  "config.toml",
);

export interface EmaWorldWebConfig {
  dbPath: string;
  initialSessions: string[];
  channelId?: string;
}

export interface EmaWorldQQConfig {
  dbPath: string;
  selfId: string;
  gatewayUrl: string;
  gatewayToken?: string;
  allowedUsers?: string[];
  allowedGroups?: string[];
  groups: string[];
  privateUsers: string[];
}

export interface EmaWorldBilibiliConfig {
  dbPath: string;
  rooms: string[];
  videoTargets: string[];
  dmTargets: string[];
}

export interface EmaWorldChannelConfig {
  dbPath: string;
  channels: string[];
}

export interface EmaWorldTelegramConfig {
  dbPath: string;
  botId: string;
  botUsername: string;
  botToken?: string;
  defaultChatId?: string;
  allowedChatIds: string[];
  writeChatIds: string[];
  forwardSourceChatIds: string[];
  ownerIds: string[];
  allowedMediaDirs?: string[];
  webhookSecret?: string;
  botIndexDir?: string;
  opsLogDir?: string;
}

export interface EmaGlobalSandboxConfig {
  owner: string;
  allowedBins: string[];
  roPaths?: string[];
  emaAgents?: string[];
}

export interface EmaGlobalConfig {
  configPath: string;
  appDataDir: string;
  personasDir: string;
  world: {
    host: string;
    port: number;
    url: string;
    dataDir: string;
    web: EmaWorldWebConfig;
    qq: EmaWorldQQConfig;
    bilibili: EmaWorldBilibiliConfig;
    channel: EmaWorldChannelConfig;
    telegram?: EmaWorldTelegramConfig;
  };
  sandbox?: EmaGlobalSandboxConfig;
}

export interface EmaAgentSpecificConfig {
  configPath: string;
  agent: {
    id: string;
    name: string;
    owner: string;
  };
  world: {
    url: string;
    web: {
      channelId: string;
    };
  };
  sandbox?: {
    ownerApprovedBins: string[];
  };
}

function requireNonEmptyString(val: unknown, fieldName: string, sourcePath: string): string {
  if (typeof val !== "string" || !val.trim()) {
    throw new Error(
      `[EMA Config Panic] Missing or invalid required string field '${fieldName}' in ${sourcePath}`,
    );
  }
  return val.trim();
}

function requirePositiveInt(val: unknown, fieldName: string, sourcePath: string): number {
  if (typeof val !== "number" || !Number.isInteger(val) || val <= 0) {
    throw new Error(
      `[EMA Config Panic] Missing or invalid positive integer field '${fieldName}' in ${sourcePath}`,
    );
  }
  return val;
}

function requireStringArray(val: unknown, fieldName: string, sourcePath: string): string[] {
  if (!Array.isArray(val) || val.some((item) => typeof item !== "string")) {
    throw new Error(
      `[EMA Config Panic] Missing or invalid string array field '${fieldName}' in ${sourcePath}`,
    );
  }
  return val.map((item) => item.trim());
}

/**
 * Loads and validates the global EMA `config.toml` file.
 * Panics immediately if the file is missing, unreadable, or missing required fields.
 */
export function loadEmaGlobalConfig(
  configPath: string = DEFAULT_GLOBAL_CONFIG_PATH,
): EmaGlobalConfig {
  const resolvedPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`[EMA Config Panic] Global config.toml not found at: ${resolvedPath}`);
  }

  const rawText = fs.readFileSync(resolvedPath, "utf8");
  const parsed = parseToml(rawText) as Record<string, any>;

  const appDataDir = requireNonEmptyString(parsed.app_data_dir, "app_data_dir", resolvedPath);
  const personasDir = requireNonEmptyString(parsed.personas_dir, "personas_dir", resolvedPath);

  const world = parsed.world;
  if (!world || typeof world !== "object") {
    throw new Error(`[EMA Config Panic] Missing [world] section in ${resolvedPath}`);
  }

  const host = requireNonEmptyString(world.host, "world.host", resolvedPath);
  const port = requirePositiveInt(world.port, "world.port", resolvedPath);
  const url = requireNonEmptyString(world.url, "world.url", resolvedPath).replace(/\/$/, "");
  const dataDir = requireNonEmptyString(world.data_dir, "world.data_dir", resolvedPath);

  if (!world.web || typeof world.web !== "object") {
    throw new Error(`[EMA Config Panic] Missing [world.web] section in ${resolvedPath}`);
  }
  if (!world.qq || typeof world.qq !== "object") {
    throw new Error(`[EMA Config Panic] Missing [world.qq] section in ${resolvedPath}`);
  }
  if (!world.bilibili || typeof world.bilibili !== "object") {
    throw new Error(`[EMA Config Panic] Missing [world.bilibili] section in ${resolvedPath}`);
  }
  if (!world.channel || typeof world.channel !== "object") {
    throw new Error(`[EMA Config Panic] Missing [world.channel] section in ${resolvedPath}`);
  }

  return {
    configPath: resolvedPath,
    appDataDir,
    personasDir,
    world: {
      host,
      port,
      url,
      dataDir,
      web: {
        dbPath: requireNonEmptyString(world.web.db_path, "world.web.db_path", resolvedPath),
        initialSessions: requireStringArray(
          world.web.initial_sessions,
          "world.web.initial_sessions",
          resolvedPath,
        ),
      },
      qq: {
        dbPath: requireNonEmptyString(world.qq.db_path, "world.qq.db_path", resolvedPath),
        selfId: requireNonEmptyString(world.qq.self_id, "world.qq.self_id", resolvedPath),
        gatewayUrl: requireNonEmptyString(
          world.qq.gateway_url,
          "world.qq.gateway_url",
          resolvedPath,
        ),
        gatewayToken:
          typeof world.qq.gateway_token === "string" ? world.qq.gateway_token.trim() : undefined,
        allowedUsers: Array.isArray(world.qq.allowed_users)
          ? requireStringArray(world.qq.allowed_users, "world.qq.allowed_users", resolvedPath)
          : undefined,
        allowedGroups: Array.isArray(world.qq.allowed_groups)
          ? requireStringArray(world.qq.allowed_groups, "world.qq.allowed_groups", resolvedPath)
          : undefined,
        groups: requireStringArray(world.qq.groups, "world.qq.groups", resolvedPath),
        privateUsers: requireStringArray(
          world.qq.private_users,
          "world.qq.private_users",
          resolvedPath,
        ),
      },
      bilibili: {
        dbPath: requireNonEmptyString(
          world.bilibili.db_path,
          "world.bilibili.db_path",
          resolvedPath,
        ),
        rooms: requireStringArray(world.bilibili.rooms, "world.bilibili.rooms", resolvedPath),
        videoTargets: requireStringArray(
          world.bilibili.video_targets,
          "world.bilibili.video_targets",
          resolvedPath,
        ),
        dmTargets: requireStringArray(
          world.bilibili.dm_targets,
          "world.bilibili.dm_targets",
          resolvedPath,
        ),
      },
      channel: {
        dbPath: requireNonEmptyString(world.channel.db_path, "world.channel.db_path", resolvedPath),
        channels: requireStringArray(
          world.channel.channels,
          "world.channel.channels",
          resolvedPath,
        ),
      },
      ...(world.telegram && typeof world.telegram === "object"
        ? {
            telegram: {
              dbPath: requireNonEmptyString(
                world.telegram.db_path,
                "world.telegram.db_path",
                resolvedPath,
              ),
              botId: requireNonEmptyString(
                world.telegram.bot_id,
                "world.telegram.bot_id",
                resolvedPath,
              ),
              botUsername: requireNonEmptyString(
                world.telegram.bot_username,
                "world.telegram.bot_username",
                resolvedPath,
              ),
              botToken:
                typeof world.telegram.bot_token === "string" && world.telegram.bot_token.trim()
                  ? world.telegram.bot_token.trim()
                  : undefined,
              defaultChatId:
                typeof world.telegram.default_chat_id === "string" &&
                world.telegram.default_chat_id.trim()
                  ? world.telegram.default_chat_id.trim()
                  : undefined,
              allowedChatIds: requireStringArray(
                world.telegram.allowed_chat_ids,
                "world.telegram.allowed_chat_ids",
                resolvedPath,
              ),
              writeChatIds: Array.isArray(world.telegram.write_chat_ids)
                ? requireStringArray(
                    world.telegram.write_chat_ids,
                    "world.telegram.write_chat_ids",
                    resolvedPath,
                  )
                : requireStringArray(
                    world.telegram.allowed_chat_ids,
                    "world.telegram.allowed_chat_ids",
                    resolvedPath,
                  ),
              forwardSourceChatIds: Array.isArray(world.telegram.forward_source_chat_ids)
                ? requireStringArray(
                    world.telegram.forward_source_chat_ids,
                    "world.telegram.forward_source_chat_ids",
                    resolvedPath,
                  )
                : [],
              ownerIds: Array.isArray(world.telegram.owner_ids)
                ? requireStringArray(
                    world.telegram.owner_ids,
                    "world.telegram.owner_ids",
                    resolvedPath,
                  )
                : [],
              allowedMediaDirs: Array.isArray(world.telegram.allowed_media_dirs)
                ? requireStringArray(
                    world.telegram.allowed_media_dirs,
                    "world.telegram.allowed_media_dirs",
                    resolvedPath,
                  )
                : undefined,
              webhookSecret:
                typeof world.telegram.webhook_secret === "string" &&
                world.telegram.webhook_secret.trim()
                  ? world.telegram.webhook_secret.trim()
                  : undefined,
              botIndexDir:
                typeof world.telegram.bot_index_dir === "string"
                  ? world.telegram.bot_index_dir.trim()
                  : undefined,
              opsLogDir:
                typeof world.telegram.ops_log_dir === "string"
                  ? world.telegram.ops_log_dir.trim()
                  : undefined,
            },
          }
        : {}),
    },
    ...(parsed.sandbox && typeof parsed.sandbox === "object"
      ? {
          sandbox: {
            owner: requireNonEmptyString(parsed.sandbox.owner, "sandbox.owner", resolvedPath),
            allowedBins: requireStringArray(
              parsed.sandbox.allowed_bins,
              "sandbox.allowed_bins",
              resolvedPath,
            ),
            ...(Array.isArray(parsed.sandbox.ro_paths)
              ? {
                  roPaths: requireStringArray(
                    parsed.sandbox.ro_paths,
                    "sandbox.ro_paths",
                    resolvedPath,
                  ),
                }
              : {}),
            ...(Array.isArray(parsed.sandbox.ema_agents)
              ? {
                  emaAgents: requireStringArray(
                    parsed.sandbox.ema_agents,
                    "sandbox.ema_agents",
                    resolvedPath,
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * Loads and validates an agent-specific `config.toml` file
 * (`<app_data_dir>/agents/<agentId>/agent_state/config.toml`).
 * Panics immediately if the file is missing or malformed.
 */
export function loadEmaAgentConfig(
  agentId: string,
  options:
    | string
    | {
        globalConfigPath?: string;
        agentConfigPath?: string;
        appDataDir?: string;
      } = {},
): EmaAgentSpecificConfig {
  const opts = typeof options === "string" ? { appDataDir: options } : options;
  const appDataDir = opts.appDataDir || loadEmaGlobalConfig(opts.globalConfigPath).appDataDir;
  const resolvedAgentPath = opts.agentConfigPath
    ? path.resolve(opts.agentConfigPath)
    : path.join(appDataDir, "agents", agentId, "agent_state", "config.toml");

  if (!fs.existsSync(resolvedAgentPath)) {
    throw new Error(
      `[EMA Config Panic] Agent config.toml for '${agentId}' not found at: ${resolvedAgentPath}`,
    );
  }

  const rawText = fs.readFileSync(resolvedAgentPath, "utf8");
  const parsed = parseToml(rawText) as Record<string, any>;

  if (!parsed.agent || typeof parsed.agent !== "object") {
    throw new Error(`[EMA Config Panic] Missing [agent] section in ${resolvedAgentPath}`);
  }
  if (!parsed.world || typeof parsed.world !== "object") {
    throw new Error(`[EMA Config Panic] Missing [world] section in ${resolvedAgentPath}`);
  }
  if (!parsed.world.web || typeof parsed.world.web !== "object") {
    throw new Error(`[EMA Config Panic] Missing [world.web] section in ${resolvedAgentPath}`);
  }

  return {
    configPath: resolvedAgentPath,
    agent: {
      id: requireNonEmptyString(parsed.agent.id, "agent.id", resolvedAgentPath),
      name: requireNonEmptyString(parsed.agent.name, "agent.name", resolvedAgentPath),
      owner: requireNonEmptyString(parsed.agent.owner, "agent.owner", resolvedAgentPath),
    },
    world: {
      url: requireNonEmptyString(parsed.world.url, "world.url", resolvedAgentPath).replace(
        /\/$/,
        "",
      ),
      web: {
        channelId: requireNonEmptyString(
          parsed.world.web.channel_id,
          "world.web.channel_id",
          resolvedAgentPath,
        ),
      },
    },
    ...(parsed.sandbox && typeof parsed.sandbox === "object"
      ? {
          sandbox: {
            ownerApprovedBins: requireStringArray(
              parsed.sandbox.owner_approved_bins,
              "sandbox.owner_approved_bins",
              resolvedAgentPath,
            ),
          },
        }
      : {}),
  };
}

/**
 * Verifies that `binName` is in the global `allowed_bins` or the agent's `owner_approved_bins`.
 * Panics immediately if the binary is not whitelisted, requiring explicit EMA Agent Owner approval.
 */
export function assertSandboxBinaryAllowed(
  binName: string,
  globalCfg: EmaGlobalConfig,
  agentCfg?: EmaAgentSpecificConfig | null,
): void {
  if (!globalCfg.sandbox || globalCfg.sandbox.allowedBins.length === 0) {
    throw new Error(
      `[EMA Sandbox Panic] Missing or empty [sandbox].allowed_bins in ${globalCfg.configPath}`,
    );
  }
  const baseName = path.basename(binName.trim());
  const allowed = new Set([
    ...globalCfg.sandbox.allowedBins,
    ...(agentCfg?.sandbox?.ownerApprovedBins ?? []),
  ]);
  if (!allowed.has(baseName)) {
    const owner = agentCfg?.agent.owner || globalCfg.sandbox.owner;
    const targetConfig = agentCfg?.configPath || globalCfg.configPath;
    throw new Error(
      `[EMA Sandbox Panic] Binary '${baseName}' is blocked (not in sandbox bin whitelist). Execution requires explicit approval from the EMA Agent Owner ('${owner}') via [sandbox].owner_approved_bins in ${targetConfig}.`,
    );
  }
}

/**
 * Determines whether a given agent is an EMA companion agent subject to the
 * Dual-Whitelist sandbox. An agent is an EMA companion if:
 * 1. It is explicitly listed in `[sandbox].ema_agents` in global `config.toml`, OR
 * 2. Its agent directory contains `agent_state/config.toml` with valid `[agent]` and `[world]` sections.
 */
export function isEmaAgent(
  agentId: string,
  options: {
    globalCfg?: EmaGlobalConfig | null;
    agentDir?: string;
    appDataDir?: string;
  } = {},
): boolean {
  if (options.globalCfg?.sandbox?.emaAgents?.includes(agentId)) {
    return true;
  }
  const appDataDir = options.appDataDir ?? options.globalCfg?.appDataDir;
  const agentDir =
    options.agentDir ??
    (appDataDir ? path.join(appDataDir, "agents", agentId) : undefined);
  if (agentDir) {
    const agentCfgPath = path.join(agentDir, "agent_state", "config.toml");
    if (fs.existsSync(agentCfgPath)) {
      try {
        const raw = fs.readFileSync(agentCfgPath, "utf8");
        const parsed = parseToml(raw) as Record<string, any>;
        if (parsed && typeof parsed === "object" && parsed.agent && parsed.world) {
          return true;
        }
      } catch {
        return false;
      }
    }
  }
  return false;
}
