---
name: query-chat-history-skill
description: 该技能用于查询当前会话中的真实聊天记录，或者查看某条消息中的媒体内容。需要精确回溯某条消息内容、查看消息中的图片或文件的具体内容时使用。
---

# query-chat-history-skill

该技能用于查询当前会话中的**真实聊天记录**。  
它服务于 `Memory` 中“近期对话”之外的精确回溯需求，适合在仅靠印象不足以准确理解时使用。

推荐使用的场景：

- 人类问你“我刚才说了什么”
- 人类引用了一条旧消息来追问
- 你必须确认某条消息原文
- 某条消息里有未展开的图片或文件，仅仅只有占位符，而你确实需要知道具体内容

不必使用的场景：

- 当前上下文已经足够自然接话
- 只是为了保险而重复查询
- 明明可以先自然接住，却非要查到很细才开口

## 支持的模式

### 1. `by_ids`

按内部 `msg_id` 精确查询历史消息。

参数：

- `mode`: `"by_ids"`
- `msg_ids`: 消息 ID 数组

返回：

- 以与 `Recent Conversation` / buffer message 一致的文本风格返回命中消息
- 按传入 `msg_ids` 的顺序返回

### 2. `by_time_range`

按时间范围查询历史消息。

参数：

- `mode`: `"by_time_range"`
- `start_time`
- `end_time`
- `limit`

返回：

- 以与 `Recent Conversation` / buffer message 一致的文本风格返回消息
- 若超出上限，会附带截断提示

### 3. `expand_one`

展开单条消息中的媒体内容。

参数：

- `mode`: `"expand_one"`
- `msg_id`

返回：

- 返回该条消息中的媒体 `parts`
- 适合在看到的是占位符、但现在必须知道具体内容时使用
