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
  images?: Array<{ file?: string; url?: string }>;
  voice?: { file?: string; url?: string };
  jsonCard?: Record<string, unknown> | null;
  noticeType?: string;
  subType?: string;
  isPoke?: boolean;
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

export interface QQWorldOptions {
  /** Bot's own QQ account ID (for loop prevention) */
  selfId?: string | number;
  /** Primary bot owner QQ IDs (marked with isOwner = true) */
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
  /** HTTP gateway URL (e.g. "http://localhost:5700") for default API caller */
  gatewayUrl?: string;
  /** HTTP gateway access token */
  gatewayToken?: string;
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
