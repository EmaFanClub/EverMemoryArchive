/**
 * @prism-shadow/ema - BilibiliWorld
 *
 * Bilibili World implementation for EverMemoryArchive per RFC-0001 (Ema Worlds and Actors).
 * Connects EMA companions to the Bilibili creator and live streaming ecosystem:
 *
 * Board Task Associations:
 * - Input Node (node-mw7rozcw-t37q): Bilibili Input Adapter: Live room Danmaku streaming,
 *   video comment/private message polling, barrage message coalescing, and fan interaction event ingestion.
 * - Action Node (node-mw7rpr0z-d3yr): Bilibili Action Dispatcher: Live room barrage (Danmaku) broadcasts,
 *   thank-you greetings for gifts/superchats/guards, dynamic video comment replies, and fan private messaging.
 *
 * Features:
 * 1. Multi-Part Topology:
 *    - Live Rooms (`room:<room_id>`)
 *    - Video / Opus Comment Threads (`video:<bvid>` or `opus:<id>`)
 *    - Fan Direct Messages (`dm:<mid>`)
 *
 * 2. Inbound Input Adapter:
 *    - Live Danmaku streaming (DANMU_MSG, SEND_GIFT, SUPER_CHAT_MESSAGE, GUARD_BUY)
 *    - Anti-spam & automated entry notice filtering (WELCOME, INTERACT_WORD, ENTRY_EFFECT)
 *    - Sliding duplicate barrage suppression
 *    - Video comment and fan direct message polling
 *    - Transactional persistence via SQLite and EmaInputBatcher coalescing
 *
 * 3. Outbound Action Dispatcher:
 *    - Live room Danmaku (barrage) broadcasts
 *    - Thank-you greetings for gifts, SuperChats, and membership (Guard/Captain) purchases
 *    - Dynamic video comment and feed replies
 *    - Fan private messaging
 *    - Sensitive/banned word filtering guardrails (reject or mask)
 *    - Anti-flooding rate limiting (danmaku, comments, DMs)
 *    - Operating identity and Actor credentials verification (RFC-0001 authenticated-actor-interaction)
 *
 * 4. Resource Router:
 *    - Endpoints mounted on SimpleEmaRouter under `/world/bilibili/*` and `/world/bilibili`
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
import {
  BilibiliLoginManager,
  type BilibiliLoginOptions,
  type BilibiliAuthResult,
  type BilibiliPublishDynamicResult,
  publishBilibiliDynamic,
} from "./bilibili-login.js";

export * from "./bilibili-login.js";

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

export const BILIBILI_LOCAL_PATH_REGEX =
  /(?:(?:~|\/(?:home|Users|root|etc|var|tmp|usr))\/(?:[a-zA-Z0-9_.\-\/]+)|[A-Za-z]:\\[a-zA-Z0-9_.\-\\]+|(?<![a-zA-Z0-9_])\.(?:vault\.toml|project_config\.toml|env(?:\.[a-zA-Z0-9_-]+)*|ssh\/id_[a-z0-9_]+)\b)/i;

export const BILIBILI_LOCALHOST_REGEX =
  /(?:https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/[^\s"'<>]*)?|\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?\b)/i;

export const BILIBILI_SECRETS_REGEX =
  /(?:\b(?:sk[-_][A-Za-z0-9_*-]{12,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|SESSDATA=[A-Za-z0-9%_-]{16,}|bili_jct=[a-f0-9]{32}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\b(?:password|passwd|secret_key|client_secret)\s*[:=]\s*[^\s,;"']+)/i;

export const BILIBILI_SYSTEM_MARKERS_REGEX =
  /(?:\[(?:turn_aborted|turn_retried|context_summary|user_steering|use_skills|request_error|developer_instructions|org_trigger)\]|<(?:app_data_dir|session_id|agent_id)>|\bsession-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9_\-]+|\bcall:default_api:\w+)/i;

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

  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** If true, mounts routes without starting background streams or polling timers */
  passive?: boolean;
}

export class BilibiliWorld extends EmaWorld {
  private rooms: string[];
  private videoTargets: string[];
  private dmTargets: string[];
  private ownerUid?: string;
  private cookies?: Record<string, string>;

  private commentPollInterval: number;
  private dmPollInterval: number;
  private dbPath?: string;

  private danmakuSender: (
    roomId: string,
    message: string,
    options?: BilibiliDanmakuSendOptions,
  ) => Promise<void> | void;
  private commentSender: (
    targetId: string,
    message: string,
    options?: BilibiliCommentSendOptions,
  ) => Promise<void> | void;
  private dmSender: (
    mid: string,
    message: string,
    options?: BilibiliDmSendOptions,
  ) => Promise<void> | void;
  private dynamicSender: (
    text: string,
    options?: Record<string, unknown>,
  ) => Promise<BilibiliPublishDynamicResult> | void;

  private danmakuSubscriber?: (
    roomId: string,
    onEvent: (event: BilibiliLiveRawEvent) => void,
  ) => Disposable;
  private commentFetcher?: (
    targetId: string,
    limit?: number,
  ) => Promise<BilibiliRawComment[]> | BilibiliRawComment[];
  private dmFetcher?: (mid: string, limit?: number) => Promise<BilibiliRawDm[]> | BilibiliRawDm[];

  private bannedWords: string[];
  private bannedWordAction: "reject" | "mask";
  private contentFilter: Required<BilibiliContentFilterConfig>;
  private spamKeywords: string[];
  private filterEntryNotices: boolean;

  private rateLimits: Required<BilibiliRateLimitConfig>;
  private env: Record<string, string | undefined>;
  private passive: boolean;

  private seenIds: Set<string> = new Set();
  private messageHistory: Map<string, EmaInput> = new Map();
  private recentDanmaku: Map<string, EmaInput[]> = new Map();
  private recentComments: Map<string, EmaInput[]> = new Map();
  private recentDms: Map<string, EmaInput[]> = new Map();
  private dispatchesHistory: BilibiliDispatchRecord[] = [];

  // Rate limiting timestamps tracking
  private lastDanmakuTimestamps: Map<string, number[]> = new Map();
  private lastCommentTimestamps: Map<string, number> = new Map();
  private lastDmTimestamps: Map<string, number> = new Map();
  private lastDynamicTime = 0;

  private storageStatePath?: string;
  private userDataDir?: string;

  // Sliding duplicate barrage detector: key -> timestamp
  private recentBarrageBursts: Map<string, number> = new Map();

  private active = false;
  private commentTimer: ReturnType<typeof setInterval> | null = null;
  private dmTimer: ReturnType<typeof setInterval> | null = null;
  private streamDisposables: Disposable[] = [];

  private db: DatabaseSync | null = null;
  private insertSeenStmt: StatementSync | null = null;
  private selectAllSeenStmt: StatementSync | null = null;

  private runtimeCtx: EmaCtx | null = null;

  constructor(options: BilibiliWorldOptions = {}) {
    super();

    // Normalize rooms: strip "room:" prefix for internal lookup
    this.rooms = (options.rooms ?? ["123456"]).map((r) => r.replace(/^room:/, "").trim());

    // Normalize video targets: ensure "video:" or "opus:" prefix
    this.videoTargets = (options.videoTargets ?? []).map((v) => {
      const trimmed = v.trim();
      if (trimmed.startsWith("video:") || trimmed.startsWith("opus:")) return trimmed;
      return `video:${trimmed}`;
    });

    // Normalize DM targets: strip "dm:" prefix for internal lookup
    this.dmTargets = (options.dmTargets ?? []).map((d) => d.replace(/^dm:/, "").trim());

    if (options.ownerUid) {
      this.ownerUid = options.ownerUid.replace(/^user:/, "").trim();
    }

    if (typeof options.cookies === "string") {
      const map: Record<string, string> = {};
      for (const pair of options.cookies.split(";")) {
        const [k, ...v] = pair.trim().split("=");
        if (k && v.length > 0) map[k.trim()] = v.join("=").trim();
      }
      this.cookies = map;
    } else if (options.cookies) {
      this.cookies = { ...options.cookies };
    }

    const statePath =
      options.storageStatePath ??
      path.resolve(process.cwd(), "bilibili-storage-state.json");
    const cookiePath =
      options.cookiePath ??
      path.resolve(process.cwd(), "bilibili-cookies.json");

    if (!this.cookies) {
      const mergedCookies: Record<string, string> = {};
      let detectedUid: string | undefined;

      if (fs.existsSync(cookiePath)) {
        try {
          const saved = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
          if (saved.cookies) Object.assign(mergedCookies, saved.cookies);
          if (saved.uid) detectedUid = String(saved.uid);
        } catch {}
      }

      if (fs.existsSync(statePath)) {
        try {
          const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
          if (Array.isArray(state.cookies)) {
            for (const c of state.cookies) {
              if (c.name && c.value) mergedCookies[c.name] = c.value;
            }
            if (mergedCookies["DedeUserID"] && !detectedUid) {
              detectedUid = mergedCookies["DedeUserID"];
            }
          }
        } catch {}
      }

      if (Object.keys(mergedCookies).length > 0) {
        this.cookies = mergedCookies;
        if (detectedUid && !this.ownerUid) {
          this.ownerUid = detectedUid;
        }
      }
    }

    this.storageStatePath = statePath;
    this.userDataDir = options.userDataDir;

    this.commentPollInterval = options.commentPollInterval ?? 10000;
    this.dmPollInterval = options.dmPollInterval ?? 10000;
    this.env = options.env ?? process.env;
    this.passive = options.passive ?? false;

    this.bannedWords = options.bannedWords ?? [];
    this.bannedWordAction = options.bannedWordAction ?? "reject";

    const filterOpt = typeof options.contentFilter === "object" ? options.contentFilter : {};
    const filterEnabled = options.contentFilter !== false;
    this.contentFilter = {
      enabled: filterOpt.enabled ?? filterEnabled,
      filterLocalPaths: filterOpt.filterLocalPaths ?? true,
      filterLocalhost: filterOpt.filterLocalhost ?? true,
      filterSecrets: filterOpt.filterSecrets ?? true,
      filterSystemMarkers: filterOpt.filterSystemMarkers ?? true,
      action: filterOpt.action ?? (options.bannedWordAction ?? "reject"),
    };

    this.spamKeywords = options.spamKeywords ?? [];
    this.filterEntryNotices = options.filterEntryNotices ?? true;

    this.rateLimits = {
      danmakuMinIntervalMs: options.rateLimits?.danmakuMinIntervalMs ?? 1000,
      danmakuMaxPerMinute: options.rateLimits?.danmakuMaxPerMinute ?? 30,
      commentMinIntervalMs: options.rateLimits?.commentMinIntervalMs ?? 3000,
      dmMinIntervalMs: options.rateLimits?.dmMinIntervalMs ?? 2000,
      dynamicMinIntervalMs: options.rateLimits?.dynamicMinIntervalMs ?? 15000,
    };

    this.danmakuSender =
      options.danmakuSender ??
      ((roomId, message) => {
        // Default safe mock sender
      });

    this.commentSender =
      options.commentSender ??
      ((targetId, message) => {
        // Default safe mock sender
      });

    this.dmSender =
      options.dmSender ??
      ((mid, message) => {
        // Default safe mock sender
      });

    this.dynamicSender =
      options.dynamicSender ??
      ((text, opt) => {
        return publishBilibiliDynamic(text, {
          userDataDir: this.userDataDir,
          storageStatePath: this.storageStatePath,
          ...opt,
        });
      });

    this.danmakuSubscriber = options.danmakuSubscriber;
    this.commentFetcher = options.commentFetcher;
    this.dmFetcher = options.dmFetcher;

    this.dbPath = options.dbPath ?? "/tmp/ema-minimal-workspace/bilibili-state.sqlite";

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
        CREATE TABLE IF NOT EXISTS seen_bilibili_events (
          id TEXT PRIMARY KEY,
          type TEXT,
          part_id TEXT,
          timestamp INTEGER
        );
        CREATE TABLE IF NOT EXISTS bilibili_world_state (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER
        );
      `);
      this.insertSeenStmt = this.db.prepare(
        "INSERT OR IGNORE INTO seen_bilibili_events (id, type, part_id, timestamp) VALUES (?, ?, ?, ?)",
      );
      this.selectAllSeenStmt = this.db.prepare("SELECT id FROM seen_bilibili_events");
    } catch (err) {
      console.error("[BilibiliWorld] Failed to initialize SQLite database:", err);
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
      console.error("[BilibiliWorld] Failed to load state from SQLite:", err);
    }
  }

  private saveState(id: string, type: string, partId: string): void {
    this.seenIds.add(id);
    if (!this.db || !this.insertSeenStmt) return;
    try {
      this.insertSeenStmt.run(id, type, partId, Date.now());
    } catch (err) {
      console.error("[BilibiliWorld] Failed to save seen event to SQLite:", err);
    }
  }

  /**
   * Starts the Bilibili world lifecycle:
   * 1. Mounts resource routes on ctx.router under `/world/bilibili/*` and `/world/bilibili`
   * 2. Registers BilibiliWorld with ctx.registry
   * 3. Connects live danmaku stream subscribers
   * 4. Launches video comment and direct message polling timers
   */
  start(ctx: EmaCtx): Disposable {
    this.active = true;
    this.runtimeCtx = ctx;

    const registryHandle = ctx.registry.register("bilibili", this);

    // 1. Mount Router Endpoints for Bilibili World
    const routeHandler = (routeCtx: EmaRouteContext) => {
      const subpath = routeCtx.path.replace(/^\/world\/bilibili\/?/, "");

      if (subpath === "" || subpath === "parts") {
        return {
          world: "bilibili",
          parts: this.listParts(),
        };
      }

      if (subpath.startsWith("parts/")) {
        const rawPartId = decodeURIComponent(subpath.replace(/^parts\//, ""));
        const part = this.listParts().find(
          (p) =>
            p.id === rawPartId ||
            p.id === `room:${rawPartId}` ||
            p.id === `video:${rawPartId}` ||
            p.id === `dm:${rawPartId}`,
        );
        if (!part) {
          throw new Error(`Part not found: ${rawPartId}`);
        }
        return part;
      }

      if (subpath.startsWith("messages/")) {
        const id = decodeURIComponent(subpath.replace(/^messages\//, ""));
        const msg = this.messageHistory.get(id);
        if (!msg) {
          throw new Error(`Message not found: ${id}`);
        }
        return msg;
      }

      if (subpath.startsWith("danmaku/")) {
        const roomId = decodeURIComponent(subpath.replace(/^danmaku\//, "")).replace(/^room:/, "");
        const danmakuList = this.recentDanmaku.get(roomId) ?? [];
        return {
          roomId,
          count: danmakuList.length,
          danmaku: danmakuList,
        };
      }

      if (subpath.startsWith("comments/")) {
        const targetId = decodeURIComponent(subpath.replace(/^comments\//, ""));
        const normalizedTarget =
          targetId.startsWith("video:") || targetId.startsWith("opus:")
            ? targetId
            : `video:${targetId}`;
        const commentsList = this.recentComments.get(normalizedTarget) ?? [];
        return {
          targetId: normalizedTarget,
          count: commentsList.length,
          comments: commentsList,
        };
      }

      if (subpath.startsWith("dms/")) {
        const mid = decodeURIComponent(subpath.replace(/^dms\//, "")).replace(/^dm:/, "");
        const dmsList = this.recentDms.get(mid) ?? [];
        return {
          mid,
          count: dmsList.length,
          dms: dmsList,
        };
      }

      if (subpath === "dispatches") {
        return {
          count: this.dispatchesHistory.length,
          dispatches: this.dispatchesHistory,
        };
      }

      if (subpath === "status") {
        return {
          world: "bilibili",
          active: this.active,
          passive: this.passive,
          rooms: this.rooms,
          videoTargets: this.videoTargets,
          dmTargets: this.dmTargets,
          seenEventsCount: this.seenIds.size,
          messageHistoryCount: this.messageHistory.size,
          rateLimits: this.rateLimits,
        };
      }

      return {
        world: "bilibili",
        parts: this.listParts(),
      };
    };

    const routeHandleWildcard = ctx.router.serve(
      "/world/bilibili/*",
      routeHandler,
      "Bilibili World resource router (wildcard)",
    );

    const routeHandleRoot = ctx.router.serve(
      "/world/bilibili",
      routeHandler,
      "Bilibili World resource router (root)",
    );

    // 2. Connect Danmaku streams if not in passive mode
    if (!this.passive && this.danmakuSubscriber) {
      for (const room of this.rooms) {
        try {
          const sub = this.danmakuSubscriber(room, (event) => {
            this.emitLiveEvent(room, event);
          });
          if (sub) {
            this.streamDisposables.push(sub);
          }
        } catch (err) {
          console.error(
            `[BilibiliWorld] Failed to connect danmaku subscriber for room ${room}:`,
            err,
          );
        }
      }
    }

    // 3. Start comment polling loop if not in passive mode
    if (!this.passive && this.commentFetcher && this.videoTargets.length > 0) {
      this.pollComments().catch((err) => {
        console.error("[BilibiliWorld] Initial comment poll error:", err);
      });
      this.commentTimer = setInterval(() => {
        this.pollComments().catch((err) => {
          console.error("[BilibiliWorld] Periodic comment poll error:", err);
        });
      }, this.commentPollInterval);
    }

    // 4. Start DM polling loop if not in passive mode
    if (!this.passive && this.dmFetcher && this.dmTargets.length > 0) {
      this.pollDms().catch((err) => {
        console.error("[BilibiliWorld] Initial DM poll error:", err);
      });
      this.dmTimer = setInterval(() => {
        this.pollDms().catch((err) => {
          console.error("[BilibiliWorld] Periodic DM poll error:", err);
        });
      }, this.dmPollInterval);
    }

    return {
      dispose: () => {
        this.active = false;
        if (this.commentTimer) {
          clearInterval(this.commentTimer);
          this.commentTimer = null;
        }
        if (this.dmTimer) {
          clearInterval(this.dmTimer);
          this.dmTimer = null;
        }
        for (const sub of this.streamDisposables) {
          try {
            sub.dispose();
          } catch {}
        }
        this.streamDisposables = [];
        routeHandleWildcard.dispose();
        routeHandleRoot.dispose();
        registryHandle.dispose();
        this.dispose();
      },
    };
  }

  /**
   * Disposes database handles, timers, and active connections.
   */
  dispose(): void {
    this.active = false;
    if (this.commentTimer) {
      clearInterval(this.commentTimer);
      this.commentTimer = null;
    }
    if (this.dmTimer) {
      clearInterval(this.dmTimer);
      this.dmTimer = null;
    }
    for (const sub of this.streamDisposables) {
      try {
        sub.dispose();
      } catch {}
    }
    this.streamDisposables = [];
    if (this.db) {
      try {
        this.insertSeenStmt = null;
        this.selectAllSeenStmt = null;
        this.db.close();
      } catch (err) {
        console.error("[BilibiliWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    }
  }

  /**
   * Ingests and processes a raw live streaming event (Danmaku, Gift, SuperChat, Guard, etc.)
   * Normalizes into EmaInput and submits to ctx.inputBatcher.
   */
  emitLiveEvent(roomId: string, raw: BilibiliLiveRawEvent): void {
    if (!this.active && !this.passive && !this.runtimeCtx) return;

    const normalizedRoom = roomId.replace(/^room:/, "");
    const partId = `room:${normalizedRoom}`;

    // 1. Filter automated entry notices (WELCOME, INTERACT_WORD, ENTRY_EFFECT)
    if (
      this.filterEntryNotices &&
      (raw.cmd === "INTERACT_WORD" || raw.cmd === "ENTRY_EFFECT" || raw.cmd === "WELCOME")
    ) {
      return;
    }

    let input: EmaInput | null = null;
    let eventType = "";

    switch (raw.cmd) {
      case "DANMU_MSG": {
        eventType = "danmaku";
        const d = raw.data;
        const text = (d.msg || "").trim();
        if (!text) return;

        // Anti-spam keyword filter
        if (this.isSpamContent(text)) return;

        // Sliding duplicate barrage burst suppression: drop exact same text from same sender within 5s
        const senderUid = String(d.uid);
        const burstKey = `${partId}:${senderUid}:${text}`;
        const now = Date.now();
        const lastSeen = this.recentBarrageBursts.get(burstKey);
        if (lastSeen && now - lastSeen < 5000) {
          return;
        }
        this.recentBarrageBursts.set(burstKey, now);

        // Deduplication ID
        const id = d.msgId || `bili-danmaku-${normalizedRoom}-${senderUid}-${d.timestamp || now}`;
        if (this.seenIds.has(id)) return;

        this.saveState(id, "danmaku", partId);

        input = {
          id,
          world: "bilibili",
          partId,
          sender: {
            id: `user:${senderUid}`,
            name: d.uname || `user_${senderUid}`,
            isOwner: this.isUserOwner(senderUid),
          },
          content: text,
          timestamp: d.timestamp || now,
          metadata: {
            type: "danmaku",
            roomId: normalizedRoom,
            color: d.color,
            fontSize: d.fontSize,
            medal: d.medal,
            uid: senderUid,
            uname: d.uname,
          },
        };
        break;
      }

      case "SEND_GIFT": {
        eventType = "gift";
        const d = raw.data;
        const senderUid = String(d.uid);
        const now = Date.now();
        const giftId = d.giftId ?? "gift";
        const id = `bili-gift-${normalizedRoom}-${giftId}-${senderUid}-${d.timestamp || now}`;
        if (this.seenIds.has(id)) return;

        this.saveState(id, "gift", partId);

        const summary = `[GIFT] ${d.uname} 赠送了 ${d.giftName} x${d.num}${
          d.price !== undefined ? ` (价值: ${d.price})` : ""
        }`;

        input = {
          id,
          world: "bilibili",
          partId,
          sender: {
            id: `user:${senderUid}`,
            name: d.uname || `user_${senderUid}`,
            isOwner: this.isUserOwner(senderUid),
          },
          content: summary,
          timestamp: d.timestamp || now,
          metadata: {
            type: "gift",
            roomId: normalizedRoom,
            giftName: d.giftName,
            num: d.num,
            price: d.price,
            coinType: d.coinType,
            uid: senderUid,
            uname: d.uname,
          },
        };
        break;
      }

      case "SUPER_CHAT_MESSAGE": {
        eventType = "superchat";
        const d = raw.data;
        const senderUid = String(d.uid);
        const now = Date.now();
        const scId = d.id ?? `sc-${now}`;
        const id = `bili-sc-${normalizedRoom}-${scId}`;
        if (this.seenIds.has(id)) return;

        this.saveState(id, "superchat", partId);

        const summary = `[SUPERCHAT ¥${d.price}] ${d.message}`;

        input = {
          id,
          world: "bilibili",
          partId,
          sender: {
            id: `user:${senderUid}`,
            name: d.uname || `user_${senderUid}`,
            isOwner: this.isUserOwner(senderUid),
          },
          content: summary,
          timestamp: d.timestamp || now,
          metadata: {
            type: "superchat",
            roomId: normalizedRoom,
            price: d.price,
            scId: String(scId),
            message: d.message,
            uid: senderUid,
            uname: d.uname,
          },
        };
        break;
      }

      case "GUARD_BUY": {
        eventType = "guard";
        const d = raw.data;
        const senderUid = String(d.uid);
        const now = Date.now();
        const guardName =
          d.guardName || (d.guardLevel === 1 ? "总督" : d.guardLevel === 2 ? "提督" : "舰长");
        const id = `bili-guard-${normalizedRoom}-${senderUid}-${d.timestamp || now}`;
        if (this.seenIds.has(id)) return;

        this.saveState(id, "guard", partId);

        const summary = `[GUARD] ${d.uname} 开通了 ${guardName} x${d.num}`;

        input = {
          id,
          world: "bilibili",
          partId,
          sender: {
            id: `user:${senderUid}`,
            name: d.uname || `user_${senderUid}`,
            isOwner: this.isUserOwner(senderUid),
          },
          content: summary,
          timestamp: d.timestamp || now,
          metadata: {
            type: "guard",
            roomId: normalizedRoom,
            guardLevel: d.guardLevel,
            guardName,
            num: d.num,
            uid: senderUid,
            uname: d.uname,
          },
        };
        break;
      }

      default:
        break;
    }

    if (input) {
      this.recordMessage(input, eventType, normalizedRoom);
      if (this.runtimeCtx?.inputBatcher) {
        this.runtimeCtx.inputBatcher.push(input);
      }
    }
  }

  /**
   * Polls video comments for registered video targets.
   */
  async pollComments(): Promise<void> {
    if (!this.commentFetcher) return;

    for (const target of this.videoTargets) {
      try {
        const rawComments = await this.commentFetcher(target);
        if (!Array.isArray(rawComments)) continue;

        for (const raw of rawComments) {
          const rpid = String(raw.rpid);
          const id = `bili-comment-${target}-${rpid}`;
          if (this.seenIds.has(id)) continue;

          const text = (raw.message || "").trim();
          if (!text || this.isSpamContent(text)) continue;

          this.saveState(id, "comment", target);

          const senderUid = String(raw.uid);
          const parentRpid = raw.parentRpid ? String(raw.parentRpid) : undefined;

          const input: EmaInput = {
            id,
            world: "bilibili",
            partId: target,
            sender: {
              id: `user:${senderUid}`,
              name: raw.uname || `user_${senderUid}`,
              isOwner: this.isUserOwner(senderUid),
            },
            content: text,
            timestamp:
              typeof raw.timestamp === "number"
                ? raw.timestamp
                : raw.timestamp
                  ? new Date(raw.timestamp).getTime()
                  : Date.now(),
            replyTo: parentRpid ? `bili-comment-${target}-${parentRpid}` : undefined,
            metadata: {
              type: "comment",
              targetId: target,
              rpid,
              parentRpid,
              uid: senderUid,
              uname: raw.uname,
            },
          };

          this.recordMessage(input, "comment", target);
          if (this.runtimeCtx?.inputBatcher) {
            this.runtimeCtx.inputBatcher.push(input);
          }
        }
      } catch (err) {
        console.error(`[BilibiliWorld] Failed to poll comments for ${target}:`, err);
      }
    }
  }

  /**
   * Polls direct fan messages for registered DM targets.
   */
  async pollDms(): Promise<void> {
    if (!this.dmFetcher) return;

    for (const mid of this.dmTargets) {
      const partId = `dm:${mid}`;
      try {
        const rawDms = await this.dmFetcher(mid);
        if (!Array.isArray(rawDms)) continue;

        for (const raw of rawDms) {
          const msgId = String(raw.msgId);
          const id = `bili-dm-${mid}-${msgId}`;
          if (this.seenIds.has(id)) continue;

          const text = (raw.content || "").trim();
          if (!text || this.isSpamContent(text)) continue;

          this.saveState(id, "dm", partId);

          const input: EmaInput = {
            id,
            world: "bilibili",
            partId,
            sender: {
              id: `user:${mid}`,
              name: raw.uname || `user_${mid}`,
              isOwner: this.isUserOwner(mid),
            },
            content: text,
            timestamp:
              typeof raw.timestamp === "number"
                ? raw.timestamp
                : raw.timestamp
                  ? new Date(raw.timestamp).getTime()
                  : Date.now(),
            metadata: {
              type: "dm",
              mid,
              msgId,
            },
          };

          this.recordMessage(input, "dm", mid);
          if (this.runtimeCtx?.inputBatcher) {
            this.runtimeCtx.inputBatcher.push(input);
          }
        }
      } catch (err) {
        console.error(`[BilibiliWorld] Failed to poll DMs for ${mid}:`, err);
      }
    }
  }

  /**
   * Interacts with a specific Bilibili part (room, video comment, fan DM)
   * on behalf of an EMA Actor.
   *
   * Enforces:
   * 1. Operating Agent Identity verification (`assertAgentIdentity`)
   * 2. Actor authentication (`authenticated-actor-interaction` RFC-0001)
   * 3. Sensitive / prohibited word guardrail filtering (`bannedWords`)
   * 4. Anti-flooding rate limiting
   */
  interact(_ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable {
    // 1. Strictly verify operating agent identity and actor credentials
    assertAgentIdentity(this.env);
    if (!actor || !actor.id || !actor.agentId || !actor.session) {
      throw new Error("Invalid or unauthenticated EmaActor credentials");
    }

    const normId = this.normalizePartTarget(id);

    // 2. Parse action and payload
    let action = "reply";
    let messageText = "";
    let actionOptions: Record<string, unknown> = {};

    if (args.length > 0) {
      const first = args[0];
      if (typeof first === "string") {
        const lower = first.toLowerCase();
        if (
          lower === "danmaku" ||
          lower === "send_danmaku" ||
          lower === "barrage" ||
          lower === "thank_gift" ||
          lower === "thank_superchat" ||
          lower === "thank_guard" ||
          lower === "comment" ||
          lower === "reply_comment" ||
          lower === "pin_comment" ||
          lower === "dm" ||
          lower === "send_dm" ||
          lower === "reply" ||
          lower === "post" ||
          lower === "dynamic" ||
          lower === "post_dynamic" ||
          lower === "publish" ||
          lower === "publish_dynamic"
        ) {
          action = lower;
          if (typeof args[1] === "string") {
            messageText = args[1];
          } else if (typeof args[1] === "object" && args[1] !== null) {
            actionOptions = args[1] as Record<string, unknown>;
            messageText = String(actionOptions.message || actionOptions.text || "");
          }
        } else {
          // If not a recognized action verb, treat first argument as the message text
          messageText = first;
          if (typeof args[1] === "object" && args[1] !== null) {
            actionOptions = args[1] as Record<string, unknown>;
          }
        }
      } else if (typeof first === "object" && first !== null) {
        const obj = first as Record<string, unknown>;
        if (typeof obj.action === "string") {
          action = obj.action.toLowerCase();
        }
        actionOptions = obj;
        messageText = String(obj.message || obj.text || "");
      }
    }

    // 3. Handle specialized thank-you actions
    if (action === "thank_gift") {
      messageText = this.formatThankGift(actionOptions as unknown as ThankGiftOptions);
    } else if (action === "thank_superchat") {
      messageText = this.formatThankSuperChat(actionOptions as unknown as ThankSuperChatOptions);
    } else if (action === "thank_guard") {
      messageText = this.formatThankGuard(actionOptions as unknown as ThankGuardOptions);
    }

    if (!messageText && action !== "pin_comment") {
      throw new Error(`No message text provided for Bilibili interaction on ${id}`);
    }

    // 4. Content safety check (Banned / sensitive words)
    const sanitizedText = this.checkContentFilter(messageText);

    // 5. Anti-flooding rate limit check & Dispatch execution
    const now = Date.now();

    if (normId.startsWith("room:")) {
      const roomId = normId.replace(/^room:/, "");
      this.checkDanmakuRateLimit(roomId, now);

      try {
        const res = this.danmakuSender(roomId, sanitizedText, actionOptions);
        if (res && typeof (res as Promise<void>).catch === "function") {
          (res as Promise<void>).catch((err) => {
            console.error(`[BilibiliWorld] Failed to dispatch danmaku to room ${roomId}:`, err);
          });
        }
      } catch (err) {
        console.error(`[BilibiliWorld] Failed to dispatch danmaku to room ${roomId}:`, err);
      }
    } else if (normId.startsWith("video:") || normId.startsWith("opus:")) {
      this.checkCommentRateLimit(normId, now);

      try {
        const res = this.commentSender(normId, sanitizedText, actionOptions);
        if (res && typeof (res as Promise<void>).catch === "function") {
          (res as Promise<void>).catch((err) => {
            console.error(`[BilibiliWorld] Failed to dispatch comment to ${normId}:`, err);
          });
        }
      } catch (err) {
        console.error(`[BilibiliWorld] Failed to dispatch comment to ${normId}:`, err);
      }
    } else if (normId.startsWith("dm:")) {
      const mid = normId.replace(/^dm:/, "");
      this.checkDmRateLimit(mid, now);

      try {
        const res = this.dmSender(mid, sanitizedText, actionOptions);
        if (res && typeof (res as Promise<void>).catch === "function") {
          (res as Promise<void>).catch((err) => {
            console.error(`[BilibiliWorld] Failed to dispatch DM to ${mid}:`, err);
          });
        }
      } catch (err) {
        console.error(`[BilibiliWorld] Failed to dispatch DM to ${mid}:`, err);
      }
    } else if (
      normId === "dynamic" ||
      normId === "feed" ||
      normId.startsWith("dynamic:") ||
      normId.startsWith("feed:") ||
      action === "post_dynamic" ||
      action === "dynamic" ||
      action === "publish_dynamic"
    ) {
      this.checkDynamicRateLimit(now);

      try {
        const res = this.dynamicSender(sanitizedText, actionOptions);
        if (res && typeof (res as unknown as Promise<unknown>).catch === "function") {
          (res as unknown as Promise<unknown>).catch((err) => {
            console.error(`[BilibiliWorld] Failed to dispatch dynamic:`, err);
          });
        }
      } catch (err) {
        console.error(`[BilibiliWorld] Failed to dispatch dynamic:`, err);
      }
    } else {
      // Fallback: default to danmaku broadcast
      this.checkDanmakuRateLimit(normId, now);
      try {
        const res = this.danmakuSender(normId, sanitizedText, actionOptions);
        if (res && typeof (res as Promise<void>).catch === "function") {
          (res as Promise<void>).catch((err) => {
            console.error(`[BilibiliWorld] Failed to dispatch danmaku to ${normId}:`, err);
          });
        }
      } catch (err) {
        console.error(`[BilibiliWorld] Failed to dispatch danmaku to ${normId}:`, err);
      }
    }

    // 6. Record outbound dispatch for auditing and router inspection
    const dispatchRecord: BilibiliDispatchRecord = {
      id: `disp-${now}-${Math.random().toString(36).slice(2, 7)}`,
      target: normId,
      action,
      message: sanitizedText,
      options: actionOptions,
      timestamp: now,
      actorId: actor.id,
    };
    if (this.dispatchesHistory.length >= 200) {
      this.dispatchesHistory.shift();
    }
    this.dispatchesHistory.push(dispatchRecord);

    return {
      dispose: () => {},
    };
  }

  /**
   * Formats a thank-you greeting for live room gift donations.
   */
  formatThankGift(opts: ThankGiftOptions): string {
    if (!opts) return "感谢您的礼物赠送！";
    if (opts.message) return opts.message;
    const uname = opts.uname || "观众";
    const giftName = opts.giftName || "礼物";
    const countPart = opts.num && opts.num > 1 ? ` x${opts.num}` : "";
    return `感谢 ${uname} 赠送的 ${giftName}${countPart}！`;
  }

  /**
   * Formats a thank-you greeting for SuperChat donations.
   */
  formatThankSuperChat(opts: ThankSuperChatOptions): string {
    if (!opts) return "感谢您的醒目留言！";
    if (opts.customMessage) return opts.customMessage;
    const uname = opts.uname || "观众";
    const price = opts.price ?? 0;
    const msgPart = opts.message ? `：${opts.message}` : "！";
    return `感谢 ${uname} 的醒目留言（¥${price}）${msgPart}`;
  }

  /**
   * Formats a thank-you greeting for Guard (Captain/Fleet) membership purchases.
   */
  formatThankGuard(opts: ThankGuardOptions): string {
    if (!opts) return "热烈欢迎加入大航海！";
    if (opts.message) return opts.message;
    const uname = opts.uname || "观众";
    const guardName =
      opts.guardName || (opts.guardLevel === 1 ? "总督" : opts.guardLevel === 2 ? "提督" : "舰长");
    return `热烈欢迎 ${uname} 加入大航海（${guardName}）！`;
  }

  /**
   * Checks message content against banned word list and local machine privacy leaks.
   * Guards against leaking local file paths, localhost/private network addresses, credentials/tokens, and harness system markers.
   * Throws BilibiliContentFilterError on "reject", or masks prohibited keywords/patterns.
   */
  private checkContentFilter(text: string): string {
    let result = text;

    // 1. Custom banned words list check
    if (this.bannedWords.length > 0) {
      for (const banned of this.bannedWords) {
        if (!banned) continue;
        if (result.includes(banned)) {
          if (this.bannedWordAction === "mask") {
            const mask = "*".repeat(banned.length);
            result = result.split(banned).join(mask);
          } else {
            throw new BilibiliContentFilterError(
              `Refusing to dispatch Bilibili message containing prohibited word: "${banned}"`,
            );
          }
        }
      }
    }

    // 2. Local machine & privacy leak guardrails
    if (this.contentFilter.enabled) {
      const checks: Array<{
        enabled: boolean;
        type: string;
        regex: RegExp;
      }> = [
        {
          enabled: this.contentFilter.filterLocalPaths,
          type: "local file path",
          regex: BILIBILI_LOCAL_PATH_REGEX,
        },
        {
          enabled: this.contentFilter.filterLocalhost,
          type: "localhost or private network address",
          regex: BILIBILI_LOCALHOST_REGEX,
        },
        {
          enabled: this.contentFilter.filterSecrets,
          type: "credential, token, or secret",
          regex: BILIBILI_SECRETS_REGEX,
        },
        {
          enabled: this.contentFilter.filterSystemMarkers,
          type: "harness system marker",
          regex: BILIBILI_SYSTEM_MARKERS_REGEX,
        },
      ];

      for (const { enabled, type, regex } of checks) {
        if (!enabled) continue;
        const testRegex = new RegExp(regex.source, regex.flags);
        if (testRegex.test(result)) {
          if (this.contentFilter.action === "mask") {
            const replaceRegex = new RegExp(
              regex.source,
              regex.flags.includes("g") ? regex.flags : regex.flags + "g",
            );
            result = result.replace(replaceRegex, "[redacted]");
          } else {
            throw new BilibiliContentFilterError(
              `Refusing to dispatch Bilibili message containing sensitive ${type}`,
            );
          }
        }
      }
    }

    return result;
  }

  /**
   * Enforces minimum interval and maximum rate per minute for live room Danmaku.
   */
  private checkDanmakuRateLimit(roomId: string, now: number): void {
    let history = this.lastDanmakuTimestamps.get(roomId);
    if (!history) {
      history = [];
      this.lastDanmakuTimestamps.set(roomId, history);
    }

    // Purge timestamps older than 60 seconds
    const cutoff = now - 60000;
    while (history.length > 0 && history[0] < cutoff) {
      history.shift();
    }

    if (history.length > 0) {
      const last = history[history.length - 1];
      if (now - last < this.rateLimits.danmakuMinIntervalMs) {
        throw new BilibiliRateLimitError(
          `Danmaku rate limit exceeded for room ${roomId}: minimum interval is ${this.rateLimits.danmakuMinIntervalMs}ms`,
        );
      }
    }

    if (history.length >= this.rateLimits.danmakuMaxPerMinute) {
      throw new BilibiliRateLimitError(
        `Danmaku rate limit exceeded for room ${roomId}: maximum ${this.rateLimits.danmakuMaxPerMinute} per minute`,
      );
    }

    history.push(now);
  }

  /**
   * Enforces minimum interval for video comments.
   */
  private checkCommentRateLimit(targetId: string, now: number): void {
    const last = this.lastCommentTimestamps.get(targetId);
    if (last && now - last < this.rateLimits.commentMinIntervalMs) {
      throw new BilibiliRateLimitError(
        `Comment rate limit exceeded for target ${targetId}: minimum interval is ${this.rateLimits.commentMinIntervalMs}ms`,
      );
    }
    this.lastCommentTimestamps.set(targetId, now);
  }

  /**
   * Enforces minimum interval for direct messages.
   */
  private checkDmRateLimit(mid: string, now: number): void {
    const last = this.lastDmTimestamps.get(mid);
    if (last && now - last < this.rateLimits.dmMinIntervalMs) {
      throw new BilibiliRateLimitError(
        `DM rate limit exceeded for mid ${mid}: minimum interval is ${this.rateLimits.dmMinIntervalMs}ms`,
      );
    }
    this.lastDmTimestamps.set(mid, now);
  }

  /**
   * Enforces minimum interval for feed dynamics.
   */
  private checkDynamicRateLimit(now: number): void {
    const minInterval = this.rateLimits.dynamicMinIntervalMs;
    const elapsed = now - this.lastDynamicTime;
    if (elapsed < minInterval) {
      const waitSec = Math.ceil((minInterval - elapsed) / 1000);
      throw new BilibiliRateLimitError(
        `Bilibili dynamic rate limit exceeded: minimum interval is ${this.rateLimits.dynamicMinIntervalMs}ms (${waitSec}s remaining)`,
      );
    }
    this.lastDynamicTime = now;
  }

  private isSpamContent(text: string): boolean {
    if (this.spamKeywords.length === 0) return false;
    return this.spamKeywords.some((keyword) => keyword && text.includes(keyword));
  }

  private isUserOwner(uid: string): boolean {
    if (!this.ownerUid) return false;
    return uid === this.ownerUid;
  }

  private normalizePartTarget(raw: string): string {
    const trimmed = raw.trim();
    if (
      trimmed.startsWith("room:") ||
      trimmed.startsWith("video:") ||
      trimmed.startsWith("opus:") ||
      trimmed.startsWith("dm:")
    ) {
      return trimmed;
    }
    if (this.rooms.includes(trimmed)) {
      return `room:${trimmed}`;
    }
    if (this.dmTargets.includes(trimmed)) {
      return `dm:${trimmed}`;
    }
    if (this.videoTargets.includes(`video:${trimmed}`)) {
      return `video:${trimmed}`;
    }
    return trimmed;
  }

  private recordMessage(input: EmaInput, type: string, subKey: string): void {
    // Retain message in recent message history map (cap at 500)
    if (this.messageHistory.size >= 500) {
      const oldest = this.messageHistory.keys().next().value;
      if (oldest) this.messageHistory.delete(oldest);
    }
    this.messageHistory.set(input.id, input);

    if (type === "danmaku" || type === "gift" || type === "superchat" || type === "guard") {
      let list = this.recentDanmaku.get(subKey);
      if (!list) {
        list = [];
        this.recentDanmaku.set(subKey, list);
      }
      if (list.length >= 100) list.shift();
      list.push(input);
    } else if (type === "comment") {
      let list = this.recentComments.get(subKey);
      if (!list) {
        list = [];
        this.recentComments.set(subKey, list);
      }
      if (list.length >= 100) list.shift();
      list.push(input);
    } else if (type === "dm") {
      let list = this.recentDms.get(subKey);
      if (!list) {
        list = [];
        this.recentDms.set(subKey, list);
      }
      if (list.length >= 100) list.shift();
      list.push(input);
    }
  }

  /**
   * Helper method to launch Playwright QR code login flow and wait for completion.
   */
  static async login(options?: BilibiliLoginOptions): Promise<BilibiliAuthResult> {
    const mgr = new BilibiliLoginManager(options);
    return mgr.login();
  }

  /**
   * Generates a login QR code session with Playwright, returning the session handle.
   */
  static async createLoginSession(options?: BilibiliLoginOptions) {
    const mgr = new BilibiliLoginManager(options);
    return mgr.createLoginSession();
  }

  /**
   * Lists all active World Parts (Live Rooms, Videos/Dynamics, Fan DMs).
   */
  listParts(): EmaWorldPart[] {
    const parts: EmaWorldPart[] = [];

    for (const room of this.rooms) {
      parts.push({
        id: `room:${room}`,
        type: "room",
        name: `Bilibili Live Room ${room}`,
        topic: `Live room danmaku, superchat, and gift stream for room ${room}`,
      });
    }

    for (const v of this.videoTargets) {
      parts.push({
        id: v,
        type: "channel",
        name: `Bilibili ${v.startsWith("opus:") ? "Opus" : "Video"} ${v.replace(/^(video|opus):/, "")}`,
        topic: `Comments and discussions for ${v}`,
      });
    }

    for (const dm of this.dmTargets) {
      parts.push({
        id: `dm:${dm}`,
        type: "dm",
        name: `Bilibili Fan DM ${dm}`,
        topic: `Private messages with fan ${dm}`,
      });
    }

    parts.push({
      id: "dynamic",
      type: "channel",
      name: "Bilibili Dynamic Feed (Playwright)",
      topic: "Automated feed dynamic posts and updates via Playwright browser automation",
    });

    return parts;
  }

  /**
   * Returns active authenticated session cookies if loaded.
   */
  getCookies(): Record<string, string> | undefined {
    return this.cookies ? { ...this.cookies } : undefined;
  }

  /**
   * Returns authenticated owner UID if loaded.
   */
  getOwnerUid(): string | undefined {
    return this.ownerUid;
  }
}
