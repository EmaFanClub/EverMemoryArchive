/**
 * @prism-shadow/ema - Bilibili World Types & Errors
 *
 * Conforms to RFC-0001 (Ema Worlds and Actors).
 */

import type { Disposable } from "../../interfaces.js";
import type { EmaChannel, EmaNode, EmaChannelItem } from "../../channel.js";
import type { BilibiliPublishDynamicResult } from "./login.js";

export * from "../../channel.js";

/**
 * Bilibili Channel Kinds conforming to RFC-0002.
 */
export type BilibiliChannelKind = "space" | "dynamic" | "video" | "live_room";

export interface BilibiliChannel extends EmaChannel {
  readonly world: "bilibili";
  readonly channel_kind: BilibiliChannelKind;
}

export class BilibiliRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BilibiliRateLimitError";
  }
}

export class BilibiliContentFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BilibiliContentFilterError";
  }
}

export interface BilibiliDanmakuRawData {
  msgId?: string;
  uid: string | number;
  uname: string;
  msg: string;
  color?: string | number;
  fontSize?: number;
  timestamp?: number;
  medal?: { name: string; level: number };
}

export interface BilibiliGiftRawData {
  giftId?: string | number;
  giftName: string;
  num: number;
  uname: string;
  uid: string | number;
  price?: number;
  coinType?: string;
  timestamp?: number;
}

export interface BilibiliSuperChatRawData {
  id?: string | number;
  uid: string | number;
  uname: string;
  price: number;
  message: string;
  timestamp?: number;
}

export interface BilibiliGuardRawData {
  uid: string | number;
  uname: string;
  guardLevel: number; // 1: 总督, 2: 提督, 3: 舰长
  guardName?: string;
  num: number;
  timestamp?: number;
}

export interface BilibiliInteractRawData {
  uid: string | number;
  uname: string;
  timestamp?: number;
}

export type BilibiliLiveRawEvent =
  | { cmd: "DANMU_MSG"; data: BilibiliDanmakuRawData }
  | { cmd: "SEND_GIFT"; data: BilibiliGiftRawData }
  | { cmd: "SUPER_CHAT_MESSAGE"; data: BilibiliSuperChatRawData }
  | { cmd: "GUARD_BUY"; data: BilibiliGuardRawData }
  | { cmd: "INTERACT_WORD" | "ENTRY_EFFECT" | "WELCOME"; data: BilibiliInteractRawData };

export interface BilibiliRawComment {
  rpid: string | number;
  uid: string | number;
  uname: string;
  message: string;
  timestamp?: number | string;
  parentRpid?: string | number;
}

export interface BilibiliRawDm {
  msgId: string | number;
  mid: string | number;
  uname?: string;
  content: string;
  timestamp?: number | string;
}

export interface BilibiliDanmakuSendOptions {
  color?: string | number;
  fontSize?: number;
  mode?: number; // 1: scroll, 4: bottom, 5: top
}

export interface BilibiliCommentSendOptions {
  rootRpid?: string | number;
  parentRpid?: string | number;
  pinned?: boolean;
}

export interface BilibiliDmSendOptions {
  replyMsgId?: string | number;
}

export interface ThankGiftOptions {
  uname: string;
  giftName: string;
  num?: number;
  message?: string;
}

export interface ThankSuperChatOptions {
  uname: string;
  price: number;
  message?: string;
  customMessage?: string;
}

export interface ThankGuardOptions {
  uname: string;
  guardLevel?: number;
  guardName?: string;
  message?: string;
}

export interface BilibiliRateLimitConfig {
  danmakuMinIntervalMs?: number; // default: 1000ms
  danmakuMaxPerMinute?: number; // default: 30
  commentMinIntervalMs?: number; // default: 3000ms
  dmMinIntervalMs?: number; // default: 2000ms
  dynamicMinIntervalMs?: number; // default: 15000ms
}

export interface BilibiliContentFilterConfig {
  /**
   * Enable or disable local machine content filtering guardrails entirely (default: true)
   */
  enabled?: boolean;
  /**
   * Prevents leaking local host file paths (e.g. /home/..., /etc/..., C:\Users\..., .vault.toml, etc.)
   * (default: true)
   */
  filterLocalPaths?: boolean;
  /**
   * Prevents leaking local network host addresses (e.g. 127.0.0.1, localhost, private IP ports)
   * (default: true)
   */
  filterLocalhost?: boolean;
  /**
   * Prevents leaking API credentials, tokens, and secret strings (sk-..., ghp_..., SESSDATA=..., Bearer ...)
   * (default: true)
   */
  filterSecrets?: boolean;
  /**
   * Prevents leaking internal harness system markers ([context_summary], [turn_aborted], call:default_api:, etc.)
   * (default: true)
   */
  filterSystemMarkers?: boolean;
  /**
   * Action when local sensitive content is detected:
   * "reject" (throws BilibiliContentFilterError) or "mask" (replaces with [redacted])
   * (default: "reject")
   */
  action?: "reject" | "mask";
}

export interface BilibiliDispatchRecord {
  id: string;
  target: string;
  action: string;
  message: string;
  options?: unknown;
  timestamp: number;
  actorId: string;
}

export interface BilibiliWorldOptions {
  /** Array of monitored live rooms (e.g. ["123456", "room:123456"]) */
  rooms?: string[];
  /** Array of monitored video / dynamic comment targets (e.g. ["video:BV1xx411c7mD", "BV1xx411c7mD", "opus:12345"]) */
  videoTargets?: string[];
  /** Array of monitored direct message fan mids (e.g. ["dm:1001", "1001"]) */
  dmTargets?: string[];

  /** Primary companion owner UID (e.g. "123456" or "user:123456") to mark isOwner: true */
  ownerUid?: string;

  /** SESSDATA or raw cookie string for authenticated requests */
  cookies?: string | Record<string, string>;
  /** Path to saved cookies JSON */
  cookiePath?: string;
  /** Path to Playwright storageState JSON */
  storageStatePath?: string;
  /** Persistent Playwright browser profile directory */
  userDataDir?: string;

  /** Polling interval for video comments in ms (default: 10000) */
  commentPollInterval?: number;
  /** Polling interval for direct messages in ms (default: 10000) */
  dmPollInterval?: number;

  /** SQLite database path for persistent seen state (defaults to /tmp/ema-minimal-workspace/bilibili-state.sqlite) */
  dbPath?: string;

  /** Custom Danmaku sender */
  danmakuSender?: (
    roomId: string,
    message: string,
    options?: BilibiliDanmakuSendOptions,
  ) => Promise<void> | void;
  /** Custom video comment sender */
  commentSender?: (
    targetId: string,
    message: string,
    options?: BilibiliCommentSendOptions,
  ) => Promise<void> | void;
  /** Custom fan direct message sender */
  dmSender?: (
    mid: string,
    message: string,
    options?: BilibiliDmSendOptions,
  ) => Promise<void> | void;
  /** Custom dynamic publisher for outbound feed dynamics */
  dynamicSender?: (
    text: string,
    options?: Record<string, unknown>,
  ) => Promise<BilibiliPublishDynamicResult> | void;
  /** Custom comment like sender */
  commentLikeSender?: (
    targetId: string,
    commentId: string,
  ) => Promise<void> | void;

  /** Custom live danmaku stream subscriber (returns Disposable) */
  danmakuSubscriber?: (
    roomId: string,
    onEvent: (event: BilibiliLiveRawEvent) => void,
  ) => Disposable;

  /** Custom comment fetcher for polling */
  commentFetcher?: (
    targetId: string,
    limit?: number,
  ) => Promise<BilibiliRawComment[]> | BilibiliRawComment[];
  /** Custom DM fetcher for polling */
  dmFetcher?: (mid: string, limit?: number) => Promise<BilibiliRawDm[]> | BilibiliRawDm[];

  /** Prohibited words list for outbound messages */
  bannedWords?: string[];
  /** Action when outbound message contains banned words: "reject" (throws error) or "mask" (replaces with ***) */
  bannedWordAction?: "reject" | "mask";

  /**
   * Local machine content filter configuration to prevent leaking local paths, localhost URLs,
   * API credentials/tokens, and harness system markers.
   */
  contentFilter?: BilibiliContentFilterConfig | boolean;

  /** Inbound spam keywords to drop */
  spamKeywords?: string[];
  /** Drop automated entry notices (WELCOME, INTERACT_WORD, ENTRY_EFFECT) (default: true) */
  filterEntryNotices?: boolean;

  /** Rate limit configuration */
  rateLimits?: BilibiliRateLimitConfig;

  /** Timezone for temporal anchoring (default: "Asia/Shanghai") */
  timezone?: string;

  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** If true, mounts routes without starting background streams or polling timers */
  passive?: boolean;
}
