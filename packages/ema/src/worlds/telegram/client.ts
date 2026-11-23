/**
 * @prism-shadow/ema - Telegram Bot API Client & Safe Low-Privilege Tool Executor
 *
 * Implements real HTTP Bot API operations for TelegramWorld:
 * - Token normalization (`normalizeBotToken`: strips non-digit prefixes before `<bot_id>:<secret>`)
 * - Message splitting (`splitTelegramMessage`: splits >4000 char texts on line/word boundaries)
 * - Bot identity & chat introspection (`getMe`, `getChat`, `getChatMember`, `getChatMemberCount`)
 * - Update polling (`getUpdates` with `message`, `channel_post`, `my_chat_member`, etc.)
 * - Text & rich message delivery (`sendMessage`, `sendChatAction`, `setMessageReaction`)
 * - Single media & local file upload (`sendPhoto`, `sendDocument`, `sendVideo`, `sendAudio`, `sendAnimation`
 *   with `FormData`, `allowedMediaDirs` enforcement, `has_spoiler`, custom `filename`)
 * - Multi-photo album delivery (`sendMediaGroup` with >10 auto-chunking, local file `attach://fileN`, `has_spoiler`)
 * - Message forwarding, deletion, and delivery probing (`forwardMessages`, `deleteMessage`, `verifyDelivered`)
 * - Low-privilege `executeSafeToolCall` enforcing `TelegramAuthorizationManager`, `TelegramRateLimiter`,
 *   and `checkTelegramContentFilter`.
 */

import fs from "node:fs";
import path from "node:path";
import {
  TelegramAuthorizationError,
  type TelegramChat,
  type TelegramChatMember,
  type TelegramContentFilterConfig,
  type TelegramInlineKeyboardMarkup,
  type TelegramMediaGroupItem,
  type TelegramMessage,
  type TelegramParseMode,
  type TelegramSafeToolRequest,
  type TelegramUpdate,
  type TelegramUser,
} from "./types.js";
import {
  TelegramAuthorizationManager,
  TelegramRateLimiter,
  normalizeTelegramChatId,
} from "./authorization.js";
import { checkTelegramContentFilter } from "./filter.js";

export const MAX_TELEGRAM_TEXT_LENGTH = 4000;
export const MAX_TELEGRAM_MEDIA_GROUP_SIZE = 10;

const ALLOWED_CHAT_ACTIONS = new Set([
  "typing",
  "upload_photo",
  "record_video",
  "upload_video",
  "record_voice",
  "upload_voice",
  "upload_document",
  "choose_sticker",
  "find_location",
]);

/**
 * Strips any leading non-digit label prefix before `<bot_id>:<secret>`
 * (e.g. `mybot123456789:AAF...` -> `123456789:AAF...`).
 */
export function normalizeBotToken(raw: string): string {
  const trimmed = String(raw || "").trim();
  const match = /^[^0-9]*(\d+:[A-Za-z0-9_-]+)$/.exec(trimmed);
  if (!match) {
    throw new Error(
      "[TelegramClient] Invalid Telegram bot token format: expected <digits>:<alphanumeric>",
    );
  }
  return match[1];
}

/**
 * Splits a long Telegram message into chunks of at most `maxLen` characters,
 * preferring newline and whitespace boundaries.
 */
export function splitTelegramMessage(
  text: string,
  maxLen: number = MAX_TELEGRAM_TEXT_LENGTH,
): string[] {
  const cleaned = String(text || "");
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks: string[] = [];
  let rest = cleaned;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen / 2) cut = rest.lastIndexOf(" ", maxLen);
    if (cut < maxLen / 2) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function looksLikeLocalFilePath(target: string): boolean {
  const s = String(target || "").trim();
  if (!s || /^https?:\/\//i.test(s) || /^attach:\/\//i.test(s)) return false;
  return (
    s.startsWith("/") ||
    s.startsWith("./") ||
    s.startsWith("../") ||
    s.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(s) ||
    s.includes("/") ||
    s.includes("\\")
  );
}

export interface TelegramClientOptions {
  botToken: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  allowedMediaDirs?: string[];
}

export class TelegramClient {
  public readonly token: string;
  public readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly allowedMediaDirs: string[];

  constructor(options: TelegramClientOptions | string) {
    const opts = typeof options === "string" ? { botToken: options } : options;
    this.token = normalizeBotToken(opts.botToken);
    const apiRoot = (opts.apiBaseUrl || "https://api.telegram.org").replace(/\/$/, "");
    this.baseUrl = `${apiRoot}/bot${this.token}`;
    this.fetchFn = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.allowedMediaDirs = (opts.allowedMediaDirs ?? [])
      .map((d) => String(d).trim())
      .filter(Boolean)
      .map((d) => {
        const resolved = path.resolve(d);
        try {
          return fs.realpathSync(resolved);
        } catch {
          return resolved;
        }
      });
  }

  private redactToken(text: string): string {
    if (!text) return "";
    return text.split(`bot${this.token}`).join("bot[REDACTED]").split(this.token).join("[REDACTED]");
  }

  /**
   * Resolves whether `media` is a local file upload or a remote URL / Telegram file_id.
   * Local filesystem uploads are strictly gated by `allowedMediaDirs`.
   */
  private resolveLocalMediaPath(media: string): string | null {
    const target = String(media || "").trim();
    if (!target) {
      throw new Error("[TelegramClient] Media path/URL/file_id must not be empty");
    }
    if (/^https?:\/\//i.test(target)) {
      return null;
    }

    const exists = fs.existsSync(target);
    if (!exists && !looksLikeLocalFilePath(target)) {
      // Treat as Telegram file_id
      return null;
    }

    if (this.allowedMediaDirs.length === 0) {
      throw new TelegramAuthorizationError(
        `Local media file upload blocked for '${target}': allowedMediaDirs is not configured`,
      );
    }

    if (!exists) {
      throw new TelegramAuthorizationError(
        `Local media file not found or not accessible: '${target}'`,
      );
    }

    const realFile = fs.realpathSync(path.resolve(target));
    const stat = fs.statSync(realFile);
    if (!stat.isFile()) {
      throw new TelegramAuthorizationError(`Local media path is not a regular file: '${target}'`);
    }

    const isAllowed = this.allowedMediaDirs.some((allowedRoot) => {
      const rel = path.relative(allowedRoot, realFile);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    });

    if (!isAllowed) {
      throw new TelegramAuthorizationError(
        `Local media file upload blocked: '${target}' is outside allowedMediaDirs`,
      );
    }

    return realFile;
  }

  private async parseTelegramResponse<T>(method: string, res: Response): Promise<T> {
    const rawText = await res.text();
    let data: {
      ok?: boolean;
      result?: T;
      error_code?: number;
      description?: string;
    };
    try {
      data = JSON.parse(rawText);
    } catch {
      const snippet = this.redactToken(rawText).slice(0, 200);
      throw new Error(
        `Telegram ${method} failed (HTTP ${res.status} ${res.statusText}): non-JSON response${snippet ? ` (${snippet})` : ""}`,
      );
    }

    if (!res.ok || !data?.ok) {
      const desc = this.redactToken(String(data?.description ?? res.statusText ?? "Unknown error"));
      throw new Error(`Telegram ${method} failed (${data?.error_code ?? res.status}): ${desc}`);
    }
    return data.result as T;
  }

  public async callJson<T = unknown>(
    method: string,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      throw new Error(
        `Telegram ${method} network error: ${this.redactToken(err instanceof Error ? err.message : String(err))}`,
      );
    }
    return this.parseTelegramResponse<T>(method, res);
  }

  public async callForm<T = unknown>(method: string, form: FormData): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/${method}`, {
        method: "POST",
        body: form,
      });
    } catch (err: any) {
      throw new Error(
        `Telegram ${method} network error: ${this.redactToken(err instanceof Error ? err.message : String(err))}`,
      );
    }
    return this.parseTelegramResponse<T>(method, res);
  }

  public async getMe(): Promise<TelegramUser> {
    return this.callJson<TelegramUser>("getMe");
  }

  public async getUpdates(offset = 0, timeoutSec = 2): Promise<TelegramUpdate[]> {
    return this.callJson<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: timeoutSec,
      allowed_updates: [
        "message",
        "edited_message",
        "channel_post",
        "edited_channel_post",
        "callback_query",
        "my_chat_member",
      ],
    });
  }

  public async getChat(chatId: string | number): Promise<TelegramChat> {
    return this.callJson<TelegramChat>("getChat", { chat_id: chatId });
  }

  public async getChatMemberCount(chatId: string | number): Promise<number> {
    return this.callJson<number>("getChatMemberCount", { chat_id: chatId });
  }

  public async getChatMember(
    chatId: string | number,
    userId: string | number,
  ): Promise<TelegramChatMember> {
    return this.callJson<TelegramChatMember>("getChatMember", {
      chat_id: chatId,
      user_id: typeof userId === "string" && /^\d+$/.test(userId) ? Number(userId) : userId,
    });
  }

  public async sendChatAction(
    chatId: string | number,
    action:
      | "typing"
      | "upload_photo"
      | "record_video"
      | "upload_video"
      | "record_voice"
      | "upload_voice"
      | "upload_document"
      | "choose_sticker"
      | "find_location" = "typing",
  ): Promise<boolean> {
    if (!ALLOWED_CHAT_ACTIONS.has(action)) {
      throw new Error(`[TelegramClient] Invalid chat action: '${action}'`);
    }
    return this.callJson<boolean>("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }

  /**
   * Sends a text message, automatically splitting texts > 4000 characters into sequential chunks.
   */
  public async sendMessage(params: {
    chatId: string | number;
    text: string;
    parseMode?: TelegramParseMode;
    replyToMessageId?: number;
    messageThreadId?: number;
    replyMarkup?: TelegramInlineKeyboardMarkup;
    disableWebPagePreview?: boolean;
  }): Promise<TelegramMessage[]> {
    const chunks = splitTelegramMessage(params.text);
    const sent: TelegramMessage[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const payload: Record<string, unknown> = {
        chat_id: params.chatId,
        text: chunks[i],
      };
      if (params.parseMode) {
        payload.parse_mode = params.parseMode;
      }
      if (i === 0 && params.replyToMessageId !== undefined) {
        payload.reply_parameters = {
          message_id: params.replyToMessageId,
          allow_sending_without_reply: true,
        };
      }
      if (params.messageThreadId !== undefined) {
        payload.message_thread_id = params.messageThreadId;
      }
      if (i === chunks.length - 1 && params.replyMarkup) {
        payload.reply_markup = params.replyMarkup;
      }
      if (params.disableWebPagePreview) {
        payload.link_preview_options = { is_disabled: true };
      }
      const msg = await this.callJson<TelegramMessage>("sendMessage", payload);
      sent.push(msg);
    }
    return sent;
  }

  private async sendSingleMediaField(params: {
    method: "sendPhoto" | "sendDocument" | "sendVideo" | "sendAudio" | "sendAnimation";
    fieldName: "photo" | "document" | "video" | "audio" | "animation";
    chatId: string | number;
    media: string;
    caption?: string;
    parseMode?: TelegramParseMode;
    hasSpoiler?: boolean;
    supportsSpoiler?: boolean;
    filename?: string;
    replyToMessageId?: number;
    messageThreadId?: number;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    const localPath = this.resolveLocalMediaPath(params.media);

    if (localPath) {
      const form = new FormData();
      form.append("chat_id", String(params.chatId));
      const buf = fs.readFileSync(localPath);
      const uploadName = params.filename || path.basename(localPath);
      const blob = new Blob([buf], { type: guessMimeType(localPath) });
      form.append(params.fieldName, blob, uploadName);
      if (params.caption) form.append("caption", params.caption);
      if (params.parseMode) form.append("parse_mode", params.parseMode);
      if (params.supportsSpoiler && params.hasSpoiler) form.append("has_spoiler", "true");
      if (params.replyToMessageId !== undefined) {
        form.append(
          "reply_parameters",
          JSON.stringify({
            message_id: params.replyToMessageId,
            allow_sending_without_reply: true,
          }),
        );
      }
      if (params.messageThreadId !== undefined) {
        form.append("message_thread_id", String(params.messageThreadId));
      }
      if (params.replyMarkup) {
        form.append("reply_markup", JSON.stringify(params.replyMarkup));
      }
      return this.callForm<TelegramMessage>(params.method, form);
    }

    const payload: Record<string, unknown> = {
      chat_id: params.chatId,
      [params.fieldName]: params.media,
    };
    if (params.caption) payload.caption = params.caption;
    if (params.parseMode) payload.parse_mode = params.parseMode;
    if (params.supportsSpoiler && params.hasSpoiler) payload.has_spoiler = true;
    if (params.replyToMessageId !== undefined) {
      payload.reply_parameters = {
        message_id: params.replyToMessageId,
        allow_sending_without_reply: true,
      };
    }
    if (params.messageThreadId !== undefined) {
      payload.message_thread_id = params.messageThreadId;
    }
    if (params.replyMarkup) {
      payload.reply_markup = params.replyMarkup;
    }
    return this.callJson<TelegramMessage>(params.method, payload);
  }

  /**
   * Sends a single photo by URL, Telegram file_id, or allowlisted local file path (multipart FormData).
   */
  public async sendPhoto(params: {
    chatId: string | number;
    photo: string;
    caption?: string;
    parseMode?: TelegramParseMode;
    hasSpoiler?: boolean;
    filename?: string;
    replyToMessageId?: number;
    messageThreadId?: number;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    return this.sendSingleMediaField({
      method: "sendPhoto",
      fieldName: "photo",
      chatId: params.chatId,
      media: params.photo,
      caption: params.caption,
      parseMode: params.parseMode,
      hasSpoiler: params.hasSpoiler,
      supportsSpoiler: true,
      filename: params.filename,
      replyToMessageId: params.replyToMessageId,
      messageThreadId: params.messageThreadId,
      replyMarkup: params.replyMarkup,
    });
  }

  public async sendDocument(params: {
    chatId: string | number;
    document: string;
    caption?: string;
    parseMode?: TelegramParseMode;
    filename?: string;
    replyToMessageId?: number;
    messageThreadId?: number;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    return this.sendSingleMediaField({
      method: "sendDocument",
      fieldName: "document",
      chatId: params.chatId,
      media: params.document,
      caption: params.caption,
      parseMode: params.parseMode,
      filename: params.filename,
      replyToMessageId: params.replyToMessageId,
      messageThreadId: params.messageThreadId,
      replyMarkup: params.replyMarkup,
    });
  }

  public async sendVideo(params: {
    chatId: string | number;
    video: string;
    caption?: string;
    parseMode?: TelegramParseMode;
    hasSpoiler?: boolean;
    filename?: string;
    replyToMessageId?: number;
    messageThreadId?: number;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    return this.sendSingleMediaField({
      method: "sendVideo",
      fieldName: "video",
      chatId: params.chatId,
      media: params.video,
      caption: params.caption,
      parseMode: params.parseMode,
      hasSpoiler: params.hasSpoiler,
      supportsSpoiler: true,
      filename: params.filename,
      replyToMessageId: params.replyToMessageId,
      messageThreadId: params.messageThreadId,
      replyMarkup: params.replyMarkup,
    });
  }

  public async sendAudio(params: {
    chatId: string | number;
    audio: string;
    caption?: string;
    parseMode?: TelegramParseMode;
    filename?: string;
    replyToMessageId?: number;
    messageThreadId?: number;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    return this.sendSingleMediaField({
      method: "sendAudio",
      fieldName: "audio",
      chatId: params.chatId,
      media: params.audio,
      caption: params.caption,
      parseMode: params.parseMode,
      filename: params.filename,
      replyToMessageId: params.replyToMessageId,
      messageThreadId: params.messageThreadId,
      replyMarkup: params.replyMarkup,
    });
  }

  public async sendAnimation(params: {
    chatId: string | number;
    animation: string;
    caption?: string;
    parseMode?: TelegramParseMode;
    hasSpoiler?: boolean;
    filename?: string;
    replyToMessageId?: number;
    messageThreadId?: number;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessage> {
    return this.sendSingleMediaField({
      method: "sendAnimation",
      fieldName: "animation",
      chatId: params.chatId,
      media: params.animation,
      caption: params.caption,
      parseMode: params.parseMode,
      hasSpoiler: params.hasSpoiler,
      supportsSpoiler: true,
      filename: params.filename,
      replyToMessageId: params.replyToMessageId,
      messageThreadId: params.messageThreadId,
      replyMarkup: params.replyMarkup,
    });
  }

  /**
   * Sends a multi-photo / multi-media album (`sendMediaGroup`), automatically chunking
   * albums with > 10 items into batches of 10 (and falling back to `sendPhoto` if a
   * trailing chunk has only 1 item). Supports allowlisted local files (`attach://fileN`) and URLs.
   */
  public async sendMediaGroup(params: {
    chatId: string | number;
    items: TelegramMediaGroupItem[];
    caption?: string;
    parseMode?: TelegramParseMode;
    hasSpoiler?: boolean;
    replyToMessageId?: number;
    messageThreadId?: number;
  }): Promise<TelegramMessage[]> {
    if (!Array.isArray(params.items) || params.items.length === 0) {
      throw new Error("[TelegramClient] sendMediaGroup requires at least 1 media item");
    }

    const allSent: TelegramMessage[] = [];
    for (let offset = 0; offset < params.items.length; offset += MAX_TELEGRAM_MEDIA_GROUP_SIZE) {
      const chunk = params.items.slice(offset, offset + MAX_TELEGRAM_MEDIA_GROUP_SIZE);
      const isFirstChunk = offset === 0;

      if (chunk.length === 1) {
        const single = chunk[0];
        const caption = single.caption ?? (isFirstChunk ? params.caption : undefined);
        const mediaType = single.type || "photo";
        let msg: TelegramMessage;
        if (mediaType === "video") {
          msg = await this.sendVideo({
            chatId: params.chatId,
            video: single.media,
            caption,
            parseMode: single.parse_mode ?? params.parseMode,
            hasSpoiler: single.has_spoiler ?? params.hasSpoiler,
            filename: single.filename,
            replyToMessageId: isFirstChunk ? params.replyToMessageId : undefined,
            messageThreadId: params.messageThreadId,
          });
        } else if (mediaType === "document") {
          msg = await this.sendDocument({
            chatId: params.chatId,
            document: single.media,
            caption,
            parseMode: single.parse_mode ?? params.parseMode,
            filename: single.filename,
            replyToMessageId: isFirstChunk ? params.replyToMessageId : undefined,
            messageThreadId: params.messageThreadId,
          });
        } else if (mediaType === "audio") {
          msg = await this.sendAudio({
            chatId: params.chatId,
            audio: single.media,
            caption,
            parseMode: single.parse_mode ?? params.parseMode,
            filename: single.filename,
            replyToMessageId: isFirstChunk ? params.replyToMessageId : undefined,
            messageThreadId: params.messageThreadId,
          });
        } else {
          msg = await this.sendPhoto({
            chatId: params.chatId,
            photo: single.media,
            caption,
            parseMode: single.parse_mode ?? params.parseMode,
            hasSpoiler: single.has_spoiler ?? params.hasSpoiler,
            filename: single.filename,
            replyToMessageId: isFirstChunk ? params.replyToMessageId : undefined,
            messageThreadId: params.messageThreadId,
          });
        }
        allSent.push(msg);
        continue;
      }

      const resolvedLocalPaths = chunk.map((item) => this.resolveLocalMediaPath(item.media));
      const hasLocalFile = resolvedLocalPaths.some((p) => p !== null);

      if (hasLocalFile) {
        const form = new FormData();
        form.append("chat_id", String(params.chatId));
        if (isFirstChunk && params.replyToMessageId !== undefined) {
          form.append(
            "reply_parameters",
            JSON.stringify({
              message_id: params.replyToMessageId,
              allow_sending_without_reply: true,
            }),
          );
        }
        if (params.messageThreadId !== undefined) {
          form.append("message_thread_id", String(params.messageThreadId));
        }

        const mediaDescriptor = chunk.map((item, idx) => {
          const localPath = resolvedLocalPaths[idx];
          let mediaRef = item.media;
          if (localPath) {
            const field = `file${idx}`;
            const buf = fs.readFileSync(localPath);
            const uploadName = item.filename || path.basename(localPath);
            const blob = new Blob([buf], { type: guessMimeType(localPath) });
            form.append(field, blob, uploadName);
            mediaRef = `attach://${field}`;
          }
          const itemCaption =
            item.caption ?? (isFirstChunk && idx === 0 ? params.caption : undefined);
          const itemParseMode = item.parse_mode ?? params.parseMode;
          const itemSpoiler = item.has_spoiler ?? params.hasSpoiler;

          return {
            type: item.type || "photo",
            media: mediaRef,
            ...(itemCaption ? { caption: itemCaption } : {}),
            ...(itemCaption && itemParseMode ? { parse_mode: itemParseMode } : {}),
            ...(itemSpoiler ? { has_spoiler: true } : {}),
          };
        });

        form.append("media", JSON.stringify(mediaDescriptor));
        const sentBatch = await this.callForm<TelegramMessage[]>("sendMediaGroup", form);
        allSent.push(...sentBatch);
      } else {
        const mediaDescriptor = chunk.map((item, idx) => {
          const itemCaption =
            item.caption ?? (isFirstChunk && idx === 0 ? params.caption : undefined);
          const itemParseMode = item.parse_mode ?? params.parseMode;
          const itemSpoiler = item.has_spoiler ?? params.hasSpoiler;

          return {
            type: item.type || "photo",
            media: item.media,
            ...(itemCaption ? { caption: itemCaption } : {}),
            ...(itemCaption && itemParseMode ? { parse_mode: itemParseMode } : {}),
            ...(itemSpoiler ? { has_spoiler: true } : {}),
          };
        });

        const payload: Record<string, unknown> = {
          chat_id: params.chatId,
          media: mediaDescriptor,
        };
        if (isFirstChunk && params.replyToMessageId !== undefined) {
          payload.reply_parameters = {
            message_id: params.replyToMessageId,
            allow_sending_without_reply: true,
          };
        }
        if (params.messageThreadId !== undefined) {
          payload.message_thread_id = params.messageThreadId;
        }
        const sentBatch = await this.callJson<TelegramMessage[]>("sendMediaGroup", payload);
        allSent.push(...sentBatch);
      }
    }

    return allSent;
  }

  public async setMessageReaction(params: {
    chatId: string | number;
    messageId: number;
    emoji: string | string[];
    isBig?: boolean;
  }): Promise<boolean> {
    const emojis = Array.isArray(params.emoji) ? params.emoji : [params.emoji];
    return this.callJson<boolean>("setMessageReaction", {
      chat_id: params.chatId,
      message_id: params.messageId,
      reaction: emojis.map((e) => ({ type: "emoji", emoji: e })),
      is_big: Boolean(params.isBig),
    });
  }

  /**
   * Forwards one or more messages from `fromChatId` to `toChatId`.
   * Returns the array of new `message_id`s in `toChatId`.
   */
  public async forwardMessages(
    fromChatId: string | number,
    toChatId: string | number,
    messageIds: Array<number | string>,
  ): Promise<number[]> {
    const numericIds = messageIds
      .map((id) => (typeof id === "number" ? id : parseInt(String(id), 10)))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);

    if (numericIds.length === 0) {
      throw new Error("[TelegramClient] forwardMessages requires at least one positive message_id");
    }

    if (numericIds.length === 1) {
      const msg = await this.callJson<TelegramMessage>("forwardMessage", {
        chat_id: toChatId,
        from_chat_id: fromChatId,
        message_id: numericIds[0],
      });
      return [msg.message_id];
    }

    const res = await this.callJson<Array<{ message_id: number }>>("forwardMessages", {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_ids: numericIds,
    });
    return res.map((r) => r.message_id);
  }

  public async deleteMessage(chatId: string | number, messageId: number | string): Promise<boolean> {
    const numId = typeof messageId === "number" ? messageId : parseInt(String(messageId), 10);
    return this.callJson<boolean>("deleteMessage", {
      chat_id: chatId,
      message_id: numId,
    });
  }

  /**
   * Verifies that `messageId` exists in `chatId` by forwarding it to `probeChatId` (defaults to `chatId`)
   * and immediately deleting the forwarded probe copy.
   */
  public async verifyDelivered(
    chatId: string | number,
    messageId: number | string,
    probeChatId?: string | number,
    onProbeSent?: (targetProbeChatId: string | number, probeMessageId: number) => void,
  ): Promise<{ verified: boolean; probeMessageId?: number; error?: string }> {
    const targetProbe = probeChatId ?? chatId;
    try {
      const [forwardedId] = await this.forwardMessages(chatId, targetProbe, [messageId]);
      if (forwardedId) {
        onProbeSent?.(targetProbe, forwardedId);
        await this.deleteMessage(targetProbe, forwardedId).catch(() => {});
      }
      return { verified: true, probeMessageId: forwardedId };
    } catch (err: any) {
      return {
        verified: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Executes a low-privilege companion tool request (`telegram_api`) with strict
   * authorization, rate limiting, and outbound privacy filtering.
   */
  public async executeSafeToolCall(
    req: TelegramSafeToolRequest,
    authManager: TelegramAuthorizationManager,
    rateLimiter?: TelegramRateLimiter,
    filterConfig?: TelegramContentFilterConfig,
    bannedWords: string[] = [],
    bannedWordAction: "reject" | "mask" = "reject",
  ): Promise<unknown> {
    const action = authManager.assertSafeToolAction(req.action);

    switch (action) {
      case "get_me": {
        return this.getMe();
      }

      case "get_chat": {
        if (req.chat_id === undefined) {
          throw new Error("get_chat requires chat_id");
        }
        const chatId = normalizeTelegramChatId(req.chat_id);
        if (!authManager.canReadChat(chatId)) {
          throw new TelegramAuthorizationError(
            `Chat ${chatId} is not in the authorized read/write/forward whitelist`,
          );
        }
        return this.getChat(chatId);
      }

      case "get_chat_member_count": {
        if (req.chat_id === undefined) {
          throw new Error("get_chat_member_count requires chat_id");
        }
        const chatId = normalizeTelegramChatId(req.chat_id);
        if (!authManager.canReadChat(chatId)) {
          throw new TelegramAuthorizationError(
            `Chat ${chatId} is not in the authorized read/write/forward whitelist`,
          );
        }
        const count = await this.getChatMemberCount(chatId);
        return { chat_id: chatId, member_count: count };
      }

      case "get_chat_member": {
        if (req.chat_id === undefined || req.user_id === undefined) {
          throw new Error("get_chat_member requires chat_id and user_id");
        }
        const chatId = normalizeTelegramChatId(req.chat_id);
        if (!authManager.canReadChat(chatId)) {
          throw new TelegramAuthorizationError(
            `Chat ${chatId} is not in the authorized read/write/forward whitelist`,
          );
        }
        return this.getChatMember(chatId, req.user_id);
      }

      case "send_chat_action": {
        if (req.chat_id === undefined) {
          throw new Error("send_chat_action requires chat_id");
        }
        const chatId = normalizeTelegramChatId(req.chat_id);
        if (!authManager.canWriteChat(chatId)) {
          throw new TelegramAuthorizationError(
            `Chat ${chatId} is not in the write whitelist (cannot send chat action)`,
          );
        }
        const chatAction = req.chat_action ?? "typing";
        if (!ALLOWED_CHAT_ACTIONS.has(chatAction)) {
          throw new Error(`Invalid chat_action: '${chatAction}'`);
        }
        await this.sendChatAction(chatId, chatAction);
        return { ok: true, chat_id: chatId, action: chatAction };
      }

      case "send_message": {
        if (req.chat_id === undefined) {
          throw new Error("send_message requires chat_id");
        }
        const chatId = normalizeTelegramChatId(req.chat_id);
        if (!authManager.canWriteChat(chatId)) {
          throw new TelegramAuthorizationError(
            `Chat ${chatId} is not in the write whitelist (cannot send message)`,
          );
        }
        const rawText = String(req.text ?? "").trim();
        if (!rawText) {
          throw new Error("send_message requires non-empty text");
        }
        const filteredText = checkTelegramContentFilter(
          rawText,
          filterConfig,
          bannedWords,
          bannedWordAction,
        );
        rateLimiter?.checkAndRecord(chatId);
        const sent = await this.sendMessage({
          chatId,
          text: filteredText,
          replyToMessageId: req.reply_to_message_id,
        });
        return {
          sent_count: sent.length,
          message_ids: sent.map((m) => m.message_id),
        };
      }

      case "forward_messages": {
        if (req.from_chat_id === undefined || req.to_chat_id === undefined) {
          throw new Error("forward_messages requires from_chat_id and to_chat_id");
        }
        const fromChatId = normalizeTelegramChatId(req.from_chat_id);
        const toChatId = normalizeTelegramChatId(req.to_chat_id);
        if (!authManager.canForwardFromChat(fromChatId)) {
          throw new TelegramAuthorizationError(
            `Source chat ${fromChatId} is not in the authorized forward-source whitelist`,
          );
        }
        if (!authManager.canWriteChat(toChatId)) {
          throw new TelegramAuthorizationError(
            `Target chat ${toChatId} is not in the authorized write whitelist`,
          );
        }
        if (
          !Array.isArray(req.message_ids) ||
          req.message_ids.length === 0 ||
          req.message_ids.length > 20
        ) {
          throw new Error("forward_messages requires 1 to 20 message_ids");
        }
        rateLimiter?.checkAndRecord(toChatId);
        const forwardedIds = await this.forwardMessages(fromChatId, toChatId, req.message_ids);
        return {
          forwarded_count: forwardedIds.length,
          message_ids: forwardedIds,
        };
      }
    }
  }
}
