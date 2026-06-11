## Why

角色详情侧栏已经预留“日程”和“记忆”页签，但目前日程除作息外仍显示 Coming soon，记忆页签也未展示任何内容。用户需要在 WebUI 中直接查看当前角色的日程与分层记忆，并对可维护的文本内容进行修订。

## What Changes

- 在日程界面展示当前选中角色的日程列表，覆盖过时日程、未来日程、周期日程和关注会话。
- 允许用户编辑日程的文本内容字段，但不允许通过该界面修改日程时间、周期、任务类型、目标会话或删除日程。
- 在记忆界面展示当前角色的年记、月记、日记和活动记忆。
- 允许用户编辑年记、月记、日记和活动记忆条目的正文内容。
- 为 WebUI 增加 actor-scoped 的日程和短期记忆读取/编辑数据流。

## Capabilities

### New Capabilities

- `schedule-and-memory-views`: 角色侧栏中的日程与分层记忆查看、受限编辑能力。

### Modified Capabilities

None.

## Impact

- WebUI 右侧角色信息面板：`packages/ema-webui/src/features/actor-sidebar/ActorSidePanel.tsx` 及相关样式。
- WebUI transport/types/API route：`packages/ema-webui/src/transport/dashboard.ts`、`packages/ema-webui/src/types/dashboard/v1beta1.ts`、`packages/ema-webui/src/app/api/v1beta1/actors/[actorId]/**`。
- WebUI server service/adapters：`packages/ema-webui/src/server/services/dashboard.ts` 或拆分后的 actor schedule/memory service。
- Core runtime/controller：复用 `ActorScheduler` 与短期记忆 DB 能力，必要时增加受限的 controller/service 方法。
- Tests：需要覆盖 DTO/service 行为、API handler 边界和关键 UI 状态。
