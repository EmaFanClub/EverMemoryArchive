/**
 * @prism-shadow/ema - Telegram World Authorization & Low-Privilege Guardrails
 *
 * Implements strict security & authorization policies for TelegramWorld:
 * 1. ID-only Chat Whitelisting:
 *    - Never trusts mutable chat titles (anyone can create a group with the same title).
 *    - Separates chat permissions into:
 *      * `allowedChatIds`: Full bidirectional conversation (ingest + read + write, e.g. `"-1001234567890"`).
 *      * `writeChatIds`: Allowed outbound targets (includes `allowedChatIds` plus any write-only channels).
 *      * `forwardSourceChatIds`: Read/forward-source-only channels (e.g. public archive channels) —
 *        the bot can forward messages FROM them into `writeChatIds`, but is strictly forbidden from
 *        chatting/spamming INTO them.
 * 2. Pending Chats Tracking (`my_chat_member`):
 *    - When invited to an unwhitelisted group/channel, records it in `pendingChats` (and optional `pending-chats.json`)
 *      without speaking or ingesting messages until explicitly authorized by ID.
 * 3. Low-Privilege Tool Action Boundary (`SAFE_TELEGRAM_TOOL_ACTIONS`):
 *    - Whitelists only safe, non-destructive Bot API actions for companion tool calls.
 *    - Rejects administrative/destructive actions (`banChatMember`, `kickChatMember`, `promoteChatMember`,
 *      `leaveChat`, `setChatPermissions`, `setChatTitle`, `pinChatMessage`, etc.).
 * 4. Per-Chat Rate Limiting (`TelegramRateLimiter`):
 *    - Sliding-window rate limiter (default 20 messages/minute per chat) to prevent spam or runaway loops.
 */

import fs from "node:fs";
import path from "node:path";
import {
  TelegramAuthorizationError,
  TelegramRateLimitError,
  type TelegramAuthorizationConfig,
  type TelegramChatMemberUpdated,
  type TelegramPendingChat,
  type TelegramRateLimitConfig,
  type TelegramSafeToolActionName,
  type TelegramUpdate,
} from "./types.js";

export const SAFE_TELEGRAM_TOOL_ACTIONS: ReadonlySet<TelegramSafeToolActionName> = new Set([
  "get_me",
  "get_chat",
  "get_chat_member_count",
  "get_chat_member",
  "send_message",
  "send_chat_action",
  "forward_messages",
]);

export const FORBIDDEN_TELEGRAM_ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  "banChatMember",
  "kickChatMember",
  "unbanChatMember",
  "restrictChatMember",
  "promoteChatMember",
  "setChatAdministratorCustomTitle",
  "banChatSenderChat",
  "unbanChatSenderChat",
  "setChatPermissions",
  "exportChatInviteLink",
  "createChatInviteLink",
  "editChatInviteLink",
  "revokeChatInviteLink",
  "approveChatJoinRequest",
  "declineChatJoinRequest",
  "setChatPhoto",
  "deleteChatPhoto",
  "setChatTitle",
  "setChatDescription",
  "pinChatMessage",
  "unpinChatMessage",
  "unpinAllChatMessages",
  "leaveChat",
  "deleteMessage",
  "deleteMessages",
]);

/**
 * Normalizes a Telegram chat identifier into a clean string ID (e.g. "-1001234567890").
 * Strips part prefixes ("channel:", "group:", "dm:", "thread:").
 */
export function normalizeTelegramChatId(raw: string | number): string {
  const str = String(raw).trim();
  if (str.startsWith("thread:")) {
    const parts = str.split(":");
    return parts[1] ? parts[1].trim() : str;
  }
  return str.replace(/^(?:telegram:|tg:|channel:|group:|supergroup:|dm:|private:)/i, "").trim();
}

/**
 * Normalizes a Telegram user identifier into a clean string ID or lowercase username.
 */
export function normalizeTelegramUserId(raw: string | number): string {
  return String(raw)
    .trim()
    .replace(/^(?:user:(?:telegram:|tg:)?|telegram:|tg:|dm:|private:)+/i, "")
    .replace(/^@+/, "")
    .trim()
    .toLowerCase();
}

function parseIdList(raw: unknown, normalizer: (id: string | number) => string): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => normalizer(item)).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,;\s]+/)
      .map((s) => normalizer(s.trim()))
      .filter(Boolean);
  }
  return [normalizer(String(raw))].filter(Boolean);
}

/**
 * Per-chat sliding-window rate limiter.
 */
export class TelegramRateLimiter {
  private maxPerMinute: number;
  private windows: Map<string, number[]> = new Map();

  constructor(config?: TelegramRateLimitConfig) {
    this.maxPerMinute = config?.maxPerMinute ?? 20;
  }

  public checkAndRecord(chatId: string | number, now = Date.now()): void {
    if (this.maxPerMinute <= 0) return;
    const key = normalizeTelegramChatId(chatId);
    const cutoff = now - 60_000;
    const existing = (this.windows.get(key) ?? []).filter((t) => t > cutoff);
    if (existing.length >= this.maxPerMinute) {
      this.windows.set(key, existing);
      throw new TelegramRateLimitError(
        `Telegram rate limit exceeded for chat ${key}: max ${this.maxPerMinute} messages per minute`,
      );
    }
    existing.push(now);
    this.windows.set(key, existing);
  }

  public getRecentCount(chatId: string | number, now = Date.now()): number {
    const key = normalizeTelegramChatId(chatId);
    const cutoff = now - 60_000;
    return (this.windows.get(key) ?? []).filter((t) => t > cutoff).length;
  }
}

/**
 * Manages authorization policies for Telegram chats, channels, forward sources, and users.
 */
export class TelegramAuthorizationManager {
  private enabled: boolean;
  private allowedChatIds: Set<string>;
  private writeChatIds: Set<string>;
  private forwardSourceChatIds: Set<string>;
  private allowedUsers: Set<string>;
  private adminUsers: Set<string>;
  private requireUserAuthInChats: boolean;
  private pendingChatsPath?: string;
  private defaultPolicy: "allow" | "deny";
  private pendingChats: Map<string, TelegramPendingChat> = new Map();
  private observedUnauthorizedChats: Map<string, TelegramPendingChat> = new Map();

  constructor(
    config?: TelegramAuthorizationConfig,
    env: Record<string, string | undefined> = process.env,
  ) {
    const envAllowedChats = env.EMA_TELEGRAM_ALLOWED_CHATS;
    const envWriteChats = env.EMA_TELEGRAM_WRITE_CHATS;
    const envForwardChats = env.EMA_TELEGRAM_FORWARD_CHATS;
    const envAllowedUsers = env.EMA_TELEGRAM_ALLOWED_USERS;
    const envAdminUsers = env.EMA_TELEGRAM_ADMIN_USERS;
    const envEnabled = env.EMA_TELEGRAM_AUTH_ENABLED;

    const allowedChats = [
      ...parseIdList(config?.allowedChatIds, normalizeTelegramChatId),
      ...parseIdList(envAllowedChats, normalizeTelegramChatId),
    ];
    const writeChats = [
      ...allowedChats,
      ...parseIdList(config?.writeChatIds, normalizeTelegramChatId),
      ...parseIdList(envWriteChats, normalizeTelegramChatId),
    ];
    const forwardSources = [
      ...parseIdList(config?.forwardSourceChatIds, normalizeTelegramChatId),
      ...parseIdList(envForwardChats, normalizeTelegramChatId),
    ];
    const users = [
      ...parseIdList(config?.allowedUsers, normalizeTelegramUserId),
      ...parseIdList(envAllowedUsers, normalizeTelegramUserId),
    ];
    const admins = [
      ...parseIdList(config?.adminUsers, normalizeTelegramUserId),
      ...parseIdList(envAdminUsers, normalizeTelegramUserId),
    ];

    this.allowedChatIds = new Set(allowedChats);
    this.writeChatIds = new Set(writeChats);
    this.forwardSourceChatIds = new Set(forwardSources);
    this.allowedUsers = new Set(users);
    this.adminUsers = new Set(admins);
    this.requireUserAuthInChats = config?.requireUserAuthInChats ?? false;
    this.pendingChatsPath = config?.pendingChatsPath;

    const hasAnyList =
      this.allowedChatIds.size > 0 ||
      this.writeChatIds.size > 0 ||
      this.forwardSourceChatIds.size > 0 ||
      this.allowedUsers.size > 0 ||
      this.adminUsers.size > 0;

    if (config?.enabled !== undefined) {
      this.enabled = config.enabled;
    } else if (envEnabled !== undefined) {
      this.enabled = envEnabled === "true" || envEnabled === "1";
    } else {
      this.enabled = hasAnyList;
    }

    this.defaultPolicy = config?.defaultPolicy ?? (this.enabled ? "deny" : "allow");
    this.loadPendingChats();
  }

  private loadPendingChats(): void {
    if (!this.pendingChatsPath || !fs.existsSync(this.pendingChatsPath)) return;
    const rawText = fs.readFileSync(this.pendingChatsPath, "utf8");
    const raw = JSON.parse(rawText) as TelegramPendingChat[];
    if (!Array.isArray(raw)) {
      throw new Error(
        `[TelegramAuthorizationManager] Invalid pendingChats JSON in ${this.pendingChatsPath}: expected array`,
      );
    }
    for (const item of raw) {
      if (item && item.chatId) {
        this.pendingChats.set(normalizeTelegramChatId(item.chatId), item);
      }
    }
  }

  private savePendingChats(): void {
    if (!this.pendingChatsPath) return;
    fs.mkdirSync(path.dirname(this.pendingChatsPath), { recursive: true });
    const tmp = `${this.pendingChatsPath}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify(Array.from(this.pendingChats.values()), null, 2) + "\n",
      "utf8",
    );
    fs.renameSync(tmp, this.pendingChatsPath);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isAdmin(userIdOrUsername: string | number | undefined, username?: string): boolean {
    if (userIdOrUsername !== undefined) {
      const norm = normalizeTelegramUserId(userIdOrUsername);
      if (this.adminUsers.has(norm)) return true;
    }
    if (username) {
      const normU = normalizeTelegramUserId(username);
      if (this.adminUsers.has(normU)) return true;
    }
    return false;
  }

  public isAuthorizedUser(userIdOrUsername: string | number | undefined, username?: string): boolean {
    if (!this.enabled) return true;
    if (this.isAdmin(userIdOrUsername, username)) return true;
    if (userIdOrUsername !== undefined) {
      const norm = normalizeTelegramUserId(userIdOrUsername);
      if (this.allowedUsers.has(norm)) return true;
    }
    if (username) {
      const normU = normalizeTelegramUserId(username);
      if (this.allowedUsers.has(normU)) return true;
    }
    if (this.allowedUsers.size === 0 && this.adminUsers.size === 0) {
      return this.defaultPolicy === "allow";
    }
    return false;
  }

  private isDirectUserChatTarget(raw: string | number, normUser: string): boolean {
    const trimmed = String(raw).trim();
    return /^\d+$/.test(normUser) || /^(?:dm:|private:|user:)/i.test(trimmed);
  }

  /**
   * Checks whether the bot is allowed to read metadata/history from a chat ID.
   */
  public canReadChat(chatId: string | number): boolean {
    if (!this.enabled) return true;
    const norm = normalizeTelegramChatId(chatId);
    const normUser = normalizeTelegramUserId(chatId);
    if (
      this.allowedChatIds.has(norm) ||
      this.writeChatIds.has(norm) ||
      this.forwardSourceChatIds.has(norm)
    ) {
      return true;
    }
    if (
      this.isDirectUserChatTarget(chatId, normUser) &&
      (this.allowedUsers.has(normUser) || this.adminUsers.has(normUser))
    ) {
      return true;
    }
    return false;
  }

  /**
   * Checks whether the bot is allowed to send messages / media / chat actions to a chat ID.
   * Note: Forward-source-only channels (`forwardSourceChatIds`) are strictly read-only for the companion.
   */
  public canWriteChat(chatId: string | number): boolean {
    if (!this.enabled) return true;
    const norm = normalizeTelegramChatId(chatId);
    const normUser = normalizeTelegramUserId(chatId);
    if (this.writeChatIds.has(norm) || this.allowedChatIds.has(norm)) {
      return true;
    }
    if (
      this.isDirectUserChatTarget(chatId, normUser) &&
      (this.allowedUsers.has(normUser) || this.adminUsers.has(normUser))
    ) {
      return true;
    }
    return false;
  }

  /**
   * Checks whether the bot is allowed to forward messages FROM a source chat ID.
   */
  public canForwardFromChat(fromChatId: string | number): boolean {
    if (!this.enabled) return true;
    const norm = normalizeTelegramChatId(fromChatId);
    return (
      this.forwardSourceChatIds.has(norm) ||
      this.allowedChatIds.has(norm) ||
      this.writeChatIds.has(norm)
    );
  }

  /**
   * Handles a `my_chat_member` event when the bot is added to or removed from a group/channel.
   * Unwhitelisted chats are recorded in `pendingChats` and never auto-replied to.
   */
  public handleChatMemberUpdate(event: TelegramChatMemberUpdated): {
    status: "whitelisted" | "pending_recorded" | "removed";
    chatId: string;
  } {
    const chatId = normalizeTelegramChatId(event.chat.id);
    const newStatus = event.new_chat_member?.status;

    if (newStatus === "left" || newStatus === "kicked") {
      if (this.pendingChats.delete(chatId)) {
        this.savePendingChats();
      }
      return { status: "removed", chatId };
    }

    if (
      this.allowedChatIds.has(chatId) ||
      this.writeChatIds.has(chatId) ||
      this.forwardSourceChatIds.has(chatId)
    ) {
      if (this.pendingChats.delete(chatId)) {
        this.savePendingChats();
      }
      return { status: "whitelisted", chatId };
    }

    const pending: TelegramPendingChat = {
      chatId,
      title: event.chat.title,
      type: event.chat.type,
      username: event.chat.username,
      invitedBy: event.from?.username || event.from?.first_name || String(event.from?.id || ""),
      firstSeenAt: new Date(event.date ? event.date * 1000 : Date.now()).toISOString(),
    };
    this.pendingChats.set(chatId, pending);
    this.savePendingChats();
    return { status: "pending_recorded", chatId };
  }

  /**
   * Evaluates whether an inbound message/update with normalized chat & sender metadata is authorized.
   * Shared by both Bot API `canIngestUpdate` and MTProto `ingestMtprotoUpdate`.
   */
  public canIngestChatMessage(params: {
    chatId: string | number;
    chatType: "private" | "group" | "supergroup" | "channel";
    chatTitle?: string;
    chatUsername?: string;
    senderId?: string | number;
    senderUsername?: string;
    senderName?: string;
    date?: number;
  }): { authorized: boolean; reason?: string } {
    if (!this.enabled) {
      return { authorized: true };
    }

    const chatId = normalizeTelegramChatId(params.chatId);

    // Private DM chat: allowed if chatId is in allowedChatIds OR sender is an authorized/admin user
    if (params.chatType === "private") {
      if (
        this.allowedChatIds.has(chatId) ||
        this.isAuthorizedUser(params.senderId ?? chatId, params.senderUsername)
      ) {
        return { authorized: true };
      }
      return {
        authorized: false,
        reason: `Inbound DM rejected: Telegram user '${params.senderId ?? chatId}' is not authorized`,
      };
    }

    // Group, Supergroup, or Channel: MUST be in allowedChatIds by numeric ID (never by title!)
    if (!this.allowedChatIds.has(chatId)) {
      if (!this.forwardSourceChatIds.has(chatId) && !this.observedUnauthorizedChats.has(chatId)) {
        this.observedUnauthorizedChats.set(chatId, {
          chatId,
          title: params.chatTitle,
          type: params.chatType,
          username: params.chatUsername,
          invitedBy:
            params.senderUsername ||
            params.senderName ||
            (params.senderId !== undefined ? String(params.senderId) : ""),
          firstSeenAt: new Date(params.date ? params.date * 1000 : Date.now()).toISOString(),
        });
      }
      return {
        authorized: false,
        reason: `Inbound update rejected: Telegram chat '${chatId}' is not in allowedChatIds`,
      };
    }

    if (this.requireUserAuthInChats && params.senderId !== undefined) {
      if (!this.isAuthorizedUser(params.senderId, params.senderUsername)) {
        return {
          authorized: false,
          reason: `Inbound update rejected: user '${params.senderId}' in chat '${chatId}' is not in allowedUsers`,
        };
      }
    }

    return { authorized: true };
  }

  /**
   * Evaluates whether an inbound Telegram update is authorized to be ingested by the companion.
   */
  public canIngestUpdate(update: TelegramUpdate): { authorized: boolean; reason?: string } {
    if (update.my_chat_member) {
      const res = this.handleChatMemberUpdate(update.my_chat_member);
      return {
        authorized: false,
        reason: `my_chat_member lifecycle update handled (${res.status} for chat ${res.chatId})`,
      };
    }

    if (!this.enabled) {
      return { authorized: true };
    }

    const msg =
      update.message ||
      update.channel_post ||
      update.edited_message ||
      update.edited_channel_post ||
      update.callback_query?.message;

    if (!msg?.chat) {
      return { authorized: false, reason: "Update has no chat context" };
    }

    // For callback_query, the acting user is callback_query.from (not msg.from, which is the bot).
    const sender = update.callback_query ? update.callback_query.from : msg.from;
    return this.canIngestChatMessage({
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      chatTitle: msg.chat.title,
      chatUsername: msg.chat.username,
      senderId: sender?.id,
      senderUsername: sender?.username,
      senderName: sender?.first_name,
      date: msg.date,
    });
  }

  /**
   * Evaluates if the companion is authorized to speak / dispatch an action to a target chat.
   */
  public canSpeak(targetChatId: string | number): { authorized: boolean; reason?: string } {
    if (!this.enabled) return { authorized: true };
    if (this.canWriteChat(targetChatId)) {
      return { authorized: true };
    }
    const norm = normalizeTelegramChatId(targetChatId);
    if (this.forwardSourceChatIds.has(norm)) {
      return {
        authorized: false,
        reason: `Speaking refused: Telegram chat '${norm}' is a read/forward-source-only channel`,
      };
    }
    return {
      authorized: false,
      reason: `Speaking refused: Telegram chat '${norm}' is not in writeChatIds or allowedChatIds`,
    };
  }

  /**
   * Asserts that a companion tool action is in the low-privilege whitelist.
   */
  public assertSafeToolAction(actionName: string): TelegramSafeToolActionName {
    const trimmed = String(actionName || "").trim();
    if (FORBIDDEN_TELEGRAM_ADMIN_ACTIONS.has(trimmed)) {
      throw new TelegramAuthorizationError(
        `Telegram tool action '${trimmed}' is forbidden: administrative/destructive operations are blocked by low-privilege policy`,
      );
    }
    if (!SAFE_TELEGRAM_TOOL_ACTIONS.has(trimmed as TelegramSafeToolActionName)) {
      throw new TelegramAuthorizationError(
        `Telegram tool action '${trimmed}' is not in the allowed low-privilege action whitelist (${Array.from(SAFE_TELEGRAM_TOOL_ACTIONS).join(", ")})`,
      );
    }
    return trimmed as TelegramSafeToolActionName;
  }

  public addAllowedChat(chatId: string | number, allowWrite = true): void {
    const norm = normalizeTelegramChatId(chatId);
    this.allowedChatIds.add(norm);
    if (allowWrite) {
      this.writeChatIds.add(norm);
    }
    this.observedUnauthorizedChats.delete(norm);
    if (this.pendingChats.delete(norm)) {
      this.savePendingChats();
    }
  }

  public addForwardSourceChat(chatId: string | number): void {
    this.forwardSourceChatIds.add(normalizeTelegramChatId(chatId));
  }

  public getPendingChats(): TelegramPendingChat[] {
    return Array.from(this.pendingChats.values());
  }

  public getObservedUnauthorizedChats(): TelegramPendingChat[] {
    return Array.from(this.observedUnauthorizedChats.values());
  }

  public getStatus(): {
    enabled: boolean;
    defaultPolicy: "allow" | "deny";
    allowedChatIds: string[];
    writeChatIds: string[];
    forwardSourceChatIds: string[];
    allowedUsers: string[];
    adminUsers: string[];
    pendingChats: TelegramPendingChat[];
    observedUnauthorizedChats: TelegramPendingChat[];
  } {
    return {
      enabled: this.enabled,
      defaultPolicy: this.defaultPolicy,
      allowedChatIds: Array.from(this.allowedChatIds),
      writeChatIds: Array.from(this.writeChatIds),
      forwardSourceChatIds: Array.from(this.forwardSourceChatIds),
      allowedUsers: Array.from(this.allowedUsers),
      adminUsers: Array.from(this.adminUsers),
      pendingChats: this.getPendingChats(),
      observedUnauthorizedChats: this.getObservedUnauthorizedChats(),
    };
  }
}
