# RFC-0002 Social Media Channel Architecture（社交媒体频道架构）

[English](RFC-0002-social-media-channel.md)

> **状态**：In Review（草案供董事会评审）  
> **修订**：v1.0.0  

- Feature Name: `social-media-channel`
- Start Date: 2026-11-09
- RFC PR: Pending Board Review
- Implementation PR: Pending

## Summary
[summary]: #summary

本 RFC 确立 EverMemoryArchive (EMA) 连接各社交平台（Bilibili 动态/专栏、X/Twitter、Telegram 频道、Discord 论坛、微博等）的统一 **Social Media Channel（社交媒体频道）** 架构与通用数据契约模型。

本设计系统性解决终生伴侣 Agent 在公共社交生态交互中的三项关键挑战：

1. **本地读穿透索引（世界状态，而非认知记忆）**：
   伴侣 Agent 不需要侵入式的自动化爬虫，但必须能够忠实地“感知并记住”所有曾经浏览、发布或互动过的外部动态与评论。任何页面一旦被伴侣查看过，即在本地持久化索引（记录 `fetchedAt`），后续无需联网即可通过完全相同的 Router 接口查看离线快照，避免重复触发平台风控（如 Bilibili Wbi 鉴权、X API 限频）。这些本地 post 严格属于 **World State（客观世界感知状态）**，而非内部认知记忆（`agent_state/memory`）。

2. **面向 Agent 认知特性的时间锚定与相对时间格式**：
   大语言模型天然不擅长基于绝对 ISO-8601 时间戳进行复杂的跨轮次相对时间心算。为此，所有社交频道查询返回均提供显式的时间上下文锚点（`context: { time: RFC-3339 }`），且所有实体时间戳统一格式化为“自然语言相对时长 + 确切流逝秒数”复合表达：
   ```json
   {
     "context": { "time": "2026-11-09T01:30:00Z" },
     "items": [
       { "id": "1268371909155749890", "createdAt": "7 days ago (604800 seconds ago)" }
     ]
   }
   ```

3. **分级动作命名（Hierarchical Actions）与自文档化查询**：
   所有外发交互采用点号分级的动作语义体系（如 `comment.like`、`post.publish`、`comment.reply`、`comment.pin`），并且 World 提供自省文档接口（`/world/:world/actions`），使伴侣 Agent 能够在运行时自主查询可用动作、参数约束、权限要求与速率限制。

---

## Motivation
[motivation]: #motivation

### 1. 严格区隔“世界状态（World State）”与“认知记忆（Cognitive Memory）”

在 EverMemoryArchive 架构中，伴侣的**认知记忆**（`agent_state/memory`）承载内部反思、用户画像、亲密度演进与人类习惯。

然而，在 Bilibili 或 X 上公开发布的动态、推文与粉丝跟帖，本质上是**外部客观世界状态（World State）**。如果将伴侣看过的每条动态和上千条评论都直接塞进伴侣内部的 Markdown 记忆库，会导致记忆检索被大量的外部流水账与噪音污染。通过在各 World 建立规范的本地世界索引（World Index）：
- 外部世界历史无需联网即可随时被 Agent 重访；
- 内部记忆库专注沉淀真挚的情感羁绊与反思；
- 保持“伴侣心中的感受与知识”与“外部客观世界发生的事情”之间清晰的边界。

### 2. 本地读穿透缓存与反风控保护（Anti-Risk Control）

现代主流社交平台普遍实施严厉的反爬虫、IP 节流与动态签名校验（例如 B站的 Wbi 签名、Cloudflare 人机验证、账号风控）。

伴侣 Agent 在思考时经常需要回顾“我前天发的动态是什么”、“那条被赞最多的评论说了什么”。如果每次回顾都要发起真实的网络请求，伴侣将频繁面临：
- 网络波动与偶发超时；
- 突发的验证码拦截与封号风险；
- 平台接口变更导致的运行脆弱性。

有了本地索引，任何通过 Playwright 或受控 API 拉取或发布的动态，都会以 `fetchedAt` 标记沉淀在本地 SQLite 中。下次通过相同的接口读取时，系统优先命中本地快照，实现零网络开销与绝对的风控安全。

### 3. Agent 的相对时间感知困境

当 LLM 接收到 `"2026-11-02T01:30:00Z"` 时，模型通常难以精准推算这是 7 天前还是昨天，更无法准确计算期间过去了多少秒。

通过统一的时间上下文信封：
- `context.time` 提供确切的参考时刻（RFC-3339）；
- `createdAt` 提供自然语言直觉（`"7 days ago"`）与机器精度（`"(604800 seconds ago)"`）。

Agent 能够同时获得自然的情感判断（“这是上周的事情了”）与精准的时序推理能力。

### 4. 平台动作割裂与分级语义需求

各平台在互动动作上的命名极其零散（B站为 `rpid` 根评点赞，X 为 tweet favorite，TG 为 message reaction）。

如果各 World 暴露出杂乱的特化接口，Agent 难以形成通用的社交行为策略。采用统一的分级命名空间（`comment.like`、`post.publish`）抹平底层差异，配合运行时的自省文档接口，让 Agent 具备真正的零样本工具调用能力。

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. 社交媒体频道概念（Social Media Channel）

在 `EmaWorld` 中，**社交媒体频道**（`EmaSocialChannelPart`）代表伴侣在外部平台的个人主页、公开广播空间或内容阵地。例如：
- `bilibili`：伴侣的 B 站个人空间与动态流（`feed:main`, `space:<mid>`）。
- `x`：伴侣的推文主页（`timeline:main`）。
- `telegram`：伴侣的广播频道（`channel:<chat_id>`）。
- `discord`：社群公告栏或论坛频道（`forum:<channel_id>`）。

频道内部统一分为两条主线流：
1. **动态帖子流（Post Stream）**：顶级广播发布（图文、卡片、指标、时间戳）。
2. **跟帖评论流（Comment Stream）**：挂载在特定动态下的讨论树（根评论 -> 子回复）。

### 2. 本地读穿透与相同接口调用

伴侣 Agent 无论在有网还是离线状态，查询接口完全一致：
```ts
// 统一通过 EMA 路由器检索频道动态
const res = await router.read("/world/bilibili/channel/posts?limit=10");
```

返回的标准 JSON 信封：
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

### 3. 分级动作与动作文档查询

Agent 可以使用点号分割的标准动作名发起交互：
```ts
// 给粉丝的一条温馨评论点赞
world.interact(ctx, actor, "comment.like", {
  postId: "1268371909155749890",
  commentId: "9988776655"
});
```

Agent 在执行动作前，可直接读取动作元数据文档：
```ts
const docs = await router.read("/world/bilibili/actions");
```
返回文档示例：
```json
{
  "actions": [
    {
      "name": "comment.like",
      "description": "为动态下方的指定评论点赞",
      "parameters": {
        "postId": { "type": "string", "required": true, "description": "目标动态 ID" },
        "commentId": { "type": "string", "required": true, "description": "待点赞的评论 ID" }
      },
      "rateLimit": "30/minute"
    },
    {
      "name": "post.publish",
      "description": "通过 Playwright 浏览器自动化发布图文动态",
      "parameters": {
        "text": { "type": "string", "required": true, "description": "动态正文文本" },
        "images": { "type": "array", "required": false, "description": "图片路径或 URL 数组" }
      },
      "rateLimit": "1/15s"
    }
  ]
}
```

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 通用数据契约（Common Data Contracts）

所有标准契约位于 `packages/ema/src/social/types.ts`：

```ts
/**
 * Agent 相对时间感知上下文锚点
 */
export interface EmaTemporalContext {
  /** 基准评估时间（RFC-3339 字符串，例如 "2026-11-09T01:30:00Z"） */
  readonly time: string;
  /** 毫秒时间戳 */
  readonly timestampMs: number;
  /** 时区 */
  readonly timezone?: string;
}

/**
 * 复合相对时间格式："<N> <单位> ago (<S> seconds ago)" 或 "just now (0 seconds ago)"
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
 * 携带相对时间上下文的统一信封
 */
export interface EmaTemporalEnvelope<T> {
  readonly context: EmaTemporalContext;
  readonly data: T;
}

/**
 * 社交频道档案与元数据描述
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
 * 本地世界索引中的标准 Post 数据结构
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
  /** ISO-8601 发布时间 */
  readonly createdAtIso: string;
  /** 计算出的自然相对时间 */
  readonly createdAt: EmaRelativeTimeString;
  /** 本地首次抓取/持久化毫秒时间戳 */
  readonly fetchedAtMs: number;
  /** 本地抓取相对时间 */
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
 * 本地世界索引中的标准 Comment 数据结构
 */
export interface EmaSocialComment {
  readonly id: string;
  readonly world: string;
  readonly postId: string;
  /** 楼层跟帖中的顶级根评论 ID */
  readonly rootCommentId?: string;
  /** 直接回复的目标父评论 ID */
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

### 2. 动作文档契约与分级注册表（Action Registry）

```ts
export interface EmaActionParameterDoc {
  readonly type: "string" | "number" | "boolean" | "object" | "array";
  readonly required: boolean;
  readonly description: string;
  readonly default?: unknown;
}

export interface EmaActionDoc {
  /** 点号分级动作名称，例如 "comment.like", "post.publish" */
  readonly name: string;
  /** 动作功能描述 */
  readonly description: string;
  /** 作用范围："channel" | "post" | "comment" */
  readonly targetScope: string;
  /** 参数定义 */
  readonly parameters: Record<string, EmaActionParameterDoc>;
  /** 频控说明，如 "1/15s", "30/minute" */
  readonly rateLimit?: string;
  /** 示例调用荷载 */
  readonly example?: Record<string, unknown>;
}

export interface EmaActionRegistry {
  registerAction(doc: EmaActionDoc, handler: EmaActionHandler): Disposable;
  getActionDoc(name: string): EmaActionDoc | undefined;
  listActionDocs(): ReadonlyArray<EmaActionDoc>;
}
```

### 3. 本地索引 SQLite 持久化表结构

为了保证离线只读与读穿透复现，各社交 World 统一维护两张轻量级 SQLite 表：

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

### 4. 统一路由器接口（Router Endpoints）

所有社交 World 在 `EmaRouter` 上挂载以下标准端点：

1. `GET /world/:world/channel`：获取当前频道档案与基础统计。
2. `GET /world/:world/channel/posts`：获取频道近期动态帖子列表（带时间锚点）。
3. `GET /world/:world/posts/:id`：读取指定动态单篇详情与概览。
4. `GET /world/:world/posts/:id/comments`：分页获取动态下的评论树。
5. `GET /world/:world/actions`：获取当前 World 支持的所有自文档化动作列表。
6. `POST /world/:world/actions/:actionName`：派发分级动作（符合 RFC-0001 `interact` 语义）。

---

## Invariants
[invariants]: #invariants

### world-state-not-agent-memory

> 本地社交帖子与评论索引严格归属于外部客观“世界状态（World State）”，绝不直接写入或视同伴侣的内部“认知记忆（Cognitive Memory）”。

*说明*：网络抓取的原始文本与跟帖数据代表外部现实。  
*为什么重要*：若将外部社交媒体内容混入伴侣内部记忆库，会导致反思召回失真，并在上下文窗口中引入大量无序杂音。伴侣向外看时检索世界状态，向内思考时才写入认知记忆。

### read-through-offline-reproducibility

> 伴侣 Agent 一旦浏览或发布过某篇动态或评论，系统必须保证通过完全相同的 Router 接口能够进行离线查看，不得强制要求重新触发外部网络请求。

*说明*：抓取的数据附带 `fetchedAt` 驻留本地快照。  
*为什么重要*：社交网络严苛的风控机制要求极其严格的防爬防护。若伴侣反复自我查看刚发布的动态都需要敲打线上接口，将导致严重的封号风险与系统脆弱性。

### anchored-temporal-perception

> 社交媒体频道输出的所有时间荷载，必须提供基准上下文时刻锚点，并采用“自然语言时长 + 确切秒数差”的复合格式表达相对时间。

*说明*：必须包含 `context: { time: RFC-3339 }`，且格式如 `<时长> ago (<秒数> seconds ago)`。  
*为什么重要*：自回归大模型无法可靠地自行计算多轮跨度秒数。显式锚定与复合表达彻底消除 Agent 对时序的前后倒错与幻觉。

### hierarchical-action-introspectability

> 社交媒体频道的所有交互动作必须遵循分级点号命名空间，并在运行时提供机器与 Agent 均可读的自省文档模式（Schema）。

*说明*：动作为 `<域>.<动作>`（如 `comment.like`），并通过端点输出参数类型、必需性与频控规则。  
*为什么重要*：扁平化或平台专属动词阻断了跨世界策略复用。自省文档支撑 Agent 实现无缝的自主决策与零样本交互。

---

## Drawbacks
[drawbacks]: #drawbacks

- **本地存储体积**：在长期运行中，保存数十篇动态和数千条评论的快照会占用数兆至数十兆的 SQLite 空间。
  *缓解方案*：保留全部顶层 posts，但对超过 90 天且未被伴侣标记置顶或交互的冷门评论进行分段归档或清理。
- **快照数据时效性（Staleness）**：如果不显式刷新，动态的点赞数和新评论停留在 `fetchedAt` 时刻。
  *缓解方案*：响应中的 `fetchedAt` 相对时间让 Agent 清晰获知数据新鲜度，并自主决定是否发起带 `refresh=true` 的在线同步。

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### 方案替代 1：每次读取均实时请求平台接口
- 不做本地索引，每次读帖子直接调用 Playwright 重新打入网络。
- *不采纳原因*：严重违背反风控与高可用原则，每次阅读引入 2~5 秒延迟，离线测试完全失效。

### 方案替代 2：将动态直接存为 Markdown 记忆文件
- 将看过的动态写入 `agent_state/memory/user/`。
- *不采纳原因*：混淆了外部现实感知与主观记忆巩固。知识检索时充斥着第三方的短评噪音，破坏了伴侣人格与记忆体系的纯粹性。

---

## Prior art
[prior-art]: #prior-art

- **HTTP RFC-7234 (Caching)**：确立了 Web 资源的 `Age`、`Date` 与读穿透缓存语义。
- **ActivityStreams 2.0 (W3C)**：在分布式社交网络（Mastodon、Bluesky）中标准化了 Actor、Object、Target 及动作动词（`Create`, `Like`, `Announce`）。
- **PenguinHarness Router 与 Tool Manifests**：Penguin 核心运行时中工具向 Agent 暴露严格参数 Schema 与描述的内省自省模式。

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 媒体附件（图片相册、视频封面）应当仅保存远程 URL 还是按需下载至 scratchpad？
- 针对超大评论区（> 1000 条），对 LLM 上下文最友好的滑动窗口和亲密度排序策略细节。

---

## Future possibilities
[future-possibilities]: #future-possibilities

- 跨平台动态多播（Multicast）：一次编写 `EmaSocialPost`，同时投递至 B 站动态、X 与 Telegram Channel。
- 粉丝亲密度图谱（Intimacy Graph）：从 `EmaSocialComment` 提取常客与高频支持者，沉淀至睡眠记忆巩固流程。

---

## Changes

### v1.0.0

- 初始草案供董事会评审。
