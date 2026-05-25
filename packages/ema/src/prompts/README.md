# Runtime Prompts

本目录存放会直接进入 agent loop 的运行时提示词。提示词分为两类：`system_prompt` 和 `task_prompt`。

`system_prompt` 用于构造模型的 system prompt，定义角色长期稳定的行为边界、世界观、交互准则、角色身份、记忆上下文和日程上下文。`task_prompt` 用于构造任务消息，描述一次模型执行的目标、流程和约束。它通常作为一条系统来源的输入消息进入上下文，而不是 system prompt。

## Scope

本目录只包含运行时直接注入模型上下文的提示词。

不包含：

- `packages/ema/src/skills/*/SKILL.md`
- 技能实现内部的局部 prompt 片段

这些内容只服务于技能说明或技能内部执行流程，不属于 agent loop 的基础提示词。

## Layout

```text
prompts/
├── README.md
├── system_prompt/
│   ├── foreground.md
│   │   前台聊天使用的 system prompt 模板
│   ├── background.md
│   │   后台执行使用的 system prompt 模板
│   └── partials/
│       ├── preamble.md
│       │   基础身份和存在形式
│       ├── system.md
│       │   系统原则、工具和技能使用规则
│       ├── world.md
│       │   世界设定和输入格式说明
│       ├── interaction-guidelines-chat.md
│       │   私聊交互流程和表达方式
│       ├── interaction-guidelines-group.md
│       │   群聊交互流程和表达方式
│       ├── you.md
│       │   角色书和人格记忆
│       ├── memory.md
│       │   长短期记忆上下文
│       ├── conversation.md
│       │   会话列表、当前会话和近期对话窗口
│       └── schedule.md
│           日程上下文和日程使用规则
└── task_prompt/
    ├── scheduled-chat.md
    │   定时主动聊天任务
    ├── scheduled-activity.md
    │   定时自主活动任务
    ├── conversation-rollup.md
    │   从近期对话整理活动记忆
    ├── memory-rollup.md
    │   将活动、日记、月记汇总为更高层级记忆
    ├── wake.md
    │   醒来时检查和安排日程
    └── sleep.md
        睡前整理和安排日程
```

## System Prompt Composition

`system_prompt/foreground.md` 展开后的主要章节顺序：

```md
# 前言（Preamble）

---

# 系统（System）

---

# 世界（World）

---

# 交互准则（Interaction Guidelines）

---

# 你是谁（You）

---

# 记忆（Memory）

---

# 对话（Conversation）

---

# 日程（Schedule）
```

`system_prompt/background.md` 展开后的主要章节顺序：

```md
# 前言（Preamble）

---

# 系统（System）

---

# 世界（World）

---

# 你是谁（You）

---

# 记忆（Memory）

---

# 对话（Conversation）

---

# 日程（Schedule）
```

## Usage

| 模板 | 进入方式 | 使用场景 |
| --- | --- | --- |
| `system_prompt/foreground.md` | system prompt | 前台聊天回复 |
| `system_prompt/background.md` | system prompt | 后台任务、训练回放、对话整理等执行；是否注入当前会话窗口由运行时变量决定 |
| `task_prompt/*.md` | task message | 一次具体任务执行的目标、流程和约束 |

## Loading

prompt 根目录固定为 `packages/ema/src/prompts`。运行时从该目录读取 Markdown 文件，不读取环境变量指定的外部目录。

prompt 文件不会缓存。文件内容变化后，下一次加载会读取最新内容。

## Include

include 指令用于把其他 Markdown 文件插入当前位置：

```md
<!-- @include system_prompt/partials/preamble.md -->
```

include 路径相对 `prompts/` 根目录。include 指令必须独占一行，不会出现在最终 prompt 中。模板文件负责章节顺序、分隔线和章节间空行。

include 路径可以使用变量，例如 `system_prompt/partials/interaction-guidelines-{SESSION_TYPE}.md`。

## Variables

变量使用 `{NAME}` 形式：

```md
{ROLE_PROMPT}
{CONVERSATION_WINDOW}
{SCHEDULED_PROMPT}
```

变量在 prompt 加载后由运行时替换。只有运行时提供的变量会被替换；未提供的 `{NAME}` 会保留原文。

| 变量 | 含义 | 使用位置 |
| --- | --- | --- |
| `{SKILLS_METADATA}` | 当前可用工具和技能的摘要 | `system_prompt/partials/system.md` |
| `{ROLE_PROMPT}` | 角色书内容 | `system_prompt/partials/you.md` |
| `{PERSONALITY_MEMORY}` | 人格记忆 | `system_prompt/partials/you.md` |
| `{CONVERSATIONS}` | 当前 actor 的会话列表；无会话时为 `None.` | `system_prompt/partials/conversation.md` |
| `{CURRENT_CONVERSATION}` | 当前会话标题；无绑定会话时为 `None.` | `system_prompt/partials/conversation.md` |
| `{CONVERSATION_WINDOW}` | 近期对话窗口；无近期消息时为 `None.` | `system_prompt/partials/conversation.md` |
| `{MEMORY_YEAR}` | 年记 | `system_prompt/partials/memory.md` |
| `{MEMORY_MONTH}` | 月记 | `system_prompt/partials/memory.md` |
| `{MEMORY_DAY}` | 日记 | `system_prompt/partials/memory.md` |
| `{MEMORY_ACTIVITY}` | 活动记忆 | `system_prompt/partials/memory.md` |
| `{SCHEDULES}` | 当前日程 | `system_prompt/partials/schedule.md` |
| `{SESSION_TYPE}` | 会话类型，值为 `chat` 或 `group` | `system_prompt/foreground.md` 的 include 路径 |
| `{SCHEDULED_PROMPT}` | 定时任务中配置的任务说明 | `task_prompt/scheduled-chat.md`, `task_prompt/scheduled-activity.md` |

## Editing Rules

- 调整整体行为时修改 `system_prompt/`，调整具体任务时修改 `task_prompt/`。
- 改动文件名或路径时，需要同步更新引用它的 include 或加载入口。
