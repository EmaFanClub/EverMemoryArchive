/**
 * @prism-shadow/ema - Telegram Operations Logger (ops-log)
 *
 * - Formats timestamps in Asia/Shanghai (UTC+8) and partitions JSONL files by
 *   `<opsLogDir>/<folderName>/<YYYY>/<MM-DD>.jsonl`.
 * - Supports local JSONL logging as well as live Telegram dispatch (`logMessage` and
 *   `forwardAndLog` into a configured target chat).
 */

import fs from "node:fs";
import path from "node:path";
import type { TelegramContentFilterConfig, TelegramOpsLogEntry } from "./types.js";
import type { TelegramClient } from "./client.js";
import { checkTelegramContentFilter } from "./filter.js";

/**
 * Formats a Date or epoch ms into Asia/Shanghai (UTC+8) ISO string and date components.
 */
export function toShanghaiTimeParts(dateOrMs: Date | number = Date.now()): {
  iso: string;
  year: string;
  monthDay: string;
} {
  const ms = typeof dateOrMs === "number" ? dateOrMs : dateOrMs.getTime();
  const shanghaiMs = ms + 8 * 3600 * 1000;
  const shanghaiDate = new Date(shanghaiMs);
  const isoRaw = shanghaiDate.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  const iso = isoRaw.replace("Z", "+08:00");
  const year = iso.slice(0, 4);
  const monthDay = iso.slice(5, 10);
  return { iso, year, monthDay };
}

export interface TelegramOpsLoggerOptions {
  opsLogDir: string;
  targetChatId?: string | number;
  folderName?: string;
  client?: TelegramClient;
  contentFilter?: TelegramContentFilterConfig;
  bannedWords?: string[];
  bannedWordAction?: "reject" | "mask";
  onMessageSent?: (chatId: string, messageId: number) => void;
}

export class TelegramOpsLogger {
  public readonly opsLogDir: string;
  public readonly targetChatId?: string;
  public readonly folderName: string;
  private client?: TelegramClient;
  private contentFilter?: TelegramContentFilterConfig;
  private bannedWords: string[];
  private bannedWordAction: "reject" | "mask";
  private onMessageSent?: (chatId: string, messageId: number) => void;

  constructor(options: TelegramOpsLoggerOptions) {
    this.opsLogDir = path.resolve(options.opsLogDir);
    this.targetChatId =
      options.targetChatId !== undefined && String(options.targetChatId).trim() !== ""
        ? String(options.targetChatId).trim()
        : undefined;
    const rawFolder = String(options.folderName || "default").trim();
    if (!rawFolder || rawFolder === "." || rawFolder === ".." || /[\/\\]/.test(rawFolder)) {
      throw new Error(`[TelegramOpsLogger] Invalid folderName: '${rawFolder}'`);
    }
    this.folderName = rawFolder;
    this.client = options.client;
    this.contentFilter = options.contentFilter;
    this.bannedWords = options.bannedWords ?? [];
    this.bannedWordAction = options.bannedWordAction ?? "reject";
    this.onMessageSent = options.onMessageSent;
  }

  public setClient(client: TelegramClient): void {
    this.client = client;
  }

  /**
   * Appends a single operations log entry to `<opsLogDir>/<folderName>/<YYYY>/<MM-DD>.jsonl`.
   */
  public appendEntry(
    entry: Omit<TelegramOpsLogEntry, "ts"> & { ts?: string },
    timestampMs = Date.now(),
  ): TelegramOpsLogEntry {
    const { iso, year, monthDay } = toShanghaiTimeParts(timestampMs);
    const fullEntry: TelegramOpsLogEntry = {
      ts: entry.ts || iso,
      category: entry.category,
      ...(entry.channel ? { channel: entry.channel } : {}),
      details: entry.details,
      ...(entry.msg_id !== undefined ? { msg_id: entry.msg_id } : {}),
      ...(entry.forwarded_msg_ids ? { forwarded_msg_ids: entry.forwarded_msg_ids } : {}),
      ...(entry.source_chat_id !== undefined ? { source_chat_id: entry.source_chat_id } : {}),
      ...(entry.source_msg_ids ? { source_msg_ids: entry.source_msg_ids } : {}),
      ...(entry.meta ? { meta: entry.meta } : {}),
    };

    const dir = path.join(this.opsLogDir, this.folderName, year);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${monthDay}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(fullEntry) + "\n", "utf8");
    return fullEntry;
  }

  /**
   * Sends a formatted notification to `targetChatId` (if `sendToTelegram` is true and client is configured)
   * and records the entry in `<opsLogDir>/<folderName>/<YYYY>/<MM-DD>.jsonl`.
   */
  public async logMessage(params: {
    text?: string;
    category: string;
    channel?: string;
    details: string;
    meta?: Record<string, unknown>;
    sendToTelegram?: boolean;
  }): Promise<TelegramOpsLogEntry> {
    let msgId: number | undefined;
    if (params.sendToTelegram && this.client) {
      if (!this.targetChatId) {
        throw new Error(
          "[TelegramOpsLogger] Cannot send ops-log to Telegram: targetChatId is not configured",
        );
      }
      const rawText =
        params.text ||
        `[${params.category}]${params.channel ? ` (${params.channel})` : ""} ${params.details}`;
      const filteredText = checkTelegramContentFilter(
        rawText,
        this.contentFilter,
        this.bannedWords,
        this.bannedWordAction,
      );
      const sent = await this.client.sendMessage({
        chatId: this.targetChatId,
        text: filteredText,
        disableWebPagePreview: true,
      });
      for (const m of sent) {
        if (m.message_id !== undefined) {
          this.onMessageSent?.(this.targetChatId, m.message_id);
        }
      }
      msgId = sent[0]?.message_id;
    }

    return this.appendEntry({
      category: params.category,
      channel: params.channel,
      details: params.details,
      msg_id: msgId,
      meta: params.meta,
    });
  }

  /**
   * Forwards messages from a source channel into `targetChatId`, optionally posts a summary text,
   * and records the operation in `<opsLogDir>/<folderName>/<YYYY>/<MM-DD>.jsonl`.
   */
  public async forwardAndLog(params: {
    fromChatId: string | number;
    messageIds: number[];
    text?: string;
    category: string;
    channel?: string;
    details: string;
    meta?: Record<string, unknown>;
  }): Promise<TelegramOpsLogEntry> {
    let forwardedMsgIds: number[] | undefined;
    let msgId: number | undefined;

    if (this.client && params.messageIds.length > 0) {
      if (!this.targetChatId) {
        throw new Error(
          "[TelegramOpsLogger] Cannot forwardAndLog to Telegram: targetChatId is not configured",
        );
      }
      forwardedMsgIds = await this.client.forwardMessages(
        params.fromChatId,
        this.targetChatId,
        params.messageIds,
      );
      for (const id of forwardedMsgIds) {
        this.onMessageSent?.(this.targetChatId, id);
      }
      if (params.text) {
        const filteredText = checkTelegramContentFilter(
          params.text,
          this.contentFilter,
          this.bannedWords,
          this.bannedWordAction,
        );
        const sent = await this.client.sendMessage({
          chatId: this.targetChatId,
          text: filteredText,
          disableWebPagePreview: true,
        });
        for (const m of sent) {
          if (m.message_id !== undefined) {
            this.onMessageSent?.(this.targetChatId, m.message_id);
          }
        }
        msgId = sent[0]?.message_id;
      }
    }

    return this.appendEntry({
      category: params.category,
      channel: params.channel,
      details: params.details,
      msg_id: msgId,
      forwarded_msg_ids: forwardedMsgIds,
      source_chat_id: params.fromChatId,
      source_msg_ids: params.messageIds,
      meta: params.meta,
    });
  }

  /**
   * Reads recent OpsLog entries from the last `days` calendar days (in Asia/Shanghai time).
   */
  public readRecentLogs(days = 7, nowMs = Date.now()): TelegramOpsLogEntry[] {
    const results: TelegramOpsLogEntry[] = [];
    for (let d = days - 1; d >= 0; d--) {
      const targetMs = nowMs - d * 86_400_000;
      const { year, monthDay } = toShanghaiTimeParts(targetMs);
      const filePath = path.join(this.opsLogDir, this.folderName, year, `${monthDay}.jsonl`);
      if (!fs.existsSync(filePath)) continue;
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          results.push(JSON.parse(trimmed) as TelegramOpsLogEntry);
        } catch {
          // Skip malformed line
        }
      }
    }
    return results;
  }
}
