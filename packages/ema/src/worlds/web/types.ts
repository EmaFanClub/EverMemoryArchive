/**
 * @prism-shadow/ema - Web World Types & Schemas
 *
 * Conforms to:
 * - RFC-0001 (EmaWorld and EmaActor interfaces, multi-part topology, transactional input batching)
 * - RFC-0002 (Social Media Channel Architecture: EmaNode, EmaChannel, EmaChannelItem)
 */

import type { EmaWorldPart, Id } from "../../interfaces.js";
import type { EmaChannel } from "../../channel.js";

export * from "../../channel.js";

// ============================================================================
// RFC-0002 Channel Types for WebWorld
// ============================================================================

export type WebChannelKind = "chatroom" | "session";

export interface WebChannel extends EmaChannel {
  readonly world: "web";
  readonly channel_kind: WebChannelKind;
}

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
// Multi-Part Topology & World Options
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
  /** Initial session/chatroom part IDs to register (e.g. ["default"]) */
  initialSessions?: string[];
  /** Owner user ID (default: "owner") */
  ownerId?: string;
  /** Owner display name (default: "Rei") */
  ownerName?: string;
  /** Companion actor ID (default: "aoi_rei") */
  companionId?: string;
  /** Companion display name (default: "苍星怜") */
  companionName?: string;
  /** Default timezone for temporal envelopes (default: "UTC") */
  timezone?: string;
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
// Workbench Installer Types
// ============================================================================

export interface WebWorkbenchInstallOptions {
  /** Target Penguin agent ID (e.g. "aoi_rei") */
  agentId: string;
  /** Penguin App Data Directory (default: process.env.PENGUIN_APP_DATA_DIR or ~/.penguin/data/default_project) */
  appDataDir?: string;
  /** Explicit target workbench directory override (if provided, overrides appDataDir + agentId path) */
  targetWorkbenchDir?: string;
  /** Workbench ID folder name under agent_state/workbenches/ (default: "companion_portal") */
  workbenchId?: string;
  /** Companion display name (default: "苍星怜") */
  companionName?: string;
  /** Avatar single-character badge text (default: last character of companionName, e.g. "怜") */
  avatarChar?: string;
  /** Owner display name (default: "Rei") */
  ownerName?: string;
  /** Default RFC-0002 chatroom channel ID (default: "web:chatroom:default") */
  channelId?: string;
  /** Path to shared SQLite database for RFC-0002 channel items */
  dbPath?: string;
  /** Path to ema.js CLI binary */
  emaCliPath?: string;
  /** Whether to inject/update the RFC-0002 channel protocol block in the agent's AGENTS.md (default: true) */
  updateAgentsMd?: boolean;
}

export interface WebWorkbenchInstallResult {
  /** Target agent ID */
  agentId: string;
  /** Installed workbench ID */
  workbenchId: string;
  /** Absolute path to installed workbench directory */
  workbenchDir: string;
  /** Absolute path to shared SQLite database */
  dbPath: string;
  /** Absolute path to ema.js CLI */
  emaCliPath: string;
  /** List of installed files */
  files: string[];
  /** Whether AGENTS.md was updated */
  agentsMdUpdated: boolean;
}
