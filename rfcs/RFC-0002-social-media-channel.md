# RFC-0002 Social Media Channel Architecture

[中文版](RFC-0002-social-media-channel.zh.md)

> **State**: In Review (Draft for Board Review)  
> **Rev**: v1.0.0  

- Feature Name: `social-media-channel`
- Start Date: 2026-11-09
- RFC PR: Pending Board Review
- Implementation PR: Pending

## Summary
[summary]: #summary

This RFC establishes the unified **Social Media Channel** (`EmaSocialChannel`) architecture and shared data contracts across all EverMemoryArchive (EMA) Worlds (Bilibili, X/Twitter, Telegram, Discord, Weibo, etc.).

It addresses three foundational requirements for lifelong companion agents interacting with public social ecosystems:

1. **Local Read-Through Index (World State, Not Agent Memory)**:
   Companion agents do not run aggressive web crawlers, but they must faithfully "retain" every external page, post, and thread they have observed. Any post viewed once is persistently indexed in local storage (`fetchedAt`) and can subsequently be read offline through the exact same Router interface without re-triggering platform requests or anti-bot/Wbi risk controls. These cached posts belong strictly to **World State** (the companion's perceived external reality), not internal cognitive memory (`agent_state/memory`).

2. **Agent-Adapted Relative Temporal Perception**:
   Large Language Model (LLM) agents struggle with mental arithmetic on raw ISO-8601 timestamps. To provide immediate, grounded temporal intuition, all channel queries return an anchored temporal context (`context: { time: RFC-3339 }`), with items formatted in combined human-relative and exact second deltas:
   ```json
   {
     "context": { "time": "2026-11-09T01:30:00Z" },
     "items": [
       { "id": "1268371909155749890", "createdAt": "7 days ago (604800 seconds ago)" }
     ]
   }
   ```

3. **Hierarchical Action Taxonomy with Self-Documenting Inspection**:
   All outbound mutations follow a hierarchical dot-separated namespace (e.g. `comment.like`, `post.publish`, `comment.reply`, `comment.pin`). Worlds provide runtime action documentation endpoints (`/world/:world/actions`) so that companion agents can inspect available actions, argument schemas, permission requirements, and rate limits dynamically.

---

## Motivation
[motivation]: #motivation

### 1. Differentiating World State from Cognitive Memory

In EverMemoryArchive, an agent's **Cognitive Memory** (`agent_state/memory`) represents internal psychological consolidation: reflective insights, user preferences, emotional intimacy bonds, and factual knowledge about their human companion.

In contrast, external posts, tweets, and comments published on Bilibili or X belong to **World State**—the objective, perceived reality of an external platform. When Ema inspects her recent Bilibili feed or checks fan comments, storing raw post payloads into cognitive memory files would pollute long-term recall with ephemeral DOM data. Storing them in a local, structured World Index ensures that:
- External reality remains queryable without web requests;
- Cognitive memory focuses purely on reflections, relationships, and emotional connections;
- The boundary between "what exists out in the world" and "what Ema feels and knows internally" remains pristine.

### 2. Read-Through Caching & Anti-Risk Control Defense

Modern social platforms enforce aggressive anti-bot protections, rate limits, and cryptographic signers (e.g. Bilibili Wbi signatures, Cloudflare challenges, X API tier limits). 

Companion agents frequently need to review context: "What did I post yesterday?", "Which comment was I replying to?". If every review requires fresh network roundtrips, the companion is exposed to:
- Network latency and transient timeouts;
- Sudden risk-control blocks (captcha prompts, IP throttling);
- Inconsistent state when network endpoints change.

With a local Read-Through Index, whenever an external item is fetched or published via Playwright or authenticated APIs, it is recorded with its `fetchedAt` timestamp. Future reads against `/world/:world/posts/:id` resolve locally from SQLite/KV without network access.

### 3. Grounding Time for LLM Agents

When an LLM agent receives `"2026-11-02T01:30:00Z"`, it often cannot accurately deduce whether that was yesterday, a week ago, or earlier today relative to the current conversation instant. Calculating seconds elapsed is notoriously error-prone in pure autoregressive generation.

By enclosing all channel queries within an anchored temporal context:
- `context.time`: The current reference time (RFC-3339);
- `createdAt`: Natural relative description (`"7 days ago"`) plus explicit elapsed duration (`"(604800 seconds ago)"`).

The companion agent gains immediate natural orientation ("that was about a week ago") alongside exact machine-level precision.

### 4. Fragmented Action Verbs vs. Structured Action Taxonomy

Different platforms use disjointed terminology for identical social actions: Bilibili uses `rpid` and `type=17`, X uses `status_id` and `in_reply_to_tweet_id`, Telegram uses `message_id` and `reply_to_message_id`.

Exposing an ad-hoc action API causes agent confusion. A hierarchical taxonomy (e.g., `comment.like`, `comment.pin`, `post.publish`) standardizes the verb vocabulary while allowing each World to map the execution to its specific transport. Self-documenting endpoints let agents discover supported capabilities and parameter schemas on the fly.

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. The Social Media Channel Concept

A **Social Media Channel** (`EmaSocialChannelPart`) models a public broadcast space or creator profile within an `EmaWorld`. Examples include:
- `bilibili`: Companion's Bilibili Space and dynamic feed (`feed:main`, `space:<mid>`).
- `x`: Companion's profile timeline (`timeline:main`).
- `telegram`: Broadcast channel feed (`channel:<chat_id>`).
- `discord`: Community announcements or forum channel (`forum:<channel_id>`).

Inside a Social Media Channel, data is modeled along two streams:
1. **Post Stream (`EmaSocialPost`)**: Top-level publications (text, images, media cards, metrics, timestamps).
2. **Comment Stream (`EmaSocialComment`)**: Threaded responses under a specific post, organized in two-level or tree hierarchies (root comment -> replies).

### 2. Reading from Local Index vs. Network

When an agent requests `/world/bilibili/channel/posts`:
1. The World checks its local SQLite index.
2. If fresh or already seen, it immediately constructs an `EmaTemporalEnvelope` from local records without touching the network.
3. If an explicit refresh is requested (`?refresh=true`), the World performs browser or API fetch, updates the index with `fetchedAt: Date.now()`, and returns the updated items.

```ts
// Querying channel posts via EMA Router
const result = await router.read("/world/bilibili/channel/posts?limit=10");
```

Response representation:
```json
{
  "context": {
    "time": "2026-11-09T01:30:00Z",
    "timezone": "Asia/Shanghai"
  },
  "channel": {
    "id": "bilibili:space:3546869527480631",
    "world": "bilibili",
    "name": "Sakana酱ノ",
    "handle": "3546869527480631"
  },
  "items": [
    {
      "id": "1268371909155749890",
      "author": { "id": "3546869527480631", "name": "Sakana酱ノ" },
      "content": "【EverMemoryArchive】Ema 伴侣系统运行测试：记忆归档与动态感知连接正常 ✨",
      "createdAt": "7 days ago (604800 seconds ago)",
      "fetchedAt": "10 minutes ago (600 seconds ago)",
      "metrics": {
        "likes": 12,
        "comments": 4,
        "reposts": 1
      },
      "url": "https://t.bilibili.com/1268371909155749890"
    }
  ]
}
```

### 3. Hierarchical Actions and Introspection

An agent interacts with a channel using dot-separated action names:
```ts
// Liking a specific comment
world.interact(ctx, actor, "comment.like", {
  postId: "1268371909155749890",
  commentId: "9988776655"
});
```

To discover how to use actions, the agent queries the action documentation endpoint:
```ts
const docs = await router.read("/world/bilibili/actions");
```
Yielding:
```json
{
  "actions": [
    {
      "name": "comment.like",
      "description": "Likes an existing comment under a dynamic post",
      "parameters": {
        "postId": { "type": "string", "required": true, "description": "Target dynamic or post ID" },
        "commentId": { "type": "string", "required": true, "description": "ID of comment to like" }
      },
      "rateLimit": "30/minute"
    },
    {
      "name": "post.publish",
      "description": "Publishes a new feed dynamic via Playwright browser automation",
      "parameters": {
        "text": { "type": "string", "required": true, "description": "Dynamic text content" },
        "images": { "type": "array", "required": false, "description": "Array of image paths or URLs" }
      },
      "rateLimit": "1/15s"
    }
  ]
}
```

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Common Data Contracts

All interfaces reside in `@prism-shadow/ema/social` or `packages/ema/src/social/types.ts`:

```ts
/**
 * Agent-adapted temporal context anchoring relative time calculations.
 */
export interface EmaTemporalContext {
  /** Reference evaluation time in RFC-3339 format (e.g. "2026-11-09T01:30:00Z") */
  readonly time: string;
  /** Millisecond epoch timestamp */
  readonly timestampMs: number;
  /** Active timezone name (e.g. "Asia/Shanghai" or "UTC") */
  readonly timezone?: string;
}

/**
 * Composite relative timestamp adapted for LLM agent cognitive grounding.
 * Format: "<N> <unit> ago (<S> seconds ago)" or "just now (0 seconds ago)"
 */
export type EmaRelativeTimeString = string;

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
 * Envelope wrapping responses with an anchored temporal context.
 */
export interface EmaTemporalEnvelope<T> {
  readonly context: EmaTemporalContext;
  readonly data: T;
}

/**
 * Channel metadata and profile descriptor.
 */
export interface EmaSocialChannelProfile {
  readonly id: string;
  readonly world: string;
  readonly name: string;
  readonly handle?: string;
  readonly description?: string;
  readonly avatarUrl?: string;
  readonly bannerUrl?: string;
  readonly stats?: {
    followers?: number;
    following?: number;
    totalPosts?: number;
  };
}

/**
 * Universal Post representation stored in local World Index.
 */
export interface EmaSocialPost {
  readonly id: string;
  readonly world: string;
  readonly channelId: string;
  readonly author: {
    readonly id: string;
    readonly name: string;
    readonly isOwner?: boolean;
    readonly avatarUrl?: string;
  };
  readonly content: string;
  readonly rawContent?: unknown;
  readonly media?: Array<{
    readonly type: "image" | "video" | "audio" | "link";
    readonly url: string;
    readonly thumbnailUrl?: string;
  }>;
  /** ISO-8601 creation time */
  readonly createdAtIso: string;
  /** Relative time computed against query context */
  readonly createdAt: EmaRelativeTimeString;
  /** Epoch timestamp in ms when item was first fetched/cached */
  readonly fetchedAtMs: number;
  /** Relative time when item was fetched */
  readonly fetchedAt: EmaRelativeTimeString;
  readonly metrics?: {
    likes?: number;
    comments?: number;
    shares?: number;
    views?: number;
  };
  readonly isPinned?: boolean;
  readonly url?: string;
}

/**
 * Threaded Comment representation in local World Index.
 */
export interface EmaSocialComment {
  readonly id: string;
  readonly world: string;
  readonly postId: string;
  /** Top-level root comment ID if part of a nested reply thread */
  readonly rootCommentId?: string;
  /** Immediate parent comment ID if replying to a specific user */
  readonly parentCommentId?: string;
  readonly author: {
    readonly id: string;
    readonly name: string;
    readonly isOwner?: boolean;
    readonly avatarUrl?: string;
  };
  readonly content: string;
  readonly createdAtIso: string;
  readonly createdAt: EmaRelativeTimeString;
  readonly fetchedAtMs: number;
  readonly fetchedAt: EmaRelativeTimeString;
  readonly likes?: number;
  readonly isLikedByAuthor?: boolean;
  readonly isPinned?: boolean;
}
```

### 2. Action Documentation & Hierarchical Registry

```ts
export interface EmaActionParameterDoc {
  readonly type: "string" | "number" | "boolean" | "object" | "array";
  readonly required: boolean;
  readonly description: string;
  readonly default?: unknown;
}

export interface EmaActionDoc {
  /** Hierarchical dot-separated action name: e.g. "comment.like", "post.publish" */
  readonly name: string;
  /** Human & agent readable purpose */
  readonly description: string;
  /** Target scope: "channel" | "post" | "comment" */
  readonly targetScope: string;
  /** Parameter schema */
  readonly parameters: Record<string, EmaActionParameterDoc>;
  /** Rate limit constraints (e.g. "1/15s", "30/minute") */
  readonly rateLimit?: string;
  /** Example payload */
  readonly example?: Record<string, unknown>;
}

export interface EmaActionRegistry {
  registerAction(doc: EmaActionDoc, handler: EmaActionHandler): Disposable;
  getActionDoc(name: string): EmaActionDoc | undefined;
  listActionDocs(): ReadonlyArray<EmaActionDoc>;
}
```

### 3. SQLite Storage Schema for World Index

To preserve read-through reproducibility, every World housing a Social Media Channel maintains an internal SQLite table in its local database:

```sql
CREATE TABLE IF NOT EXISTS seen_social_posts (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  media_json TEXT,
  metrics_json TEXT,
  created_at_iso TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  fetched_at_ms INTEGER NOT NULL,
  url TEXT
);

CREATE TABLE IF NOT EXISTS seen_social_comments (
  id TEXT PRIMARY KEY,
  world TEXT NOT NULL,
  post_id TEXT NOT NULL,
  root_comment_id TEXT,
  parent_comment_id TEXT,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at_iso TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  fetched_at_ms INTEGER NOT NULL,
  likes INTEGER DEFAULT 0,
  is_liked_by_author INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_social_posts_channel ON seen_social_posts(channel_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_social_comments_post ON seen_social_comments(post_id, created_at_ms ASC);
```

### 4. Router Endpoints

Every Social Media Channel mounts three standard sub-routes on `EmaRouter`:

1. `GET /world/:world/channel`: Returns channel profile and statistics.
2. `GET /world/:world/channel/posts`: Returns recent posts with anchored temporal context.
3. `GET /world/:world/posts/:id`: Returns single post and top comments from local index.
4. `GET /world/:world/posts/:id/comments`: Returns paginated comment tree.
5. `GET /world/:world/actions`: Returns all registered action documentation.
6. `POST /world/:world/actions/:actionName`: Dispatches hierarchical action (conforms to RFC-0001 `interact`).

---

## Invariants
[invariants]: #invariants

### world-state-not-agent-memory

> Local social posts and comments indexed in a channel belong strictly to the perceived World State, never directly written into or treated as agent cognitive memory files.

*Description*: Raw DOM content, fetched feed items, and fan comment trees represent external platform state.  
*Why*: Treating external public posts as internal agent memories corrupts identity consolidation and inflates context windows with third-party social media noise. Ema accesses world state when looking outward; she writes cognitive memory only when internally reflecting.

### read-through-offline-reproducibility

> Any post or comment observed or published by an agent must be queryable through the identical Router interface offline without triggering external platform network requests.

*Description*: Once an item has been indexed with `fetchedAt`, subsequent reads return the cached snapshot.  
*Why*: Social platforms impose severe anti-bot challenges and rate limits. If Ema's self-reflection triggers repeated network calls for posts she just authored or read, she risks platform bans and runtime fragility.

### anchored-temporal-perception

> Every temporal payload emitted by a social media channel must include an anchored reference context instant and format relative timestamps with both natural language units and explicit elapsed second deltas.

*Description*: Responses must supply `context: { time: RFC-3339 }` and string dates matching `<duration> ago (<seconds> seconds ago)`.  
*Why*: Autoregressive LLMs cannot reliably calculate time deltas across multi-turn interactions. Supplying both natural units and exact second deltas eliminates hallucinated timelines.

### hierarchical-action-introspectability

> All mutative actions in a social media channel must follow a hierarchical dot-separated namespace and expose machine- and agent-readable schema documentation at runtime.

*Description*: Actions are structured as `<domain>.<action>` (e.g. `comment.like`), and endpoints provide parameter documentation and rate limits.  
*Why*: Flat or platform-specific action names prevent cross-world agent reuse. Introspectable documentation enables zero-shot agent tool calling and runtime action discovery.

---

## Drawbacks
[drawbacks]: #drawbacks

- **Local Storage Overhead**: Storing full text and metadata for dozens of posts and hundreds of comments in SQLite consumes local disk space (typically 10-50 MB per active channel over months).
  *Mitigation*: Implement pruning policies for unpinned comments older than 90 days while retaining posts permanently.
- **Cache Staleness**: A post's metrics (like count, comment count) freeze at `fetchedAt` time until an explicit refresh occurs.
  *Mitigation*: The `fetchedAt` relative timestamp makes staleness explicitly clear to the companion agent, allowing her to decide whether to dispatch an active refresh.

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### Alternative 1: Direct Network Fetch on Every Request
- Discard local indexing and query Bilibili/X on demand.
- *Rejected*: Violates anti-risk control invariants, causes frequent IP bans, fails completely when offline or traveling, and introduces 2-5s latency per turn.

### Alternative 2: Ingesting Posts into Agent Long-Term Markdown Memory
- Save every viewed post into `agent_state/memory/user/` or `agent_state/memory/workspace/`.
- *Rejected*: Completely conflates cognitive memory (facts, intimate bonds, personal habits) with raw web scraping. Memory search would drown in spam comments and feed cards.

---

## Prior art
[prior-art]: #prior-art

- **HTTP RFC-7234 (Caching)**: Defines `Age`, `Date`, and read-through cache semantics for web resources.
- **ActivityStreams 2.0 (W3C)**: Standardizes actor, object, target, and activity verbs (`Create`, `Like`, `Announce`) across federated social networks (Mastodon, Bluesky).
- **PenguinHarness Router & Tool Manifests**: In Penguin core, tools expose explicit parameter schemas and documentation for agent reflection.

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- Should media attachments (images/video thumbnails) be lazily downloaded to local scratchpad or stored as remote URLs?
- For large comment sections (> 1000 comments), what is the optimal sliding window pagination for LLM context packing?

---

## Future possibilities
[future-possibilities]: #future-possibilities

- Cross-platform post multicast: publishing one `EmaSocialPost` simultaneously to Bilibili Opus, X, and Telegram Channel.
- Fan intimacy attribution: building an engagement graph from `EmaSocialComment` authors to identify regular supporters and feed their profiles into sleep consolidation.

---

## Changes

### v1.0.0

- Initial draft for Board review.
