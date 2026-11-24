/**
 * @prism-shadow/ema - Telegram World Types, Helpers & Error Classes
 *
 * Conforms to:
 * - RFC-0001 (Ema Worlds and Actors)
 * - RFC-0002 (Social Media Channel Architecture)
 */

import type { EmaActor, EmaCtx, EmaInput, EmaWorldPart } from "../../interfaces.js";

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
  description?: string;
  is_forum?: boolean;
}

export interface TelegramChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked" | string;
  user: TelegramUser;
  is_anonymous?: boolean;
  custom_title?: string;
}

export interface TelegramChatMemberUpdated {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: TelegramChatMember;
  new_chat_member: TelegramChatMember;
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
  edit_date?: number; // Unix timestamp in seconds
  chat: TelegramChat;
  forward_from?: TelegramUser;
  forward_from_chat?: TelegramChat;
  forward_from_message_id?: number;
  forward_date?: number;
  reply_to_message?: TelegramMessage;
  text?: string;
  entities?: TelegramMessageEntity[];
  caption?: string;
  caption_entities?: TelegramMessageEntity[];
  has_media_spoiler?: boolean;
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
  my_chat_member?: TelegramChatMemberUpdated;
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

export interface TelegramMediaGroupItem {
  type?: "photo" | "video" | "document" | "audio";
  media: string;
  caption?: string;
  parse_mode?: TelegramParseMode;
  has_spoiler?: boolean;
  filename?: string;
}

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
  has_spoiler?: boolean;
  hasSpoiler?: boolean;
  reply_to_message_id?: number | string;
  replyTo?: number | string;
  message_thread_id?: number;
  messageThreadId?: number;
  reply_markup?: TelegramInlineKeyboardMarkup;
  filename?: string;
}

export interface TelegramSendMediaGroupAction {
  action: "sendMediaGroup";
  items: TelegramMediaGroupItem[];
  caption?: string;
  parse_mode?: TelegramParseMode;
  has_spoiler?: boolean;
  hasSpoiler?: boolean;
  reply_to_message_id?: number | string;
  replyTo?: number | string;
  message_thread_id?: number;
  messageThreadId?: number;
}

export interface TelegramForwardMessagesAction {
  action: "forwardMessages" | "forwardMessage";
  fromChatId: string | number;
  messageIds: Array<number | string>;
}

export interface TelegramDeleteMessageAction {
  action: "deleteMessage";
  messageId: number | string;
}

export interface TelegramVerifyDeliveredAction {
  action: "verifyDelivered";
  messageId: number | string;
  probeChatId?: string | number;
}

export interface TelegramSendChatAction {
  action: "sendChatAction";
  chatAction:
    | "typing"
    | "upload_photo"
    | "record_video"
    | "upload_video"
    | "record_voice"
    | "upload_voice"
    | "upload_document"
    | "choose_sticker"
    | "find_location";
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
  | TelegramSendMediaGroupAction
  | TelegramForwardMessagesAction
  | TelegramDeleteMessageAction
  | TelegramVerifyDeliveredAction
  | TelegramSendChatAction
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
  messageIds?: number[];
  rawResult?: unknown;
  error?: string;
}

export interface TelegramPendingChat {
  chatId: string;
  title?: string;
  type: string;
  username?: string;
  invitedBy?: string;
  firstSeenAt: string;
}

export interface TelegramAuthorizationConfig {
  /** Enables authorization enforcement (default: true if any chat/user whitelist is provided) */
  enabled?: boolean;
  /** Chat IDs where the companion can read, ingest updates, and converse/speak (e.g. ["-1001234567890"]) */
  allowedChatIds?: Array<string | number>;
  /** Write-allowed chat IDs (defaults to allowedChatIds + any additional write-only channels) */
  writeChatIds?: Array<string | number>;
  /** Read/forward-source-only chat IDs (e.g. public archive channels the bot can forward FROM, never spam INTO) */
  forwardSourceChatIds?: Array<string | number>;
  /** Allowed user IDs for DM or restricted group interaction */
  allowedUsers?: Array<string | number>;
  /** Admin / owner user IDs (e.g. [123456789, "owner_handle"]) */
  adminUsers?: Array<string | number>;
  /** Whether users inside an allowed group/channel must also be in allowedUsers (default: false) */
  requireUserAuthInChats?: boolean;
  /** Path to persist pending unwhitelisted chats discovered via my_chat_member */
  pendingChatsPath?: string;
  /** Default policy when lists are empty ("allow" | "deny") */
  defaultPolicy?: "allow" | "deny";
}

export interface TelegramContentFilterConfig {
  /** Enables content filtering and host privacy guardrails (default: true) */
  enabled?: boolean;
  /** Action when prohibited content is detected: "reject" throws error, "mask" redacts (default: "reject") */
  action?: "reject" | "mask";
  /** Filter out local machine filesystem paths (default: true) */
  filterLocalPaths?: boolean;
  /** Filter out localhost and private network addresses (default: true) */
  filterLocalhost?: boolean;
  /** Filter out credentials, API keys, tokens, and secrets (default: true) */
  filterSecrets?: boolean;
  /** Filter out harness system markers (default: true) */
  filterSystemMarkers?: boolean;
}

export interface TelegramRateLimitConfig {
  /** Maximum outbound messages per minute per chat (default: 20) */
  maxPerMinute?: number;
}

export type TelegramSafeToolActionName =
  | "get_me"
  | "get_chat"
  | "get_chat_member_count"
  | "get_chat_member"
  | "send_message"
  | "send_chat_action"
  | "forward_messages";

export interface TelegramSafeToolRequest {
  action: TelegramSafeToolActionName | string;
  chat_id?: string | number;
  user_id?: string | number;
  text?: string;
  reply_to_message_id?: number;
  chat_action?: "typing" | "upload_photo" | "record_video" | "record_voice" | "upload_document";
  from_chat_id?: string | number;
  to_chat_id?: string | number;
  message_ids?: number[];
}

export interface TelegramBotIndexEntry {
  v: 1;
  ts: string;
  msg_id: number;
  chat_id: number | string;
  chat_title: string;
  chat_type: string;
  dir: "in" | "out";
  from_id?: number | string;
  from_username?: string;
  from_name?: string;
  reply_to_msg_id?: number;
  text: string;
  media?: string;
  views?: string;
  artwork_id?: number;
  artwork_title?: string;
  author?: string;
  author_id?: number;
  tags?: string[];
  page_count?: number;
  r18?: boolean;
}

export interface TelegramChatIndexMeta {
  alias: string;
  title: string;
  type: string;
  username?: string;
  channel?: string;
  last_msg_at: string;
  last_msg_id: number;
  total_messages?: number;
}

export interface TelegramOpsLogEntry {
  ts: string;
  category: string;
  channel?: string;
  details: string;
  msg_id?: number;
  forwarded_msg_ids?: number[];
  source_chat_id?: string | number;
  source_msg_ids?: number[];
  meta?: Record<string, unknown>;
}

export class TelegramAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramAuthorizationError";
  }
}

export class TelegramContentFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramContentFilterError";
  }
}

export class TelegramRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramRateLimitError";
  }
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
  /** Custom base URL for Telegram Bot API (default: https://api.telegram.org) */
  apiBaseUrl?: string;
  /** Operating mode: polling, webhook, mtproto, or passive (default: "polling" if updateFetcher/botToken given, else "passive") */
  mode?: "polling" | "webhook" | "mtproto" | "passive";
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number;
  /** Pre-configured parts (channels, groups, DMs, threads) */
  parts?: EmaWorldPart[];
  /** SQLite database path for persistent seen state */
  dbPath?: string;
  /** Legacy alias for dbPath */
  stateFile?: string;
  /** Configured owner/admin IDs (strings or numbers) */
  ownerIds?: (string | number)[];
  /** Known Bot ID to prevent self-reply loops */
  botId?: string | number;
  /** Known Bot Username */
  botUsername?: string;
  /** Authorization configuration (allowedChatIds, writeChatIds, forwardSourceChatIds, etc.) */
  authorization?: TelegramAuthorizationConfig;
  /** Outbound privacy & content filter configuration */
  contentFilter?: TelegramContentFilterConfig;
  /** Outbound banned words list */
  bannedWords?: string[];
  /** Banned word action ("reject" | "mask") */
  bannedWordAction?: "reject" | "mask";
  /** Rate limit configuration */
  rateLimit?: TelegramRateLimitConfig;
  /** Allowlisted local directories permitted for local file media uploads (sendPhoto/sendMediaGroup/etc.) */
  allowedMediaDirs?: string[];
  /** Secret token expected in X-Telegram-Bot-Api-Secret-Token header when mode === "webhook" */
  webhookSecret?: string;
  /** Default primary chat ID for summary/ops-log routes */
  defaultChatId?: string | number;
  /** Custom BotIndex chat ID -> folder alias mappings */
  chatAliases?: Record<string, string>;
  /** Subfolder name inside opsLogDir for operations JSONL logs (default: "default") */
  opsLogFolderName?: string;
  /** BotIndex root directory (e.g. /path/to/bot-index) for automatic JSONL chat persistence */
  botIndexDir?: string;
  /** OpsLog root directory (e.g. /path/to/ops-logs) for operations logging */
  opsLogDir?: string;
  /** Skip pre-existing updates on startup poll so old backlog does not trigger replies */
  skipInitialUpdates?: boolean;
  /** Custom update fetcher for Bot API updates (polling mode or testing) */
  updateFetcher?: (offset: number) => Promise<TelegramUpdate[]> | TelegramUpdate[];
  /** Custom action dispatcher for outgoing operations */
  actionDispatcher?: (
    payload: TelegramActionPayload,
  ) => Promise<TelegramActionResult | void> | TelegramActionResult | void;
  /** Custom fetch implementation for unit testing HTTP client calls */
  fetchImpl?: typeof fetch;
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** Passive mode: mounts routes without active network polling */
  passive?: boolean;
}

export interface TelegramCompanionRunnerOptions {
  botToken?: string;
  chatId?: string | number;
  allowedChatIds?: Array<string | number>;
  writeChatIds?: Array<string | number>;
  forwardSourceChatIds?: Array<string | number>;
  ownerIds?: Array<string | number>;
  session?: string;
  agentId?: string;
  actorName?: string;
  provider?: string;
  modelId?: string;
  thinking?: "low" | "medium" | "high" | "xhigh" | "max";
  workspace?: string;
  botId?: string | number;
  botUsername?: string;
  nicknames?: string[];
  requireMentionInGroups?: boolean;
  requireMentionInChannels?: boolean;
  skipInitialUpdates?: boolean;
  pollIntervalMs?: number;
  dbPath?: string;
  botIndexDir?: string;
  opsLogDir?: string;
  opsLogFolderName?: string;
  allowedMediaDirs?: string[];
  webhookSecret?: string;
  chatAliases?: Record<string, string>;
  /** Expose TelegramWorld HTTP router (`/world/telegram/*`, `/world/routes`) for agent `ema.js world get/post` calls */
  serveHttp?: boolean;
  worldHost?: string;
  worldPort?: number;
  approveMode?: "allow-all" | "deny-all" | "read-only";
  execTimeoutMs?: number;
  llmInvoker?: (prompt: string, batch: ReadonlyArray<EmaInput>) => Promise<string>;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

export interface TelegramCompanionRunnerInstance {
  ctx: EmaCtx;
  world: any;
  actor: EmaActor;
  worldUrl?: string;
  dispose: () => void;
}
