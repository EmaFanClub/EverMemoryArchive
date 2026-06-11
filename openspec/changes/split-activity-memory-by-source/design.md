## Context

当前 `ShortTermMemory.kind` 包含 `activity | day | month | year`，activity 记录只有 `date`、`dayDate`、`memory`、时间戳和 `processedAt` 等字段。`MemoryManager.getActivityWindow()` 会按 actor 读取最近 activity，`buildActivityMemoryPrompt()` 将它们作为一个 actor 级列表写入 system prompt。阈值 rollup 也通过 actor 级 pending count 触发，`runMemoryRollupTaskOnce()` 传入一个 actor 级 `activitySnapshot`，随后 `UpdateShortTermMemorySkill` 按目标日期把未处理 activity 合并进 day memory。

该实现无法区分不同聊天和后台活动来源。新增来源能力需要覆盖存储、prompt 展示、阈值触发、rollup 快照和 processed 标记，同时不能破坏已有 day/month/year 的一日一条、一月一条、一年一条结构。

## Goals / Non-Goals

**Goals:**

- activity 记录能结构化表达来源，避免把来源写进 `memory` 文本。
- system prompt 中 activity 按来源分组，每个来源有独立窗口。
- activity-to-day rollup 按来源独立触发和消费。
- 会话来源直接使用 `conversationId`，后台来源使用 `sourceType: "background"`，无来源归入“未分类活动”。
- 保留现有 day/month/year 记忆结构，按来源压缩只是改变输入批次。
- 并发 rollup 不重复消费同一来源，也不覆盖同一 actor 的 day memory 更新。

**Non-Goals:**

- 不把 day/month/year 记忆拆成按来源多条记录。
- 不新增前端展示或编辑能力。
- 不新增后台来源的细分 taxonomy；首版所有后台活动共享 `background` 来源。
- 不迁移历史 activity 记录；缺失来源字段的记录在运行时归入“未分类活动”。

## Decisions

### 1. 使用 `conversationId` 表达会话来源

activity 记录新增：

- `conversationId?: number`
- `sourceType?: "background"`

会话 activity 直接写入 `conversationId`，而不是抽象成 `sourceId` 或 `sourceKey`。理由是现有 background job 已经携带 `conversationId`，这个字段语义明确，也便于 prompt 展示时读取会话名称。

程序运行时计算来源 key：

```ts
if (typeof item.conversationId === "number") return `conversation:${item.conversationId}`;
if (item.sourceType === "background") return "background";
return "unclassified";
```

`sourceLabel` 不落库。展示名称由程序生成：会话来源读取会话名称，读不到时显示 `会话 #<id>`；后台显示“后台活动”；无来源显示“未分类活动”。

备选方案是存储通用 `sourceType + sourceId + sourceLabel`。它扩展性更强，但当前只需要区分会话和后台活动，通用字段会增加写入和校验复杂度。

### 2. Prompt 读取从 actor 级窗口改为来源分组窗口

`getActivityWindow()` 当前返回 actor 最近 N 条 activity。该能力应扩展为来源感知读取：

- 针对 prompt：返回多个来源分组，每个来源最多 5 条 activity。
- 针对 rollup：按指定来源读取该来源最多 5 条 activity。

格式化 system prompt 时先按来源分组，再在来源内按日期和时间排列。这样 actor 能在上下文层面知道某条 activity 来自哪个会话或后台活动，而不要求每条 activity 文本重复描述来源。

如果活跃来源过多，prompt 构建可以限制展示最近活跃的来源，但选择规则必须稳定：优先保留最近有 activity 的来源，且每个展示来源最多 5 条。

### 3. Rollup 阈值和快照按来源计算

`activityRollupEvery` 从 actor 级 pending count 改为来源级 pending count。某个来源达到阈值时，只对该来源创建 `activitySnapshot`，并在 tool context 中携带来源信息。`buildActivityToDayTasks()` 仍按 `dayDate ?? date` 生成 day memory 更新任务，但输入记录只来自同一个来源。

压缩成功后只标记 snapshot 中的 source ids 为 processed。其他来源的 pending activity 不应被消费或影响当前 rollup。

备选方案是仍由 actor 级窗口触发，但在 rollup prompt 内按来源分段。这能改善阅读体验，却无法保证“满 5 条后按来源压缩”，也仍会让一个来源挤占另一个来源的 rollup 机会。

### 4. 共享 day memory，串行写入同一 actor 的 rollup

按来源压缩不改变 day memory 唯一性。不同来源在同一天的内容会多次增量合并进同一条 day memory。

并发策略：

- 触发锁按 `actorId + sourceKey`，防止同一来源重复启动 threshold rollup。
- 实际 memory rollup 写入继续按 `actorId` 串行排队，防止两个来源同时更新同一天 day memory 时覆盖彼此结果。
- 快照查询使用 `createdBefore` 和来源 filter，避免 rollup 消费触发时间之后新增的 activity。

备选方案是完全按来源并发写 day memory。它吞吐更高，但当前 day memory 是 actor/date 唯一记录，完全并发会放大最后写入覆盖风险。

## Risks / Trade-offs

- [Risk] 历史 activity 没有来源字段，可能在 prompt 中集中到“未分类活动” -> Mitigation: 缺失来源时运行时归类，不做破坏性迁移；后续自然随新 activity 写入来源字段而减少。
- [Risk] 多来源同时满阈值时更新同一天 day memory 发生覆盖 -> Mitigation: 保留 actor 级 rollup 队列，所有 day/month/year 写入串行执行。
- [Risk] prompt 来源过多导致上下文变长 -> Mitigation: 每来源窗口固定为 5，并允许 prompt 层限制最近活跃来源数量。
- [Risk] `conversationId` 对应会话已删除或无法读取名称 -> Mitigation: prompt label fallback 为 `会话 #<id>`。
- [Risk] activity 同时带 `conversationId` 和 `sourceType: "background"` 导致来源冲突 -> Mitigation: 写入和解析时以 `conversationId` 优先，并在实现中拒绝或规范化冲突数据。

## Migration Plan

不需要数据迁移。新增字段为可选字段，既有 activity 记录缺失来源时自动归入“未分类活动”。实现上线后，新生成的会话 activity 写入 `conversationId`，后台 activity 写入 `sourceType: "background"`。

如需回滚，新增字段可以被旧代码忽略；已写入的来源元数据不会影响旧的 actor 级窗口读取。

## Open Questions

- Prompt 中最多展示多少个活跃来源由实现阶段确定，建议先使用保守默认值并保持配置集中。
