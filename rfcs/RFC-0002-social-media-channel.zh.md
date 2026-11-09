# RFC-0002 Social Media Channel Architecture（社交媒体频道架构）

[English](RFC-0002-social-media-channel.md)

> **状态**：In Review（草案供董事会评审）  
> **修订**：v1.1.0  

- Feature Name: `social-media-channel`
- Start Date: 2026-11-09
- RFC PR: Pending Board Review
- Implementation PR: Pending

## Summary
[summary]: #summary

本 RFC 将 EverMemoryArchive (EMA) 各 World 的社交媒体建模极致精简为两个核心原语：

1. **`Node`（实体节点，`node_kind: person | bot | organization | ...`）**：
   代表社交世界中的参与实体（UP 主、博主、用户、伴侣自身、社团组织）。Node 可以拥有或关联若干 Channel。
2. **`Channel`（频道容器，`channel_kind: string`）**：
   代表互动与内容发生的频道容器。**各 World 自行扩展 `channel_kind`**（如 B站扩展为 `space`、`dynamic`、`video`、`live_room`；Telegram 扩展为 `channel`、`group`；Discord 扩展为 `text`、`forum`），但**统一继承 `EmaChannel` 共通接口**。

所有 Channel 统一具备四大运行时基石能力：
- **本地读穿透索引（世界状态，而非认知记忆）**：伴侣看过的页面与帖子缓存在本地 SQLite 中（记录 `fetchedAt`）。查看过一遍后，即可通过完全相同的接口离线重访，零外部网络请求，彻底免疫平台风控。这些记录严格属于**客观世界状态（World State）**，绝不污染内部认知记忆库。
- **面向 Agent 认知特性的时间锚定与相对时间格式**：查询响应附带时间基准锚点（`context: { time: rfc-3339 }`），实体时间戳格式化为“自然语言相对时长 + 确切秒数差”：
  ```json
  {
    "context": { "time": "2026-11-09T01:30:00Z" },
    "items": [
      { "id": "1268371909155749890", "name": "...", "createdAt": "7 days ago (413830 seconds ago)" }
    ]
  }
  ```
- **分级动作命名空间**：动作采用点号分级（如 `comment.like`、`post.publish`、`comment.reply`）。
- **自文档化动作查询**：Agent 可在运行时读取 `/world/:world/actions` 自省参数文档与频控。
- **频道相互链接（Interconnection）**：Channel 可声明关联的其他 Channel 标识（`linkedChannelIds`），支持在主页空间、动态流、讨论区与直播间之间无缝跳转。

---

## Motivation
[motivation]: #motivation

### 1. 摒弃过度庞杂的通用大一统建模，回归两个核心原语

社交平台看似千差万别：B 站有空间、动态、视频和直播间；TG 有广播频道和讨论群；Discord 有文字频道与论坛帖子。如果试图用一套大一统的复杂多模态 AST 把所有平台的每种卡片（抽奖、投票、商品）全部写死，会导致系统臃肿且不可维护。

正确的解法是大幅精简，提炼为两个不变的核心：
- **`Node`**：社交世界里“谁在参与”（人、机器人、组织）。
- **`Channel`**：内容与互动“在哪里发生”。每个平台各自扩展 `channel_kind`，但继承统一的 `EmaChannel` 基础接口与规范契约。

### 2. 世界状态（World State）与认知记忆（Cognitive Memory）分离

外部动态与评论是**客观世界状态**。伴侣的**认知记忆**（`agent_state/memory`）属于主观心理反思与人类情感羁绊。将社交内容直接塞进记忆库会造成反思召回充斥杂音；保存在本地 Channel 索引中，既实现了无网络离线重访，又保障了记忆库的纯粹。

### 3. 本地读穿透缓存（无需爬虫）

Ema 不需要外部爬虫。但只要看过的页面或发布过的内容，本地以 `fetchedAt` 标记沉淀。之后 Agent 再次查看同一动态或评论时，走完全相同的 Router 路由，无需发网络请求即可秒级读取。

### 4. 消除 Agent 对绝对时间戳的心算幻觉

LLM 面对 ISO-8601 字符串难以推演距今时长。通过响应中的 `context.time` 显式锚定，配合 `"7 days ago (413830 seconds ago)"`，使 Agent 同时具备生活直觉与精确时序推理。

### 5. 分级动作与运行时自省

分级动作（`comment.like`、`post.publish`）统一跨平台的动词语义。运行时暴露的动作文档端点使 Agent 能够零样本自主理解每个动作的参数约束与调用规范。

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. 实体 Node 与频道 Channel

在任意 World 中：
* 参与者是一个 **Node**：
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
* 交互阵地是一个 **Channel**：
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

### 2. 带时间锚点的离线读穿透

Agent 查询频道内容：
```ts
const res = await router.read("/world/bilibili/channels/bilibili:dynamic:3546869527480631/items");
```
返回响应：
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

再次读取时，完全相同接口直接由本地 SQLite 索引响应，不产生网络调用。

### 3. 分级动作自文档自省

Agent 自主查阅当前平台支持的操作：
```ts
const docs = await router.read("/world/bilibili/actions");
```
返回：
```json
{
  "actions": [
    {
      "name": "comment.like",
      "description": "为动态下方的指定评论点赞",
      "parameters": {
        "postId": { "type": "string", "required": true, "description": "目标动态或帖子 ID" },
        "commentId": { "type": "string", "required": true, "description": "评论 ID" }
      },
      "rateLimit": "30/minute"
    }
  ]
}
```

执行动作：
```ts
world.interact(ctx, actor, "comment.like", {
  postId: "1268371909155749890",
  commentId: "9988776655"
});
```

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 通用契约定义

```ts
/**
 * Agent 相对时间基准锚点
 */
export interface EmaTemporalContext {
  readonly time: string;         // ISO-8601 / RFC-3339
  readonly timestampMs: number;
}

export type EmaRelativeTimeString = string;

/**
 * 格式化相对时间：例如 "<N> <单位> ago (<S> seconds ago)"
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
 * Node: 社交世界中的实体
 */
export interface EmaNode {
  readonly id: string;
  readonly world: string;
  /** 实体种类 */
  readonly node_kind: "person" | "bot" | "organization" | string;
  readonly name: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
  /** 该实体拥有或关联的 Channel ID 列表 */
  readonly channelIds?: string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * 通用 Channel 基础契约：所有 World 的 Channel 均继承此接口。
 * 各 World 自由扩展自己的 channel_kind。
 */
export interface EmaChannel {
  readonly id: string;
  readonly world: string;
  /** 频道种类（由各 World 自行扩展） */
  readonly channel_kind: string;
  /** 所属 Node ID（若适用） */
  readonly ownerNodeId?: string;
  readonly name: string;
  readonly description?: string;
  /** 相互链接的其他 Channel ID */
  readonly linkedChannelIds?: string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Channel 内的通用条目（如动态、帖子、视频、评论）
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

### 2. 各 World 平台特化扩展示例

各 World 仅需定义自己的 `channel_kind` 枚举，无需改变核心逻辑：

```ts
// Bilibili 扩展
export type BilibiliChannelKind = "space" | "dynamic" | "video" | "live_room";

export interface BilibiliChannel extends EmaChannel {
  readonly world: "bilibili";
  readonly channel_kind: BilibiliChannelKind;
}

// Telegram 扩展
export type TelegramChannelKind = "broadcast" | "group" | "discussion_thread";

export interface TelegramChannel extends EmaChannel {
  readonly world: "telegram";
  readonly channel_kind: TelegramChannelKind;
}

// Discord 扩展
export type DiscordChannelKind = "text" | "announcement" | "forum" | "thread";

export interface DiscordChannel extends EmaChannel {
  readonly world: "discord";
  readonly channel_kind: DiscordChannelKind;
}
```

### 3. 分级动作自文档模型

```ts
export interface EmaActionDoc {
  /** 点号分级动作名称，如 "comment.like", "post.publish" */
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

### 4. 本地读穿透 SQLite 表结构

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

### 5. 路由器路由端点

- `GET /world/:world/nodes/:id`：从本地索引读取 Node 档案。
- `GET /world/:world/channels/:id`：读取 Channel 描述及相互链接的 channel 列表。
- `GET /world/:world/channels/:id/items`：获取带时间锚点的 items。
- `GET /world/:world/items/:id`：离线读取特定单条 item。
- `GET /world/:world/actions`：获取当前 World 的动作自省列表。
- `POST /world/:world/actions/:actionName`：派发分级动作。

---

## Invariants
[invariants]: #invariants

### world-state-not-agent-memory

> 本地社交 nodes、channels 和 items 严格归属于外部“世界状态（World State）”，绝不直接写入伴侣的认知记忆文件。

### read-through-offline-reproducibility

> 伴侣 Agent 浏览过的内容在本地打上 `fetchedAt` 标记后，必须能够通过完全相同的 Router 接口进行离线只读访问，不得强制发起网络请求。

### anchored-temporal-perception

> 频道返回的所有时间信息必须附带参考上下文时刻锚点，并采用自然语言时长与确切秒数差的复合形式格式化。

### hierarchical-action-introspectability

> 所有动作采用分级命名空间（`domain.action`），并在运行时提供可供 Agent 自省查阅的参数模式与频控文档。

---

## Drawbacks
[drawbacks]: #drawbacks

- 各 World 需要自行映射平台私有属性到 `metadata`，并在实现中定义自己特化的 `channel_kind` 枚举。
  *缓解方案*：核心接口字段极少，扩展成本非常低。

---

## Changes

### v1.1.0

- 极大精简架构，统一收敛为两个核心原语：`Node` (`node_kind`) 与 `Channel` (`channel_kind`)。
- 移除大一统 Block AST，改由各 World 继承共通基础接口并自行扩展。
- 保持本地读穿透索引 (`fetchedAt`)、锚定相对时间戳与分级动作自省文档化。

### v1.0.0

- 初始草案供董事会评审。
