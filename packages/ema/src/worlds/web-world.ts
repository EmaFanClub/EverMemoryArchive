/**
 * @prism-shadow/ema - WebWorld
 *
 * Web / WebSocket Companion Portal Input and Action Adapter for EverMemoryArchive.
 * Conforms to RFC-0001 (EmaWorld and EmaActor interfaces).
 *
 * Board Task Associations:
 * - Input Node: node-mw7row3c-pdfz
 *   (Web/WebSocket Companion Portal Input Adapter: SSE/WebSocket client connection,
 *   streaming user prompts, Live2D touch events, and client interaction telemetry).
 * - Action Node: node-mw7rpkq4-jwez
 *   (Web Companion Portal Streaming Outbound Action Dispatcher: SSE/WebSocket token streaming,
 *   Live2D/3D emotion and expression triggers, and interactive UI card updates).
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
  Interface,
} from "../interfaces.js";
import { assertAgentIdentity } from "../minimal.js";

// ============================================================================
// Client Metadata & Inbound Types (node-mw7row3c-pdfz)
// ============================================================================

export interface WebClientMetadata {
  /** Client timezone, e.g. "Asia/Tokyo", "America/New_York" */
  timezone?: string;
  /** Viewport dimensions */
  viewport?: { width: number; height: number };
  /** Audio playback/recording capabilities */
  audioSupport?: boolean;
  /** Active UI focus or active tab, e.g. "chat", "avatar", "cards", "timeline" */
  uiFocus?: "chat" | "avatar" | "cards" | "timeline" | string;
  /** Browser or client User Agent */
  userAgent?: string;
  /** Preferred UI language */
  language?: string;
  /** Color theme preference */
  theme?: "light" | "dark" | "system";
  /** Arbitrary client telemetry extensions */
  extra?: Record<string, unknown>;
}

export type WebInboundModality = "chat" | "touch" | "telemetry";

export interface WebTouchData {
  /** Target avatar hot spot / body part */
  part: "head" | "face" | "cheek" | "hair" | "hand" | "chest" | "body" | string;
  /** Gesture type */
  gesture: "pat" | "poke" | "stroke" | "pinch" | "tap" | "double_tap" | "hold" | string;
  /** Normalized or pixel coordinates */
  x?: number;
  y?: number;
  /** Touch pressure or velocity */
  pressure?: number;
}

export interface WebTelemetryData {
  /** Page visibility state */
  visibility?: "visible" | "hidden";
  /** Window focus / blur state */
  windowFocus?: "focus" | "blur";
  /** Client idle state */
  idleState?: "idle" | "active";
  /** Duration in ms that client has been idle */
  idleDurationMs?: number;
  /** Active UI tab or view */
  activeTab?: string;
  /** Additional telemetry metrics */
  metrics?: Record<string, unknown>;
}

export interface WebInboundEventPayload {
  /** Optional custom event ID */
  id?: string;
  /** Target session identifier or part ID */
  sessionId: string;
  /** Inbound event modality */
  modality: WebInboundModality;
  /** Inbound sender metadata */
  sender?: {
    id: string;
    name: string;
    isOwner?: boolean;
  };
  /** Text content for chat modality */
  text?: string;
  /** Live2D / 3D Touch gesture data */
  touch?: WebTouchData;
  /** Client interaction telemetry data */
  telemetry?: WebTelemetryData;
  /** Inbound millisecond timestamp */
  timestamp?: number;
  /** Referenced or replied-to message ID */
  replyTo?: Id;
  /** Enriched client metadata */
  clientMetadata?: WebClientMetadata;
  /** Raw platform or client metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Outbound Streaming & Modality Types (node-mw7rpkq4-jwez)
// ============================================================================

export type WebOutboundModality =
  | "stream_start"
  | "token"
  | "stream_end"
  | "reply"
  | "expression"
  | "card"
  | "heartbeat"
  | "system";

export interface WebEmotionState {
  /** Emotional valence: -1.0 (very negative) to 1.0 (very positive) */
  valence: number;
  /** Emotional arousal: 0.0 (calm/low energy) to 1.0 (excited/high energy) */
  arousal: number;
  /** Conversational or cognitive stage */
  stage?: "opening" | "listening" | "thinking" | "responding" | "closing" | string;
}

export interface WebAvatarTrigger {
  /** Facial or emotional expression */
  expression?:
    | "blushing"
    | "smiling"
    | "head_tilting"
    | "pouting"
    | "surprised"
    | "gentle"
    | "crying"
    | "neutral"
    | string;
  /** Physical avatar motion */
  motion?: "wave" | "nod" | "shake_head" | "bow" | "lean_forward" | "idle" | string;
  /** Coordinated emotional coordinates */
  emotion?: WebEmotionState;
  /** Duration of expression in milliseconds */
  durationMs?: number;
}

export interface WebMemoryGraphCard {
  type: "memory_graph";
  title?: string;
  nodes: Array<{ id: string; label: string; group?: string; weight?: number }>;
  links?: Array<{ source: string; target: string; relation?: string }>;
}

export interface WebDiaryPreviewCard {
  type: "diary_preview";
  title: string;
  date: string;
  mood?: string;
  excerpt: string;
  tags?: string[];
}

export interface WebRelationshipTimelineCard {
  type: "relationship_timeline";
  title: string;
  intimacyLevel?: number;
  milestones: Array<{ date: string; title: string; description?: string }>;
}

export interface WebCustomCard {
  type: "custom_card" | string;
  title: string;
  data: Record<string, unknown>;
}

export type WebUiCard =
  WebMemoryGraphCard | WebDiaryPreviewCard | WebRelationshipTimelineCard | WebCustomCard;

export interface WebOutboundEvent {
  /** Monotonically increasing sequence ID per session */
  seqId: number;
  /** Globally unique event identifier */
  id: string;
  /** Normalized part ID (e.g. web:session:123) */
  partId: string;
  /** Short session ID */
  sessionId: string;
  /** Outbound modality type */
  type: WebOutboundModality;
  /** Acting companion credentials */
  actor: {
    id: string;
    name: string;
    agentId?: string;
    session?: string;
  };
  /** Dispatch timestamp */
  timestamp: number;
  /** Streaming chunk or token */
  token?: string;
  /** Complete text response */
  fullText?: string;
  /** Live2D/3D Avatar expression and motion trigger */
  expression?: WebAvatarTrigger;
  /** Interactive UI card update */
  card?: WebUiCard;
  /** Generic payload container */
  data?: unknown;
}

// ============================================================================
// Multi-Part Topology Types
// ============================================================================

export interface WebSessionPart extends EmaWorldPart {
  readonly id: Id;
  readonly type: "session" | "room" | "channel";
  readonly name: string;
  readonly sessionId: string;
  clientMetadata?: WebClientMetadata;
  createdAt: number;
  lastActiveAt: number;
  activeConnections: number;
}

export interface WebWorldOptions {
  /** Route mount prefix (default: "/world/web") */
  routePrefix?: string;
  /** Initial session part IDs to register (e.g. ["default"]) */
  initialSessions?: string[];
  /** SQLite database path for persistent seen state and sessions (defaults to ":memory:") */
  dbPath?: string;
  /** Circular buffer capacity for outbound events per session part (default: 100) */
  bufferSize?: number;
  /** Heartbeat interval in ms (default: 30000; set to 0 to disable) */
  heartbeatIntervalMs?: number;
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** Whether to strictly enforce agent identity in interact() (default: true if PENGUIN_AGENT_ID is defined) */
  requireAgentIdentity?: boolean;
}

// ============================================================================
// WebWorld Implementation
// ============================================================================

@Interface()
export class WebWorld extends EmaWorld {
  private routePrefix: string;
  private bufferSize: number;
  private heartbeatIntervalMs: number;
  private env: Record<string, string | undefined>;
  private requireAgentIdentity: boolean;
  private dbPath: string;

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

  constructor(options: WebWorldOptions = {}) {
    super();
    this.routePrefix = (options.routePrefix ?? "/world/web").replace(/\/+$/, "");
    this.bufferSize = Math.max(10, options.bufferSize ?? 100);
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
    this.env = options.env ?? process.env;
    this.requireAgentIdentity = options.requireAgentIdentity ?? Boolean(this.env.PENGUIN_AGENT_ID);
    this.dbPath = options.dbPath ?? ":memory:";

    this.initSqlite();

    // Register initial sessions if provided
    if (options.initialSessions) {
      for (const sess of options.initialSessions) {
        this.registerPart({ id: sess });
      }
    }
  }

  // ==========================================================================
  // Database & State Management
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

      this.loadPersistedSessions();
    } catch (err) {
      console.error("[WebWorld] Failed to initialize SQLite database:", err);
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
  // Session & Part Normalization
  // ==========================================================================

  /**
   * Normalizes an ID into a canonical Part ID (`web:session:<id>`).
   */
  public normalizePartId(id: string): string {
    const clean = id.trim();
    if (clean.startsWith("web:session:")) {
      return clean;
    }
    if (clean.startsWith("web:")) {
      return `web:session:${clean.replace(/^web:/, "")}`;
    }
    return `web:session:${clean}`;
  }

  /**
   * Extracts the raw session ID from a Part ID.
   */
  public extractSessionId(partId: string): string {
    return partId.replace(/^web:session:/, "").replace(/^web:/, "");
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
    const existing = this.sessions.get(canonicalId);
    const now = Date.now();

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
   * Enriches client telemetry, normalizes into EmaInput, and pushes to EmaInputBatcher.
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

    // Construct text representation & metadata according to modality
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
        clientMetadata: sessionPart.clientMetadata,
      },
    };

    // Keep message in in-memory history (pruned to 200 items)
    if (this.messageHistory.size >= 200) {
      const oldest = this.messageHistory.keys().next().value;
      if (oldest) this.messageHistory.delete(oldest);
    }
    this.messageHistory.set(eventId, input);

    // Persist to SQLite
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

    // Push into transactional input batcher if context is active
    if (this.ctx) {
      this.ctx.inputBatcher.push(input);
    }

    return input;
  }

  /**
   * Helper to ingest a plain chat message.
   */
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

  /**
   * Helper to ingest an avatar touch gesture.
   */
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

  /**
   * Helper to ingest client interaction telemetry.
   */
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
  // Outbound Streaming & Action Dispatcher (node-mw7rpkq4-jwez)
  // ==========================================================================

  /**
   * Interacts with a specific web session part on behalf of an EMA Actor.
   * Authenticates actor credentials and pushes streaming tokens, avatar triggers,
   * or interactive UI card updates into connected client streams.
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

    const canonicalPartId = this.normalizePartId(id);
    const shortSessionId = this.extractSessionId(canonicalPartId);

    // Auto-register part if not yet present
    let sessionPart = this.sessions.get(canonicalPartId);
    if (!sessionPart) {
      sessionPart = this.registerPart({ id: canonicalPartId });
    }

    // 2. Parse action arguments into structured outbound modalities
    let eventType: WebOutboundModality = "reply";
    let token: string | undefined;
    let fullText: string | undefined;
    let expression: WebAvatarTrigger | undefined;
    let card: WebUiCard | undefined;
    let data: unknown;

    if (args.length > 0) {
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
            eventType = "reply";
            fullText = typeof args[1] === "string" ? args[1] : String(args[1] ?? "");
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
            // Plain string reply
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

        if (obj.expression && typeof obj.expression === "object") {
          expression = obj.expression as WebAvatarTrigger;
        }
        if (obj.card && typeof obj.card === "object") {
          card = obj.card as WebUiCard;
        }
        data = obj.data;
      }
    }

    // 3. Monotonically increment session sequence ID
    const currentSeq = (this.sessionSeqMap.get(canonicalPartId) ?? 0) + 1;
    this.sessionSeqMap.set(canonicalPartId, currentSeq);

    const eventId = `web_out_${currentSeq}_${Date.now()}`;
    const timestamp = Date.now();

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

    // Store in message history
    if (this.messageHistory.size >= 200) {
      const oldest = this.messageHistory.keys().next().value;
      if (oldest) this.messageHistory.delete(oldest);
    }
    this.messageHistory.set(eventId, outboundEvent);

    // Persist to SQLite
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

  /**
   * Retrieves all buffered events for a session part.
   */
  public getEventBuffer(sessionId: string): WebOutboundEvent[] {
    const canonicalPartId = this.normalizePartId(sessionId);
    return [...(this.eventBuffers.get(canonicalPartId) || [])];
  }

  /**
   * Subscribes a listener to live outbound events for a session part,
   * optionally replaying missed events since `lastEventId`.
   */
  public subscribeSession(
    sessionId: string,
    listener: (event: WebOutboundEvent) => void,
    lastEventId?: number | string,
  ): Disposable {
    const canonicalPartId = this.normalizePartId(sessionId);

    // Auto-register part if not exists
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

    // Replay missed buffered events if lastEventId is supplied
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

  /**
   * Creates a Web Standard ReadableStream delivering Server-Sent Events (SSE).
   */
  public createSseStream(
    sessionId: string,
    lastEventId?: number | string,
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let subscription: Disposable | null = null;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        // Initial comment confirming SSE establishment
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
  // Lifecycle & Router Mounting (RFC-0001)
  // ==========================================================================

  public start(ctx: EmaCtx): Disposable {
    this.active = true;
    this.ctx = ctx;

    const base = this.routePrefix;
    const routeHandles: Disposable[] = [];

    // Helper to register and track route disposables
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

    // 3. Sessions Endpoint (alias to parts)
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

    // 4. Message / Event Lookup by ID
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

    // 5. Inbound Ingestion Endpoint (POST /world/web/input or POST /world/web/events)
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

    // 6. Shortcut Ingestion Endpoints per Session
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

    // 7. Session Event History
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

    // 8. Server-Sent Events (SSE) Streaming Endpoints
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

    // 9. Periodic Heartbeat Timer
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
        for (const handle of routeHandles) {
          handle.dispose();
        }
        this.dispose();
      },
    };
  }

  /**
   * Shuts down WebWorld: closes database, clears timers and listeners.
   */
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
        this.db.close();
      } catch (err) {
        console.error("[WebWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    }
  }
}
