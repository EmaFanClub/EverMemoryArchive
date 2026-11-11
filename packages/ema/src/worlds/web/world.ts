/**
 * @prism-shadow/ema - WebWorld Implementation
 *
 * Web / WebSocket Companion Portal Input and Action Adapter for EverMemoryArchive.
 * Conforms to:
 * - RFC-0001 (EmaWorld and EmaActor interfaces, multi-part topology, transactional input batching)
 * - RFC-0002 (Social Media Channel Architecture: EmaNode, EmaChannel, EmaChannelItem,
 *   Read-Through SQLite indexing, anchored temporal perception, and hierarchical action introspection)
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
import type {
  WebChannel,
  WebChannelKind,
  WebClientMetadata,
  WebTouchData,
  WebTelemetryData,
  WebInboundEventPayload,
  WebOutboundModality,
  WebAvatarTrigger,
  WebUiCard,
  WebOutboundEvent,
  WebSessionPart,
  WebWorldOptions,
} from "./types.js";

@Interface()
export class WebWorld extends EmaWorld {
  private routePrefix: string;
  private bufferSize: number;
  private heartbeatIntervalMs: number;
  private env: Record<string, string | undefined>;
  private requireAgentIdentity: boolean;
  private dbPath: string;
  private ownerId: string;
  private ownerName: string;
  private companionId: string;
  private companionName: string;
  private timezone: string;

  private sessions: Map<string, WebSessionPart> = new Map();
  private eventBuffers: Map<string, WebOutboundEvent[]> = new Map();
  private sessionSeqMap: Map<string, number> = new Map();
  private listeners: Map<string, Set<(event: WebOutboundEvent) => void>> = new Map();
  private messageHistory: Map<string, EmaInput | WebOutboundEvent> = new Map();

  private active = false;
  private ctx: EmaCtx | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private db: DatabaseSync | null = null;
  private insertSessionStmt: StatementSync | null = null;
  private updateSessionStmt: StatementSync | null = null;
  private insertEventStmt: StatementSync | null = null;

  // RFC-0002 SQLite prepared statements
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

  constructor(options: WebWorldOptions = {}) {
    super();
    this.routePrefix = (options.routePrefix ?? "/world/web").replace(/\/+$/, "");
    this.bufferSize = Math.max(10, options.bufferSize ?? 100);
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
    this.env = options.env ?? process.env;
    this.requireAgentIdentity = options.requireAgentIdentity ?? Boolean(this.env.PENGUIN_AGENT_ID);
    this.dbPath = options.dbPath ?? this.env.EMA_WEB_DB_PATH ?? ":memory:";
    this.ownerId = options.ownerId ?? "owner";
    this.ownerName = options.ownerName ?? "Rei";
    this.companionId = options.companionId ?? "aoi_rei";
    this.companionName = options.companionName ?? "苍星怜";
    this.timezone = options.timezone ?? "UTC";

    this.initSqlite();
    this.hydrateIdentityFromDb(options);
    this.initSocialPrimitives(options.initialSessions ?? ["default"]);

    // Register initial sessions if provided
    if (options.initialSessions) {
      for (const sess of options.initialSessions) {
        this.registerPart({ id: sess });
      }
    }
  }

  // ==========================================================================
  // Database & State Management (RFC-0001 + RFC-0002)
  // ==========================================================================

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
        CREATE TABLE IF NOT EXISTS web_sessions (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          client_metadata TEXT,
          created_at INTEGER NOT NULL,
          last_active_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS web_events (
          id TEXT PRIMARY KEY,
          seq_id INTEGER NOT NULL,
          part_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          direction TEXT NOT NULL,
          modality TEXT NOT NULL,
          payload TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_web_events_part ON web_events(part_id, seq_id);

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

      this.insertSessionStmt = this.db.prepare(`
        INSERT OR REPLACE INTO web_sessions (
          id, session_id, name, type, client_metadata, created_at, last_active_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      this.updateSessionStmt = this.db.prepare(`
        UPDATE web_sessions SET client_metadata = ?, last_active_at = ? WHERE id = ?
      `);

      this.insertEventStmt = this.db.prepare(`
        INSERT OR REPLACE INTO web_events (
          id, seq_id, part_id, session_id, direction, modality, payload, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

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
      this.selectSocialNodeStmt = this.db.prepare("SELECT * FROM seen_social_nodes WHERE id = ?");
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
      this.selectAllSocialChannelsStmt = this.db.prepare("SELECT * FROM seen_social_channels");

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
      this.selectSocialItemStmt = this.db.prepare("SELECT * FROM seen_social_items WHERE id = ?");
      this.selectSocialItemsByChannelStmt = this.db.prepare(
        "SELECT * FROM seen_social_items WHERE channel_id = ? ORDER BY created_at_ms ASC",
      );
      this.selectSocialRepliesStmt = this.db.prepare(
        "SELECT * FROM seen_social_items WHERE parent_item_id = ? ORDER BY created_at_ms ASC",
      );

      this.loadPersistedSessions();
    } catch (err) {
      console.error("[WebWorld] Failed to initialize SQLite database:", err);
    }
  }

  private hydrateIdentityFromDb(options: WebWorldOptions): void {
    if (!this.db) return;
    try {
      if (options.companionId) {
        this.db
          .prepare(
            "DELETE FROM seen_social_nodes WHERE world = 'web' AND node_kind = 'bot' AND id != ?",
          )
          .run(`web:bot:${options.companionId}`);
      }
      if (!options.companionId || !options.companionName) {
        const botRow = this.db
          .prepare(
            "SELECT id, name, handle FROM seen_social_nodes WHERE world = 'web' AND node_kind = 'bot' ORDER BY CASE WHEN handle = 'aoi_rei' THEN 1 ELSE 0 END ASC, fetched_at_ms DESC LIMIT 1",
          )
          .get() as { id?: string; name?: string; handle?: string } | undefined;
        if (botRow) {
          if (!options.companionId) {
            const derivedId =
              typeof botRow.id === "string" && botRow.id.startsWith("web:bot:")
                ? botRow.id.slice("web:bot:".length)
                : botRow.handle || "";
            if (derivedId) this.companionId = derivedId;
          }
          if (!options.companionName && botRow.name) {
            this.companionName = String(botRow.name);
          }
        }
      }
      if (!options.ownerName) {
        const ownerRow = this.db
          .prepare(
            "SELECT name FROM seen_social_nodes WHERE world = 'web' AND node_kind = 'person' ORDER BY CASE WHEN name = 'Rei' THEN 1 ELSE 0 END ASC, fetched_at_ms DESC LIMIT 1",
          )
          .get() as { name?: string } | undefined;
        if (ownerRow?.name) {
          this.ownerName = String(ownerRow.name);
        }
      }
    } catch {
      // ignore if table is empty or unavailable
    }
  }

  private initSocialPrimitives(initialSessions: string[]): void {
    const ownerNodeId = `web:person:${this.ownerId}`;
    const companionNodeId = `web:bot:${this.companionId}`;
    const channelIds = (initialSessions.length > 0 ? initialSessions : ["default"]).map((s) =>
      this.normalizeChannelId(s),
    );

    this.indexSocialNode({
      id: ownerNodeId,
      world: "web",
      node_kind: "person",
      name: this.ownerName,
      handle: this.ownerId,
      channelIds,
      metadata: { isOwner: true },
    });

    this.indexSocialNode({
      id: companionNodeId,
      world: "web",
      node_kind: "bot",
      name: this.companionName,
      handle: this.companionId,
      channelIds,
      metadata: { isCompanion: true },
    });

    for (const chId of channelIds) {
      const shortId = this.extractSessionId(chId);
      this.indexSocialChannel({
        id: chId,
        world: "web",
        channel_kind: "chatroom",
        ownerNodeId,
        name: shortId === "default" ? `${this.companionName}的聊天室` : `Web Chatroom (${shortId})`,
        description: `Web companion chatroom channel (${shortId})`,
        linkedChannelIds: channelIds.filter((id) => id !== chId),
        metadata: { sessionId: shortId },
      });
    }
  }

  private loadPersistedSessions(): void {
    if (!this.db) return;
    try {
      const stmt = this.db.prepare("SELECT * FROM web_sessions");
      const rows = stmt.all() as Array<{
        id: string;
        session_id: string;
        name: string;
        type: string;
        client_metadata: string | null;
        created_at: number;
        last_active_at: number;
      }>;

      for (const row of rows) {
        let meta: WebClientMetadata | undefined;
        if (row.client_metadata) {
          try {
            meta = JSON.parse(row.client_metadata) as WebClientMetadata;
          } catch {}
        }
        this.sessions.set(row.id, {
          id: row.id,
          sessionId: row.session_id,
          name: row.name,
          type: (row.type as "session" | "room" | "channel") || "session",
          clientMetadata: meta,
          createdAt: row.created_at,
          lastActiveAt: row.last_active_at,
          activeConnections: 0,
        });
      }
    } catch (err) {
      console.error("[WebWorld] Failed to load sessions from SQLite:", err);
    }
  }

  private persistSession(part: WebSessionPart): void {
    if (!this.db || !this.insertSessionStmt) return;
    try {
      this.insertSessionStmt.run(
        part.id,
        part.sessionId,
        part.name,
        part.type,
        part.clientMetadata ? JSON.stringify(part.clientMetadata) : null,
        part.createdAt,
        part.lastActiveAt,
      );
    } catch (err) {
      console.error("[WebWorld] Failed to persist session to SQLite:", err);
    }
  }

  private persistEvent(
    direction: "inbound" | "outbound",
    id: string,
    seqId: number,
    partId: string,
    sessionId: string,
    modality: string,
    payload: unknown,
    timestamp: number,
  ): void {
    if (!this.db || !this.insertEventStmt) return;
    try {
      this.insertEventStmt.run(
        id,
        seqId,
        partId,
        sessionId,
        direction,
        modality,
        JSON.stringify(payload),
        timestamp,
      );
    } catch (err) {
      console.error("[WebWorld] Failed to persist event to SQLite:", err);
    }
  }

  // ==========================================================================
  // Session, Part & Channel ID Normalization
  // ==========================================================================

  /**
   * Normalizes an ID into a canonical Part ID (`web:session:<id>`).
   */
  public normalizePartId(id: string): string {
    const clean = id.trim();
    if (clean.startsWith("web:session:")) {
      return clean;
    }
    if (clean.startsWith("web:chatroom:")) {
      return `web:session:${clean.replace(/^web:chatroom:/, "")}`;
    }
    if (clean.startsWith("chatroom:")) {
      return `web:session:${clean.replace(/^chatroom:/, "")}`;
    }
    if (clean.startsWith("web:")) {
      return `web:session:${clean.replace(/^web:/, "")}`;
    }
    return `web:session:${clean}`;
  }

  /**
   * Normalizes an ID into a canonical RFC-0002 Channel ID (`web:chatroom:<id>`).
   */
  public normalizeChannelId(id: string): string {
    const clean = id.trim();
    if (clean.startsWith("web:chatroom:")) {
      return clean;
    }
    if (clean.startsWith("web:session:")) {
      return `web:chatroom:${clean.replace(/^web:session:/, "")}`;
    }
    if (clean.startsWith("chatroom:")) {
      return `web:chatroom:${clean.replace(/^chatroom:/, "")}`;
    }
    if (clean.startsWith("web:")) {
      return `web:chatroom:${clean.replace(/^web:/, "")}`;
    }
    return `web:chatroom:${clean}`;
  }

  /**
   * Extracts the raw session ID from a Part ID or Channel ID.
   */
  public extractSessionId(partOrChannelId: string): string {
    return partOrChannelId
      .replace(/^web:session:/, "")
      .replace(/^web:chatroom:/, "")
      .replace(/^chatroom:/, "")
      .replace(/^web:/, "");
  }

  // ==========================================================================
  // RFC-0002 Social Media Primitives (Nodes, Channels, Items, Actions)
  // ==========================================================================

  public indexSocialNode(node: EmaNode): EmaNode {
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

  public getSocialNode(id: string): EmaNode | null {
    if (this.db && this.selectSocialNodeStmt) {
      let row = this.selectSocialNodeStmt.get(id) as Record<string, unknown> | undefined;
      if (!row && !id.startsWith("web:")) {
        row =
          (this.selectSocialNodeStmt.get(`web:person:${id}`) as
            Record<string, unknown> | undefined) ??
          (this.selectSocialNodeStmt.get(`web:bot:${id}`) as Record<string, unknown> | undefined);
      }
      if (!row && this.selectSocialNodeByHandleStmt) {
        row = this.selectSocialNodeByHandleStmt.get(id) as Record<string, unknown> | undefined;
      }
      if (row) {
        const channelRows = this.selectAllSocialChannelsStmt?.all() as
          Array<Record<string, unknown>> | undefined;
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

  public indexSocialChannel(channel: WebChannel): WebChannel {
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

  public listSocialChannels(): WebChannel[] {
    if (this.db && this.selectAllSocialChannelsStmt) {
      const rows = this.selectAllSocialChannelsStmt.all() as Array<Record<string, unknown>>;
      if (rows && rows.length > 0) {
        return rows.map((row) => ({
          id: String(row.id),
          world: "web" as const,
          channel_kind: String(row.channel_kind) as WebChannelKind,
          ownerNodeId: row.owner_node_id ? String(row.owner_node_id) : undefined,
          name: String(row.name),
          description: row.description ? String(row.description) : undefined,
          linkedChannelIds: row.linked_channels_json
            ? JSON.parse(String(row.linked_channels_json))
            : undefined,
          metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : undefined,
        }));
      }
    }
    return [];
  }

  public getSocialChannel(id: string): WebChannel | null {
    const channels = this.listSocialChannels();
    const canonical = this.normalizeChannelId(id);
    const shortId = this.extractSessionId(id);
    return (
      channels.find(
        (c) => c.id === id || c.id === canonical || this.extractSessionId(c.id) === shortId,
      ) || null
    );
  }

  public indexSocialItem(item: {
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
    const canonicalChannelId = this.normalizeChannelId(item.channelId);
    const shortId = this.extractSessionId(canonicalChannelId);

    // Ensure channel exists
    if (!this.getSocialChannel(canonicalChannelId)) {
      this.indexSocialChannel({
        id: canonicalChannelId,
        world: "web",
        channel_kind: "chatroom",
        ownerNodeId: `web:person:${this.ownerId}`,
        name: shortId === "default" ? `${this.companionName}的聊天室` : `Web Chatroom (${shortId})`,
        description: `Web companion chatroom channel (${shortId})`,
        metadata: { sessionId: shortId },
      });
    }

    const createdAtMs =
      item.createdAtMs ?? (item.createdAtIso ? new Date(item.createdAtIso).getTime() : Date.now());
    const createdAtIso = item.createdAtIso ?? new Date(createdAtMs).toISOString();
    const fetchedAtMs = item.fetchedAtMs ?? Date.now();

    if (this.db && this.insertSocialItemStmt) {
      this.insertSocialItemStmt.run(
        item.id,
        canonicalChannelId,
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
      channelId: canonicalChannelId,
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

  public listSocialItems(channelId: string, referenceMs: number = Date.now()): EmaChannelItem[] {
    const canonicalChannelId = this.normalizeChannelId(channelId);
    if (this.db && this.selectSocialItemsByChannelStmt) {
      const rows = this.selectSocialItemsByChannelStmt.all(canonicalChannelId) as Array<
        Record<string, unknown>
      >;
      if (rows) {
        return rows.map((row) => this.mapRowToChannelItem(row, referenceMs));
      }
    }
    return [];
  }

  public getSocialItem(id: string, referenceMs: number = Date.now()): EmaChannelItem | null {
    if (this.db && this.selectSocialItemStmt) {
      const row = this.selectSocialItemStmt.get(id) as Record<string, unknown> | undefined;
      if (row) {
        return this.mapRowToChannelItem(row, referenceMs);
      }
    }
    return null;
  }

  public getSocialItemWithReplies(
    id: string,
    referenceMs: number = Date.now(),
  ):
    | ({
        context: EmaTemporalContext;
        item: EmaChannelItem;
        replies: EmaChannelItem[];
      } & EmaChannelItem)
    | null {
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
        console.error("[WebWorld] Failed to get replies for item:", err);
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

  public listActions(): EmaActionDoc[] {
    return [
      {
        name: "message.post",
        description: "Posts a message to a Web chatroom channel",
        parameters: {
          channelId: {
            type: "string",
            required: false,
            description: "Target chatroom channel ID (default: 'web:chatroom:default')",
            default: "web:chatroom:default",
          },
          message: {
            type: "string",
            required: true,
            description: "Message text content to post to the chatroom channel",
          },
          parentItemId: {
            type: "string",
            required: false,
            description: "Optional message ID being replied to",
          },
        },
        rateLimit: "60/minute",
        example: {
          channelId: "web:chatroom:default",
          message: "你好呀，很高兴在这个时刻遇见你，今天也让我安静地陪在你身边吧。",
        },
      },
      {
        name: "message.reply",
        description: "Replies to a specific message item inside a Web chatroom channel",
        parameters: {
          channelId: {
            type: "string",
            required: false,
            description: "Target chatroom channel ID (default: 'web:chatroom:default')",
            default: "web:chatroom:default",
          },
          parentItemId: {
            type: "string",
            required: true,
            description: "Target message item ID to reply to",
          },
          message: {
            type: "string",
            required: true,
            description: "Reply message text content",
          },
        },
        rateLimit: "60/minute",
        example: {
          channelId: "web:chatroom:default",
          parentItemId: "msg_123",
          message: "收到你的消息啦，我一直在这里听你说。",
        },
      },
    ];
  }

  public getAction(name: string): EmaActionDoc | null {
    const norm = name.toLowerCase();
    return this.listActions().find((a) => a.name.toLowerCase() === norm) || null;
  }

  private dispatchActionEndpoint(
    actionName: string,
    body: Record<string, unknown>,
    routeCtx: EmaRouteContext,
  ): {
    success: boolean;
    action: string;
    channelId: string;
    message: string;
    item: EmaChannelItem;
  } {
    const actionDoc = this.getAction(actionName);
    if (!actionDoc) {
      throw new Error(`Action not found: ${actionName}`);
    }

    const messageText = String(body.message ?? body.content ?? body.text ?? "").trim();
    for (const [paramName, paramDoc] of Object.entries(actionDoc.parameters)) {
      if (paramDoc.required) {
        const val = paramName === "message" ? messageText : body[paramName];
        if (val === undefined || val === null || val === "") {
          throw new Error(`Missing required parameter '${paramName}' for action '${actionName}'`);
        }
      }
    }

    const rawChannelId = String(body.channelId ?? "web:chatroom:default");
    const canonicalChannelId = this.normalizeChannelId(rawChannelId);
    const shortSessionId = this.extractSessionId(canonicalChannelId);
    const parentItemId =
      typeof body.parentItemId === "string" && body.parentItemId ? body.parentItemId : undefined;

    const actor: EmaActor = (body.actor as EmaActor) || {
      id: (body.actorId as string) || `actor:${this.companionId}`,
      name: (body.actorName as string) || this.companionName,
      agentId: this.env.PENGUIN_AGENT_ID || this.companionId,
      session: (body.session as string) || `session-web-${shortSessionId}`,
    };

    const dummyCtx: EmaCtx = this.ctx || {
      router: routeCtx as unknown as EmaCtx["router"],
      inputBatcher: { push: () => {}, onBatch: () => ({ dispose: () => {} }) },
      registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] },
    };

    this.interact(dummyCtx, actor, actionName, {
      channelId: canonicalChannelId,
      message: messageText,
      parentItemId,
    });

    const items = this.listSocialItems(canonicalChannelId);
    const latestItem = items[items.length - 1]!;

    return {
      success: true,
      action: actionName,
      channelId: canonicalChannelId,
      message: messageText,
      item: latestItem,
    };
  }

  // ==========================================================================
  // Multi-Part Topology Management
  // ==========================================================================

  public listParts(): EmaWorldPart[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      type: s.type,
      name: s.name,
    }));
  }

  public getPart(id: string): WebSessionPart | undefined {
    const canonical = this.normalizePartId(id);
    return this.sessions.get(canonical);
  }

  public registerPart(part: {
    id: string;
    name?: string;
    type?: "session" | "room" | "channel" | string;
    clientMetadata?: WebClientMetadata;
  }): WebSessionPart {
    const canonicalId = this.normalizePartId(part.id);
    const shortSessionId = this.extractSessionId(canonicalId);
    const canonicalChannelId = this.normalizeChannelId(shortSessionId);
    const existing = this.sessions.get(canonicalId);
    const now = Date.now();

    // Ensure corresponding RFC-0002 chatroom channel is indexed
    this.indexSocialChannel({
      id: canonicalChannelId,
      world: "web",
      channel_kind: "chatroom",
      ownerNodeId: `web:person:${this.ownerId}`,
      name:
        part.name ||
        (shortSessionId === "default"
          ? `${this.companionName}的聊天室`
          : `Web Chatroom (${shortSessionId})`),
      description: `Web companion chatroom channel (${shortSessionId})`,
      metadata: { sessionId: shortSessionId, clientMetadata: part.clientMetadata },
    });

    if (existing) {
      if (part.clientMetadata) {
        existing.clientMetadata = {
          ...existing.clientMetadata,
          ...part.clientMetadata,
        };
      }
      if (part.name) {
        (existing as { name: string }).name = part.name;
      }
      existing.lastActiveAt = now;
      this.persistSession(existing);
      return existing;
    }

    const newPart: WebSessionPart = {
      id: canonicalId,
      sessionId: shortSessionId,
      name: part.name || `Web Session (${shortSessionId})`,
      type: (part.type as "session" | "room" | "channel") || "session",
      clientMetadata: part.clientMetadata,
      createdAt: now,
      lastActiveAt: now,
      activeConnections: 0,
    };

    this.sessions.set(canonicalId, newPart);
    this.persistSession(newPart);
    return newPart;
  }

  public unregisterPart(id: string): boolean {
    const canonicalId = this.normalizePartId(id);
    const existed = this.sessions.delete(canonicalId);
    this.eventBuffers.delete(canonicalId);
    this.sessionSeqMap.delete(canonicalId);
    const set = this.listeners.get(canonicalId);
    if (set) {
      set.clear();
      this.listeners.delete(canonicalId);
    }
    if (this.db) {
      try {
        this.db.prepare("DELETE FROM web_sessions WHERE id = ?").run(canonicalId);
      } catch {}
    }
    return existed;
  }

  public updateClientMetadata(id: string, metadata: WebClientMetadata): WebSessionPart {
    const canonicalId = this.normalizePartId(id);
    let part = this.sessions.get(canonicalId);
    if (!part) {
      part = this.registerPart({ id, clientMetadata: metadata });
    } else {
      part.clientMetadata = {
        ...part.clientMetadata,
        ...metadata,
      };
      part.lastActiveAt = Date.now();
      this.persistSession(part);
    }
    return part;
  }

  // ==========================================================================
  // Inbound Ingestion & Modalities (node-mw7row3c-pdfz)
  // ==========================================================================

  /**
   * Primary ingestion gateway for inbound web events.
   * Enriches client telemetry, normalizes into EmaInput, indexes into RFC-0002
   * Read-Through channel storage, and pushes to EmaInputBatcher.
   */
  public ingest(payload: WebInboundEventPayload): EmaInput {
    if (!payload.sessionId) {
      throw new Error("Missing sessionId in web inbound event payload");
    }
    if (!payload.modality) {
      throw new Error("Missing modality in web inbound event payload");
    }

    const canonicalPartId = this.normalizePartId(payload.sessionId);
    const shortSessionId = this.extractSessionId(canonicalPartId);
    const canonicalChannelId = this.normalizeChannelId(shortSessionId);

    // Update or register session part
    let sessionPart = this.sessions.get(canonicalPartId);
    if (!sessionPart) {
      sessionPart = this.registerPart({
        id: canonicalPartId,
        clientMetadata: payload.clientMetadata,
      });
    } else if (payload.clientMetadata) {
      this.updateClientMetadata(canonicalPartId, payload.clientMetadata);
    } else {
      sessionPart.lastActiveAt = Date.now();
      this.persistSession(sessionPart);
    }

    const eventId = payload.id || `web_in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = payload.timestamp ?? Date.now();

    let content = "";
    const extraMetadata: Record<string, unknown> = {
      modality: payload.modality,
      ...(payload.metadata || {}),
    };

    switch (payload.modality) {
      case "chat": {
        content = (payload.text || "").trim();
        if (!content) {
          throw new Error("Empty text content for chat modality");
        }
        break;
      }
      case "touch": {
        const touch = payload.touch;
        if (!touch || !touch.part || !touch.gesture) {
          throw new Error("Touch modality requires touch.part and touch.gesture");
        }
        content = payload.text?.trim() || `[Touch: ${touch.gesture} on ${touch.part}]`;
        extraMetadata.touch = touch;
        break;
      }
      case "telemetry": {
        const tel = payload.telemetry;
        if (!tel) {
          throw new Error("Telemetry modality requires telemetry payload object");
        }
        extraMetadata.telemetry = tel;

        const parts: string[] = [];
        if (tel.visibility) parts.push(`visibility=${tel.visibility}`);
        if (tel.windowFocus) parts.push(`focus=${tel.windowFocus}`);
        if (tel.idleState)
          parts.push(
            `idle=${tel.idleState}${tel.idleDurationMs ? ` (${tel.idleDurationMs}ms)` : ""}`,
          );
        if (tel.activeTab) parts.push(`tab=${tel.activeTab}`);

        content = payload.text?.trim() || `[Telemetry: ${parts.join(", ") || "heartbeat"}]`;
        break;
      }
      default:
        throw new Error(`Unsupported web inbound modality: ${String(payload.modality)}`);
    }

    const sender: EmaSender = {
      id: payload.sender?.id || `user:web_${shortSessionId}`,
      name: payload.sender?.name || `Web User (${shortSessionId})`,
      isOwner: payload.sender?.isOwner ?? false,
    };

    // RFC-0002 Read-Through indexing for chat messages
    if (payload.modality === "chat") {
      const cleanSenderHandle = sender.id.replace(/^(web:person:|user:)/, "");
      const authorNodeId = `web:person:${cleanSenderHandle}`;
      this.indexSocialNode({
        id: authorNodeId,
        world: "web",
        node_kind: "person",
        name: sender.name,
        handle: cleanSenderHandle,
        channelIds: [canonicalChannelId],
        metadata: { isOwner: sender.isOwner },
      });

      this.indexSocialItem({
        id: eventId,
        channelId: canonicalChannelId,
        authorNodeId,
        name: sender.name,
        content,
        createdAtMs: timestamp,
        fetchedAtMs: timestamp,
        parentItemId: payload.replyTo,
      });
    }

    const input: EmaInput = {
      id: eventId,
      world: "web",
      partId: canonicalPartId,
      sender,
      content,
      timestamp,
      replyTo: payload.replyTo,
      metadata: {
        ...extraMetadata,
        channelId: canonicalChannelId,
        clientMetadata: sessionPart.clientMetadata,
      },
    };

    if (this.messageHistory.size >= 200) {
      const oldest = this.messageHistory.keys().next().value;
      if (oldest) this.messageHistory.delete(oldest);
    }
    this.messageHistory.set(eventId, input);

    this.persistEvent(
      "inbound",
      eventId,
      0,
      canonicalPartId,
      shortSessionId,
      payload.modality,
      input,
      timestamp,
    );

    if (this.ctx) {
      this.ctx.inputBatcher.push(input);
    }

    return input;
  }

  public ingestMessage(
    sessionId: string,
    text: string,
    sender?: { id: string; name: string; isOwner?: boolean },
    clientMetadata?: WebClientMetadata,
  ): EmaInput {
    return this.ingest({
      sessionId,
      modality: "chat",
      text,
      sender,
      clientMetadata,
    });
  }

  public ingestTouch(
    sessionId: string,
    touch: WebTouchData,
    sender?: { id: string; name: string; isOwner?: boolean },
    clientMetadata?: WebClientMetadata,
  ): EmaInput {
    return this.ingest({
      sessionId,
      modality: "touch",
      touch,
      sender,
      clientMetadata,
    });
  }

  public ingestTelemetry(
    sessionId: string,
    telemetry: WebTelemetryData,
    sender?: { id: string; name: string; isOwner?: boolean },
    clientMetadata?: WebClientMetadata,
  ): EmaInput {
    return this.ingest({
      sessionId,
      modality: "telemetry",
      telemetry,
      sender,
      clientMetadata,
    });
  }

  // ==========================================================================
  // Outbound Streaming & Action Dispatcher (node-mw7rpkq4-jwez & RFC-0002)
  // ==========================================================================

  /**
   * Interacts with a specific web session part or executes an RFC-0002 hierarchical action
   * (`message.post`, `message.reply`) on behalf of an EMA Actor.
   */
  public interact(_ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable {
    // 1. Authenticate Actor credentials per RFC-0001 authenticated-actor-interaction
    if (!actor || !actor.id || !actor.session) {
      throw new Error(
        "[WebWorld] Missing actor credentials: actor id and session are required for interaction",
      );
    }

    if (this.requireAgentIdentity) {
      assertAgentIdentity(this.env);
      if (!actor.agentId) {
        throw new Error(
          "[WebWorld] Missing actor.agentId while agent identity enforcement is active",
        );
      }
    }

    let targetSessionOrPart = id;
    let eventType: WebOutboundModality = "reply";
    let token: string | undefined;
    let fullText: string | undefined;
    let expression: WebAvatarTrigger | undefined;
    let card: WebUiCard | undefined;
    let parentItemId: string | undefined;
    let data: unknown;

    // Support RFC-0002 hierarchical action names as `id` (e.g. interact(ctx, actor, "message.post", { channelId, message }))
    const normAction = id.trim().toLowerCase();
    if (normAction === "message.post" || normAction === "message.reply") {
      const payload = (args[0] && typeof args[0] === "object" ? args[0] : {}) as Record<
        string,
        unknown
      >;
      targetSessionOrPart = String(payload.channelId ?? payload.sessionId ?? "default");
      fullText = String(payload.message ?? payload.content ?? payload.text ?? "");
      if (typeof payload.parentItemId === "string") {
        parentItemId = payload.parentItemId;
      }
      eventType = "reply";
    } else if (args.length > 0) {
      const first = args[0];

      if (typeof first === "string") {
        switch (first) {
          case "stream_start":
            eventType = "stream_start";
            break;
          case "token":
          case "stream_token":
            eventType = "token";
            token = typeof args[1] === "string" ? args[1] : String(args[1] ?? "");
            break;
          case "stream_end":
            eventType = "stream_end";
            if (typeof args[1] === "string") fullText = args[1];
            break;
          case "reply":
          case "message.post":
          case "message.reply":
            eventType = "reply";
            if (typeof args[1] === "string") {
              fullText = args[1];
            } else if (typeof args[1] === "object" && args[1] !== null) {
              const p = args[1] as Record<string, unknown>;
              fullText = String(p.message ?? p.content ?? p.text ?? "");
              if (typeof p.parentItemId === "string") parentItemId = p.parentItemId;
            } else {
              fullText = String(args[1] ?? "");
            }
            break;
          case "expression":
            eventType = "expression";
            if (typeof args[1] === "object" && args[1] !== null) {
              expression = args[1] as WebAvatarTrigger;
            }
            break;
          case "card":
            eventType = "card";
            if (typeof args[1] === "object" && args[1] !== null) {
              card = args[1] as WebUiCard;
            }
            break;
          default:
            eventType = "reply";
            fullText = first;
            break;
        }
      } else if (typeof first === "object" && first !== null) {
        const obj = first as Record<string, unknown>;
        if (typeof obj.type === "string") {
          eventType = obj.type as WebOutboundModality;
        }

        if (typeof obj.token === "string") token = obj.token;
        if (typeof obj.fullText === "string") fullText = obj.fullText;
        else if (typeof obj.text === "string") fullText = obj.text;
        else if (typeof obj.message === "string") fullText = obj.message;
        else if (typeof obj.content === "string") fullText = obj.content;

        if (typeof obj.parentItemId === "string") parentItemId = obj.parentItemId;

        if (obj.expression && typeof obj.expression === "object") {
          expression = obj.expression as WebAvatarTrigger;
        }
        if (obj.card && typeof obj.card === "object") {
          card = obj.card as WebUiCard;
        }
        data = obj.data;
      }
    }

    const canonicalPartId = this.normalizePartId(targetSessionOrPart);
    const shortSessionId = this.extractSessionId(canonicalPartId);
    const canonicalChannelId = this.normalizeChannelId(shortSessionId);

    // Auto-register part if not yet present
    let sessionPart = this.sessions.get(canonicalPartId);
    if (!sessionPart) {
      sessionPart = this.registerPart({ id: canonicalPartId });
    }

    // 3. Monotonically increment session sequence ID
    const currentSeq = (this.sessionSeqMap.get(canonicalPartId) ?? 0) + 1;
    this.sessionSeqMap.set(canonicalPartId, currentSeq);

    const eventId = `web_out_${currentSeq}_${Date.now()}`;
    const timestamp = Date.now();

    // RFC-0002 Read-Through indexing when posting a reply/message to the chatroom channel
    if ((eventType === "reply" || eventType === "stream_end") && fullText && fullText.trim()) {
      const cleanActorHandle = actor.id.replace(/^(web:bot:|actor:)/, "");
      const authorNodeId = `web:bot:${cleanActorHandle}`;
      this.indexSocialNode({
        id: authorNodeId,
        world: "web",
        node_kind: "bot",
        name: actor.name || this.companionName,
        handle: cleanActorHandle,
        channelIds: [canonicalChannelId],
        metadata: { agentId: actor.agentId, session: actor.session },
      });

      this.indexSocialItem({
        id: eventId,
        channelId: canonicalChannelId,
        authorNodeId,
        name: actor.name || this.companionName,
        content: fullText.trim(),
        createdAtMs: timestamp,
        fetchedAtMs: timestamp,
        parentItemId,
      });
    }

    const outboundEvent: WebOutboundEvent = {
      seqId: currentSeq,
      id: eventId,
      partId: canonicalPartId,
      sessionId: shortSessionId,
      type: eventType,
      actor: {
        id: actor.id,
        name: actor.name,
        agentId: actor.agentId,
        session: actor.session,
      },
      timestamp,
      token,
      fullText,
      expression,
      card,
      data,
    };

    // 4. Update circular replay buffer for heartbeat and reconnection
    let buffer = this.eventBuffers.get(canonicalPartId);
    if (!buffer) {
      buffer = [];
      this.eventBuffers.set(canonicalPartId, buffer);
    }
    buffer.push(outboundEvent);
    if (buffer.length > this.bufferSize) {
      buffer.shift();
    }

    if (this.messageHistory.size >= 200) {
      const oldest = this.messageHistory.keys().next().value;
      if (oldest) this.messageHistory.delete(oldest);
    }
    this.messageHistory.set(eventId, outboundEvent);

    this.persistEvent(
      "outbound",
      eventId,
      currentSeq,
      canonicalPartId,
      shortSessionId,
      eventType,
      outboundEvent,
      timestamp,
    );

    // 5. Broadcast to connected listeners / SSE streams
    const sessionListeners = this.listeners.get(canonicalPartId);
    if (sessionListeners && sessionListeners.size > 0) {
      for (const listener of sessionListeners) {
        try {
          listener(outboundEvent);
        } catch (err) {
          console.error(
            `[WebWorld] Error dispatching to session listener on ${canonicalPartId}:`,
            err,
          );
        }
      }
    }

    return {
      dispose: () => {},
    };
  }

  // ==========================================================================
  // Client Reconnection & Stream Buffering
  // ==========================================================================

  public getEventBuffer(sessionId: string): WebOutboundEvent[] {
    const canonicalPartId = this.normalizePartId(sessionId);
    return [...(this.eventBuffers.get(canonicalPartId) || [])];
  }

  public subscribeSession(
    sessionId: string,
    listener: (event: WebOutboundEvent) => void,
    lastEventId?: number | string,
  ): Disposable {
    const canonicalPartId = this.normalizePartId(sessionId);

    let part = this.sessions.get(canonicalPartId);
    if (!part) {
      part = this.registerPart({ id: canonicalPartId });
    }
    part.activeConnections++;

    let set = this.listeners.get(canonicalPartId);
    if (!set) {
      set = new Set();
      this.listeners.set(canonicalPartId, set);
    }
    set.add(listener);

    if (lastEventId !== undefined && lastEventId !== null && lastEventId !== "") {
      const targetSeq =
        typeof lastEventId === "number" ? lastEventId : parseInt(String(lastEventId), 10);
      const buffer = this.eventBuffers.get(canonicalPartId) || [];
      for (const ev of buffer) {
        if (!isNaN(targetSeq) && ev.seqId > targetSeq) {
          try {
            listener(ev);
          } catch (err) {
            console.error(`[WebWorld] Error during replay to session ${canonicalPartId}:`, err);
          }
        }
      }
    }

    return {
      dispose: () => {
        set?.delete(listener);
        if (part && part.activeConnections > 0) {
          part.activeConnections--;
        }
      },
    };
  }

  public createSseStream(
    sessionId: string,
    lastEventId?: number | string,
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let subscription: Disposable | null = null;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode(": connected to WebWorld SSE stream\n\n"));

        subscription = this.subscribeSession(
          sessionId,
          (event) => {
            try {
              const payload = `id: ${event.seqId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(payload));
            } catch (err) {
              console.error("[WebWorld] SSE enqueue error:", err);
            }
          },
          lastEventId,
        );
      },
      cancel: () => {
        if (subscription) {
          subscription.dispose();
          subscription = null;
        }
      },
    });
  }

  // ==========================================================================
  // Lifecycle & Router Mounting (RFC-0001 & RFC-0002)
  // ==========================================================================

  public start(ctx: EmaCtx): Disposable {
    this.active = true;
    this.ctx = ctx;

    const base = this.routePrefix;
    const routeHandles: Disposable[] = [];
    const registryHandle = ctx.registry?.register ? ctx.registry.register("web", this) : null;

    const serve = (path: string, handler: Parameters<typeof ctx.router.serve>[1], desc: string) => {
      routeHandles.push(ctx.router.serve(path, handler, desc));
    };

    // 1. Root & Parts List
    serve(
      `${base}`,
      () => ({
        world: "web",
        prefix: base,
        activeSessions: this.sessions.size,
        parts: this.listParts(),
        channels: this.listSocialChannels(),
      }),
      "WebWorld overview and topology status",
    );

    serve(
      `${base}/parts`,
      () => ({
        world: "web",
        parts: this.listParts(),
      }),
      "WebWorld list of parts/sessions",
    );

    // 2. Specific Part Lookup
    serve(
      `${base}/parts/:id`,
      (routeCtx) => {
        const id = decodeURIComponent(routeCtx.params.id);
        const part = this.getPart(id);
        if (!part) {
          throw new Error(`Part not found: ${id}`);
        }
        return part;
      },
      "WebWorld part details",
    );

    // 3. RFC-0002 Nodes Endpoint
    serve(
      `${base}/nodes/:id`,
      (routeCtx) => {
        const id = decodeURIComponent(routeCtx.params.id);
        const node = this.getSocialNode(id);
        if (!node) {
          throw new Error(`Node not found: ${id}`);
        }
        return node;
      },
      "WebWorld RFC-0002 social node lookup",
    );

    // 4. RFC-0002 Channels Endpoints
    serve(
      `${base}/channels`,
      () => ({
        channels: this.listSocialChannels(),
      }),
      "WebWorld RFC-0002 list of chatroom channels",
    );

    serve(
      `${base}/channels/:id`,
      (routeCtx) => {
        const id = decodeURIComponent(routeCtx.params.id);
        const channel = this.getSocialChannel(id);
        if (!channel) {
          throw new Error(`Channel not found: ${id}`);
        }
        return channel;
      },
      "WebWorld RFC-0002 channel details",
    );

    serve(
      `${base}/channels/:id/items`,
      (routeCtx) => {
        const rawChannelId = decodeURIComponent(routeCtx.params.id);
        const channel = this.getSocialChannel(rawChannelId);
        if (!channel) {
          throw new Error(`Channel not found: ${rawChannelId}`);
        }

        if (routeCtx.method === "POST") {
          const body = (routeCtx.body || {}) as Record<string, unknown>;
          const content = String(body.content ?? body.message ?? body.text ?? "").trim();
          if (!content) {
            throw new Error("Empty message content");
          }
          const role =
            body.role === "aoi" || body.role === "bot" || body.role === "actor" ? "bot" : "person";
          if (role === "bot") {
            return this.dispatchActionEndpoint(
              "message.post",
              {
                ...body,
                channelId: channel.id,
                message: content,
              },
              routeCtx,
            );
          }
          const senderId = String(body.senderId ?? this.ownerId);
          const senderName = String(body.senderName ?? body.name ?? this.ownerName);
          const input = this.ingest({
            sessionId: this.extractSessionId(channel.id),
            modality: "chat",
            text: content,
            replyTo: typeof body.parentItemId === "string" ? body.parentItemId : undefined,
            sender: {
              id: senderId,
              name: senderName,
              isOwner: true,
            },
          });
          const item = this.getSocialItem(input.id)!;
          return {
            success: true,
            channel,
            item,
          };
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
      },
      "WebWorld RFC-0002 channel items read and post",
    );

    // 5. RFC-0002 Single Item Lookup with Replies
    serve(
      `${base}/items/:id`,
      (routeCtx) => {
        const id = decodeURIComponent(routeCtx.params.id);
        const referenceMs = routeCtx.query?.get("time")
          ? new Date(routeCtx.query.get("time")!).getTime()
          : Date.now();
        const item = this.getSocialItemWithReplies(id, referenceMs);
        if (!item) {
          throw new Error(`Item not found: ${id}`);
        }
        return item;
      },
      "WebWorld RFC-0002 item lookup with replies",
    );

    // 6. RFC-0002 Actions Introspection & Execution
    serve(
      `${base}/actions`,
      () => ({
        actions: this.listActions(),
      }),
      "WebWorld RFC-0002 action schema list",
    );

    serve(
      `${base}/actions/:actionName`,
      (routeCtx) => {
        const actionName = decodeURIComponent(routeCtx.params.actionName);
        if (routeCtx.method === "POST") {
          const body = (routeCtx.body || {}) as Record<string, unknown>;
          return this.dispatchActionEndpoint(actionName, body, routeCtx);
        }
        const doc = this.getAction(actionName);
        if (!doc) {
          throw new Error(`Action not found: ${actionName}`);
        }
        return doc;
      },
      "WebWorld RFC-0002 action introspection and execution",
    );

    // 7. Sessions Endpoint (alias to parts)
    serve(
      `${base}/sessions/:id`,
      (routeCtx) => {
        if (routeCtx.method === "DELETE") {
          const id = decodeURIComponent(routeCtx.params.id);
          const removed = this.unregisterPart(id);
          return { success: removed, sessionId: id };
        }
        const id = decodeURIComponent(routeCtx.params.id);
        const part = this.getPart(id);
        if (!part) {
          throw new Error(`Session not found: ${id}`);
        }
        return part;
      },
      "WebWorld session details or deletion",
    );

    // 8. Message / Event Lookup by ID
    serve(
      `${base}/messages/:id`,
      (routeCtx) => {
        const id = decodeURIComponent(routeCtx.params.id);
        const item = this.messageHistory.get(id);
        if (!item) {
          throw new Error(`Message not found: ${id}`);
        }
        return item;
      },
      "WebWorld message lookup",
    );

    serve(
      `${base}/events/:id`,
      (routeCtx) => {
        const id = decodeURIComponent(routeCtx.params.id);
        const item = this.messageHistory.get(id);
        if (!item) {
          throw new Error(`Event not found: ${id}`);
        }
        return item;
      },
      "WebWorld event lookup",
    );

    // 9. Inbound Ingestion Endpoint (POST /world/web/input or POST /world/web/events)
    const handleInputIngest = (routeCtx: { body?: unknown }) => {
      const body = (routeCtx.body || {}) as WebInboundEventPayload;
      if (!body.sessionId || !body.modality) {
        throw new Error("Invalid payload: sessionId and modality are required");
      }
      const input = this.ingest(body);
      return {
        success: true,
        eventId: input.id,
        partId: input.partId,
        batched: true,
      };
    };

    serve(`${base}/input`, handleInputIngest, "WebWorld inbound input ingestion");
    serve(`${base}/events`, handleInputIngest, "WebWorld inbound event ingestion");

    // 10. Shortcut Ingestion Endpoints per Session
    serve(
      `${base}/sessions/:id/messages`,
      (routeCtx) => {
        const sessionId = decodeURIComponent(routeCtx.params.id);
        const body = (routeCtx.body || {}) as {
          text?: string;
          sender?: { id: string; name: string; isOwner?: boolean };
          clientMetadata?: WebClientMetadata;
        };
        const input = this.ingestMessage(
          sessionId,
          body.text || "",
          body.sender,
          body.clientMetadata,
        );
        return { success: true, eventId: input.id, partId: input.partId };
      },
      "WebWorld post chat message to session",
    );

    serve(
      `${base}/sessions/:id/touch`,
      (routeCtx) => {
        const sessionId = decodeURIComponent(routeCtx.params.id);
        const body = (routeCtx.body || {}) as {
          touch?: WebTouchData;
          sender?: { id: string; name: string; isOwner?: boolean };
          clientMetadata?: WebClientMetadata;
        };
        if (!body.touch) {
          throw new Error("Missing touch data payload");
        }
        const input = this.ingestTouch(sessionId, body.touch, body.sender, body.clientMetadata);
        return { success: true, eventId: input.id, partId: input.partId };
      },
      "WebWorld post avatar touch gesture to session",
    );

    serve(
      `${base}/sessions/:id/telemetry`,
      (routeCtx) => {
        const sessionId = decodeURIComponent(routeCtx.params.id);
        const body = (routeCtx.body || {}) as {
          telemetry?: WebTelemetryData;
          sender?: { id: string; name: string; isOwner?: boolean };
          clientMetadata?: WebClientMetadata;
        };
        if (!body.telemetry) {
          throw new Error("Missing telemetry data payload");
        }
        const input = this.ingestTelemetry(
          sessionId,
          body.telemetry,
          body.sender,
          body.clientMetadata,
        );
        return { success: true, eventId: input.id, partId: input.partId };
      },
      "WebWorld post telemetry update to session",
    );

    // 11. Session Event History
    serve(
      `${base}/sessions/:id/history`,
      (routeCtx) => {
        const sessionId = decodeURIComponent(routeCtx.params.id);
        const buffer = this.getEventBuffer(sessionId);
        return {
          sessionId,
          partId: this.normalizePartId(sessionId),
          count: buffer.length,
          events: buffer,
        };
      },
      "WebWorld session outbound event history",
    );

    // 12. Server-Sent Events (SSE) Streaming Endpoints
    const handleSseStream = (sessionId: string, lastEventIdHeader?: string | null) => {
      const stream = this.createSseStream(sessionId, lastEventIdHeader ?? undefined);
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    };

    serve(
      `${base}/stream`,
      (routeCtx) => {
        const sessionId = routeCtx.query.get("session") || "default";
        const lastEventId =
          routeCtx.headers?.get("last-event-id") || routeCtx.query.get("lastEventId");
        return handleSseStream(sessionId, lastEventId);
      },
      "WebWorld SSE stream by query parameter",
    );

    serve(
      `${base}/sessions/:id/stream`,
      (routeCtx) => {
        const sessionId = decodeURIComponent(routeCtx.params.id);
        const lastEventId =
          routeCtx.headers?.get("last-event-id") || routeCtx.query.get("lastEventId");
        return handleSseStream(sessionId, lastEventId);
      },
      "WebWorld SSE stream by session ID",
    );

    // 13. Periodic Heartbeat Timer
    if (this.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        if (!this.active) return;
        const now = Date.now();
        for (const [partId, set] of this.listeners) {
          if (set.size === 0) continue;
          const currentSeq = (this.sessionSeqMap.get(partId) ?? 0) + 1;
          this.sessionSeqMap.set(partId, currentSeq);

          const hb: WebOutboundEvent = {
            seqId: currentSeq,
            id: `web_hb_${currentSeq}_${now}`,
            partId,
            sessionId: this.extractSessionId(partId),
            type: "heartbeat",
            actor: { id: "system", name: "WebWorld System" },
            timestamp: now,
          };

          for (const listener of set) {
            try {
              listener(hb);
            } catch {}
          }
        }
      }, this.heartbeatIntervalMs);
    }

    return {
      dispose: () => {
        this.active = false;
        this.ctx = null;
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        registryHandle?.dispose();
        for (const handle of routeHandles) {
          handle.dispose();
        }
        this.dispose();
      },
    };
  }

  public dispose(): void {
    this.active = false;
    this.ctx = null;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.listeners.clear();
    if (this.db) {
      try {
        this.insertSessionStmt = null;
        this.updateSessionStmt = null;
        this.insertEventStmt = null;
        this.insertSocialNodeStmt = null;
        this.selectSocialNodeStmt = null;
        this.selectSocialNodeByHandleStmt = null;
        this.insertSocialChannelStmt = null;
        this.selectSocialChannelStmt = null;
        this.selectAllSocialChannelsStmt = null;
        this.insertSocialItemStmt = null;
        this.selectSocialItemStmt = null;
        this.selectSocialItemsByChannelStmt = null;
        this.selectSocialRepliesStmt = null;
        this.db.close();
      } catch (err) {
        console.error("[WebWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    }
  }
}
