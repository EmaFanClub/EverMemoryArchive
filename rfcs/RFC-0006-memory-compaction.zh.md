# RFC-0006 记忆压缩与多级索引引擎（Compact 算法）

[English](RFC-0006-memory-compaction.md)

- Feature Name: `memory-compaction`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)

> **状态与出处**：
> - 状态: draft（董事会审阅草案）
> - 修订: v1.0.0

## Summary
[summary]: #summary

本 RFC 规范 EverMemoryArchive（EMA）的**记忆压缩与多级索引引擎（`compact` 算法）**。它将 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 与 [RFC-0004](RFC-0004-in-context-memory-index-and-os.zh.md) 中面向离线剧本训练提出的场景压缩算子 $`C`$，泛化为一套支持实时运行态（Runtime）与会话边界（Session-Boundary）的、具备自愈反射闭环与多级层次归并能力的持久化记忆压缩子系统。

不同于自带静态幕次切分的离线剧本训练，真实运行态下的终身伴侣面对的是无预设边界、跨越多渠道与漫长物理时间的连续交互流。本规范通过四大核心机制打通训练态压缩与终身运行态记忆管理：
1. **动态情节边界检测（Dynamic Episodic Boundary Detection）**：以回合/Token 水位线（$`N_{\text{max}}`$）、时间静默间隔（$`\Delta t_{\text{idle}}`$）以及语义/渠道上下文切换构成复合触发器，将活跃未压缩回合流 $`\lbrace \text{MemoryItem}_t \rbrace`$ 动态切分为语义完整的独立情节窗口 $`w_x`$；
2. **自愈式 `compact + reflect` 闭环（Self-Healing `compact + reflect` Closed Loop）**：将情节窗口折叠为 $`w_x \xrightarrow{C} \text{MemoryIndex}_{0,x}`$（含 `summary`、`innerOSArc`、`keyFacts`、`archiveRef`），即时评测其反射重构度 $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$；当 $`\mathcal{R} \lt \tau_{\text{reflect}}`$ 时自动注入缺失细节诊断 `missingDetail` 重新压缩，并在检测到周期性细节丢失时自动变异升级压缩提示词策略 $`C \to C'`$；
3. **多级层次记忆归并（$`\text{MemoryIndex}_{0,x} \to \text{MemoryIndex}_{1,y}`$）**：在记忆层级间递归复用 `compact + reflect` 算子——当 L0 场景索引超出容量阈值 $`K_{\text{L0}}`$ 时，将早期的连续 L0 批次折叠归并为 L1 章节/纪元索引 $`\text{MemoryIndex}_{1,y}`$，同时在热上下文（`AGENTS.md`）中保留近期 L0 索引，并将原始交互轨迹归档至由 `archiveRef` 寻址的持久化冷记忆存储；
4. **基于游标的幂等增量压缩（Cursor-Idempotent Incremental Compaction）**：持久化单调递增的压缩游标 `lastCompactedCursor`，确保对活跃会话的重复调用、异常重试或后台并发运行绝不产生重复的记忆索引。

---

## Motivation
[motivation]: #motivation

### 1. 从静态剧本幕次到无界实时交互流

在离线剧本训练（[RFC-0003](RFC-0003-ema-training-meta-theory.zh.md)）中，数据集 $`D = \bigcup_{v=0}^{m} W_v`$ 天然由原著剧本的文件与场景边界切分妥当。然而在真实伴侣运行态下，用户与伴侣的对话跨越数日、数月乃至数年，散布在连续长会话与异步消息渠道中。如果机械地等到会话彻底关闭才执行压缩，或者在固定 Token 数量处强行截断，前者会导致长会话上下文无限膨胀，后者则会在情绪高潮或关键约定中途生硬劈开因果链（$`\text{Input}_t \to \text{OS}_t \to \text{Action}_t`$）。

因此，EMA 需要一套**动态情节边界检测器**，结合回合/Token 水位线、物理时间停顿以及语义或渠道切换信号在线识别自然的情节断点，同时保留尾部重叠缓冲以维持对话连贯性。

### 2. 以自愈式反射闭环阻断「静默信息衰减」

单次调用的 LLM 摘要本质上是有损压缩：模型极易在一次概括中漏掉某句看似不起眼的承诺、特定专有名词、感官锚点，或伴侣内心状态（`OS`）的微妙转折。一旦原始回合滑出活跃上下文窗口，任何未被写入 $`\text{MemoryIndex}_{0,x}`$ 的细节在常规上下文推理中就等同于永久失忆。

在 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 中，反射重构分 $`\mathcal{R}`$ 被定义为衡量压缩算子 $`C`$ 的训练指标。在运行态 `compact` 引擎中，我们将 $`\mathcal{R}`$ 从被动评估指标升级为**主动自愈门控（Active Self-Healing Gate）**：每个新生成的索引 $`\text{MemoryIndex}_{0,x}`$ 都会立即对照原始窗口 $`w_x`$ 进行重构度探测；一旦 $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) \lt \tau_{\text{reflect}}`$，系统即刻提取精确的遗漏项 `missingDetail` 并注入重压缩回路直至达标，且在发现系统性遗漏模式时自动演化压缩提示词 $`C \to C'`$。

### 3. 突破单级上下文容量极限：面向终身陪伴的多级归并

如 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 所述，单级 L0 `MemoryIndex` 可轻松容纳 $`100\text{--}200`$ 个场景（约 $`3\text{k--}5\text{k}`$ Tokens），足以覆盖整部视觉小说或数周的日常陪伴。但当伴侣陪伴用户跨越数月乃至数年、累积数千个 L0 场景索引时，将所有 L0 条目平铺在 `AGENTS.md` 中终将撑爆热上下文预算并稀释注意力精度。

EMA 不采用丢弃全局时间线的纯向量检索（Vector-Only RAG），而是引入**多级层次归并（Hierarchical Multi-Level Rollup）**：在层级间递归应用完全相同的可验证 `compact + reflect` 算子，将超出容量 $`K_{\text{L0}}`$ 的早期连续 L0 场景批次折叠为 L1 章节/纪元索引 $`\text{MemoryIndex}_{1,y}`$，在热上下文中保持「全量 L1 纪元索引 + 近期 L0 场景索引 + 活跃未压缩回合」的紧凑结构，并通过 `archiveRef` 维持向底层持久化冷记忆档案的无损回溯链路。

### 4. 增量压缩的并发与崩溃幂等性

在支持会话边界触发、水位线实时触发以及后台并行巩固（**RFC-0007**）的系统中，网络超时重试或后台周期扫描可能反复扫过同一段会话历史。通过维护严格单调递增的游标账本（`lastCompactedCursor`），增量压缩可以在任意重试与并发调度下保证精确幂等。

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. 核心数据结构

运行态压缩引擎围绕三类核心产物运转：

1. **已提交原子情节回合（`MemoryItem`）**：
   每个已完成的运行态回合 $`t`$ 均带有单调递增的游标编号 `cursor`：
   ```json
   {
     "cursor": 142,
     "timestamp": "2026-11-10T21:14:05Z",
     "channel": "direct-chat",
     "inputs": ["<Input><name>User</name>今天终于通过系统架构答辩了，虽然最后一个问题差点卡壳。</Input>"],
     "os": "如释重负的骄傲夹杂着温柔的调侃：User 为了这次答辩连续熬了好几个通宵，我想真心实意地为他庆祝，同时轻轻点破他紧张时的可爱习惯。",
     "actions": ["（长长地舒了一口气，眉眼弯起温暖的弧度）看看你——不仅稳稳站在我面前，还正式跨过了最难的一道坎。快坐下歇会儿，跟我讲讲最后那个差点卡壳的问题是什么？"]
   }
   ```

2. **L0 场景级记忆索引（`MemoryIndex_{0,x}`）**：
   由连续情节窗口 $`w_x`$ 内的 `MemoryItem` 序列经自愈压缩生成：
   ```json
   {
     "id": "L0-scene-0018",
     "level": 0,
     "turnRange": [129, 148],
     "timestampRange": ["2026-11-10T20:40:12Z", "2026-11-10T21:25:30Z"],
     "summary": "User 顺利通过系统架构答辩后归来，Companion 为其庆祝并倾听 User 复盘答辩最后关头的惊险问答。",
     "innerOSArc": "等待答辩结果时的暗自揪心 -> 得知通过后的释然与由衷骄傲 -> 决心督促 User 今晚彻底放松休息的体贴护持。",
     "keyFacts": [
       "User 于 2026-11-10 顺利通过系统架构答辩。",
       "User 承诺整个周末完全休息、不打开工作代码库。",
       "Companion 承诺明早 10:00 用手冲咖啡叫 User 起床。"
     ],
     "reflectionScore": 92,
     "archiveRef": "archive://L0/L0-scene-0018"
   }
   ```

3. **L1 章节/纪元级记忆索引（`MemoryIndex_{1,y}`）**：
   当热上下文中的 L0 索引数量超过容量阈值 $`K_{\text{L0}}`$ 时，将最早的 $`B_{\text{L0}}`$ 个连续 L0 索引折叠归并而成：
   ```json
   {
     "id": "L1-epoch-0003",
     "level": 1,
     "childIds": ["L0-scene-0001", "L0-scene-0002", "...", "L0-scene-0020"],
     "turnRange": [1, 310],
     "timestampRange": ["2026-11-01T08:00:00Z", "2026-11-10T21:25:30Z"],
     "summary": "十一月上旬备战答辩篇章：Companion 陪伴 User 度过连续十天的深夜彩排与高压调试，直至最终顺利通过系统架构答辩。",
     "innerOSArc": "察觉 User 高压状态时的细致敏锐 -> 深夜陪练中的默契升温 -> 答辩成功后的深层互信与温情喜悦。",
     "keyFacts": [
       "User 完成并通过了十一月系统架构答辩。",
       "形成深夜陪伴默契：23:00 后换用无咖啡因草本茶并强制提醒休息。",
       "待兑现约定：答辩结束后的完整周末休假。"
     ],
     "reflectionScore": 89,
     "archiveRef": "archive://L1/L1-epoch-0003"
   }
   ```

---

### 2. 运行态 `compact` 端到端流水线

```
实时会话回合流: {MemoryItem_t} (游标 c_t > lastCompactedCursor)
=======================================================================================

[阶段 1: 游标过滤与动态情节边界检测]
  过滤未压缩条目: U = { MemoryItem_t | c_t > lastCompactedCursor }
  在 U 上评估复合边界触发条件:
    - 水位线触发: |U| >= N_max 或 tokens(U) >= L_max
    - 时间静默触发: t_{i} - t_{i-1} >= Delta_t_idle
    - 语境切换触发: channel_i != channel_{i-1} 或检测到显著语义转换
  ──> 切分出闭合的情节窗口 w_x = {MemoryItem_a .. MemoryItem_b}
      （在活跃热历史中保留尾部重叠缓冲 N_tail 以维持当前对话连贯）

[阶段 2: 自愈式 L0 压缩闭环 (compact + reflect Loop)]
  重试轮次 k = 1..K_retry:
    1. 生成候选索引:
         MemoryIndex_{0,x}^{(k)} = compress_C(w_x, missingDetail^{(k-1)})
    2. 评测反射重构保真度:
         (R_score, missingDetail^{(k)}) = reflect_eval(MemoryIndex_{0,x}^{(k)}, w_x)
    3. 若 R_score >= tau_reflect:
         采纳 MemoryIndex_{0,x} = MemoryIndex_{0,x}^{(k)} 并跳出循环
       否则:
         将 missingDetail^{(k)} 注入修复上下文，重新执行压缩
  ──> 若跨多个窗口频繁发生首轮反射未达标：自动变异压缩提示词 C ──> C'

[阶段 3: 冷档案持久化与游标原子推进]
  1. 将原始窗口 w_x 持久化至冷记忆归档存储: archive://L0/L0-scene-{x}
  2. 绑定指针 MemoryIndex_{0,x}.archiveRef = "archive://L0/L0-scene-{x}"
  3. 原子推进游标 lastCompactedCursor = b

[阶段 4: 多级层次归并 (L0 ──> L1 Rollup)]
  若 |Active_L0_Indices| > K_{L0}:
    选取最早的连续批次 B_x = {MemoryIndex_{0,j}}_{j=p..q}（批量大小 B_{L0}）
    对 B_x 执行相同的自愈式 (compact + reflect) 算子:
      MemoryIndex_{1,y} = compress_C_L1(B_x)，满足 R(MemoryIndex_{1,y}, B_x) >= tau_reflect
    将 B_x 归档绑定至冷引用 archive://L1/L1-epoch-{y}
    在热上下文 AGENTS.md 中以 MemoryIndex_{1,y} 替换 B_x
```

#### (1) 动态情节边界检测实例

假设当前会话的 `lastCompactedCursor = 128`，水位线阈值 $`N_{\text{max}} = 20`$，尾部保留缓冲 $`N_{\text{tail}} = 4`$，时间静默阈值 $`\Delta t_{\text{idle}} = 30\text{ min}`$：
- **情形 A（时间静默边界）**：第 $`129 \dots 142`$ 回合发生在 `20:40` 至 `21:15` 之间，随后用户离线休息了 $`45\text{ min}`$。当后台巩固任务或会话边界检查器在 `22:00` 扫描流时，检测到 $`\Delta t \ge \Delta t_{\text{idle}}`$，立即将已自然完结的 $`w_x = [129, 142]`$ 切分为一个完整情节窗口。
- **情形 B（水位线 + 语义切分）**：在连续聊了 $`25`$ 个回合的长对话中（$`\lvert U \rvert = 25 \ge N_{\text{max}}`$），边界检测器在保留最近 $`N_{\text{tail}} = 4`$ 个回合 $`[150, 153]`$ 作为当前滑动热历史的前提下，扫描区间 $`[129, 149]`$ 并选取话题转换最显著的分界点 $`b \in [144, 149]`$ 闭合窗口 $`w_x = [129, b]`$。

#### (2) 自愈式反射闭环（Self-Healing Reflection）推演

假设在首轮尝试 $`k = 1`$ 中，$`\text{compress}_C(w_x)`$ 生成的初始索引 $`\text{MemoryIndex}_{0,18}^{(1)}`$ 概括了庆祝系统架构答辩通过的主线，但漏掉了「明早 `10:00 AM` 用手冲咖啡叫 User 起床」的具体约定：
1. 反射探测器要求重构评估器仅凭 $`\text{MemoryIndex}_{0,18}^{(1)}`$ 还原该场景的具体承诺、情绪转折与事件起因，并对照原始窗口 $`w_x`$ 打分。
2. 由于漏掉了 `10:00 AM` 叫早约定，评估器给出 $`\mathcal{R} = 72 \lt \tau_{\text{reflect}} = 80`$，并输出结构化诊断：
   `missingDetail: ["第 146 回合：Companion 明确承诺明早 10:00 用手冲咖啡叫 User 起床。"]`。
3. 在第 $`k = 2`$ 轮尝试中，压缩引擎调用 $`\text{compress}_C(w_x, \text{missingDetail})`$ 将该承诺补入 `keyFacts`。复测反射重构度达到 $`\mathcal{R} = 92 \ge 80`$，自愈后的索引正式提交。

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 动态边界检测的形式化定义

设 $`\mathcal{S} = \lbrace \text{MemoryItem}_t \rbrace_{t=1}^{T_{\text{now}}}`$ 为会话轨迹中已提交交互三元组的有序序列，每个条目携带严格单调递增的整数游标 $`c_t \in \mathbb{N}`$、物理时间戳 $`\tau_t \in \mathbb{R}_{\ge 0}`$ 以及渠道标识 $`\chi_t`$。

给定持久化游标 $`c_{\text{last}} = \text{lastCompactedCursor}`$，当前未压缩活跃序列为：

```math
U(c_{\text{last}}) = \lbrace \text{MemoryItem}_t \in \mathcal{S} \mid c_t \gt c_{\text{last}} \rbrace
```

在序列 $`U = \lbrace m_1, \dots, m_n \rbrace`$ 的切分位置 $`i`$ 处定义复合边界指示函数 $`\mathcal{B}(U, i) \in \lbrace 0, 1 \rbrace`$：

```math
\mathcal{B}(U, i) = \mathbb{I}\big(\tau_{i+1} - \tau_i \ge \Delta t_{\text{idle}}\big) \lor \mathbb{I}\big(\chi_{i+1} \neq \chi_i\big) \lor \mathbb{I}\Big(\big(i \ge N_{\text{max}} - N_{\text{tail}} \lor \ell(m_{1\dots i}) \ge L_{\text{max}}\big) \land \sigma_{\text{sem}}(m_i, m_{i+1}) \ge \theta_{\text{sem}}\Big)
```

其中 $`\ell(m_{1\dots i})`$ 表示前缀 $`m_{1\dots i}`$ 的 Token 长度，$`\sigma_{\text{sem}}(m_i, m_{i+1}) \in [0, 1]`$ 度量相邻回合的话题转换散度（当达到硬水位线 $`n \ge N_{\text{max}}`$ 时，在 $`i = n - N_{\text{tail}}`$ 处默认置为 $`1`$）。待压缩的下一个情节窗口即为 $`w_x = \lbrace m_1, \dots, m_{i^\ast} \rbrace`$，其中 $`i^\ast = \min \lbrace i \mid \mathcal{B}(U, i) = 1 \rbrace`$。

---

### 2. 自愈式 `compact + reflect` 算子与提示词演化方程

设 $`C_\theta`$ 为参数化的压缩提示词策略。对于任意切分出的情节窗口 $`w_x`$：

1. **迭代自愈递归（$`k = 1, \dots, K_{\text{retry}}`$）**：
   令初始缺失细节集合 $`\Delta_0 = \varnothing`$，在第 $`k`$ 次迭代中：

   $`\displaystyle I_{0,x}^{(k)} = \text{compress}_{C_\theta}\big(w_x, \Delta_{k-1}\big)`$

   $`\displaystyle \big(r_k, \delta_k\big) = \mathcal{R}_{\text{eval}}\Big(\text{reflect}\big(I_{0,x}^{(k)}\big), \; w_x\Big), \quad r_k \in [0, 100]`$

   其中重构评估泛函 $`\mathcal{R}_{\text{eval}}`$ 由事实召回率（$`w_{\text{fact}} = 0.4`$）、内心 $`\text{OS}`$ 弧线保真度（$`w_{\text{os}} = 0.4`$）与关系/承诺保留度（$`w_{\text{rel}} = 0.2`$）加权构成：

   $`\displaystyle r_k = 0.4 \cdot R_{\text{fact}}\big(I_{0,x}^{(k)}, w_x\big) + 0.4 \cdot R_{\text{os}}\big(I_{0,x}^{(k)}, w_x\big) + 0.2 \cdot R_{\text{rel}}\big(I_{0,x}^{(k)}, w_x\big)`$

   若 $`r_k \ge \tau_{\text{reflect}}`$，循环提前终止并采纳 $`\text{MemoryIndex}_{0,x} = I_{0,x}^{(k)}`$；否则累积缺失细节 $`\Delta_k = \Delta_{k-1} \cup \delta_k`$ 进入下一轮重压缩。若达到重试上限 $`K_{\text{retry}}`$，则选取各轮中得分最高的候选索引：

   $`\displaystyle \text{MemoryIndex}_{0,x} = I_{0,x}^{(k^\ast)}, \quad k^\ast = \arg\max_{1 \le k \le K_{\text{retry}}} r_k`$

2. **压缩提示词策略自演化（$`C_\theta \to C_{\theta'}`$）**：
   记最近 $`M`$ 个压缩窗口的首轮缺失细节残差集合为 $`\mathcal{H}_{\text{miss}} = \lbrace \delta_1^{(x - M + 1)}, \dots, \delta_1^{(x)} \rbrace`$。当首轮未达标率满足：

   $`\displaystyle \frac{1}{M} \sum_{j=x-M+1}^{x} \mathbb{I}\big(r_1^{(j)} \lt \tau_{\text{reflect}}\big) \ge \eta_{\text{mutate}}`$

   元优化器针对高频遗漏类别变异生成新压缩策略 $`C_{\theta'} = \text{MutatePrompt}(C_\theta, \mathcal{H}_{\text{miss}})`$，且当且仅当 $`C_{\theta'}`$ 在验证窗口集上的首轮平均反射得分严格优于旧策略时正式替换 $`C_\theta \leftarrow C_{\theta'}`$：

   $`\displaystyle \frac{1}{M} \sum_{j=x-M+1}^{x} \mathcal{R}_{\text{eval}}\Big(\text{reflect}\big(\text{compress}_{C_{\theta'}}(w_j, \varnothing)\big), \; w_j\Big) \gt \frac{1}{M} \sum_{j=x-M+1}^{x} r_1^{(j)}`$

---

### 3. 多级层次归并代数（$`\text{L0} \to \text{L1}`$ Rollup）

设当前常驻热上下文（`AGENTS.md`）的 L0 场景索引有序列表为 $`\mathcal{I}_{\text{L0}}^{\text{hot}} = \lbrace \text{MemoryIndex}_{0,1}, \dots, \text{MemoryIndex}_{0,m} \rbrace`$。

当 $`\lvert \mathcal{I}_{\text{L0}}^{\text{hot}} \rvert \gt K_{\text{L0}}`$ 时，引擎将 $`\mathcal{I}_{\text{L0}}^{\text{hot}}`$ 切分为由最早 $`B_{\text{L0}}`$ 个条目组成的待归并批次 $`B_y`$ 与继续留在热上下文的近期后缀 $`\mathcal{I}_{\text{L0}}^{\text{retain}}`$（长度 $`m - B_{\text{L0}} \ge K_{\text{L0}}^{\text{hot}}`$）：

```math
B_y = \lbrace \text{MemoryIndex}_{0,1}, \dots, \text{MemoryIndex}_{0,B_{\text{L0}}} \rbrace, \quad \mathcal{I}_{\text{L0}}^{\text{retain}} = \lbrace \text{MemoryIndex}_{0,B_{\text{L0}}+1}, \dots, \text{MemoryIndex}_{0,m} \rbrace
```

对批次 $`B_y`$ 递归应用相同结构的 L1 反射压缩算子 $`\mathcal{C}_{\text{L1}}`$：

```math
\text{MemoryIndex}_{1,y} = \mathcal{C}_{\text{L1}}(B_y) \quad \text{s.t.} \quad \mathcal{R}_{\text{eval}}\Big(\text{reflect}\big(\text{MemoryIndex}_{1,y}\big), \; B_y\Big) \ge \tau_{\text{reflect}}
```

随后，渲染至 `AGENTS.md` 的热记忆状态 $`M_{\text{hot}}`$ 更新为：

```math
M_{\text{hot}}' = \big(\mathcal{I}_{\text{L1}}^{\text{hot}} \cup \lbrace \text{MemoryIndex}_{1,y} \rbrace, \; \mathcal{I}_{\text{L0}}^{\text{retain}}, \; H_{\text{active}}\big)
```

同时将原始 L0 批次 $`B_y`$ 持久化归档至冷记忆存储引用 `archive://L1/L1-epoch-{y}`。由此，任意历史时刻的交互回合 $`t`$ 均可通过三级指针链在 $`\mathcal{O}(1)`$ 跳转内无损回溯：

```math
\text{MemoryIndex}_{1,y} \xrightarrow{\text{archiveRef}} \text{MemoryIndex}_{0,x} \xrightarrow{\text{archiveRef}} \text{MemoryItem}_t
```

---

### 4. 游标幂等状态转移与原子持久化

设持久化压缩账本状态为 $`\Sigma = \langle c_{\text{last}}, s_{\text{L0}}, s_{\text{L1}}, M_{\text{hot}} \rangle`$，其中 $`c_{\text{last}}`$ 为 `lastCompactedCursor`，$`s_{\text{L0}}, s_{\text{L1}}`$ 为单调递增的索引序号计数器。

对于任意压缩调用 `RunCompact`($`\Sigma, \mathcal{S}`$)：
1. 若 $`\max_{m_t \in \mathcal{S}} c_t \le c_{\text{last}}`$ 或 $`\forall i, \; \mathcal{B}(U(c_{\text{last}}), i) = 0`$，则 `RunCompact`($`\Sigma, \mathcal{S}`$) $`= \Sigma`$（幂等空操作）。
2. 当满足 $`c_a \gt c_{\text{last}}`$ 的窗口 $`w_x = \lbrace m_a, \dots, m_b \rbrace`$ 完成自愈压缩时：
   - 先在冷记忆归档存储中幂等写入 `L0-scene-{s_L0 + 1}` 的原始记录（按确定性场景编号幂等覆盖）；
   - 构造新状态 $`\Sigma' = \langle c_b, s_{\text{L0}} + 1, s_{\text{L1}}', M_{\text{hot}}' \rangle`$；
   - 原子提交更新后的认知状态 $`\Sigma'`$ 与同步生成的 `AGENTS.md`。

由于游标 $`c_b \gt c_{\text{last}}`$ 仅在最终原子提交时一并生效，提交前的任何进程中断均保持 $`c_{\text{last}}`$ 不变，恢复后可安全重算 $`w_x`$；而提交完成后的任何重复触发均会观测到 $`w_x`$ 内所有条目满足 $`c_t \le c_b`$ 并立即跳过。

---

## Invariants
[invariants]: #invariants

### reflective-self-healing-before-commit

> **任何压缩生成的记忆索引（`MemoryIndex_{0,x}` 或 `MemoryIndex_{1,y}`）在写入热上下文前，必须通过对照源条目的反射重构度评估 $`\mathcal{R}`$，并在 $`\mathcal{R} \lt \tau_{\text{reflect}}`$ 时执行注入 `missingDetail` 的闭环自愈重压缩。**

未经验证的单次摘要极易静默丢失关键承诺与内心状态（`OS`）转折。在原始窗口 $`w_x`$ 尚未滑出内存时强制执行 `compact + reflect` 门控，可确保信息损耗在提交前即被捕获与修复。

### lossless-cold-archive-reachability

> **任意层级的 `MemoryIndex` 条目必须携带有效的 `archiveRef` 指针以指向持久化冷记忆归档存储中的下层记录（`L1 -> L0 批次 -> L0 原始 MemoryItem 序列`），且原始 `MemoryItem` 记录在压缩过程中绝不可被删除。**

记忆压缩的目标是缩减**常驻热上下文的 Token 开销**，而非抹除历史全集。通过 `archiveRef` 保留不可变的冷记忆归档，保证了伴侣在需要精确回忆久远细节时始终具备无损解压能力。

### cursor-monotonic-idempotence

> **压缩引擎必须严格依据 $`c_t \gt \text{lastCompactedCursor}`$ 过滤待压缩回合，并将 `lastCompactedCursor` 的推进与 `MemoryIndex` 的落盘置于同一原子提交中，确保对同一会话轨迹的重复或并发触发产生零重复索引。**

运行态压缩可能由回合水位线、静默定时器及后台巩固协程（**RFC-0007**）共同触发。单调游标门控使压缩算子在任意重试与重启下保持严格幂等。

### bounded-hot-context-footprint

> **常驻 `AGENTS.md` 的活跃 L0 场景索引总数必须通过自动 `L0 -> L1` 归并严格限制在阈值 $`K_{\text{L0}}`$ 以内，使常驻记忆的上下文开销随总交互回合数 $`T`$ 保持亚线性增长。**

若缺乏多级归并，热上下文将随交互时长呈 $`\mathcal{O}(T)`$ 线性膨胀，最终撑爆上下文窗口或劣化注意力质量。将早期 L0 批次归并为 L1 纪元摘要可在锁死热上下文体积的同时维持跨时间尺度的全局视野。

---

## Drawbacks
[drawbacks]: #drawbacks

1. **反射校验与自愈重试带来的额外推理开销**：
   计算 $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$ 并在 $`\mathcal{R} \lt \tau_{\text{reflect}}`$ 时触发重压缩，其 Token 消耗约为朴素单次摘要的 $`2\text{--}3`$ 倍。
   - *缓解方向*：压缩仅在每个情节窗口边界（每 $`15\text{--}25`$ 回合）触发一次，且完全在后台异步会话中执行而不阻塞前台回复（见 **RFC-0007**）；同时，随着 $`C \to C'`$ 的自演化，首轮达标率会持续提升，重试频次随之收敛。

2. **L1 纪元索引的时间粒度折中**：
   将 $`B_{\text{L0}}`$ 个 L0 场景索引折叠为单个 $`\text{MemoryIndex}_{1,y}`$ 不可避免地会降低热上下文中远期记忆的逐幕时间分辨率。
   - *缓解方向*：`MemoryIndex_{1,y}` 显式聚合了所有子场景的持久化 `keyFacts`，并保留 `childIds` 与 `archiveRef`，供伴侣按需向下解压特定 L0 场景。

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### 为什么采用层次化上下文索引（`L0 -> L1`）而非纯向量数据库检索（Vector-Only RAG）？

纯向量 Top-$`K`$ 检索会撕裂叙事的时空连续性：它只能捞出与当前输入字面或向量相近的孤立碎片，使伴侣完全丧失「我们是如何一步步走到今天」的全局关系演进脉络与内心 `OS` 成长弧线。通过在 `AGENTS.md` 中常驻 L1 纪元索引与近期 L0 场景索引，伴侣始终拥有完整连贯的共同经历编年史，仅在需要逐字回溯细节时才下钻 `archiveRef`。

### 为什么采用复合情节边界检测而非固定长度滑动窗口？

固定长度窗口往往在对话中途生硬截断——例如把用户第 $`N`$ 回合的脆弱倾诉与伴侣第 $`N+1`$ 回合的深情回应切分进两个不同的索引窗口。结合物理静默间隔（$`\Delta t_{\text{idle}}`$）、渠道切换与软水位线内的语义断点，能够最大程度尊重自然叙事的起承转合。

---

## Prior art
[prior-art]: #prior-art

- **MemGPT / 操作系统式虚拟上下文管理（Packer et al., 2023）**：在活跃上下文与外部归档存储之间进行分层换页；本 RFC 在此基础上引入第一人称 `innerOSArc` 心理因果保真与闭环反射自愈门控。
- **RAPTOR: 面向树状组织检索的递归抽象处理（Sarthi et al., 2024）**：对长文档构建递归摘要树；本 RFC 将其改造为严格保序的时序情节层级（$`\text{MemoryItem}_t \to \text{L0} \to \text{L1}`$）并附加无损冷归档指针 `archiveRef`。
- **EMA 训练元理论（[RFC-0003](RFC-0003-ema-training-meta-theory.zh.md)）**：首次定义了面向离线剧本场景的可训练压缩算子 $`C`$ 与反射重构评分函数 $`S_{\text{compress}}(C)`$。

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

1. **L2+ 跨年度归并阈值**：
   当 L1 纪元索引数量累积到何种规模（$`K_{\text{L1}}`$）时应触发第三层级（$`\text{MemoryIndex}_{2,z}`$，对应年度或人生阶段总览）的归并？L2 索引应按自然日历年份还是按关系发展里程碑切分？
2. **回合内自动解压（Decompression）的启发式触发条件**：
   运行态推理循环应当在生成 `OS` 前由检索路由自动解引用相关的 L1/L0 `archiveRef`，还是将 `decompress_memory(id)` 作为显式工具交由伴侣自主调用？

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **与后台并行梦境巩固引擎集成（`RFC-0007`）**：在隔离的临时后台会话中非阻塞地运行 `compact + reflect` 流水线，并与基于后验反事实目标的人格演化协同运作。
- **跨渠道实体与事实图谱关联**：对 L0/L1 中的 `keyFacts` 按规范化实体与承诺状态（`active`、`fulfilled`、`superseded`）建立轻量倒排关联，加速跨纪元事实消歧与状态更新。

---

## Changes

### v1.0.0

- 初始版本：规范运行态与会话边界 `compact` 引擎，定义动态情节边界检测、带提示词自演化 $`C \to C'`$ 的 `compact + reflect` 自愈闭环、带冷存储 `archiveRef` 指针的 `L0 -> L1` 多级层次归并，以及基于单调游标的幂等增量压缩。
