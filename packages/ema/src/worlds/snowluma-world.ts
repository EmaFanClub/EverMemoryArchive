/**
 * @prism-shadow/ema - SnowlumaWorld (OneBot 11 / QQ Gateway Adapter)
 *
 * Implements Snowluma (QQ) input and action adapter for EverMemoryArchive.
 * Conforms to EmaWorld and EmaActor interfaces from RFC-0001.
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
} from "../interfaces.js";
import { assertAgentIdentity } from "../minimal.js";

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
  "stranger" | "acquaintance" | "casual_friend" | "close_friend" | "trusted_companion" | "soulmate";

export interface UserIntimacyProfile {
  userId: string;
  score: number;
  stage: RelationalIntimacyStage;
  quietHours?: { startHour: number; endHour: number };
  dnd?: boolean;
  lastInteractionAt?: number;
}

export interface SnowlumaDeliveryReceipt {
  requestId: string;
  messageId?: string;
  partId: string;
  action: string;
  params: Record<string, unknown>;
  status: string;
  retcode: number;
  timestamp: number;
}

export interface SnowlumaInputMetadata {
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

export interface SnowlumaWorldOptions {
  /** Bot's own QQ account ID (for loop prevention) */
  selfId?: string | number;
  /** Primary bot owner QQ IDs (marked with isOwner = true) */
  ownerUids?: Array<string | number>;
  /** Monitored QQ groups, e.g. ["123456"] or ["group:123456"] */
  groups?: Array<string | number>;
  /** Monitored private users, e.g. ["789012"] or ["private:789012"] */
  privateUsers?: Array<string | number>;
  /** Router prefix (default: "/world/qq") */
  routePrefix?: string;
  /** Custom OneBot API caller function */
  apiCaller?: (call: OneBotApiCall) => Promise<OneBotApiResponse> | OneBotApiResponse;
  /** HTTP gateway URL (e.g. "http://localhost:5700") for default API caller */
  gatewayUrl?: string;
  /** HTTP gateway access token */
  gatewayToken?: string;
  /** SQLite database path for persistent seen state (defaults to :memory:) */
  dbPath?: string;
  /** Circadian wake hour (0-23, default: 8) */
  wakeHour?: number;
  /** Circadian sleep hour (0-23, default: 23) */
  sleepHour?: number;
  /** Default quiet hours: { startHour: 23, endHour: 7 } */
  defaultQuietHours?: { startHour: number; endHour: number };
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
}

export interface InteractActionPayload {
  text?: string;
  replyTo?: string | number;
  at?: Array<string | number>;
  images?: string[];
  faces?: number[];
  isProactive?: boolean;
  cadence?: boolean;
  force?: boolean;
  [key: string]: unknown;
}

const INTIMACY_STAGE_ORDER: Record<RelationalIntimacyStage, number> = {
  stranger: 0,
  acquaintance: 20,
  casual_friend: 40,
  close_friend: 60,
  trusted_companion: 80,
  soulmate: 95,
};

export function compareIntimacy(a: RelationalIntimacyStage, b: RelationalIntimacyStage): number {
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
  return text.replace(/&#91;/g, "[").replace(/&#93;/g, "]").replace(/&amp;/g, "&");
}

/**
 * Escapes text when building outgoing messages containing CQ codes.
 */
export function escapeCQText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
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
  metadata: SnowlumaInputMetadata;
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
  metadata: SnowlumaInputMetadata;
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

export class SnowlumaWorld extends EmaWorld {
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
  private env: Record<string, string | undefined>;

  private parts: Map<string, EmaWorldPart> = new Map();
  private seenIds: Set<string> = new Set();
  private messageHistory: Map<string, EmaInput> = new Map();
  private intimacyProfiles: Map<string, UserIntimacyProfile> = new Map();
  private deliveryReceipts: Map<string, SnowlumaDeliveryReceipt> = new Map();
  private sentHashes: Map<string, number> = new Map();

  private db: DatabaseSync | null = null;
  private insertSeenStmt: StatementSync | null = null;
  private selectAllSeenStmt: StatementSync | null = null;
  private upsertIntimacyStmt: StatementSync | null = null;
  private selectAllIntimacyStmt: StatementSync | null = null;

  private activeCtx: EmaCtx | null = null;
  private active = false;

  constructor(options: SnowlumaWorldOptions = {}) {
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
    this.env = options.env ?? process.env;

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
      `);

      this.insertSeenStmt = this.db.prepare(
        "INSERT OR IGNORE INTO snowluma_seen_messages (id, part_id, timestamp) VALUES (?, ?, ?)",
      );
      this.selectAllSeenStmt = this.db.prepare("SELECT id FROM snowluma_seen_messages");
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
      this.selectAllIntimacyStmt = this.db.prepare("SELECT * FROM snowluma_intimacy");
    } catch (err) {
      console.error("[SnowlumaWorld] Failed to initialize SQLite database:", err);
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
    } catch (err) {
      console.error("[SnowlumaWorld] Failed to load state from SQLite:", err);
    }
  }

  private saveSeen(id: string, partId: string): void {
    if (!this.db || !this.insertSeenStmt) return;
    try {
      this.insertSeenStmt.run(id, partId, Date.now());
    } catch (err) {
      console.error("[SnowlumaWorld] Failed to save seen message to SQLite:", err);
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
      console.error("[SnowlumaWorld] Failed to persist intimacy profile to SQLite:", err);
    }
  }

  /**
   * Starts SnowlumaWorld: mounts resource routes on the EmaRouter and prepares event ingestion.
   */
  start(ctx: EmaCtx): Disposable {
    this.active = true;
    this.activeCtx = ctx;

    const routePattern = `${this.routePrefix}/*`;
    const routeHandle = ctx.router.serve(
      routePattern,
      async (routeCtx) => {
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
          const part = this.parts.get(partId) || this.listParts().find((p) => p.id === partId);
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

        // 4. World Status & Observability
        if (subpath === "status") {
          return this.getStatus();
        }

        // 5. User Relational Intimacy Inspection & Updates
        if (subpath.startsWith("intimacy/")) {
          const userId = decodeURIComponent(subpath.replace(/^intimacy\//, ""));
          if (routeCtx.method === "POST" && routeCtx.body && typeof routeCtx.body === "object") {
            return this.setIntimacy(userId, routeCtx.body as Partial<UserIntimacyProfile>);
          }
          return this.getIntimacy(userId);
        }

        // 6. OneBot 11 Webhook / HTTP Event Ingestion
        if (subpath === "event" || subpath === "webhook") {
          const body = (routeCtx.body || {}) as OneBotEvent;
          const input = await this.ingestEvent(body);
          return {
            status: "ok",
            processed: input !== null,
            inputId: input?.id,
          };
        }

        return {
          world: "qq",
          parts: this.listParts(),
        };
      },
      "Snowluma (OneBot 11 / QQ) Gateway Resource Router",
    );

    return {
      dispose: () => {
        this.active = false;
        this.activeCtx = null;
        routeHandle.dispose();
        this.dispose();
      },
    };
  }

  /**
   * Cleans up world resources and closes open SQLite handles.
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
        this.db.close();
      } catch (err) {
        console.error("[SnowlumaWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    }
  }

  /**
   * Ingests a raw OneBot 11 gateway event, normalizes it to an EmaInput,
   * handles loop prevention, tracks parts, and enqueues into the transactional input batcher.
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
      if (msgType === "group") {
        const groupId = String(event.group_id ?? "");
        if (!groupId) return null;
        partId = `group:${groupId}`;
        if (!this.parts.has(partId)) {
          this.parts.set(partId, {
            id: partId,
            type: "group",
            name: `QQ Group ${groupId}`,
          });
        }
      } else {
        if (!senderIdStr) return null;
        partId = `private:${senderIdStr}`;
        if (!this.parts.has(partId)) {
          this.parts.set(partId, {
            id: partId,
            type: "dm",
            name: event.sender?.card || event.sender?.nickname || `QQ User ${senderIdStr}`,
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
      let meta: SnowlumaInputMetadata = {
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

      const sender: EmaSender = {
        id: `user:qq:${senderIdStr}`,
        name: event.sender?.card?.trim() || event.sender?.nickname?.trim() || senderIdStr,
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

      // Record interaction timestamp for relational intimacy tracking
      if (senderIdStr) {
        this.recordInteraction(senderIdStr, 1);
      }

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
   * message deduplication, and relational intimacy gating.
   */
  interact(_ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable {
    assertAgentIdentity(this.env);

    if (!actor || !actor.id) {
      throw new Error("Missing authenticated EmaActor for Snowluma interaction");
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
    let payload: InteractActionPayload = {};
    if (args.length > 0) {
      if (typeof args[0] === "string") {
        if (args[0] === "reply" && typeof args[1] === "string") {
          payload = { text: args[1] };
        } else {
          payload = { text: args[0] };
        }
      } else if (typeof args[0] === "object" && args[0] !== null) {
        payload = args[0] as InteractActionPayload;
      }
    }

    let messageText = String(payload.text || payload.message || "").trim();
    const replyTo = payload.replyTo;
    const atUids = Array.isArray(payload.at) ? payload.at.map(String) : [];
    const images = Array.isArray(payload.images) ? payload.images.map(String) : [];
    const faces = Array.isArray(payload.faces) ? payload.faces : [];
    const isProactive = Boolean(payload.isProactive);
    const force = Boolean(payload.force);

    // 3. Intimacy & Quiet Hours Gating for Private Chats
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

    // 4. Build Rich OneBot CQ Code String
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

    const fullMessage = [...cqPrefixes, messageText, ...cqSuffixes]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (!fullMessage) {
      throw new Error("No message content provided for Snowluma interaction");
    }

    // 5. Message Deduplication (prevent duplicate bursts on network retries)
    const dedupKey = `${id}:::${fullMessage}`;
    const now = Date.now();
    const lastSent = this.sentHashes.get(dedupKey);
    if (!force && lastSent && now - lastSent < 3000) {
      return { dispose: () => {} };
    }
    this.sentHashes.set(dedupKey, now);

    // 6. Dispatch API call to OneBot 11 / Snowluma Gateway
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
        console.error(`[SnowlumaWorld] Failed to dispatch action to ${id}:`, err);
      }
    })();

    return {
      dispose: () => {
        // Discard or abort pending dispatch if possible
        void dispatchPromise;
      },
    };
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
  setIntimacy(userId: string | number, updates: Partial<UserIntimacyProfile>): UserIntimacyProfile {
    const uId = String(userId).replace(/^(private|dm):/, "");
    const current = this.getIntimacy(uId);

    const newScore = typeof updates.score === "number" ? Math.max(0, updates.score) : current.score;
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
    seenCount: number;
    historyCount: number;
    receiptsCount: number;
  } {
    return {
      world: "qq",
      selfId: this.selfId,
      partsCount: this.parts.size,
      seenCount: this.seenIds.size,
      historyCount: this.messageHistory.size,
      receiptsCount: this.deliveryReceipts.size,
    };
  }

  /**
   * Returns recent delivery receipts for verification.
   */
  getDeliveryReceipts(): ReadonlyArray<SnowlumaDeliveryReceipt> {
    return Array.from(this.deliveryReceipts.values());
  }
}
