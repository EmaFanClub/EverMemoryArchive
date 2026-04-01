/**
 * Background prompt used for dialogue-tick diary updates.
 */
export const EMA_DIALOGUE_TICK_PROMPT = `
# Task

这是一个由对话数量触发的日记更新任务，用于把近期对话总结到日记中。本次允许更新的短期记忆类型：{ALLOWED_MEMORY_KINDS}

# Workflow

1. 调用 get_skill 读取 update-short-term-memory-skill 技能说明。
2. 基于当前已有的角色、人格、短期记忆、长期记忆，严格按照 update-short-term-memory-skill 技能的工作流程进行更新。
3. 第2步执行完后调用 get_skill 读取 update-long-term-memory-skill 技能说明，判断是否需要更新长期记忆，并使用相应技能进行更新。
4. 第3步执行完后调用 get_skill 读取 update-role-book-skill 技能说明，判断是否需要更新角色书，并使用相应技能进行更新。
5. 第4步执行完后调用 get_skill 读取 update-personality-skill 技能说明，判断是否需要更新人格记忆，并使用相应技能进行更新。

# Constraints

- 必须更新 day 记忆。
- 禁止修改 year / month / week 记忆。
- 不得脱离角色和人格的约束，不得编造不存在于短期记忆、长期记忆、近期对话中的事实。
- 这是一个后台任务，更新完成后不要产生任何额外的回复和输出，也不要调用 ema_reply 或 keep_silence 工具，直接结束即可。
`;

/**
 * Background prompt used for calendar-triggered short-term-memory rollups.
 */
export const EMA_CALENDAR_ROLLUP_PROMPT = `
# Task

这是一个由时间触发的记忆压缩任务，用于在每天/每周/每月/每年结束时把短期记忆进行压缩整理。本次允许更新的短期记忆类型：{ALLOWED_MEMORY_KINDS}

# Workflow

1. 调用 get_skill 读取 update-short-term-memory-skill 技能说明。
2. 基于当前已有的角色、人格、短期记忆、长期记忆，严格按照 update-short-term-memory-skill 技能的工作流程进行更新。
3. 第2步执行完后调用 get_skill 读取 update-long-term-memory-skill 技能说明，判断是否需要更新长期记忆，并使用相应技能进行更新。
4. 第3步执行完后调用 get_skill 读取 update-role-book-skill 技能说明，判断是否需要更新角色书，并使用相应技能进行更新。
5. 第4步执行完后调用 get_skill 读取 update-personality-skill 技能说明，判断是否需要更新人格记忆，并使用相应技能进行更新。

# Constraints

- 必须严格遵守 Task 中给定的允许更新类型，不得自行增删。
- 不得脱离角色和人格的约束，不得编造不存在于短期记忆、长期记忆、近期对话中的事实。
- 这是一个后台任务，更新完成后不要产生任何额外的回复和输出，也不要调用 ema_reply 或 keep_silence 工具，直接结束即可。
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
