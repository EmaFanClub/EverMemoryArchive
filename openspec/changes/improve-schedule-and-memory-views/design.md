## Context

当前 Dashboard 右侧 `ActorSidePanel` 已有“日程”和“记忆”页签。日程页签只展示 `ActorSummary.sleepSchedule` 的作息预览，其他日程区域仍是 Coming soon；记忆页签整体也是 Coming soon。WebUI 的 `ActorSummary` 不包含完整日程或记忆数据，`packages/ema-webui/src/app/api/v1beta1/actors/[actorId]` 下也没有 schedule/memory 专用 route。

核心侧已有可复用能力：

- `ActorScheduler.list()` 能按 `overdue`、`upcoming`、`recurring`、`focused` 返回当前 actor 的日程。
- `ActorScheduler.update()` 能更新日程，但默认也支持时间、周期、目标会话等字段，所以 WebUI 层必须限制 PATCH payload。
- 短期记忆模型已有 `activity`、`day`、`month`、`year` 四类，`MemoryManager.listShortTermMemories()` 能读取，底层 `ShortTermMemoryDB.upsertShortTermMemory()` 能按 id 更新记录。

## Goals / Non-Goals

**Goals:**

- 在角色侧栏中把“日程”和“记忆”从占位状态变成可用的数据面板。
- 提供 actor-scoped 的 WebUI API 和 transport 类型，用于读取日程/记忆并保存文本内容。
- 对日程编辑做权限收窄：只允许更新摘要/正文这类文本内容，不允许改时间、周期、任务类型、目标会话或删除。
- 对记忆编辑保持记录身份不变：只更新 `memory` 正文，保留 actor、kind、date、dayDate、processedAt 等元数据。
- 覆盖加载、空状态、保存失败、角色切换等 UI 状态。

**Non-Goals:**

- 不新增日程创建、删除、改时间、改周期、改目标会话能力。
- 不新增长期记忆检索或长期记忆编辑 UI。
- 不改变记忆 rollup 规则、活动生成规则或日程执行逻辑。
- 不重新设计 Dashboard 整体布局。

## Decisions

### 1. 新增独立的 WebUI API，而不是把完整数据塞进 Dashboard overview

推荐新增按需加载接口：

- `GET /api/v1beta1/actors/[actorId]/schedules`
- `PATCH /api/v1beta1/actors/[actorId]/schedules/[scheduleId]`
- `GET /api/v1beta1/actors/[actorId]/memories`
- `PATCH /api/v1beta1/actors/[actorId]/memories/[memoryId]`

理由：日程和记忆面板不是 Dashboard 首屏必需数据，记忆列表可能较长。按页签加载能避免扩大 overview payload，也符合现有 token usage、stickers 等 actor-scoped route 风格。

备选方案是把 schedule/memory 加到 `ActorSummary`。这会减少一次请求，但会让演员列表接口携带大量详情数据，不适合记忆列表。

### 2. 日程 PATCH 只接受文本字段

WebUI 日程更新接口只接受 `summary` 和 `prompt`。服务层读取当前日程后，用现有 `ActorScheduler.update()` 传入受限 payload，显式不接受 `runAt`、`interval`、`conversationId`、`task` 或删除请求。

`chat` 和 `activity` 日程通常有可编辑文本；`wake`、`sleep` 和 `focus` 缺少用户可维护文本内容时应在 UI 中只读展示。这样既满足“可编辑内容”，也避免误开时间和执行语义。

### 3. 记忆面板使用短期记忆作为数据源

用户说的“年记、月记、日记、活动”对应短期记忆 `kind: "year" | "month" | "day" | "activity"`。本需求不涉及长期记忆 `long_term_memories`。记忆 PATCH 通过 id 定位 actor-owned 短期记忆，更新正文并保留原有元数据。

### 4. UI 拆成专用面板组件

建议从 `ActorSidePanel.tsx` 中拆出：

- `ActorSchedulePanel`
- `ActorMemoryPanel`
- 对应的纯辅助函数和 focused tests

`ActorSidePanel` 继续只负责 tab shell 和 settings/stats 渲染。这样可以避免继续放大现有侧栏组件。

## Risks / Trade-offs

- [Risk] 日程底层 update 能修改时间和周期，WebUI API 若透传 payload 会绕过需求限制 -> Mitigation: route/service 层白名单校验字段，并加测试确认时间字段不被接受。
- [Risk] 活动记忆可能有多条同日记录，按 kind/date upsert 会误更新同日其他活动 -> Mitigation: 编辑接口必须按 id 定位记录，不使用 `MemoryManager.upsertShortTermMemory()` 的 kind/date 语义来更新活动记录。
- [Risk] 记忆列表过长影响面板性能 -> Mitigation: 首版按每类合理 limit 返回，UI 展示空/加载状态；后续如需要再补分页或范围筛选。
- [Risk] 保存失败时丢失用户编辑内容 -> Mitigation: 组件本地保留草稿，保存成功后再刷新服务端快照。
- [Risk] 角色切换过程中旧请求返回覆盖新角色数据 -> Mitigation: 使用 abort signal 或 actorId guard，忽略非当前 actor 的响应。

## Migration Plan

不需要数据迁移。该变更只读取和更新已有 actor 日程、短期记忆记录。上线后，已有日程和短期记忆会通过新 UI 可见。

## Open Questions

- 首版记忆每类返回数量是否需要固定上限。建议实现时使用保守默认值，并在 UI 文案中避免暗示“全部历史”。
- 日程“内容”是否同时包含 `summary` 和 `prompt`。建议首版二者都支持：摘要用于列表快速识别，正文用于完整执行说明。
