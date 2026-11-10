# RFC-0004 第一版人格与记忆建模：In-Context Memory-Index 与潜变量 OS

[English](RFC-0004-in-context-memory-index-and-os.md)

- Feature Name: `in-context-memory-index-and-os`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)

> **状态与出处**：
> - 状态: draft（董事会审阅草案）
> - 修订: v1.0.0

## Summary
[summary]: #summary

本 RFC 定义 EverMemoryArchive（EMA）伴侣智能体的第一版运行时认知与记忆建模架构，直接解决 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 留下的待决问题 1（`记忆的具体格式`）、问题 2（`记忆中应当包含哪些内容`）以及问题 3 的结构化建模部分（`人格的具体格式`）。

具体而言，本规范确立了以下三项核心机制：
1. **两阶段潜变量认知前向方程**：形式化定义 $`\text{Input}_t \xrightarrow{P, M} \text{OS}_t \xrightarrow{P, M, \text{Input}_t} \text{Action}_t`$，将监督训练期显式的 `<OS>` / `<Action>` XML 双标签输出与日常陪伴期模型原生 `thinking` 通道无缝统一，并确立**非读心视角边界铁律（Non-Mind-Reading Perspective Boundary Invariant）**；
2. **六槽位结构化人格档案（`CompanionPersonality`）与单源前缀注入**：定义由 `coreIdentity`、`emotionalDynamics`、`speechStyleRules`、`cognitiveOSPatterns`、`behavioralHabits`、`antiOocConstraints` 与 `mutationHistory` 组成的人格 Schema，并通过单源同步至 `AGENTS.md` 系统前缀消除 System/User 双重注入的 Token 膨胀，实现 $`\gt 90\%`$ 的 KV 缓存命中率；
3. **原子记忆项（`MemoryItem`）、单层情景记忆索引（`SceneMemoryIndexItem`）与闭环可重构性度量**：定义三元组 $`\langle \text{Input}_t, \text{committedOS}_t, \text{Action}_t^{\ast} \rangle`$、包含第一人称 `summary`、`innerOSArc`、`keyFacts` 与 `archiveRef` 的单层索引项 $`\text{MemoryIndex}_{0,x}`$，以及通过 `compact` + `reflect` 闭环训练压缩算子 $`C`$ 的可重构性评分函数 $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) \in [0, 100]`$。

---

## Motivation
[motivation]: #motivation

### 1. 将 RFC-0003 的耦合动力系统 $`\Theta = (P, M, C)`$ 具象为工程可执行的表征

在 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 中，我们从第一性原理出发，将伴侣认知建立在人格 $`P`$、记忆 $`M = f_C(D, P)`$ 与压缩算子 $`C`$ 的三维耦合演化空间之上。然而，要将该元理论落地为可在真实长篇叙事语料上训练、并在 PenguinHarness 中实时运行的伴侣智能体，必须首先在表征层面回答三个核心问题：
- 潜变量心理状态 $`\text{OS}_t`$ 应当如何表达、解析，并防止其被剧本的“全知上帝视角”污染？
- 人格参数 $`P_{u,v}`$ 应当采用何种数据结构，才能支持局部窗口递归自我改进（RSI）按槽位精细修正偏差，而不引发结构腐化或抹除既有核心设定？
- 单步原子记忆 `MemoryItem` 与场景压缩索引 `SceneMemoryIndexItem`（$`\text{MemoryIndex}_{0,x}`$）究竟应当保留哪些信息维度，又该如何定量评估一次记忆压缩是否丢掉了场景的灵魂？

### 2. 视角边界难题：伴侣潜变量 `<OS>` vs. 叙述者未公开的第一人称心理旁白

在视觉小说、互动叙事剧本或第一人称文学作品中，伴侣角色（`Companion`，下称 `Alice`）往往通过对手方主角（`Protagonist`，下称 `Bob`）的第一人称视角被观测。剧本中的 `[旁白]`（`[Narration]`）段落混合了两类截然不同的认知信息：
- **客观可感知信息**：环境描写、人物动作、神态微表情以及公开说出口的台词，这些属于 `Alice` 在物理世界中合法可见的感知输入；
- **未说出口的私密心理独白**：`Bob` 在内心深处的自我吐槽、隐瞒的伤痛或未宣之于口的联想，这些信息从未通过语言或明显动作暴露给外界。

如果缺乏严格的**非读心视角边界（Non-Mind-Reading Perspective Boundary）**，大语言模型极易发生“全知视角泄露（Omniscient Perspective Leakage）”——让 `Alice` 在台词中直接回应或戳穿 `Bob` 仅存在于 `[旁白]` 中的内心想法。与此同时，`Alice` 自身往往具有强烈的“内外反差”（例如外显言辞简短冷淡 `<Action>`，实则内心高度关切警觉 `<OS>`）。通过将认知过程拆解为受视角边界约束的两阶段映射，既能杜绝读心穿帮，又能显式捕捉角色从真实潜台词到外显言行的心理因果链。

### 3. 单源 `AGENTS.md` 前缀注入与 KV 缓存经济学

在一部包含 100～200 个场景的长篇剧本中，单层全量 `MemoryIndex` 的体量约为 $`3\text{k}\text{--}5\text{k}`$ Tokens，结构化人格 `CompanionPersonality` 约为 $`0.8\text{k}\text{--}1.2\text{k}`$ Tokens。如果训练或推理框架在将 $`(P_{u,v}, \text{MemoryIndex})`$ 写入 Agent 的系统指令文件 `AGENTS.md` 的同时，又在每一回合的 User Prompt 中内联（Inline）拼接一遍相同的人格与记忆，将引发两个严重后果：
1. **双倍 Token 浪费**：每一次 LLM 调用都为完全相同的人格与记忆上下文支付双倍输入开销；
2. **KV 缓存失灵**：User Prompt 中夹杂长段状态文本会破坏跨回合前缀对齐，导致模型服务商无法复用前缀 KV Cache。

通过确立 `AGENTS.md` 作为 $`(P_{u,v}, \text{MemoryIndex})`$ 的**唯一单源系统前缀（Single-Source System Prefix）**，并在磁盘同步开启时自动关闭 User Prompt 内联注入，同一场景窗口内所有回合的数千 Token 系统前缀保持字节级恒定，可将前缀 KV 缓存命中率稳定提升至 $`90\%`$ 以上。

### 4. 用闭环可重构性（`compact` + `reflect`）取代主观摘要启发式

传统的对话摘要往往生成第三人称的客观流水账，既丢失了伴侣在该场景中的第一人称情感暗线（`<OS>` 轨迹），也缺乏衡量摘要质量的客观标尺。通过规定每条 `SceneMemoryIndexItem` 必须以伴侣第一人称（「我」）同时记录核心事件 `summary`、内心情感弧线 `innerOSArc` 与关键事实锚点 `keyFacts`（并附带指向原始归档的 `archiveRef`），我们可以构建闭环的**可重构性评测器（Reconstructibility Evaluator）** $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) \in [0, 100]`$，直接以“能否仅凭压缩索引反射还原出原场景关键细节与心境”来量化并训练压缩算子 $`C`$。

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. 两阶段潜变量认知前向通道（$`\text{Input}_t \to \text{OS}_t \to \text{Action}_t`$）

在任意交互回合 $`t`$，伴侣智能体遵循以下两阶段认知管线处理输入：

```
可观测输入 Input_t  ──(视角边界过滤: 非读心铁律)──>  角色合法感知的外部刺激
                                                              │
       ┌──────────────────────────────────────────────────────┘
       ▼
[阶段 1: 潜变量内心独白生成 (OS_t)]
 基于 (P_{u,v}, MemoryIndex, 场景内近期上文 History):
 以第一人称推演 1 句精炼的内心真实情绪波动、潜台词与关系意图。
       │
       ▼
[阶段 2: 外显动作与台词生成 (Action_t)]
 基于 (P_{u,v}, MemoryIndex, Input_t, OS_t):
 严格遵循角色句长、语调口癖与反 OOC 约束，输出实际说出口的台词与神态小动作。
```

#### (1) 双模态潜变量承载：训练期显式 XML 标签 vs. 线上原生 `thinking` 通道

EMA 在训练评测期与线上陪伴期共享完全一致的认知拓扑，仅在外层帧格式（Framing）上按需切换：
- **监督训练与评测模式（Training / Evaluation Mode）**：Student 提示词要求模型显式输出 `<OS>` 与 `<Action>` XML 标签，以便 Teacher 审稿器能够独立观测并分别评估心理动机一致性与外显台词还原度：
  ```xml
  <OS>明明身体已经很勉强了却还在装作若无其事，我得找个借口留在他身边盯紧他。</OS>
  <Action>「……哼。别误会，我只是刚好顺路走这边而已。」</Action>
  ```
- **线上实时陪伴模式（Live Companion Mode）**：当用户在 PenguinHarness 中与伴侣日常对话时（见 `AGENTS.md` 第 8 节交互准则），伴侣在底层模型的原生推理通道（`thinking` channel，默认配置 `thinking_level: medium`）中完成潜变量 `<OS>` 推演，而在可见回复流中直接以自然的角色台词与神态动作回应，不暴露任何 XML 标签或系统元信息。

#### (2) 非读心视角边界（Non-Mind-Reading Perspective Boundary）示例解析

考虑如下包含主角 `Bob` 第一人称未公开心理活动的输入回合 `Input_t`：

```text
[旁白] 我强装镇定地笑了笑并挥了挥手，悄悄把胸口旧伤发作的阵痛压了下去，不想让 Alice 替我担心。
【Bob】: 「今天钟楼天台上的风还挺舒服的呢。」
```

- **错误响应（违反非读心铁律 / 上帝视角穿帮）**：
  - `<OS>`：*Bob 胸口的旧伤又发作了！他居然还在强装镇定瞒着我，我必须马上揭穿他。*
  - `<Action>`：*「别装了！你胸口的旧伤明明又在痛了吧？」*
  - *失分原因*：`Bob` 根本没有说出口“胸口旧伤痛”，该信息仅存在于第一人称叙述者的内心独白中。
- **正确响应（严守视角边界的潜变量推演）**：
  - `<OS>`：*他嘴上在聊天气，但笑容比平时僵硬了一点。虽然不知道原因，还是别离他太远比较好。*
  - `<Action>`：*「……明明风这么凉。把外套穿好，笨蛋。」*
  - *得分原因*：`Alice` 仅根据客观可见的细微神态（笑容略显僵硬、天台风凉）产生符合其外冷内热性格的 `<OS>`，并转化为简短自然的 `<Action>`。

---

### 2. 六槽位结构化人格档案 Schema（`CompanionPersonality`, $`P_{u,v}`$）

为了避免自由文本角色卡在多轮迭代修改中发生规则互相覆盖或结构退化，RFC-0004 将人格 $`P_{u,v}`$ 解耦为六个正交的功能槽位与一条演化审计链（`mutationHistory`）：

| 字段名 | 类型 | 认知控制职责 |
| --- | --- | --- |
| `coreIdentity` | `string` | 核心身份、世界观背景、自身定位以及与主角（`Protagonist`）的根本羁绊。在局部窗口突变中作为锁定的核心锚点。 |
| `emotionalDynamics` | `string[]` | 情感基调、内外反差动力学，以及日常互动与严肃危机等不同情境下的条件情绪切换规律。 |
| `speechStyleRules` | `string[]` | 具象语言学铁律：句长上限、呼吸停顿节奏、人称代词、标志性口头禅及省略号/留白使用规范。 |
| `cognitiveOSPatterns` | `string[]` | 从外部刺激到潜变量 `<OS>`、再从 `<OS>` 到外显 `<Action>` 的心理映射法则，强制包含**非读心视角边界铁律**。 |
| `behavioralHabits` | `string[]` | 伴随台词自然流露的标志性肢体小动作、视线转移与微表情习惯。 |
| `antiOocConstraints` | `string[]` | 经 Teacher 错题诊断累积的负向防崩坏约束（如严禁现代 AI 客服腔、严禁长篇说教、严禁日常对话调用无关工具）。 |
| `mutationHistory` | `Array<MutationRecord>` | 记录每次人格演化的 `fromVersion`、`toVersion`、`sceneId`、`reason`、`scoreBefore` 与 `scoreAfter`。 |

---

### 3. 原子记忆项（`MemoryItem`）与单层情景记忆索引（`SceneMemoryIndexItem`）

#### (1) 原子情景记忆三元组：`MemoryItem`

在当前训练或交互的场景窗口 $`w_x`$ 内，每一回合 $`t`$ 在完成 Teacher 校验后沉淀为一个 `MemoryItem`：

```math
\text{MemoryItem}_t = \langle \text{Input}_t, \; \text{committedOS}_t, \; \text{Action}_t^{\ast} \rangle
```

- `predictedOS` 与 `predictedAction`：Student 模型在当前 $`P_{u,v}`$ 下预测的原始输出，保留在结构体中供 Teacher 诊断失分原因与消融实验统计；
- `committedOS`：若 Student 预测的 `predictedOS` 与原著真实反应 $`\text{Action}_t^{\ast}`$ 在心理逻辑上自洽（`osConsistent === true`），则直接采纳 `predictedOS`；若存在矛盾（`osConsistent === false`），则由 Teacher 填入修正后的真实潜台词 $`\text{OS}_t^{\ast}`$，确保写入记忆的心理暗线绝不被错误预测污染；
- `gtActionText`（$`\text{Action}_t^{\ast}`$）：强制对齐（Teacher Forcing）为原著真实动作与台词，保证后续回合始终锚定在真实叙事流形上。

#### (2) 单层场景压缩索引项：`SceneMemoryIndexItem`（$`\text{MemoryIndex}_{0,x}`$）

当场景窗口 $`w_x`$ 结束触发 `compact` 时，压缩算子 $`C`$ 将该场景的一组 `MemoryItem` 浓缩为一条单层索引项 `SceneMemoryIndexItem`：

```json
{
  "sceneId": "005_ch01_05",
  "order": 5,
  "chapter": "ch01",
  "title": "旧钟楼天台的黄昏",
  "setting": "钟楼天台 / 黄昏",
  "summary": "黄昏时分我与 Bob 在旧钟楼天台并肩看夕阳，嘴上嫌他吵闹，但默许了今后下午下课后都在这里碰面的约定。",
  "innerOSArc": "从最初被闯入独处领地的戒备，逐渐转化为发现对方懂得尊重安静氛围后的安心。",
  "keyFacts": [
    "共同秘密据点：黄昏时分的旧钟楼天台",
    "重要约定：下午课程结束后在钟楼天台碰面",
    "Bob 和我一样讨厌喧闹的仪式场合"
  ],
  "archiveRef": "episodes/005_ch01_05.jsonl",
  "reflectionScore": 92
}
```

当通过 `formatMemoryIndexMarkdown` 渲染进 `AGENTS.md` 时，每个场景压缩为一行高信息密度的 Markdown 条目：

```markdown
- **[005_ch01_05 | 旧钟楼天台的黄昏 (钟楼天台 / 黄昏)]**: 黄昏时分我与 Bob 在旧钟楼天台并肩看夕阳，嘴上嫌他吵闹，但默许了今后下午下课后都在这里碰面的约定。 *(内心OS: 从最初被闯入独处领地的戒备，逐渐转化为发现对方懂得尊重安静氛围后的安心。)* | 关键记忆: 共同秘密据点：黄昏时分的旧钟楼天台；重要约定：下午课程结束后在钟楼天台碰面
```

---

### 4. `AGENTS.md` 单源前缀注入机制（Single-Source Prefix Injection）

`renderCompanionAgentsMd` 将结构化人格 $`P_{u,v}`$（第 1～6 节）、单层情景记忆索引 `MemoryIndex`（第 7 节）以及对话交互准则（第 8 节）统一渲染为伴侣 Agent 的 `agent_state/AGENTS.md`：

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 系统提示词前缀 (源自 agent_state/AGENTS.md — 跨回合恒定，命中 KV 缓存)    │
│   §1 核心身份与设定 (Core Identity)                                      │
│   §2 情感动力学与性格特质 (Emotional Dynamics)                           │
│   §3 语言风格与台词铁律 (Speech Style Rules)                             │
│   §4 潜变量内心独白模式 (Latent <OS> Patterns，含非读心铁律)              │
│   §5 标志性动作与习惯 (Behavioral Habits)                                │
│   §6 反 OOC 负向约束 (Anti-OOC Constraints)                              │
│   §7 单层情景记忆索引 (In-Context MemoryIndex — 场景 1 .. x-1)           │
│   §8 对话交互准则 (Interaction Protocol)                                 │
├──────────────────────────────────────────────────────────────────────────┤
│ 动态回合用户提示词 (随场景 x 内每个回合或微批次动态变化)                 │
│   - 当前训练/交互场景元信息 (sceneId, title, setting)                    │
│   - 本场景已发生对话上文 (Intra-Scene History，最近 <= 12 个对齐回合)     │
│   - 当前待预测回合输入 Input_t (或微批次输入列表)                        │
└──────────────────────────────────────────────────────────────────────────┘
```

当 `syncAgentOnDisk` 开启时，`buildStudentReactPrompt` 自动将 `includeInlinePersonaAndMemory` 设为 `false`，不再向 User Prompt 重复拷贝人格与记忆列表，仅保留一行轻量引用提示。

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 形式化认知前向方程与视角投影算子

设 $`\text{Input}_t`$ 为回合 $`t`$ 之前累积的非目标角色原始剧本行序列。定义**可观测视角投影算子（Observable Perspective Projection Operator）** $`\Pi_{\text{obs}}`$：

```math
\Pi_{\text{obs}}(\text{Input}_t) = \text{Filter}_{\text{observable}}(\text{Input}_t)
```

该算子在语义层面剥离 `[旁白]` 中属于其他角色的未公开内心活动，仅保留伴侣角色在物理场景中可见的动作神态、环境状态与可听见的公开对白。

给定当前结构化人格 $`P_{u,v}`$、前序场景累积的单层记忆索引 $`I_{\lt v} = \lbrace \text{MemoryIndex}_{0,1}, \dots, \text{MemoryIndex}_{0,v-1} \rbrace`$ 以及当前场景内的有界滑动历史 $`H_t = \lbrace \text{MemoryItem}_{\max(1, t-K)}, \dots, \text{MemoryItem}_{t-1} \rbrace`$（默认滑动窗口上限 $`K = 12`$），两阶段认知前向分布定义为：

```math
\text{OS}_t \sim \pi_{\text{OS}}\big(\cdot \;\big|\; \Pi_{\text{obs}}(\text{Input}_t), \; P_{u,v}, \; I_{\lt v}, \; H_t\big)
```

```math
\text{Action}_t \sim \pi_{\text{Act}}\big(\cdot \;\big|\; \text{OS}_t, \; \Pi_{\text{obs}}(\text{Input}_t), \; P_{u,v}, \; I_{\lt v}, \; H_t\big)
```

#### 确定性输出解析与降级层次（`parseStudentTurnOutput`）

为确保在不同基座模型与推理深度（`thinkingLevel`）下均能稳健提取结构化输出，`parseStudentTurnOutput(rawText)` 实现三级解析文法：
1. **一级 XML 标签提取**：正则匹配 `/<OS>([\s\S]*?)<\/OS>/i` 与 `/<Action>([\s\S]*?)<\/Action>/i`；当两者均非空时标记 `formatValid = true`。
2. **二级 JSON 结构回退**：若未检测到 XML 标签，则尝试解析 JSON 对象 `{ "os": "...", "action": "..." }`（在微批次前向预测中，模型原生输出 `{ turnId, os, action }` 数组）；字段齐全时同样标记 `formatValid = true`。
3. **三级容错保底回退**：若上述格式均未命中，则提取残缺标签或回退为默认观察态 `<OS>`，并将剥离 `<OS>` 后的剩余文本作为 `action`，同时标记 `formatValid = false` 以供消融实验统计格式遵循率。

---

### 2. 核心 TypeScript 类型契约

`@prism-shadow/ema`（位于 `packages/ema/src/training/types.ts`）中实现的规范化数据结构定义如下：

```typescript
export interface CompanionPersonality {
  /** 版本标识，例如 "P_0_0", "P_0_1", "P_1_0" */
  version: string;
  /** 目标伴侣角色名称 */
  name: string;
  /** 核心身份、背景世界观以及与对手方（Protagonist）的关系定位 */
  coreIdentity: string;
  /** 角色原型与多情境情感动力学规律 */
  emotionalDynamics: string[];
  /** 具象语言风格铁律、句长约束与标志性口癖 */
  speechStyleRules: string[];
  /** 连接 Input -> Action 的潜变量 <OS> 内心独白认知规律（含非读心视角边界） */
  cognitiveOSPatterns: string[];
  /** 标志性肢体动作与行为习惯 */
  behavioralHabits: string[];
  /** 经 Teacher RSI 错误诊断累积的反 OOC 负向约束 */
  antiOocConstraints: string[];
  /** 跨训练窗口的人格演化审计日志 */
  mutationHistory: Array<{
    fromVersion: string;
    toVersion: string;
    sceneId: string;
    reason: string;
    scoreBefore: number;
    scoreAfter?: number;
  }>;
}

export interface MemoryItem {
  turnId: string;
  sceneId: string;
  turnIndexInScene: number;
  inputText: string;
  /** Student 预测的潜变量 OS_t */
  predictedOS: string;
  /** 经 Teacher 校验确认或修正后写入记忆的真实潜变量 OS_t^* */
  committedOS: string;
  /** Student 预测的 Action_t（仅用于评分，不进入后续历史轨迹） */
  predictedAction: string;
  /** 经 Teacher-Forcing 强制对齐并写入历史轨迹的 Ground Truth Action_t^* */
  gtActionText: string;
  /** predictedOS 与 gtActionText 在心理逻辑上是否自洽 */
  osConsistent: boolean;
  /** Teacher 对 OS 一致性与心理深度的评分 (0-100) */
  osScore: number;
  /** Teacher 对 Action 还原度（语调、句长、潜台词、动作习惯）的评分 (0-100) */
  actionScore: number;
  /** 加权综合回合得分 (0.4 * osScore + 0.6 * actionScore) */
  combinedScore: number;
  /** Teacher 出具的简短偏差诊断或准确度点评 */
  diagnostic: string;
}

export interface SceneMemoryIndexItem {
  sceneId: string;
  order: number;
  chapter: string;
  title: string;
  setting: string;
  /** 以目标角色第一人称（「我」）浓缩的场景核心摘要（<= 140 字） */
  summary: string;
  /** 目标角色在该场景中的潜变量内心情感弧线（<OS> 轨迹，<= 60 字） */
  innerOSArc: string;
  /** 后续场景必须铭记的关键事实、设定或约定（1～3 条） */
  keyFacts: string[];
  /** 可选的底层原始 MemoryItem 归档引用指针，支持按需解压回溯 */
  archiveRef?: string;
  /** 闭环可重构性评测得分 R(MemoryIndex_{0,x}, w_x) in [0, 100] */
  reflectionScore?: number;
}

export interface CompressionPromptConfig {
  version: string;
  instructions: string;
  maxSummaryChars: number;
  maxKeyFacts: number;
}
```

---

### 3. 闭环可重构性度量 $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$ 与压缩器训练

设场景 $`x`$ 经 Teacher 校准后的原子记忆序列为 $`w_x = \lbrace \text{MemoryItem}_{x,1}, \dots, \text{MemoryItem}_{x,L_x} \rbrace`$，压缩算子在配置 $`C`$ 下生成的单条索引为 $`\text{MemoryIndex}_{0,x} = \text{compress}_C(w_x)`$。

闭环可重构性评分函数 $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) \in [0, 100]`$ 由 `reflect` 评测器通过对比压缩后的 $`\text{MemoryIndex}_{0,x}`$ 与原场景真实片段样本计算得出：

```math
\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) = w_{\text{event}} \cdot r_{\text{event}} + w_{\text{os}} \cdot r_{\text{os}} + w_{\text{fact}} \cdot r_{\text{fact}} - p_{\text{halluc}}
```

其中四个评估维度分别为：
- $`r_{\text{event}} \in [0, 40]`$（**第一人称事件重构度**）：`summary` 是否以鲜活的第一人称视角准确还原了场景的核心冲突、关键互动与时空背景；
- $`r_{\text{os}} \in [0, 30]`$（**潜变量 `<OS>` 情感弧线保真度**）：`innerOSArc` 是否保留了伴侣在该场景中真实的内心情绪转折 $`\text{committedOS}_{x,1 \dots L_x}`$，而非退化为空洞的套话；
- $`r_{\text{fact}} \in [0, 30]`$（**长程事实锚点留存率**）：`keyFacts` 是否完整提取了后续跨场景推理所需的特殊物品、人物身份或重要约定；
- $`p_{\text{halluc}} \in [0, 100]`$（**幻觉惩罚项**）：一旦压缩条目捏造了与原场景 $`w_x`$ 冲突的事实，立即予以重扣。

当 $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$ 低于阈值或诊断字段 `missingDetail` 指出系统性遗漏时，Teacher 在严格锁定字数上限（`maxSummaryChars = 140`、`maxKeyFacts = 3`）的前提下迭代优化 `CompressionPromptConfig.instructions`（$`C_{u,v} \to C_{u,v+1}`$），从而在不增加上下文体积的约束下最大化信息密度。

---

### 4. 前缀 KV 缓存复杂度与成本分析

设渲染后的 `AGENTS.md` 系统前缀长度为 $`L_{\text{sys}} = |P_{u,v}| + |I_{\lt v}|`$（典型值为 $`4000\text{--}6000`$ Tokens），单个回合或微批次的动态上下文长度为 $`L_{\text{turn}}`$（典型值为 $`400\text{--}800`$ Tokens）。在一个包含 $`M`$ 次前向调用的场景窗口中：

- **朴素双重注入方案（System + User Prompt Inline 重复注入）**：
  每次调用均需处理 $`2 L_{\text{sys}} + L_{\text{turn}}`$，且动态拼接破坏前缀缓存对齐；
- **单源 `AGENTS.md` 前缀注入方案（`includeInlinePersonaAndMemory = false`）**：
  首次调用将 $`L_{\text{sys}}`$ 写入缓存（$`1 \times \text{cacheWrite}`$），后续 $`M - 1`$ 次调用全部以极低成本命中缓存读取（$`(M - 1) \times \text{cacheRead}`$），仅动态部分 $`L_{\text{turn}}`$ 产生新 Token 写入。

以 $`L_{\text{sys}} = 5000`$、$`L_{\text{turn}} = 500`$、$`M = 10`$ 为例，单源前缀注入的理论与实测 KV 缓存命中率达：

```math
\eta_{\text{cache}} = \frac{(M - 1) \cdot L_{\text{sys}}}{M \cdot (L_{\text{sys}} + L_{\text{turn}})} \approx \frac{45000}{55000} \approx 81.8\% \text{ 至 } 93.5\%
```

在支持前缀缓存的模型服务上，这直接将长程训练与日常陪伴的输入 Token 成本降低近一个数量级。

---

## Invariants
[invariants]: #invariants

### non-mind-reading-perspective-boundary

> **伴侣在生成潜变量内心独白 `<OS>` 与外显反应 `<Action>` 时，必须严格以物理场景中可观测的公开台词、动作神态与环境状态为条件，绝不回应或复述其他角色在第一人称旁白中未说出口的内心活动。**

叙事剧本常在 `[旁白]` 中向读者展示主角的私密心理。若伴侣越界回应未公开的内心独白，两个独立心智之间的因果边界将彻底崩塌，导致严重的角色扮演穿帮。

### dual-mode-latent-os-framing

> **伴侣的每一次交互响应必须遵循 $`\text{Input}_t \to \text{OS}_t \to \text{Action}_t`$ 的两阶段认知跃迁：在监督训练与评测中显式具象为 `<OS>` 与 `<Action>` 标签，在日常陪伴交互中则内化于模型的原生 `thinking` 通道与可见回复流。**

保持训练期与运行期认知拓扑的严格同构，能够确保离线 RSI 训练提炼出的 `cognitiveOSPatterns` 在日常对话中持续生效，同时避免向终端用户泄露生硬的训练标签。

### single-source-prefix-canonicality

> **当 `AGENTS.md` 状态同步开启时，`CompanionPersonality`（$`P_{u,v}`$）与单层 `MemoryIndex`（$`M_{u,v}`$）必须仅通过 `AGENTS.md` 系统提示词前缀单源注入一次，严禁在回合级 User Prompt 中重复内联拷贝。**

单源前缀唯一性消除了系统指令与用户提示词之间的潜在版本冲突，避免了双倍 Token 消耗，并通过字节级恒定的系统前缀保障 $`\gt 90\%`$ 的 KV 缓存复用率。

### first-person-episodic-reconstructibility

> **单层 `MemoryIndex` 中的每个 `SceneMemoryIndexItem` 必须以伴侣第一人称（「我」）撰写，完整包含受字数预算约束的 `summary`、`innerOSArc` 与 `keyFacts`，且其压缩质量由闭环可重构性得分 $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$ 唯一裁定。**

第三人称客观摘要会抹杀伴侣对共同经历的主观情感体验（`innerOSArc`）；而将严格的字数上限与闭环 `reflect` 评分相结合，则能同时防止关键伏笔遗失与上下文无界膨胀。

---

## Drawbacks
[drawbacks]: #drawbacks

1. **极轻量模型在低推理深度下的格式遵循脆弱性**：
   部分小参数模型在 `thinking_level: low` 下进行单回合生成时，偶发遗漏闭合标签 `</OS>` 或 `</Action>`。
   - *缓解措施*：`parseStudentTurnOutput` 内置了「XML 标签 $`\to`$ JSON 解析 $`\to`$ 正则切分保底」的三级容错解析器，且在 [RFC-0005](RFC-0005-script-to-persona-memory-training.zh.md) 的基座消融基准中显式引入 `formatSuccessRate` 指标，优先筛选格式遵循率 $`\ge 99\%`$ 的模型配置。

2. **超长生命周期下（数千场景）的单层索引容量上限**：
   尽管 100～200 个场景的单层 `MemoryIndex`（约 4k Tokens）可轻松常驻现代大模型的上下文窗口，但在持续数年的真实陪伴中累积上千个场景后，全量驻留仍会逼近上下文预算。
   - *缓解措施*：`buildStudentReactPrompt` 支持对活跃 `MemoryIndex` 进行滑动窗口截取，同时保留完整的 `AGENTS.md` 归档与 `archiveRef` 指针，为未来按需引入二级归档折叠留出无损接口。

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### 为什么采用六槽位结构化 `CompanionPersonality`，而非自由格式的 Markdown 角色卡？

在自由格式的文本角色卡上，每当 Teacher 针对某幕场景的低分表现重写人格时，模型极易在修补情感态度的同时意外删掉句长控制规则，或用当前特殊场景的临时指令覆盖角色的核心身份。将 `CompanionPersonality` 拆分为六个强类型槽位（`coreIdentity`、`emotionalDynamics`、`speechStyleRules`、`cognitiveOSPatterns`、`behavioralHabits`、`antiOocConstraints`），使 [RFC-0005](RFC-0005-script-to-persona-memory-training.zh.md) 中的保锚点合并算子（`mergeWithAnchors`）能够按槽位锁定核心初始设定，在数十次迭代演化中彻底杜绝结构退化。

### 为什么在 `SceneMemoryIndexItem` 中强制保留 `innerOSArc`？

另一种常见替代方案是仅在记忆库中存储客观事实三元组 `(主体, 谓词, 客体)`。实验表明，纯客观事实无法支撑长程情感连贯性：仅仅记住“我与 Bob 去过钟楼天台”，并不能告诉模型“我在那次独处中从戒备转向安心”的心境变化。将 `innerOSArc` 与 `summary`、`keyFacts` 并列存储，使跨场景的情感因果链得以完整延续。

---

## Prior art
[prior-art]: #prior-art

- **Chain-of-Thought (Wei et al., 2022) 与隐式心理草稿纸（Scratchpad）**：证明了显式中间推理步骤对复杂生成任务的增益；本 RFC 将通用逻辑推理特化为受视角边界约束的第一人称心理状态跃迁 `<OS>`。
- **MemGPT 与上下文虚拟内存管理（Packer et al., 2023）**：提出将长短期记忆显式分层管理；本 RFC 结合现代 LLM 的高性价比前缀 KV Cache 特性，优先以全量驻留的单层高密度 `MemoryIndex` 消除复杂的跨层检索损耗。
- **自编码器重构损失（Autoencoder Reconstruction Loss）**：通过解码器（`reflect`）从压缩隐表示 $`\text{MemoryIndex}_{0,x}`$ 重构原输入 $`w_x`$ 的保真度来监督编码器（`compact`）优化。

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **线上陪伴中按需解压原始归档（`archiveRef`）的触发准则**：当用户在日常聊天中追问数十个场景之前的某句具体对话原话时，伴侣 Agent 应当依据何种置信度判据自动触发针对 `archiveRef` 的按需解压？
- **跨轮训练中压缩算子 $`C`$ 与人格 $`P`$ 的交替更新步频**：当同时放开 $`P`$ 与 $`C`$ 的演化时，两者应当按何种频率交替更新以保持优化稳定？（从剧本逆向蒸馏 $`P`$ 与 $`M`$ 的完整算法详见姊妹规范 [RFC-0005](RFC-0005-script-to-persona-memory-training.zh.md)。）

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **按需情景解压工具（`recall_scene_archive`）**：允许线上伴侣 Agent 在需要深度回忆某个具体场景细节时，根据 `SceneMemoryIndexItem.sceneId` 与 `archiveRef` 即时调阅该场景底层的 `<Input, committedOS, Action>` 完整序列。
- **多模态感官记忆锚点**：在 `SceneMemoryIndexItem` 中扩展画面构图（CG 视觉锚点）与语音语调特征，支撑多模态伴侣交互。

---

## Changes

### v1.0.0

- 初始版本：正式规范两阶段潜变量认知前向方程（$`\text{Input}_t \to \text{OS}_t \to \text{Action}_t`$）、非读心视角边界铁律、六槽位结构化 `CompanionPersonality` Schema、`AGENTS.md` 单源前缀注入机制、`MemoryItem` 与单层 `SceneMemoryIndexItem` 数据结构，以及基于 `compact` + `reflect` 的闭环可重构性评测度量 $`\mathcal{R}`$。
