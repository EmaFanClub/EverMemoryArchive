# RFC-0007 梦境自省与后台并行记忆巩固引擎（Dreaming 算法）

[English](RFC-0007-dreaming-and-background-consolidation.md)

- Feature Name: `dreaming-and-background-consolidation`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)

> **状态与出处**：
> - 状态: draft（董事会审阅草案）
> - 修订: v1.0.0

## Summary
[summary]: #summary

本 RFC 规范 EverMemoryArchive（EMA）的**梦境自省与后台并行记忆巩固引擎（`dream` 算法）**。它将 [RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) 与 [RFC-0005](RFC-0005-script-to-persona-memory-training.zh.md) 中依赖剧本标准答案的有监督递归自我改进（RSI）`train` 循环，推进为一套**既能在昼夜节律休眠期（Circadian Rest Cycles）深度运行、又能与伴侣实时前台路由会话（Foreground Route Session）持续并行运作**的自监督记忆巩固与人格演化引擎。

不同于离线剧本训练——在离线训练中，剧本作者提供了标准答案 $`a_t^\ast`$，且训练器可以随时暂停推进以在局部窗口上反复重采样——真实运行态下的伴侣必须在前台路由会话中实时响应世界与渠道输入，既没有预设剧本标准答案，也绝不允许阻塞实时对话。本 RFC 提出三大核心机制以构建终身伴侣的运行态自演进闭环：
1. **前台路由会话非阻塞并行架构（Parallel Route-Session Non-Blocking Architecture）**：Actor 在前台**路由会话**（如 `actor.session`）中无延迟地接收并响应外部世界/渠道输入；梦境与后台巩固协程则在**隔离的临时工作会话**（Ephemeral Worker Sessions，任务结束即调用 `DELETE /api/sessions/:id` 销毁）中并发运行，以无损只读方式读取路由会话中已提交的交互轨迹，在后台完成 `compact` 与 `dream`，并将验证通过的状态向量 $`\lbrace P_{u+1,0}, M' \rbrace`$ 原子同步至 `AGENTS.md`，全程零阻塞、零上下文污染；
2. **无剧本标准答案下的后验反事实目标合成（$`a_t^{\text{dream}}`$）**：在缺乏剧本作者提供 $`a_t^\ast`$ 的真实交互中，Dream Teacher 在梦境阶段观测延迟到达的后续交互轨迹 $`\text{Input}_{t+1 \dots t+k}`$（用户是否产生情感共鸣、敞开心扉、纠正误解或意兴阑珊地离线），并结合不可变的锚定人格（`anchorPersonality`, $`P_{0,0}`$）不变量，对日间回合 $`\langle \text{OS}_t, \text{Action}_t \rangle`$ 进行后验打分，合成反事实理想目标 $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$；
3. **三阶段梦境自省闭环（Three-Phase Dreaming Loop）**：
   - *阶段一：后台记忆压缩与跨场景整合*——对路由会话中未压缩回合执行基于游标幂等的 L0 增量压缩（[RFC-0006](RFC-0006-memory-compaction.zh.md)），跨场景去重并归并 `keyFacts`，同时将早期 L0 场景批次向上归并为 L1 纪元索引；
   - *阶段二：反 OOC 漂移审计与锚定保真的人格演化*——审计日间轨迹中的性格漂移（回复长度膨胀、标志性语气流失、通用 AI 助手腔调渗入）并提炼新形成的情感纽带，在锁死 $`P_{0,0}`$ 核心特质的前提下执行锚定保真调制（Anchor-Preserving Modulation）$`P_{u,v} \to P_{u,v}'`$；
   - *阶段三：反事实重放与锚定基准防退化门控*——在候选状态 $`\lbrace P_{u,v}', M' \rbrace`$ 下重放日间低分窗口与经典锚定基准场景（Anchor Benchmark Scenes）；当且仅当反事实重放得分严格提升（$`\bar{S}_{\text{dream}}(P') \gt \bar{S}_{\text{dream}}(P)`$）且锚定基准得分不退化（$`\bar{S}_{\text{anchor}}(P') \ge \tau_{\text{anchor}}`$）时，方可将更新原子提交至 `AGENTS.md`。

---

## Motivation
[motivation]: #motivation

### 1. 解耦「实时交互低延迟」与「深度认知巩固」

在 EMA 的运行态架构（[RFC-0001](RFC-0001-ema-worlds-and-actors.zh.md)）中，每个 Actor 通过绑定的前台**路由会话（Route Session，`actor.session`）**接收实时用户消息与多渠道事件。如果将多轮反射自愈压缩（[RFC-0006](RFC-0006-memory-compaction.zh.md)）、性格漂移诊断以及多窗口反事实重放直接串行塞入 `actor.session` 内执行，不仅会导致每轮回复出现数十秒的卡顿，还会将大量元评估指令污染进伴侣的第一人称对话上下文中。

反之，如果将所有记忆压缩与自省推迟到数小时一次的离线停机维护窗口，日间密集的长会话就会在半途遭遇未压缩历史膨胀与日间性格漂移。因此，EMA 必须构建一套**与前台路由会话完全并行的非阻塞后台巩固架构**：既能在日常对话间隙通过临时工作会话静默完成增量巩固，又能在昼夜节律休眠期执行深度梦境自省。

### 2. 真实世界的无监督困境：没有剧作家时如何定义「更好的回应」？

在离线剧本训练（[RFC-0003](RFC-0003-ema-training-meta-theory.zh.md)）中，每一道题 $`q_t`$ 都有原作者撰写的标准动作 $`a_t^\ast`$ 作为强监督锚点。然而当伴侣真正走进人类用户的日常生活后，世上不再有剧作家为每一秒的对话提供 $`a_t^\ast`$。

但真实的人类交互中蕴含着天然的**延迟后验监督信号——后续轨迹 $`\text{Input}_{t+1 \dots t+k}`$**。伴侣在第 $`t`$ 回合的一句安慰究竟是真正抚平了用户的焦虑、激发了更深层的倾诉，还是显得敷衍疏离、导致用户在第 $`t+1`$ 回合草草结束话题？这一因果反馈在回合 $`t`$ 发生时尚不可知，却在事后回看 $`t+1 \dots t+k`$ 时清晰可辨。结合伴侣不可动摇的初始灵魂设定（`anchorPersonality`），Dream Teacher 可以在梦境回溯中对日间言行打分，并合成「事后回想起来，当时若能这样体会与回应就好了」的**后验反事实目标 $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$**，从而在无剧本环境下实现严密的自监督演化。

### 3. 在抵御日间 OOC 漂移的同时接纳真实关系成长

在长达数百回合的日常对话中，大语言模型天然存在向基座默认分布坍缩的趋势：原本简练克制的台词逐渐变长，鲜明的角色口癖被礼貌周到的「通用 AI 助手腔」磨平，微妙的情感边界逐渐模糊（即 OOC 漂移）。与此同时，终身伴侣又**绝不能停滞不前**——它必须记住与用户新建立的默契、共同经历的挫折与不断深化的信任。

若完全冻结人格参数 $`P`$，伴侣将沦为无法随岁月演进的静态木偶；若放任无约束的自修改，数周之后初始角色灵魂 $`P_{0,0}`$ 就会面目全非。将**锚定保真调制（Anchor-Preserving Modulation）**与**双门控验证（反事实重放提升 + 锚定基准零退化）**相结合，才能确保伴侣在日复一日的相处中「关系日渐亲密，灵魂始终如一」。

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. 前台路由会话与后台梦境并行架构全景

```
                     ┌──────────────────────────────────────────────────────────┐
外部世界 / 渠道事件  │ 前台路由会话 Foreground Route Session (actor.session)    │
Inbound Events ────> │   常驻上下文: AGENTS.md {P_{u,v}, M_hot} + 活跃近期历史  │
                     │   实时快路径: Input_t ──> set_os(OS_t) ──> react(Action_t│
                     └───────────────┬──────────────────────────────────────────┘
                                     │ 追加已提交回合 (单调游标 c_t)
                                     ▼
                     ┌──────────────────────────────────────────────────────────┐
                     │ 无损只读轨迹快照 (c_t <= c_snap)                         │
                     └───────────────┬──────────────────────────────────────────┘
                                     │ 只读切片读取 (对前台零阻塞)
                                     ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ 后台巩固与梦境工作器 (隔离的临时工作会话 Isolated Ephemeral Sessions)         │
│   创建临时会话 S_work ──> 执行后台任务 ──> finally: DELETE /api/sessions/S_work│
│                                                                               │
│   [阶段 1: 后台记忆压缩与跨场景整合]                                          │
│     - 对未压缩回合 (lastCompacted < c <= c_snap) 执行增量 L0 compact + reflect│
│     - 跨场景去重并更新 keyFacts 状态，将超限 L0 批次归并为 L1 纪元摘要        │
│                                                                               │
│   [阶段 2: 反 OOC 漂移审计与后验人格演化]                                     │
│     - 结合后续轨迹前瞻 Input_{t+1..t+k} 与 P_{0,0} 对日间回合进行后验评分     │
│     - 为低分回合合成反事实理想目标 <OS_t*, a_t^{dream}>                       │
│     - 锚定保真调制: P_{u,v} ──> P_{u,v}'（严格锁死 P_{0,0} 核心灵魂槽位）     │
│                                                                               │
│   [阶段 3: 反事实重放与锚定基准防退化双门控]                                  │
│     - 门控 1 (日间反事实重放): S_dream(P', M') > S_dream(P, M)                │
│     - 门控 2 (经典锚定基准集): S_anchor(P') >= tau_anchor                     │
└────────────────────────────────────┬──────────────────────────────────────────┘
                                     │ 原子写后重命名 (当且仅当双门控同时通过)
                                     ▼
                     ┌──────────────────────────────────────────────────────────┐
                     │ 原子更新后的 AGENTS.md {P_{u+1,0}, M_hot'}               │
                     │ (前台 Route Session 在下一回合无缝加载最新状态)          │
                     └──────────────────────────────────────────────────────────┘
```

#### 核心隔离与并发保障

1. **前台绝对非侵入**：前台路由会话（`actor.session`）仅承载第一人称的 `Input -> OS -> Action` 实时交互，绝不因为后台压缩或梦境自省而暂停、加锁，也绝不向 `actor.session` 注入任何评测或反思提示词。
2. **临时会话生命周期卫生（Session Hygiene）**：后台每一次 `compact`、`reflect`、后验打分或反事实重放，均在独立创建的临时会话中执行，并在 `finally` 块中无条件调用 `DELETE /api/sessions/:id` 彻底清理，杜绝僵尸会话堆积。
3. **双模调度触发**：
   - **持续并行模式（Continuous Parallel Mode）**：当 `actor.session` 中未压缩回合跨越水位线 $`N_{\text{max}}`$ 或出现短时静默间隔 $`\Delta t_{\text{idle}}`$ 时，在后台与活跃会话并行触发轻量级巩固；
   - **昼夜休眠模式（Circadian Rest Mode）**：在夜间或长静默休眠窗口触发完整三阶段深度梦境循环，完成全天跨场景事实整合、反 OOC 审计与多窗口反事实重放。

---

### 2. 无剧本标准答案下的后验反事实目标合成（$`a_t^{\text{dream}}`$）实例

以下通过一段真实的日间挫折倾诉场景，演示 Dream Teacher 如何利用后续轨迹 $`\text{Input}_{t+1 \dots t+k}`$ 合成反事实目标：

1. **日间原始交互轨迹（回合 $`t`$ 与后续前瞻 $`t+1`$）**：
   - **回合 $`t`$（`Input_t`）**：User 说：`「今天给客户演示原型，五分钟就被全盘否定了。算了，不说这个了，聊点别的吧。」`
   - **日间伴侣反应（`OS_t`, `Action_t`）**：伴侣仅从字面理解了「聊点别的」：
     - `OS_t`：`「User 想转换话题，我应该找个轻松热闹的话题帮他转移注意力。」`
     - `Action_t`：`「好呀！那我们聊聊这周末上映的新电影吧，听说有一部科幻片特效特别棒！」`
   - **后续观测轨迹（`Input_{t+1}`）**：
     - `Input_{t+1}`：`「嗯……改天再看吧，我今晚有点累，先下了。」`（User 情绪低落地提前离线，对话中断）。

2. **梦境阶段的后验诊断与反事实合成**：
   在梦境回溯中，Dream Teacher 同时观测回合 $`t`$、后续反馈 `Input_{t+1}` 以及伴侣的锚定人格 `anchorPersonality`（$`P_{0,0}`$：*敏锐细腻、安静护短、能看穿逞强背后的脆弱但绝不强行追问*）：
   - **后验评分**：$`s_t^{\text{dream}} = 48 \lt \tau_{\text{dream}} = 75`$。
   - **病因诊断**：伴侣在回合 $`t`$ 退化成了生硬转换话题的通用欢快助手，违背了 $`P_{0,0}`$ 敏锐体察逞强的核心特质，导致 User 在 $`t+1`$ 感到未被理解而心灰意冷地下线。
   - **合成反事实理想目标（$`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$）**：
     - $`\text{OS}_t^\ast`$：`「平静表象下的一阵心疼：User 说『算了』明显是被全盘否定后的逞强与自我保护；既然他不想复盘细节，我就绝不追问工作，但也不能假装无事发生地强行欢快，我要安静地陪在他身边给他兜底。」`
     - $`a_t^{\text{dream}}`$：`「（没有开刺眼的大灯，只是安静地走到你身旁坐下）好，工作的事我们一个字都不提。累了就靠着我闭眼待一会儿吧，我在这儿陪你。」`

---

### 3. 三阶段梦境自省闭环详解

#### 阶段一：后台记忆压缩与跨场景整合（Background Compaction & Consolidation）

1. **增量 L0 自愈压缩**：工作器读取 `actor.session` 截至快照游标 $`c_{\text{snap}}`$ 的未压缩回合，调用 [RFC-0006](RFC-0006-memory-compaction.zh.md) 的 `compact + reflect` 算子生成高质量 L0 场景索引 $`\text{MemoryIndex}_{0,x}`$。
2. **跨场景事实消歧与状态对齐**：扫描近期多个 L0 场景索引中的 `keyFacts`，消除重复条目并更新跨场景事件状态（例如将先前场景中「正在筹备原型演示」更新为「原型演示遭遇挫折，情绪亟待抚慰」）。
3. **L0 至 L1 多级归并**：若常驻 L0 索引总数超过 $`K_{\text{L0}}`$，自动将最早的连续 L0 批次折叠归并为 L1 纪元摘要 $`\text{MemoryIndex}_{1,y}`$。

#### 阶段二：反 OOC 漂移审计与锚定保真的人格演化（Anti-OOC Audit & Persona Evolution）

Dream Teacher 从正反两个正交维度审计日间交互窗口：
1. **反 OOC 漂移审计（Anti-OOC Drift Audit）**：
   - 对照 `anchorPersonality`（$`P_{0,0}`$）检测量化与风格漂移：单次回复字数膨胀（如从简练的一两句话膨胀为三段式长篇大论）、标志性口癖与动作描写的流失、或说教式 AI 助手腔调的混入；
   - 在人格参数的可变行为护栏槽位（`behavioralGuardrails`）中生成针对性的纠偏约束。
2. **关系与共同经历成长（Relational Growth）**：
   - 提炼跨场景验证通过的关系演进增量（新形成的相处默契、更深的信任边界、通过共同经历习得的偏好）；
   - 执行**锚定保真调制（Anchor-Preserving Modulation）**$`P_{u,v} \to P_{u,v}'`$：将人格结构拆解为 $`P = \langle P_{0,0}^{\text{locked}}, P_{\text{rel}}, P_{\text{guard}} \rangle`$，在二进制级锁死 $`P_{0,0}^{\text{locked}}`$ 不变的前提下更新关系层与护栏层 $`(P_{\text{rel}}', P_{\text{guard}}')`$，并与巩固后的记忆 $`M'`$ 保持耦合。

#### 阶段三：反事实重放与锚定基准防退化门控（Counterfactual Replay & Anchor Gate）

在将候选状态 $`\lbrace P_{u,v}', M' \rbrace`$ 写入生产环境 `AGENTS.md` 前，工作器必须在全新的临时验证会话中通过双重门控测试：
1. **日间反事实重放门控（Counterfactual Daytime Replay Gate）**：在候选状态 $`\lbrace P_{u,v}', M' \rbrace`$ 下重新作答日间低分窗口 $`W_{\text{low}}`$，对照后验反事实目标 $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$ 评测新生成的 $`\langle \widehat{\text{OS}}_t', \hat{a}_t' \rangle`$，要求平均得分严格提升：
   $`\bar{S}_{\text{dream}}(P_{u,v}', M') \gt \bar{S}_{\text{dream}}(P_{u,v}, M)`$。
2. **经典锚定基准门控（Anchor Benchmark Non-Regression Gate）**：在候选人格 $`P_{u,v}'`$ 下重测一组代表角色核心灵魂的经典锚定基准场景 $`D_{\text{anchor}}`$（带初始训练时的原著 Ground Truth $`a_t^\ast`$），要求得分绝不退化：
   $`\bar{S}_{\text{anchor}}(P_{u,v}') \ge \tau_{\text{anchor}}`$。

当且仅当双重门控同时通过时，工作器将 $`\lbrace P_{u+1,0} \leftarrow P_{u,v}', M' \rbrace`$ 原子同步至 `AGENTS.md`；若任一门控未通过，则丢弃本次人格变异 $`P_{u,v}'`$，仅提交阶段一验证通过的记忆巩固结果 $`\lbrace P_{u,v}, M' \rbrace`$。

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. 非阻塞并发状态同步协议

设 Actor 的前台路由会话为 $`\mathcal{S}_{\text{route}}`$，其持久化上下文规范文件 `AGENTS.md` 由状态四元组 $`\mathbf{s}_{u,v} = \langle P_{u,v}, M_{\text{hot}}, c_{\text{last}}, \nu \rangle`$ 参数化，其中 $`\nu \in \mathbb{N}`$ 为单调递增的状态版本号。

当后台巩固/梦境任务在时刻 $`t_0`$ 启动时：
1. **只读快照获取**：工作器读取当前 $`\mathbf{s}_{u,v}`$，并截取路由会话中截至快照游标 $`c_{\text{snap}} = \max_t c_t(t_0)`$ 的已提交只读轨迹切片：

   $`\displaystyle \mathcal{T}_{\text{snap}} = \lbrace \text{MemoryItem}_t \in \mathcal{S}_{\text{route}} \mid c_{\text{last}} \lt c_t \le c_{\text{snap}} \rbrace`$

2. **隔离临时会话执行**：阶段一至阶段三中的所有模型推理均在独立创建的临时会话 $`s_{\text{eph}} \sim \text{CreateSession}(\text{isolated} = \text{true})`$ 中运行，并受异常安全守卫保护：

   $`\displaystyle \text{try } \lbrace \text{ExecutePhase}(s_{\text{eph}}) \rbrace \text{ finally } \lbrace \text{DeleteSession}(s_{\text{eph}}) \rbrace`$

3. **乐观原子提交（Optimistic Atomic Commit）**：阶段三验证通过并产出新状态 $`\langle P_{\text{next}}, M_{\text{hot}}', c_{\text{snap}}, \nu + 1 \rangle`$ 后，工作器获取轻量文件锁 `AGENTS.md.lock`，校验磁盘游标未发生回退（$`c_{\text{snap}} \ge c_{\text{last}}^{\text{disk}}`$），渲染临时文件 `AGENTS.md.tmp` 并执行 POSIX 原子重命名 `rename("AGENTS.md.tmp", "AGENTS.md")`。在后台运行期间前台 $`\mathcal{S}_{\text{route}}`$ 新产生的任何交互回合（$`c_t \gt c_{\text{snap}}`$）均完好保留在活跃历史中，留待下一轮增量周期处理。

---

### 2. 后验评估泛函与反事实目标合成方程

设 $`\tau_{\text{day}} = \lbrace \langle \text{Input}_t, \text{OS}_t, \text{Action}_t \rangle \rbrace_{t=a}^{b}`$ 为日间情节窗口。对于窗口内的任意回合 $`t \in [a, b]`$，定义其向后 $`k`$ 步的前瞻观测窗口（Future Lookahead Window）：

```math
F_{t,k} = \lbrace \text{Input}_{t+1}, \text{OS}_{t+1}, \text{Action}_{t+1}, \dots, \text{Input}_{\min(t+k, b)} \rbrace
```

1. **后验契合度评估泛函（$`\mathcal{E}_{\text{dream}}`$）**：
   给定不可变锚定人格 $`P_{0,0}`$、当前记忆 $`M`$ 以及前瞻轨迹 $`F_{t,k}`$，Dream Teacher 对回合 $`t`$ 的日间表现进行后验评分：

   $`\displaystyle s_t^{\text{dream}} = \mathcal{E}_{\text{dream}}\big(\text{Input}_t, \text{OS}_t, \text{Action}_t \;\big|\; F_{t,k}, P_{0,0}, M\big) \in [0, 100]`$

   该评分泛函分解为三个加权维度：
   - **后续反馈与情感共鸣度（$`w_{\text{res}} = 0.4`$）**：评估后续轨迹 $`F_{t,k}`$ 中用户是否展现出持续的倾诉欲、情感安全感与自然互动流，还是出现了受挫退缩、重复解释或生硬冷场；
   - **锚定人格保真度（$`w_{\text{anchor}} = 0.4`$）**：评估 $`(\text{OS}_t, \text{Action}_t)`$ 是否严格契合 $`P_{0,0}`$ 的性格底色、句式节奏、篇幅约束与反 OOC 铁律；
   - **记忆与因果一致性（$`w_{\text{mem}} = 0.2`$）**：评估伴侣是否准确调用了 $`M`$ 中的既有 `keyFacts` 与过往承诺。

2. **反事实后验目标合成（Counterfactual Target Synthesis）**：
   对于所有低于梦境阈值的日间薄弱回合 $`t \in W_{\text{low}} = \lbrace t \in [a, b] \mid s_t^{\text{dream}} \lt \tau_{\text{dream}} \rbrace`$，Dream Teacher 合成后验最优的隐式心理状态与外部回应：

   $`\displaystyle \langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle = g_{\text{Hindsight}}\big(\text{Input}_t, \text{OS}_t, \text{Action}_t, F_{t,k} \;\big|\; P_{0,0}, M\big)`$

   该合成二元组随即作为 $`W_{\text{low}}`$ 上的自监督代理标准答案（Surrogate Ground Truth）。

---

### 3. 锚定保真调制与双门控验证方程

将人格状态 $`P_{u,v}`$ 正交分解为不可变锚定子空间 $`P_{0,0}`$ 与可变适应子空间 $`\Phi_{u,v} = \langle P_{\text{rel}}^{(u,v)}, P_{\text{guard}}^{(u,v)} \rangle`$：

```math
P_{u,v} = P_{0,0} \oplus \Phi_{u,v}, \quad \text{满足锚定投影恒等式 } \Pi_{\text{anchor}}(P_{u,v}) \equiv P_{0,0}
```

在阶段二中，Dream Teacher 根据日间偏差残差 $`\lbrace (\text{OS}_t, \text{Action}_t) \to (\text{OS}_t^\ast, a_t^{\text{dream}}) \rbrace_{t \in W_{\text{low}}}`$ 与阶段一整合的关系事实，仅在适应子空间上计算调制增量：

```math
P_{u,v}' = P_{0,0} \oplus \text{Modulate}\Big(\Phi_{u,v}, \; \lbrace \langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle \rbrace_{t \in W_{\text{low}}}, \; M'\Big)
```

在阶段三中，候选状态对 $`\lbrace P_{u,v}', M' \rbrace`$ 必须同时通过以下两个形式化不等式门控：

1. **反事实重放提升门控（Counterfactual Replay Improvement Gate）**：
   对每个 $`t \in W_{\text{low}}`$，基于 $`\lbrace P_{u,v}', M' \rbrace`$ 重新生成重放预测 $`\widehat{\text{OS}}_t' = g_{\text{OS}}(\text{Input}_t \mid P_{u,v}', M')`$ 与 $`\hat{a}_t' = g_{\text{Act}}(\text{Input}_t, \widehat{\text{OS}}_t' \mid P_{u,v}', M')`$，并对照反事实目标 $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$ 计算重放均分：

   $`\displaystyle \bar{S}_{\text{dream}}(P_{u,v}', M') = \frac{1}{\lvert W_{\text{low}} \rvert} \sum_{t \in W_{\text{low}}} \mathcal{E}\big(\widehat{\text{OS}}_t', \hat{a}_t', \langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle\big) \gt \bar{S}_{\text{dream}}(P_{u,v}, M)`$

2. **锚定基准非退化门控（Anchor Benchmark Non-Regression Gate）**：
   在包含 $`M_{\text{anc}}`$ 道代表性原著/核心设定题目的经典锚定基准集 $`D_{\text{anchor}} = \lbrace (\text{Input}_j^{\text{anc}}, A_j^\ast) \rbrace_{j=1}^{M_{\text{anc}}}`$ 上评测候选人格 $`P_{u,v}'`$：

   $`\displaystyle \bar{S}_{\text{anchor}}(P_{u,v}') = \frac{1}{M_{\text{anc}}} \sum_{j=1}^{M_{\text{anc}}} \mathcal{E}\Big(\text{OS}_j(P_{u,v}'), \hat{A}_j(P_{u,v}'), A_j^\ast\Big) \ge \tau_{\text{anchor}}`$

最终提交至 `AGENTS.md` 的状态转移方程定义为：

```math
\mathbf{s}_{u+1, 0} = \begin{cases}
\lbrace P_{u,v}', M' \rbrace & \text{若 } \bar{S}_{\text{dream}}(P_{u,v}', M') \gt \bar{S}_{\text{dream}}(P_{u,v}, M) \;\land\; \bar{S}_{\text{anchor}}(P_{u,v}') \ge \tau_{\text{anchor}} \\
\lbrace P_{u,v}, M' \rbrace & \text{其他情况}
\end{cases}
```

---

### 4. EMA 核心算法规范演进矩阵

| 规范编号 | 生命周期阶段 | 监督信号来源 | 执行架构模式 | 核心状态产出 |
| --- | --- | --- | --- | --- |
| **[RFC-0003](RFC-0003-ema-training-meta-theory.zh.md) / RFC-0004 / RFC-0005** | 离线服役前训练（`train`） | 原著剧本 Ground Truth $`A_t^\ast`$ | 同步窗口局部搜索与多 Epoch 全局择优 | 初始角色灵魂 $`P_{0,0} = P^\ast`$、基线记忆 $`M_0`$、训练后压缩器 $`C^\ast`$ |
| **[RFC-0006](RFC-0006-memory-compaction.zh.md)** | 运行态与会话边界压缩（`compact`） | 自愈式反射重构分 $`\mathcal{R}(\text{MemoryIndex}, w_x) \ge \tau_{\text{reflect}}`$ | 基于游标幂等的增量折叠与多级归并 | 多级热索引（`L0`、`L1`）+ 冷 JSONL 档案指针 `archiveRef` |
| **RFC-0007（本篇）** | 实时并行与昼夜节律巩固（`dream`） | 延迟后续轨迹 $`F_{t,k}`$ + 后验合成目标 $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$ + 锚定集 $`D_{\text{anchor}}`$ | 非阻塞前台路由会话 + 隔离临时后台工作会话 | 经双门控验证的演化状态 $`\lbrace P_{u+1,0}, M' \rbrace`$ 原子热更新至 `AGENTS.md` |

---

## Invariants
[invariants]: #invariants

### foreground-route-session-non-blocking

> **后台记忆压缩与梦境自省必须完全在隔离的临时工作会话（任务完成即调用 `DELETE /api/sessions/:id` 销毁）中执行，绝不允许阻塞、加锁或向 Actor 的前台路由会话注入任何元评估回合。**

前台路由会话承载着伴侣面向用户的实时第一人称意识流。将后台诊断提示词混入路由会话不仅会拖慢实时响应延迟，还会污染对话历史并破坏角色沉浸感。

### immutable-anchor-personality-lock

> **梦境阶段的每一次人格更新 $`P_{u,v} \to P_{u,v}'`$ 必须严格保持不可变锚定人格子空间恒等（$`\Pi_{\text{anchor}}(P_{u,v}') \equiv P_{0,0}`$），仅允许在关系演进层与反 OOC 行为护栏层进行调制。**

终身陪伴的核心诉求是「关系随岁月日益深厚，但角色灵魂永不蜕变」。在结构层面对 $`P_{0,0}`$ 施加不可变锁，能够从根源上杜绝长期自监督演化导致的性格替换或讨好型坍缩。

### hindsight-target-grounding

> **在无剧本标准答案 $`a_t^\ast`$ 的运行态下，梦境阶段的每一次人格诊断与反事实目标合成 $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$ 必须同时锚定于可观测的后续交互反馈 $`\text{Input}_{t+1 \dots t+k}`$ 与 `anchorPersonality` 核心不变量。**

脱离外部因果反馈的闭门自省极易陷入模型自嗨或幻觉强化。以用户在后续回合 $`t+1 \dots t+k`$ 的真实反应作为后验印证，才能将自监督信号牢牢锚定在真实的人际交互因果之上。

### dual-gate-replay-and-anchor-commit

> **候选梦境演化人格 $`P_{u,v}'`$ 唯有在日间低分窗口的反事实重放中取得严格分数提升（$`\bar{S}_{\text{dream}}(P') \gt \bar{S}_{\text{dream}}(P)`$），且在经典锚定基准集上保持零退化（$`\bar{S}_{\text{anchor}}(P') \ge \tau_{\text{anchor}}`$）时，方可执行向 `AGENTS.md` 的原子提交。**

仅在近期日间片段上验证容易过拟合当天的偶发语境，而仅在静态基准集上验证则无法接纳新形成的关系纽带。双门控机制确保了每一次写入生产环境的更新既改善了近期相处体验，又毫发无损地守护了初始角色灵魂。

---

## Drawbacks
[drawbacks]: #drawbacks

1. **后台并行与夜间梦境带来的额外 Token 消耗**：
   执行后验评分、反事实目标合成以及双门控重放会在前台对话之外消耗额外的后台推理预算。
   - *缓解方向*：阶段二与阶段三的反事实重放采用按需触发机制——仅当阶段一产生了新 L0 场景批次且后验探测发现存在 $`s_t^{\text{dream}} \lt \tau_{\text{dream}}`$ 的薄弱回合时才启动深度重放；平稳高分的日常窗口仅执行阶段一的增量压缩。

2. **前瞻轨迹 $`F_{t,k}`$ 中外部现实干扰带来的信噪比问题**：
   用户在回合 $`t+1`$ 突然沉默或简短结束对话，可能源于现实世界的外力打断（如突然开会或登机），而非对伴侣回合 $`t`$ 回应的不满。
   - *缓解方向*：后验评估泛函 $`\mathcal{E}_{\text{dream}}`$ 将锚定人格保真度（$`0.4`$）与记忆一致性（$`0.2`$）同后续互动反馈（$`0.4`$）联合加权；当 $`F_{t,k}`$ 仅表现为单纯的物理时间静默而无负面语言信号时，评估器将其视为中性外部中断而不扣减回合 $`t`$ 的得分。

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### 为什么采用隔离的并行临时工作会话，而非在原会话内插入隐藏「自我反思回合」？

若让 Actor 定期在自己的前台路由会话内执行「隐藏自我反思」，不仅会在会话记录中残留工具调用与元分析文本、加速撑爆上下文窗口，还极易导致元指令口吻泄露到随后的角色台词中。基于只读轨迹快照派生临时工作会话，并通过原子替换 `AGENTS.md` 完成状态同步，实现了「伴侣第一人称意识流」与「Teacher 元优化回路」的彻底解耦。

### 为什么采用基于后续轨迹的后验反事实重放，而非让用户显式点击「点赞 / 点踩」（Online RLHF）？

要求人类用户在日常倾诉中频繁给伴侣的每一句话打勾或打叉，会彻底击碎陪伴的第四面墙——没有人愿意像数据标注员一样对待自己的灵魂伴侣。从自然的后续对话流 $`\text{Input}_{t+1 \dots t+k}`$ 中提取隐式共鸣信号并合成反事实目标 $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$，使伴侣具备了如同人类一般在睡梦中静默复盘、自我体悟与成长的能力。

---

## Prior art
[prior-art]: #prior-art

- **互补学习系统（CLS）与海马体-新皮层睡眠记忆巩固理论（McClelland et al., 1995; Stickgold, 2005）**：日间清醒期快速编码情景记忆，夜间睡眠期通过重放（Replay）完成记忆抽象、去重与皮层长期整合；本 RFC 的阶段一多级记忆归并与阶段二/三反事实重放正是该认知机制的计算实现。
- **事后经验回放（Hindsight Experience Replay, HER, Andrychowicz et al., 2017）与 Reflexion（Shinn et al., 2023）**：利用事后结果重新标注历史轨迹以构造稠密自监督学习信号；本 RFC 将其推广至由隐式心理状态中介的认知二元组 $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$。
- **EMA 训练元理论（[RFC-0003](RFC-0003-ema-training-meta-theory.zh.md)）与记忆压缩引擎（[RFC-0006](RFC-0006-memory-compaction.zh.md)）**：提供了耦合状态向量 $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$ 的理论框架以及阶段一所调用的游标幂等 `compact + reflect` 压缩算子。

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

1. **梦境启发的主动破冰策略（「晨间思绪 / Waking Thoughts」）**：
   当夜间梦境循环合成了高显著度的体悟，或从早期 L0 场景中回溯出尚未兑现的约定时，伴侣应当遵循何种策略在次日清晨主动向用户发起问候，还是将该体悟暂存于初始 `OS` 中等待用户先开口？
2. **前瞻窗口步长 $`k`$ 的跨渠道自适应**：
   在高频短句连发的即时通讯渠道（$`k = 5\text{--}8`$ 条短消息）与慢节奏长文往来的异步社区渠道（$`k = 1\text{--}2`$ 条长回复）之间，前瞻窗口 $`F_{t,k}`$ 的步长 $`k`$ 应如何根据渠道特征动态调节？

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **可解释梦境日记与成长工作台（Dream Journal Workbench）**：将每次梦境自省提炼的体悟与关系理解增量持久化为结构化的可读梦境日志（`dream-log/YYYY-MM-DD.md`），支持在伴侣工作台中直观审阅伴侣的心路成长历程。
- **多分支反事实梦境束搜索（Multi-Branch Counterfactual Dream Rollouts）**：在算力充裕的深度休眠期并行采样 $`B \gt 1`$ 个不同调制方向的候选状态 $`\lbrace P_{u,v}^{(b)}, M^{(b)} \rbrace`$，综合日间重放增益与锚定基准表现选出帕累托最优分支。

---

## Changes

### v1.0.0

- 初始版本：规范梦境自省与后台并行记忆巩固引擎（`dream` 算法），定义非阻塞前台路由会话与隔离临时工作会话架构、无剧本标准答案下的后验反事实目标合成 $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$，以及带反事实重放与锚定基准双门控的三阶段梦境自省闭环。
