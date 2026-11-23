/**
 * @prism-shadow/ema - TelegramWorld
 *
 * Telegram World implementation for EverMemoryArchive conforming to RFC-0001 & RFC-0002.
 * Supports:
 * - Real HTTP Telegram Bot API client (`TelegramClient`) & custom fetch/dispatcher injection
 * - Input Node: Bot API & MTProto webhook/polling, multi-part channel/group/DM/thread ingestion,
 *   `my_chat_member` pending-chat lifecycle, self-post loop prevention in channels,
 *   and untrusted input sanitization
 * - Action Node: MarkdownV2 formatted message delivery, single & multi-photo albums
 *   (`sendPhoto` / `sendMediaGroup` with >10 auto-chunking, allowlisted local file upload, `has_spoiler`),
 *   `sendDocument` / `sendVideo` / `sendAudio` / `sendAnimation` / `sendCard`,
 *   `forwardMessages`, `deleteMessage`, `verifyDelivered`, `sendChatAction`, inline keyboards,
 *   and emoji reactions
 * - Strict Security & Authorization (`TelegramAuthorizationManager`, low-privilege `executeSafeTool`,
 *   `TelegramRateLimiter`, and `checkTelegramContentFilter`)
 * - Real-time `BotIndex/Telegram` JSONL persistence, `ops-log`, and `t.me/s/<channel>`
 *   public channel web archiver
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  EmaWorld,
  type EmaCtx,
  type EmaActor,
  type EmaInput,
  type Disposable,
  type EmaWorldPart,
  type Id,
  type EmaRouteContext,
} from "../../interfaces.js";
import { assertAgentIdentity } from "../../minimal.js";
import {
  type TelegramPartType,
  type TelegramUpdate,
  type RawMtprotoUpdate,
  type TelegramAction,
  type TelegramActionPayload,
  type TelegramActionResult,
  type TelegramWorldOptions,
  type TelegramSendMediaAction,
  type TelegramSendMediaGroupAction,
  type TelegramSendCardAction,
  type TelegramInlineKeyboardButton,
  type TelegramInlineKeyboardMarkup,
  type TelegramParseMode,
  type TelegramSafeToolRequest,
  type TelegramContentFilterConfig,
  type TelegramMediaGroupItem,
  TelegramAuthorizationError,
  TelegramContentFilterError,
  TelegramRateLimitError,
} from "./types.js";
import {
  TelegramAuthorizationManager,
  TelegramRateLimiter,
  normalizeTelegramChatId,
} from "./authorization.js";
import {
  checkTelegramContentFilter,
  sanitizeUntrustedTelegramText,
} from "./filter.js";
import { TelegramClient } from "./client.js";
import { TelegramBotIndexStore } from "./bot-index.js";
import { TelegramOpsLogger } from "./ops-log.js";
import {
  crawlTelegramPublicChannel,
  normalizeAndValidateChannelUsername,
  type CrawlTelegramChannelOptions,
} from "./archive.js";

function parseTelegramTarget(targetId: string): { chatId: string | number; threadId?: number } {
  if (targetId.startsWith("thread:")) {
    const parts = targetId.split(":");
    return {
      chatId: parts[1],
      threadId: parts[2] ? parseInt(parts[2], 10) : undefined,
    };
  }
  if (targetId.startsWith("channel:")) {
    return { chatId: targetId.slice("channel:".length) };
  }
  if (targetId.startsWith("group:")) {
    return { chatId: targetId.slice("group:".length) };
  }
  if (targetId.startsWith("dm:")) {
    return { chatId: targetId.slice("dm:".length) };
  }
  return { chatId: targetId };
}

function parseNumericId(id: string | number | undefined): number | string | undefined {
  if (id === undefined) return undefined;
  if (typeof id === "number") return id;
  const match = /(?:^|:)(-?\d+)$/.exec(String(id).trim());
  return match ? parseInt(match[1], 10) : id;
}

function safeDecodeUriComponent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new Error(`Invalid URI encoding: '${raw}'`);
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseRouteJsonBody<T = Record<string, any>>(body: unknown): T {
  if (typeof body === "string") {
    return JSON.parse(body) as T;
  }
  if (body && typeof body === "object") {
    return body as T;
  }
  throw new Error("Invalid JSON request body");
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export class TelegramWorld extends EmaWorld {
  public readonly client?: TelegramClient;
  public readonly authManager: TelegramAuthorizationManager;
  public readonly rateLimiter: TelegramRateLimiter;
  public readonly botIndexStore?: TelegramBotIndexStore;
  public readonly opsLogger?: TelegramOpsLogger;

  private botToken?: string;
  private mode: "polling" | "webhook" | "mtproto" | "passive";
  private pollInterval: number;
  private dbPath?: string;
  private ownerIds: Set<string> = new Set();
  private botId?: string;
  private botUsername?: string;
  private contentFilterConfig?: TelegramContentFilterConfig;
  private bannedWords: string[];
  private bannedWordAction: "reject" | "mask";
  private skipInitialUpdates: boolean;
  private webhookSecret?: string;
  private defaultChatId?: string;
  private initialPollDone = false;
  private updateFetcher: (offset: number) => Promise<TelegramUpdate[]> | TelegramUpdate[];
  private actionDispatcher: (
    payload: TelegramActionPayload,
  ) => Promise<TelegramActionResult | void> | TelegramActionResult | void;
  private fetchImpl?: typeof fetch;
  private env: Record<string, string | undefined>;
  private passive: boolean;

  private parts: Map<string, EmaWorldPart> = new Map();
  private messageHistory: Map<string, EmaInput> = new Map();
  private actionHistory: TelegramActionResult[] = [];
  private seenIds: Set<string> = new Set();
  private sentMessageKeys: Set<string> = new Set();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private inFlightPoll: Promise<void> | null = null;
  private active = false;
  private lastUpdateOffset = 0;
  private startTime = 0;
  private ctx: EmaCtx | null = null;
  private inFlightDispatch: Promise<void> | null = null;

  private db: DatabaseSync | null = null;
  private insertSeenStmt: StatementSync | null = null;
  private selectAllSeenStmt: StatementSync | null = null;
  private upsertWorldStateStmt: StatementSync | null = null;
  private selectWorldStateStmt: StatementSync | null = null;

  constructor(options: TelegramWorldOptions = {}) {
    super();
    this.botToken = options.botToken;
    this.pollInterval = options.pollInterval ?? 2000;
    this.env = options.env ?? process.env;
    this.passive = options.passive ?? false;
    this.fetchImpl = options.fetchImpl;
    this.skipInitialUpdates = options.skipInitialUpdates ?? false;
    this.contentFilterConfig = options.contentFilter;
    this.bannedWords = options.bannedWords ?? [];
    this.bannedWordAction = options.bannedWordAction ?? "reject";
    this.webhookSecret = options.webhookSecret;
    this.defaultChatId =
      options.defaultChatId !== undefined
        ? normalizeTelegramChatId(options.defaultChatId)
        : options.authorization?.writeChatIds?.[0] !== undefined
          ? normalizeTelegramChatId(options.authorization.writeChatIds[0])
          : options.authorization?.allowedChatIds?.[0] !== undefined
            ? normalizeTelegramChatId(options.authorization.allowedChatIds[0])
            : undefined;

    this.mode =
      options.mode ??
      (options.passive
        ? "passive"
        : options.updateFetcher || options.botToken
          ? "polling"
          : "passive");

    if (options.botId !== undefined) {
      this.botId = String(options.botId);
    }
    if (options.botUsername) {
      this.botUsername = options.botUsername.replace(/^@/, "");
    }

    if (options.ownerIds) {
      for (const id of options.ownerIds) {
        this.ownerIds.add(String(id).replace(/^user:/, "").replace(/^@/, "").toLowerCase());
      }
    }

    // Initialize Authorization Manager & Rate Limiter
    this.authManager = new TelegramAuthorizationManager(
      {
        ...options.authorization,
        adminUsers: [
          ...(options.authorization?.adminUsers ?? []),
          ...(options.ownerIds ?? []),
        ],
      },
      this.env,
    );
    this.rateLimiter = new TelegramRateLimiter(options.rateLimit);

    // Initialize real HTTP TelegramClient when botToken is present
    if (this.botToken) {
      this.client = new TelegramClient({
        botToken: this.botToken,
        apiBaseUrl: options.apiBaseUrl,
        fetchImpl: this.fetchImpl,
        allowedMediaDirs: options.allowedMediaDirs,
      });
      if (!this.botId) {
        const prefixId = this.client.token.split(":")[0];
        if (/^\d+$/.test(prefixId)) {
          this.botId = prefixId;
        }
      }
    }

    if (options.botIndexDir) {
      this.botIndexStore = new TelegramBotIndexStore({
        botIndexDir: options.botIndexDir,
        aliases: options.chatAliases,
      });
    }

    if (options.opsLogDir) {
      this.opsLogger = new TelegramOpsLogger({
        opsLogDir: options.opsLogDir,
        targetChatId: this.defaultChatId,
        folderName: options.opsLogFolderName,
        client: this.client,
        contentFilter: this.contentFilterConfig,
        bannedWords: this.bannedWords,
        bannedWordAction: this.bannedWordAction,
        onMessageSent: (cid, mid) => this.markSentMessageId(cid, mid),
      });
    }

    // Resolve SQLite database path
    if (options.dbPath) {
      this.dbPath = options.dbPath;
    } else if (options.stateFile) {
      if (options.stateFile.endsWith(".sqlite") || options.stateFile.endsWith(".db")) {
        this.dbPath = options.stateFile;
      } else if (options.stateFile.endsWith(".json")) {
        this.dbPath = `${options.stateFile.replace(/\.json$/, "")}.sqlite`;
      } else {
        this.dbPath = options.stateFile;
      }
    } else if (process.env.NODE_ENV === "test" || process.env.VITEST) {
      this.dbPath = ":memory:";
    } else {
      this.dbPath = path.join(os.tmpdir(), "ema-telegram-state.sqlite");
    }

    // Initialize pre-configured parts
    if (options.parts) {
      for (const p of options.parts) {
        this.parts.set(p.id, p);
      }
    }

    this.updateFetcher =
      options.updateFetcher ??
      (async (offset: number): Promise<TelegramUpdate[]> => {
        if (!this.client) return [];
        return await this.client.getUpdates(offset, 2);
      });

    this.actionDispatcher =
      options.actionDispatcher ??
      (async (payload: TelegramActionPayload): Promise<TelegramActionResult> => {
        const actionId = `tg-act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (!this.client) {
          return {
            id: actionId,
            targetPartId: payload.targetPartId,
            chatId: payload.chatId,
            action: payload.action,
            actor: payload.actor,
            timestamp: payload.timestamp,
            status: "dispatched",
          };
        }

        const rawResult = await this.dispatchViaClient(payload.chatId, payload.action);
        return {
          id: actionId,
          targetPartId: payload.targetPartId,
          chatId: payload.chatId,
          action: payload.action,
          actor: payload.actor,
          timestamp: payload.timestamp,
          status: "dispatched",
          rawResult,
        };
      });

    this.initSqlite();
    this.loadState();
  }

  private async dispatchViaClient(
    chatId: string | number,
    action: TelegramAction,
  ): Promise<unknown> {
    if (!this.client) return undefined;
    const actType = action.action || "sendMessage";

    if (actType === "sendMessage" || actType === "reply") {
      const msgAct = action as {
        text: string;
        parse_mode?: TelegramParseMode;
        replyTo?: number | string;
        reply_to_message_id?: number | string;
        messageThreadId?: number;
        message_thread_id?: number;
        reply_markup?: TelegramInlineKeyboardMarkup;
        disable_web_page_preview?: boolean;
      };
      const replyId = parseNumericId(msgAct.replyTo ?? msgAct.reply_to_message_id);
      const sent = await this.client.sendMessage({
        chatId,
        text: msgAct.text,
        parseMode: msgAct.parse_mode,
        replyToMessageId: typeof replyId === "number" ? replyId : undefined,
        messageThreadId: msgAct.messageThreadId ?? msgAct.message_thread_id,
        replyMarkup: msgAct.reply_markup,
        disableWebPagePreview: msgAct.disable_web_page_preview,
      });
      for (const m of sent) {
        this.markSentMessageId(m.chat.id, m.message_id);
        this.botIndexStore?.recordTelegramMessage(m, "out", msgAct.text);
      }
      return sent;
    }

    if (actType === "sendCard") {
      const cardAct = action as TelegramSendCardAction;
      const text = [cardAct.title, cardAct.description].filter(Boolean).join("\n\n").trim();
      const replyMarkup: TelegramInlineKeyboardMarkup | undefined = cardAct.buttons
        ? { inline_keyboard: cardAct.buttons }
        : undefined;
      const replyId = parseNumericId(cardAct.replyTo ?? cardAct.reply_to_message_id);
      const threadId = cardAct.messageThreadId ?? cardAct.message_thread_id;

      if (cardAct.mediaUrl) {
        if (cardAct.mediaType === "video") {
          const sent = await this.client.sendVideo({
            chatId,
            video: cardAct.mediaUrl,
            caption: text || undefined,
            parseMode: cardAct.parse_mode,
            replyToMessageId: typeof replyId === "number" ? replyId : undefined,
            messageThreadId: threadId,
            replyMarkup,
          });
          this.markSentMessageId(sent.chat.id, sent.message_id);
          this.botIndexStore?.recordTelegramMessage(sent, "out");
          return sent;
        }
        const sent = await this.client.sendPhoto({
          chatId,
          photo: cardAct.mediaUrl,
          caption: text || undefined,
          parseMode: cardAct.parse_mode,
          replyToMessageId: typeof replyId === "number" ? replyId : undefined,
          messageThreadId: threadId,
          replyMarkup,
        });
        this.markSentMessageId(sent.chat.id, sent.message_id);
        this.botIndexStore?.recordTelegramMessage(sent, "out");
        return sent;
      }

      if (!text) {
        throw new Error("sendCard requires title, description, or mediaUrl");
      }
      const sent = await this.client.sendMessage({
        chatId,
        text,
        parseMode: cardAct.parse_mode,
        replyToMessageId: typeof replyId === "number" ? replyId : undefined,
        messageThreadId: threadId,
        replyMarkup,
      });
      for (const m of sent) {
        this.markSentMessageId(m.chat.id, m.message_id);
        this.botIndexStore?.recordTelegramMessage(m, "out", text);
      }
      return sent;
    }

    if (
      actType === "sendPhoto" ||
      actType === "sendDocument" ||
      actType === "sendVideo" ||
      actType === "sendAudio" ||
      actType === "sendAnimation" ||
      actType === "sendMedia"
    ) {
      const mediaAct = action as TelegramSendMediaAction;
      const mediaKind =
        mediaAct.type ||
        (actType === "sendDocument"
          ? "document"
          : actType === "sendVideo"
            ? "video"
            : actType === "sendAudio"
              ? "audio"
              : actType === "sendAnimation"
                ? "animation"
                : "photo");
      const mediaTarget =
        mediaAct.media ||
        mediaAct.photo ||
        mediaAct.document ||
        mediaAct.video ||
        mediaAct.audio;
      if (!mediaTarget) {
        throw new Error(`${actType} requires media path, URL, or file_id`);
      }
      const replyId = parseNumericId(mediaAct.replyTo ?? mediaAct.reply_to_message_id);
      const threadId = mediaAct.messageThreadId ?? mediaAct.message_thread_id;

      let sent;
      if (mediaKind === "document") {
        sent = await this.client.sendDocument({
          chatId,
          document: mediaTarget,
          caption: mediaAct.caption,
          parseMode: mediaAct.parse_mode,
          filename: mediaAct.filename,
          replyToMessageId: typeof replyId === "number" ? replyId : undefined,
          messageThreadId: threadId,
          replyMarkup: mediaAct.reply_markup,
        });
      } else if (mediaKind === "video") {
        sent = await this.client.sendVideo({
          chatId,
          video: mediaTarget,
          caption: mediaAct.caption,
          parseMode: mediaAct.parse_mode,
          hasSpoiler: mediaAct.has_spoiler ?? mediaAct.hasSpoiler,
          filename: mediaAct.filename,
          replyToMessageId: typeof replyId === "number" ? replyId : undefined,
          messageThreadId: threadId,
          replyMarkup: mediaAct.reply_markup,
        });
      } else if (mediaKind === "audio") {
        sent = await this.client.sendAudio({
          chatId,
          audio: mediaTarget,
          caption: mediaAct.caption,
          parseMode: mediaAct.parse_mode,
          filename: mediaAct.filename,
          replyToMessageId: typeof replyId === "number" ? replyId : undefined,
          messageThreadId: threadId,
          replyMarkup: mediaAct.reply_markup,
        });
      } else if (mediaKind === "animation") {
        sent = await this.client.sendAnimation({
          chatId,
          animation: mediaTarget,
          caption: mediaAct.caption,
          parseMode: mediaAct.parse_mode,
          hasSpoiler: mediaAct.has_spoiler ?? mediaAct.hasSpoiler,
          filename: mediaAct.filename,
          replyToMessageId: typeof replyId === "number" ? replyId : undefined,
          messageThreadId: threadId,
          replyMarkup: mediaAct.reply_markup,
        });
      } else {
        sent = await this.client.sendPhoto({
          chatId,
          photo: mediaTarget,
          caption: mediaAct.caption,
          parseMode: mediaAct.parse_mode,
          hasSpoiler: mediaAct.has_spoiler ?? mediaAct.hasSpoiler,
          filename: mediaAct.filename,
          replyToMessageId: typeof replyId === "number" ? replyId : undefined,
          messageThreadId: threadId,
          replyMarkup: mediaAct.reply_markup,
        });
      }
      this.markSentMessageId(sent.chat.id, sent.message_id);
      this.botIndexStore?.recordTelegramMessage(sent, "out");
      return sent;
    }

    if (actType === "sendMediaGroup") {
      const groupAct = action as TelegramSendMediaGroupAction;
      const replyId = parseNumericId(groupAct.replyTo ?? groupAct.reply_to_message_id);
      const sent = await this.client.sendMediaGroup({
        chatId,
        items: groupAct.items,
        caption: groupAct.caption,
        parseMode: groupAct.parse_mode,
        hasSpoiler: groupAct.has_spoiler ?? groupAct.hasSpoiler,
        replyToMessageId: typeof replyId === "number" ? replyId : undefined,
        messageThreadId: groupAct.messageThreadId ?? groupAct.message_thread_id,
      });
      for (const m of sent) {
        this.markSentMessageId(m.chat.id, m.message_id);
        this.botIndexStore?.recordTelegramMessage(m, "out");
      }
      return sent;
    }

    if (actType === "forwardMessages" || actType === "forwardMessage") {
      const fwdAct = action as {
        fromChatId: string | number;
        messageIds: Array<number | string>;
      };
      const ids = await this.client.forwardMessages(fwdAct.fromChatId, chatId, fwdAct.messageIds);
      for (const id of ids) {
        this.markSentMessageId(chatId, id);
      }
      return { message_ids: ids };
    }

    if (actType === "deleteMessage") {
      const delAct = action as { messageId: number | string };
      return this.client.deleteMessage(chatId, delAct.messageId);
    }

    if (actType === "verifyDelivered") {
      const verAct = action as { messageId: number | string; probeChatId?: string | number };
      return this.client.verifyDelivered(chatId, verAct.messageId, verAct.probeChatId, (cid, mid) =>
        this.markSentMessageId(cid, mid),
      );
    }

    if (actType === "sendChatAction") {
      const chatAct = action as { chatAction: any };
      return this.client.sendChatAction(chatId, chatAct.chatAction || "typing");
    }

    if (actType === "react" || actType === "reaction" || actType === "setMessageReaction") {
      const reactAct = action as {
        messageId?: number | string;
        emoji: string | string[];
        isBig?: boolean;
      };
      const msgId = parseNumericId(reactAct.messageId);
      if (typeof msgId !== "number") {
        throw new Error("setMessageReaction requires numeric messageId");
      }
      return this.client.setMessageReaction({
        chatId,
        messageId: msgId,
        emoji: reactAct.emoji,
        isBig: reactAct.isBig,
      });
    }

    throw new Error(`[TelegramWorld] Unsupported Telegram action: '${actType}'`);
  }

  /**
   * Records an outbound message ID sent by this bot so channel_post echoes in `getUpdates`
   * are never mistaken for inbound user messages (preventing infinite self-reply loops).
   */
  public markSentMessageId(chatId: string | number, messageId: number | string): void {
    const normChatId = normalizeTelegramChatId(chatId);
    const eventId = `tg-msg-${normChatId}-${messageId}`;
    this.sentMessageKeys.add(eventId);
    this.seenIds.add(eventId);
    this.saveState(eventId, `sent:${normChatId}`);
  }

  private initSqlite(): void {
    if (!this.dbPath) return;
    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS seen_messages (
        id TEXT PRIMARY KEY,
        channel TEXT,
        timestamp INTEGER
      );
      CREATE TABLE IF NOT EXISTS world_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );
    `);
    this.insertSeenStmt = this.db.prepare(
      "INSERT INTO seen_messages (id, channel, timestamp) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET channel = CASE WHEN excluded.channel LIKE 'sent:%' THEN excluded.channel ELSE seen_messages.channel END",
    );
    this.selectAllSeenStmt = this.db.prepare("SELECT id, channel FROM seen_messages");
    this.upsertWorldStateStmt = this.db.prepare(
      "INSERT INTO world_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    );
    this.selectWorldStateStmt = this.db.prepare("SELECT value FROM world_state WHERE key = ?");
  }

  private loadState(): void {
    if (!this.db || !this.selectAllSeenStmt) return;
    const rows = this.selectAllSeenStmt.all() as Array<{ id: string; channel?: string | null }>;
    for (const row of rows) {
      if (row && typeof row.id === "string") {
        this.seenIds.add(row.id);
        if (typeof row.channel === "string" && row.channel.startsWith("sent:")) {
          this.sentMessageKeys.add(row.id);
        }
      }
    }
    if (this.selectWorldStateStmt) {
      const row = this.selectWorldStateStmt.get("last_update_offset") as
        | { value?: string }
        | undefined;
      if (row?.value !== undefined) {
        const parsed = parseInt(row.value, 10);
        if (Number.isInteger(parsed) && parsed >= 0) {
          this.lastUpdateOffset = parsed;
        }
      }
    }
  }

  private saveState(id: string, partId: string): void {
    if (!this.db || !this.insertSeenStmt) return;
    this.insertSeenStmt.run(id, partId, Date.now());
  }

  private saveLastUpdateOffset(offset: number): void {
    if (!this.db || !this.upsertWorldStateStmt) return;
    this.upsertWorldStateStmt.run("last_update_offset", String(offset), Date.now());
  }

  private isOwner(senderId: string | number, username?: string): boolean {
    if (this.authManager.isAdmin(senderId, username)) return true;
    if (this.ownerIds.size === 0) return false;
    const sId = String(senderId).replace(/^user:/, "").toLowerCase();
    if (this.ownerIds.has(sId)) return true;
    if (username && this.ownerIds.has(username.toLowerCase())) return true;
    return false;
  }

  public registerPart(part: EmaWorldPart): void {
    this.parts.set(part.id, part);
  }

  public listParts(): EmaWorldPart[] {
    return Array.from(this.parts.values());
  }

  public getPart(id: string): EmaWorldPart | undefined {
    return this.parts.get(id);
  }

  public getLastUpdateOffset(): number {
    return this.lastUpdateOffset;
  }

  public getStatus(): Record<string, unknown> {
    return {
      world: "telegram",
      active: this.active,
      mode: this.mode,
      botUsername: this.botUsername,
      botId: this.botId,
      lastUpdateOffset: this.lastUpdateOffset,
      partsCount: this.parts.size,
      messagesCount: this.messageHistory.size,
      actionsCount: this.actionHistory.length,
      uptimeMs: this.active ? Date.now() - this.startTime : 0,
      authorization: this.authManager.getStatus(),
    };
  }

  /**
   * Executes a low-privilege companion tool request (`telegram_api`) with strict
   * authorization, rate limiting, and outbound privacy filtering.
   */
  public async executeSafeTool(req: TelegramSafeToolRequest): Promise<unknown> {
    if (!this.client) {
      throw new Error("[TelegramWorld] Cannot execute Telegram tool: botToken / client not configured");
    }
    const result = (await this.client.executeSafeToolCall(
      req,
      this.authManager,
      this.rateLimiter,
      this.contentFilterConfig,
      this.bannedWords,
      this.bannedWordAction,
    )) as Record<string, any> | undefined;

    if (
      req.action === "send_message" &&
      req.chat_id !== undefined &&
      result &&
      Array.isArray(result.message_ids)
    ) {
      const chatId = normalizeTelegramChatId(req.chat_id);
      for (const msgId of result.message_ids as number[]) {
        this.markSentMessageId(chatId, msgId);
        this.botIndexStore?.recordTelegramMessage(
          {
            message_id: msgId,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: Number(chatId) || (chatId as any),
              type: String(chatId).startsWith("-100") ? "supergroup" : "private",
            },
            text: String(req.text ?? ""),
          },
          "out",
          String(req.text ?? ""),
        );
      }
      this.recordAction({
        id: `tg-act-${Date.now()}`,
        targetPartId: `chat:${chatId}`,
        chatId,
        action: { action: "sendMessage", text: String(req.text ?? "") },
        actor: { id: "actor:telegram-tool", name: "telegram_tool", session: "world-api", agentId: "world-api" },
        timestamp: Date.now(),
        status: "dispatched",
        rawResult: result,
      });
    } else if (
      req.action === "forward_messages" &&
      req.to_chat_id !== undefined &&
      result &&
      Array.isArray(result.message_ids)
    ) {
      const toChatId = normalizeTelegramChatId(req.to_chat_id);
      for (const msgId of result.message_ids as number[]) {
        this.markSentMessageId(toChatId, msgId);
      }
    }

    return result;
  }

  /**
   * Publishes a single photo or multi-photo album (`sendPhoto` / `sendMediaGroup`)
   * with optional `verifyDelivered` probe and `ops-log` recording.
   */
  public async publishMedia(params: {
    chatId: string | number;
    items: TelegramMediaGroupItem[];
    caption?: string;
    parseMode?: TelegramParseMode;
    hasSpoiler?: boolean;
    verifyDelivery?: boolean;
    probeChatId?: string | number;
    logToOps?: {
      category: string;
      channel?: string;
      details: string;
      meta?: Record<string, unknown>;
    };
  }): Promise<{
    messageIds: number[];
    verified?: boolean;
    opsLogEntry?: unknown;
  }> {
    if (!this.client) {
      throw new Error("[TelegramWorld] publishMedia requires a configured TelegramClient (botToken)");
    }
    const speakCheck = this.authManager.canSpeak(params.chatId);
    if (!speakCheck.authorized) {
      throw new TelegramAuthorizationError(speakCheck.reason || "Unauthorized target chat");
    }
    if (params.verifyDelivery && params.probeChatId !== undefined) {
      const probeSpeakCheck = this.authManager.canSpeak(params.probeChatId);
      if (!probeSpeakCheck.authorized) {
        throw new TelegramAuthorizationError(
          probeSpeakCheck.reason || "Unauthorized probe target chat",
        );
      }
    }

    const filteredCaption = params.caption
      ? checkTelegramContentFilter(
          params.caption,
          this.contentFilterConfig,
          this.bannedWords,
          this.bannedWordAction,
        )
      : undefined;

    const filteredItems: TelegramMediaGroupItem[] = params.items.map((item) => ({
      ...item,
      ...(item.caption
        ? {
            caption: checkTelegramContentFilter(
              item.caption,
              this.contentFilterConfig,
              this.bannedWords,
              this.bannedWordAction,
            ),
          }
        : {}),
    }));

    if (params.logToOps && this.opsLogger?.targetChatId) {
      const opsSpeakCheck = this.authManager.canSpeak(this.opsLogger.targetChatId);
      if (!opsSpeakCheck.authorized) {
        throw new TelegramAuthorizationError(
          opsSpeakCheck.reason || "Unauthorized ops-log target chat",
        );
      }
    }

    this.rateLimiter.checkAndRecord(params.chatId);

    const sent = await this.client.sendMediaGroup({
      chatId: params.chatId,
      items: filteredItems,
      caption: filteredCaption,
      parseMode: params.parseMode,
      hasSpoiler: params.hasSpoiler,
    });

    const messageIds = sent.map((m) => m.message_id);
    for (const m of sent) {
      this.markSentMessageId(m.chat.id, m.message_id);
      this.botIndexStore?.recordTelegramMessage(m, "out");
    }

    let verified: boolean | undefined;
    if (params.verifyDelivery && messageIds.length > 0) {
      const probe = await this.client.verifyDelivered(
        params.chatId,
        messageIds[0],
        params.probeChatId,
        (cid, mid) => this.markSentMessageId(cid, mid),
      );
      verified = probe.verified;
    }

    let opsLogEntry: unknown;
    if (params.logToOps && this.opsLogger) {
      opsLogEntry = await this.opsLogger.forwardAndLog({
        fromChatId: params.chatId,
        messageIds,
        category: params.logToOps.category,
        channel: params.logToOps.channel,
        details: params.logToOps.details,
        meta: params.logToOps.meta,
      });
    }

    return {
      messageIds,
      ...(verified !== undefined ? { verified } : {}),
      ...(opsLogEntry ? { opsLogEntry } : {}),
    };
  }

  /**
   * Crawls a public Telegram channel's web preview (`https://t.me/s/<channel>`)
   * and merges into `this.botIndexStore` if configured.
   */
  public async archivePublicChannel(options: CrawlTelegramChannelOptions) {
    return crawlTelegramPublicChannel({
      ...options,
      botIndexStore: options.botIndexStore ?? this.botIndexStore,
      fetchImpl: options.fetchImpl ?? this.fetchImpl,
    });
  }

  /**
   * Normalizes and ingests a raw Telegram Bot API update event.
   * Deduplicates seen IDs, enforces authorization & self-message loop guards,
   * sanitizes untrusted text, persists to BotIndex, and enqueues to EmaInputBatcher.
   */
  public ingestUpdate(update: TelegramUpdate): EmaInput | null {
    if (!update || typeof update !== "object") return null;

    // 1. Check authorization & handle my_chat_member lifecycle updates
    const authResult = this.authManager.canIngestUpdate(update);
    if (!authResult.authorized) {
      return null;
    }

    const isCallbackQuery = Boolean(update.callback_query);
    const editedMsg = update.edited_message || update.edited_channel_post;
    const msg =
      update.message ||
      update.channel_post ||
      editedMsg ||
      update.callback_query?.message;

    // 2. Check sender if botId or botUsername is configured (prevent self-reply loops).
    // For callback_query, the actor is `callback_query.from` (NOT `callback_query.message.from`,
    // which is usually the bot itself!).
    const senderUser = isCallbackQuery ? update.callback_query?.from : msg?.from;
    if (senderUser) {
      if (this.botId && String(senderUser.id) === this.botId) {
        return null;
      }
      if (
        this.botUsername &&
        senderUser.username &&
        senderUser.username.toLowerCase() === this.botUsername.toLowerCase()
      ) {
        return null;
      }
    }

    // 3. Determine event ID for deduplication (and check if it was sent by our bot in a channel!)
    let eventId: string;
    if (isCallbackQuery && update.callback_query) {
      eventId = `tg-cbq-${update.callback_query.id}`;
    } else if (editedMsg) {
      const baseMsgKey = `tg-msg-${normalizeTelegramChatId(editedMsg.chat.id)}-${editedMsg.message_id}`;
      if (this.sentMessageKeys.has(baseMsgKey)) {
        return null;
      }
      eventId = `tg-edit-${editedMsg.chat.id}-${editedMsg.message_id}-${editedMsg.edit_date ?? update.update_id}`;
    } else if (msg) {
      const normKey = `tg-msg-${normalizeTelegramChatId(msg.chat.id)}-${msg.message_id}`;
      if (this.sentMessageKeys.has(normKey)) {
        return null;
      }
      eventId = `tg-msg-${msg.chat.id}-${msg.message_id}`;
    } else {
      eventId = `tg-update-${update.update_id}`;
    }

    if (this.seenIds.has(eventId) || this.sentMessageKeys.has(eventId)) {
      return null;
    }

    // Resolve part and part type
    let partId = "tg:default";
    let partType: TelegramPartType = "group";
    let partName = "Telegram Chat";
    let messageThreadId: number | undefined;

    if (msg?.chat) {
      const chat = msg.chat;
      if (chat.type === "channel") {
        partType = "channel";
        partId = `channel:${chat.id}`;
        partName = chat.title || chat.username || String(chat.id);
      } else if (chat.type === "private") {
        partType = "dm";
        partId = `dm:${chat.id}`;
        partName = chat.username || chat.first_name || String(chat.id);
      } else {
        // Group or supergroup
        if (msg.message_thread_id) {
          partType = "thread";
          partId = `thread:${chat.id}:${msg.message_thread_id}`;
          messageThreadId = msg.message_thread_id;
          partName = `${chat.title || chat.id} (Thread ${msg.message_thread_id})`;
        } else {
          partType = "group";
          partId = `group:${chat.id}`;
          partName = chat.title || chat.username || String(chat.id);
        }
      }

      this.registerPart({
        id: partId,
        type: partType,
        name: partName,
        topic: chat.is_forum ? `Forum Topic ${messageThreadId || "General"}` : undefined,
      });
    }

    // Extract and sanitize untrusted text content
    let text = isCallbackQuery && update.callback_query?.data
      ? `[Button: ${sanitizeUntrustedTelegramText(update.callback_query.data)}]`.trim()
      : sanitizeUntrustedTelegramText(msg?.text || msg?.caption || "").trim();

    if (!text) {
      if (msg?.photo && msg.photo.length > 0) {
        text = "[Photo]";
      } else if (msg?.document) {
        text = `[Document: ${sanitizeUntrustedTelegramText(msg.document.file_name || msg.document.file_id)}]`;
      } else if (msg?.video) {
        text = "[Video]";
      } else if (msg?.audio) {
        text = "[Audio]";
      } else if (msg?.voice) {
        text = "[Voice Note]";
      } else if (msg?.animation) {
        text = "[Animation]";
      } else if (msg?.sticker) {
        text = msg.sticker.emoji ? `[Sticker: ${msg.sticker.emoji}]` : "[Sticker]";
      } else if (update.callback_query?.data) {
        text = `[Button: ${sanitizeUntrustedTelegramText(update.callback_query.data)}]`;
      }
    }

    text = text.trim();
    if (!text) {
      return null;
    }

    const senderId = senderUser
      ? String(senderUser.id)
      : msg?.sender_chat
        ? String(msg.sender_chat.id)
        : "unknown";

    const rawSenderName = senderUser
      ? `${senderUser.first_name || ""} ${senderUser.last_name || ""}`.trim() ||
        senderUser.username ||
        String(senderUser.id)
      : msg?.sender_chat?.title || senderId;
    const senderName = sanitizeUntrustedTelegramText(rawSenderName);

    const replyTo = msg?.reply_to_message
      ? `tg-msg-${msg.chat.id}-${msg.reply_to_message.message_id}`
      : undefined;

    const input: EmaInput = {
      id: eventId,
      world: "telegram",
      partId,
      sender: {
        id: `user:${senderId}`,
        name: senderName,
        isOwner: this.isOwner(senderId, senderUser?.username),
      },
      content: text,
      timestamp: msg?.date ? msg.date * 1000 : Date.now(),
      replyTo,
      metadata: {
        updateId: update.update_id,
        messageId: msg?.message_id,
        chatId: msg?.chat?.id,
        chatTitle: sanitizeUntrustedTelegramText(
          msg?.chat?.title || msg?.chat?.username || msg?.chat?.first_name || "",
        ),
        chatType: msg?.chat?.type,
        messageThreadId,
        edited: Boolean(editedMsg),
        replyToMessageId: msg?.reply_to_message?.message_id,
        replyToFromId: msg?.reply_to_message?.from?.id
          ? String(msg.reply_to_message.from.id)
          : undefined,
        replyToFromUsername: msg?.reply_to_message?.from?.username,
        entities: msg?.entities || msg?.caption_entities,
        photo: msg?.photo,
        document: msg?.document,
        callbackQuery: update.callback_query
          ? {
              id: update.callback_query.id,
              data: update.callback_query.data,
            }
          : undefined,
      },
    };

    this.seenIds.add(eventId);
    this.saveState(eventId, partId);

    if (msg && !isCallbackQuery && this.botIndexStore) {
      this.botIndexStore.recordTelegramMessage(msg, "in", text);
    }

    if (this.messageHistory.size >= 500) {
      const oldest = this.messageHistory.keys().next().value;
      if (oldest) this.messageHistory.delete(oldest);
    }
    this.messageHistory.set(eventId, input);

    if (this.ctx) {
      this.ctx.inputBatcher.push(input);
    }

    return input;
  }

  /**
   * Ingests an MTProto update payload and normalizes it into EmaInput.
   */
  public ingestMtprotoUpdate(update: RawMtprotoUpdate): EmaInput | null {
    if (!update || typeof update !== "object") return null;

    const msg = update.message;
    if (!msg || !msg.id) return null;

    const peer = msg.peerId;
    let partId = "tg:default";
    let partType: TelegramPartType = "group";
    let partName = "MTProto Chat";

    let peerChatId = update.chatId || update.channelId || update.userId || 0;
    if (peer) {
      if (peer._ === "peerUser" || peer.userId) {
        partType = "dm";
        peerChatId = peer.userId || peer.id || 0;
        partId = `dm:${peerChatId}`;
        partName = `User ${peerChatId}`;
      } else if (peer._ === "peerChannel" || peer.channelId) {
        partType = "channel";
        peerChatId = peer.channelId || peer.id || 0;
        partId = `channel:${peerChatId}`;
        partName = `Channel ${peerChatId}`;
      } else {
        partType = "group";
        peerChatId = peer.chatId || peer.id || 0;
        partId = `group:${peerChatId}`;
        partName = `Group ${peerChatId}`;
      }
    }

    const rawSenderUserId =
      msg.fromId?.userId ?? (partType === "dm" ? (update.userId ?? peerChatId) : update.userId);

    // 1. Authorization guardrail (same policy as Bot API ingestUpdate)
    const authResult = this.authManager.canIngestChatMessage({
      chatId: peerChatId,
      chatType: partType === "dm" ? "private" : partType === "channel" ? "channel" : "supergroup",
      senderId: rawSenderUserId,
      date: msg.date,
    });
    if (!authResult.authorized) {
      return null;
    }

    // 2. Self-reply loop prevention (botId & sentMessageKeys)
    if (this.botId && rawSenderUserId !== undefined && String(rawSenderUserId) === this.botId) {
      return null;
    }
    const normMsgKey = `tg-msg-${normalizeTelegramChatId(peerChatId)}-${msg.id}`;
    if (this.sentMessageKeys.has(normMsgKey) || this.seenIds.has(normMsgKey)) {
      return null;
    }

    const eventId = `tg-mtproto-${peerChatId}-${msg.id}`;
    if (this.seenIds.has(eventId)) {
      return null;
    }

    const text = sanitizeUntrustedTelegramText(msg.message || "").trim();
    if (!text) return null;

    this.registerPart({
      id: partId,
      type: partType,
      name: partName,
    });

    const senderId = rawSenderUserId !== undefined ? String(rawSenderUserId) : "unknown";

    const replyTo = msg.replyTo?.replyToMsgId
      ? `tg-mtproto-${peerChatId}-${msg.replyTo.replyToMsgId}`
      : undefined;

    const input: EmaInput = {
      id: eventId,
      world: "telegram",
      partId,
      sender: {
        id: `user:${senderId}`,
        name: rawSenderUserId !== undefined ? `User ${senderId}` : "Unknown",
        isOwner: rawSenderUserId !== undefined ? this.isOwner(senderId) : false,
      },
      content: text,
      timestamp: msg.date ? msg.date * 1000 : Date.now(),
      replyTo,
      metadata: {
        mtproto: true,
        peerId: peer,
        replyToTopId: msg.replyTo?.replyToTopId,
      },
    };

    this.seenIds.add(eventId);
    this.saveState(eventId, partId);

    if (this.messageHistory.size >= 500) {
      const oldest = this.messageHistory.keys().next().value;
      if (oldest) this.messageHistory.delete(oldest);
    }
    this.messageHistory.set(eventId, input);

    if (this.ctx) {
      this.ctx.inputBatcher.push(input);
    }

    return input;
  }

  /**
   * Starts the TelegramWorld lifecycle: mounts resource routes and connects input ingestion.
   */
  start(ctx: EmaCtx): Disposable {
    if (!this.db && this.dbPath) {
      this.initSqlite();
      this.loadState();
    }
    this.active = true;
    this.startTime = Date.now();
    this.ctx = ctx;

    // 1. Register with EmaWorldRegistry
    const registryHandle = ctx.registry.register("telegram", this);

    // 2. Mount resource routes on SimpleEmaRouter
    const routeHandler = async (routeCtx: EmaRouteContext) => {
      try {
        const subpath = routeCtx.path.replace(/^\/world\/telegram\/?/, "");
        const method = (routeCtx.method || "GET").toUpperCase();

        const requireGet = (): Response | null => {
          if (method !== "GET") {
            return textResponse(405, `Method ${method} not allowed for GET /world/telegram/${subpath}`);
          }
          return null;
        };

        const requirePost = (): Response | null => {
          if (method !== "POST") {
            return textResponse(405, `Method ${method} not allowed for POST /world/telegram/${subpath}`);
          }
          return null;
        };

        if (subpath === "" || subpath === "status") {
          return requireGet() ?? this.getStatus();
        }

        if (subpath === "auth") {
          return requireGet() ?? this.authManager.getStatus();
        }

        if (subpath === "parts") {
          const errRes = requireGet();
          if (errRes) return errRes;
          return {
            world: "telegram",
            parts: this.listParts(),
          };
        }

        if (subpath.startsWith("parts/")) {
          const errRes = requireGet();
          if (errRes) return errRes;
          const partId = safeDecodeUriComponent(subpath.slice("parts/".length));
          const part = this.parts.get(partId) || this.listParts().find((p) => p.id === partId);
          if (!part) {
            return textResponse(404, `Part not found: ${partId}`);
          }
          return part;
        }

        if (subpath === "messages") {
          return requireGet() ?? Array.from(this.messageHistory.values());
        }

        if (subpath.startsWith("messages/")) {
          const errRes = requireGet();
          if (errRes) return errRes;
          const msgId = safeDecodeUriComponent(subpath.slice("messages/".length));
          const msg = this.messageHistory.get(msgId);
          if (!msg) {
            return textResponse(404, `Message not found: ${msgId}`);
          }
          return msg;
        }

        if (subpath === "actions/message.send" || subpath === "actions/message.post") {
          const errRes = requirePost();
          if (errRes) return errRes;
          if (!routeCtx.body) {
            return textResponse(
              400,
              `POST /world/telegram/${subpath} requires JSON body with { chatId|channelId, text|message }`,
            );
          }
          const bodyObj = parseRouteJsonBody(routeCtx.body);
          const rawTarget = bodyObj.chatId ?? bodyObj.chat_id ?? bodyObj.channelId;
          if (rawTarget === undefined || rawTarget === null || String(rawTarget).trim() === "") {
            return textResponse(400, `POST /world/telegram/${subpath} requires chatId or channelId`);
          }
          const { chatId, threadId } = parseTelegramTarget(String(rawTarget));
          const speakCheck = this.authManager.canSpeak(chatId);
          if (!speakCheck.authorized) {
            throw new TelegramAuthorizationError(
              speakCheck.reason || `Unauthorized Telegram target chat: ${chatId}`,
            );
          }
          const rawText = String(bodyObj.text ?? bodyObj.message ?? "").trim();
          if (!rawText) {
            return textResponse(
              400,
              `POST /world/telegram/${subpath} requires non-empty text or message`,
            );
          }
          const filteredText = checkTelegramContentFilter(
            rawText,
            this.contentFilterConfig,
            this.bannedWords,
            this.bannedWordAction,
          );
          this.rateLimiter.checkAndRecord(chatId);

          const rawReplyTo = bodyObj.replyTo ?? bodyObj.reply_to_message_id ?? bodyObj.parentItemId;
          const replyId = parseNumericId(rawReplyTo);
          const msgThreadId =
            (bodyObj.messageThreadId as number | undefined) ??
            (bodyObj.message_thread_id as number | undefined) ??
            threadId;

          if (this.client) {
            const sent = await this.client.sendMessage({
              chatId,
              text: filteredText,
              parseMode: bodyObj.parseMode ?? bodyObj.parse_mode,
              replyToMessageId: typeof replyId === "number" ? replyId : undefined,
              messageThreadId: msgThreadId,
              disableWebPagePreview: Boolean(bodyObj.disable_web_page_preview),
            });
            for (const m of sent) {
              this.markSentMessageId(m.chat.id, m.message_id);
              this.botIndexStore?.recordTelegramMessage(m, "out", filteredText);
            }
            const messageIds = sent.map((m) => m.message_id);
            this.recordAction({
              id: `tg-act-${Date.now()}`,
              targetPartId: String(rawTarget),
              chatId,
              action: { action: "sendMessage", text: filteredText, replyTo: replyId },
              actor: {
                id: String(bodyObj.actorId || "actor:world-api"),
                name: String(bodyObj.actorName || bodyObj.senderName || "companion"),
                session: "world-api",
                agentId: String(bodyObj.sender || "world-api"),
              },
              timestamp: Date.now(),
              status: "dispatched",
              rawResult: sent,
            });
            return {
              ok: true,
              chatId: String(chatId),
              sentCount: messageIds.length,
              messageIds,
            };
          }

          const actionRes = await this.actionDispatcher({
            chatId,
            targetPartId: String(rawTarget),
            action: {
              action: "sendMessage",
              text: filteredText,
              replyTo: replyId,
              messageThreadId: msgThreadId,
            },
            actor: {
              id: String(bodyObj.actorId || "actor:world-api"),
              name: String(bodyObj.actorName || bodyObj.senderName || "companion"),
              session: "world-api",
              agentId: String(bodyObj.sender || "world-api"),
            },
            timestamp: Date.now(),
          });
          if (actionRes) {
            this.recordAction(actionRes);
          }
          return {
            ok: true,
            chatId: String(chatId),
            sentCount: 1,
            result: actionRes ?? { status: "dispatched" },
          };
        }

        if (subpath === "actions/chat_action") {
          const errRes = requirePost();
          if (errRes) return errRes;
          if (!routeCtx.body) {
            return textResponse(400, "POST /world/telegram/actions/chat_action requires JSON body");
          }
          const bodyObj = parseRouteJsonBody(routeCtx.body);
          const rawTarget = bodyObj.chatId ?? bodyObj.chat_id ?? bodyObj.channelId;
          if (!rawTarget) {
            return textResponse(
              400,
              "POST /world/telegram/actions/chat_action requires chatId or channelId",
            );
          }
          return await this.executeSafeTool({
            action: "send_chat_action",
            chat_id: parseTelegramTarget(String(rawTarget)).chatId,
            chat_action: bodyObj.chatAction ?? bodyObj.chat_action ?? "typing",
          });
        }

        if (subpath === "actions") {
          return requireGet() ?? this.actionHistory;
        }

        if (subpath === "history") {
          const errRes = requireGet();
          if (errRes) return errRes;
          if (!this.botIndexStore) {
            return { chats: {}, recent: [] };
          }
          const allChats = this.botIndexStore.loadChatsIndex();
          const authorizedChats: Record<string, (typeof allChats)[string]> = {};
          for (const [cid, meta] of Object.entries(allChats)) {
            if (this.authManager.canReadChat(cid)) {
              authorizedChats[cid] = meta;
            }
          }
          const recent =
            this.defaultChatId && this.authManager.canReadChat(this.defaultChatId)
              ? this.botIndexStore.loadRecentHistory(this.defaultChatId, 20)
              : [];
          return {
            chats: authorizedChats,
            recent,
          };
        }

        if (subpath.startsWith("history/")) {
          const errRes = requireGet();
          if (errRes) return errRes;
          const chatKey = safeDecodeUriComponent(subpath.slice("history/".length)).trim();
          if (!chatKey || chatKey === "." || chatKey === ".." || /[\/\\]|\.\.|\0/.test(chatKey)) {
            return textResponse(400, "Invalid chatKey for /world/telegram/history/:chatKey");
          }

          let resolvedChatId = normalizeTelegramChatId(chatKey);
          if (this.botIndexStore) {
            const index = this.botIndexStore.loadChatsIndex();
            const matchEntry = Object.entries(index).find(
              ([cid, meta]) => cid === resolvedChatId || meta.alias === chatKey,
            );
            if (matchEntry) {
              resolvedChatId = matchEntry[0];
            }
          }

          if (!this.authManager.canReadChat(resolvedChatId)) {
            throw new TelegramAuthorizationError(
              `History read refused: chat '${chatKey}' is not in the authorized read whitelist`,
            );
          }

          if (!this.botIndexStore) {
            return { chat: chatKey, entries: [] };
          }
          return {
            chat: chatKey,
            entries: this.botIndexStore.loadRecentHistory(chatKey, 30),
          };
        }

        if (subpath === "ops-log") {
          if (method === "GET") {
            return {
              logs: this.opsLogger ? this.opsLogger.readRecentLogs(7) : [],
            };
          }
          if (method === "POST") {
            if (!this.opsLogger) {
              return textResponse(400, "OpsLogger is not configured");
            }
            if (!routeCtx.body) {
              return textResponse(400, "POST /world/telegram/ops-log requires JSON body");
            }
            const bodyObj = parseRouteJsonBody(routeCtx.body);
            const sendToTelegram = Boolean(bodyObj.sendToTelegram);
            if (sendToTelegram) {
              const targetChatId = this.opsLogger.targetChatId;
              if (!targetChatId) {
                throw new TelegramAuthorizationError(
                  "ops-log sendToTelegram refused: targetChatId is not configured",
                );
              }
              const speakCheck = this.authManager.canSpeak(targetChatId);
              if (!speakCheck.authorized) {
                throw new TelegramAuthorizationError(
                  speakCheck.reason || `Unauthorized ops-log target chat: ${targetChatId}`,
                );
              }
              const candidateText = String(
                bodyObj.text ||
                  `[${String(bodyObj.category || "ops")}]${bodyObj.channel ? ` (${bodyObj.channel})` : ""} ${String(bodyObj.details || "")}`,
              );
              checkTelegramContentFilter(
                candidateText,
                this.contentFilterConfig,
                this.bannedWords,
                this.bannedWordAction,
              );
              this.rateLimiter.checkAndRecord(targetChatId);
            }
            return await this.opsLogger.logMessage({
              category: String(bodyObj.category || "ops"),
              channel: typeof bodyObj.channel === "string" ? bodyObj.channel : undefined,
              details: String(bodyObj.details || bodyObj.text || ""),
              text: typeof bodyObj.text === "string" ? bodyObj.text : undefined,
              meta:
                bodyObj.meta && typeof bodyObj.meta === "object" && !Array.isArray(bodyObj.meta)
                  ? (bodyObj.meta as Record<string, unknown>)
                  : undefined,
              sendToTelegram,
            });
          }
          return textResponse(405, `Method ${method} not allowed for /world/telegram/ops-log`);
        }

        if (subpath === "archive") {
          const errRes = requirePost();
          if (errRes) return errRes;
          if (!routeCtx.body) {
            return textResponse(
              400,
              "POST /world/telegram/archive requires JSON body with { channel }",
            );
          }
          const bodyObj = parseRouteJsonBody(routeCtx.body);
          if (bodyObj.ledgerPath !== undefined || bodyObj.archiveOutDir !== undefined) {
            throw new TelegramAuthorizationError(
              "HTTP /world/telegram/archive forbids caller-supplied ledgerPath or archiveOutDir",
            );
          }
          const channel = normalizeAndValidateChannelUsername(String(bodyObj.channel ?? ""));
          const rawMaxPages = typeof bodyObj.maxPages === "number" ? bodyObj.maxPages : 5;
          const maxPages = Math.min(20, Math.max(1, Math.trunc(rawMaxPages)));
          return await this.archivePublicChannel({
            channel,
            maxPages,
            stopAtMsgId:
              typeof bodyObj.stopAtMsgId === "number" && bodyObj.stopAtMsgId > 0
                ? bodyObj.stopAtMsgId
                : undefined,
          });
        }

        if (subpath === "tool") {
          const errRes = requirePost();
          if (errRes) return errRes;
          if (!routeCtx.body) {
            return textResponse(
              400,
              "POST /world/telegram/tool requires JSON body with { action, ... }",
            );
          }
          const req = parseRouteJsonBody<TelegramSafeToolRequest>(routeCtx.body);
          return await this.executeSafeTool(req);
        }

        if (subpath === "webhook") {
          const errRes = requirePost();
          if (errRes) return errRes;
          if (this.mode !== "webhook") {
            return textResponse(
              403,
              `Webhook endpoint disabled: TelegramWorld mode is '${this.mode}'`,
            );
          }
          if (!this.webhookSecret) {
            return textResponse(403, "Webhook endpoint rejected: webhookSecret is not configured");
          }
          const providedToken = routeCtx.headers?.get("x-telegram-bot-api-secret-token") ?? "";
          if (!providedToken || !timingSafeEqualStr(providedToken, this.webhookSecret)) {
            return textResponse(403, "Invalid or missing X-Telegram-Bot-Api-Secret-Token");
          }
          if (!routeCtx.body) {
            return textResponse(400, "POST /world/telegram/webhook requires JSON update payload");
          }
          const update = parseRouteJsonBody<TelegramUpdate>(routeCtx.body);
          const input = this.ingestUpdate(update);
          return { ok: true, inputId: input?.id };
        }

        return textResponse(404, `Unknown TelegramWorld route: /world/telegram/${subpath}`);
      } catch (err: any) {
        if (err instanceof TelegramAuthorizationError) {
          return textResponse(403, err.message);
        }
        if (err instanceof TelegramContentFilterError) {
          return textResponse(422, err.message);
        }
        if (err instanceof TelegramRateLimitError) {
          return textResponse(429, err.message);
        }
        if (err instanceof SyntaxError || /requires|Invalid/i.test(String(err?.message || ""))) {
          return textResponse(400, err instanceof Error ? err.message : String(err));
        }
        throw err;
      }
    };

    const routeHandleWildcard = ctx.router.serve(
      "/world/telegram/*",
      routeHandler,
      "Telegram World resource router (wildcard)",
    );

    const routeHandleRoot = ctx.router.serve(
      "/world/telegram",
      routeHandler,
      "Telegram World resource router (root)",
    );

    // 3. Start Polling Loop if mode is polling and not in passive mode (single-flight guarded)
    if (!this.passive && this.mode === "polling") {
      const poll = async () => {
        if (!this.active || this.inFlightPoll) return;
        const run = (async () => {
          const updates = await this.updateFetcher(this.lastUpdateOffset);
          if (!this.active || !Array.isArray(updates)) return;

          if (this.skipInitialUpdates && !this.initialPollDone) {
            this.initialPollDone = true;
            let nextOffset = this.lastUpdateOffset;
            for (const update of updates) {
              if (!this.active) break;
              if (update && typeof update.update_id === "number") {
                nextOffset = Math.max(nextOffset, update.update_id + 1);
                if (update.callback_query) {
                  const cbId = `tg-cbq-${update.callback_query.id}`;
                  this.seenIds.add(cbId);
                  this.saveState(cbId, "callback_query");
                }
                const msg =
                  update.message ||
                  update.channel_post ||
                  update.edited_message ||
                  update.edited_channel_post;
                if (msg) {
                  const eventId = `tg-msg-${msg.chat.id}-${msg.message_id}`;
                  this.seenIds.add(eventId);
                  this.saveState(eventId, `channel:${msg.chat.id}`);
                }
              }
            }
            if (nextOffset !== this.lastUpdateOffset) {
              this.lastUpdateOffset = nextOffset;
              this.saveLastUpdateOffset(this.lastUpdateOffset);
            }
            return;
          }

          this.initialPollDone = true;
          let nextOffset = this.lastUpdateOffset;
          for (const update of updates) {
            if (!this.active) break;
            if (update && typeof update.update_id === "number") {
              this.ingestUpdate(update);
              nextOffset = Math.max(nextOffset, update.update_id + 1);
            }
          }
          if (nextOffset !== this.lastUpdateOffset) {
            this.lastUpdateOffset = nextOffset;
            this.saveLastUpdateOffset(this.lastUpdateOffset);
          }
        })()
          .catch((err) => {
            console.error("[TelegramWorld] Polling error:", err);
          })
          .finally(() => {
            if (this.inFlightPoll === run) {
              this.inFlightPoll = null;
            }
          });
        this.inFlightPoll = run;
        await run;
      };

      poll().catch((err) => {
        console.error("[TelegramWorld] Initial poll error:", err);
      });
      this.pollingTimer = setInterval(() => {
        void poll();
      }, this.pollInterval);
    }

    return {
      dispose: () => {
        this.active = false;
        if (this.pollingTimer) {
          clearInterval(this.pollingTimer);
          this.pollingTimer = null;
        }
        routeHandleWildcard.dispose();
        routeHandleRoot.dispose();
        registryHandle.dispose();
        this.dispose();
      },
    };
  }

  /**
   * Interacts with a specific part on behalf of an EMA Actor.
   *
   * Invariants (RFC-0001):
   * - authenticated-actor-interaction: Authenticates dispatching EmaActor and asserts operating agent identity.
   * - Enforces `TelegramAuthorizationManager`, `checkTelegramContentFilter`, and `TelegramRateLimiter`.
   */
  interact(_ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable {
    // 1. Authenticate Actor and verify operating employee identity
    assertAgentIdentity(this.env);
    if (!actor || !actor.id || !actor.agentId || !actor.session) {
      throw new Error("Invalid or unauthenticated EmaActor credentials");
    }

    if (args.length === 0) {
      throw new Error("No action or message provided for Telegram interaction");
    }

    const { chatId, threadId } = parseTelegramTarget(id);

    // 2. Enforce outbound chat authorization
    const speakCheck = this.authManager.canSpeak(chatId);
    if (!speakCheck.authorized) {
      throw new TelegramAuthorizationError(
        speakCheck.reason || `Unauthorized Telegram target chat: ${chatId}`,
      );
    }

    // 3. Parse Action
    let action: TelegramAction;

    if (typeof args[0] === "string") {
      if (args[0] === "reply" && typeof args[1] === "string") {
        const filteredText = checkTelegramContentFilter(
          args[1],
          this.contentFilterConfig,
          this.bannedWords,
          this.bannedWordAction,
        );
        action = {
          action: "reply",
          text: filteredText,
          message_thread_id: threadId,
        };
      } else if (
        (args[0] === "react" || args[0] === "reaction") &&
        (typeof args[1] === "string" || Array.isArray(args[1]))
      ) {
        action = {
          action: "react",
          emoji: args[1] as string | string[],
          messageId: parseNumericId(args[2] as string | number | undefined),
        };
      } else {
        const filteredText = checkTelegramContentFilter(
          args[0],
          this.contentFilterConfig,
          this.bannedWords,
          this.bannedWordAction,
        );
        action = {
          action: "sendMessage",
          text: filteredText,
          message_thread_id: threadId,
        };
      }
    } else if (typeof args[0] === "object" && args[0] !== null) {
      const obj = args[0] as Record<string, unknown>;
      const actType = String(obj.action || "sendMessage");

      if (actType === "react" || actType === "reaction" || actType === "setMessageReaction") {
        action = {
          action: "react",
          emoji: (obj.emoji as string | string[]) || "👍",
          messageId: parseNumericId(
            (obj.messageId || obj.message_id) as string | number | undefined,
          ),
          isBig: Boolean(obj.isBig || obj.is_big),
        };
      } else if (actType === "sendCard") {
        const title = obj.title
          ? checkTelegramContentFilter(
              String(obj.title),
              this.contentFilterConfig,
              this.bannedWords,
              this.bannedWordAction,
            )
          : undefined;
        const description = obj.description
          ? checkTelegramContentFilter(
              String(obj.description),
              this.contentFilterConfig,
              this.bannedWords,
              this.bannedWordAction,
            )
          : undefined;
        action = {
          action: "sendCard",
          title,
          description,
          mediaUrl: (obj.mediaUrl || obj.media) as string | undefined,
          mediaType: obj.mediaType as "photo" | "video" | undefined,
          buttons: (obj.buttons ||
            (obj.reply_markup as { inline_keyboard?: TelegramInlineKeyboardButton[][] })
              ?.inline_keyboard) as TelegramInlineKeyboardButton[][] | undefined,
          parse_mode: (obj.parse_mode as TelegramParseMode) || "MarkdownV2",
          replyTo: parseNumericId((obj.replyTo || obj.reply_to_message_id) as string | number),
          messageThreadId:
            (obj.messageThreadId as number | undefined) ??
            (obj.message_thread_id as number | undefined) ??
            threadId,
        };
      } else if (actType === "sendMediaGroup") {
        const rawItems = Array.isArray(obj.items) ? (obj.items as TelegramMediaGroupItem[]) : [];
        const filteredItems = rawItems.map((item) => ({
          ...item,
          ...(item.caption
            ? {
                caption: checkTelegramContentFilter(
                  item.caption,
                  this.contentFilterConfig,
                  this.bannedWords,
                  this.bannedWordAction,
                ),
              }
            : {}),
        }));
        const rawCaption = (obj.caption || obj.text) as string | undefined;
        const filteredCaption = rawCaption
          ? checkTelegramContentFilter(
              rawCaption,
              this.contentFilterConfig,
              this.bannedWords,
              this.bannedWordAction,
            )
          : undefined;
        action = {
          action: "sendMediaGroup",
          items: filteredItems,
          caption: filteredCaption,
          parse_mode: obj.parse_mode as TelegramParseMode | undefined,
          has_spoiler: Boolean(obj.has_spoiler ?? obj.hasSpoiler),
          replyTo: parseNumericId((obj.replyTo || obj.reply_to_message_id) as string | number),
          messageThreadId:
            (obj.messageThreadId as number | undefined) ??
            (obj.message_thread_id as number | undefined) ??
            threadId,
        };
      } else if (actType === "forwardMessages" || actType === "forwardMessage") {
        const fromChatId = (obj.fromChatId ?? obj.from_chat_id) as string | number;
        if (!this.authManager.canForwardFromChat(fromChatId)) {
          throw new TelegramAuthorizationError(
            `Forwarding refused: source chat '${fromChatId}' is not in authorized forward sources`,
          );
        }
        const messageIds = Array.isArray(obj.messageIds ?? obj.message_ids)
          ? ((obj.messageIds ?? obj.message_ids) as Array<number | string>)
          : obj.messageId !== undefined
            ? [obj.messageId as number | string]
            : [];
        action = {
          action: "forwardMessages",
          fromChatId,
          messageIds,
        };
      } else if (actType === "deleteMessage") {
        action = {
          action: "deleteMessage",
          messageId: (obj.messageId ?? obj.message_id) as number | string,
        };
      } else if (actType === "verifyDelivered") {
        const probeChatId = (obj.probeChatId ?? obj.probe_chat_id) as string | number | undefined;
        if (probeChatId !== undefined) {
          const probeSpeakCheck = this.authManager.canSpeak(probeChatId);
          if (!probeSpeakCheck.authorized) {
            throw new TelegramAuthorizationError(
              probeSpeakCheck.reason || "Unauthorized probe target chat",
            );
          }
        }
        action = {
          action: "verifyDelivered",
          messageId: (obj.messageId ?? obj.message_id) as number | string,
          probeChatId,
        };
      } else if (actType === "sendChatAction") {
        action = {
          action: "sendChatAction",
          chatAction: (obj.chatAction ?? obj.chat_action ?? "typing") as any,
        };
      } else if (
        actType === "sendPhoto" ||
        actType === "sendDocument" ||
        actType === "sendVideo" ||
        actType === "sendAudio" ||
        actType === "sendAnimation" ||
        actType === "sendMedia"
      ) {
        const rawCaption = (obj.caption || obj.text) as string | undefined;
        const filteredCaption = rawCaption
          ? checkTelegramContentFilter(
              rawCaption,
              this.contentFilterConfig,
              this.bannedWords,
              this.bannedWordAction,
            )
          : undefined;
        action = {
          action: actType as TelegramSendMediaAction["action"],
          type:
            (obj.type as TelegramSendMediaAction["type"]) ||
            (actType === "sendPhoto"
              ? "photo"
              : actType === "sendDocument"
                ? "document"
                : actType === "sendVideo"
                  ? "video"
                  : actType === "sendAudio"
                    ? "audio"
                    : actType === "sendAnimation"
                      ? "animation"
                      : "photo"),
          media: (obj.media || obj.photo || obj.document || obj.video || obj.audio) as
            | string
            | undefined,
          photo: obj.photo as string | undefined,
          document: obj.document as string | undefined,
          video: obj.video as string | undefined,
          audio: obj.audio as string | undefined,
          caption: filteredCaption,
          parse_mode: obj.parse_mode as TelegramParseMode | undefined,
          has_spoiler: Boolean(obj.has_spoiler ?? obj.hasSpoiler),
          replyTo: parseNumericId((obj.replyTo || obj.reply_to_message_id) as string | number),
          messageThreadId:
            (obj.messageThreadId as number | undefined) ??
            (obj.message_thread_id as number | undefined) ??
            threadId,
          reply_markup: (obj.reply_markup ||
            (obj.buttons ? { inline_keyboard: obj.buttons } : undefined)) as
            | TelegramInlineKeyboardMarkup
            | undefined,
          filename: obj.filename as string | undefined,
        };
      } else {
        const rawText = String(obj.text || obj.message || "");
        const filteredText = checkTelegramContentFilter(
          rawText,
          this.contentFilterConfig,
          this.bannedWords,
          this.bannedWordAction,
        );
        action = {
          action: (obj.action as "sendMessage" | "reply") || "sendMessage",
          text: filteredText,
          parse_mode: obj.parse_mode as TelegramParseMode | undefined,
          replyTo: parseNumericId((obj.replyTo || obj.reply_to_message_id) as string | number),
          messageThreadId:
            (obj.messageThreadId as number | undefined) ??
            (obj.message_thread_id as number | undefined) ??
            threadId,
          reply_markup: (obj.reply_markup ||
            (obj.buttons ? { inline_keyboard: obj.buttons } : undefined)) as
            | TelegramInlineKeyboardMarkup
            | undefined,
          disable_web_page_preview: Boolean(obj.disable_web_page_preview),
        };
      }
    } else {
      throw new Error("Invalid action format for Telegram interaction");
    }

    // 4. Enforce per-chat rate limit
    this.rateLimiter.checkAndRecord(chatId);

    // 5. Dispatch Action (strictly serialized via inFlightDispatch)
    const payload: TelegramActionPayload = {
      chatId,
      targetPartId: id,
      action,
      actor,
      timestamp: Date.now(),
    };

    const runDispatch = (): Promise<void> => {
      try {
        const res = this.actionDispatcher(payload);
        if (res && typeof (res as Promise<TelegramActionResult | void>).then === "function") {
          return (res as Promise<TelegramActionResult | void>)
            .then((resolved) => {
              const finalRes =
                resolved ||
                ({
                  id: `tg-act-${Date.now()}`,
                  targetPartId: id,
                  chatId,
                  action,
                  actor,
                  timestamp: payload.timestamp,
                  status: "dispatched",
                } as TelegramActionResult);
              this.recordAction(finalRes);
            })
            .catch((err) => {
              console.error(`[TelegramWorld] Failed async action dispatch to part ${id}:`, err);
              this.recordAction({
                id: `tg-act-${Date.now()}`,
                targetPartId: id,
                chatId,
                action,
                actor,
                timestamp: payload.timestamp,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }
        if (res) {
          this.recordAction(res as TelegramActionResult);
        } else {
          this.recordAction({
            id: `tg-act-${Date.now()}`,
            targetPartId: id,
            chatId,
            action,
            actor,
            timestamp: payload.timestamp,
            status: "dispatched",
          });
        }
        return Promise.resolve();
      } catch (err) {
        if (
          err instanceof TelegramAuthorizationError ||
          err instanceof TelegramContentFilterError ||
          err instanceof TelegramRateLimitError
        ) {
          throw err;
        }
        console.error(`[TelegramWorld] Failed action dispatch to part ${id}:`, err);
        this.recordAction({
          id: `tg-act-${Date.now()}`,
          targetPartId: id,
          chatId,
          action,
          actor,
          timestamp: payload.timestamp,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
        return Promise.resolve();
      }
    };

    const currentTail = this.inFlightDispatch;
    if (currentTail) {
      const queued = currentTail
        .then(() => runDispatch())
        .catch((err) => {
          console.error(`[TelegramWorld] Failed queued action dispatch to part ${id}:`, err);
          this.recordAction({
            id: `tg-act-${Date.now()}`,
            targetPartId: id,
            chatId,
            action,
            actor,
            timestamp: payload.timestamp,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          if (this.inFlightDispatch === queued) {
            this.inFlightDispatch = null;
          }
        });
      this.inFlightDispatch = queued;
    } else {
      const first = runDispatch().finally(() => {
        if (this.inFlightDispatch === first) {
          this.inFlightDispatch = null;
        }
      });
      this.inFlightDispatch = first;
    }

    return {
      dispose: () => {},
    };
  }

  private recordAction(res: TelegramActionResult): void {
    if (this.actionHistory.length >= 200) {
      this.actionHistory.shift();
    }
    this.actionHistory.push(res);
  }

  dispose(): void {
    this.active = false;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.db) {
      try {
        this.insertSeenStmt = null;
        this.selectAllSeenStmt = null;
        this.upsertWorldStateStmt = null;
        this.selectWorldStateStmt = null;
        this.db.close();
      } catch (err) {
        console.error("[TelegramWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    }
  }
}
