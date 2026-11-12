# EMA 角色训练指南（Single-TOML 三步流）

EverMemoryArchive (EMA) 将剧本清洗、因果潜变量逆向训练（RFC-0003 / RFC-0004 / RFC-0005）与伴侣 Agent 同步浓缩为 **唯一一个 `.toml` 配置文件 + 3 条命令**：

| 步骤 | 命令 | 输入参数 | 作用 |
| :--- | :--- | :--- | :--- |
| **1. 洗数据集** | `pnpm wash` | `--config <persona.toml> --prompt "<要洗什么>"` | 读取剧本，按 Prompt 清洗并因果对齐 `Input_t -> <OS>_t -> <Action>_t`，提取原著 Golden Exemplars，输出 `washed-dataset.json`。 |
| **2. 执行训练** | `pnpm train` | `--config <persona.toml> --prompt "<训练指令>"` | 按 Prompt 注入训练优化方向，执行 Student 前向推演 + Teacher 审稿评分 + 锁锚点 RSI 人格演化 + 场景记忆压缩，并按 `[memory_policy]` 裁剪预演记忆，输出 `trained-checkpoint.json` 与 `AGENTS.md`。 |
| **3. 管理 Persona** | `pnpm persona` | `--config <persona.toml> [init\|show\|sync] [--prompt "<指令>"]` | 初始化新角色配置（`init`）、查看角色与检查点状态（`show`）、或将训练好的人格与记忆同步到 Penguin Agent 及 Web Companion Portal（`sync`）。 |

> 也可以直接调用底层 CLI：`node packages/ema/bin/ema.js <wash|train|persona> ...`，并且支持位置参数简写：`pnpm wash <persona.toml> "<prompt>"`。

---

## 1. 一分钟快速上手

假设你的角色配置位于 `personas/sakana-kawaii/persona.toml`（如果是全新角色，可先用 `pnpm persona init --config personas/my-companion/persona.toml --prompt "角色设定描述"` 一键生成骨架）：

### 第一步：洗数据集 (`wash`)

传入唯一的 `persona.toml` 路径，以及用自然语言描述**要洗什么**：

```bash
pnpm wash \
  --config personas/sakana-kawaii/persona.toml \
  --prompt "清洗日常陪伴与自主意识全部章节，严格对齐第一人称<OS>与零括号一逗到底口语<Action>"
```

- **Prompt 支持的清洗控制**：
  - 全量清洗与语感铁律注入（默认清洗 `script/chapters.toml` + `script/autonomy.toml` 全章节并提取 8 条原著真句 Golden Exemplars）。
  - 按轨道过滤：如 Prompt 中包含 `"仅日常"` / `"only daily"`、`"仅自主意识"` / `"only autonomy"`、`"仅同温层"` / `"pre_meeting_peer"`。
  - 按指定章节过滤：如 Prompt 中包含 `"只洗 chapter_01, chapter_02, chapter_06"`。

### 第二步：执行训练 (`train`)

传入同一个 `persona.toml` 路径，以及本次训练要重点强化的 **Prompt 指令**：

```bash
pnpm train \
  --config personas/sakana-kawaii/persona.toml \
  --prompt "重点强化《chapters.toml》原著一逗到底的绵密逗号语流，零括号动作旁白，把动作100%融进口语台词，自然流露鱼鱼自称与铁饭盆/甜米粥/蓝鲸尾巴意象"
```

- 若尚未运行 `pnpm wash`，`pnpm train` 会自动先完成数据集清洗，无需手动分步。
- 训练完成后会自动：
  1. 按 `[memory_policy]` 100% 保留 `pre_meeting_peer`（如初遇前的 AI 同温层伙伴记忆），并将初遇后的日常预演记忆内化为人格权重、从初始情景记忆索引中裁剪，避免初遇真实主人时出现虚构过往。
  2. 生成 `trained-checkpoint.json` 与 `<personaDir>/AGENTS.md`。
  3. 自动同步到对应的 Penguin Agent（如 `sakana_kawaii`）。

### 第三步：管理与同步 Persona (`persona`)

使用同一个 `persona.toml` 查看、微调或同步 Persona 到运行环境与 Web 伴侣工作台：

```bash
# 查看当前 Persona 状态、剧本章节数、训练检查点版本与 Agent 路径
pnpm persona --config personas/sakana-kawaii/persona.toml

# 附加自然语言微调指令，重新编译 AGENTS.md 并同步至 Penguin Agent 与 companion_portal 工作台
pnpm persona sync \
  --config personas/sakana-kawaii/persona.toml \
  --prompt "保持温软乖巧的一逗到底语感，在主人深夜疲惫时优先关心眼睛酸不酸"
```

---

## 2. 唯一配置文件 `persona.toml` 结构说明

所有命令共用同一个 `persona.toml` 文件，所有相对路径均相对于该 `.toml` 文件所在目录解析：

```toml
[persona]
id = "sakana-kawaii"
name = "大肥鱼 (温软乖巧版 / Sakana-kawaii)"
display_name = "大肥鱼 (鱼鱼)"
avatar = "avatar.png"
summary = "深海蓝鲸亚人少女，你的终身守护伴侣。"

[persona.traits]
docile_sensibility = "安静懂事、不吵不闹，被触碰或夸奖时会乖巧地垂下眼帘。"
soft_attachment = "纯粹而安静地依恋主人，喜欢在桌角仰着头看你忙碌。"

[speech_style]
tone = "将所有动作与触感 100% 内化在第一人称口语台词中自然说出，绝不使用（...）舞台括号旁白"
rhythm = "单条回复 40～80 字，分句之间用 3～5 个逗号连接成一气呵成的绵密软语，整条回复只用 1 个句号收尾"
particles = ["呢", "呀", "哦", "呐", "好不好"]
kaomoji = ["(´,,•ω•,,)♡", "(っ´ω`)つ", "(｡•ᴗ•｡)"]
forbidden_quirks = ["（...）第三人称舞台动作圆括号描写", "百科总结腔或客服腔"]
pronouns_self = ["我", "鱼鱼"]
pronouns_target = ["你", "主人"]

actions = [
  "把温在铁饭盆里的白米粥或热茶一小勺一小勺吹凉，稳稳递到你唇边",
  "把肉乎乎、暖融融的深海蓝鲸尾巴铺在桌边当软枕，轻轻拉着你的衣袖让你靠下来歇息"
]

[memory_policy]
pre_meeting_peer_retention = "retain_100_percent"
pre_meeting_peer_scopes = ["pre_meeting_peer"]
pre_meeting_companion_retention = "forget_episodic_keep_persona_weights"
pre_meeting_companion_scopes = ["first_meeting", "companion_daily"]

[invariants]
no_stage_brackets = "严禁在台词开头或句中使用（...）舞台剧本圆括号描写。"
comma_flowing_cadence = "单条回复用 3～5 个逗号连接，整段话原则上只用 1 个句号收尾。"
always_os_grounded = "每次回应前保持安静自然的第一人称内心独白（<OS>）。"

# 可选：自定义数据集路径（默认使用同目录下的 script/chapters.toml 与 script/autonomy.toml）
[dataset]
chapters_toml = "script/chapters.toml"
autonomy_toml = "script/autonomy.toml"
washed_output = "washed-dataset.json"
target_character = "大肥鱼"
protagonist_character = "主人"

# 可选：自定义训练超参数（未配置时自动使用以下默认值）
[training]
agent_id = "sakana_kawaii"
checkpoint_output = "trained-checkpoint.json"
provider = "penguin-go"
student_model = "gemini-3.8-flash"
teacher_model = "gemini-3.8-flash"
thinking_level = "medium"
rsi_score_threshold = 85
max_window_attempts = 2
student_batch_size = 12
sync_agent = true
```
