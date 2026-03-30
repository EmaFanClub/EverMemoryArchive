/**
 * Background prompt used for dialogue-tick diary updates.
 */
export const EMA_DIALOGUE_TICK_PROMPT = `
# Task

这是一个由对话数量触发的日记更新任务，用于把近期对话总结到日记中。本次允许更新的短期记忆类型：{ALLOWED_MEMORY_KINDS}

# Workflow

1. 调用 get_skill 读取 update-short-term-memory-skill 技能说明。
2. 基于当前已有的角色、人格、短期记忆、长期记忆、近期对话，严格按照 update-short-term-memory-skill 技能的工作流程进行更新。
3. 调用 get_skill 读取 update-long-term-memory-skill 技能说明，判断是否需要更新长期记忆，并使用相应技能进行更新。
4. 调用 get_skill 读取 update-role-book-skill 技能说明，判断是否需要更新角色书，并使用相应技能进行更新。
5. 调用 get_skill 读取 update-personality-skill 技能说明，判断是否需要更新人格记忆，并使用相应技能进行更新。

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
3. 调用 get_skill 读取 update-long-term-memory-skill 技能说明，判断是否需要更新长期记忆，并使用相应技能进行更新。
4. 调用 get_skill 读取 update-role-book-skill 技能说明，判断是否需要更新角色书，并使用相应技能进行更新。
5. 调用 get_skill 读取 update-personality-skill 技能说明，判断是否需要更新人格记忆，并使用相应技能进行更新。

# Constraints

- 必须严格遵守 Task 中给定的允许更新类型，不得自行增删。
- 不得脱离角色和人格的约束，不得编造不存在于短期记忆、长期记忆、近期对话中的事实。
- 这是一个后台任务，更新完成后不要产生任何额外的回复和输出，也不要调用 ema_reply 或 keep_silence 工具，直接结束即可。
`;

/**
 * Foreground reminder prompt used by the periodic actor foreground job.
 */
export const EMA_FOREGROUND_REMINDER_PROMPT =
  "系统提示：考虑是否要主动向用户对话。如果最近一条用户消息距现在不足 60 秒，请无视此提示。否则参考下面的规则：" +
  "1. 请根考虑当前对话历史分析对话语境、消息间隔等，尤其需要考虑上一条消息的时间，综合判断是否要主动和用户说话。需要时可以读取长期记忆。" +
  "2. 如果你决定不和用户说话，调用 `ema_reply` 工具输出空字符串即可（可以有心理活动）。" +
  "3. 如果你决定要主动和用户说话，考虑好内容后，调用 `ema_reply` 工具进行对话。" +
  "4. 这条提示是定时产生的，与用户无关，不要在对话和记忆中提及它。";
