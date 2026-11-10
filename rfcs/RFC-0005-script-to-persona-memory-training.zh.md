# RFC-0005 第一版剧本到人格与记忆逆向训练算法

[English](RFC-0005-script-to-persona-memory-training.md)

- Feature Name: `script-to-persona-memory-training`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)

> **状态与出处**：
> - 状态: draft（董事会审阅草案）
> - 修订: v1.0.0

## Summary
[summary]: #summary

本 RFC 定义 EverMemoryArchive（EMA）的**第一版剧本到人格与记忆逆向训练算法（First-Edition Script-to-Persona and Memory Reverse-Engineering Algorithm）**，在 [RFC-0004](RFC-0004-in-context-memory-index-and-os.zh.md) 确立的认知与记忆表征基础之上，完整解决 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 提出的待决问题 3（`人格的具体格式与参数化`）与问题 4（`如何更新人格以获得更高分数`）。

具体而言，本规范定义了在 `@prism-shadow/ema` 中落地的端到端逆向蒸馏与训练管线：
1. **叙事剧本清洗与因果回合聚合（`washGalgameScript`）**：支持角色多别名归一（`speakerAliases`）、场景级未揭晓身份映射（`sceneSpeakerOverrides`），并将穿插的对白、旁白与独白聚合成因果对齐的训练题包 `TurnBundle`（$`q_t = \langle \text{Input}_t, a_t^{\ast} \rangle`$）与场景窗口 `SceneWindow`（$`w_k`$）；
2. **冷启动预热蒸馏与外部人格种子融合**：从预热窗口逆向提炼初始人格 $`P_{0,0} = \text{distill}(q_1 \dots q_N)`$（`distillInitialPersonalityFromWarmup`）或加载外部种子包（`ExternalPersonaSeedBundle`），并锁定核心锚点人格 $`P_{\text{anchor}} = P_{0,0}`$；
3. **微批次零泄露 Student 前向推理（`runStudentSceneForward`）**：将场景内回合划分为大小为 $`B`$ 的微批次（Micro-Batch），前序已完成批次采用 Teacher-Forced 真实反应 $`a_t^{\ast}`$ 锚定上文，而当前待预测批次对 $`a_t^{\ast}`$ 严格盲化（Zero-Leakage），彻底杜绝因未来答案泄露导致的低思考模型虚高得分；
4. **Teacher 联合监督评分与保锚点局部窗口 RSI（`adjust_personality`）**：按 $`S_t = 0.4 \cdot S_{\text{OS}} + 0.6 \cdot S_{\text{Action}}`$ 评测每步表现，当窗口均分 $`\bar{S}(w_k) \lt \tau`$ 时提取典型错题 `worstItems`，通过**保锚点分情境调制算子（Anchor-Preserving Contextual Modulation，`mergeWithAnchors`）**与**严禁死记原句正则化**生成变异人格 $`P_{u,v}'`$，并通过重答校验门控 $`\bar{S}(P_{u,v}') \gt \bar{S}(P_{u,v})`$ 决定采纳或回滚；
5. **基座模型与推理深度消融基准（`runModelAndThinkingAblation`）**：建立跨模型、跨 `thinking_level` 的标准化多维评测方法论。

---

## Motivation
[motivation]: #motivation

### 1. 从原始叙事剧本到因果自洽的监督训练序列

长篇视觉小说、互动叙事或文学剧本（通常跨越 $`150\text{--}300`$ 幕场景、包含目标角色 $`2000+`$ 句台词）并非天然的机器学习题库。原始剧本在转化为训练序列 $`D = \lbrace q_1, \dots, q_T \rbrace`$ 时面临三大结构性难题：
- **未揭晓身份与多别名散落**：在序章或初遇场景中，目标伴侣角色（`Alice`）尚未自报姓名，剧本往往将其台词标记为 `「神秘少女」`、`「？？？」` 或 `「陌生的女学生」`；而在其他场景中，相同的泛称又可能指代其他路人角色；
- **单回合连续多句台词切分**：由于演出分镜需要，伴侣在同一回合的一次完整回应往往被拆成连续 2～3 行对话框，或夹杂一句内心独白（`monologue`）；
- **场景尾声余韵缺失**：在伴侣说出本场景最后一句台词之后，往往还有数行关键的旁白或对手方回应交代本幕结局，若直接截断将导致场景记忆压缩（`compact`）丢失结局信息。

因此，我们需要一套确定性的剧本清洗与回合聚合算法（`washGalgameScript`），在不丢失序章初遇与场景尾声的前提下，将多角色原始剧本转化为因果严密的 `SceneWindow` 与 `TurnBundle` 序列。

### 2. 消除多回合场景评测中的“因果目标泄露（Causal Target Leakage）”

在包含 $`2000+`$ 个回合的数据集上，若完全按单回合（$`B = 1`$）串行发起 LLM 请求，通信延迟将成为训练瓶颈；将场景内的回合按微批次（Micro-Batch，大小 $`B = 4`$ 或 $`6`$）打包推理可显著提升吞吐率。

然而，一种常见却致命的实现错误是：将整幕场景或整个批次的完整剧本（包含该批次内后续回合的真实台词 $`a_t^{\ast}`$）一次性塞进 Prompt，要求模型“依次补全每个回合的 `<OS>` 与 `<Action>`”。在这种存在**目标泄露（Target Leakage）**的提示词下，即便是不开启深度思考（`thinking_level: low`）的弱模型，也能通过偷看后文中的真实台词 $`a_t^{\ast}`$ 逆推或照抄出高分答案，导致评测完全失真。反之，若完全不给任何真实历史锚定而让模型自由续写整幕场景，对话将在 3 个回合内偏离原著语境。

本 RFC 提出的**微批次零泄露前向推理（Micro-Batched Zero-Leakage Student Forward Pass）**从根本上解决了这一矛盾：当前微批次 $`[i, i+B-1]`$ **之前**的所有已完成回合，全部使用 Teacher-Forced 真实反应 $`a_t^{\ast}`$ 构筑场景上文；而处于当前待预测微批次**内部**的所有回合，仅向 Student 暴露输入刺激 $`\text{Input}_t`$，对真实反应 $`a_t^{\ast}`$ 实施 100% 物理隔离。

### 3. 攻克局部窗口 RSI 中的“灾难性遗忘”与“原句死记过拟合”

当某个场景窗口 $`w_k`$ 的得分低于阈值（例如遇到一幕气氛凝重的危机调查或特殊剧情），由 Teacher 执行 `adjust_personality`（$`P_{u,v} \to P_{u,v}'`$）时，无约束的提示词优化极易陷入两大退化陷阱：
1. **核心锚点灾难性遗忘（Catastrophic Persona Forgetting）**：Teacher 为了迎合当前严肃场景，大刀阔斧地删改 `P_{u,v}`，将原本“外冷内热、日常喜欢傲娇毒舌吐槽、台词简短”的角色彻底改写成“时刻严肃冷静的分析者”，导致后续回到日常场景时发生大面积性格崩坏；
2. **台词原句死记硬背（Verbatim Quote Memorization）**：Teacher 为了在当前窗口重考（Retry）时拿高分，直接把错题里的 Ground Truth 台词原句抄进 `speechStyleRules` 槽位，使本应承载通用心理机制的 `CompanionPersonality` 退化为塞满剧透台词的作弊小抄。

为彻底解决 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 的待决问题 4，本 RFC 设计了**保锚点分情境调制（Anchor-Preserving Contextual Modulation）**、**反原句死记正则化**与**闭环重考单调门控（Verified Monotonic Window Commit）**三位一体的更新机制。

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. 第一阶段：叙事剧本清洗与回合包构建（`washGalgameScript`）

给定解析后的结构化剧本 `RawGalgameScript`（包含按叙事顺序排列的场景与行数据 `narration` / `dialogue` / `monologue`），`washGalgameScript(script, options)` 执行以下四步转换产出 `WashedDataset`：

```
RawGalgameScript (包含 S 个原始场景，每行含 speaker / type / text)
   │
   ├── 1. 说话人身份判定 (isTargetSpeaker):
   │      匹配 speaker 是否属于 全局别名集合 `speakerAliases` U 场景专属覆盖 `sceneSpeakerOverrides[sceneId]`
   │
   ├── 2. 有效场景过滤:
   │      筛选包含至少 1 个目标角色回合的叙事场景（支持 `excludeHScenes` 与 `maxOrder` 过滤）
   │
   └── 3. 因果回合包聚合 (flushTurn):
          - 将目标角色发言前的非目标行（旁白 + 其他角色台词）累积为 `pendingInputLines` -> Input_t
          - 将目标角色连续发言的多行对白与独白合并为 `pendingTargetLines` -> (gtActionText, explicitOS)
          - 封装生成因果对齐的 TurnBundle q_t = <Input_t, a_t^*>
          - 将本场景最后一次目标角色发言后的剩余剧本行保存为 `trailingLines` / `trailingText`
```

#### 回合聚合示例

假设序章场景 `001_prologue_01` 通过 `sceneSpeakerOverrides` 将未揭晓姓名的 `"神秘少女"` 映射为目标伴侣 `Alice`，包含如下 5 行原始剧本：

1. `narration`：`"黄昏的钟声在空旷的中庭回荡。"`
2. `dialogue`（`Bob`）：`"请问，这里还有人在吗？"`
3. `monologue`（`神秘少女`）：`"居然又有吵闹的陌生人闯进了我的领地……"`
4. `dialogue`（`神秘少女`）：`"……谁允许你擅自走上来的？"`
5. `dialogue`（`神秘少女`）：`"马上离开这里。"`

`washGalgameScript` 将这 5 行聚合为单个 `TurnBundle`（`001_prologue_01#turn-01`）：
- `inputText`（$`\text{Input}_1`$）：
  ```text
  [旁白] 黄昏的钟声在空旷的中庭回荡。
  【Bob】: 「请问，这里还有人在吗？」
  ```
- `explicitOS`：`"居然又有吵闹的陌生人闯进了我的领地……"`
- `gtActionText`（$`a_1^{\ast}`$）：`"「……谁允许你擅自走上来的？」 「马上离开这里。」"`

---

### 2. 第二阶段：冷启动预热蒸馏与外部人格种子加载

在进入正式计分窗口训练之前，训练器通过以下两种方式之一初始化 $`P_{0,0}`$，并立即将其深拷贝锁定为不可变的核心锚点 `this.anchorPersonality`（$`P_{\text{anchor}} = P_{0,0}`$）：

1. **冷启动预热逆向蒸馏（`distillInitialPersonalityFromWarmup`）**：
   Teacher 读取前序预热场景 $`W_0 = \lbrace q_1, \dots, q_N \rbrace`$ 中的真实交互样本，在不照搬任何具体剧情台词的前提下，逆向提炼出包含六大功能槽位的初始人格档案 `P_0_0`（强制写入非读心视角边界铁律）；
2. **外部人格种子包加载（`loadExternalPersonaSeed`）**：
   支持从仓库外部加载 JSON 格式的 `ExternalPersonaSeedBundle`（包含 `targetCharacter`、`protagonistCharacter`、`speakerAliases`、`sceneSpeakerOverrides` 与初始 `personality` $`P_{0,0}`$），实现算法代码与特定作品角色数据的完全解耦。

---

### 3. 第三阶段：微批次零泄露 Student 前向推理（`runStudentSceneForward`）

在包含 $`L`$ 个回合 $`(q_1, \dots, q_L)`$ 的场景窗口 $`w_k`$ 中，`runStudentSceneForward` 按微批次大小 $`B = \text{studentBatchSize}`$（默认 $`B = 4`$）推进推理：

```
场景窗口 w_k: 回合 [q_1, q_2, q_3, q_4] | [q_5, q_6, q_7, q_8] | ...
              ──────────────────────────   ──────────────────────────
                     微批次 1 (已完成)          微批次 2 (当前待预测)

当对「微批次 2 (q_5 .. q_8)」发起 Student 前向预测时，输入上下文严格由三部分构成：
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 1. 系统提示词前缀 (`AGENTS.md` 单源注入):                           │
  │    - 当前人格设定 P_{u,v}                                           │
  │    - 前序场景单层记忆索引 MemoryIndex (场景 1 .. k-1)               │
  ├─────────────────────────────────────────────────────────────────────┤
  │ 2. 本场景前序已完成批次对话上文 (Teacher-Forced Intra-Scene History)│
  │    - Turn 1: Input_1 -> OS_1 -> a_1^* (已强制对齐为原著真实台词)     │
  │    - Turn 2: Input_2 -> OS_2 -> a_2^* (已强制对齐为原著真实台词)     │
  │    - Turn 3: Input_3 -> OS_3 -> a_3^* (已强制对齐为原著真实台词)     │
  │    - Turn 4: Input_4 -> OS_4 -> a_4^* (已强制对齐为原著真实台词)     │
  ├─────────────────────────────────────────────────────────────────────┤
  │ 3. 当前待预测连续回合批次 (零泄露盲测区 / Zero-Leakage Blind Batch):│
  │    - Turn 5: 仅提供 Input_5  (严格屏蔽 a_5^*！)                     │
  │    - Turn 6: 仅提供 Input_6  (严格屏蔽 a_6^*！)                     │
  │    - Turn 7: 仅提供 Input_7  (严格屏蔽 a_7^*！)                     │
  │    - Turn 8: 仅提供 Input_8  (严格屏蔽 a_8^*！)                     │
  └─────────────────────────────────────────────────────────────────────┘
```

当微批次 2 预测完成后，训练器记录 Student 预测的 `predictedOS` 与 `predictedAction` 以供评分，随即在进入微批次 3 之前将 Turn 5～8 的外部反应**强制覆盖（Teacher-Force Override）**为真实反应 $`a_5^{\ast} \dots a_8^{\ast}`$。

---

### 4. 第四阶段：Teacher 监督评分与保锚点局部窗口 RSI（`adjust_personality`）

#### (1) 双维度联合评分准则（`evaluateScenePredictions`）

Teacher 针对窗口 $`w_k`$ 中每一回合的预测结果 $`(\text{predictedOS}_t, \text{predictedAction}_t)`$ 对照原著真实反应 $`a_t^{\ast}`$ 打分：
- **潜变量 `<OS>` 一致性与深度得分（$`S_{\text{OS}, t} \in [0, 100]`$）**：检验 `predictedOS` 能否作为连接可观测输入 $`\Pi_{\text{obs}}(\text{Input}_t)`$ 与真实反应 $`a_t^{\ast}`$ 的合理心理桥梁。若方向矛盾（`osConsistent === false`），Teacher 在 `committedOS` 中给出校准后的真实内心独白 $`\text{OS}_t^{\ast}`$；
- **外显 `<Action>` 还原度得分（$`S_{\text{Action}, t} \in [0, 100]`$）**：按四项细分权重评分：
  1. *语气与潜台词*（$`30`$ 分）：是否符合角色语调与内外情感反差；
  2. *句长与呼吸感*（$`25`$ 分）：句长节奏是否与 $`a_t^{\ast}`$ 一致（若啰嗦冗长或带 AI 客服腔则予以重扣）；
  3. *情境与情绪准确度*（$`25`$ 分）：反应方向是否契合（不苛求字面用词完全相同，只要神韵、态度与简短度高度契合即可获 $`80\text{--}95`$ 高分）；
  4. *标志性动作与口癖*（$`20`$ 分）：人称称呼、口头禅与习惯性小动作是否自然恰当。
- **单回合综合得分（$`S_t`$）**：

```math
S_t = 0.4 \cdot S_{\text{OS}, t} + 0.6 \cdot S_{\text{Action}, t}
```

#### (2) 保锚点分情境调制与闭环重考（`mutatePersonalityFromWindow`）

设场景窗口 $`w_k`$ 的初始平均得分为 $`\bar{S}(w_k; P_{u,v}) = \frac{1}{|w_k|} \sum_{t \in w_k} S_t`$。当 $`\bar{S}(w_k; P_{u,v}) \lt \tau`$（默认阈值 $`\tau = 78`$）且允许重试时，触发局部窗口 RSI：
1. **提取最低分错题集（`worstItems`）**：按 `combinedScore` 升序排列本窗口所有回合，抽取垫底的 $`K_{\text{worst}} = 6`$ 道典型失分案例；
2. **四大防过拟合与防遗忘提示词约束**：Teacher 分析 `worstItems` 并生成新规则时，必须遵守四条铁律：
   - *铁律 1（核心锚点不可抹除）*：严禁删除初始锚点人格 $`P_{\text{anchor}}`$ 中的核心身份、标志性口癖、基础句长限制与非读心视角边界；
   - *铁律 2（分情境增量调制而非全盘覆盖）*：若当前场景为特殊危机或严肃调查，必须以「在日常情境下保持……；而在……特殊情境下则切换为……」的**条件调制句**扩充规则，绝不一刀切抹杀日常性格；
   - *铁律 3（严禁死记硬背当前场景台词）*：绝对禁止将 `worstItems` 中的具体剧情台词原句（`gtAction`）写进人格规则（具体剧情只属于 `MemoryIndex`）；
   - *铁律 4（抽象为精炼通用法则）*：每个槽位保留最核心的通用心理学与语言学规律，单条不超过 95 字。
3. **代码级锚点强锁定（`mergeWithAnchors`）**：在解析 Teacher 输出后，`mutatePersonalityFromWindow` 在代码层面强制锁定 `this.anchorPersonality.coreIdentity`，并将 `this.anchorPersonality` 各槽位的首部核心锚点规则（包含 `cognitiveOSPatterns` 的首条潜变量映射规则与末条非读心铁律）作为不可删改的前缀，再将新增的条件调制规则去重追加其后；
4. **闭环重考采纳门控（Re-Verification Gate）**：训练器使用变异后的 $`P_{u,v}'`$ 重新在场景 $`w_k`$ 上运行 `runStudentSceneForward` 与 `evaluateScenePredictions`：
   - 若重考均分满足 $`\bar{S}(w_k; P_{u,v}') \ge \bar{S}(w_k; P_{u,v})`$，则正式采纳 $`P_{u,v}'`$，并基于重考产生的高分轨迹执行 `compactSceneMemory` 生成 $`\text{MemoryIndex}_{0,k}'`$，向下一窗口传递耦合状态向量 $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$；
   - 若重考均分未提升，则自动回滚至 $`P_{u,v}`$ 并基于原轨迹压缩记忆。

---

### 5. 第五阶段：基座模型与推理深度消融基准（`runModelAndThinkingAblation`）

在大规模长程训练启动前，`runModelAndThinkingAblation` 在固定初始人格 $`P_{0,0}`$ 与相同代表性场景切片上，使用同一个 Teacher 审稿器对候选 `(provider, modelId, thinkingLevel)` 组合进行多维横评：

| 评测指标 | 指标定义 | 选型作用 |
| --- | --- | --- |
| `formatSuccessRate` | 严格遵循 `<OS>` / `<Action>` 或微批次 JSON 格式的回合比例 | 硬性准入门槛（要求 $`\ge 0.98`$） |
| `osConsistencyRate` | `predictedOS` 与原著真实反应 $`a_t^{\ast}`$ 心理自洽的回合比例 | 度量潜变量心理推演质量 |
| `meanOsScore` | Teacher 评定的平均内心独白得分 $`\bar{S}_{\text{OS}} \in [0, 100]`$ | 度量内心戏深度与非读心边界遵守度 |
| `meanActionScore` | Teacher 评定的平均外显台词得分 $`\bar{S}_{\text{Action}} \in [0, 100]`$ | 度量语调、句长呼吸感与口癖还原度 |
| `meanCombinedScore` | 综合得分 $`0.4 \cdot \bar{S}_{\text{OS}} + 0.6 \cdot \bar{S}_{\text{Action}}`$ | 核心质量寻优目标 |
| `msPerTurn` & `costUsd` | 单回合平均耗时（ms）与含 KV 缓存统计的实际美元成本 | 帕累托（Pareto）性价比前沿选型 |

在 9 组模型与推理深度的实测消融中，零泄露评测揭示了关键规律：在杜绝后文答案泄露的前提下，将主力模型的推理深度从 `low` 提升至 `medium`（例如 `gemini-3.8-flash@medium`），其 `osConsistencyRate` 与 `meanCombinedScore` 均出现显著跃升——这是因为模型利用适度的内部推理预算主动过滤了 `[旁白]` 中的主角未公开心理，并在输出 `<Action>` 前完成了句长裁剪与傲娇/反差语调校准。

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 叙事剧本清洗与回合包形式化定义

设原始场景 $`k`$ 的剧本行序列为 $`L_k = (l_1, l_2, \dots, l_{M_k})`$，其中每行 $`l_j = (\text{type}_j, \text{speaker}_j, \text{text}_j)`$ 的类型 $`\text{type}_j \in \lbrace \text{narration}, \text{dialogue}, \text{monologue} \rbrace`$。

给定目标伴侣角色主名称 $`c_{\text{target}}`$、全局别名集合 $`\mathcal{A}_{\text{global}}`$ 以及场景级说话人覆盖映射 $`\mathcal{A}_{\text{scene}}(k)`$，定义目标角色指示函数：

```math
\mathbb{I}_{\text{target}}(l_j, k) = \begin{cases} 1 & \text{若 } \text{speaker}_j \in \lbrace c_{\text{target}} \rbrace \cup \mathcal{A}_{\text{global}} \cup \mathcal{A}_{\text{scene}}(k) \\ 0 & \text{其他情况} \end{cases}
```

序列 $`L_k`$ 被唯一分解为交替出现的极长连续非目标行子序列 $`U_{k,t}`$（$`\mathbb{I}_{\text{target}} = 0`$）与极长连续目标角色行子序列 $`V_{k,t}`$（$`\mathbb{I}_{\text{target}} = 1`$，$`t = 1, \dots, T_k`$），以及目标角色最后一次发言后的可选尾声序列 $`U_{k, \text{trail}}`$：

```math
L_k = U_{k,1} \oplus V_{k,1} \oplus U_{k,2} \oplus V_{k,2} \oplus \dots \oplus U_{k,T_k} \oplus V_{k,T_k} \oplus U_{k,\text{trail}}
```

每一对相邻的 $`(U_{k,t}, V_{k,t})`$ 构造为一个原子训练回合包 `TurnBundle`：

```math
q_{k,t} = \big\langle \text{Input}_{k,t} = \text{FormatInput}(U_{k,t}), \; a_{k,t}^{\ast} = \text{FormatAction}(V_{k,t}), \; \text{explicitOS}_{k,t} = \text{ExtractMonologue}(V_{k,t}) \big\rangle
```

若目标角色在场景开场第一行即发言（$`U_{k,1} = \varnothing`$），则 $`\text{Input}_{k,1}`$ 填充为规范化开场标记 `"[场景开场]"`。

---

### 2. 微批次零泄露因果掩码（Zero-Leakage Micro-Batch Causal Masking）

设场景窗口 $`w_k = (q_{k,1}, \dots, q_{k,T_k})`$ 按微批次大小 $`B`$ 切分为 $`\lceil T_k / B \rceil`$ 个连续批次。对于第 $`b \in \lbrace 0, 1, \dots, \lceil T_k / B \rceil - 1 \rbrace`$ 个微批次，记当前待预测回合下标集合为 $`J_b = \lbrace bB + 1, \dots, \min((b+1)B, T_k) \rbrace`$，本场景内已完成的前序回合下标集合为 $`J_{\lt b} = \lbrace 1, \dots, bB \rbrace`$。

在对微批次 $`b`$ 发起 Student 前向调用时，暴露给 Student 策略的信息集 $`\mathcal{I}_{k,b}`$ 严格定义为：

```math
\mathcal{I}_{k,b} = \underbrace{\big(P_{u,v}, \; I_{\lt k}\big)}_{\text{AGENTS.md 系统前缀}} \cup \underbrace{\big\lbrace \langle \text{Input}_{k,j}, \hat{\text{OS}}_{k,j}, a_{k,j}^{\ast} \rangle \big\rbrace_{j \in J_{\lt b}}}_{\text{Teacher-Forced 前序已完成批次}} \cup \underbrace{\big\lbrace \text{Input}_{k,i} \big\rbrace_{i \in J_b}}_{\text{当前批次纯输入刺激}}
```

对于当前微批次内的任意待预测回合 $`i \in J_b`$，其真实外部反应 $`a_{k,i}^{\ast}`$ 严格满足因果盲化条件：

```math
a_{k,i}^{\ast} \notin \mathcal{I}_{k,b}, \quad \forall i \in J_b
```

当且仅当微批次 $`b`$ 的预测结果 $`\lbrace (\hat{\text{OS}}_{k,i}, \hat{a}_{k,i}) \rbrace_{i \in J_b}`$ 全部返回后，系统才将 $`\hat{a}_{k,i}`$ 强制替换为 $`a_{k,i}^{\ast}`$ 并并入下一批次的历史集合 $`J_{\lt b+1}`$。

---

### 3. 保锚点突变算子与单调采纳门控方程

设冷启动蒸馏或种子加载后锁定的核心锚点人格为 $`P_{\text{anchor}} = P_{0,0}`$，窗口 $`w_k`$ 当前持有的人格为 $`P_{u,v}`$。

当窗口初始均分 $`\bar{S}(w_k; P_{u,v}) \lt \tau`$ 时，Teacher 诊断算子 $`\mathcal{G}_{\text{Teacher}}`$ 根据 $`P_{u,v}`$ 与本窗口得分最低的 $`K_{\text{worst}}`$ 个失分回合 $`W_{\text{worst}} \subset w_k`$ 提议候选槽位增量规则 $`\tilde{\Delta}_{u,v}`$：

```math
\tilde{\Delta}_{u,v} = \mathcal{G}_{\text{Teacher}}\big(P_{u,v}, \; W_{\text{worst}}\big)
```

为确保核心人格锚点在任意次局部突变后永不丢失，**保锚点合并算子（`mergeWithAnchors`）** 按如下确定性方程构造候选人格 $`P_{u,v}'`$ 的每一个结构槽位 $`s \in \lbrace \text{emotionalDynamics}, \text{speechStyleRules}, \text{cognitiveOSPatterns}, \text{behavioralHabits}, \text{antiOocConstraints} \rbrace`$：

```math
P_{u,v}'[\text{coreIdentity}] \leftarrow P_{\text{anchor}}[\text{coreIdentity}]
```

```math
P_{u,v}'[s] \leftarrow \text{LockPrefix}_s\big(P_{\text{anchor}}[s]\big) \;\oplus\; \text{Deduplicate}\Big(\text{Truncate}_{K_s}\big(\tilde{\Delta}_{u,v}[s]\big), \; \text{LockPrefix}_s\big(P_{\text{anchor}}[s]\big)\Big)
```

其中 $`\text{LockPrefix}_s(P_{\text{anchor}}[s])`$ 刚性保留初始锚点人格在槽位 $`s`$ 中的基石规则（特别地，`cognitiveOSPatterns` 同时刚性锁定首条 `<OS>` 推演规则与末条非读心视角边界规则），$`K_s \in \lbrace 3, 4 \rbrace`$ 限制单槽位最多追加的分情境条件调制规则条数。

随后，窗口 $`w_k`$ 的状态转移执行**闭环单调采纳门控（Monotonic Acceptance Gate）**：

```math
(P_{u,v+1}, \; w_k^{\ast}) = \begin{cases} \big(P_{u,v}', \; w_k(P_{u,v}')\big) & \text{若 } \bar{S}\big(w_k; P_{u,v}'\big) \ge \bar{S}\big(w_k; P_{u,v}\big) \\ \big(P_{u,v}, \; w_k(P_{u,v})\big) & \text{其他情况（回滚至 } P_{u,v} \text{）} \end{cases}
```

并在胜出的最优轨迹 $`w_k^{\ast}`$ 上执行场景记忆压缩与状态同步：

```math
\text{MemoryIndex}_{0,k} = \text{compress}_C(w_k^{\ast}), \quad M_{u,v+1} = M_{u,v} \cup \lbrace \text{MemoryIndex}_{0,k} \rbrace
```

---

### 4. 双工作流协同：闭环联合 RSI（模式 A）与固定人格全剧批量压缩（模式 B）

呼应 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 的理论对偶性，`EmaPersonaTrainer` 提供两种可独立运行或串联组合的逆向训练模式：

1. **模式 A —— 闭环联合人格与记忆 RSI（`trainSceneWindow`）**：
   在覆盖角色核心性格切面的代表性场景窗口上，完整运行 `Forward -> Evaluate -> (条件触发保锚点 RSI 突变与重考) -> Compact + Reflect -> 同步 AGENTS.md`，同时逆向演化出高还原度人格 $`P_{0,m}`$ 与高保真场景记忆；
2. **模式 B —— 固定人格全剧批量场景压缩（`compactScenesBatchFromScript`）**：
   当人格 $`P^{\ast}`$ 已收敛至稳定高分（或固定高质量人格 $`P`$ 以逆向构建全剧百余幕完整记忆库）时，`compactScenesBatchFromScript` 将剧本场景按批（如每批 5～6 个场景）送入压缩算子，在 $`P^{\ast}`$ 透镜下推演补全每幕的潜变量情感弧线 `innerOSArc` 并提取第一人称 `summary` 与 `keyFacts`，以极高的 Token 效率完成全剧 100% 场景的 `MemoryIndex` 蒸馏。

---

## Invariants
[invariants]: #invariants

### causal-turn-bundle-isolation

> **在对当前微批次 $`J_b`$ 执行 Student 前向预测时，提示词上下文绝不允许泄露 $`J_b`$ 内任何回合的真实反应 $`a_{k,i}^{\ast}`$，而本场景内所有已完成的前序批次 $`J_{\lt b}`$ 必须将其外部反应强制对齐为真实反应 $`a_{k,j}^{\ast}`$。**

若在待预测批次中暴露 $`a_{k,i}^{\ast}`$，模型将通过后文窥探答案导致评测分数失真；若前序已完成批次不执行 Teacher Forcing，早期预测偏差将在长场景内引发级联语境漂移。

### anchor-preserving-contextual-modulation

> **任何局部窗口的人格更新 $`P_{u,v} \to P_{u,v}'`$ 必须刚性保留初始锚点人格 $`P_{\text{anchor}} = P_{0,0}`$ 的核心身份与各槽位基石锚点，针对特殊场景的行为修正必须表述为分情境的条件调制，严禁全盘覆盖日常基线性格。**

缺乏锚点锁定的贪心提示词重写会因剧本中途的一幕严肃或反常剧情而抹杀角色的日常性格特征，引发跨场景的灾难性遗忘。

### anti-verbatim-quote-regularization

> **`CompanionPersonality` 的所有规则槽位仅允许编码可泛化的心理机制、情感动力学与语言学规律，严禁将剧本中的具体台词原句（$`a_t^{\ast}`$）或特定剧情剧透写入人格档案。**

将具体台词原句死记硬背进人格参数 $`P_{u,v}`$ 会混淆「我是谁（人格 $`P`$）」与「我经历过什么（记忆 $`M`$）」的认知边界，导致线上自由对话时出现脱离语境的生硬台词复读。

### verified-monotonic-window-commit

> **在场景窗口 $`w_k`$ 上变异生成的候选人格 $`P_{u,v}'`$，当且仅当其在同一窗口重考获得的平均得分满足 $`\bar{S}(w_k; P_{u,v}') \ge \bar{S}(w_k; P_{u,v})`$ 时才允许替换 $`P_{u,v}`$ 并用于生成该窗口的压缩记忆 $`\text{MemoryIndex}_{0,k}`$。**

未经重考验证的提示词修改常出现“看似合理实则降分”的退化；强制执行重考门控保证了局部演化轨迹的单调非退化性，并确保写入 `MemoryIndex` 的记忆始终源自更高分的人格轨迹。

---

## Drawbacks
[drawbacks]: #drawbacks

1. **触发局部 RSI 重试窗口的双倍推理开销**：
   当某幕场景的首次得分低于 `rsiScoreThreshold`（$`\tau = 78`$）时，执行 `mutatePersonalityFromWindow` 并重新运行该窗口的 Student 前向与 Teacher 评分会使该窗口的调用次数翻倍。
   - *缓解措施*：随着前 10～15 个代表性场景完成保锚点 RSI 校准，$`P_{u,v}`$ 在后续绝大多数窗口中首次作答即可超过 $`\tau = 78`$ 免于重试；且全剧其余百余幕场景可通过 `compactScenesBatchFromScript` 批量高速合入。

2. **LLM 审稿器在临界分值附近的微小随机波动**：
   Teacher 评分模型在不同批次调用间可能存在 $`\pm 2`$ 分以内的随机波动，当 $`\bar{S}(P_{u,v}') \approx \bar{S}(P_{u,v})`$ 时可能偶发保守回滚。
   - *缓解措施*：`evaluateScenePredictions` 以单次最多 18 个回合的结构化分块（Chunk）横向对比打分，通过同场景全窗口校准大幅降低了单回合独立打分的方差。

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### 为什么选择微批次（$`B = 4`$）而非纯单步（$`B = 1`$）或整幕一次性预测（$`B = L`$）？

- 纯单步（$`B = 1`$）在一幕包含 24 个回合的场景中需要串行发起 24 次网络请求，往返延迟过高；
- 整幕一次性预测（$`B = L`$）若不提供中间回合的真实反应，Student 在预测第 20 回合时无法获知对手方在第 1～19 回合的真实互动反馈；若提供中间真实反应则会造成严重的因果目标泄露；
- 微批次（$`B = 4`$ 至 $`6`$）实现了最优帕累托折中：将 RPC 请求次数压缩 $`4\text{--}6`$ 倍，同时每隔 4～6 个回合即用 Teacher-Forced 真实反应重新锚定场景进展，兼顾零泄露严谨性与高吞吐效率。

### 为什么采用「模式 A（重点场景闭环 RSI）+ 模式 B（全剧批量场景压缩）」的混合范式？

角色人格 $`P`$ 的内在自由度相对集中（通常经过 10～20 个涵盖日常、冲突、独处、危机的典型场景即可收敛至 $`85+`$ 分的高还原度状态），而情景记忆 $`M`$ 的规模则随剧本长度线性增长（100～200 个场景）。通过模式 A 精雕细琢人格参数 $`P^{\ast}`$，再配合模式 B 将全剧所有场景快速压缩进 `MemoryIndex`，能够在极具性价比的算力预算内同时交付「灵魂高度还原的人格」与「零遗漏的全剧记忆」。

---

## Prior art
[prior-art]: #prior-art

- **TextGrad (Yuksekgonul et al., 2024) 与 OPRO (Yang et al., 2023)**：利用错题诊断的文本梯度迭代优化提示词；本 RFC 在此基础上引入了代码级槽位锚点锁定（`mergeWithAnchors`）与反原句死记正则化，解决了长序列分布漂移下的提示词灾难性遗忘问题。
- **Elastic Weight Consolidation (EWC, Kirkpatrick et al., 2017)**：在神经网络连续学习中通过惩罚核心参数偏离来防止遗忘旧任务；本 RFC 在上下文空间构造了离散对偶实现——锁定 $`P_{\text{anchor}}`$ 核心槽位前缀，仅在条件调制空间做增量扩展。
- **Teacher Forcing 与 Scheduled Sampling (Bengio et al., 2015)**：在序列生成训练中平衡真实历史条件与自主预测；本 RFC 将其推广为微批次边界对齐的零泄露认知轨迹合成。

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **模式 A 高惊奇度（High-Surprisal）训练窗口的自动主动学习筛选**：面对包含 130 余幕场景的长剧本，能否先通过一次极低成本的粗筛扫描定位出角色反应最出人意料（最高认知惊奇度）的 Top-15 场景，自动将其选为模式 A 的重点 RSI 训练窗口？
- **多分支状态向量束搜索（Vector Beam Search）的跨章剪枝策略**：当并行维护多个候选演化分支 $`\lbrace P_{u,v}^{(b)}, M_{u,v}^{(b)} \rbrace`$ 时，相隔多少个场景窗口执行一次全局泛化验证与剪枝最为高效？

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **线上真实陪伴期的持续在线 RSI（Continual Online Companion RSI）**：将 `evaluateScenePredictions` 与 `mutatePersonalityFromWindow` 的监督信号从离线剧本 Ground Truth $`a_t^{\ast}`$ 扩展至线上真实用户的长期互动反馈与情感共鸣信号。
- **多角色群像耦合蒸馏**：从多主角群像剧本中同步逆向训练一组相互熟稔、共享世界记忆却各自保持独立视角边界的伴侣智能体网络。

---

## Changes

### v1.0.0

- 初始版本：正式规范叙事剧本清洗器（`washGalgameScript`）、冷启动预热蒸馏器（`distillInitialPersonalityFromWarmup`）与外部人格种子加载器（`ExternalPersonaSeedBundle`）、微批次零泄露 Student 前向推理（`runStudentSceneForward`）、Teacher 双维度监督评分器（`evaluateScenePredictions`）、保锚点分情境调制局部 RSI 算子（`mutatePersonalityFromWindow`）、全剧批量场景压缩器（`compactScenesBatchFromScript`）以及基座模型与推理深度消融基准（`runModelAndThinkingAblation`）。
