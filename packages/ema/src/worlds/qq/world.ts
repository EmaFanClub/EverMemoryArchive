/**
 * @prism-shadow/ema - QQWorld (OneBot 11 / QQ Gateway & Social Channels)
 *
 * Implements QQ & Snowluma input, action, and social media channel adapter for EverMemoryArchive.
 * Conforms to:
 * - RFC-0001 (EmaWorld and EmaActor interfaces, multi-part topology, transactional input batching)
 * - RFC-0002 (Social Media Channel Architecture: EmaNode, QQChannel, EmaChannelItem,
 *   Read-Through SQLite indexing, anchored temporal perception, and hierarchical action introspection)
 *
 * Board Task Associations:
 * - Input Node: node-mw33skpc-825f (Snowluma Input Adapter: OneBot 11 gateway
 *   listening, group/private message filtering, poke events, and payload normalization).
 * - Action Node: node-mw3giuy1-d39y (Snowluma Action Execution: Private and group
 *   chat responses, rich CQ codes, proactive greetings, and intimacy-gated interaction).
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  EmaWorld,
  type EmaCtx,
  type EmaActor,
  type EmaInput,
  type EmaSender,
  type Disposable,
  type EmaWorldPart,
  type Id,
  type EmaRouteContext,
  Interface,
} from "../../interfaces.js";
import {
  type EmaNode,
  type EmaChannelItem,
  type EmaTemporalContext,
  type EmaActionDoc,
  createTemporalEnvelope,
  formatAgentRelativeTime,
} from "../../channel.js";
import { assertAgentIdentity } from "../../minimal.js";
import {
  QQLoginManager,
  type QQLoginOptions,
  type QQQrCodeInfo,
  type QQScanStatus,
  type QQAuthResult,
} from "./login.js";
import { checkQQContentFilter } from "./filter.js";
import {
  type QQChannel,
  type QQChannelKind,
  type OneBotMessageType,
  type OneBotSender,
  type OneBotSegment,
  type OneBotEvent,
  type OneBotApiCall,
  type OneBotApiResponse,
  type RelationalIntimacyStage,
  type UserIntimacyProfile,
  type QQDeliveryReceipt,
  type QQInputMetadata,
  type QQContentFilterConfig,
  type QQRateLimitConfig,
  type QQWorldOptions,
  type QQInteractActionPayload,
  QQRateLimitError,
  QQContentFilterError,
} from "./types.js";

export * from "./types.js";
export * from "./login.js";
export * from "./filter.js";

const INTIMACY_STAGE_ORDER: Record<RelationalIntimacyStage, number> = {
  stranger: 0,
  acquaintance: 20,
  casual_friend: 40,
  close_friend: 60,
  trusted_companion: 80,
  soulmate: 95,
};

export function compareIntimacy(
  a: RelationalIntimacyStage,
  b: RelationalIntimacyStage,
): number {
  return INTIMACY_STAGE_ORDER[a] - INTIMACY_STAGE_ORDER[b];
}

export function computeIntimacyStage(score: number): RelationalIntimacyStage {
  if (score >= 95) return "soulmate";
  if (score >= 80) return "trusted_companion";
  if (score >= 60) return "close_friend";
  if (score >= 40) return "casual_friend";
  if (score >= 20) return "acquaintance";
  return "stranger";
}

/**
 * Unescapes CQ code parameter values according to OneBot 11 standard.
 */
export function unescapeCQValue(val: string): string {
  return val
    .replace(/&#44;/g, ",")
    .replace(/&#91;/g, "[")
    .replace(/&#93;/g, "]")
    .replace(/&amp;/g, "&");
}

/**
 * Escapes values for embedding inside CQ codes.
 */
export function escapeCQValue(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/,/g, "&#44;");
}

/**
 * Unescapes normal text received in OneBot 11 messages.
 */
export function unescapeCQText(text: string): string {
  return text
    .replace(/&#91;/g, "[")
    .replace(/&#93;/g, "]")
    .replace(/&amp;/g, "&");
}

/**
 * Escapes text when building outgoing messages containing CQ codes.
 */
export function escapeCQText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;");
}

/**
 * Parses CQ code parameters from a raw param string, e.g. ",qq=123,file=abc".
 */
export function parseCQParams(rawParams: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawParams) return result;
  const entries = rawParams.startsWith(",") ? rawParams.slice(1) : rawParams;
  if (!entries) return result;

  const paramRe = /(?:^|,)([a-zA-Z0-9_-]+)=([\s\S]*?)(?=(?:,[a-zA-Z0-9_-]+=)|$)/g;
  let match: RegExpExecArray | null;
  while ((match = paramRe.exec(entries)) !== null) {
    result[match[1]] = unescapeCQValue(match[2]);
  }
  return result;
}

/**
 * Parses a string containing CQ codes into normalized text, replyTo, and rich metadata.
 */
export function parseCQMessage(raw: string): {
  content: string;
  replyTo?: string;
  metadata: QQInputMetadata;
} {
  let replyTo: string | undefined;
  const atUids: string[] = [];
  const images: Array<{ file?: string; url?: string }> = [];
  let voice: { file?: string; url?: string } | undefined;
  let jsonCard: Record<string, unknown> | null = null;

  const cqRegex = /\[CQ:([a-zA-Z0-9_-]+)([\s\S]*?)\]/g;

  const normalized = raw.replace(cqRegex, (_match, type: string, rawParams: string) => {
    const params = parseCQParams(rawParams);

    switch (type) {
      case "reply":
        if (params.id) {
          replyTo = params.id;
        }
        return ""; // Strip reply CQ code from content body
      case "at":
        if (params.qq) {
          atUids.push(params.qq);
          return `@${params.qq}`;
        }
        return "";
      case "image":
        images.push({ file: params.file, url: params.url });
        return "[图片]";
      case "face":
        return `[表情:${params.id || ""}]`;
      case "record":
        voice = { file: params.file, url: params.url };
        return "[语音]";
      case "json":
        if (params.data) {
          try {
            jsonCard = JSON.parse(params.data);
          } catch {
            jsonCard = { raw: params.data };
          }
        }
        return "[卡片消息]";
      default:
        return `[${type}]`;
    }
  });

  const content = unescapeCQText(normalized).trim();

  return {
    content,
    replyTo,
    metadata: {
      rawMessage: raw,
      atUids: atUids.length > 0 ? atUids : undefined,
      images: images.length > 0 ? images : undefined,
      voice,
      jsonCard,
    },
  };
}

/**
 * Parses an array of OneBotSegments into normalized text, replyTo, and metadata.
 */
export function parseSegmentMessage(segments: OneBotSegment[]): {
  content: string;
  replyTo?: string;
  metadata: QQInputMetadata;
} {
  let replyTo: string | undefined;
  const atUids: string[] = [];
  const images: Array<{ file?: string; url?: string }> = [];
  let voice: { file?: string; url?: string } | undefined;
  let jsonCard: Record<string, unknown> | null = null;

  const parts: string[] = [];

  for (const seg of segments) {
    if (!seg || typeof seg.type !== "string") continue;
    const data = seg.data || {};

    switch (seg.type) {
      case "reply":
        if (data.id) {
          replyTo = String(data.id);
        }
        break;
      case "text":
        if (data.text) {
          parts.push(String(data.text));
        }
        break;
      case "at":
        if (data.qq) {
          const qqStr = String(data.qq);
          atUids.push(qqStr);
          parts.push(`@${qqStr}`);
        }
        break;
      case "image":
        images.push({
          file: typeof data.file === "string" ? data.file : undefined,
          url: typeof data.url === "string" ? data.url : undefined,
        });
        parts.push("[图片]");
        break;
      case "face":
        parts.push(`[表情:${data.id ?? ""}]`);
        break;
      case "record":
        voice = {
          file: typeof data.file === "string" ? data.file : undefined,
          url: typeof data.url === "string" ? data.url : undefined,
        };
        parts.push("[语音]");
        break;
      case "json":
        if (data.data) {
          if (typeof data.data === "object") {
            jsonCard = data.data as Record<string, unknown>;
          } else if (typeof data.data === "string") {
            try {
              jsonCard = JSON.parse(data.data);
            } catch {
              jsonCard = { raw: data.data };
            }
          }
        }
        parts.push("[卡片消息]");
        break;
      default:
        parts.push(`[${seg.type}]`);
        break;
    }
  }

  const content = parts.join(" ").replace(/\s+/g, " ").trim();

  return {
    content,
    replyTo,
    metadata: {
      atUids: atUids.length > 0 ? atUids : undefined,
      images: images.length > 0 ? images : undefined,
      voice,
      jsonCard,
    },
  };
}

@Interface()
export class QQWorld extends EmaWorld {
  private selfId: string;
  private ownerUids: Set<string>;
  private routePrefix: string;
  private apiCaller: (call: OneBotApiCall) => Promise<OneBotApiResponse> | OneBotApiResponse;
  private gatewayUrl?: string;
  private gatewayToken?: string;
  private dbPath: string;
  private wakeHour: number;
  private sleepHour: number;
  private defaultQuietHours: { startHour: number; endHour: number };
  private timezone: string;
  private contentFilterConfig: Required<QQContentFilterConfig>;
  private bannedWords: string[];
  private bannedWordAction: "reject" | "mask";
  private rateLimits: Required<QQRateLimitConfig>;
  private env: Record<string, string | undefined>;
  private passive: boolean;

  private parts: Map<string, EmaWorldPart> = new Map();
  private seenIds: Set<string> = new Set();
  private messageHistory: Map<string, EmaInput> = new Map();
  private intimacyProfiles: Map<string, UserIntimacyProfile> = new Map();
  private deliveryReceipts: Map<string, QQDeliveryReceipt> = new Map();
  private sentHashes: Map<string, number> = new Map();

  // RFC-0002 Social Media Channel Architecture In-Memory / Fallback Maps
  private socialNodes: Map<string, EmaNode> = new Map();
  private socialChannels: Map<string, QQChannel> = new Map();
  private socialItems: Map<string, EmaChannelItem> = new Map();

  // Rate limit sliding windows (timestamps in ms)
  private groupSendTimestamps: number[] = [];
  private privateSendTimestamps: number[] = [];
  private qzoneSendTimestamps: number[] = [];

  private db: DatabaseSync | null = null;
  private insertSeenStmt: StatementSync | null = null;
  private selectAllSeenStmt: StatementSync | null = null;
  private upsertIntimacyStmt: StatementSync | null = null;
  private selectAllIntimacyStmt: StatementSync | null = null;

  // RFC-0002 SQLite Statements
  private insertSocialNodeStmt: StatementSync | null = null;
  private selectSocialNodeStmt: StatementSync | null = null;
  private selectAllSocialNodesStmt: StatementSync | null = null;
  private insertSocialChannelStmt: StatementSync | null = null;
  private selectSocialChannelStmt: StatementSync | null = null;
  private selectAllSocialChannelsStmt: StatementSync | null = null;
  private insertSocialItemStmt: StatementSync | null = null;
  private selectSocialItemStmt: StatementSync | null = null;
  private selectSocialItemsByChannelStmt: StatementSync | null = null;

  private activeCtx: EmaCtx | null = null;
  private active = false;

  constructor(options: QQWorldOptions = {}) {
    super();
    this.selfId = options.selfId ? String(options.selfId) : "";
    this.ownerUids = new Set((options.ownerUids || []).map((u) => String(u)));
    this.routePrefix = (options.routePrefix || "/world/qq").replace(/\/+$/, "");
    this.gatewayUrl = options.gatewayUrl;
    this.gatewayToken = options.gatewayToken;
    this.dbPath = options.dbPath || ":memory:";
    this.wakeHour = options.wakeHour ?? 8;
    this.sleepHour = options.sleepHour ?? 23;
    this.defaultQuietHours = options.defaultQuietHours ?? { startHour: 23, endHour: 7 };
    this.timezone = options.timezone ?? "Asia/Shanghai";
    this.passive = options.passive ?? false;
    this.env = options.env ?? process.env;

    this.contentFilterConfig = {
      enabled: options.contentFilter?.enabled ?? true,
      action: options.contentFilter?.action ?? "reject",
      filterLocalPaths: options.contentFilter?.filterLocalPaths ?? true,
      filterLocalhost: options.contentFilter?.filterLocalhost ?? true,
      filterSecrets: options.contentFilter?.filterSecrets ?? true,
      filterSystemMarkers: options.contentFilter?.filterSystemMarkers ?? true,
    };
    this.bannedWords = options.bannedWords ?? [];
    this.bannedWordAction = options.bannedWordAction ?? "reject";

    this.rateLimits = {
      groupMaxPerMinute: options.rateLimits?.groupMaxPerMinute ?? 30,
      privateMaxPerMinute: options.rateLimits?.privateMaxPerMinute ?? 30,
      qzoneMaxPerMinute: options.rateLimits?.qzoneMaxPerMinute ?? 5,
    };

    // Register initial configured groups
    for (const group of options.groups || []) {
      const gId = String(group).replace(/^group:/, "");
      const partId = `group:${gId}`;
      this.parts.set(partId, {
        id: partId,
        type: "group",
        name: `QQ Group ${gId}`,
      });
    }

    // Register initial configured private users
    for (const user of options.privateUsers || []) {
      const uId = String(user).replace(/^(private|dm):/, "");
      const partId = `private:${uId}`;
      this.parts.set(partId, {
        id: partId,
        type: "dm",
        name: `QQ User ${uId}`,
      });
    }

    // Setup OneBot API caller
    if (options.apiCaller) {
      this.apiCaller = options.apiCaller;
    } else if (this.gatewayUrl) {
      const url = this.gatewayUrl.replace(/\/+$/, "");
      const token = this.gatewayToken;
      this.apiCaller = async (call: OneBotApiCall): Promise<OneBotApiResponse> => {
        const endpoint = `${url}/${call.action}`;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(call.params),
        });
        if (!res.ok) {
          return {
            status: "failed",
            retcode: res.status,
            message: `HTTP ${res.status}: ${await res.text().catch(() => "")}`,
          };
        }
        return (await res.json()) as OneBotApiResponse;
      };
    } else {
      // Default offline/mock API caller
      this.apiCaller = (call: OneBotApiCall): OneBotApiResponse => {
        return {
          status: "ok",
          retcode: 0,
          data: {
            message_id: Date.now(),
          },
          echo: call.echo,
        };
      };
    }

    this.initSqlite();
    this.initSocialPrimitives(options);
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
        CREATE TABLE IF NOT EXISTS snowluma_seen_messages (
          id TEXT PRIMARY KEY,
          part_id TEXT,
          timestamp INTEGER
        );
        CREATE TABLE IF NOT EXISTS snowluma_intimacy (
          user_id TEXT PRIMARY KEY,
          score INTEGER,
          stage TEXT,
          quiet_hours_start INTEGER,
          quiet_hours_end INTEGER,
          dnd INTEGER,
          last_interaction_at INTEGER
        );

        -- RFC-0002 Social Media Channel Architecture Read-Through Cache
        CREATE TABLE IF NOT EXISTS seen_social_nodes (
          id TEXT PRIMARY KEY,
          world TEXT NOT NULL,
          node_kind TEXT NOT NULL,
          name TEXT NOT NULL,
          handle TEXT,
          avatar_url TEXT,
          channel_ids TEXT,
          metadata TEXT
        );

        CREATE TABLE IF NOT EXISTS seen_social_channels (
          id TEXT PRIMARY KEY,
          world TEXT NOT NULL,
          channel_kind TEXT NOT NULL,
          owner_node_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          linked_channel_ids TEXT,
          metadata TEXT
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
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_social_items_channel ON seen_social_items (channel_id, created_at_ms);
      `);

      this.insertSeenStmt = this.db.prepare(
        "INSERT OR IGNORE INTO snowluma_seen_messages (id, part_id, timestamp) VALUES (?, ?, ?)",
      );
      this.selectAllSeenStmt = this.db.prepare(
        "SELECT id FROM snowluma_seen_messages",
      );
      this.upsertIntimacyStmt = this.db.prepare(`
        INSERT INTO snowluma_intimacy (user_id, score, stage, quiet_hours_start, quiet_hours_end, dnd, last_interaction_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          score = excluded.score,
          stage = excluded.stage,
          quiet_hours_start = excluded.quiet_hours_start,
          quiet_hours_end = excluded.quiet_hours_end,
          dnd = excluded.dnd,
          last_interaction_at = excluded.last_interaction_at
      `);
      this.selectAllIntimacyStmt = this.db.prepare(
        "SELECT * FROM snowluma_intimacy",
      );

      // RFC-0002 Statements
      this.insertSocialNodeStmt = this.db.prepare(`
        INSERT OR REPLACE INTO seen_social_nodes (id, world, node_kind, name, handle, avatar_url, channel_ids, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.selectSocialNodeStmt = this.db.prepare(
        "SELECT * FROM seen_social_nodes WHERE id = ?",
      );
      this.selectAllSocialNodesStmt = this.db.prepare(
        "SELECT * FROM seen_social_nodes",
      );

      this.insertSocialChannelStmt = this.db.prepare(`
        INSERT OR REPLACE INTO seen_social_channels (id, world, channel_kind, owner_node_id, name, description, linked_channel_ids, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.selectSocialChannelStmt = this.db.prepare(
        "SELECT * FROM seen_social_channels WHERE id = ?",
      );
      this.selectAllSocialChannelsStmt = this.db.prepare(
        "SELECT * FROM seen_social_channels",
      );

      this.insertSocialItemStmt = this.db.prepare(`
        INSERT OR REPLACE INTO seen_social_items (id, channel_id, author_node_id, name, content, created_at_iso, created_at_ms, fetched_at_ms, parent_item_id, url, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.selectSocialItemStmt = this.db.prepare(
        "SELECT * FROM seen_social_items WHERE id = ?",
      );
      this.selectSocialItemsByChannelStmt = this.db.prepare(`
        SELECT * FROM seen_social_items
        WHERE channel_id = ?
        ORDER BY created_at_ms DESC
        LIMIT 100
      `);
    } catch (err) {
      console.error("[QQWorld] Failed to initialize SQLite database:", err);
    }
  }

  private initSocialPrimitives(options: QQWorldOptions): void {
    const primarySelfId = this.selfId || "100001";
    const botNodeId = `qq:bot:${primarySelfId}`;
    const botChannelIds: string[] = [];

    // Register initial group channels
    for (const group of options.groups || []) {
      const gId = String(group).replace(/^group:/, "");
      const channelId = `qq:group:${gId}`;
      botChannelIds.push(channelId);
      const ch: QQChannel = {
        id: channelId,
        world: "qq",
        channel_kind: "group",
        name: `QQ Group ${gId}`,
        ownerNodeId: `qq:group_entity:${gId}`,
        description: `QQ Multi-user chat group ${gId}`,
      };
      this.registerSocialChannel(ch);

      const groupNode: EmaNode = {
        id: `qq:group_entity:${gId}`,
        world: "qq",
        node_kind: "organization",
        name: `QQ Group ${gId}`,
        handle: gId,
        channelIds: [channelId],
      };
      this.registerSocialNode(groupNode);
    }

    // Register initial private channels
    for (const user of options.privateUsers || []) {
      const uId = String(user).replace(/^(private|dm):/, "");
      const channelId = `qq:private:${uId}`;
      botChannelIds.push(channelId);
      const ch: QQChannel = {
        id: channelId,
        world: "qq",
        channel_kind: "private",
        name: `QQ Private Chat ${uId}`,
        ownerNodeId: `qq:person:${uId}`,
        description: `Direct 1-on-1 companion chat with QQ user ${uId}`,
      };
      this.registerSocialChannel(ch);

      const personNode: EmaNode = {
        id: `qq:person:${uId}`,
        world: "qq",
        node_kind: "person",
        name: `QQ User ${uId}`,
        handle: uId,
        channelIds: [channelId],
      };
      this.registerSocialNode(personNode);
    }

    // Register Qzone channel
    if (options.qzoneEnabled !== false) {
      const qzoneChannelId = `qq:qzone:${primarySelfId}`;
      botChannelIds.push(qzoneChannelId);
      const qzoneCh: QQChannel = {
        id: qzoneChannelId,
        world: "qq",
        channel_kind: "qzone",
        name: `Qzone Feed (${primarySelfId})`,
        ownerNodeId: botNodeId,
        description: "QQ Zone dynamic status and space feed",
      };
      this.registerSocialChannel(qzoneCh);
    }

    // Register primary bot node with complete channel IDs
    const botNode: EmaNode = {
      id: botNodeId,
      world: "qq",
      node_kind: "bot",
      name: "Ema Companion (QQ)",
      handle: primarySelfId,
      channelIds: botChannelIds,
    };
    this.registerSocialNode(botNode);

    // Register owner node if specified
    const firstOwner = Array.from(this.ownerUids)[0];
    if (firstOwner) {
      const ownerNodeId = `qq:person:${firstOwner}`;
      const ownerNode: EmaNode = {
        id: ownerNodeId,
        world: "qq",
        node_kind: "person",
        name: `Owner (${firstOwner})`,
        handle: firstOwner,
      };
      this.registerSocialNode(ownerNode);
    }
  }

  private loadState(): void {
    if (!this.db) return;
    try {
      if (this.selectAllSeenStmt) {
        const seenRows = this.selectAllSeenStmt.all() as Array<{ id: string }>;
        for (const row of seenRows) {
          if (row?.id) this.seenIds.add(row.id);
        }
      }

      if (this.selectAllIntimacyStmt) {
        const intimacyRows = this.selectAllIntimacyStmt.all() as Array<{
          user_id: string;
          score: number;
          stage: RelationalIntimacyStage;
          quiet_hours_start: number | null;
          quiet_hours_end: number | null;
          dnd: number | null;
          last_interaction_at: number | null;
        }>;
        for (const row of intimacyRows) {
          this.intimacyProfiles.set(row.user_id, {
            userId: row.user_id,
            score: row.score,
            stage: row.stage,
            quietHours:
              row.quiet_hours_start !== null && row.quiet_hours_end !== null
                ? {
                    startHour: row.quiet_hours_start,
                    endHour: row.quiet_hours_end,
                  }
                : undefined,
            dnd: Boolean(row.dnd),
            lastInteractionAt: row.last_interaction_at ?? undefined,
          });
        }
      }

      if (this.selectAllSocialNodesStmt) {
        const nodeRows = this.selectAllSocialNodesStmt.all() as Array<{
          id: string;
          world: string;
          node_kind: string;
          name: string;
          handle: string | null;
          avatar_url: string | null;
          channel_ids: string | null;
          metadata: string | null;
        }>;
        for (const r of nodeRows) {
          this.socialNodes.set(r.id, {
            id: r.id,
            world: r.world,
            node_kind: r.node_kind,
            name: r.name,
            handle: r.handle ?? undefined,
            avatarUrl: r.avatar_url ?? undefined,
            channelIds: r.channel_ids ? JSON.parse(r.channel_ids) : undefined,
            metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
          });
        }
      }

      if (this.selectAllSocialChannelsStmt) {
        const chRows = this.selectAllSocialChannelsStmt.all() as Array<{
          id: string;
          world: "qq";
          channel_kind: QQChannelKind;
          owner_node_id: string | null;
          name: string;
          description: string | null;
          linked_channel_ids: string | null;
          metadata: string | null;
        }>;
        for (const r of chRows) {
          this.socialChannels.set(r.id, {
            id: r.id,
            world: "qq",
            channel_kind: r.channel_kind,
            ownerNodeId: r.owner_node_id ?? undefined,
            name: r.name,
            description: r.description ?? undefined,
            linkedChannelIds: r.linked_channel_ids
              ? JSON.parse(r.linked_channel_ids)
              : undefined,
            metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
          });
        }
      }
    } catch (err) {
      console.error("[QQWorld] Failed to load state from SQLite:", err);
    }
  }

  private saveSeen(id: string, partId: string): void {
    if (!this.db || !this.insertSeenStmt) return;
    try {
      this.insertSeenStmt.run(id, partId, Date.now());
    } catch (err) {
      console.error("[QQWorld] Failed to save seen message to SQLite:", err);
    }
  }

  private persistIntimacy(profile: UserIntimacyProfile): void {
    if (!this.db || !this.upsertIntimacyStmt) return;
    try {
      this.upsertIntimacyStmt.run(
        profile.userId,
        profile.score,
        profile.stage,
        profile.quietHours ? profile.quietHours.startHour : null,
        profile.quietHours ? profile.quietHours.endHour : null,
        profile.dnd ? 1 : 0,
        profile.lastInteractionAt ?? null,
      );
    } catch (err) {
      console.error("[QQWorld] Failed to persist intimacy profile to SQLite:", err);
    }
  }

  /**
   * Starts QQWorld: registers with registry, mounts resource routes on EmaRouter,
   * and prepares input batching.
   */
  start(ctx: EmaCtx): Disposable {
    this.active = true;
    this.activeCtx = ctx;

    const registryHandle = ctx.registry.register("qq", this);

    const routePattern = `${this.routePrefix}/*`;
    const routeHandler = async (routeCtx: EmaRouteContext) => {
      const subpath = routeCtx.path.replace(new RegExp(`^${this.routePrefix}/?`), "");

      // 1. Root & Parts List
      if (subpath === "" || subpath === "parts") {
        return {
          world: "qq",
          parts: this.listParts(),
        };
      }

      // 2. Specific Part Lookup
      if (subpath.startsWith("parts/")) {
        const partId = decodeURIComponent(subpath.replace(/^parts\//, ""));
        const part =
          this.parts.get(partId) ||
          this.parts.get(`group:${partId}`) ||
          this.parts.get(`private:${partId}`) ||
          this.listParts().find((p) => p.id === partId);
        if (!part) {
          throw new Error(`Part not found: ${partId}`);
        }
        return part;
      }

      // 3. Message History Lookup
      if (subpath.startsWith("messages/")) {
        const id = decodeURIComponent(subpath.replace(/^messages\//, ""));
        const msg = this.messageHistory.get(id);
        if (!msg) {
          throw new Error(`Message not found: ${id}`);
        }
        return msg;
      }

      // 4. RFC-0002 Social Channels Listing
      if (subpath === "channels") {
        return {
          world: "qq",
          channels: this.listSocialChannels(),
        };
      }

      // 5. RFC-0002 Channel Lookup and Item Query
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

      // 6. RFC-0002 Social Node Lookup
      if (subpath.startsWith("nodes/")) {
        const rawNodeId = decodeURIComponent(subpath.replace(/^nodes\//, ""));
        const node = this.getSocialNode(rawNodeId);
        if (!node) {
          throw new Error(`Node not found: ${rawNodeId}`);
        }
        return node;
      }

      // 7. RFC-0002 Social Item Lookup
      if (subpath.startsWith("items/")) {
        const rawItemId = decodeURIComponent(subpath.replace(/^items\//, ""));
        const item = this.getSocialItem(rawItemId);
        if (!item) {
          throw new Error(`Item not found: ${rawItemId}`);
        }
        return item;
      }

      // 8. RFC-0002 Hierarchical Action Documentation & Introspection
      if (subpath === "actions") {
        return {
          world: "qq",
          actions: this.listActions(),
        };
      }

      if (subpath.startsWith("actions/")) {
        const actionName = decodeURIComponent(subpath.replace(/^actions\//, ""));
        const doc = this.listActions().find((a) => a.name === actionName);
        if (!doc) {
          throw new Error(`Action not found: ${actionName}`);
        }
        return doc;
      }

      // 9. World Status & Observability
      if (subpath === "status") {
        return this.getStatus();
      }

      // 10. Relational Intimacy Inspection & Updates
      if (subpath.startsWith("intimacy/")) {
        const userId = decodeURIComponent(subpath.replace(/^intimacy\//, ""));
        if (routeCtx.method === "POST" && routeCtx.body && typeof routeCtx.body === "object") {
          return this.setIntimacy(userId, routeCtx.body as Partial<UserIntimacyProfile>);
        }
        return this.getIntimacy(userId);
      }

      // 11. OneBot 11 Webhook / HTTP Event Ingestion
      if (subpath === "event" || subpath === "webhook") {
        const body = (routeCtx.body || {}) as OneBotEvent;
        const input = await this.ingestEvent(body);
        return {
          status: "ok",
          processed: input !== null,
          inputId: input?.id,
        };
      }

      // 12. QQ Login Status Query
      if (subpath === "login/status") {
        const loginManager = new QQLoginManager({
          gatewayUrl: this.gatewayUrl,
          gatewayToken: this.gatewayToken,
        });
        const existing = await loginManager.checkExistingSession();
        return {
          isLoggedIn: existing !== null,
          uin: existing?.uin ?? this.selfId ?? null,
          nickname: existing?.nickname ?? null,
        };
      }

      return {
        world: "qq",
        parts: this.listParts(),
      };
    };

    const routeHandleWildcard = ctx.router.serve(
      routePattern,
      routeHandler,
      "QQ / OneBot 11 Gateway Resource Router (wildcard)",
    );

    const routeHandleRoot = ctx.router.serve(
      this.routePrefix,
      routeHandler,
      "QQ / OneBot 11 Gateway Resource Router (root)",
    );

    return {
      dispose: () => {
        this.active = false;
        this.activeCtx = null;
        registryHandle.dispose();
        routeHandleWildcard.dispose();
        routeHandleRoot.dispose();
        this.dispose();
      },
    };
  }

  /**
   * Cleans up world resources and closes open SQLite database handles.
   */
  dispose(): void {
    this.active = false;
    this.activeCtx = null;
    if (this.db) {
      try {
        this.insertSeenStmt = null;
        this.selectAllSeenStmt = null;
        this.upsertIntimacyStmt = null;
        this.selectAllIntimacyStmt = null;
        this.insertSocialNodeStmt = null;
        this.selectSocialNodeStmt = null;
        this.selectAllSocialNodesStmt = null;
        this.insertSocialChannelStmt = null;
        this.selectSocialChannelStmt = null;
        this.selectAllSocialChannelsStmt = null;
        this.insertSocialItemStmt = null;
        this.selectSocialItemStmt = null;
        this.selectSocialItemsByChannelStmt = null;
        this.db.close();
      } catch (err) {
        console.error("[QQWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    }
  }

  /**
   * Ingests a raw OneBot 11 gateway event, normalizes it to an EmaInput,
   * handles loop prevention, indexes social channels and items, and enqueues into input batcher.
   */
  async ingestEvent(event: OneBotEvent): Promise<EmaInput | null> {
    if (!event || typeof event !== "object") return null;

    // Track self bot QQ ID if announced by gateway
    if (event.self_id && !this.selfId) {
      this.selfId = String(event.self_id);
    }

    // 1. Loop Prevention: Drop messages sent by the companion bot itself
    const senderIdStr = String(event.user_id ?? event.sender?.user_id ?? "");
    if (this.selfId && senderIdStr && senderIdStr === this.selfId) {
      return null;
    }

    // 2. Handle Message Events (Private and Group)
    if (event.post_type === "message") {
      const msgType = event.message_type;
      if (msgType !== "private" && msgType !== "group") {
        return null;
      }

      let partId: string;
      let socialChannelId: string;

      if (msgType === "group") {
        const groupId = String(event.group_id ?? "");
        if (!groupId) return null;
        partId = `group:${groupId}`;
        socialChannelId = `qq:group:${groupId}`;

        if (!this.parts.has(partId)) {
          this.parts.set(partId, {
            id: partId,
            type: "group",
            name: `QQ Group ${groupId}`,
          });
        }
        if (!this.socialChannels.has(socialChannelId)) {
          this.registerSocialChannel({
            id: socialChannelId,
            world: "qq",
            channel_kind: "group",
            name: `QQ Group ${groupId}`,
            ownerNodeId: `qq:group_entity:${groupId}`,
          });
        }
      } else {
        if (!senderIdStr) return null;
        partId = `private:${senderIdStr}`;
        socialChannelId = `qq:private:${senderIdStr}`;

        if (!this.parts.has(partId)) {
          this.parts.set(partId, {
            id: partId,
            type: "dm",
            name: event.sender?.card || event.sender?.nickname || `QQ User ${senderIdStr}`,
          });
        }
        if (!this.socialChannels.has(socialChannelId)) {
          this.registerSocialChannel({
            id: socialChannelId,
            world: "qq",
            channel_kind: "private",
            name: `QQ Private Chat ${senderIdStr}`,
            ownerNodeId: `qq:person:${senderIdStr}`,
          });
        }
      }

      const msgId = String(
        event.message_id ?? `qq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );

      // Deduplication check
      if (this.seenIds.has(msgId)) {
        return null;
      }
      this.seenIds.add(msgId);
      this.saveSeen(msgId, partId);

      // Parse message content & modalities
      let content = "";
      let replyTo: string | undefined;
      let meta: QQInputMetadata = {
        messageType: msgType,
        groupId: event.group_id ? String(event.group_id) : undefined,
        userId: senderIdStr,
      };

      if (typeof event.message === "string") {
        const parsed = parseCQMessage(event.message);
        content = parsed.content;
        replyTo = parsed.replyTo;
        meta = { ...meta, ...parsed.metadata };
      } else if (Array.isArray(event.message)) {
        const parsed = parseSegmentMessage(event.message);
        content = parsed.content;
        replyTo = parsed.replyTo;
        meta = { ...meta, ...parsed.metadata };
      } else if (event.raw_message) {
        const parsed = parseCQMessage(event.raw_message);
        content = parsed.content;
        replyTo = parsed.replyTo;
        meta = { ...meta, ...parsed.metadata };
      }

      if (!content) {
        return null;
      }

      const senderName =
        event.sender?.card?.trim() || event.sender?.nickname?.trim() || senderIdStr;

      const sender: EmaSender = {
        id: `user:qq:${senderIdStr}`,
        name: senderName,
        isOwner: this.ownerUids.has(senderIdStr),
      };

      const timestamp =
        typeof event.time === "number" && Number.isFinite(event.time)
          ? event.time * 1000
          : Date.now();

      const input: EmaInput = {
        id: msgId,
        world: "qq",
        partId,
        sender,
        content,
        timestamp,
        replyTo,
        metadata: meta as unknown as Record<string, unknown>,
      };

      // Record interaction for intimacy tracking
      if (senderIdStr) {
        this.recordInteraction(senderIdStr, 1);

        // Ensure sender Node is registered in RFC-0002 social graph
        const senderNodeId = `qq:person:${senderIdStr}`;
        if (!this.socialNodes.has(senderNodeId)) {
          this.registerSocialNode({
            id: senderNodeId,
            world: "qq",
            node_kind: "person",
            name: senderName,
            handle: senderIdStr,
          });
        }
      }

      // Index into RFC-0002 Social Channel Item Read-Through Index
      this.indexSocialItem({
        id: msgId,
        channelId: socialChannelId,
        authorNodeId: `qq:person:${senderIdStr}`,
        content,
        createdAtIso: new Date(timestamp).toISOString(),
        createdAt: formatAgentRelativeTime(timestamp),
        fetchedAtMs: Date.now(),
        fetchedAt: formatAgentRelativeTime(Date.now()),
        parentItemId: replyTo,
      });

      this.storeHistory(input);

      if (this.activeCtx) {
        this.activeCtx.inputBatcher.push(input);
      }

      return input;
    }

    // 3. Handle Notice Events: Poke / Nudge, Group Card, Lucky King
    if (event.post_type === "notice") {
      const noticeType = event.notice_type;
      const subType = event.sub_type;

      // (A) Poke / Nudge Event (戳一戳)
      if (subType === "poke" || noticeType === "poke") {
        const operatorId = String(event.operator_id ?? event.user_id ?? "");
        const targetId = String(event.target_id ?? "");
        const groupId = event.group_id ? String(event.group_id) : undefined;

        if (!operatorId) return null;
        if (this.selfId && operatorId === this.selfId) return null;

        const partId = groupId ? `group:${groupId}` : `private:${operatorId}`;
        const pokeId = `qq-poke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        let content = "";
        if (this.selfId && targetId === this.selfId) {
          content = "[戳了戳我]";
        } else {
          content = `[user:qq:${operatorId} 戳了戳 user:qq:${targetId}]`;
        }

        const sender: EmaSender = {
          id: `user:qq:${operatorId}`,
          name: operatorId,
          isOwner: this.ownerUids.has(operatorId),
        };

        const input: EmaInput = {
          id: pokeId,
          world: "qq",
          partId,
          sender,
          content,
          timestamp: Date.now(),
          metadata: {
            noticeType: "poke",
            subType: "poke",
            operatorId,
            targetId,
            groupId,
            isPoke: true,
          },
        };

        this.storeHistory(input);
        if (this.activeCtx) {
          this.activeCtx.inputBatcher.push(input);
        }
        return input;
      }

      // (B) Group Card Change Notice
      if (noticeType === "group_card" && event.group_id && event.user_id) {
        const groupId = String(event.group_id);
        const userId = String(event.user_id);
        const cardNew = event.card_new || "";
        const cardOld = event.card_old || "";
        const partId = `group:${groupId}`;
        const noticeId = `qq-card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const input: EmaInput = {
          id: noticeId,
          world: "qq",
          partId,
          sender: {
            id: `user:qq:${userId}`,
            name: cardNew || userId,
            isOwner: this.ownerUids.has(userId),
          },
          content: `[群名片变动: user:qq:${userId} 从 "${cardOld}" 变为 "${cardNew}"]`,
          timestamp: Date.now(),
          metadata: {
            noticeType: "group_card",
            groupId,
            userId,
            cardOld,
            cardNew,
          },
        };

        this.storeHistory(input);
        if (this.activeCtx) {
          this.activeCtx.inputBatcher.push(input);
        }
        return input;
      }

      // (C) Lucky King Notice
      if (subType === "lucky_king" && event.group_id) {
        const groupId = String(event.group_id);
        const winnerId = String(event.target_id ?? event.user_id ?? "");
        const partId = `group:${groupId}`;
        const noticeId = `qq-lucky-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const input: EmaInput = {
          id: noticeId,
          world: "qq",
          partId,
          sender: {
            id: `user:qq:${winnerId}`,
            name: winnerId,
            isOwner: this.ownerUids.has(winnerId),
          },
          content: `[运气王: user:qq:${winnerId} 成为运气王]`,
          timestamp: Date.now(),
          metadata: {
            noticeType: "notify",
            subType: "lucky_king",
            groupId,
            winnerId,
          },
        };

        this.storeHistory(input);
        if (this.activeCtx) {
          this.activeCtx.inputBatcher.push(input);
        }
        return input;
      }
    }

    return null;
  }

  private storeHistory(input: EmaInput): void {
    if (this.messageHistory.size >= 500) {
      const oldest = this.messageHistory.keys().next().value;
      if (oldest) this.messageHistory.delete(oldest);
    }
    this.messageHistory.set(input.id, input);
  }

  /**
   * Interacts with a specific part of the QQ World on behalf of an EMA Actor.
   * Dispatches private or group messages, supports rich CQ codes, delivery receipts,
   * message deduplication, privacy guardrails, and relational intimacy gating.
   */
  interact(_ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable {
    assertAgentIdentity(this.env);

    if (!actor || !actor.id) {
      throw new Error("Missing authenticated EmaActor for QQ interaction");
    }

    // 1. Resolve target part topology (group vs private)
    let isGroup = false;
    let targetUid = "";

    if (id.startsWith("group:")) {
      isGroup = true;
      targetUid = id.slice("group:".length);
    } else if (id.startsWith("private:")) {
      isGroup = false;
      targetUid = id.slice("private:".length);
    } else if (id.startsWith("dm:")) {
      isGroup = false;
      targetUid = id.slice("dm:".length);
    } else if (id.startsWith("qq:group:")) {
      isGroup = true;
      targetUid = id.slice("qq:group:".length);
    } else if (id.startsWith("qq:private:")) {
      isGroup = false;
      targetUid = id.slice("qq:private:".length);
    } else {
      const existing = this.parts.get(id);
      if (existing?.type === "group") {
        isGroup = true;
        targetUid = id;
      } else {
        isGroup = false;
        targetUid = id;
      }
    }

    if (!targetUid) {
      throw new Error(`Invalid part target identifier: ${id}`);
    }

    // 2. Parse interaction arguments
    let payload: QQInteractActionPayload = {};
    if (args.length > 0) {
      if (typeof args[0] === "string") {
        if (args[0] === "reply" && typeof args[1] === "string") {
          payload = { text: args[1] };
        } else {
          payload = { text: args[0] };
        }
      } else if (typeof args[0] === "object" && args[0] !== null) {
        payload = args[0] as QQInteractActionPayload;
      }
    }

    let messageText = String(payload.text || payload.message || "").trim();
    const replyTo = payload.replyTo;
    const atUids = Array.isArray(payload.at) ? payload.at.map(String) : [];
    const images = Array.isArray(payload.images) ? payload.images.map(String) : [];
    const faces = Array.isArray(payload.faces) ? payload.faces : [];
    const isProactive = Boolean(payload.isProactive);
    const force = Boolean(payload.force);

    // 3. Content Filter & Privacy Guardrails Check
    if (messageText) {
      messageText = checkQQContentFilter(
        messageText,
        this.contentFilterConfig,
        this.bannedWords,
        this.bannedWordAction,
      );
    }

    // 4. Rate Limiting Check
    this.checkRateLimit(isGroup ? "group" : "private");

    // 5. Intimacy & Quiet Hours Gating for Private Chats
    if (!isGroup) {
      const profile = this.getIntimacy(targetUid);

      if (isProactive) {
        if (compareIntimacy(profile.stage, "trusted_companion") < 0) {
          throw new Error(
            `Refusing proactive interaction with ${targetUid}: intimacy stage '${profile.stage}' is below 'trusted_companion'`,
          );
        }
        if (profile.dnd) {
          throw new Error(
            `Refusing proactive interaction with ${targetUid}: user has enabled do-not-disturb (DND)`,
          );
        }
        if (this.isQuietHours(targetUid)) {
          throw new Error(
            `Refusing proactive interaction with ${targetUid}: current time is within user quiet hours`,
          );
        }
      }

      // Apply relational intimacy cadence
      if (payload.cadence) {
        messageText = this.applyIntimacyCadence(messageText, profile.stage);
      }
    }

    // 6. Build Rich OneBot CQ Code String
    const cqPrefixes: string[] = [];
    if (replyTo) {
      cqPrefixes.push(`[CQ:reply,id=${escapeCQValue(String(replyTo))}]`);
    }
    for (const atUid of atUids) {
      cqPrefixes.push(`[CQ:at,qq=${escapeCQValue(atUid)}]`);
    }

    const cqSuffixes: string[] = [];
    for (const faceId of faces) {
      cqSuffixes.push(`[CQ:face,id=${faceId}]`);
    }
    for (const img of images) {
      cqSuffixes.push(`[CQ:image,file=${escapeCQValue(img)}]`);
    }

    const fullMessage = [
      ...cqPrefixes,
      messageText,
      ...cqSuffixes,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (!fullMessage) {
      throw new Error("No message content provided for QQ interaction");
    }

    // 7. Message Deduplication (prevent duplicate bursts on network retries)
    const dedupKey = `${id}:::${fullMessage}`;
    const now = Date.now();
    const lastSent = this.sentHashes.get(dedupKey);
    if (!force && lastSent && now - lastSent < 3000) {
      return { dispose: () => {} };
    }
    this.sentHashes.set(dedupKey, now);

    // 8. Dispatch API call to OneBot 11 / Snowluma Gateway
    const requestId = `req-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const action = isGroup ? "send_group_msg" : "send_private_msg";
    const params = isGroup
      ? { group_id: Number(targetUid) || targetUid, message: fullMessage }
      : { user_id: Number(targetUid) || targetUid, message: fullMessage };

    const dispatchPromise = (async () => {
      try {
        const res = await this.apiCaller({ action, params, echo: requestId });
        const resData = res.data as Record<string, unknown> | undefined;
        const messageId = resData?.message_id ? String(resData.message_id) : undefined;

        this.deliveryReceipts.set(requestId, {
          requestId,
          messageId,
          partId: id,
          action,
          params,
          status: res.status,
          retcode: res.retcode,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error(`[QQWorld] Failed to dispatch action to ${id}:`, err);
      }
    })();

    return {
      dispose: () => {
        void dispatchPromise;
      },
    };
  }

  private checkRateLimit(kind: "group" | "private" | "qzone"): void {
    const now = Date.now();
    const oneMinAgo = now - 60000;

    if (kind === "group") {
      this.groupSendTimestamps = this.groupSendTimestamps.filter((t) => t > oneMinAgo);
      if (this.groupSendTimestamps.length >= this.rateLimits.groupMaxPerMinute) {
        throw new QQRateLimitError(
          `QQ group send rate limit exceeded (${this.rateLimits.groupMaxPerMinute}/minute).`,
        );
      }
      this.groupSendTimestamps.push(now);
    } else if (kind === "private") {
      this.privateSendTimestamps = this.privateSendTimestamps.filter((t) => t > oneMinAgo);
      if (this.privateSendTimestamps.length >= this.rateLimits.privateMaxPerMinute) {
        throw new QQRateLimitError(
          `QQ private send rate limit exceeded (${this.rateLimits.privateMaxPerMinute}/minute).`,
        );
      }
      this.privateSendTimestamps.push(now);
    } else if (kind === "qzone") {
      this.qzoneSendTimestamps = this.qzoneSendTimestamps.filter((t) => t > oneMinAgo);
      if (this.qzoneSendTimestamps.length >= this.rateLimits.qzoneMaxPerMinute) {
        throw new QQRateLimitError(
          `Qzone post rate limit exceeded (${this.rateLimits.qzoneMaxPerMinute}/minute).`,
        );
      }
      this.qzoneSendTimestamps.push(now);
    }
  }

  /**
   * Dispatches a proactive circadian greeting (wake / sleep / custom)
   * gated by relational intimacy stage >= trusted_companion and quiet hours.
   */
  async sendProactiveGreeting(
    ctx: EmaCtx,
    actor: EmaActor,
    userId: string | number,
    type: "wake" | "sleep" | "custom",
    customText?: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    const uId = String(userId).replace(/^(private|dm):/, "");
    const profile = this.getIntimacy(uId);

    if (compareIntimacy(profile.stage, "trusted_companion") < 0) {
      return { sent: false, reason: "insufficient_intimacy" };
    }
    if (profile.dnd) {
      return { sent: false, reason: "dnd_enabled" };
    }
    if (this.isQuietHours(uId)) {
      return { sent: false, reason: "quiet_hours" };
    }

    let text = customText;
    if (!text) {
      if (type === "wake") {
        text = "早安！新的一天也要开心充满活力哦~";
      } else if (type === "sleep") {
        text = "夜深了，早点休息，晚安好梦~";
      } else {
        text = "嗨，今天过得顺利吗？";
      }
    }

    try {
      this.interact(ctx, actor, `private:${uId}`, {
        text,
        isProactive: true,
        cadence: true,
      });
      return { sent: true };
    } catch (err) {
      return { sent: false, reason: (err as Error).message };
    }
  }

  /**
   * Checks whether the current or specified time falls into the user's quiet hours.
   */
  isQuietHours(userId: string | number, date: Date = new Date()): boolean {
    const profile = this.getIntimacy(userId);
    const qh = profile.quietHours ?? this.defaultQuietHours;
    const hour = date.getHours();

    if (qh.startHour > qh.endHour) {
      // Overnight quiet hours, e.g. 23:00 to 07:00
      return hour >= qh.startHour || hour < qh.endHour;
    }
    return hour >= qh.startHour && hour < qh.endHour;
  }

  /**
   * Applies intimacy cadence to a response text.
   * Adjusts conversational warmth and stickers/emotes according to relational stage.
   */
  applyIntimacyCadence(text: string, stage: RelationalIntimacyStage): string {
    if (stage === "trusted_companion" || stage === "soulmate") {
      if (!text.endsWith("~") && !text.endsWith("！") && !text.endsWith("。")) {
        return `${text} ~`;
      }
      return text;
    }
    if (stage === "close_friend") {
      return text;
    }
    return text;
  }

  /**
   * Retrieves the relational intimacy profile for a given QQ user ID.
   */
  getIntimacy(userId: string | number): UserIntimacyProfile {
    const uId = String(userId).replace(/^(private|dm):/, "");
    let profile = this.intimacyProfiles.get(uId);
    if (!profile) {
      profile = {
        userId: uId,
        score: 0,
        stage: "stranger",
      };
      this.intimacyProfiles.set(uId, profile);
    }
    return { ...profile };
  }

  /**
   * Updates the relational intimacy profile for a QQ user.
   */
  setIntimacy(
    userId: string | number,
    updates: Partial<UserIntimacyProfile>,
  ): UserIntimacyProfile {
    const uId = String(userId).replace(/^(private|dm):/, "");
    const current = this.getIntimacy(uId);

    const newScore =
      typeof updates.score === "number" ? Math.max(0, updates.score) : current.score;
    const newStage = updates.stage ?? computeIntimacyStage(newScore);

    const updated: UserIntimacyProfile = {
      ...current,
      ...updates,
      userId: uId,
      score: newScore,
      stage: newStage,
    };

    this.intimacyProfiles.set(uId, updated);
    this.persistIntimacy(updated);
    return { ...updated };
  }

  /**
   * Records an interaction with a user and increments relational intimacy.
   */
  recordInteraction(userId: string | number, points = 1): UserIntimacyProfile {
    const uId = String(userId).replace(/^(private|dm):/, "");
    const current = this.getIntimacy(uId);
    const newScore = current.score + points;
    return this.setIntimacy(uId, {
      score: newScore,
      lastInteractionAt: Date.now(),
    });
  }

  // ==========================================
  // RFC-0002 Social Media Channel Architecture
  // ==========================================

  /**
   * Registers or updates a social node in the world state.
   */
  registerSocialNode(node: EmaNode): void {
    this.socialNodes.set(node.id, node);
    if (this.db && this.insertSocialNodeStmt) {
      try {
        this.insertSocialNodeStmt.run(
          node.id,
          node.world,
          node.node_kind,
          node.name,
          node.handle ?? null,
          node.avatarUrl ?? null,
          node.channelIds ? JSON.stringify(node.channelIds) : null,
          node.metadata ? JSON.stringify(node.metadata) : null,
        );
      } catch (err) {
        console.error("[QQWorld] Failed to insert social node to SQLite:", err);
      }
    }
  }

  /**
   * Retrieves a social node by ID.
   */
  getSocialNode(id: string): EmaNode | undefined {
    let node = this.socialNodes.get(id);
    if (!node && this.db && this.selectSocialNodeStmt) {
      try {
        const row = this.selectSocialNodeStmt.get(id) as {
          id: string;
          world: string;
          node_kind: string;
          name: string;
          handle: string | null;
          avatar_url: string | null;
          channel_ids: string | null;
          metadata: string | null;
        } | null;
        if (row) {
          node = {
            id: row.id,
            world: row.world,
            node_kind: row.node_kind,
            name: row.name,
            handle: row.handle ?? undefined,
            avatarUrl: row.avatar_url ?? undefined,
            channelIds: row.channel_ids ? JSON.parse(row.channel_ids) : undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          };
          this.socialNodes.set(row.id, node);
        }
      } catch {}
    }
    return node;
  }

  /**
   * Registers or updates a social channel in the world state.
   */
  registerSocialChannel(channel: QQChannel): void {
    this.socialChannels.set(channel.id, channel);
    if (this.db && this.insertSocialChannelStmt) {
      try {
        this.insertSocialChannelStmt.run(
          channel.id,
          channel.world,
          channel.channel_kind,
          channel.ownerNodeId ?? null,
          channel.name,
          channel.description ?? null,
          channel.linkedChannelIds ? JSON.stringify(channel.linkedChannelIds) : null,
          channel.metadata ? JSON.stringify(channel.metadata) : null,
        );
      } catch (err) {
        console.error("[QQWorld] Failed to insert social channel to SQLite:", err);
      }
    }
  }

  /**
   * Retrieves a social channel by ID.
   */
  getSocialChannel(id: string): QQChannel | undefined {
    let ch = this.socialChannels.get(id);
    if (!ch && this.db && this.selectSocialChannelStmt) {
      try {
        const row = this.selectSocialChannelStmt.get(id) as {
          id: string;
          world: "qq";
          channel_kind: QQChannelKind;
          owner_node_id: string | null;
          name: string;
          description: string | null;
          linked_channel_ids: string | null;
          metadata: string | null;
        } | null;
        if (row) {
          ch = {
            id: row.id,
            world: "qq",
            channel_kind: row.channel_kind,
            ownerNodeId: row.owner_node_id ?? undefined,
            name: row.name,
            description: row.description ?? undefined,
            linkedChannelIds: row.linked_channel_ids
              ? JSON.parse(row.linked_channel_ids)
              : undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          };
          this.socialChannels.set(row.id, ch);
        }
      } catch {}
    }
    return ch;
  }

  /**
   * Lists all registered social channels.
   */
  listSocialChannels(): QQChannel[] {
    return Array.from(this.socialChannels.values());
  }

  /**
   * Indexes a social channel item into persistent SQLite storage.
   */
  indexSocialItem(item: EmaChannelItem): void {
    this.socialItems.set(item.id, item);
    if (this.db && this.insertSocialItemStmt) {
      try {
        const createdAtMs = new Date(item.createdAtIso).getTime() || Date.now();
        this.insertSocialItemStmt.run(
          item.id,
          item.channelId,
          item.authorNodeId,
          item.name ?? null,
          item.content,
          item.createdAtIso,
          createdAtMs,
          item.fetchedAtMs,
          item.parentItemId ?? null,
          item.url ?? null,
          item.metadata ? JSON.stringify(item.metadata) : null,
        );
      } catch (err) {
        console.error("[QQWorld] Failed to insert social item to SQLite:", err);
      }
    }
  }

  /**
   * Retrieves a social channel item by ID.
   */
  getSocialItem(id: string): EmaChannelItem | undefined {
    let item = this.socialItems.get(id);
    if (!item && this.db && this.selectSocialItemStmt) {
      try {
        const row = this.selectSocialItemStmt.get(id) as {
          id: string;
          channel_id: string;
          author_node_id: string;
          name: string | null;
          content: string;
          created_at_iso: string;
          created_at_ms: number;
          fetched_at_ms: number;
          parent_item_id: string | null;
          url: string | null;
          metadata: string | null;
        } | null;
        if (row) {
          item = {
            id: row.id,
            channelId: row.channel_id,
            authorNodeId: row.author_node_id,
            name: row.name ?? undefined,
            content: row.content,
            createdAtIso: row.created_at_iso,
            createdAt: formatAgentRelativeTime(row.created_at_ms),
            fetchedAtMs: row.fetched_at_ms,
            fetchedAt: formatAgentRelativeTime(row.fetched_at_ms),
            parentItemId: row.parent_item_id ?? undefined,
            url: row.url ?? undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          };
          this.socialItems.set(row.id, item);
        }
      } catch {}
    }
    return item;
  }

  /**
   * Lists items for a social channel with relative time grounding.
   */
  listSocialItems(channelId: string, referenceMs: number = Date.now()): EmaChannelItem[] {
    const items: EmaChannelItem[] = [];

    if (this.db && this.selectSocialItemsByChannelStmt) {
      try {
        const rows = this.selectSocialItemsByChannelStmt.all(channelId) as Array<{
          id: string;
          channel_id: string;
          author_node_id: string;
          name: string | null;
          content: string;
          created_at_iso: string;
          created_at_ms: number;
          fetched_at_ms: number;
          parent_item_id: string | null;
          url: string | null;
          metadata: string | null;
        }>;
        for (const row of rows) {
          items.push({
            id: row.id,
            channelId: row.channel_id,
            authorNodeId: row.author_node_id,
            name: row.name ?? undefined,
            content: row.content,
            createdAtIso: row.created_at_iso,
            createdAt: formatAgentRelativeTime(row.created_at_ms, referenceMs),
            fetchedAtMs: row.fetched_at_ms,
            fetchedAt: formatAgentRelativeTime(row.fetched_at_ms, referenceMs),
            parentItemId: row.parent_item_id ?? undefined,
            url: row.url ?? undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          });
        }
      } catch {}
    }

    if (items.length === 0) {
      for (const item of this.socialItems.values()) {
        if (item.channelId === channelId) {
          items.push({
            ...item,
            createdAt: formatAgentRelativeTime(
              new Date(item.createdAtIso).getTime(),
              referenceMs,
            ),
            fetchedAt: formatAgentRelativeTime(item.fetchedAtMs, referenceMs),
          });
        }
      }
    }

    return items;
  }

  /**
   * Hierarchical action documentation schema conforming to RFC-0002.
   */
  listActions(): EmaActionDoc[] {
    return [
      {
        name: "message.send",
        description: "Dispatches a message to a QQ group or private chat",
        parameters: {
          targetId: {
            type: "string",
            required: true,
            description: "Target part or channel ID (e.g. group:123456 or private:789012)",
          },
          message: {
            type: "string",
            required: true,
            description: "Message text or CQ code payload",
          },
          images: {
            type: "array",
            required: false,
            description: "Optional image URLs or paths to attach",
          },
          at: {
            type: "array",
            required: false,
            description: "Optional list of QQ user IDs to mention (@)",
          },
        },
        rateLimit: "30/minute",
        example: { targetId: "group:123456", message: "Hello from Ema Companion!" },
      },
      {
        name: "message.reply",
        description: "Replies to a specific message in a group or private chat",
        parameters: {
          targetId: {
            type: "string",
            required: true,
            description: "Target part or channel ID",
          },
          replyTo: {
            type: "string",
            required: true,
            description: "Message ID being quoted / replied to",
          },
          message: {
            type: "string",
            required: true,
            description: "Reply message content",
          },
        },
        rateLimit: "30/minute",
        example: { targetId: "group:123456", replyTo: "98765", message: "Understood!" },
      },
      {
        name: "notice.poke",
        description: "Sends a nudge / poke event (戳一戳) to a QQ user or group member",
        parameters: {
          userId: {
            type: "string",
            required: true,
            description: "QQ user ID to poke",
          },
          groupId: {
            type: "string",
            required: false,
            description: "Optional group ID if poking inside a group",
          },
        },
        rateLimit: "10/minute",
        example: { userId: "789012", groupId: "123456" },
      },
      {
        name: "qzone.post",
        description: "Publishes a status update or picture post to QQ Zone (Qzone)",
        parameters: {
          content: {
            type: "string",
            required: true,
            description: "Qzone status update text",
          },
          images: {
            type: "array",
            required: false,
            description: "Optional list of image URLs",
          },
        },
        rateLimit: "5/minute",
        example: { content: "今天天气真好，愿新的一天充满温柔与好心情 ✨" },
      },
      {
        name: "group.card_update",
        description: "Updates the companion's member card or title in a QQ group",
        parameters: {
          groupId: {
            type: "string",
            required: true,
            description: "Target QQ group ID",
          },
          card: {
            type: "string",
            required: true,
            description: "New group member card / display nickname",
          },
        },
        rateLimit: "5/minute",
        example: { groupId: "123456", card: "Ema伴侣" },
      },
    ];
  }

  // ==========================================
  // RFC-0001 Multi-Part Topology & Inspection
  // ==========================================

  /**
   * Lists all monitored and discovered QQ World parts.
   */
  listParts(): EmaWorldPart[] {
    return Array.from(this.parts.values());
  }

  /**
   * Returns current gateway and world status.
   */
  getStatus(): {
    world: "qq";
    selfId: string;
    partsCount: number;
    channelsCount: number;
    nodesCount: number;
    itemsCount: number;
    seenCount: number;
    historyCount: number;
    receiptsCount: number;
  } {
    return {
      world: "qq",
      selfId: this.selfId,
      partsCount: this.parts.size,
      channelsCount: this.socialChannels.size,
      nodesCount: this.socialNodes.size,
      itemsCount: this.socialItems.size,
      seenCount: this.seenIds.size,
      historyCount: this.messageHistory.size,
      receiptsCount: this.deliveryReceipts.size,
    };
  }

  /**
   * Returns recent delivery receipts for verification.
   */
  getDeliveryReceipts(): ReadonlyArray<QQDeliveryReceipt> {
    return Array.from(this.deliveryReceipts.values());
  }
}

/**
 * Backward compatibility alias for SnowlumaWorld.
 */
export const SnowlumaWorld = QQWorld;
export type SnowlumaWorldOptions = QQWorldOptions;
export type SnowlumaDeliveryReceipt = QQDeliveryReceipt;
export type SnowlumaInputMetadata = QQInputMetadata;
