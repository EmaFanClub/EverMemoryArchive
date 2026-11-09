/**
 * @prism-shadow/ema - Web Companion Portal Workbench Installer
 *
 * Installs the RFC-0002 compliant Web Companion Portal Workbench (`companion_portal`)
 * into a Penguin agent's `agent_state/workbenches/` directory and configures its
 * RFC-0002 Social Media Channel Protocol instructions.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WebWorkbenchInstallOptions, WebWorkbenchInstallResult } from "./types.js";

export const WEB_CHANNEL_PROTOCOL_START_MARKER = "<!-- EMA_WEB_CHANNEL_PROTOCOL_START -->";
export const WEB_CHANNEL_PROTOCOL_END_MARKER = "<!-- EMA_WEB_CHANNEL_PROTOCOL_END -->";

/**
 * Resolves the root directory of `@prism-shadow/ema` package.
 */
export function resolveEmaPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  // currentFile is either <pkg>/src/worlds/web/workbench.ts or <pkg>/dist/worlds/web/workbench.js
  return path.resolve(path.dirname(currentFile), "../../..");
}

/**
 * Resolves the bundled `companion_portal` workbench template directory inside `@prism-shadow/ema`.
 */
export function resolveWebWorkbenchTemplateDir(): string {
  return path.join(resolveEmaPackageRoot(), "workbenches", "companion_portal");
}

/**
 * Resolves the `bin/ema.js` CLI binary path inside `@prism-shadow/ema`.
 */
export function resolveEmaCliPath(): string {
  return path.join(resolveEmaPackageRoot(), "bin", "ema.js");
}

/**
 * Builds the RFC-0002 Social Media Channel Protocol Markdown block for an agent's `AGENTS.md`.
 */
export function buildWebChannelProtocolSection(options: {
  channelId?: string;
  dbPath: string;
  emaCliPath?: string;
}): string {
  const channelId = options.channelId || "web:chatroom:default";
  const emaCliPath = options.emaCliPath || resolveEmaCliPath();

  return [
    WEB_CHANNEL_PROTOCOL_START_MARKER,
    "## RFC-0002 Social Media Channel Protocol (聊天室频道读写协议)",
    "",
    `当你收到来自 \`web\` 世界聊天室频道（如 \`<Channel>${channelId}</Channel>\`）的事件通知时，你必须严格按照 **RFC-0002** 社交频道协议通过命令行工具进行读取和发言：`,
    "",
    "1. **第一步：读取聊天室频道 (`world get`)**",
    "   使用 shell 工具读取当前聊天室频道的消息列表与时间锚点上下文（`EmaTemporalEnvelope`）：",
    "   ```bash",
    `   node ${emaCliPath} world get /world/web/channels/${channelId}/items --db ${options.dbPath}`,
    "   ```",
    "2. **第二步：发送回复消息到聊天室频道 (`world post`)**",
    "   阅读频道中的最新消息后，使用 `message.post` 动作将你的回复发送到聊天室频道：",
    "   ```bash",
    `   node ${emaCliPath} world post /world/web/actions/message.post --db ${options.dbPath} --channel ${channelId} --parent <回复的目标消息ID> --message "<你的温柔回复内容>"`,
    "   ```",
    "3. **完成回合**：",
    `   成功通过 \`world post\` 将消息发布到 \`${channelId}\` 频道后，直接输出你刚才发送的那句回复内容结束当前回合（不要输出“我已发送到频道”等元解释）。`,
    WEB_CHANNEL_PROTOCOL_END_MARKER,
  ].join("\n");
}

/**
 * Injects or updates the RFC-0002 Web Channel Protocol section inside an existing `AGENTS.md` string.
 */
export function installWebChannelProtocolToAgentsMd(
  existingAgentsMd: string,
  options: {
    channelId?: string;
    dbPath: string;
    emaCliPath?: string;
  },
): string {
  const block = buildWebChannelProtocolSection(options);

  const startIdx = existingAgentsMd.indexOf(WEB_CHANNEL_PROTOCOL_START_MARKER);
  const endIdx = existingAgentsMd.indexOf(WEB_CHANNEL_PROTOCOL_END_MARKER);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existingAgentsMd.slice(0, startIdx).trimEnd();
    const after = existingAgentsMd
      .slice(endIdx + WEB_CHANNEL_PROTOCOL_END_MARKER.length)
      .trimStart();
    return [before, block, after].filter(Boolean).join("\n\n") + "\n";
  }

  // If legacy "## 4. RFC-0002 Social Media Channel Protocol" section exists without markers, replace it
  const legacyHeading = "## 4. RFC-0002 Social Media Channel Protocol";
  const legacyIdx = existingAgentsMd.indexOf(legacyHeading);
  if (legacyIdx !== -1) {
    const before = existingAgentsMd.slice(0, legacyIdx).trimEnd();
    return `${before}\n\n${block}\n`;
  }

  const trimmed = existingAgentsMd.trimEnd();
  if (!trimmed) {
    return `${block}\n`;
  }
  return `${trimmed}\n\n---\n\n${block}\n`;
}

/**
 * Installs the Web Companion Portal Workbench (`companion_portal`) into a target Penguin agent.
 */
export function installWebWorkbench(
  options: WebWorkbenchInstallOptions,
): WebWorkbenchInstallResult {
  const agentId = (options.agentId || "").trim();
  if (!agentId || !/^[a-zA-Z0-9_]+$/.test(agentId)) {
    throw new Error(
      `Invalid agentId '${agentId}': must be non-empty and contain only letters, digits, and underscores.`,
    );
  }

  const workbenchId = (options.workbenchId || "companion_portal").trim();
  const companionName = (options.companionName || "苍星怜").trim();
  const avatarChar = (
    options.avatarChar ||
    companionName.charAt(companionName.length - 1) ||
    "怜"
  ).trim();
  const ownerName = (options.ownerName || "Rei").trim();
  const channelId = (options.channelId || "web:chatroom:default").trim();

  const appDataDir =
    options.appDataDir ||
    process.env.PENGUIN_APP_DATA_DIR ||
    path.join(os.homedir(), ".penguin", "data", "default_project");

  const agentRootDir = path.join(appDataDir, "agents", agentId);
  const workbenchDir =
    options.targetWorkbenchDir ||
    path.join(agentRootDir, "agent_state", "workbenches", workbenchId);

  const dbPath =
    options.dbPath || path.join(agentRootDir, "scratchpad", workbenchId, "web-world.sqlite");

  const emaCliPath = options.emaCliPath || resolveEmaCliPath();
  const templateDir = resolveWebWorkbenchTemplateDir();

  if (!fs.existsSync(templateDir)) {
    throw new Error(`Web workbench template directory not found at: ${templateDir}`);
  }

  const uiDir = path.join(workbenchDir, "ui");
  fs.mkdirSync(uiDir, { recursive: true });

  // 1. Customize and write package.json
  const pkgJsonPath = path.join(templateDir, "package.json");
  const rawPkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as Record<string, unknown>;
  rawPkg.name = `${agentId.replace(/_/g, "-")}-${workbenchId.replace(/_/g, "-")}`;
  const penguinCfg = rawPkg.penguin as {
    modules?: Array<{
      contributes?: {
        "WebModule.sessionTabs"?: Array<{
          id: string;
          key: string;
          title: string;
          titleZh: string;
          renderer: { iframe: { src: string } };
        }>;
      };
    }>;
  };
  const tabs = penguinCfg?.modules?.[0]?.contributes?.["WebModule.sessionTabs"];
  if (tabs && tabs[0]) {
    tabs[0].id = `${workbenchId}.main`;
    tabs[0].key = workbenchId.replace(/_/g, "-");
    tabs[0].title = companionName === "苍星怜" ? "Aoi Rei Chat" : `${companionName} Chat`;
    tabs[0].titleZh = companionName;
  }
  const destPkgPath = path.join(workbenchDir, "package.json");
  fs.writeFileSync(destPkgPath, JSON.stringify(rawPkg, null, 2) + "\n", "utf8");

  // 2. Customize and write index.ts
  const srcIndexTs = fs.readFileSync(path.join(templateDir, "index.ts"), "utf8");
  const customizedIndexTs = srcIndexTs
    .replace(
      /const WEB_WORLD_DB_PATH =\s*"[^"]+";/,
      `const WEB_WORLD_DB_PATH = ${JSON.stringify(dbPath)};`,
    )
    .replace(
      /const EMA_CLI_PATH =\s*"[^"]+";/,
      `const EMA_CLI_PATH = ${JSON.stringify(emaCliPath)};`,
    )
    .replace(
      /const DEFAULT_CHANNEL_ID = "[^"]+";/,
      `const DEFAULT_CHANNEL_ID = ${JSON.stringify(channelId)};`,
    )
    .replace(
      /const BOT_NODE_ID = "[^"]+";/,
      `const BOT_NODE_ID = ${JSON.stringify(`web:bot:${agentId}`)};`,
    )
    .replaceAll("苍星怜", companionName)
    .replaceAll('"Rei"', JSON.stringify(ownerName));

  const destIndexTsPath = path.join(workbenchDir, "index.ts");
  fs.writeFileSync(destIndexTsPath, customizedIndexTs, "utf8");

  // 3. Customize and write ui/index.html, ui/style.css, ui/app.js
  const srcHtml = fs.readFileSync(path.join(templateDir, "ui", "index.html"), "utf8");
  const customizedHtml = srcHtml
    .replaceAll("苍星怜", companionName)
    .replace(
      '<span class="avatar" aria-hidden="true">怜</span>',
      `<span class="avatar" aria-hidden="true">${avatarChar}</span>`,
    );
  const destHtmlPath = path.join(uiDir, "index.html");
  fs.writeFileSync(destHtmlPath, customizedHtml, "utf8");

  const srcCss = fs.readFileSync(path.join(templateDir, "ui", "style.css"), "utf8");
  const destCssPath = path.join(uiDir, "style.css");
  fs.writeFileSync(destCssPath, srcCss, "utf8");

  const srcAppJs = fs.readFileSync(path.join(templateDir, "ui", "app.js"), "utf8");
  const customizedAppJs = srcAppJs.replace(
    'avatar.textContent = "怜";',
    `avatar.textContent = ${JSON.stringify(avatarChar)};`,
  );
  const destAppJsPath = path.join(uiDir, "app.js");
  fs.writeFileSync(destAppJsPath, customizedAppJs, "utf8");

  // 4. Optionally update AGENTS.md with RFC-0002 Channel Protocol
  let agentsMdUpdated = false;
  if (options.updateAgentsMd !== false && !options.targetWorkbenchDir) {
    const agentsMdPath = path.join(agentRootDir, "agent_state", "AGENTS.md");
    if (fs.existsSync(agentsMdPath)) {
      const existingMd = fs.readFileSync(agentsMdPath, "utf8");
      const updatedMd = installWebChannelProtocolToAgentsMd(existingMd, {
        channelId,
        dbPath,
        emaCliPath,
      });
      fs.writeFileSync(agentsMdPath, updatedMd, "utf8");
      agentsMdUpdated = true;
    }
  }

  return {
    agentId,
    workbenchId,
    workbenchDir,
    dbPath,
    emaCliPath,
    files: [destPkgPath, destIndexTsPath, destHtmlPath, destCssPath, destAppJsPath],
    agentsMdUpdated,
  };
}
