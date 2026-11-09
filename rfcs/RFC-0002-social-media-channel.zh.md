# RFC-0002 社交媒体 Channel 架构

[English Version](RFC-0002-social-media-channel.md)

> **状态**：审阅中（董事会审查草案）  
> **版本**：v1.2.0  

- 特性名称：`social-media-channel`
- 起始日期：2026-11-09
- RFC PR：待董事会审查
- 实现 PR：待定

## Summary
[summary]: #summary

本 RFC 为 EverMemoryArchive（EMA）各世界（World）建立统一的社交媒体渠道抽象体系，将所有异构社交平台的交互收敛为两大核心概念原语：

1. **`Node`（`node_kind`）**：
   表征外部平台中的社交实体与行动主体（创作者、用户、机器人、组织）。一个 Node 可以拥有、管理或关联多个 Channel。
2. **`Channel`（`channel_kind`）**：
   表征交互或发布渠道。每个 World 可根据平台特性自由扩展自己的 `channel_kind`（例如 Bilibili 扩展为 `space`、`dynamic`、`video`、`live_room`；Telegram 扩展为 `channel`、`group`；Discord 扩展为 `text`、`forum`），所有 Channel 均遵循统一的架构契约。

所有 Channel 共享以下四项核心运行时能力：
- **本地 Read-Through 离线索引（客观世界状态，非 Agent 记忆）**：Ema 浏览或发布的动态、帖子在本地 SQLite 中带抓取时间戳（`fetchedAt`）缓存。再次查看时完全通过同一接口从本地重现，不消耗外网带宽，不触发平台风控；客观事实与 Agent 认知记忆物理隔离。
- **Agent 适配的相对时间感知**：响应包裹统一时间锚点上下文（`context: { time: RFC-3339 }`），并将条目时间格式化为“自然单位 + 精确已过秒数”（如 `"2 minutes ago (120 seconds ago)"`），彻底消除大模型在时间计算上的幻觉。
- **层级化动作命名空间与运行时自省**：采用点号分隔层级命名（如 `comment.like`、`post.publish`、`comment.reply`），Ema 可在运行时动态通过 `/world/:world/actions` 查询动作文档、参数规范与速率限制。
- **渠道图谱互联**：Channel 声明与其他 Channel 的关联拓扑（`linkedChannelIds`），支持伴侣 Agent 自主在个人空间、动态流、讨论区与直播间之间跳转漫游。

---

## Motivation
[motivation]: #motivation

### 1. 摆脱过度建模陷阱与两大原语的确立

社交媒体形态高度分化：Bilibili 拥有个人空间、动态流、视频投稿和直播间；Telegram 拥有广播频道和群组；Discord 拥有文本频道和论坛帖子；且帖子内包含复杂图文。

试图为所有平台设计大一统的繁重通用块结构，会导致系统极度臃肿；反之，若为每个平台单独写一套孤立代码，又会导致伴侣系统无法沉淀通用的社交交互认知。

破局点在于将概念极度抽象为两大原语：
- **`Node`**：社交世界里**谁**在交互（用户、创作者、组织）；
- **`Channel`**：沟通在**哪里**发生，内容如何流动。各平台自行定义 `channel_kind`，但对外遵循统一的 Channel 契约。

### 2. 客观世界状态 vs. Agent 认知记忆

外部平台上的帖子、评论属于客观的**外部世界状态**；Ema 的**认知记忆**（`agent_state/memory`）属于内部反思、深度情感与提炼后的知识。将外部社交数据直接塞入内部记忆文件，会污染 Agent 的记忆检索；通过本地 Channel 索引隔离存储，既能保证离线重现，又保持认知记忆的纯净。

### 3. 无需爬虫的主动读穿透缓存（Read-Through Caching）

Ema 并不需要主动爬虫抓取全站。但凡是 Ema 浏览过或发布过的页面，本地都会以 `fetchedAt` 记下索引。当下一次 Ema 回顾“刚才那个粉丝说了什么”时，请求发送至相同的 Router 路由，直接从本地索引返回，完全不需要重新请求平台接口。

### 4. 为大模型消除时间认知幻觉

大模型在处理原始 ISO 时间戳时，很难做准确的相对时长心算。通过在查询信封中锁定参考时刻 `context: { time: RFC-3339 }`，并提供兼具语义化与精确秒数的格式（`"7 days ago (604800 seconds ago)"`），Agent 既能直观理解时间距离，又具备机器级的判定精度。

### 5. 层级化动作与动态模式发现

使用形如 `comment.like`、`post.publish` 的层级命名，规范各平台动作命名空间。动作文档接口让 Agent 在决策前能够自省可用动作的参数规范与限流阈值，实现真正的运行时自主决策。

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. Node 与 Channel 的概念呈现

在任意 World 中：
* 实体投射为 **Node**：
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
* 交互场所投射为 **Channel**：
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

### 2. 读取 Channel 条目与时间感知信封

当 Ema 检索 Channel 资源时：
`GET /world/bilibili/channels/bilibili:dynamic:3546869527480631/items?time=2026-11-09T01:30:00Z`

返回数据信封：
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

若再次检索该数据，完全由本地离线索引即时返回，不发生网络请求。

### 3. 自省与执行层级化动作

Ema 在运行时自省受支持的动作模式：
`GET /world/bilibili/actions`

返回：
```json
{
  "actions": [
    {
      "name": "comment.like",
      "description": "点赞视频或动态下的评论",
      "parameters": {
        "postId": { "type": "string", "required": true, "description": "目标动态或稿件 ID" },
        "commentId": { "type": "string", "required": true, "description": "被点赞评论 ID" }
      },
      "rateLimit": "30/minute"
    }
  ]
}
```

Ema 通过统一交互接口或 HTTP 动作端点执行动作：
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

### 1. 核心契约与最低能力要求

具体 TypeScript 接口与类型声明定义在 `packages/ema/src/channel.ts`。本节阐述各原语在架构层面**至少需要具备的能力与属性**：

#### (1) `Node`（社交实体原语）
- **全局唯一寻址**：必须提供带世界前缀的唯一标识（`id`，如 `bilibili:person:<uid>`）以及所属 `world`。
- **实体类别归属（`node_kind`）**：必须区分实体类别（如 `person`、`bot`、`organization`）。
- **实体元数据**：必须包含展示名称、可选的平台 Handle、头像 URL 及平台原始属性。
- **渠道图谱关联**：必须声明该实体拥有或关联的 Channel ID 列表（`channelIds`），支持由人寻道。

#### (2) `Channel`（社交场所原语）
- **渠道寻址与身份**：必须提供全局唯一的渠道 ID（如 `bilibili:dynamic:<uid>`）及所属 `world`。
- **平台特化种类（`channel_kind`）**：各世界根据平台特质自由扩展分类（如 Bilibili 扩展 `space`、`dynamic`、`video`、`live_room`；Telegram 扩展 `broadcast`、`group`；Discord 扩展 `text`、`forum`）。
- **归属与关联拓扑**：可选关联宿主 Node（`ownerNodeId`），并声明互联渠道列表（`linkedChannelIds`），支持多跳拓扑漫游。
- **语义描述**：提供展示名称、简介及平台特化扩展属性。

#### (3) `ChannelItem`（条目与互动单元）
- **寻址与从属**：具备渠道内唯一 ID，指明所属宿主 `channelId` 与发布者 `authorNodeId`。
- **内容载荷**：提供正文文本、可选标题、可选父级条目引用（`parentItemId`，用于支持嵌套评论/回帖）及平台直达 URL。
- **双重时间戳锚定**：必须提供 ISO-8601 创建时间与相对时间信封（`createdAt`），以及本地首次观测记录时间（`fetchedAtMs` / `fetchedAt`），以支持离线重现性校验。

#### (4) `TemporalContext` 与 `TemporalEnvelope`（时间针锚定）
- **基准时刻锚定**：条目查询时必须附带固定的上下文参考时刻（`context: { time, timestampMs }`），作为相对时长计算的稳定基准。
- **双重表达形式**：时间信封输出必须兼具语义化单位与绝对秒数（例如 `<duration> ago (<seconds> seconds ago)` 或 `just now (0 seconds ago)`），彻底消除模型跨轮计算偏差。

#### (5) `ActionDoc`（动作模式自省）
- **层级命名体系**：必须采用点号分隔命名规则（如 `post.publish`、`comment.reply`、`danmaku.send`）。
- **自省式参数模式**：必须提供参数名称、类型、必填标识、中文描述、默认值、限流阈值及示例，支持 Agent 进行零样本自主调用。

### 2. 本地 Read-Through 离线缓存架构

- **客观世界状态隔离**：外部社交节点、渠道与历史观测条目持久化存储于本地关系型状态表（如 SQLite 物理表 `seen_social_*`），物理隔离于内部认知记忆。
- **杜绝认知记忆污染**：社交平台数据表征客观现实，不直接写入或作为 Agent 认知记忆（`agent_state/memory`）持久化。
- **读穿透不变量**：任何条目在被首次感知（轮询进站、Webhook 或 Agent 自主出站动作）时带 `fetched_at_ms` 写入本地；后续读取必须能够 100% 离线脱网重现，不产生平台网络调用。

### 3. Ema Router 统一资源投影

提供社交媒体能力的 World 必须在统一的 `EmaRouter` 上挂载标准化端点：
- `GET /world/:world/nodes/:id`：从本地索引检索社交实体 Node；
- `GET /world/:world/channels`：枚举当前世界的所有渠道；
- `GET /world/:world/channels/:id`：检索渠道详情及关联链接；
- `GET /world/:world/channels/:id/items`：获取按查询时间锚定包裹的时间感知条目列表；
- `GET /world/:world/items/:id`：离线检索单条帖子或互动内容；
- `GET /world/:world/actions`：自省当前世界所有已注册的层级动作规范；
- `POST /world/:world/actions/:actionName`：执行层级动作调度，附带参数校验、内容安全过滤与防刷限流。

---

## Invariants
[invariants]: #invariants

### world-state-not-agent-memory

> **本地社交节点、渠道与交互条目严格属于被感知的外部世界状态，绝不直接写入或作为 Agent 认知记忆文件处理。**

外部社交流表征平台客观现实；将公域网络信息写入认知记忆会污染反思提炼与深层伴侣互动。

### read-through-offline-reproducibility

> **任何被 Agent 感知过的社交内容，必须能通过同一 Router 接口完全离线重现，不触发外部平台网络请求。**

社交平台普遍具备严格反爬与风控体系；频繁向外网回查历史条目会招致限流封禁，读穿透缓存确保了系统的离线稳定性。

### anchored-temporal-perception

> **渠道查询返回的每个时间载荷必须携带锚定的参考时刻，并将条目时间表述为相对时间加精确秒数。**

大模型无法稳定完成跨轮绝对时间计算；双重相对时间信封彻底消除了时序混乱与时间幻觉。

### hierarchical-action-introspectability

> **所有渠道动作必须采用层级化命名，并在运行时向 Agent 暴露机器与模型均可解析的模式文档。**

平坦动作名无法跨世界复用；内省文档赋予了伴侣模型零样本决策与安全执行能力。

---

## Drawbacks
[drawbacks]: #drawbacks

- **扩展样板**：各 World 需要映射并声明各自特定的 `channel_kind`。
  *缓解方式*：契约高度轻量化，只需声明必要的标识与正文信息。

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **为什么不使用复杂的 AST 块结构？**：在现阶段属于过度设计；通过 `metadata` 保存平台特定数据，正文保持纯净，足以满足大部分伴侣交互需求。
- **为什么不采用平坦渠道？**：渠道必须具备互联性（如空间与直播间关联）以及明确的拥有者实体。

---

## Changes

### v1.2.0

- 严格遵循规范哲学，移除具体 TypeScript 代码块、函数体实现及 SQL DDL 语句。
- 契约与能力要求全面对齐 RFC-0001 规范标准，将实现细节指针收敛至 `packages/ema/src/channel.ts`。

### v1.1.0

- 彻底简化为 `Node` 与 `Channel` 两大核心原语。
- 移除 Block AST，确立本地 Read-Through 缓存、时间感知信封与动作自省体系。

### v1.0.0

- 初始董事会审阅草案。
