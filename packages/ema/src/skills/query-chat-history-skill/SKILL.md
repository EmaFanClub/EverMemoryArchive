---
name: query-chat-history-skill
description: 查询当前会话的聊天记录，支持按消息ID列表或按时间范围检索。
---

# query-chat-history-skill

用于查询当前会话中的历史消息，支持两种模式：

- `by_ids`：按 `msg_ids` 精确查询。
- `by_time_range`：按 `start_time` ～ `end_time` 查询，并返回 `has_more` 状态。

## 参数说明

### 模式一：按消息ID查询

- `mode`: `"by_ids"`
- `msg_ids`: 消息ID数组（至少一个）

行为：

- 不限制数量；
- 返回请求 `msg_ids` 的全部命中消息；
- 按传入 `msg_ids` 顺序返回。

### 模式二：按时间范围查询

- `mode`: `"by_time_range"`
- `start_time`: 起始时间，格式 `YYYY-MM-DD HH:mm:ss`
- `end_time`: 结束时间，格式 `YYYY-MM-DD HH:mm:ss`
- `limit`: 可选，默认 `50`，最小 `1`，最大 `50`

行为：

- 返回时间范围内的消息；
- 同时返回 `has_more`，用于继续翻页；
- 继续翻页时，可使用上次结果的 `last_message_time` 作为新的起点继续查询。
