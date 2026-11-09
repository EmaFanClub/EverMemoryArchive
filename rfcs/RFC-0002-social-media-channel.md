# RFC-0002 Social Media Channel Architecture

[中文版](RFC-0002-social-media-channel.zh.md)

> **State**: In Review (Draft for Board Review)  
> **Rev**: v1.2.0  

- Feature Name: `social-media-channel`
- Start Date: 2026-11-09
- RFC PR: Pending Board Review
- Implementation PR: Pending

## Summary
[summary]: #summary

This RFC establishes a unified architectural framework for social media channels across EverMemoryArchive (EMA) Worlds, simplifying all social media interactions into two core conceptual primitives:

1. **`Node` (`node_kind`)**:
   Represents social actors and entities (creators, users, bots, organizations) across external platforms. A Node can own, administer, or link to Channels.
2. **`Channel` (`channel_kind`)**:
   Represents an interaction or publication channel. Each World extends `channel_kind` to fit its platform (e.g. Bilibili extends with `space`, `dynamic`, `video`, `live_room`; Telegram extends with `channel`, `group`; Discord extends with `text`, `forum`), while all Channels adhere to common architectural contracts.

All Channels share four core runtime capabilities:
- **Local Read-Through Index (World State, Not Agent Memory)**: Posts and pages viewed or published by Ema are cached locally in persistent storage with observation timestamps (`fetchedAt`). Once viewed, they can be re-inspected offline via the exact same interface without hitting external network or triggering platform risk controls. These records belong strictly to the perceived **World State**, not internal cognitive memory.
- **Agent-Adapted Relative Temporal Perception**: Responses provide an anchored time context (`context: { time: RFC-3339 }`) and format relative item timestamps as natural units plus exact elapsed seconds (e.g. `"2 minutes ago (120 seconds ago)"`), eliminating LLM arithmetic hallucinations.
- **Hierarchical Action Namespace & Introspection**: Actions use dot notation (e.g. `comment.like`, `post.publish`, `comment.reply`). Ema can inspect action schemas, parameter requirements, and rate limits at runtime via `/world/:world/actions`.
- **Channel Interconnection**: Channels declare links to other channels (`linkedChannelIds`), enabling autonomous multi-hop navigation across spaces, feeds, discussions, and live rooms.

---

## Motivation
[motivation]: #motivation

### 1. The Trap of Monolithic Over-Modeling vs. The Two Primitives

Social media platforms are wildly heterogeneous: Bilibili has spaces, dynamic feeds, video archives, and live rooms; Telegram has broadcast channels and discussion groups; Discord has text channels and forum threads. Furthermore, posts contain varying rich formats.

Attempting to build a monolithic universal format with dozens of rigid block types leads to unnecessary complexity. Conversely, treating each platform as an ad-hoc silo prevents Ema from learning reusable social behaviors.

The solution is radical simplification into two fundamental concepts:
- **`Node`**: *Who* exists in the social world (users, companions, organizations).
- **`Channel`**: *Where* communication occurs and *how* content flows. Each World defines its own `channel_kind`, but all channels adhere to a common architectural baseline.

### 2. World State vs. Agent Memory

External posts, comments, and pages belong to the objective **World State**. Ema's **Cognitive Memory** (`agent_state/memory`) belongs to internal reflection, human intimacy, and consolidated knowledge. Storing external social posts inside cognitive memory files pollutes recall with ephemeral web noise. Storing them in a local Channel index ensures offline reproducibility without memory pollution.

### 3. Read-Through Caching Without Scrapers

Ema does not need an aggressive crawler. However, "remembering" every page or post Ema has viewed is invaluable. When Ema visits a post, it is indexed with its `fetchedAt` timestamp. Later reviews (e.g. "What did that fan comment say?") query the identical Router endpoint and resolve instantly from local storage without platform network calls.

### 4. Anchoring Time for LLM Agents

LLM agents struggle with mental arithmetic on raw ISO-8601 timestamps. By anchoring responses with `context: { time: RFC-3339 }` and presenting item timestamps as `"7 days ago (604800 seconds ago)"`, Ema gains both natural orientation and exact machine precision without calculation error.

### 5. Hierarchical Actions & Runtime Discovery

Hierarchical action names (`comment.like`, `post.publish`) prevent verb collisions and standardize companion behaviors across worlds. Action documentation endpoints allow Ema to inspect argument schemas and rate limits dynamically before executing actions.

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. Nodes and Channels Representation

In any World:
* An entity is projected as a **Node**:
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
* An interaction locus is projected as a **Channel**:
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

When Ema queries items from a channel:
`GET /world/bilibili/channels/bilibili:dynamic:3546869527480631/items?time=2026-11-09T01:30:00Z`

Response envelope:
```json
{
  "context": {
    "time": "2026-11-09T01:30:00Z",
    "timestampMs": 1794187800000
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
      "createdAt": "7 days ago (604800 seconds ago)",
      "fetchedAt": "10 minutes ago (600 seconds ago)",
      "url": "https://t.bilibili.com/1268371909155749890"
    }
  ]
}
```

If Ema queries this post again, the response is served directly from the local read-through index without triggering platform network requests.

### 3. Inspecting and Executing Hierarchical Actions

Ema introspects supported actions dynamically:
`GET /world/bilibili/actions`

Response:
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

Ema executes the action via `world.interact(...)` or HTTP endpoint:
`POST /world/bilibili/actions/comment.like`
```json
{
  "postId": "1268371909155749890",
  "commentId": "9988776655"
}
```

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Core Contract & Requirement Baseline

Canonical TypeScript interfaces and contracts are defined in `packages/ema/src/channel.ts`. This section outlines the architectural **minimum required capabilities and attributes**:

#### (1) `Node` (Social Actor Primitive)
- **Global Identity**: Must provide a globally unique address (`id`) qualified by world (e.g. `bilibili:person:<uid>`) and originating `world` identifier.
- **Categorization (`node_kind`)**: Must categorize entities (e.g. `person`, `bot`, `organization`).
- **Entity Metadata**: Must provide display name, optional platform handle, avatar URL, and arbitrary platform metadata.
- **Channel Association**: Must declare owned or associated channels (`channelIds`), enabling navigation from entity to their interaction loci.

#### (2) `Channel` (Social Locus Primitive)
- **Addressing & Identity**: Must provide unique channel ID qualified by world and channel kind (e.g. `bilibili:dynamic:<uid>`), along with originating `world`.
- **Extensible Kind (`channel_kind`)**: Each world defines its own domain partitions (e.g. Bilibili defines `space`, `dynamic`, `video`, `live_room`; Telegram defines `broadcast`, `group`; Discord defines `text`, `forum`).
- **Ownership & Topology**: Associates with an owning `ownerNodeId` where applicable, and declares interconnected channels via `linkedChannelIds` for multi-hop graph traversal.
- **Descriptive Metadata**: Supplies display name, description, and arbitrary platform-specific properties.

#### (3) `ChannelItem` (Social Content & Interaction Entry)
- **Addressing**: Unique item identifier within the channel, targeting parent channel (`channelId`), and attributing author (`authorNodeId`).
- **Content Payload**: Text content, optional title/subject, optional parent item reference (`parentItemId` for nested comments/threads), and external platform URL.
- **Dual-Temporal Grounding**: Must provide both ISO-8601 creation timestamp and anchored relative time (`createdAt`), as well as the local observation timestamp (`fetchedAtMs` / `fetchedAt`) for offline read-through verification.

#### (4) `TemporalContext` & `TemporalEnvelope` (Temporal Anchoring)
- **Reference Instant**: Queries must include an anchored reference time context (`context: { time, timestampMs }`), establishing a stable perception baseline.
- **Dual Representation**: Relative time representation must present both human-readable duration units and exact elapsed seconds (e.g. `<duration> ago (<seconds> seconds ago)` or `just now (0 seconds ago)`), preventing LLM arithmetic errors.

#### (5) `ActionDoc` (Introspectable Action Schema)
- **Hierarchical Naming**: Must follow a dot-separated domain hierarchy (e.g. `post.publish`, `comment.reply`, `danmaku.send`).
- **Self-Documenting Schema**: Must expose parameter definitions (name, type, required, description, default), invocation rate limits, and example payloads to enable zero-shot autonomous tool calling by companion agents.

### 2. Local Read-Through Caching Architecture

- **World State Segregation**: External social nodes, channels, and observed items are persisted in local relational storage, strictly separated from agent cognitive memory.
- **Zero Memory Pollution**: Social media items represent external world facts and are strictly decoupled from internal cognitive memory (`agent_state/memory`).
- **Read-Through Invariant**: When an item is first observed (inbound poll, webhook, or outbound action dispatch), it is recorded with its fetch timestamp (`fetched_at_ms`). Subsequent queries must reproduce identically from the local index without external platform network calls.

### 3. Unified Router Projection

Worlds exposing social media channels mount standard resource endpoints on the unified `EmaRouter`:
- `GET /world/:world/nodes/:id`: Resolves a social entity Node from the local index.
- `GET /world/:world/channels`: Lists available channels in the world.
- `GET /world/:world/channels/:id`: Resolves channel metadata and linked channels.
- `GET /world/:world/channels/:id/items`: Returns channel items wrapped in a temporal envelope anchored to the query instant.
- `GET /world/:world/items/:id`: Queries a specific post, comment, or thread offline.
- `GET /world/:world/actions`: Introspects registered hierarchical actions and their schemas.
- `POST /world/:world/actions/:actionName`: Dispatches actions with argument validation, content filtering, and anti-flooding rate limiting.

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

- **Extension Boilerplate**: Worlds must declare their specific `channel_kind` values and map platform items to common channel items.
  *Mitigation*: The interface is minimal, requiring only basic identity and content fields.

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Why not a complex Block AST?**: Storing rich platform content in metadata while keeping text content clean allows simple agents to work without an AST parser, while letting worlds attach platform-specific fields as needed.
- **Why not flat channels?**: Channels must be able to link to other channels (e.g. Space -> Live Room) and have an owner Node (e.g. Creator).

---

## Changes

### v1.2.0

- Removed concrete TypeScript code blocks, function bodies, and SQL schemas per architectural guidelines.
- Aligned reference specification with RFC-0001 conceptual requirement baselines and pointing to `packages/ema/src/channel.ts`.

### v1.1.0

- Radically simplified architecture into two core primitives: `Node` (`node_kind`) and `Channel` (`channel_kind`).
- Removed monolithic Block AST in favor of clean common interface extended per world.
- Retained local read-through index (`fetchedAt`), anchored relative timestamps, and hierarchical action docs.

### v1.0.0

- Initial draft for Board review.
