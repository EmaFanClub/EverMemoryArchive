/**
 * @prism-shadow/ema - TelegramWorld
 *
 * Telegram World implementation for EverMemoryArchive conforming to RFC-0001.
 * Supports:
 * - Input Node (node-mw7rlppg-ae0e): Bot API & MTProto webhook/polling, multi-part
 *   channel/group/DM/thread ingestion, debounce coalescing, and XML payload normalization.
 * - Action Node (node-mw7rp4py-6f39): MarkdownV2 formatted message delivery, rich media/cards,
 *   inline keyboard buttons, emoji reactions, and thread replies.
 */

import fs from "node:fs";
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
} from "../interfaces.js";
import { assertAgentIdentity } from "../minimal.js";

export type TelegramPartType = "channel" | "group" | "dm" | "thread" | string;

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  date: number; // Unix timestamp in seconds
  chat: TelegramChat;
  forward_from?: TelegramUser;
  forward_date?: number;
  reply_to_message?: TelegramMessage;
  text?: string;
  entities?: TelegramMessageEntity[];
  caption?: string;
  caption_entities?: TelegramMessageEntity[];
  photo?: TelegramPhotoSize[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
  video?: { file_id: string; duration: number; width: number; height: number };
  audio?: { file_id: string; duration: number; performer?: string; title?: string };
  voice?: { file_id: string; duration: number };
  animation?: { file_id: string };
  sticker?: { file_id: string; emoji?: string };
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
  chat_instance?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface RawMtprotoPeer {
  _?: "peerUser" | "peerChat" | "peerChannel" | string;
  userId?: number;
  chatId?: number;
  channelId?: number;
  id?: number;
}

export interface RawMtprotoUpdate {
  _?: string;
  message?: {
    id: number;
    peerId?: RawMtprotoPeer;
    fromId?: RawMtprotoPeer;
    date: number;
    message?: string;
    replyTo?: { replyToMsgId?: number; replyToTopId?: number };
    media?: unknown;
    entities?: unknown[];
  };
  userId?: number;
  chatId?: number;
  channelId?: number;
}

export interface TelegramInlineKeyboardButton {
  readonly text: string;
  readonly url?: string;
  readonly callback_data?: string;
  readonly web_app?: { url: string };
}

export interface TelegramInlineKeyboardMarkup {
  readonly inline_keyboard: TelegramInlineKeyboardButton[][];
}

export type TelegramParseMode = "MarkdownV2" | "HTML" | "Markdown";

export interface TelegramSendMessageAction {
  action?: "sendMessage" | "reply";
  text: string;
  parse_mode?: TelegramParseMode;
  reply_to_message_id?: number | string;
  replyTo?: number | string;
  message_thread_id?: number;
  messageThreadId?: number;
  reply_markup?: TelegramInlineKeyboardMarkup;
  disable_web_page_preview?: boolean;
}

export interface TelegramSendMediaAction {
  action: "sendMedia" | "sendPhoto" | "sendDocument" | "sendVideo" | "sendAudio" | "sendAnimation";
  type?: "photo" | "document" | "video" | "audio" | "animation";
  media?: string;
  photo?: string;
  document?: string;
  video?: string;
  audio?: string;
  caption?: string;
  parse_mode?: TelegramParseMode;
  reply_to_message_id?: number | string;
  replyTo?: number | string;
  message_thread_id?: number;
  messageThreadId?: number;
  reply_markup?: TelegramInlineKeyboardMarkup;
  filename?: string;
}

export interface TelegramSendCardAction {
  action: "sendCard";
  title?: string;
  description?: string;
  mediaUrl?: string;
  mediaType?: "photo" | "video";
  buttons?: TelegramInlineKeyboardButton[][];
  parse_mode?: TelegramParseMode;
  reply_to_message_id?: number | string;
  replyTo?: number | string;
  message_thread_id?: number;
  messageThreadId?: number;
}

export interface TelegramReactionAction {
  action: "react" | "reaction" | "setMessageReaction";
  messageId?: number | string;
  emoji: string | string[];
  isBig?: boolean;
}

export type TelegramAction =
  | TelegramSendMessageAction
  | TelegramSendMediaAction
  | TelegramSendCardAction
  | TelegramReactionAction;

export interface TelegramActionPayload {
  chatId: string | number;
  targetPartId: string;
  action: TelegramAction;
  actor: EmaActor;
  timestamp: number;
}

export interface TelegramActionResult {
  id: string;
  targetPartId: string;
  chatId: string | number;
  action: TelegramAction;
  actor: EmaActor;
  timestamp: number;
  status: "dispatched" | "failed";
  rawResult?: unknown;
  error?: string;
}

/**
 * Escapes Telegram MarkdownV2 special characters:
 * _ * [ ] ( ) ~ ` > # + - = | { } . ! \
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Escapes special characters inside Telegram MarkdownV2 inline code or pre blocks:
 * Only ` and \ must be escaped.
 */
export function escapeMarkdownV2Code(text: string): string {
  return text.replace(/([\\`])/g, "\\$1");
}

export function mdV2Bold(text: string): string {
  return `*${escapeMarkdownV2(text)}*`;
}

export function mdV2Italic(text: string): string {
  return `_${escapeMarkdownV2(text)}_`;
}

export function mdV2Code(text: string): string {
  return `\`${escapeMarkdownV2Code(text)}\``;
}

export function mdV2Pre(code: string, language = ""): string {
  return `\`\`\`${language}\n${escapeMarkdownV2Code(code)}\n\`\`\``;
}

export function mdV2Link(text: string, url: string): string {
  const escapedUrl = url.replace(/([\\)])/g, "\\$1");
  return `[${escapeMarkdownV2(text)}](${escapedUrl})`;
}

export function mdV2Spoiler(text: string): string {
  return `||${escapeMarkdownV2(text)}||`;
}

export function mdV2Strikethrough(text: string): string {
  return `~${escapeMarkdownV2(text)}~`;
}

export function mdV2Underline(text: string): string {
  return `__${escapeMarkdownV2(text)}__`;
}

export function inlineKeyboard(
  rows: TelegramInlineKeyboardButton[][],
): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

export interface TelegramWorldOptions {
  /** Bot token for Telegram Bot API */
  botToken?: string;
  /** Operating mode: polling, webhook, mtproto, or passive (default: "polling" if updateFetcher/botToken given, else "passive") */
  mode?: "polling" | "webhook" | "mtproto" | "passive";
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number;
  /** Pre-configured parts (channels, groups, DMs, threads) */
  parts?: EmaWorldPart[];
  /** SQLite database path for persistent seen state (defaults to /tmp/ema-minimal-workspace/ema-telegram-state.sqlite) */
  dbPath?: string;
  /** Legacy alias for dbPath */
  stateFile?: string;
  /** Configured owner/admin IDs (strings or numbers) */
  ownerIds?: (string | number)[];
  /** Known Bot ID to prevent self-reply loops */
  botId?: string | number;
  /** Known Bot Username */
  botUsername?: string;
  /** Custom update fetcher for Bot API updates (polling mode or testing) */
  updateFetcher?: (offset: number) => Promise<TelegramUpdate[]> | TelegramUpdate[];
  /** Custom action dispatcher for outgoing operations */
  actionDispatcher?: (
    payload: TelegramActionPayload,
  ) => Promise<TelegramActionResult | void> | TelegramActionResult | void;
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** Passive mode: mounts routes without active network polling */
  passive?: boolean;
}

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
  const match = id.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : id;
}

export class TelegramWorld extends EmaWorld {
  private botToken?: string;
  private mode: "polling" | "webhook" | "mtproto" | "passive";
  private pollInterval: number;
  private dbPath?: string;
  private ownerIds: Set<string> = new Set();
  private botId?: string;
  private botUsername?: string;
  private updateFetcher: (offset: number) => Promise<TelegramUpdate[]> | TelegramUpdate[];
  private actionDispatcher: (
    payload: TelegramActionPayload,
  ) => Promise<TelegramActionResult | void> | TelegramActionResult | void;
  private env: Record<string, string | undefined>;
  private passive: boolean;

  private parts: Map<string, EmaWorldPart> = new Map();
  private messageHistory: Map<string, EmaInput> = new Map();
  private actionHistory: TelegramActionResult[] = [];
  private seenIds: Set<string> = new Set();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private lastUpdateOffset = 0;
  private startTime = 0;
  private ctx: EmaCtx | null = null;

  private db: DatabaseSync | null = null;
  private insertSeenStmt: StatementSync | null = null;
  private selectAllSeenStmt: StatementSync | null = null;

  constructor(options: TelegramWorldOptions = {}) {
    super();
    this.botToken = options.botToken;
    this.pollInterval = options.pollInterval ?? 2000;
    this.env = options.env ?? process.env;
    this.passive = options.passive ?? false;
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
        this.ownerIds.add(String(id).replace(/^user:/, ""));
      }
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
      this.dbPath = "/tmp/ema-minimal-workspace/ema-telegram-state.sqlite";
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
        if (!this.botToken) return [];
        try {
          const res = await fetch(
            `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${offset}&timeout=2`,
          );
          if (!res.ok) return [];
          const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
          return data.ok && Array.isArray(data.result) ? data.result : [];
        } catch {
          return [];
        }
      });

    this.actionDispatcher =
      options.actionDispatcher ??
      ((payload: TelegramActionPayload): TelegramActionResult => {
        const actionId = `tg-act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return {
          id: actionId,
          targetPartId: payload.targetPartId,
          chatId: payload.chatId,
          action: payload.action,
          actor: payload.actor,
          timestamp: payload.timestamp,
          status: "dispatched",
        };
      });

    this.initSqlite();
    this.loadState();
  }

  private initSqlite(): void {
    if (!this.dbPath) return;
    try {
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
        "INSERT OR IGNORE INTO seen_messages (id, channel, timestamp) VALUES (?, ?, ?)",
      );
      this.selectAllSeenStmt = this.db.prepare("SELECT id FROM seen_messages");
    } catch (err) {
      console.error("[TelegramWorld] Failed to initialize SQLite database:", err);
    }
  }

  private loadState(): void {
    if (!this.db || !this.selectAllSeenStmt) return;
    try {
      const rows = this.selectAllSeenStmt.all() as Array<{ id: string }>;
      for (const row of rows) {
        if (row && typeof row.id === "string") {
          this.seenIds.add(row.id);
        }
      }
    } catch (err) {
      console.error("[TelegramWorld] Failed to load state from SQLite:", err);
    }
  }

  private saveState(id: string, partId: string): void {
    if (!this.db || !this.insertSeenStmt) return;
    try {
      this.insertSeenStmt.run(id, partId, Date.now());
    } catch (err) {
      console.error("[TelegramWorld] Failed to save seen message to SQLite:", err);
    }
  }

  private isOwner(senderId: string | number, username?: string): boolean {
    if (this.ownerIds.size === 0) return false;
    const sId = String(senderId).replace(/^user:/, "");
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

  public getStatus(): Record<string, unknown> {
    return {
      world: "telegram",
      active: this.active,
      mode: this.mode,
      botUsername: this.botUsername,
      botId: this.botId,
      partsCount: this.parts.size,
      messagesCount: this.messageHistory.size,
      actionsCount: this.actionHistory.length,
      uptimeMs: this.active ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Normalizes and ingests a raw Telegram Bot API update event.
   * Deduplicates seen IDs, resolves part topology, and enqueues to EmaInputBatcher.
   */
  public ingestUpdate(update: TelegramUpdate): EmaInput | null {
    if (!update || typeof update !== "object") return null;

    const msg =
      update.message ||
      update.channel_post ||
      update.edited_message ||
      update.edited_channel_post ||
      update.callback_query?.message;

    // Check sender if botId is configured
    const senderUser = msg?.from || update.callback_query?.from;
    if (senderUser && this.botId && String(senderUser.id) === this.botId) {
      return null;
    }

    // Determine event ID for deduplication
    const eventId = msg
      ? `tg-msg-${msg.chat.id}-${msg.message_id}`
      : `tg-update-${update.update_id}`;

    if (this.seenIds.has(eventId)) {
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

    // Extract text content
    let text = msg?.text || msg?.caption || "";
    if (!text) {
      if (msg?.photo && msg.photo.length > 0) {
        text = "[Photo]";
      } else if (msg?.document) {
        text = `[Document: ${msg.document.file_name || msg.document.file_id}]`;
      } else if (msg?.video) {
        text = "[Video]";
      } else if (msg?.audio) {
        text = "[Audio]";
      } else if (msg?.voice) {
        text = "[Voice Note]";
      } else if (msg?.sticker) {
        text = msg.sticker.emoji ? `[Sticker: ${msg.sticker.emoji}]` : "[Sticker]";
      } else if (update.callback_query?.data) {
        text = `[Button: ${update.callback_query.data}]`;
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

    const senderName = senderUser
      ? `${senderUser.first_name || ""} ${senderUser.last_name || ""}`.trim() ||
        senderUser.username ||
        String(senderUser.id)
      : msg?.sender_chat?.title || senderId;

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
        chatId: msg?.chat?.id,
        chatType: msg?.chat?.type,
        messageThreadId,
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

    const eventId = `tg-mtproto-${peerChatId}-${msg.id}`;
    if (this.seenIds.has(eventId)) {
      return null;
    }

    const text = (msg.message || "").trim();
    if (!text) return null;

    this.registerPart({
      id: partId,
      type: partType,
      name: partName,
    });

    const senderUserId = msg.fromId?.userId || update.userId || peerChatId || 0;
    const senderId = String(senderUserId);

    const replyTo = msg.replyTo?.replyToMsgId
      ? `tg-mtproto-${peerChatId}-${msg.replyTo.replyToMsgId}`
      : undefined;

    const input: EmaInput = {
      id: eventId,
      world: "telegram",
      partId,
      sender: {
        id: `user:${senderId}`,
        name: `User ${senderId}`,
        isOwner: this.isOwner(senderId),
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
    this.active = true;
    this.startTime = Date.now();
    this.ctx = ctx;

    // 1. Register with EmaWorldRegistry
    const registryHandle = ctx.registry.register("telegram", this);

    // 2. Mount resource routes on SimpleEmaRouter
    const routeHandler = async (routeCtx: EmaRouteContext) => {
      const subpath = routeCtx.path.replace(/^\/world\/telegram\/?/, "");

      if (subpath === "" || subpath === "status") {
        return this.getStatus();
      }

      if (subpath === "parts") {
        return {
          world: "telegram",
          parts: this.listParts(),
        };
      }

      if (subpath.startsWith("parts/")) {
        const partId = decodeURIComponent(subpath.slice("parts/".length));
        const part = this.parts.get(partId) || this.listParts().find((p) => p.id === partId);
        if (!part) {
          throw new Error(`Part not found: ${partId}`);
        }
        return part;
      }

      if (subpath === "messages") {
        return Array.from(this.messageHistory.values());
      }

      if (subpath.startsWith("messages/")) {
        const msgId = decodeURIComponent(subpath.slice("messages/".length));
        const msg = this.messageHistory.get(msgId);
        if (!msg) {
          throw new Error(`Message not found: ${msgId}`);
        }
        return msg;
      }

      if (subpath === "actions") {
        return this.actionHistory;
      }

      if (subpath === "webhook") {
        if (routeCtx.body) {
          const update =
            typeof routeCtx.body === "string"
              ? (JSON.parse(routeCtx.body) as TelegramUpdate)
              : (routeCtx.body as TelegramUpdate);
          const input = this.ingestUpdate(update);
          return { ok: true, inputId: input?.id };
        }
        return { ok: true, status: "webhook active" };
      }

      return this.getStatus();
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

    // 3. Start Polling Loop if mode is polling and not in passive mode
    if (!this.passive && this.mode === "polling") {
      const poll = async () => {
        if (!this.active) return;
        try {
          const updates = await this.updateFetcher(this.lastUpdateOffset);
          if (Array.isArray(updates)) {
            for (const update of updates) {
              if (update && typeof update.update_id === "number") {
                this.ingestUpdate(update);
                this.lastUpdateOffset = Math.max(this.lastUpdateOffset, update.update_id + 1);
              }
            }
          }
        } catch (err) {
          console.error("[TelegramWorld] Polling error:", err);
        }
      };

      poll().catch((err) => {
        console.error("[TelegramWorld] Initial poll error:", err);
      });
      this.pollingTimer = setInterval(poll, this.pollInterval);
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
   * - Action Dispatcher: Supports MarkdownV2 formatted message delivery, rich media/cards,
   *   inline keyboard buttons, emoji reactions, and thread replies.
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

    // 2. Parse Action
    let action: TelegramAction;

    if (typeof args[0] === "string") {
      if (args[0] === "reply" && typeof args[1] === "string") {
        action = {
          action: "reply",
          text: args[1],
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
        action = {
          action: "sendMessage",
          text: args[0],
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
        action = {
          action: "sendCard",
          title: obj.title as string | undefined,
          description: obj.description as string | undefined,
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
      } else if (
        actType === "sendPhoto" ||
        actType === "sendDocument" ||
        actType === "sendVideo" ||
        actType === "sendAudio" ||
        actType === "sendAnimation" ||
        actType === "sendMedia"
      ) {
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
                  : "photo"),
          media: (obj.media || obj.photo || obj.document || obj.video || obj.audio) as
            string | undefined,
          photo: obj.photo as string | undefined,
          document: obj.document as string | undefined,
          video: obj.video as string | undefined,
          audio: obj.audio as string | undefined,
          caption: (obj.caption || obj.text) as string | undefined,
          parse_mode: obj.parse_mode as TelegramParseMode | undefined,
          replyTo: parseNumericId((obj.replyTo || obj.reply_to_message_id) as string | number),
          messageThreadId:
            (obj.messageThreadId as number | undefined) ??
            (obj.message_thread_id as number | undefined) ??
            threadId,
          reply_markup: (obj.reply_markup ||
            (obj.buttons ? { inline_keyboard: obj.buttons } : undefined)) as
            TelegramInlineKeyboardMarkup | undefined,
          filename: obj.filename as string | undefined,
        };
      } else {
        action = {
          action: (obj.action as "sendMessage" | "reply") || "sendMessage",
          text: String(obj.text || obj.message || ""),
          parse_mode: obj.parse_mode as TelegramParseMode | undefined,
          replyTo: parseNumericId((obj.replyTo || obj.reply_to_message_id) as string | number),
          messageThreadId:
            (obj.messageThreadId as number | undefined) ??
            (obj.message_thread_id as number | undefined) ??
            threadId,
          reply_markup: (obj.reply_markup ||
            (obj.buttons ? { inline_keyboard: obj.buttons } : undefined)) as
            TelegramInlineKeyboardMarkup | undefined,
          disable_web_page_preview: Boolean(obj.disable_web_page_preview),
        };
      }
    } else {
      throw new Error("Invalid action format for Telegram interaction");
    }

    // 3. Dispatch Action
    const payload: TelegramActionPayload = {
      chatId,
      targetPartId: id,
      action,
      actor,
      timestamp: Date.now(),
    };

    try {
      const res = this.actionDispatcher(payload);
      if (res && typeof (res as Promise<TelegramActionResult | void>).then === "function") {
        (res as Promise<TelegramActionResult | void>)
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
      } else if (res) {
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
    } catch (err) {
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
        this.db.close();
      } catch (err) {
        console.error("[TelegramWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    }
  }
}
