# RFC-0003 EMA 训练元理论（Meta-Theory of EMA Training）

[English](RFC-0003-ema-training-meta-theory.md)

- Feature Name: `ema-training-meta-theory`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: Pending

> **状态与出处**：
> - 状态: draft（董事会审阅草案）
> - 修订: v1.0.0

## Summary
[summary]: #summary

本 RFC 阐述 EverMemoryArchive（EMA）伴侣智能体的**训练元理论（Meta-Theory of EMA Training）**：定义一套从长序列交互或剧本轨迹数据 $D$ 中，通过递归自我改进（RSI, Recursive Self-Improvement）联合演化伴侣的**人格（Personality, $P$）**、**记忆库与索引（Memory, $M$）**以及**记忆压缩算子（Compression Operator, $C$）**的数学与认知理论框架。

本元理论拒绝因工程实现难度或算力妥协而阉割认知完备性，将伴侣的内部认知建模为由隐式心理状态（$\text{OS}$）中介的生成过程（$\text{Input} \to \text{OS} \to \text{Action}$），并提出「冷启动无损累积 $\to$ 窗口化记忆压缩（Compact）与人格协同演化 $\to$ 局部题集贪心寻优与状态向量 $\{P_{u,v}', M_{u,v}'\}$ 传递 $\to$ 全局多轮（Multi-Epoch）轨迹择优」的完整闭环。同时，本 RFC 确立了后续两篇具象化姊妹规范的演进边界：**RFC-0004**（第一版基于单级 In-Context Memory-Index + OS 的人格与记忆建模及训练评分机制）与 **RFC-0005**（第一版从剧本逆向蒸馏记忆格式与人格参数的联合算法）。

---

## Motivation
[motivation]: #motivation

### 1. 不以工程难度掣肘研究视野：从第一性原理定义伴侣训练

在构建能够共同成长、记忆与演化的一生伴侣时，现有的角色扮演与记忆系统往往陷入过早的工程折中：用静态撰写的角色卡替代可演化的人格，用固定启发式摘要或盲目的向量 Top-$K$ 检索替代可训练的记忆压缩机制。一旦面对长跨度剧本（如 $2000+$ 回合的视觉小说或长期真实伴侣对话），这类静态方案便会出现严重的性格漂移（OOC）、伏笔遗忘与因果断裂。

因此，EMA 需要首先在元理论（Meta-Theory）层面回答：**如果不被单步实现难度所掣肘，一个理想的伴侣认知体应当如何从观测轨迹中同时习得「我是谁（$P$）」、「我经历并记住了什么（$M$）」以及「我该如何浓缩与回忆过往（$C$）」？**

### 2. 观测数据的隐变量鸿沟：$\text{Input} \to \text{OS} \to \text{Action}$

无论是文学剧本、Galgame 语料还是人类真实聊天记录，外部可观测的数据仅包含「环境与他人输入（$\text{Input}_t$）」以及「角色的外部反应或台词（$\text{Action}_t^*$）」，而极少完整记录角色在每一瞬间的**内心变化与潜台词（$\text{OS}_t$）**。

如果直接训练模型学习 $\text{Input}_t \to \text{Action}_t^*$ 的表面映射：
- 模型只能模仿表层句式，无法理解同一句话在不同心境（如害羞敷衍 vs. 真正动怒）下的截然不同动机；
- 写入记忆库的只是干瘪的客观流水账，缺乏第一人称的心理因果链。

唯有显式引入隐变量 $\text{OS}_t$（内心状态变化），令伴侣先基于人格 $P$ 与记忆 $M$ 产生 $\text{OS}_t$，再由 $\text{OS}_t$ 驱动 $\text{Action}_t$，并通过 Teacher 对照真实反应 $\text{Action}_t^*$ 进行对抗校验与强制对齐（Teacher Forcing），才能把扁平的观测文本还原为立体的认知轨迹 $\text{MemoryItem} = \langle \text{Input}, \text{OS}, \text{Action} \rangle$。

### 3. 人格 $P$、记忆 $M$ 与压缩算法 $C$ 的内生耦合性

伴侣的记忆并非独立于人格的客观录像带，而是**经验在特定人格透镜下的主观投射**：
$$\text{Memory} = f_C(D, P)$$
- 当人格 $P$ 发生变化时，伴侣面对同一历史事件 $\text{Input}_t$ 所生成的内心活动 $\text{OS}_t$ 随之改变，进而导致写入记忆的 $\text{MemoryItem}_t$ 发生改变；
- 当记忆压缩算法 $C$（其本身也是一个 Agent 的 Prompt）发生变化时，从一组场景记忆 $\{\text{MemoryItem}_n\}$ 提炼出的记忆索引 $\text{MemoryIndex}_{0,x} = \text{compress}_C(\{\text{MemoryItem}_n\})$ 也会改变，直接决定后续回合能否准确回溯（Reflect / Decompress）过往细节。

因此，人格 $P$、记忆 $M$ 与压缩算子 $C$ 本质上是同一个动力系统中的耦合变量，必须在同一套训练元理论下协同优化。

### 4. 超长序列中的信用分配：窗口化 Compact 与局部寻优

在包含 $2000+$ 道题目的长序列数据集 $D$ 上，如果等到整轮 2000 题全部答完才由 Teacher 调整一次人格 $P$，早期错误的 $P$ 不仅会在数千步中持续拉低得分，更会污染沿途生成的所有 $\text{OS}$ 与记忆索引。

通过将训练过程按上下文窗口切分，利用每次记忆压缩（`compact`）的契机迭代调整人格 $P_{u,v} \to P_{u,v+1}$，并允许 Teacher 在局部题集 $[X, Y]$ 上反复重训直到取得局部最优状态向量 $\{P_{u,v}', M_{u,v}'\}$，可以将超长程信用分配拆解为可收敛的局部子问题。

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. 核心概念原语

在 EMA 训练元理论中，长程伴侣训练由以下六个核心概念构成：

1. **序列题库（Sequential Dataset, $D$）**：
   将源剧本或长交互历史清洗为按因果时序排列的 $T$ 道题目（例如 $T = 2000+$）：
   $$D = \{q_1, q_2, \dots, q_T\}, \quad q_t = (\text{Input}_t, \text{Action}_t^*)$$
   其中 $\text{Input}_t$ 为目标伴侣角色发生动作或对话之前的可观测上下文序列，$\text{Action}_t^*$ 为原著/真实轨迹中的 Ground Truth 动作与台词。

2. **隐式内心变化（Latent Inner State, $\text{OS}_t$）**：
   EMA Agent 在接收 $\text{Input}_t$ 后，结合当前人格 $P$ 与记忆 $M$ 生成的内部心理状态更新（例如 `<set_os>震惊、警觉护主</set_os>`），用于驱动随后的外部行为预测 $\text{Action}_t$。

3. **原子记忆项（Episodic Memory Item, $\text{MemoryItem}_t$）**：
   单步交互完成并经 Teacher 校验后，将输入、Agent 的 $\text{OS}_t$ 以及**强制对齐为 Ground Truth 的动作 $\text{Action}_t^*$** 封装为三元组：
   $$\text{MemoryItem}_t = \langle \text{Input}_t, \text{OS}_t, \text{Action}_t^* \rangle$$

4. **单级记忆索引与压缩算子（Single-Level Memory Index & Compression Operator, $C$）**：
   当上下文中的原始历史达到窗口或场景边界时，由压缩 Agent（Prompt 策略 $C$）将该场景的一组原始记忆项 $\{\text{MemoryItem}_n\}$ 压缩为带丰富注解（Annotations）的单级上下文记忆索引：
   $$\text{MemoryIndex}_{u,x} = \text{compress}_C(\{\text{MemoryItem}_n\})$$
   在当前研究阶段，我们无需引入复杂的多级金字塔，仅维护**单级（Single-Level）可反射/可解压的 `MemoryIndex`** 即可覆盖长程叙事需求。

5. **耦合认知状态向量（Coupled State Vector, $\mathbf{s}_{u,v} = \{P_{u,v}, M_{u,v}\}$）**：
   在第 $u$ 轮（Epoch $u$）、第 $v$ 个压缩窗口（Window $v$）处，Teacher 与 Agent 共同持有的演化状态。其中 $P_{u,v}$ 为当前人格描述，$M_{u,v}$ 为在 $P_{u,v}$ 轨迹下生成的累计记忆索引与底层条目。

6. **教师智能体（Teacher Agent）**：
   掌握 Ground Truth $\text{Action}_t^*$ 与全局评估准则的元优化器（Meta-Optimizer），负责初始化人格 $P_{0,0}$、评估每步 $(\text{OS}_t, \text{Action}_t)$ 的契合度并打分、在 `compact` 边界与局部窗口内迭代修正人格 $P$（及压缩策略 $C$）。

---

### 2. 训练生命周期全景（RSI Training Loop）

```
Dataset D = {q_1, q_2, ..., q_T}  (T = 2000+ Sequential Questions)
=======================================================================================

[Phase 0: 初始化]
  Teacher 生成初始人格 P_{0,0}，初始长程记忆 M_{0,0} = ∅

[Phase 1: 冷启动窗口 q_{1..N}（不计分 / Unscored Warmup）]
  Context = (Personality: P_{0,0}, Memory: ∅, History: raw q_{1..t-1})
  对 t = 1..N:
    1. Input_t ──(P_{0,0}, History)──> 生成 OS_t ──> 预测 React_t
    2. 强制覆盖 Action_t = GT_Action_t，追加 History += MemoryItem_t <Input_t, OS_t, GT_Action_t>
  ──> 触发第一次 Compact:
        MemoryIndex_{0,1} = compress(History_{1..N})
        Teacher 根据 1..N 表现调整人格: P_{0,0} ──> P_{0,1}

[Phase 2: 窗口化答题与局部贪心寻优 q_{X..Y}（计分 + Local RSI）]
  进入窗口 [X..Y]，持有状态向量 {P_{u,v}, M_{u,v}}:
    ┌───────────────────────────────────────────────────────────────────────┐
    │ 1. 使用 Context = (P_{u,v}, MemoryIndex, History) 答第 X..Y 道题       │
    │ 2. Teacher 评测得分 Score(X..Y; P_{u,v})（例如得 50 分）               │
    │ 3. [Local Optimization Loop]:                                         │
    │    若分数不理想，Teacher 立即诊断错题并变异出 P_{u,v}'                 │
    │    回滚至第 X 题重新作答 X..Y ──> 得分提升至 75 分                     │
    │ 4. 基于局部最优解 P_{u,v}' 的轨迹执行 Compact，产出 M_{u,v}'           │
    └───────────────────────────────────────────────────────────────────────┘
  ──> 向下一窗口 [Y..Y+Z] 传递局部最优状态向量 {P_{u,v}', M_{u,v}'}

[Phase 3: 单轮收尾与多轮全局演化 (Epoch u = 0..n)]
  答完 2000+ 题 ──> 得到 P_{0, m_0} 与 Memory_0 = f(D, P_0)
  Teacher 多轮迭代训练 u = 1..n ──> 得到 P_{n, m_n} 与 Memory_n = f(D, P_{n, m_n})
  最终输出全局最高分状态: (P*, Memory*) = argmax Score(D; P_{u, m_u}, Memory_u)
```

#### (1) 单步前向与 Teacher 校验示例

以目标伴侣角色（角色 A）面对陌生人情绪失控暴走的一幕为例：

1. **输入构造（Inputs）**：提取角色 A 动作前的可观测内容：
   ```xml
   <Input> <name>陌生人</name> 连最重要的记忆都……遗忘了…… </Input>
   <Input> <name>陌生人</name> 我……我究竟是谁…… </Input>
   <Input> <name>陌生人</name> 啊啊……啊啊啊啊……！ </Input>
   ```
2. **Agent 推理（OS $\to$ React）**：
   - Agent 依据当前人格 $P_{u,v}$、常驻 `MemoryIndex` 与近期 `History`，首先生成内心状态变化：
     `set_os("震惊且警觉：眼前的陌生人彻底失控即将暴走，必须立刻护在同伴身前")`
   - 随后基于该 `os` 生成外部反应 `react`（例如：`「危险，快退到我身后！」`）。
3. **Teacher 判别与强制对齐（Teacher Check & Override）**：
   - Teacher 拿到 Ground Truth：`「小心，快退后！」`（以及紧邻动作描写：*角色 A 迅速对异常做出反应，挡在同伴身前*）。
   - Teacher 对比 Agent 的 `os` 与 Ground Truth：
     - **情况 A（`os` 与 GT 不契合）**：例如 Agent 的 `os` 是“害怕地躲起来”，这与 GT 中角色 A 挺身而出保护同伴的行为相悖 $\to$ 标记需要调整人格（`adjust_personality`）。
     - **情况 B（`os` 与 GT 契合）**：进一步检查 `react` 是否与 GT Action 相似。此处**只要求语义与行为意图合理即可**，不要求字面完全一致。
   - **状态提交**：保留契合的 `os`，将外部动作**强制覆盖（Override）**为 Ground Truth Action，向当前窗口追加一行记忆：
     $$\text{MemoryItem}_t = \{\text{inputs}, \text{os}, \text{actions} = \text{GT\_Action}\}$$
   - 进入下一题 $t+1$。

#### (2) 冷启动期（前 $N$ 道题）与首次 Compact

- 在训练刚开始的前 $N$ 道题（$q_{1\dots N}$），由于上下文长度完全充裕，此时不需要任何压缩记忆（$\text{Memory} = \varnothing$），直接将完整的 `History` 放在 Context 中运行，生成第一批 $\text{OS}$ 与 $\text{MemoryItem}$。
- **这前 $N$ 道题作为冷启动预热（Warmup），不计入评估总分**。
- 当到达第 $N$ 题触发首次 `compact` 时：
  - 压缩算子将前 $N$ 题的 `MemoryItem` 序列压缩为 $\text{MemoryIndex}_{0,1}$；
  - Teacher 借此机会汇总前 $N$ 题的偏差，将初始人格 $P_{0,0}$ 升级为 $P_{0,1}$。
- 从第 $N+1 \dots M$ 道题开始，Agent 的 Context 切换为标准形态：
  $$\text{Context} = (\text{personality} = P_{0,1}, \; \text{memory\_index} = \text{MemoryIndex}_{0,1}, \; \text{history})$$
  并正式开始计分评测。

#### (3) 局部题集反复训练与状态向量传递（Local Optimization）

如果僅做单次前向扫描，一旦 $P_{u,v}$ 在某个新剧情阶段表现不佳，错误会一路累积。因此引入**局部窗口重训机制**：

- 不失一般性，假设 Agent 正在回答第 $X \dots Y$ 道题，使用当前人格 $P_{u,v}$ 拿到的窗口得分为 **50 分**。
- Teacher 不必等到第 2000 题结束，而是**立即针对第 $X \dots Y$ 道题的错题反馈修改人格得到 $P_{u,v}'$，并回滚到第 $X$ 题拿着 $P_{u,v}'$ 重新答题**，将得分提升至 **75 分**。
- 尽管 $P_{u,v}'$ 未必是全局 2000 道题的理论最高分，但它成为了 $[X, Y]$ 这个局部题集的临时最优解，且其配套生成的内心轨迹与压缩记忆 $M_{u,v}'$ 质量显著优于 50 分时的版本。
- 当进入下一段第 $Y \dots Y+Z$ 道题时，Teacher 手里持有的不再是孤立的参数，而是联合优化后的状态向量（或候选束 Vector）：
  $$\mathbf{v}_{u,v} = \{P_{u,v}', M_{u,v}'\}$$

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 元理论的形式化优化目标

设完整题库 $D = \bigcup_{v=0}^{m} W_v$ 被划分为冷启动窗口 $W_0 = \{q_1, \dots, q_N\}$ 与 $m$ 个计分评估窗口 $W_1, \dots, W_m$。

对于任意计分题 $q_t \in W_v$（$t > N$），给定当前人格 $P$、前序窗口累计生成的单级记忆索引 $I_{<v} = \{\text{MemoryIndex}_{u,1}, \dots, \text{MemoryIndex}_{u,v-1}\}$ 以及当前窗口内的近期历史 $H_t = \{\text{MemoryItem}_{X}, \dots, \text{MemoryItem}_{t-1}\}$：

1. **前向生成（Forward Generation）**：
   $$\text{OS}_t = g_{\text{OS}}(\text{Input}_t \mid P, I_{<v}, H_t)$$
   $$\hat{A}_t = g_{\text{Act}}(\text{Input}_t, \text{OS}_t \mid P, I_{<v}, H_t)$$

2. **教师评分函数（Teacher Scoring Function）**：
   Teacher 依据真实反应 $A_t^*$ 对预测结果 $(\text{OS}_t, \hat{A}_t)$ 进行评分：
   $$s_t = \mathcal{E}(\text{OS}_t, \hat{A}_t, A_t^*) \in [0, 100]$$
   其中评分准则优先校验 $\text{OS}_t$ 与 $A_t^*$ 的心理动机契合度（Consistency），在契合的前提下评估 $\hat{A}_t$ 与 $A_t^*$ 的行为合理性与角色风格相似度（Plausibility & Persona Fidelity）。

3. **轨迹锚定与记忆写入（Teacher-Forced Commit）**：
   $$\text{MemoryItem}_t \leftarrow \langle \text{Input}_t, \text{OS}_t, A_t^* \rangle, \quad H_{t+1} \leftarrow H_t \cup \{\text{MemoryItem}_t\}$$

4. **窗口压缩算子（Window Compaction Operator）**：
   在窗口 $W_v$ 结束时，压缩 Agent 依据压缩提示词策略 $C$ 将该窗口（或场景）内的记忆项序列压缩为索引项：
   $$\text{MemoryIndex}_{u,v} = \text{compress}_C(H_{W_v})$$
   从而构成更新后的记忆状态 $M_{u,v} = M_{u,v-1} \cup \{\text{MemoryIndex}_{u,v}\}$。

5. **全局目标函数（Global Objective）**：
   跨多轮训练 $u \in \{0, 1, \dots, n\}$，寻找使全部计分题（$t > N$）得分最大化的最优点：
   $$(P^*, M^*, C^*) = \arg\max_{(P_{u,m_u}, M_u, C_u)} \frac{1}{T - N} \sum_{t=N+1}^{T} \mathcal{E}\big(\text{OS}_t(P, M, C), \hat{A}_t(P, M, C), A_t^*\big)$$

---

### 2. 可训练的记忆压缩算子 $C$（Trainable Compression via Reflection Score）

在本元理论中，生成 $\text{MemoryIndex}_{0,x} = \text{compress}_C(\{\text{MemoryItem}_n\})$ 的算法本身是一个 Agent 的 Prompt $C$，因此 **$C$ 同样是可训练（Trainable）的策略参数**：

- **压缩评估准则（Reflective Reconstruction Score）**：
  衡量一个 $\text{MemoryIndex}_{0,x}$ 好坏的客观分数，取决于 Agent 仅凭 $\text{MemoryIndex}_{0,x}$（及其注解与解压机制）**反射还原（Reflect）出原场景核心内容的能力**：
  $$S_{\text{compress}}(C) = \mathcal{R}\Big(\text{reflect}\big(\text{MemoryIndex}_{0,x}\big), \; \{\text{MemoryItem}_n\}\Big) + \lambda \cdot \Delta S_{\text{downstream}}\big(\text{MemoryIndex}_{0,x}\big)$$
  - 第一项衡量从压缩索引逆向恢复关键事实、人物关系变化与内心 $\text{OS}$ 转折的保真度；
  - 第二项衡量该索引在后续依赖该历史场景的题目上带来的答题分数增益。
- 当下游题目因历史信息丢失而答错时，Teacher 不仅可以修正人格 $P$，还可以优化压缩算子 $C$ 的 Prompt 或直接修补 $\text{MemoryIndex}_{0,x}$ 的注解。

---

### 3. 固定人格逆向记忆 vs. 动态人格联合逆向（通往 RFC-0004 与 RFC-0005 的桥梁）

本元理论揭示了伴侣训练中的一组核心对偶关系，并以此划分后续两篇 RFC 的研究边界：

| 规范编号 | 核心命题 | 固定变量与优化变量 | 理论意义 |
| --- | --- | --- | --- |
| **RFC-0003（本篇）** | **EMA 训练元理论（Meta-Theory of EMA Training）** | 定义 $\Theta = (P, M, C)$ 联合演化空间、Warmup/Compact 周期、局部与全局 RSI 循环 | 确立不被工程难度束缚的元学习范式与数学收敛框架 |
| **RFC-0004** | **第一版人格与记忆建模（In-Context Memory-Index + OS）** | 规范 $\text{Input} \to \text{OS} \to \text{Action}$、$\text{MemoryItem}$、单级 $\text{MemoryIndex}_{0,x} = \text{compress}(\text{Scene})$ 及基于 Reflect 能力的压缩训练 | 解决单级上下文记忆索引的表征、解压与压缩器自身的训练评估 |
| **RFC-0005** | **第一版剧本到人格+记忆逆向算法（Script-to-Persona & Memory）** | **模式 A（固定 $P$）**：训练/逆向出最优记忆格式与索引内容；<br>**模式 B（闭环调 $P$）**：在 Loop 中同时调整并逆向出角色人格 $P$ 与记忆 $M$ | 将「从剧本提取角色灵魂与经历」转化为可严格度量分数的逆问题求解 |

具体而言：
- **当固定高质量人格 $P$ 时**：训练闭环退化为对记忆通道 $(M, C)$ 的纯粹压力测试——唯有当记忆格式与 $\text{MemoryIndex}$ 保留了最关键的因果与情感锚点，Agent 才能在跨场景题目上拿到高分。因此，**固定人格训练本质上就是逆向工程出最优记忆格式的方法**。
- **当在 Loop 中放开人格 $P$ 的调整时**：系统从零散或空白的 $P_{0,0}$ 出发，通过不断消除预测 $(\text{OS}, \text{Action})$ 与剧本 Ground Truth 的偏差，在生成记忆的同时**逆向蒸馏出角色完整的人格画像 $P^*$**。

---

## Invariants
[invariants]: #invariants

### latent-os-mediation

> **伴侣在训练与推理中的每一次外部反应必须先经由基于人格与记忆生成的内心状态变化（`OS`）中介，且写入记忆的每个 `MemoryItem` 必须同时封装可观测 `Input`、内部 `OS` 与对齐后的 `Action`。**

客观剧本只提供外部言行，唯有强制要求模型先显式产出 `OS` 再产出 `Action`，才能使隐式心理动机暴露在 Teacher 的可评估与可修正视野下；将 `OS` 持久化进 `MemoryItem`，则保证了后续压缩出的 `MemoryIndex` 承载的是带主观情感体验的记忆，而非冰冷的第三方日志。

### teacher-forced-trajectory-grounding

> **在序列答题的每一步评分结束后，写入 `MemoryItem` 与滑动历史的动作必须强制覆盖（Override）为 Ground Truth `Action`，绝不允许将偏离原著的预测动作传入下一题的历史上下文。**

长程剧本包含数千个强因果耦合的回合。若将 Student 未对齐的预测动作留存为历史事实，后续题目将发生蝴蝶效应式的语境发散，导致原著的 Ground Truth 失去参考意义。Teacher Forcing 保证了整条 2000+ 题轨迹始终锚定在真实叙事流形上。

### coupled-state-vector-propagation

> **在局部窗口或跨轮重训中，任何被采纳的新人格 $P_{u,v}'$ 必须同步以其重答生成的轨迹更新对应记忆 $M_{u,v}' = f(W_v, P_{u,v}')$，以耦合状态向量 $\{P_{u,v}', M_{u,v}'\}$ 的形式向后续窗口传递。**

由于记忆 $M$ 是输入数据集 $D$ 与人格 $P$ 的函数 $M = f(D, P)$，旧人格 $P_{u,v}$ 在低分（如 50 分）状态下生成的错误 `OS` 会污染记忆。当 $P_{u,v}'$ 在局部重训中提升至高分（如 75 分）时，唯有同步携带其在 75 分轨迹下生成的 $M_{u,v}'$，才能保证后续窗口中人格与记忆的自洽。

### reflective-compression-evaluability

> **单级 `MemoryIndex` 的压缩算子必须作为可训练策略看待，其质量由 Agent 仅凭 `MemoryIndex` 反射还原（Reflect）原场景关键信息并支撑下游推理的得分唯一度量。**

手工设计的摘要规则不可避免地会遗漏特定角色的关键伏笔。将 `compress` 定义为可通过 Reflect 能力评分并优化的 Agent Prompt，使记忆压缩本身纳入 RSI 自演进闭环。

---

## Drawbacks
[drawbacks]: #drawbacks

1. **多轮与局部重训带来的算力开销**：
   在 $2000+$ 道题的规模下，局部窗口重训（如 $X\dots Y$ 反复迭代）与全局多 Epoch 训练会显著增加 LLM 推理与评测的 Token 消耗。
   *缓解方向*：通过冷启动免评、在 `compact` 边界批量评估与更新，以及仅在局部窗口得分低于阈值时触发局部重训，可将算力集中在真正产生认知增量的高惊奇度（High-Surprisal）片段上。

2. **局部贪心寻优的过拟合风险**：
   在窗口 $[X, Y]$ 上将分数从 50 刷到 75 的临时最优解 $P_{u,v}'$，可能过度迎合了当前场景的特殊语境，而在 $[Y, Y+Z]$ 上表现下降。
   *缓解方向*：Teacher 手里维护的状态向量 $\{P_{u,v}', M_{u,v}'\}$ 可保留多个候选分支（Vector Beam），并在跨窗口验证与多 Epoch 全局评选中自然淘汰局部过拟合分支。

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### 为什么暂时只采用「单级（Single-Level）Memory-Index」而非多级记忆树？

在早期设想中，常见做法是设计「活动 $\to$ 日记 $\to$ 月记 $\to$ 年记 + 向量库」的多级金字塔。然而对真实剧本（如 200 余幕、2000+ 回合的 Galgame）的定量分析表明：
- 若以场景（Scene）为单位执行 `compact`，全剧仅产生约 100～200 个场景索引条目；
- 单级 `MemoryIndex`（约数千 Tokens）完全可以**全量常驻在模型的 In-Context 窗口内**；
- 相比多级级联压缩造成的层层信息损耗与复杂的跨层路由，单级 In-Context `MemoryIndex` 让模型具备全局视野，且使 $\text{MemoryIndex}_{0,x} = \text{compress}(\{\text{MemoryItem}_n\})$ 的单步压缩质量可以直接通过 Reflect 分数进行端到端训练。

### 为什么不直接对每句话微调模型权重（SFT / RLHF），而是采用 In-Context $(P, M, C)$ 演化？

权重微调会将特定时刻的记忆与状态黑盒固化在参数中，无法支持伴侣在生命周期中按需解压某段具体回忆、无法解释某次反应背后的显式 `OS` 因果链，且每次更新都需要昂贵的梯度回传。在上下文空间中联合演化显式的 $(P, M, C)$，兼具完全的可解释性、即时可编辑性与跨基座模型的可迁移性。

---

## Prior art
[prior-art]: #prior-art

- **Teacher Forcing 与序列建模（Williams & Zipser, 1989）**：在循环序列训练中用真实历史替代预测历史以阻止误差指数级发散；本 RFC 将其推广至「保留 Agent 契合的内部 `OS` + 强制覆盖外部 `Action` 为 Ground Truth」的半监督认知轨迹合成。
- **Agentic Context Engineering (ACE) / OPRO / TextGrad**：通过执行轨迹诊断（Reflector）与规则编纂（Curator）在上下文空间迭代演进 Prompt Playbook；本 RFC 将单一静态规则手册扩展为耦合的「人格 $P$ + 动态增长的记忆索引 $M = f(D, P)$ + 可训练压缩器 $C$」三维状态空间。
- **Penguin Benchmark & Evaluation 体系**：将能力拆解为可独立计分的 Case 矩阵与迭代校准流程，为本 RFC 将长剧本转化为 $D = 2000+$ 道标准化评测题提供了直接的方法论基础。

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

作为阐述训练元理论的基础规范，本 RFC 刻意将以下四个核心具体化问题留待 **RFC-0004** 与 **RFC-0005** 深入解决：

1. **记忆的具体格式（Memory Format）**：
   $\text{MemoryItem} = \langle \text{Input}, \text{OS}, \text{Action} \rangle$ 与单级压缩索引 $\text{MemoryIndex}_{0,x}$ 应当采用何种精确的语法结构与注解格式（Annotations Schema），才能最大化模型在 Context 中扫描定位与按需解压（Decompress / Reflect）的效率？
2. **记忆中应当包含哪些内容（What are Contained in Memory）**：
   在从场景级 $\{\text{MemoryItem}_n\}$ 压缩生成 $\text{MemoryIndex}_{0,x}$ 时，哪些维度（如感官意象、情感转折、人际关系增量、未解伏笔、世界观设定）是必须保留的充分统计量，哪些表层寒暄应当被丢弃？
3. **人格的具体格式（Format of Personality）**：
   人格参数 $P$ 应当如何组织（例如自由文本 vs. 分层结构化槽位：核心特质、对特定人物的关系策略、口癖与标志性动作触发器），才能既精确控制 `OS` 与 `Action` 的生成，又在反复修改时不发生结构腐化与灾难性遗忘？
4. **如何更新人格以获得更高分数（How to Update Personality to Get Better Score）**：
   当局部窗口得分偏低（如 50 分）或 `OS` 与 Ground Truth 发生冲突时，Teacher 诊断偏差并生成 $P_{u,v} \to P_{u,v}'$ 的具体更新算子（Prompt Gradient / Credit Assignment 规则、局部修改幅度约束、候选向量 $\{P', M'\}$ 的保留与剪枝策略）应如何设计，才能稳定实现从 50 分到 75 分乃至全局最高分的单调跃升？

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **RFC-0004（第一版人格和记忆建模：In-Context Memory-Index + OS）**：具象化上述前两个未决问题，正式定义 $\text{Input} \to \text{OS} \to \text{Action}$ 推理协议、单级 $\text{MemoryIndex}_{0,x}$ 的压缩与解压（Reflect）机制，以及训练压缩 Prompt $C$ 的评分回路。
- **RFC-0005（第一版剧本到人格+记忆逆向算法）**：具象化后两个未决问题，实现「固定人格逆向记忆格式」与「闭环动态更新人格同时逆向出人格与记忆」的完整算法，并在长篇叙事剧本数据集（$2000+$ 题）上完成基准验证。
- **多分支状态向量束搜索（Beam Search over $\{P, M\}$ Vectors）**：当算力充裕时，Teacher 在每个窗口边界并行维护 $B$ 个不同演化方向的 $\{P_{u,v}^{(b)}, M_{u,v}^{(b)}\}$ 向量分支，通过后续窗口的长期泛化表现自动完成优胜劣汰。

---

## Changes

### v1.0.0

- 初始版本：确立 EMA 训练元理论（Meta-Theory of EMA Training），定义 $\text{Input} \to \text{OS} \to \text{Action}$、冷启动与窗口化 Compact、局部状态向量 $\{P_{u,v}', M_{u,v}'\}$ 寻优、可训练单级记忆压缩算子，以及 RFC-0003 / RFC-0004 / RFC-0005 的演进蓝图与四大核心待决问题。
