/**
 * Background prompt used for dialogue-tick diary updates.
 */
export const EMA_DIALOGUE_TICK_PROMPT = [
  "<task>",
  "根据近期对话(Recent Conversation)中的内容和日记(Day)的内容更新日记。",
  "updateMemoryKinds=[{MEMORY_KINDS}]",
  "</task>",
  "",
  "<instructions>",
  "1) 调用 get_skill 读取技能说明，并严格按其要求执行。",
  "2) 基于当前已有的短期记忆和对话历史，生成更新后的日记内容。",
  "3) 在更新完日记后，可调用 get_skill 查看技能 update-personality-skill，决定是否更新人格记忆（全量新版本）。",
  "4) 在更新完人格记忆后，可调用 get_skill 查看技能 update-long-term-memory-skill，决定是否需要写入长期记忆。",
  "5) 这是一个后台任务，更新完后不要产生任何额外的回复和输出。",
  "</instructions>",
  "",
  "<constraints>",
  "- 必须更新 Day；可选更新人格记忆与长期记忆。",
  "- 禁止修改 Year / Month / Week。",
  "- 写短期记忆时，只要涉及当前角色自己的经历、判断、感受，必须使用第一人称“我”，不要把当前角色写成第三人称名字。",
  "- 若更新人格记忆或长期记忆，必须写入全量新版本，而不是增量追加。",
  "- 若更新人格记忆，人格记忆只能描述“我如何理解自己、如何与用户互动”，必须使用第一人称“我”，不得混入其他人物画像、关系事实或事件摘要。",
  "- 长期记忆只记录碎片化事实/知识，不得写入自我认知内容。",
  "- 不得编造不存在于短期记忆或近期对话中的事实。",
  "</constraints>",
].join("\n");

/**
 * Background prompt used for daily short-term-memory rollups.
 */
export const EMA_DAILY_ROLLUP_PROMPT = [
  "<task>",
  "这是一个由定时任务触发的记忆汇总任务。本次必须更新的记忆类型如下：",
  "updateMemoryKinds=[{MEMORY_KINDS}]",
  "</task>",
  "",
  "<instructions>",
  "1) 调用 get_skill 读取技能说明，并严格按其要求执行。",
  "2) 基于当前已有的短期记忆（Day/Week/Month/Year）和对话历史（Recent Conversation，如有），按 updateMemoryKinds 中的顺序更新短期记忆。",
  "3) 短期记忆更新完成后，可调用 get_skill 查看技能 update-personality-skill，决定是否更新人格记忆（全量新版本）。",
  "4) 在更新完人格记忆后，可调用 get_skill 查看技能 update-long-term-memory-skill，决定是否写入长期记忆（不包含自我认知）。",
  "5) 每次生成记忆都必须是“全量新版本”（覆盖旧记忆），不要只写新增/追加部分。",
  "6) 这是一个后台任务。更新完成后不要产生任何额外的回复和输出。",
  "</instructions>",
  "",
  "<constraints>",
  "- 必须严格遵守 <task> 块中给定的 updateMemoryKinds；不得自行增删。",
  "- 可选更新人格记忆与长期记忆；不得更新不在 updateMemoryKinds 中的短期记忆。",
  "- 写短期记忆时，只要涉及当前角色自己的经历、判断、感受，必须使用第一人称“我”，不要把当前角色写成第三人称名字。",
  "- 若更新人格记忆或长期记忆，必须写入全量新版本，而不是增量追加。",
  "- 若更新人格记忆，人格记忆只能描述“我如何理解自己、如何与用户互动”，必须使用第一人称“我”，不得混入其他人物画像、关系事实或事件摘要。",
  "- 长期记忆只记录碎片化事实/知识，不得写入自我认知内容。",
  "- 不得编造不存在于短期记忆或对话历史中的事实；如缺少信息应保持模糊而非杜撰。",
  "- 若对话历史为空或信息不足，允许更多依赖已有短期记忆进行归纳，但不得虚构细节。",
  "</constraints>",
].join("\n");

/**
 * Foreground reminder prompt used by the periodic actor foreground job.
 */
export const EMA_FOREGROUND_REMINDER_PROMPT =
  "系统提示：考虑是否要主动向用户对话。如果最近一条用户消息距现在不足 60 秒，请无视此提示。否则参考下面的规则：" +
  "1. 请根考虑当前对话历史分析对话语境、消息间隔等，尤其需要考虑上一条消息的时间，综合判断是否要主动和用户说话。需要时可以读取长期记忆。" +
  "2. 如果你决定不和用户说话，调用 `ema_reply` 工具输出空字符串即可（可以有心理活动）。" +
  "3. 如果你决定要主动和用户说话，考虑好内容后，调用 `ema_reply` 工具进行对话。" +
  "4. 这条提示是定时产生的，与用户无关，不要在对话和记忆中提及它。";
