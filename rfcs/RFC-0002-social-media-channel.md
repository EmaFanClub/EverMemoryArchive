# RFC-0002 Social Media Channel Architecture

[中文版](RFC-0002-social-media-channel.zh.md)

> **State**: In Review (Draft for Board Review)  
> **Rev**: v1.1.0  

- Feature Name: `social-media-channel`
- Start Date: 2026-11-09
- RFC PR: Pending Board Review
- Implementation PR: Pending

## Summary
[summary]: #summary

This RFC simplifies and unifies social media representations across EverMemoryArchive (EMA) Worlds into just two core primitives:

1. **`Node` (`node_kind: person | bot | organization | ...`)**:
   Represents social actors and entities (creators, users, bots, organizations) across external platforms. A Node can own, administer, or link to Channels.
2. **`Channel` (`channel_kind: string`)**:
   Represents an interaction or publication channel. Each World extends `channel_kind` to fit its platform (e.g. Bilibili extends with `space`, `dynamic`, `video`, `live_room`; Telegram extends with `channel`, `group`; Discord extends with `text`, `forum`), while all Channels inherit a common base interface.

All Channels share four core runtime capabilities:
- **Local Read-Through Index (World State, Not Agent Memory)**: Posts and pages viewed or published by Ema are cached locally in SQLite with `fetchedAt`. Once viewed, they can be re-inspected offline via the exact same interface without hitting external network or triggering platform risk controls. These records belong strictly to the perceived **World State**, not internal cognitive memory.
- **Agent-Adapted Relative Temporal Perception**: Responses provide an anchored time context (`context: { time: rfc-3339 }`) and format relative item timestamps as human units plus exact elapsed seconds:
  ```json
  {
    "context": { "time": "2026-11-09T01:30:00Z" },
    "items": [
      { "id": "1268371909155749890", "name": "...", "createdAt": "7 days ago (413830 seconds ago)" }
    ]
  }
  ```
- **Hierarchical Action Namespace**: Actions use dot notation (e.g. `comment.like`, `post.publish`, `comment.reply`).
- **Self-Documenting Action Inspection**: Ema can query `/world/:world/actions` to inspect action schemas, descriptions, and rate limits at runtime.
- **Channel Interconnection**: Channels declare links to other channels (`linkedChannelIds`), enabling seamless navigation across spaces, feeds, discussions, and live rooms.

---

## Motivation
[motivation]: #motivation

### 1. The Trap of Monolithic Over-Modeling vs. The Two Primitives

Social media platforms are wildly heterogeneous: Bilibili has spaces, dynamic feeds, video archives, and live rooms; Telegram has broadcast channels and discussion groups; Discord has text channels and forum threads. Furthermore, posts contain varying rich formats.

Attempting to build a monolithic universal format with dozens of rigid block types leads to unnecessary complexity. Conversely, treating each platform as an ad-hoc silo prevents Ema from learning reusable social behaviors.

The solution is radical simplification into two fundamental concepts:
- **`Node`**: *Who* exists in the social world (users, companions, organizations).
- **`Channel`**: *Where* communication occurs and *how* content flows. Each World defines its own `channel_kind`, but all channels adhere to a common interface contract.

### 2. World State vs. Agent Memory

External posts, comments, and pages belong to the objective **World State**. Ema's **Cognitive Memory** (`agent_state/memory`) belongs to internal reflection, human intimacy, and consolidated knowledge. Storing external social posts inside cognitive memory files pollutes recall with ephemeral web noise. Storing them in a local Channel index ensures offline reproducibility without memory pollution.

### 3. Read-Through Caching Without Scrapers

Ema does not need an aggressive crawler. However, "remembering" every page or post Ema has viewed is invaluable. When Ema visits a post, it is indexed with its `fetchedAt` timestamp. Later reviews (e.g. "What did that fan comment say?") query the identical Router endpoint and resolve instantly from local storage.

### 4. Anchoring Time for LLM Agents

LLM agents struggle with mental arithmetic on raw ISO-8601 timestamps. By anchoring responses with `context: { time: RFC-3339 }` and presenting item timestamps as `"7 days ago (413830 seconds ago)"`, Ema gains both natural orientation and exact machine precision.

### 5. Hierarchical Actions & Runtime Discovery

Hierarchical action names (`comment.like`, `post.publish`) prevent verb collisions and standardize companion behaviors across worlds. Action documentation endpoints allow Ema to inspect argument schemas and rate limits dynamically before executing actions.

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. Nodes and Channels

In any World:
* An entity is a **Node**:
  ```json
  {
    "id": "bilibili:person:3546869527480631",
    "world": "bilibili",
    "node_kind": "person",
    "name": "Sakana酱ノ",
    "handle": "3546869527480631",
    "channels": [
      "bilibili:space:3546869527480631",
      "bilibili:dynamic:3546869527480631"
    ]
  }
  ```
* An interaction locus is a **Channel**:
  ```json
  {
    "id": "bilibili:dynamic:3546869527480631",
    "world": "bilibili",
    "channel_kind": "dynamic",
    "name": "Sakana酱ノ的动态",
    "ownerNodeId": "bilibili:person:3546869527480631",
    "linkedChannelIds": [
      "bilibili:space:3546869527480631",
      "bilibili:room:123456"
    ]
  }
  ```

### 2. Reading Channel Items with Relative Time

When Ema reads items from a channel:
```ts
const res = await router.read("/world/bilibili/channels/bilibili:dynamic:3546869527480631/items");
```
Response:
```json
{
  "context": {
    "time": "2026-11-09T01:30:00Z"
  },
  "channel": {
    "id": "bilibili:dynamic:3546869527480631",
    "channel_kind": "dynamic",
    "name": "Sakana酱ノ的动态"
  },
  "items": [
    {
      "id": "1268371909155749890",
      "authorNodeId": "bilibili:person:3546869527480631",
      "name": "【EverMemoryArchive】Ema 伴侣系统运行测试：记忆归档与动态感知连接正常 ✨",
      "createdAt": "7 days ago (413830 seconds ago)",
      "fetchedAt": "10 minutes ago (600 seconds ago)",
      "url": "https://t.bilibili.com/1268371909155749890"
    }
  ]
}
```

If Ema queries this post again, the response is served directly from the local SQLite index without any network call.

### 3. Inspecting and Calling Hierarchical Actions

Ema can inspect supported actions:
```ts
const docs = await router.read("/world/bilibili/actions");
```
Yielding:
```json
{
  "actions": [
    {
      "name": "comment.like",
      "description": "Likes a comment under a post or dynamic",
      "parameters": {
        "postId": { "type": "string", "required": true, "description": "Target post or dynamic ID" },
        "commentId": { "type": "string", "required": true, "description": "Comment ID to like" }
      },
      "rateLimit": "30/minute"
    }
  ]
}
```

Ema executes the action via `interact`:
```ts
world.interact(ctx, actor, "comment.like", {
  postId: "1268371909155749890",
  commentId: "9988776655"
});
```

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Data Contracts

```ts
/**
 * Temporal context anchoring relative calculations for LLM agents.
 */
export interface EmaTemporalContext {
  /** ISO-8601 / RFC-3339 reference time */
  readonly time: string;
  readonly timestampMs: number;
}

export type EmaRelativeTimeString = string;

/**
 * Formats relative time as: "<N> <unit> ago (<S> seconds ago)"
 */
export function formatAgentRelativeTime(
  targetMs: number,
  referenceMs: number = Date.now(),
): EmaRelativeTimeString {
  const deltaSec = Math.max(0, Math.floor((referenceMs - targetMs) / 1000));
  if (deltaSec < 60) return `just now (${deltaSec} seconds ago)`;
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago (${deltaSec} seconds ago)`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago (${deltaSec} seconds ago)`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago (${deltaSec} seconds ago)`;
}

export interface EmaTemporalEnvelope<T> {
  readonly context: EmaTemporalContext;
  readonly items: T[];
}

/**
 * Node: An entity or actor in a social media world.
 */
export interface EmaNode {
  readonly id: string;
  readonly world: string;
  /** Primary node category */
  readonly node_kind: "person" | "bot" | "organization" | string;
  readonly name: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
  /** IDs of channels associated with or owned by this node */
  readonly channelIds?: string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Common Channel Interface: Implemented by all worlds.
 * Each world extends channel_kind for its specific loci.
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
  /** Arbitrary platform metadata */
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
```

### 2. World-Specific Channel Extensions

Each World defines its own `channel_kind` enum/types while adhering to `EmaChannel`:

```ts
// Bilibili World channel kinds
export type BilibiliChannelKind = "space" | "dynamic" | "video" | "live_room";

export interface BilibiliChannel extends EmaChannel {
  readonly world: "bilibili";
  readonly channel_kind: BilibiliChannelKind;
}

// Telegram World channel kinds
export type TelegramChannelKind = "broadcast" | "group" | "discussion_thread";

export interface TelegramChannel extends EmaChannel {
  readonly world: "telegram";
  readonly channel_kind: TelegramChannelKind;
}

// Discord World channel kinds
export type DiscordChannelKind = "text" | "announcement" | "forum" | "thread";

export interface DiscordChannel extends EmaChannel {
  readonly world: "discord";
  readonly channel_kind: DiscordChannelKind;
}
```

### 3. Action Documentation Schema

```ts
export interface EmaActionDoc {
  /** Hierarchical dot-separated action name: e.g. "comment.like", "post.publish" */
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, {
    readonly type: "string" | "number" | "boolean" | "object" | "array";
    readonly required: boolean;
    readonly description: string;
    readonly default?: unknown;
  }>;
  readonly rateLimit?: string;
  readonly example?: Record<string, unknown>;
}
```

### 4. Local SQLite Schema for Read-Through Index

```sql
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
```

### 5. Router Endpoints

- `GET /world/:world/nodes/:id`: Returns a Node from the local index.
- `GET /world/:world/channels/:id`: Returns Channel metadata and linked channels.
- `GET /world/:world/channels/:id/items`: Returns Channel items wrapped in `EmaTemporalEnvelope`.
- `GET /world/:world/items/:id`: Returns an item (and direct replies) offline from local index.
- `GET /world/:world/actions`: Returns array of `EmaActionDoc`.
- `POST /world/:world/actions/:actionName`: Dispatches hierarchical action.

---

## Invariants
[invariants]: #invariants

### world-state-not-agent-memory

> Local social nodes, channels, and items belong strictly to the perceived World State, never written directly into or treated as agent cognitive memory files.

*Description*: External social feeds represent external platform reality.  
*Why*: Ingesting external social posts into internal cognitive memory files pollutes reflection and intimate human bonding recall.

### read-through-offline-reproducibility

> Any post or page observed by an agent must be queryable through the identical Router interface offline without triggering external platform network requests.

*Description*: Observed items are recorded with `fetchedAt` in local storage. Subsequent reads resolve from the local index.  
*Why*: Platforms enforce strict anti-bot protections. Repeatedly hitting the live platform for recently viewed items causes rate limit blocks and fragility.

### anchored-temporal-perception

> Every temporal payload emitted by a channel query must supply an anchored reference context instant and format item timestamps with human-relative duration plus explicit elapsed seconds.

*Description*: Responses must contain `context: { time: RFC-3339 }` and string dates formatted as `<duration> ago (<seconds> seconds ago)`.  
*Why*: LLMs cannot reliably calculate time deltas across multi-turn interactions. Supplying both natural units and exact second deltas eliminates hallucinated timelines.

### hierarchical-action-introspectability

> All mutative actions in a social media channel must follow a hierarchical dot-separated namespace and expose machine- and agent-readable schema documentation at runtime.

*Description*: Actions are structured as `<domain>.<action>` (e.g. `comment.like`), and endpoints provide parameter documentation and rate limits.  
*Why*: Flat action names prevent cross-world agent reuse. Introspectable documentation enables zero-shot agent tool calling.

---

## Drawbacks
[drawbacks]: #drawbacks

- **Extension Boilerplate**: Worlds must declare their specific `channel_kind` values and map their platform items to `EmaChannelItem`.
  *Mitigation*: The interface is minimal, requiring only basic fields (`id`, `world`, `channel_kind`, `name`).

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Why not a complex Block AST?**: Overkill for RFC-0002. Storing rich platform content in `metadata_json` while keeping `content` and `name` clean allows simple agents to work without an AST parser, while letting worlds attach platform-specific fields as needed.
- **Why not flat channels?**: Channels must be able to link to other channels (e.g. Space -> Live Room) and have an owner Node (e.g. Creator).

---

## Changes

### v1.1.0

- Radically simplified architecture into two core primitives: `Node` (`node_kind`) and `Channel` (`channel_kind`).
- Removed monolithic Block AST in favor of clean common interface extended per world.
- Retained local read-through index (`fetchedAt`), anchored relative timestamps, and hierarchical action docs.

### v1.0.0

- Initial draft for Board review.
