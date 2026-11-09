/**
 * @prism-shadow/ema - Social Media Channel & Node Primitives
 *
 * Implements core primitives defined in RFC-0002 (Social Media Channel Architecture):
 * - EmaNode: Entities inhabiting external social worlds (person, bot, organization)
 * - EmaChannel: Interaction / publication channels extended per World
 * - EmaChannelItem: Cached items inside channels with relative temporal grounding
 * - EmaActionDoc: Hierarchical action documentation schema
 * - Read-through caching helpers & agent-adapted relative timestamps
 */

/**
 * Temporal context anchoring relative calculations for LLM agents.
 */
export interface EmaTemporalContext {
  /** ISO-8601 / RFC-3339 reference time */
  readonly time: string;
  /** Millisecond epoch timestamp */
  readonly timestampMs: number;
  /** Optional active timezone name */
  readonly timezone?: string;
}

export type EmaRelativeTimeString = string;

/**
 * Formats relative time adapted for LLM agent cognitive grounding:
 * "<N> <unit> ago (<S> seconds ago)" or "just now (0 seconds ago)"
 */
export function formatAgentRelativeTime(
  targetMs: number,
  referenceMs: number = Date.now(),
): EmaRelativeTimeString {
  const deltaSec = Math.max(0, Math.floor((referenceMs - targetMs) / 1000));
  if (deltaSec < 60) {
    return `just now (${deltaSec} seconds ago)`;
  }
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago (${deltaSec} seconds ago)`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours > 1 ? "s" : ""} ago (${deltaSec} seconds ago)`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago (${deltaSec} seconds ago)`;
}

/**
 * Wraps items in an anchored temporal envelope.
 */
export interface EmaTemporalEnvelope<T> {
  readonly context: EmaTemporalContext;
  readonly items: T[];
}

export function createTemporalEnvelope<T>(
  items: T[],
  referenceMs: number = Date.now(),
  timezone?: string,
): EmaTemporalEnvelope<T> {
  return {
    context: {
      time: new Date(referenceMs).toISOString(),
      timestampMs: referenceMs,
      timezone,
    },
    items,
  };
}

/**
 * Node: An entity or actor inhabiting a social media world.
 */
export interface EmaNode {
  readonly id: string;
  readonly world: string;
  /** Node category */
  readonly node_kind: "person" | "bot" | "organization" | string;
  readonly name: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
  /** Channel IDs associated with or owned by this node */
  readonly channelIds?: string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Common Channel Interface: Base contract implemented by all Worlds.
 * Each world extends channel_kind for platform-specific loci.
 */
export interface EmaChannel {
  readonly id: string;
  readonly world: string;
  /** Specific channel kind defined by each world (e.g. "space", "dynamic", "video", "live_room", "forum") */
  readonly channel_kind: string;
  /** Owning node ID if applicable */
  readonly ownerNodeId?: string;
  readonly name: string;
  readonly description?: string;
  /** IDs of linked or interconnected channels */
  readonly linkedChannelIds?: string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Common item inside a Channel (e.g. post, dynamic, video, comment).
 */
export interface EmaChannelItem {
  readonly id: string;
  readonly channelId: string;
  readonly authorNodeId: string;
  readonly name?: string;
  readonly content: string;
  readonly createdAtIso: string;
  readonly createdAt: EmaRelativeTimeString;
  readonly fetchedAtMs: number;
  readonly fetchedAt: EmaRelativeTimeString;
  readonly parentItemId?: string;
  readonly url?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface EmaActionParameterDoc {
  readonly type: "string" | "number" | "boolean" | "object" | "array";
  readonly required: boolean;
  readonly description: string;
  readonly default?: unknown;
}

/**
 * Self-documenting action metadata schema.
 */
export interface EmaActionDoc {
  /** Hierarchical dot-separated action name: e.g. "comment.like", "post.publish" */
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, EmaActionParameterDoc>;
  readonly rateLimit?: string;
  readonly example?: Record<string, unknown>;
}
