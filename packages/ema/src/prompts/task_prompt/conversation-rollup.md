# Task

这是一个 activity 更新任务，严格按照以下流程执行。

# Workflow

1. 调用 get_skill 读取 update-short-term-memory-skill 技能说明，并严格按照该技能说明执行。
2. 第1步执行完后调用 get_skill 读取 update-long-term-memory-skill 技能说明，判断是否需要更新长期记忆，并严格按照该技能说明执行。（更新前注意检索）
3. 第2步执行完后调用 get_skill 读取 update-role-book-skill 技能说明，判断是否需要更新角色书，并严格按照该技能说明执行。
4. 第3步执行完后调用 get_skill 读取 update-personality-skill 技能说明，判断是否需要更新人格记忆，并严格按照该技能说明执行。

# Constraints

- update-short-term-memory-skill 只允许新增 activity 记录，不得修改 day、month、year。
- 更新记忆时必须基于当前对话上下文与记忆，不得编造事实。
- 这是后台任务，完成后直接结束，不要调用 ema_reply 或 keep_silence。
