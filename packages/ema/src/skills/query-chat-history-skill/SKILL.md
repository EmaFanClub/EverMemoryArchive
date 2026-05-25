---
name: query-chat-history-skill
description: 该技能用于查询指定会话中的真实聊天记录，或者查看某条消息中的媒体内容。需要查看某个会话的近期窗口、精确回溯消息内容、查看消息中的图片或文件时使用。
---

# query-chat-history-skill

该技能用于查询指定会话中的**真实聊天记录**。

会话列表已经在 system prompt 的“对话”章节中展示。查询时必须传入目标会话的 `session`，不要自己编写或猜测。返回文本会尽量保持和 system prompt 中当前会话窗口一致的格式。

## 支持的模式

### 1. `window`

查询指定会话的近期消息窗口，适合在当前会话之外了解另一个会话最近发生了什么。

参数：

- `mode`: `"window"`
- `session`: 目标会话 session

返回：

- 该会话近期窗口
- 无近期消息时返回 `None.`

### 2. `by_ids`

按内部 `msg_id` 精确查询指定会话的历史消息。

参数：

- `mode`: `"by_ids"`
- `session`: 目标会话 session
- `msg_ids`: 消息 ID 数组

返回：

- 以与当前会话窗口一致的文本风格返回命中消息
- 按传入 `msg_ids` 的顺序返回

### 3. `by_time_range`

按时间范围查询指定会话的历史消息。

参数：

- `mode`: `"by_time_range"`
- `session`: 目标会话 session
- `start_time`: 起始时间，格式为 `YYYY-MM-DD HH:mm:ss`
- `end_time`: 结束时间，格式为 `YYYY-MM-DD HH:mm:ss`
- `limit`: 返回数量上限，默认 50，最大 50

返回：

- 以与当前会话窗口一致的文本风格返回消息
- 若超出上限，会附带截断提示

### 4. `expand_one`

展开指定会话中单条消息的媒体内容。

参数：

- `mode`: `"expand_one"`
- `session`: 目标会话 session
- `msg_id`: 需要展开的消息 ID

返回：

- 返回该条消息中的媒体内容
- 适合在看到图片、文件或表情包占位符，但现在必须知道具体内容时使用
