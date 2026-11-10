/**
 * @prism-shadow/ema - QQ World Types & Error Classes
 *
 * Conforms to:
 * - RFC-0001 (Ema Worlds and Actors)
 * - RFC-0002 (Social Media Channel Architecture: Node and Channel)
 */

import type { EmaChannel, EmaNode, EmaChannelItem } from "../../channel.js";

export * from "../../channel.js";

/**
 * QQ Channel Kinds conforming to RFC-0002.
 */
export type QQChannelKind = "group" | "private" | "qzone" | "guild";

export interface QQChannel extends EmaChannel {
  readonly world: "qq";
  readonly channel_kind: QQChannelKind;
}

export type OneBotMessageType = "private" | "group";

export interface OneBotSender {
  user_id?: number | string;
  nickname?: string;
  card?: string;
  sex?: string;
  age?: number;
  role?: "owner" | "admin" | "member";
}

export interface OneBotSegment {
  type: string;
  data?: Record<string, unknown>;
}

export interface OneBotEvent {
  time?: number;
  self_id?: number | string;
  post_type: "message" | "notice" | "request" | "meta_event" | string;

  // Message event fields
  message_type?: OneBotMessageType;
  sub_type?: string;
  message_id?: number | string;
  message_seq?: number;
  user_id?: number | string;
  group_id?: number | string;
  message?: string | OneBotSegment[];
  raw_message?: string;
  font?: number;
  sender?: OneBotSender;

  // Notice event fields
  notice_type?: "notify" | "group_card" | "lucky_king" | "poke" | string;
  target_id?: number | string;
  operator_id?: number | string;
  card_new?: string;
  card_old?: string;

  // Request / Meta event fields
  meta_event_type?: string;
}

export interface OneBotApiCall {
  action: string;
  params: Record<string, unknown>;
  echo?: string;
}

export interface OneBotApiResponse {
  status: "ok" | "failed" | string;
  retcode: number;
  data?: unknown;
  message?: string;
  wording?: string;
  echo?: string;
}

export type RelationalIntimacyStage =
  | "stranger"
  | "acquaintance"
  | "casual_friend"
  | "close_friend"
  | "trusted_companion"
  | "soulmate";

export interface UserIntimacyProfile {
  userId: string;
  score: number;
  stage: RelationalIntimacyStage;
  quietHours?: { startHour: number; endHour: number };
  dnd?: boolean;
  lastInteractionAt?: number;
}

export interface QQDeliveryReceipt {
  requestId: string;
  messageId?: string;
  partId: string;
  action: string;
  params: Record<string, unknown>;
  status: string;
  retcode: number;
  timestamp: number;
}

export interface QQInputMetadata {
  rawMessage?: string;
  messageType?: "group" | "private";
  groupId?: string;
  userId?: string;
  atUids?: string[];
  isAtMe?: boolean;
  isAtAll?: boolean;
  isReplyToMe?: boolean;
  messageSeq?: number;
  images?: Array<{ file?: string; url?: string }>;
  voice?: { file?: string; url?: string };
  jsonCard?: Record<string, unknown> | null;
  noticeType?: string;
  subType?: string;
  isPoke?: boolean;
}

export interface QQGroupSyncState {
  groupId: string;
  lastSeq: number;
  lastSyncedAt: number;
  totalSynced: number;
  gapsDetected: number;
  messagesMissed: number;
  messagesRecovered: number;
  lastGap?: QQMessageGap;
}

export interface QQMessageGap {
  groupId: string;
  fromSeq: number;
  toSeq: number;
  missedCount: number;
  timestamp: number;
  recovered: boolean;
  recoveredCount?: number;
}

export interface QQSyncStatus {
  enabled: boolean;
  syncIntervalMs: number;
  autoRecoverGaps: boolean;
  groups: Record<string, QQGroupSyncState>;
  summary: {
    totalSynced: number;
    totalGapsDetected: number;
    totalMessagesMissed: number;
    totalMessagesRecovered: number;
    hasActiveGaps: boolean;
  };
}

export interface QQSyncedMessage {
  messageId: string;
  groupId?: string;
  userId: string;
  senderName: string;
  messageSeq?: number;
  content: string;
  rawMessage?: string;
  isAtMe: boolean;
  atUids: string[];
  replyTo?: string;
  timestamp: number;
  createdAtIso: string;
  metadata?: Record<string, unknown>;
}

export interface QQContentFilterConfig {
  /** Enables content filtering and privacy guardrails (default: true) */
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

export interface QQRateLimitConfig {
  /** Maximum group messages per minute (default: 30) */
  groupMaxPerMinute?: number;
  /** Maximum private messages per minute (default: 30) */
  privateMaxPerMinute?: number;
  /** Maximum Qzone posts per minute (default: 5) */
  qzoneMaxPerMinute?: number;
}

export interface QQAuthorizationConfig {
  /** Enables authorization enforcement (default: true if allowedUsers or allowedGroups are configured, else false) */
  enabled?: boolean;
  /** Allowed QQ private user / friend IDs (e.g. ["789012", "user:qq:789012", 789012]) */
  allowedUsers?: Array<string | number>;
  /** Allowed QQ group IDs (e.g. ["123456", "group:123456", 123456]) */
  allowedGroups?: Array<string | number>;
  /** Admin / owner QQ IDs (always authorized for all queries and speaking) */
  adminUsers?: Array<string | number>;
  /**
   * Whether users inside an authorized group must also be in allowedUsers to query/speak.
   * - false (default): Anyone in an authorized group can query the companion and trigger responses.
   * - true: Only users in allowedUsers (or adminUsers) who are also in the authorized group can query/speak.
   */
  requireUserAuthInGroups?: boolean;
  /**
   * Action when unauthorized query or speak is detected:
   * - "reject": Throws QQAuthorizationError or returns 403 Forbidden (default).
   * - "block": Silently ignores / drops inbound events and refuses outbound speaking without throwing.
   */
  onUnauthorized?: "reject" | "block";
  /** Default policy when lists are empty: "allow" | "deny" (default: "allow") */
  defaultPolicy?: "allow" | "deny";
}

export interface QQWorldOptions {
  /** Bot's own QQ account ID (for loop prevention; auto-discovered from gateway if omitted) */
  selfId?: string | number;
  /** Primary bot owner QQ IDs (marked with isOwner = true and admin privileges) */
  ownerUids?: Array<string | number>;
  /** Monitored QQ groups, e.g. ["123456"] or ["group:123456"] */
  groups?: Array<string | number>;
  /** Monitored private users, e.g. ["789012"] or ["private:789012"] */
  privateUsers?: Array<string | number>;
  /** Monitored QQ Guilds, e.g. ["guild:555"] */
  guilds?: Array<string | number>;
  /** Whether Qzone channel integration is enabled (default: true) */
  qzoneEnabled?: boolean;
  /** Router prefix (default: "/world/qq") */
  routePrefix?: string;
  /** Custom OneBot API caller function */
  apiCaller?: (call: OneBotApiCall) => Promise<OneBotApiResponse> | OneBotApiResponse;
  /**
   * HTTP/HTTPS or WebSocket gateway URL of Snowluma / OneBot daemon or reverse proxy
   * (e.g. "http://localhost:5700", "https://snowluma.proxy.domain/api", "ws://127.0.0.1:6700")
   */
  gatewayUrl?: string;
  /** Explicit WebSocket gateway URL if separate from HTTP */
  gatewayWsUrl?: string;
  /** HTTP gateway access token for Bearer authorization */
  gatewayToken?: string;
  /** Custom HTTP headers forwarded to reverse-proxied gateway */
  gatewayHeaders?: Record<string, string>;
  /** HMAC-SHA1 secret for validating inbound OneBot webhooks (X-Signature: sha1=...) */
  webhookSecret?: string;
  /** Auto-discover self_id and bot status from remote gateway on startup (default: true) */
  autoDiscoverGateway?: boolean;
  /** SQLite database path for persistent seen state and read-through social index (default: ":memory:") */
  dbPath?: string;
  /** Circadian wake hour (0-23, default: 8) */
  wakeHour?: number;
  /** Circadian sleep hour (0-23, default: 23) */
  sleepHour?: number;
  /** Default quiet hours: { startHour: 23, endHour: 7 } */
  defaultQuietHours?: { startHour: number; endHour: number };
  /** Timezone for RFC-0002 temporal envelopes (default: "Asia/Shanghai") */
  timezone?: string;
  /** Content filter & host privacy guardrail configuration */
  contentFilter?: QQContentFilterConfig;
  /** Custom banned words list */
  bannedWords?: string[];
  /** Action on custom banned words: "reject" or "mask" (default: "reject") */
  bannedWordAction?: "reject" | "mask";
  /** Rate limiting configuration */
  rateLimits?: QQRateLimitConfig;
  /** Configuration authorization for friends and groups */
  authorization?: QQAuthorizationConfig;
  /** Convenience shorthand: allowed friend / private user IDs */
  allowedUsers?: Array<string | number>;
  /** Convenience shorthand: allowed group IDs */
  allowedGroups?: Array<string | number>;
  /** Convenience shorthand: admin user IDs */
  adminUsers?: Array<string | number>;
  /**
   * Whether to require an @mention or reply to the bot to trigger agent turns in group chats (default: false).
   * Note: Regardless of this setting, all messages are always synchronized to local SQLite and channel items.
   */
  requireMentionInGroups?: boolean;
  /**
   * Companion's known nicknames for text-based mention detection, e.g. ["小纸夜", "Ema"]
   */
  nicknames?: string[];
  /**
   * Whether to automatically synchronize group message history in the background (default: true if gatewayUrl is set)
   */
  autoSync?: boolean;
  /**
   * Group message polling/synchronization interval in milliseconds (default: 3000ms)
   */
  syncIntervalMs?: number;
  /**
   * Number of messages to fetch per sync poll batch (default: 20, max 100)
   */
  syncBatchSize?: number;
  /**
   * Whether to automatically detect and recover sequence gaps (default: true)
   */
  autoRecoverGaps?: boolean;
  /** Passive mode: mounts routes without active listeners */
  passive?: boolean;
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
}

export interface QQInteractActionPayload {
  text?: string;
  replyTo?: string | number;
  at?: Array<string | number>;
  images?: string[];
  faces?: number[];
  isProactive?: boolean;
  cadence?: boolean;
  force?: boolean;
  actionName?: string;
  [key: string]: unknown;
}

export class QQRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QQRateLimitError";
  }
}

export class QQContentFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QQContentFilterError";
  }
}

export class QQAuthorizationError extends Error {
  readonly status: number = 403;
  readonly code: string = "ERR_QQ_UNAUTHORIZED";

  constructor(message: string) {
    super(message);
    this.name = "QQAuthorizationError";
  }
}
