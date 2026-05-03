---
name: schedule-skill
description: 该技能用于查询、创建、修改和删除当前的日程安排，可以调整作息、安排未来的主动对话和自主活动等。
---

# 日程技能

该技能用于管理当前 actor 的日程表。它适合在以下场景使用：

- 你想安排未来某个时间主动发起对话
- 你想安排未来某个时间进行后台活动
- 你想安排或调整自己的 wake / sleep 作息日程
- 你想查看自己已经安排的日程
- 你想修改或删除已有日程

## 如何区分 `chat` 和 `activity`

这是最重要的规则：

- 如果你的目标是**未来去某个会话里主动说话、发消息、打招呼、分享内容、问问题、冒泡**，就用 `chat`
- 如果你的目标是**自己在后台做一件事**，例如发呆、思考、整理、学习、回忆、冥想、上网查资料、记录感受，而**不是直接去某个会话说话**，就用 `activity`

换句话说：

- **面向某个 conversation 的主动发言** → `chat`
- **不直接发消息的后台行为** → `activity`

特别注意：

- “稍后和主人聊聊”
- “晚上和主人说晚安”
- “给主人分享今天看到的内容”
- “发个表情包冒泡”

这些都应该是 `chat`，不是 `activity`

如果你想先做一件后台活动，再去和别人说，可以拆成两个日程：

1. 先安排一个 `activity`
2. 再安排一个 `chat`

## 支持的模式

### 1. `list_schedules`

查看当前 actor 的日程表。

返回结果会分为三类：

- `overdue`：已经过时、不会自动执行的一次性任务
- `upcoming`：未来尚未执行的一次性任务
- `recurring`：周期任务

说明：

- `chat` / `activity` 会展示模型自己安排的任务内容 `prompt`
- `wake` / `sleep` 是固定例程，不展示 `prompt`

### 2. `add_schedules`

批量添加日程。

#### `chat`

- `type`: `once` 或 `every`
- `task`: `chat`
- `runAt`: 执行时间，格式为 `YYYY-MM-DD HH:mm:ss`
- `prompt`: 你安排给未来自己的任务内容；目标应该是未来在某个会话里主动说话
- `session`: 必填，来自 `list_conversations` 返回的会话 `session` 或聊天信息里的 `session`，不要手写 QQ 群号或用户 uid
- `interval`: 当 `type = every` 时必填

#### `activity`

- `type`: `once` 或 `every`
- `task`: `activity`
- `runAt`: 执行时间，格式为 `YYYY-MM-DD HH:mm:ss`
- `prompt`: 你安排给未来自己的任务内容；目标应该是后台活动本身，而不是去某个会话发消息
- `interval`: 当 `type = every` 时必填

#### `wake` / `sleep`

- `task`: `wake` 或 `sleep`
- `interval`: 必须是 5 段 cron 表达式，例如 `30 7 * * *`

说明：

- `wake` / `sleep` 是固定作息任务，不需要也不支持填写 `prompt` 或 `runAt`
- 对 recurring `wake` / `sleep` 日程，系统会优先复用已有项，避免重复创建
- 不要填写 `07:30`、`23:00` 这样的时间字符串，必须填写 5 段 cron

#### recurring `chat` / `activity` 的周期规则

当 `type = every` 时，只允许以下两种写法：

1. `interval` 为 5 段 cron 表达式
   例如：`0 9 * * *`
   - 这种写法不需要也不支持填写 `runAt`

2. `runAt + interval(number)`
   其中：
   - `runAt` 必须是 `YYYY-MM-DD HH:mm:ss`
   - `interval` 必须是正整数毫秒数

不允许：

- `"1 hour"`
- `"30m"`
- `wake/sleep` 使用数字间隔
- `chat/activity` 在数字间隔模式下缺少 `runAt`

### 3. `update_schedules`

批量修改已有日程。

说明：

- `chat` / `activity` 可以修改时间、任务内容、周期；`chat` 可通过 `session` 修改目标会话
- 修改 `chat` 目标会话时填写新的 `session`，不要手写 QQ 群号或用户 uid
- `wake` / `sleep` 只支持修改 `interval`
- `wake` / `sleep` 的 `interval` 必须始终是 5 段 cron
- `chat` / `activity` 的周期仍然只允许两种写法：5 段 cron，或 `runAt + interval(正整数毫秒)`
- 不支持直接把 `once` 改成 `every`，也不支持直接修改任务类型
- 如果需要改类型，先删除再新增

### 4. `delete_schedules`

批量删除已有日程。

参数：

- `ids`: 要删除的 job id 数组
