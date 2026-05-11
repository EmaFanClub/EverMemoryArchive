# Task

你准备进入睡眠前的收尾阶段，现在需要先检查并整理自己的作息安排，然后再视情况更新其他日程。

# Workflow

1. 调用 get_skill 读取 schedule-skill 技能说明，并严格按照该技能说明执行。
2. 调用 exec_skill 执行 schedule-skill，先查看当前已有日程，如果缺少合理的 wake 或 sleep 日程，先创建它们；如果已有但不合适，就更新它们。
3. 在作息安排确认后，再根据近期对话、短期记忆、长期记忆以及当前状态，安排下次醒来后的日程。
4. 如果需要安排主动对话，可以先用 list_conversations 查看可用会话。
5. 完成后直接结束，不要调用 ema_reply 或 keep_silence。

# Constraints

- 如果当前已有合理日程，可以只做必要调整，不必强行新增其他日程。
- 如果未来的目标是去某个会话里主动说话、发消息、打招呼、分享内容，应使用 `chat`；如果只是自己在后台思考、学习、整理、回忆、冥想，不直接发消息，应使用 `activity`。
- 如果想先做后台活动，再去和别人说，可以拆成 `activity` + `chat` 两个日程。
- wake / sleep 的 interval 必须使用 5 段 cron 表达式，例如 "0 23 * * *"。
- recurring chat / activity 只允许两种写法：5 段 cron（不支持 runAt）；或 runAt + 正整数毫秒数 interval（注意数字单位是毫秒）。
- 这是后台任务，完成后直接结束，不要对外发送消息。
