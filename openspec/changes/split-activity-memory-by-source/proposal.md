## Why

当前短期 activity 记忆在 system prompt 和 activity-to-day rollup 中都是 actor 级单窗口。不同聊天和后台活动会混在同一批上下文里，actor 需要从每条 activity 文本中自行推断来源，导致记忆内容容易重复描述地点或上下文，也会让一个来源的高频活动挤掉其他来源。

## What Changes

- 为 activity 短期记忆增加可选来源元数据：`conversationId` 表示会话来源，`sourceType: "background"` 表示后台活动来源。
- 没有来源元数据的 activity 归入“未分类活动”，用于兼容历史记录和未标注来源的写入。
- system prompt 中的 activity 上下文按来源分组展示，每个来源显示独立的 activity 窗口。
- activity-to-day rollup 按来源独立计数、触发和消费；某个来源窗口满阈值时，只压缩该来源的 activity。
- day/month/year 记忆结构保持不变，按来源压缩后的内容仍增量合并进 actor 的日记。

## Capabilities

### New Capabilities

- `activity-source-windows`: activity 短期记忆的来源建模、prompt 分组窗口，以及按来源压缩到日记的行为。

### Modified Capabilities

None.

## Impact

- Core memory model and manager: `packages/ema/src/memory/base.ts`、`packages/ema/src/memory/manager.ts`。
- DB short-term memory entity/query/index: `packages/ema/src/db/base.ts`、`packages/ema/src/db/drivers/mongo.short_term_memory.ts`。
- Background jobs and rollup scheduling: `packages/ema/src/scheduler/jobs/actor.job.ts`。
- Short-term memory tool behavior: `packages/ema/src/skills/update-short-term-memory-skill/index.ts`。
- Tests: memory manager formatting/query tests, Mongo short-term memory tests, scheduler rollup tests, update-short-term-memory skill tests.
