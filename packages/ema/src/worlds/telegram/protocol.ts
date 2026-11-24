/**
 * @prism-shadow/ema - Telegram Tool Protocol Block Helper
 *
 * Maintains a minimal, non-intrusive `<!-- EMA_TELEGRAM_WORLD_PROTOCOL_START -->` block
 * inside a companion agent's `AGENTS.md` without altering trained personality or MemoryIndex.
 */

import path from "node:path";
import { resolveEmaCliPath } from "../web/workbench.js";

export const TELEGRAM_WORLD_PROTOCOL_START_MARKER = "<!-- EMA_TELEGRAM_WORLD_PROTOCOL_START -->";
export const TELEGRAM_WORLD_PROTOCOL_END_MARKER = "<!-- EMA_TELEGRAM_WORLD_PROTOCOL_END -->";

export function buildTelegramProtocolSection(options: { emaCliPath?: string } = {}): string {
  const emaCliPath = options.emaCliPath || resolveEmaCliPath();

  return [
    TELEGRAM_WORLD_PROTOCOL_START_MARKER,
    "## 聊天消息收发工具",
    "当你收到 `<telegram_input ...>` 传来的外部对话消息时，保持你自己的记忆与说话方式自然回应对方，并通过以下命令行工具把回复发出去：",
    "",
    "- 发送回复（`chat_id` 与 `msg_id` 取自 `<telegram_input>`；回复特定消息时可带 `--parent <msg_id>`，不需要引用时可省略 `--parent`；用单引号包裹 `--message '...'`）：",
    "  ```bash",
    `  node ${emaCliPath} world post /world/telegram/actions/message.send --channel <chat_id> --parent <msg_id> --message '<回复内容>'`,
    "  ```",
    "- 若需要回顾近期聊天上下文，可读取：",
    "  ```bash",
    `  node ${emaCliPath} world get /world/telegram/history/<chat_id>`,
    "  ```",
    "- 只发送你想对对方说的话，不要把 `<OS>` 内心独白或本地文件路径发进聊天里。",
    TELEGRAM_WORLD_PROTOCOL_END_MARKER,
  ].join("\n");
}

export function installTelegramProtocolToAgentsMd(
  existingAgentsMd: string,
  options: { emaCliPath?: string } = {},
): string {
  const block = buildTelegramProtocolSection(options);
  const startIdx = existingAgentsMd.indexOf(TELEGRAM_WORLD_PROTOCOL_START_MARKER);
  const endIdx = existingAgentsMd.indexOf(TELEGRAM_WORLD_PROTOCOL_END_MARKER);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existingAgentsMd.slice(0, startIdx).trimEnd();
    const after = existingAgentsMd
      .slice(endIdx + TELEGRAM_WORLD_PROTOCOL_END_MARKER.length)
      .trimStart();
    return [before, block, after].filter(Boolean).join("\n\n") + "\n";
  }

  const trimmed = existingAgentsMd.trimEnd();
  if (!trimmed) {
    return `${block}\n`;
  }
  return `${trimmed}\n\n---\n\n${block}\n`;
}

export function resolveAgentStateAgentsMdPath(appDataDir: string, agentId: string): string {
  return path.join(appDataDir, "agents", agentId, "agent_state", "AGENTS.md");
}
