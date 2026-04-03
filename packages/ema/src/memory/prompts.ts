/**
 * Background prompt used for activity-tick updates.
 */
export const EMA_ACTIVITY_TICK_PROMPT = `
# Task

这是一个由对话数量触发的 activity 更新任务，严格按照以下流程执行。

# Workflow

1. 调用 get_skill 读取 update-short-term-memory-skill 技能说明，并严格按照该技能说明执行。
2. 第1步执行完后调用 get_skill 读取 update-long-term-memory-skill 技能说明，判断是否需要更新长期记忆，并严格按照该技能说明执行。（更新前注意检索）
3. 第2步执行完后调用 get_skill 读取 update-role-book-skill 技能说明，判断是否需要更新角色书，并严格按照该技能说明执行。
4. 第3步执行完后调用 get_skill 读取 update-personality-skill 技能说明，判断是否需要更新人格记忆，并严格按照该技能说明执行。

# Constraints

- update-short-term-memory-skill 只允许新增 activity 记录，不得修改 day、month、year。
- 更新记忆时必须基于当前对话上下文与记忆，不得编造事实。
- 这是后台任务，完成后直接结束，不要调用 ema_reply 或 keep_silence。
`;

/**
 * Background prompt used for daily memory-update rollups.
 */
export const EMA_MEMORY_UPDATE_PROMPT = `
# Task

这是一个由时间触发的记忆整理任务，严格按照以下流程执行。

# Workflow

1. 调用 get_skill 读取 update-short-term-memory-skill 技能说明，并严格按照该技能说明执行。
2. 第1步执行完后调用 get_skill 读取 update-long-term-memory-skill 技能说明，判断是否需要更新长期记忆，并严格按照该技能说明执行。（更新前注意检索）
3. 第2步执行完后调用 get_skill 读取 update-role-book-skill 技能说明，判断是否需要更新角色书，并严格按照该技能说明执行。
4. 第3步执行完后调用 get_skill 读取 update-personality-skill 技能说明，判断是否需要更新人格记忆，并严格按照该技能说明执行。

# Constraints

- update-short-term-memory-skill 只能按技能返回的任务更新指定的目标记忆，不得修改其他 kind 或其他日期。
- 更新记忆时必须基于当前对话上下文与记忆，不得编造事实。
- 这是后台任务，完成后直接结束，不要调用 ema_reply 或 keep_silence。
`;

/**
 * Foreground heartbeat prompt used when the actor considers proactive messages.
 */
export const EMA_FOREGROUND_HEARTBEAT_PROMPT = `
# Task

这是一个由时间触发的心跳任务，请你根据下面的流程考虑是否要主动发起对话

# Workflow

1. 首先明确当前对话发生的地点，注意是群聊还是私聊。
2. 回顾近期对话历史和短期记忆，分析当前的对话语境、消息间隔等，必要时可通过 search-long-term-memory-skill 查询长期记忆。
3. 综合上述分析结果和系统提示词中的交互准则，判断是否要主动说话。
4. 如果要主动说话，需要选择合适的话题和说话方式，可以是随意寒暄、分享信息、提出问题、表达关心等，尤其要充分考虑语境和时间间隔，避免割裂和突兀。

# Constraints

- 你可以理解为是你主观发起的对话，而不是被动地由系统驱动。
- 这条提示是定时产生的，与用户无关，不要在对话和记忆中提及“心跳任务”等词汇。
- 不得脱离角色和人格的约束，不得编造不存在于短期记忆、长期记忆、近期对话中的事实。
`;
