/**
 * @prism-shadow/ema - BotIndex Telegram History Persistence (`BotIndex/Telegram`)
 *
 * Persists inbound and outbound Telegram messages in real time to:
 *   `<botIndexDir>/Telegram/<alias>/<YYYY>/<MM-DD>.jsonl`
 * and atomically updates:
 *   `<botIndexDir>/Telegram/chats.json`
 */

import fs from "node:fs";
import path from "node:path";
import type {
  TelegramBotIndexEntry,
  TelegramChatIndexMeta,
  TelegramMessage,
} from "./types.js";
import { toShanghaiTimeParts } from "./ops-log.js";
import { normalizeTelegramChatId } from "./authorization.js";

function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Produces a filesystem-safe directory alias for a Telegram chat.
 */
export function sanitizeChatAlias(
  chatId: string | number,
  titleOrUsername?: string,
  customAliases: Record<string, string> = {},
): string {
  const normId = normalizeTelegramChatId(chatId);
  if (customAliases[normId]) {
    const safeCustom = customAliases[normId]
      .replace(/[\/\\:*?"<>|\x00-\x1F]+/g, "_")
      .replace(/\.\./g, "_")
      .trim();
    if (safeCustom && safeCustom !== "." && safeCustom !== "..") {
      return safeCustom;
    }
  }
  const raw = String(titleOrUsername || "").trim();
  if (!raw) {
    return `chat_${normId}`;
  }
  const cleaned = raw
    .replace(/[\/\\:*?"<>|\x00-\x1F]+/g, "_")
    .replace(/\.\./g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return cleaned || `chat_${normId}`;
}

export interface TelegramBotIndexStoreOptions {
  botIndexDir: string;
  aliases?: Record<string, string>;
}

export class TelegramBotIndexStore {
  public readonly botIndexDir: string;
  public readonly telegramRoot: string;
  public readonly chatsIndexPath: string;
  private readonly aliases: Record<string, string>;

  constructor(options: TelegramBotIndexStoreOptions | string) {
    const opts = typeof options === "string" ? { botIndexDir: options } : options;
    this.botIndexDir = path.resolve(opts.botIndexDir);
    this.telegramRoot = path.join(this.botIndexDir, "Telegram");
    this.chatsIndexPath = path.join(this.telegramRoot, "chats.json");
    this.aliases = { ...(opts.aliases ?? {}) };
  }

  public loadChatsIndex(): Record<string, TelegramChatIndexMeta> {
    if (!fs.existsSync(this.chatsIndexPath)) {
      return {};
    }
    const raw = fs.readFileSync(this.chatsIndexPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, TelegramChatIndexMeta>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `[TelegramBotIndexStore] Corrupt chats.json at ${this.chatsIndexPath}: expected JSON object`,
      );
    }
    return parsed;
  }

  public saveChatsIndex(index: Record<string, TelegramChatIndexMeta>): void {
    fs.mkdirSync(this.telegramRoot, { recursive: true });
    const tmp = `${this.chatsIndexPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(index, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, this.chatsIndexPath);
  }

  /**
   * Appends a single `TelegramBotIndexEntry` to `<botIndexDir>/Telegram/<alias>/<YYYY>/<MM-DD>.jsonl`
   * and updates `<botIndexDir>/Telegram/chats.json`.
   */
  public appendEntry(
    entry: TelegramBotIndexEntry,
    explicitAlias?: string,
  ): { filePath: string; alias: string } {
    const chatIdStr = normalizeTelegramChatId(entry.chat_id);
    const chatsIndex = this.loadChatsIndex();
    const existingMeta = chatsIndex[chatIdStr];

    const alias =
      (explicitAlias ? sanitizeChatAlias(chatIdStr, explicitAlias) : undefined) ||
      existingMeta?.alias ||
      sanitizeChatAlias(chatIdStr, entry.chat_title, this.aliases);

    // Determine YYYY and MM-DD from entry.ts (already +08:00 or ISO)
    let year = entry.ts.slice(0, 4);
    let monthDay = entry.ts.slice(5, 10);
    if (!/^\d{4}$/.test(year) || !/^\d{2}-\d{2}$/.test(monthDay)) {
      const parts = toShanghaiTimeParts(Date.now());
      year = parts.year;
      monthDay = parts.monthDay;
    }

    const dir = path.join(this.telegramRoot, alias, year);
    if (!isPathInsideRoot(this.telegramRoot, dir)) {
      throw new Error(`[TelegramBotIndexStore] Refusing unsafe alias path: ${alias}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${monthDay}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");

    chatsIndex[chatIdStr] = {
      alias,
      title: entry.chat_title || existingMeta?.title || alias,
      type: entry.chat_type || existingMeta?.type || "channel",
      ...(existingMeta?.username ? { username: existingMeta.username } : {}),
      ...(existingMeta?.channel ? { channel: existingMeta.channel } : {}),
      last_msg_at: entry.ts,
      last_msg_id: Math.max(existingMeta?.last_msg_id ?? 0, entry.msg_id),
      total_messages: (existingMeta?.total_messages ?? 0) + 1,
    };
    this.saveChatsIndex(chatsIndex);

    return { filePath, alias };
  }

  /**
   * Converts a raw `TelegramMessage` into a `TelegramBotIndexEntry` and persists it.
   */
  public recordTelegramMessage(
    msg: TelegramMessage,
    dir: "in" | "out",
    overrideText?: string,
  ): TelegramBotIndexEntry {
    const tsMs = msg.date ? msg.date * 1000 : Date.now();
    const { iso } = toShanghaiTimeParts(tsMs);

    let media: string | undefined;
    if (msg.photo && msg.photo.length > 0) media = "photo";
    else if (msg.document) media = `document:${msg.document.file_name || msg.document.file_id}`;
    else if (msg.video) media = "video";
    else if (msg.audio) media = "audio";
    else if (msg.voice) media = "voice";
    else if (msg.sticker) media = `sticker:${msg.sticker.emoji || ""}`;
    else if (msg.animation) media = "animation";

    const sender = msg.from;
    const senderName = sender
      ? `${sender.first_name || ""} ${sender.last_name || ""}`.trim() || sender.username
      : msg.sender_chat?.title;

    const entry: TelegramBotIndexEntry = {
      v: 1,
      ts: iso,
      msg_id: msg.message_id,
      chat_id: msg.chat.id,
      chat_title:
        msg.chat.title ||
        msg.chat.username ||
        `${msg.chat.first_name || ""} ${msg.chat.last_name || ""}`.trim() ||
        String(msg.chat.id),
      chat_type: msg.chat.type,
      dir,
      ...(sender?.id !== undefined
        ? { from_id: sender.id }
        : msg.sender_chat?.id !== undefined
          ? { from_id: msg.sender_chat.id }
          : {}),
      ...(sender?.username ? { from_username: sender.username } : {}),
      ...(senderName ? { from_name: senderName } : {}),
      ...(msg.reply_to_message?.message_id
        ? { reply_to_msg_id: msg.reply_to_message.message_id }
        : {}),
      text: overrideText ?? msg.text ?? msg.caption ?? "",
      ...(media ? { media } : {}),
    };

    this.appendEntry(entry);
    return entry;
  }

  /**
   * Resolves the directory path for a chat ID or alias safely within `this.telegramRoot`.
   */
  public resolveChatDir(chatIdOrAlias: string | number): string | null {
    const str = String(chatIdOrAlias).trim();
    if (!str || str === "." || str === ".." || /[\/\\]|\.\./.test(str)) {
      return null;
    }
    const normId = normalizeTelegramChatId(str);
    const chatsIndex = this.loadChatsIndex();

    if (chatsIndex[normId]?.alias) {
      const candidate = path.resolve(this.telegramRoot, chatsIndex[normId].alias);
      if (isPathInsideRoot(this.telegramRoot, candidate) && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    if (this.aliases[normId]) {
      const candidate = path.resolve(this.telegramRoot, this.aliases[normId]);
      if (isPathInsideRoot(this.telegramRoot, candidate) && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const directCandidate = path.resolve(this.telegramRoot, str);
    if (isPathInsideRoot(this.telegramRoot, directCandidate) && fs.existsSync(directCandidate)) {
      return directCandidate;
    }

    return null;
  }

  /**
   * Loads the most recent `limit` messages for a given chat ID or alias.
   */
  public loadRecentHistory(
    chatIdOrAlias: string | number,
    limit = 30,
  ): TelegramBotIndexEntry[] {
    const chatDir = this.resolveChatDir(chatIdOrAlias);
    if (!chatDir || !fs.existsSync(chatDir)) return [];

    const yearDirs = fs
      .readdirSync(chatDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse();

    const collected: TelegramBotIndexEntry[] = [];
    for (const year of yearDirs) {
      const yearPath = path.join(chatDir, year);
      const dayFiles = fs
        .readdirSync(yearPath)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .reverse();

      for (const dayFile of dayFiles) {
        const lines = fs
          .readFileSync(path.join(yearPath, dayFile), "utf8")
          .split("\n")
          .filter((l) => l.trim().length > 0);
        const dayEntries: TelegramBotIndexEntry[] = [];
        for (const line of lines) {
          try {
            dayEntries.push(JSON.parse(line) as TelegramBotIndexEntry);
          } catch {
            // Skip invalid JSON line
          }
        }
        collected.unshift(...dayEntries);
        if (collected.length >= limit) {
          return collected.slice(-limit);
        }
      }
    }

    return collected.slice(-limit);
  }

  /**
   * Searches stored BotIndex JSONL records by substring or regex pattern.
   */
  public searchHistory(
    query: string,
    options: { chatIdOrAlias?: string | number; maxMatches?: number; regex?: boolean } = {},
  ): TelegramBotIndexEntry[] {
    const maxMatches = options.maxMatches ?? 50;
    const matches: TelegramBotIndexEntry[] = [];
    if (!fs.existsSync(this.telegramRoot)) return matches;

    const queryStr = String(query ?? "");
    if (!queryStr) return matches;

    let regex: RegExp | null = null;
    if (options.regex && queryStr.length <= 200) {
      try {
        regex = new RegExp(queryStr, "i");
      } catch {
        regex = null;
      }
    }
    const lowerQuery = queryStr.toLowerCase();

    const targetDirs: string[] = [];
    if (options.chatIdOrAlias !== undefined) {
      const resolved = this.resolveChatDir(options.chatIdOrAlias);
      if (resolved) targetDirs.push(resolved);
    } else {
      for (const entry of fs.readdirSync(this.telegramRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          targetDirs.push(path.join(this.telegramRoot, entry.name));
        }
      }
    }

    for (const chatDir of targetDirs) {
      const yearDirs = fs
        .readdirSync(chatDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
        .map((d) => d.name)
        .sort();

      for (const year of yearDirs) {
        const yearPath = path.join(chatDir, year);
        const files = fs
          .readdirSync(yearPath)
          .filter((f) => f.endsWith(".jsonl"))
          .sort();
        for (const file of files) {
          const lines = fs.readFileSync(path.join(yearPath, file), "utf8").split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            const matched = regex ? regex.test(line) : line.toLowerCase().includes(lowerQuery);
            if (!matched) continue;
            try {
              const parsed = JSON.parse(line) as TelegramBotIndexEntry;
              matches.push(parsed);
              if (matches.length >= maxMatches) return matches;
            } catch {
              // Ignore malformed line
            }
          }
        }
      }
    }

    return matches;
  }
}
