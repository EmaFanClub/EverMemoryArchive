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
} from "../../interfaces.js";
import { assertAgentIdentity } from "../../minimal.js";
import {
  BilibiliLoginManager,
  type BilibiliLoginOptions,
  type BilibiliAuthResult,
  type BilibiliPublishDynamicResult,
  publishBilibiliDynamic,
} from "./login.js";

export * from "./login.js";
export * from "./types.js";
export * from "./filter.js";

import {
  type BilibiliDanmakuSendOptions,
  type BilibiliCommentSendOptions,
  type BilibiliDmSendOptions,
  type BilibiliLiveRawEvent,
  type BilibiliRawComment,
  type BilibiliRawDm,
  type BilibiliRateLimitConfig,
  type BilibiliContentFilterConfig,
  type BilibiliDispatchRecord,
  type BilibiliWorldOptions,
  type ThankGiftOptions,
  type ThankSuperChatOptions,
  type ThankGuardOptions,
  type BilibiliChannel,
  type BilibiliChannelKind,
  type EmaNode,
  type EmaChannel,
  type EmaChannelItem,
  type EmaTemporalContext,
  type EmaTemporalEnvelope,
  type EmaActionDoc,
  createTemporalEnvelope,
  formatAgentRelativeTime,
  BilibiliRateLimitError,
  BilibiliContentFilterError,
} from "./types.js";
import { checkBilibiliContentFilter } from "./filter.js";

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

  private timezone: string;
  private commentLikeSender?: (
    targetId: string,
    commentId: string,
  ) => Promise<void> | void;

  // Statements for social primitives (RFC-0002)
  private insertSocialNodeStmt: StatementSync | null = null;
  private selectSocialNodeStmt: StatementSync | null = null;
  private selectSocialNodeByHandleStmt: StatementSync | null = null;

  private insertSocialChannelStmt: StatementSync | null = null;
  private selectSocialChannelStmt: StatementSync | null = null;
  private selectAllSocialChannelsStmt: StatementSync | null = null;

  private insertSocialItemStmt: StatementSync | null = null;
  private selectSocialItemStmt: StatementSync | null = null;
  private selectSocialItemsByChannelStmt: StatementSync | null = null;
  private selectSocialRepliesStmt: StatementSync | null = null;

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

    const defaultStatePath = path.resolve(process.cwd(), "bilibili-storage-state.json");
    const statePath = options.storageStatePath ?? defaultStatePath;

    const defaultCookiePath = path.resolve(process.cwd(), "bilibili-cookies.json");
    const cookiePath = options.cookiePath ?? defaultCookiePath;

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
    this.commentLikeSender = options.commentLikeSender;
    this.timezone = options.timezone ?? "Asia/Shanghai";

    this.dbPath = options.dbPath ?? "/tmp/ema-minimal-workspace/bilibili-state.sqlite";

    this.initSqlite();
    this.loadState();
    this.initSocialPrimitives();
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
        CREATE TABLE IF NOT EXISTS seen_social_nodes (
          id TEXT PRIMARY KEY,
          world TEXT NOT NULL,
          node_kind TEXT NOT NULL,
          name TEXT NOT NULL,
          handle TEXT,
          avatar_url TEXT,
          metadata_json TEXT,
          fetched_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS seen_social_channels (
          id TEXT PRIMARY KEY,
          world TEXT NOT NULL,
          channel_kind TEXT NOT NULL,
          owner_node_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          linked_channels_json TEXT,
          metadata_json TEXT,
          fetched_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS seen_social_items (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          author_node_id TEXT NOT NULL,
          name TEXT,
          content TEXT NOT NULL,
          created_at_iso TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          fetched_at_ms INTEGER NOT NULL,
          parent_item_id TEXT,
          url TEXT,
          metadata_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_social_items_channel ON seen_social_items(channel_id, created_at_ms DESC);
      `);
      this.insertSeenStmt = this.db.prepare(
        "INSERT OR IGNORE INTO seen_bilibili_events (id, type, part_id, timestamp) VALUES (?, ?, ?, ?)",
      );
      this.selectAllSeenStmt = this.db.prepare("SELECT id FROM seen_bilibili_events");

      this.insertSocialNodeStmt = this.db.prepare(
        `INSERT INTO seen_social_nodes (id, world, node_kind, name, handle, avatar_url, metadata_json, fetched_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           handle=COALESCE(excluded.handle, seen_social_nodes.handle),
           avatar_url=COALESCE(excluded.avatar_url, seen_social_nodes.avatar_url),
           metadata_json=COALESCE(excluded.metadata_json, seen_social_nodes.metadata_json),
           fetched_at_ms=excluded.fetched_at_ms`,
      );
      this.selectSocialNodeStmt = this.db.prepare(
        "SELECT * FROM seen_social_nodes WHERE id = ?",
      );
      this.selectSocialNodeByHandleStmt = this.db.prepare(
        "SELECT * FROM seen_social_nodes WHERE handle = ?",
      );

      this.insertSocialChannelStmt = this.db.prepare(
        `INSERT INTO seen_social_channels (id, world, channel_kind, owner_node_id, name, description, linked_channels_json, metadata_json, fetched_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           description=COALESCE(excluded.description, seen_social_channels.description),
           linked_channels_json=COALESCE(excluded.linked_channels_json, seen_social_channels.linked_channels_json),
           metadata_json=COALESCE(excluded.metadata_json, seen_social_channels.metadata_json),
           fetched_at_ms=excluded.fetched_at_ms`,
      );
      this.selectSocialChannelStmt = this.db.prepare(
        "SELECT * FROM seen_social_channels WHERE id = ?",
      );
      this.selectAllSocialChannelsStmt = this.db.prepare(
        "SELECT * FROM seen_social_channels",
      );

      this.insertSocialItemStmt = this.db.prepare(
        `INSERT INTO seen_social_items (id, channel_id, author_node_id, name, content, created_at_iso, created_at_ms, fetched_at_ms, parent_item_id, url, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content=excluded.content,
           name=COALESCE(excluded.name, seen_social_items.name),
           parent_item_id=COALESCE(excluded.parent_item_id, seen_social_items.parent_item_id),
           url=COALESCE(excluded.url, seen_social_items.url),
           metadata_json=COALESCE(excluded.metadata_json, seen_social_items.metadata_json),
           fetched_at_ms=excluded.fetched_at_ms`,
      );
      this.selectSocialItemStmt = this.db.prepare(
        "SELECT * FROM seen_social_items WHERE id = ?",
      );
      this.selectSocialItemsByChannelStmt = this.db.prepare(
        "SELECT * FROM seen_social_items WHERE channel_id = ? ORDER BY created_at_ms DESC",
      );
      this.selectSocialRepliesStmt = this.db.prepare(
        "SELECT * FROM seen_social_items WHERE parent_item_id = ? ORDER BY created_at_ms ASC",
      );
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

  private initSocialPrimitives(): void {
    const ownerUid = this.ownerUid || "default";
    const ownerNodeId = this.ownerUid ? `bilibili:person:${this.ownerUid}` : "bilibili:person:default";
    const spaceChannelId = `bilibili:space:${ownerUid}`;
    const dynamicChannelId = `bilibili:dynamic:${ownerUid}`;
    const liveRoomChannelIds = this.rooms.map((r) => `bilibili:live_room:${r}`);
    const videoChannelIds = this.videoTargets.map((v) => `bilibili:video:${v.replace(/^(video|opus):/, "")}`);

    const allChannelIds = [
      spaceChannelId,
      dynamicChannelId,
      ...liveRoomChannelIds,
      ...videoChannelIds,
    ];

    const ownerName =
      this.ownerUid === "3546869527480631"
        ? "Sakana酱ノ"
        : this.ownerUid
          ? `Bilibili Creator (${this.ownerUid})`
          : "Bilibili Companion";

    this.indexSocialNode({
      id: ownerNodeId,
      world: "bilibili",
      node_kind: "person",
      name: ownerName,
      handle: this.ownerUid || "default",
      channelIds: allChannelIds,
      metadata: {
        ownerUid: this.ownerUid,
      },
    });

    this.indexSocialChannel({
      id: spaceChannelId,
      world: "bilibili",
      channel_kind: "space",
      ownerNodeId,
      name: `${ownerName}的空间`,
      description: "Bilibili 个人主页与空间聚合频道",
      linkedChannelIds: [dynamicChannelId, ...liveRoomChannelIds],
      metadata: { ownerUid: this.ownerUid },
    });

    this.indexSocialChannel({
      id: dynamicChannelId,
      world: "bilibili",
      channel_kind: "dynamic",
      ownerNodeId,
      name: `${ownerName}的动态`,
      description: "Bilibili 动态发布与交互流",
      linkedChannelIds: [spaceChannelId, ...liveRoomChannelIds],
      metadata: { ownerUid: this.ownerUid },
    });

    for (const room of this.rooms) {
      this.indexSocialChannel({
        id: `bilibili:live_room:${room}`,
        world: "bilibili",
        channel_kind: "live_room",
        ownerNodeId,
        name: `直播间 ${room}`,
        description: `Bilibili 直播间弹幕互动频道 (${room})`,
        linkedChannelIds: [spaceChannelId, dynamicChannelId],
        metadata: { roomId: room },
      });
    }

    for (const target of this.videoTargets) {
      const cleanBvid = target.replace(/^(video|opus):/, "");
      this.indexSocialChannel({
        id: `bilibili:video:${cleanBvid}`,
        world: "bilibili",
        channel_kind: "video",
        ownerNodeId,
        name: `视频 ${cleanBvid}`,
        description: `Bilibili 视频评论与互动频道 (${cleanBvid})`,
        linkedChannelIds: [spaceChannelId],
        metadata: { bvid: cleanBvid, targetId: target },
      });
    }
  }

  indexSocialNode(node: EmaNode): EmaNode {
    const fetchedAtMs = Date.now();
    if (this.db && this.insertSocialNodeStmt) {
      this.insertSocialNodeStmt.run(
        node.id,
        node.world,
        node.node_kind,
        node.name,
        node.handle ?? null,
        node.avatarUrl ?? null,
        node.metadata ? JSON.stringify(node.metadata) : null,
        fetchedAtMs,
      );
    }
    return node;
  }

  getSocialNode(id: string): EmaNode | null {
    if (this.db && this.selectSocialNodeStmt) {
      let row = this.selectSocialNodeStmt.get(id) as Record<string, unknown> | undefined;
      if (!row && !id.startsWith("bilibili:person:")) {
        row = this.selectSocialNodeStmt.get(`bilibili:person:${id}`) as Record<string, unknown> | undefined;
      }
      if (!row && this.selectSocialNodeByHandleStmt) {
        row = this.selectSocialNodeByHandleStmt.get(id) as Record<string, unknown> | undefined;
      }
      if (row) {
        const channelRows = this.selectAllSocialChannelsStmt?.all() as Array<Record<string, unknown>> | undefined;
        const channelIds = (channelRows || [])
          .filter((c) => c.owner_node_id === row!.id)
          .map((c) => String(c.id));

        return {
          id: String(row.id),
          world: String(row.world),
          node_kind: String(row.node_kind),
          name: String(row.name),
          handle: row.handle ? String(row.handle) : undefined,
          avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
          channelIds: channelIds.length > 0 ? channelIds : undefined,
          metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : undefined,
        };
      }
    }
    return null;
  }

  indexSocialChannel(channel: BilibiliChannel): BilibiliChannel {
    const fetchedAtMs = Date.now();
    if (this.db && this.insertSocialChannelStmt) {
      this.insertSocialChannelStmt.run(
        channel.id,
        channel.world,
        channel.channel_kind,
        channel.ownerNodeId ?? null,
        channel.name,
        channel.description ?? null,
        channel.linkedChannelIds ? JSON.stringify(channel.linkedChannelIds) : null,
        channel.metadata ? JSON.stringify(channel.metadata) : null,
        fetchedAtMs,
      );
    }
    return channel;
  }

  getSocialChannel(id: string): BilibiliChannel | null {
    const channels = this.listSocialChannels();
    let found = channels.find((c) => c.id === id);
    if (found) return found;

    const norm = id.toLowerCase();
    const cleanTarget = norm.replace(/^(bilibili:)?(live_room:|room:|video:|opus:)/, "");
    found = channels.find((c) => {
      const cIdLower = c.id.toLowerCase();
      if (cIdLower === norm) return true;
      if (norm === "dynamic" && c.channel_kind === "dynamic") return true;
      if (norm === "space" && c.channel_kind === "space") return true;
      if (
        (norm === "room" ||
          norm.startsWith("room:") ||
          norm.startsWith("live_room:") ||
          norm.startsWith("bilibili:live_room:")) &&
        c.channel_kind === "live_room" &&
        cIdLower.includes(cleanTarget)
      ) {
        return true;
      }
      if (
        (norm.startsWith("video:") ||
          norm.startsWith("opus:") ||
          norm.startsWith("bilibili:video:") ||
          norm.startsWith("bv")) &&
        c.channel_kind === "video" &&
        cIdLower.includes(cleanTarget)
      ) {
        return true;
      }
      return false;
    });
    return found || null;
  }

  listSocialChannels(): BilibiliChannel[] {
    if (this.db && this.selectAllSocialChannelsStmt) {
      const rows = this.selectAllSocialChannelsStmt.all() as Array<Record<string, unknown>>;
      if (rows && rows.length > 0) {
        return rows.map((row) => ({
          id: String(row.id),
          world: "bilibili" as const,
          channel_kind: String(row.channel_kind) as BilibiliChannelKind,
          ownerNodeId: row.owner_node_id ? String(row.owner_node_id) : undefined,
          name: String(row.name),
          description: row.description ? String(row.description) : undefined,
          linkedChannelIds: row.linked_channels_json ? JSON.parse(String(row.linked_channels_json)) : undefined,
          metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : undefined,
        }));
      }
    }
    return [];
  }

  indexSocialItem(item: {
    id: string;
    channelId: string;
    authorNodeId: string;
    name?: string;
    content: string;
    createdAtIso?: string;
    createdAtMs?: number;
    fetchedAtMs?: number;
    parentItemId?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  }): EmaChannelItem {
    const createdAtMs =
      item.createdAtMs ??
      (item.createdAtIso ? new Date(item.createdAtIso).getTime() : Date.now());
    const createdAtIso = item.createdAtIso ?? new Date(createdAtMs).toISOString();
    const fetchedAtMs = item.fetchedAtMs ?? Date.now();

    if (this.db && this.insertSocialItemStmt) {
      this.insertSocialItemStmt.run(
        item.id,
        item.channelId,
        item.authorNodeId,
        item.name ?? null,
        item.content,
        createdAtIso,
        createdAtMs,
        fetchedAtMs,
        item.parentItemId ?? null,
        item.url ?? null,
        item.metadata ? JSON.stringify(item.metadata) : null,
      );
    }

    const resultItem: EmaChannelItem = {
      id: item.id,
      channelId: item.channelId,
      authorNodeId: item.authorNodeId,
      name: item.name,
      content: item.content,
      createdAtIso,
      createdAt: formatAgentRelativeTime(createdAtMs, fetchedAtMs),
      fetchedAtMs,
      fetchedAt: formatAgentRelativeTime(fetchedAtMs, fetchedAtMs),
      parentItemId: item.parentItemId,
      url: item.url,
      metadata: item.metadata,
    };
    return resultItem;
  }

  listSocialItems(channelId: string, referenceMs: number = Date.now()): EmaChannelItem[] {
    if (this.db && this.selectSocialItemsByChannelStmt) {
      const rows = this.selectSocialItemsByChannelStmt.all(channelId) as Array<Record<string, unknown>>;
      if (rows) {
        return rows.map((row) => this.mapRowToChannelItem(row, referenceMs));
      }
    }
    return [];
  }

  getSocialItem(id: string, referenceMs: number = Date.now()): EmaChannelItem | null {
    if (this.db && this.selectSocialItemStmt) {
      const row = this.selectSocialItemStmt.get(id) as Record<string, unknown> | undefined;
      if (row) {
        return this.mapRowToChannelItem(row, referenceMs);
      }
    }
    return null;
  }

  getSocialItemWithReplies(
    id: string,
    referenceMs: number = Date.now(),
  ): ({
    context: EmaTemporalContext;
    item: EmaChannelItem;
    replies: EmaChannelItem[];
  } & EmaChannelItem) | null {
    const item = this.getSocialItem(id, referenceMs);
    if (!item) return null;

    let replies: EmaChannelItem[] = [];
    if (this.db && this.selectSocialRepliesStmt) {
      try {
        const rows = this.selectSocialRepliesStmt.all(id) as Array<Record<string, unknown>>;
        if (rows) {
          replies = rows.map((r) => this.mapRowToChannelItem(r, referenceMs));
        }
      } catch (err) {
        console.error("[BilibiliWorld] Failed to get replies for item:", err);
      }
    }

    const envelope = createTemporalEnvelope([item], referenceMs, this.timezone);
    return {
      ...item,
      context: envelope.context,
      item,
      replies,
    };
  }

  private mapRowToChannelItem(row: Record<string, unknown>, referenceMs: number): EmaChannelItem {
    const createdAtMs = Number(row.created_at_ms || Date.now());
    const fetchedAtMs = Number(row.fetched_at_ms || Date.now());
    const createdAtIso = String(row.created_at_iso || new Date(createdAtMs).toISOString());

    return {
      id: String(row.id),
      channelId: String(row.channel_id),
      authorNodeId: String(row.author_node_id),
      name: row.name ? String(row.name) : undefined,
      content: String(row.content),
      createdAtIso,
      createdAt: formatAgentRelativeTime(createdAtMs, referenceMs),
      fetchedAtMs,
      fetchedAt: formatAgentRelativeTime(fetchedAtMs, referenceMs),
      parentItemId: row.parent_item_id ? String(row.parent_item_id) : undefined,
      url: row.url ? String(row.url) : undefined,
      metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : undefined,
    };
  }

  listActions(): EmaActionDoc[] {
    return [
      {
        name: "post.publish",
        description: "Publishes a new dynamic post to Bilibili",
        parameters: {
          message: {
            type: "string",
            required: true,
            description: "Content of the dynamic post to publish",
          },
        },
        rateLimit: "1/15s",
        example: { message: "【EverMemoryArchive】Ema 伴侣系统运行测试：记忆归档与动态感知连接正常 ✨" },
      },
      {
        name: "comment.reply",
        description: "Replies to a video or dynamic comment thread",
        parameters: {
          targetId: {
            type: "string",
            required: true,
            description: "Target video (bvid/video:BV...) or opus target ID",
          },
          message: {
            type: "string",
            required: true,
            description: "Comment reply text",
          },
          rootId: {
            type: "string",
            required: false,
            description: "Optional root comment rpid for threaded replies",
          },
        },
        rateLimit: "20/minute",
        example: { targetId: "video:BV1xx411c7mD", message: "感谢您的支持与评论！" },
      },
      {
        name: "comment.like",
        description: "Likes a comment under a video or dynamic post",
        parameters: {
          postId: {
            type: "string",
            required: true,
            description: "Target post or video/dynamic ID",
          },
          commentId: {
            type: "string",
            required: true,
            description: "Target comment rpid to like",
          },
        },
        rateLimit: "30/minute",
        example: { postId: "video:BV1xx411c7mD", commentId: "9988776655" },
      },
      {
        name: "danmaku.send",
        description: "Sends a live danmaku (barrage) message to a Bilibili live room",
        parameters: {
          roomId: {
            type: "string",
            required: true,
            description: "Live room ID",
          },
          message: {
            type: "string",
            required: true,
            description: "Danmaku message text",
          },
          color: {
            type: "string",
            required: false,
            description: "Optional font color hex code",
          },
        },
        rateLimit: "30/minute",
        example: { roomId: "123456", message: "欢迎来到直播间！" },
      },
      {
        name: "dm.send",
        description: "Sends a direct message to a fan or user",
        parameters: {
          mid: {
            type: "string",
            required: true,
            description: "Target fan MID",
          },
          message: {
            type: "string",
            required: true,
            description: "Direct message content",
          },
        },
        rateLimit: "30/minute",
        example: { mid: "1001", message: "私信已收到，感谢您的反馈！" },
      },
      {
        name: "danmaku.thank_gift",
        description: "Broadcasts a thank-you message for gift donation in a live room",
        parameters: {
          roomId: { type: "string", required: true, description: "Live room ID" },
          uname: { type: "string", required: true, description: "Gifter user name" },
          giftName: { type: "string", required: true, description: "Gift name" },
          num: { type: "number", required: false, description: "Number of gifts" },
        },
        rateLimit: "30/minute",
        example: { roomId: "123456", uname: "Sakana", giftName: "辣条", num: 10 },
      },
      {
        name: "danmaku.thank_superchat",
        description: "Broadcasts a thank-you message for SuperChat in a live room",
        parameters: {
          roomId: { type: "string", required: true, description: "Live room ID" },
          uname: { type: "string", required: true, description: "SuperChat sender user name" },
          price: { type: "number", required: true, description: "SuperChat donation amount in RMB" },
        },
        rateLimit: "30/minute",
        example: { roomId: "123456", uname: "Sakana", price: 50 },
      },
      {
        name: "danmaku.thank_guard",
        description: "Broadcasts a thank-you message for Guard or Captain membership",
        parameters: {
          roomId: { type: "string", required: true, description: "Live room ID" },
          uname: { type: "string", required: true, description: "Buyer user name" },
          guardLevel: { type: "number", required: true, description: "Guard level (1: Governor, 2: Admiral, 3: Captain)" },
        },
        rateLimit: "30/minute",
        example: { roomId: "123456", uname: "Sakana", guardLevel: 3 },
      },
    ];
  }

  getAction(name: string): EmaActionDoc | null {
    const norm = name.toLowerCase();
    return this.listActions().find((a) => a.name.toLowerCase() === norm) || null;
  }

  private async dispatchActionEndpoint(
    actionName: string,
    body: Record<string, unknown>,
    routeCtx: EmaRouteContext,
  ): Promise<{
    success: boolean;
    action: string;
    target?: string;
    message?: string;
    dispatchId?: string;
    result?: unknown;
  }> {
    const actionDoc = this.getAction(actionName);
    if (!actionDoc) {
      throw new Error(`Action not found: ${actionName}`);
    }

    for (const [paramName, paramDoc] of Object.entries(actionDoc.parameters)) {
      if (paramDoc.required) {
        const val =
          body[paramName] ??
          (paramName === "message" ? (body.text || body.content) : undefined);
        if (val === undefined || val === null || val === "") {
          throw new Error(`Missing required parameter '${paramName}' for action '${actionName}'`);
        }
      }
    }

    const actor: EmaActor = (body.actor as EmaActor) || {
      id: (body.actorId as string) || "actor:bilibili-endpoint",
      agentId: this.env.PENGUIN_AGENT_ID || "emafanclub_ema_dev",
      session: (body.session as string) || "session-bilibili-endpoint",
    };

    const dummyCtx: EmaCtx = this.runtimeCtx || {
      router: routeCtx as unknown as any,
      inputBatcher: null as any,
      registry: null as any,
    };

    this.interact(dummyCtx, actor, actionName, body);

    const lastDispatch = this.dispatchesHistory[this.dispatchesHistory.length - 1];

    return {
      success: true,
      action: actionName,
      target: lastDispatch?.target,
      message: lastDispatch?.message,
      dispatchId: lastDispatch?.id,
    };
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

      // RFC-0002 Social Media Channel Endpoints
      if (subpath === "channels") {
        return {
          channels: this.listSocialChannels(),
        };
      }

      if (subpath.startsWith("channels/")) {
        const channelSubpath = decodeURIComponent(subpath.replace(/^channels\//, ""));
        if (channelSubpath.endsWith("/items")) {
          const rawChannelId = channelSubpath.replace(/\/items$/, "");
          const channel = this.getSocialChannel(rawChannelId);
          if (!channel) {
            throw new Error(`Channel not found: ${rawChannelId}`);
          }
          const referenceMs = routeCtx.query?.get("time")
            ? new Date(routeCtx.query.get("time")!).getTime()
            : Date.now();
          const items = this.listSocialItems(channel.id, referenceMs);
          const envelope = createTemporalEnvelope(items, referenceMs, this.timezone);
          return {
            context: envelope.context,
            channel,
            items: envelope.items,
          };
        } else {
          const channel = this.getSocialChannel(channelSubpath);
          if (!channel) {
            throw new Error(`Channel not found: ${channelSubpath}`);
          }
          return channel;
        }
      }

      if (subpath.startsWith("nodes/")) {
        const rawNodeId = decodeURIComponent(subpath.replace(/^nodes\//, ""));
        const node = this.getSocialNode(rawNodeId);
        if (!node) {
          throw new Error(`Node not found: ${rawNodeId}`);
        }
        return node;
      }

      if (subpath.startsWith("items/")) {
        const rawItemId = decodeURIComponent(subpath.replace(/^items\//, ""));
        const referenceMs = routeCtx.query?.get("time")
          ? new Date(routeCtx.query.get("time")!).getTime()
          : Date.now();
        const itemWithReplies = this.getSocialItemWithReplies(rawItemId, referenceMs);
        if (!itemWithReplies) {
          throw new Error(`Item not found: ${rawItemId}`);
        }
        return itemWithReplies;
      }

      if (subpath === "actions") {
        return {
          actions: this.listActions(),
        };
      }

      if (subpath.startsWith("actions/")) {
        const actionName = decodeURIComponent(subpath.replace(/^actions\//, ""));
        if (routeCtx.method === "POST") {
          const body = (routeCtx.body || {}) as Record<string, unknown>;
          return this.dispatchActionEndpoint(actionName, body, routeCtx);
        }
        const actionDoc = this.getAction(actionName);
        if (!actionDoc) {
          throw new Error(`Action not found: ${actionName}`);
        }
        return actionDoc;
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
        const text = (d.msg || (d as any).text || "").trim();
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

      // Read-through indexing into seen_social_items & seen_social_nodes
      const senderUid = input.sender?.id ? input.sender.id.replace(/^user:/, "") : "anonymous";
      this.indexSocialItem({
        id: input.id,
        channelId: `bilibili:live_room:${normalizedRoom}`,
        authorNodeId: `bilibili:person:${senderUid}`,
        content: input.content,
        createdAtMs: input.timestamp,
        fetchedAtMs: Date.now(),
        metadata: input.metadata,
      });

      if (senderUid && input.sender?.name) {
        this.indexSocialNode({
          id: `bilibili:person:${senderUid}`,
          world: "bilibili",
          node_kind: "person",
          name: input.sender.name,
          handle: senderUid,
        });
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

          // Read-through indexing into seen_social_items & seen_social_nodes
          const cleanBvid = target.replace(/^(video|opus):/, "");
          this.indexSocialItem({
            id: rpid,
            channelId: `bilibili:video:${cleanBvid}`,
            authorNodeId: `bilibili:person:${senderUid}`,
            content: text,
            createdAtMs: input.timestamp,
            fetchedAtMs: Date.now(),
            parentItemId: parentRpid,
            metadata: input.metadata,
          });

          if (senderUid && raw.uname) {
            this.indexSocialNode({
              id: `bilibili:person:${senderUid}`,
              world: "bilibili",
              node_kind: "person",
              name: raw.uname,
              handle: senderUid,
            });
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

    let normId = this.normalizePartTarget(id);

    // 2. Parse action and payload
    let action = "reply";
    let messageText = "";
    let actionOptions: Record<string, unknown> = {};

    const isDirectHierarchicalAction =
      normId === "comment.like" ||
      normId === "post.publish" ||
      normId === "dynamic.publish" ||
      normId === "comment.reply" ||
      normId === "danmaku.send" ||
      normId === "dm.send" ||
      normId === "danmaku.thank_gift" ||
      normId === "danmaku.thank_superchat" ||
      normId === "danmaku.thank_guard";

    if (isDirectHierarchicalAction) {
      action = normId;
      if (typeof args[0] === "string") {
        messageText = args[0];
        if (typeof args[1] === "object" && args[1] !== null) {
          actionOptions = args[1] as Record<string, unknown>;
        }
      } else if (typeof args[0] === "object" && args[0] !== null) {
        actionOptions = args[0] as Record<string, unknown>;
        messageText = String(actionOptions.message || actionOptions.text || actionOptions.content || "");
      }

      if (action === "comment.like") {
        normId = String(actionOptions.postId || actionOptions.targetId || this.videoTargets[0] || "video:default");
      } else if (action === "post.publish" || action === "dynamic.publish") {
        normId = "dynamic";
      } else if (action === "danmaku.send" || action.startsWith("danmaku.thank_")) {
        const r = actionOptions.roomId ? String(actionOptions.roomId) : (this.rooms[0] || "123456");
        normId = r.startsWith("room:") ? r : `room:${r}`;
      } else if (action === "comment.reply") {
        const t = actionOptions.targetId || actionOptions.postId ? String(actionOptions.targetId || actionOptions.postId) : (this.videoTargets[0] || "default");
        normId = t.startsWith("video:") || t.startsWith("opus:") ? t : `video:${t}`;
      } else if (action === "dm.send") {
        const m = actionOptions.mid ? String(actionOptions.mid) : (this.dmTargets[0] || "default");
        normId = m.startsWith("dm:") ? m : `dm:${m}`;
      }
    } else {
      if (args.length > 0) {
        const first = args[0];
        if (typeof first === "string") {
          const lower = first.toLowerCase();
          if (
            lower === "danmaku" ||
            lower === "danmaku.send" ||
            lower === "send_danmaku" ||
            lower === "barrage" ||
            lower === "thank_gift" ||
            lower === "danmaku.thank_gift" ||
            lower === "thank_superchat" ||
            lower === "danmaku.thank_superchat" ||
            lower === "thank_guard" ||
            lower === "danmaku.thank_guard" ||
            lower === "comment" ||
            lower === "comment.reply" ||
            lower === "reply_comment" ||
            lower === "comment.like" ||
            lower === "pin_comment" ||
            lower === "dm" ||
            lower === "dm.send" ||
            lower === "send_dm" ||
            lower === "reply" ||
            lower === "post" ||
            lower === "post.publish" ||
            lower === "dynamic.publish" ||
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
              messageText = String(actionOptions.message || actionOptions.text || actionOptions.content || "");
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
          messageText = String(obj.message || obj.text || obj.content || "");
        }
      }
    }

    // 3. Handle specialized thank-you actions
    if (action === "thank_gift" || action === "danmaku.thank_gift") {
      messageText = this.formatThankGift(actionOptions as unknown as ThankGiftOptions);
    } else if (action === "thank_superchat" || action === "danmaku.thank_superchat") {
      messageText = this.formatThankSuperChat(actionOptions as unknown as ThankSuperChatOptions);
    } else if (action === "thank_guard" || action === "danmaku.thank_guard") {
      messageText = this.formatThankGuard(actionOptions as unknown as ThankGuardOptions);
    }

    if (!messageText && action !== "pin_comment" && action !== "comment.like") {
      throw new Error(`No message text provided for Bilibili interaction on ${id}`);
    }

    // 4. Content safety check (Banned / sensitive words)
    const sanitizedText = messageText ? this.checkContentFilter(messageText) : "";

    // 5. Anti-flooding rate limit check & Dispatch execution
    const now = Date.now();

    if (action === "comment.like") {
      const commentId = String(actionOptions.commentId || "");
      if (!commentId) {
        throw new Error("Missing required parameter 'commentId' for comment.like");
      }
      this.checkCommentRateLimit(normId, now);

      try {
        const res = this.commentLikeSender ? this.commentLikeSender(normId, commentId) : undefined;
        if (res && typeof (res as Promise<void>).catch === "function") {
          (res as Promise<void>).catch((err) => {
            console.error(`[BilibiliWorld] Failed to like comment ${commentId} on ${normId}:`, err);
          });
        }
      } catch (err) {
        console.error(`[BilibiliWorld] Failed to like comment ${commentId} on ${normId}:`, err);
      }
    } else if (normId.startsWith("room:")) {
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

      this.indexSocialItem({
        id: `danmaku-out-${now}-${Math.random().toString(36).slice(2, 7)}`,
        channelId: `bilibili:live_room:${roomId}`,
        authorNodeId: this.ownerUid ? `bilibili:person:${this.ownerUid}` : "bilibili:person:default",
        content: sanitizedText,
        createdAtMs: now,
        fetchedAtMs: now,
        metadata: { type: "outbound_danmaku", roomId, actorId: actor.id },
      });
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

      const cleanBvid = normId.replace(/^(video|opus):/, "");
      this.indexSocialItem({
        id: `comment-out-${now}-${Math.random().toString(36).slice(2, 7)}`,
        channelId: `bilibili:video:${cleanBvid}`,
        authorNodeId: this.ownerUid ? `bilibili:person:${this.ownerUid}` : "bilibili:person:default",
        content: sanitizedText,
        createdAtMs: now,
        fetchedAtMs: now,
        parentItemId: actionOptions.rootId ? String(actionOptions.rootId) : (actionOptions.parentRpid ? String(actionOptions.parentRpid) : undefined),
        metadata: { type: "outbound_comment", targetId: normId, actorId: actor.id },
      });
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
      action === "publish_dynamic" ||
      action === "post.publish" ||
      action === "dynamic.publish"
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

      const dynamicChannelId = `bilibili:dynamic:${this.ownerUid || "default"}`;
      const itemId = `dynamic-${now}-${Math.random().toString(36).slice(2, 7)}`;
      this.indexSocialItem({
        id: itemId,
        channelId: dynamicChannelId,
        authorNodeId: this.ownerUid ? `bilibili:person:${this.ownerUid}` : "bilibili:person:default",
        name: sanitizedText.slice(0, 30),
        content: sanitizedText,
        createdAtMs: now,
        fetchedAtMs: now,
        url: `https://t.bilibili.com/${itemId}`,
        metadata: {
          action,
          actorId: actor.id,
        },
      });
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
      message: action === "comment.like" ? `like: comment ${actionOptions.commentId} on ${normId}` : sanitizedText,
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
    return checkBilibiliContentFilter(
      text,
      this.contentFilter,
      this.bannedWords,
      this.bannedWordAction,
    );
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
      trimmed === "comment.like" ||
      trimmed === "post.publish" ||
      trimmed === "dynamic.publish" ||
      trimmed === "comment.reply" ||
      trimmed === "danmaku.send" ||
      trimmed === "dm.send" ||
      trimmed === "danmaku.thank_gift" ||
      trimmed === "danmaku.thank_superchat" ||
      trimmed === "danmaku.thank_guard"
    ) {
      return trimmed;
    }
    if (trimmed.startsWith("bilibili:live_room:")) {
      return `room:${trimmed.replace("bilibili:live_room:", "")}`;
    }
    if (trimmed.startsWith("bilibili:video:") || trimmed.startsWith("bilibili:opus:")) {
      return trimmed.replace("bilibili:", "");
    }
    if (trimmed.startsWith("bilibili:dynamic")) {
      return "dynamic";
    }
    if (trimmed.startsWith("bilibili:space")) {
      return "space";
    }
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
