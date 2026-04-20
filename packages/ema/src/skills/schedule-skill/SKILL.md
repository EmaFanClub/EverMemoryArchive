---
name: schedule-skill
description: 该技能用于查询、创建、修改和删除当前的日程安排。
---

# 日程技能

该技能用于管理当前 actor 的日程表。它适合在以下场景使用：

- 你想安排未来某个时间主动发起对话
- 你想安排未来某个时间进行后台活动
- 你想查看自己已经安排的日程
- 你想修改或删除已有日程

## 支持的模式

### 1. `list_schedules`

查看当前 actor 的日程表。

返回结果会分为三类：

- `overdue`：已经过时、不会自动执行的一次性任务
- `upcoming`：未来尚未执行的一次性任务
- `recurring`：周期任务

### 2. `add_schedules`

批量添加日程。

每个条目支持：

- `type`: `once` 或 `every`
- `task`: `chat` 或 `activity`
- `runAt`: 执行时间，格式为 `YYYY-MM-DD HH:mm:ss`
- `prompt`: 触发时要给模型的提示词
- `conversationId`: 当 `task = chat` 时必填
- `interval`: 当 `type = every` 时必填
- `addition`: 可选附加字段

### 3. `update_schedules`

批量修改已有日程。

说明：

- 只能修改已有任务的时间、提示词、周期、conversationId 或 addition
- 不支持直接把 `once` 改成 `every`，也不支持直接修改任务类型
- 如果需要改类型，先删除再新增

### 4. `delete_schedules`

批量删除已有日程。

参数：

- `ids`: 要删除的 job id 数组
