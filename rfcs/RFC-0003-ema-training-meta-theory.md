# RFC-0003 Meta-Theory of EMA Training

[中文版](RFC-0003-ema-training-meta-theory.zh.md)

- Feature Name: `ema-training-meta-theory`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: Pending

> **Status & Provenance**:
> - State: draft (Draft for Board Review)
> - Rev: v1.0.0

## Summary
[summary]: #summary

This RFC establishes the **Meta-Theory of EMA Training**: a mathematical and cognitive framework for how an EverMemoryArchive (EMA) companion agent jointly evolves its **Personality** ($`P`$), **Memory Archive and Index** ($`M`$), and **Memory Compression Operator** ($`C`$) through recursive self-improvement (RSI) over sequential interaction trajectories $`D`$.

Rather than allowing engineering complexity or compute constraints to prematurely narrow our research horizon, this RFC formulates companion cognition from first principles as a latent-state generative process ($`\text{Input} \to \text{OS} \to \text{Action}`$). It defines an end-to-end training loop comprising unscored cold-start bootstrapping ($`q_{1\dots N}`$), windowed memory compaction (`compact`) coupled with personality refinement, local window line-search propagating coupled state vectors $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$, and multi-epoch global trajectory selection. Finally, it delineates the roadmap connecting this meta-theory to its companion specifications: **RFC-0004** (First-Generation In-Context Memory-Index + OS Modeling) and **RFC-0005** (First-Generation Script-to-Personality-and-Memory Inverse Algorithm).

---

## Motivation
[motivation]: #motivation

### 1. Refusing to Let Implementation Difficulty Constrain Research Vision

Existing roleplay and companion architectures frequently compromise on theoretical completeness early in design: substituting static character cards for evolving personalities, and replacing learnable memory abstractions with rigid summarization heuristics or blind vector Top-K retrieval. When tested across long-horizon trajectories (such as visual novel scripts spanning $`2000+`$ turns or months of real human companionship), these shortcuts manifest as persona drift (out-of-character behavior), forgotten foreshadowing, and broken emotional causality.

EMA requires a rigorous **Meta-Theory** first: defining from first principles how an ideal cognitive agent simultaneously learns *who it is* ($`P`$), *what it has experienced and remembered* ($`M`$), and *how to compress and reconstruct its past* ($`C`$), unobstructed by premature implementation shortcuts.

### 2. Bridging the Latent Psychological Gap: $`\text{Input} \to \text{OS} \to \text{Action}`$

Observable interaction logs and narrative scripts provide external stimuli ($`\text{Input}_t`$) and ground-truth external responses ($`\text{Action}_t^{\ast}`$), but rarely record the character's continuous internal psychological transitions ($`\text{OS}_t`$ — inner monologue, affective shift, and hidden intent).

Training or prompting an agent to map $`\text{Input}_t \to \text{Action}_t^{\ast}`$ directly suffers from two fundamental flaws:
- The agent mimics surface linguistic patterns without grasping why a character reacts in a seemingly contradictory or nuanced manner;
- Recorded memories degrade into flat third-party event logs devoid of first-person emotional causality.

By explicitly requiring the agent to generate a latent inner state $`\text{OS}_t`$ conditioned on $`(P, M)`$ prior to generating $`\text{Action}_t`$, and having a Teacher verify $`\text{OS}_t`$ against the ground-truth $`\text{Action}_t^{\ast}`$ before teacher-forcing the committed action, flat scripts are elevated into causal cognitive trajectories $`\text{MemoryItem} = \langle \text{Input}, \text{OS}, \text{Action} \rangle`$.

### 3. Endogenous Coupling of Personality $`P`$, Memory $`M`$, and Compression $`C`$

A companion's memory is not an objective external recording; it is **experience interpreted through the lens of its personality**:

$$
\text{Memory} = f_C(D, P)
$$

- Modifying Personality $`P`$ alters the internal psychological state $`\text{OS}_t`$ generated in response to historical stimuli $`\text{Input}_t`$, which directly changes the committed $`\text{MemoryItem}_t`$ and the resulting memory archive $`M`$;
- Modifying the compression operator $`C`$ (itself parameterized as an agent prompt) alters the compressed index $`\text{MemoryIndex}_{0,x} = \text{compress}_C(\lbrace \text{MemoryItem}_n \rbrace)`$, governing what the agent can reflect upon and reconstruct in future turns.

Consequently, $`P`$, $`M`$, and $`C`$ are coupled variables in a unified dynamical system and must be optimized jointly.

### 4. Long-Horizon Credit Assignment via Windowed Compaction & Local Optimization

Across a dataset $`D`$ of $`2000+`$ sequential questions, waiting until the end of a full epoch to update $`P`$ results in severe credit-assignment decay: an inaccurate early personality $`P_{0,0}`$ not only scores poorly across thousands of turns, but also contaminates every intermediate $`\text{OS}_t`$ written into memory.

Aligning personality updates with windowed memory compaction (`compact`) boundaries—and enabling the Teacher to repeatedly train on local question windows $`[X, Y]`$ (e.g., improving window score from $`50`$ to $`75`$) before advancing with the coupled state vector $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$—transforms intractable long-horizon optimization into a sequence of tractable local subproblems.

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. Core Conceptual Primitives

The EMA training meta-theory is built upon six foundational primitives:

1. **Sequential Dataset** ($`D`$):
   A narrative script or interaction history is normalized into an ordered sequence of $`T`$ tasks (e.g., $`T = 2000+`$ questions for a target companion character):

   $`\displaystyle D = \lbrace q_1, q_2, \dots, q_T \rbrace, \quad q_t = (\text{Input}_t, \text{Action}_t^{\ast})`$

   where $`\text{Input}_t`$ encapsulates all observable dialogue and environmental events preceding the character's turn, and $`\text{Action}_t^{\ast}`$ is the ground-truth action and dialogue from the source script.

2. **Latent Inner State** ($`\text{OS}_t`$):
   Upon receiving $`\text{Input}_t`$, the EMA agent consults its current Personality $`P`$ and Memory $`M`$ to generate an explicit internal state transition (`set_os`, e.g., shock, protective alertness, shyness), which then conditions its external reaction (`react`).

3. **Episodic Memory Item** ($`\text{MemoryItem}_t`$):
   After the Teacher evaluates step $`t`$, the agent's validated $`\text{OS}_t`$ is paired with the ground-truth action $`\text{Action}_t^{\ast}`$ (via Teacher Forcing) and appended as an atomic memory tuple:

   $`\displaystyle \text{MemoryItem}_t = \langle \text{Input}_t, \text{OS}_t, \text{Action}_t^{\ast} \rangle`$

4. **Single-Level Memory Index & Compression Operator** ($`C`$):
   At each compaction boundary (`compact`), a scene's sequence of raw memory items $`\lbrace \text{MemoryItem}_n \rbrace`$ is compressed by an agent prompt $`C`$ into an annotated, single-level in-context index:

   $`\displaystyle \text{MemoryIndex}_{u,x} = \text{compress}_C(\lbrace \text{MemoryItem}_n \rbrace)`$

   Rather than over-engineering multi-tier memory hierarchies prematurely, the baseline architecture operates on a **single-level in-context `MemoryIndex`** enriched with semantic annotations that the agent can reflect upon or decompress on demand.

5. **Coupled State Vector** ($`\mathbf{s}_{u,v} = \lbrace P_{u,v}, M_{u,v} \rbrace`$):
   At epoch $`u`$ and compaction step $`v`$, the optimization state consists of the current personality $`P_{u,v}`$ paired with the memory state $`M_{u,v}`$ synthesized under that personality trajectory.

6. **Teacher Agent**:
   The meta-optimizer holding access to Ground Truth $`\text{Action}_t^{\ast}`$. The Teacher initializes $`P_{0,0}`$, scores student predictions $`(\text{OS}_t, \text{Action}_t)`$, diagnoses persona/memory discrepancies, and mutates $`P`$ (and $`C`$) across local windows and global epochs.

---

### 2. End-to-End RSI Training Lifecycle

```
Dataset D = {q_1, q_2, ..., q_T}  (T = 2000+ Sequential Questions)
=======================================================================================

[Phase 0: Initialization]
  Teacher synthesizes initial personality P_{0,0}; initial memory M_{0,0} = ∅

[Phase 1: Cold-Start Window q_{1..N} (Unscored Warmup)]
  Context = (Personality: P_{0,0}, Memory: ∅, History: raw q_{1..t-1})
  For t = 1..N:
    1. Input_t ──(P_{0,0}, History)──> generate OS_t ──> predict React_t
    2. Force-override Action_t = GT_Action_t; append History += <Input_t, OS_t, GT_Action_t>
  ──> First Compact Boundary:
        MemoryIndex_{0,1} = compress(History_{1..N})
        Teacher refines personality from warmup traces: P_{0,0} ──> P_{0,1}

[Phase 2: Windowed Evaluation & Local Greedy Optimization q_{X..Y} (Scored + Local RSI)]
  Enter window [X..Y] with state vector {P_{u,v}, M_{u,v}}:
    ┌───────────────────────────────────────────────────────────────────────┐
    │ 1. Answer questions X..Y using Context = (P_{u,v}, MemoryIndex, Hist) │
    │ 2. Teacher scores window: Score(X..Y; P_{u,v}) (e.g., score = 50)     │
    │ 3. [Local Optimization Loop]:                                         │
    │    Teacher diagnoses mismatches, mutates P_{u,v} ──> P_{u,v}'         │
    │    Re-answer questions X..Y with P_{u,v}' ──> score rises to 75       │
    │ 4. Compact optimal window trajectory (P_{u,v}') to produce M_{u,v}'   │
    └───────────────────────────────────────────────────────────────────────┘
  ──> Propagate coupled state vector {P_{u,v}', M_{u,v}'} to next window [Y..Y+Z]

[Phase 3: Epoch Completion & Multi-Epoch Evolution (Epoch u = 0..n)]
  Finish all 2000+ questions ──> obtain P_{0, m_0} and Memory_0 = f(D, P_0)
  Teacher trains across epochs u = 1..n ──> obtain P_{n, m_n}, Memory_n = f(D, P_{n, m_n})
  Select globally highest-scoring pair: (P*, Memory*) = argmax Score(D; P_{u, m_u}, Memory_u)
```

#### (1) Single-Step Execution & Teacher Verification Walkthrough

Consider training a target companion character (*Character A*) on a scene where an unstable stranger suddenly loses control:

1. **Input Construction**: All observable lines preceding Character A's reaction are packaged as `<Input>`:
   ```xml
   <Input> <name>Stranger</name> Even the most important memories... were cast aside... </Input>
   <Input> <name>Stranger</name> Who... who am I... </Input>
   <Input> <name>Stranger</name> Ahh... ahhhhh...! </Input>
   ```
2. **Student Inference** ($`\text{OS} \to \text{React}`$):
   - Conditioned on $`(P_{u,v}, \text{MemoryIndex}, \text{History})`$, the EMA agent generates its inner psychological transition:
     `set_os("Shock and immediate protective vigilance: the stranger is losing control, I must shield my partner at once")`
   - Conditioned on that `os`, the agent predicts an external reaction `react`.
3. **Teacher Evaluation & Action Override**:
   - The Teacher inspects the Ground Truth: `「Watch out, step back!」` (and the accompanying action description: *Character A reacted immediately to the anomaly, stepping forward to shield her partner*).
   - The Teacher compares the agent's `os` against the Ground Truth:
     - **Case A (`os` is inconsistent with Ground Truth)**: Signal that Personality $`P`$ requires adjustment (`adjust_personality`).
     - **Case B (`os` is consistent with Ground Truth)**: Evaluate whether `react` is reasonably aligned with the Ground Truth action in intent and persona voice (exact verbatim match is not required; behavioral plausibility is sufficient).
   - **Commit**: Retain the agent's `os`, force-override `action` with the Ground Truth action, and append the memory item `{inputs, os, actions}`.

#### (2) Cold-Start Window ($`q_{1\dots N}`$) and Compaction Transitions

- For the first $`N`$ questions ($`q_{1\dots N}`$), the context window is ample, so long-term memory starts empty ($`\text{Memory} = \varnothing`$) and raw `History` is placed directly in context to generate initial `os` and memory items.
- **These first $`N`$ questions are unscored**.
- At every `compact` boundary, the Teacher updates Personality ($`P_{0,0} \to P_{0,1}`$) while `History` is compressed into `MemoryIndex`.
- For subsequent questions $`N \dots M`$, the agent operates with `context = (personality = P_{0,1}, memory_index, history)` and is formally scored.

#### (3) Local Window Line-Search and State Vector Propagation

Without loss of generality, suppose the agent is answering questions $`X \dots Y`$ with personality $`P_{u,v}`$ and achieves a score of **50**:
- The Teacher can immediately mutate $`P_{u,v} \to P_{u,v}'`$ and re-run questions $`X \dots Y`$, raising the window score to **75**.
- While $`P_{u,v}'`$ is a local optimum on $`X \dots Y`$ rather than a guaranteed global optimum, re-answering $`X \dots Y`$ under $`P_{u,v}'`$ also yields a higher-fidelity psychological trace and compacted memory $`M_{u,v}'`$.
- When advancing to questions $`Y \dots Y+Z`$, the Teacher carries forward the coupled state vector $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$ (or a vector of top candidate branches).

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Formal Dynamical System Equations

Let dataset $`D = \bigcup_{v=0}^{m} W_v`$ be partitioned into an unscored warmup window $`W_0 = \lbrace q_1, \dots, q_N \rbrace`$ and $`m`$ scored windows $`W_1, \dots, W_m`$.

For any question $`q_t \in W_v`$ ($`t \gt N`$), given current personality $`P`$, accumulated single-level memory index $`I_{\lt v} = \lbrace \text{MemoryIndex}_{u,1}, \dots, \text{MemoryIndex}_{u,v-1} \rbrace`$, and within-window sliding history $`H_t`$:

1. **Latent-Mediated Forward Policy**:

   $`\displaystyle \text{OS}_t = g_{\text{OS}}(\text{Input}_t \mid P, I_{\lt v}, H_t)`$

   $`\displaystyle \hat{A}_t = g_{\text{Act}}(\text{Input}_t, \text{OS}_t \mid P, I_{\lt v}, H_t)`$

2. **Teacher Evaluation Functional**:

   $`\displaystyle s_t = \mathcal{E}(\text{OS}_t, \hat{A}_t, A_t^{\ast}) \in [0, 100]`$

   scoring psychological alignment between $`\text{OS}_t`$ and $`A_t^{\ast}`$ first, and behavioral plausibility between $`\hat{A}_t`$ and $`A_t^{\ast}`$ second.

3. **Teacher-Forced Experience Commit**:

   $`\displaystyle \text{MemoryItem}_t \leftarrow \langle \text{Input}_t, \text{OS}_t, A_t^{\ast} \rangle, \quad H_{t+1} \leftarrow H_t \cup \lbrace \text{MemoryItem}_t \rbrace`$

4. **Scene / Window Compaction**:

   $`\displaystyle \text{MemoryIndex}_{u,v} = \text{compress}_C(H_{W_v}), \quad M_{u,v} = M_{u,v-1} \cup \lbrace \text{MemoryIndex}_{u,v} \rbrace`$

5. **Global Optimization Objective**:

   $`\displaystyle (P^{\ast}, M^{\ast}, C^{\ast}) = \arg\max_{(P_{u,m_u}, M_u, C_u)} \frac{1}{T - N} \sum_{t=N+1}^{T} \mathcal{E}\big(\text{OS}_t(P, M, C), \hat{A}_t(P, M, C), A_t^{\ast}\big)`$

---

### 2. Trainability of the Compression Operator $`C`$

Because $`\text{MemoryIndex}_{0,x} = \text{compress}_C(\lbrace \text{MemoryItem}_n \rbrace)`$ is executed by an agent prompt $`C`$, **the compression algorithm itself is trainable**:
- Its objective score $`S_{\text{compress}}(C)`$ is defined by the agent's ability to **reflect back (reconstruct)** the underlying experiential content of $`\lbrace \text{MemoryItem}_n \rbrace`$ from $`\text{MemoryIndex}_{0,x}`$ alone, together with its downstream question-answering score gain:

  $`\displaystyle S_{\text{compress}}(C) = \mathcal{R}\Big(\text{reflect}\big(\text{MemoryIndex}_{0,x}\big), \; \lbrace \text{MemoryItem}_n \rbrace\Big) + \lambda \cdot \Delta S_{\text{downstream}}\big(\text{MemoryIndex}_{0,x}\big)`$

---

### 3. The Trilogy Architecture: RFC-0003, RFC-0004, and RFC-0005

This RFC establishes the theoretical umbrella for two directly following specifications:

| RFC | Title & Scope | Core Mechanism |
| --- | --- | --- |
| **RFC-0003 (This Document)** | **Meta-Theory of EMA Training** | Formulates the coupled optimization space $`\Theta = (P, M, C)`$, unscored warmup $`q_{1\dots N}`$, windowed `compact` updates, local window line-search with state vectors $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$, and multi-epoch global selection. |
| **RFC-0004** | **First-Generation Personality and Memory Modeling (`In-Context Memory-Index + OS`)** | Specifies the concrete runtime loop ($`\text{Input} \to \text{OS} \to \text{Action}`$), $`\text{MemoryItem} = \langle \text{Input}, \text{OS}, \text{Action} \rangle`$, single-level $`\text{MemoryIndex}_{0,x} = \text{compress}(\text{Scene MemoryItems})`$, and training the `compress` prompt via reflection scoring. |
| **RFC-0005** | **First-Generation Script-to-Personality-and-Memory Algorithm** | Specifies the inverse distillation algorithms: (1) holding $`P`$ fixed to reverse-engineer optimal memory formats; and (2) adjusting $`P`$ inside the training loop to jointly reverse-engineer both Personality $`P`$ and Memory $`M`$ from raw scripts. |

---

## Invariants
[invariants]: #invariants

### latent-os-mediation

> **Every external reaction predicted by an EMA agent must be mediated by an explicit latent psychological state (`OS`) conditioned on Personality and Memory, and every committed `MemoryItem` must record `<Input, OS, Action>`.**

Without explicit `OS` mediation, training degenerates into surface text imitation and memories lose first-person psychological causality.

### teacher-forced-trajectory-grounding

> **After each step is scored, the action committed to `MemoryItem` and sliding history must be force-overridden with the Ground Truth action, preventing trajectory divergence across long-horizon sequences.**

Over $`2000+`$ causally linked turns, feeding unaligned student actions back into history would quickly push the conversation off the source narrative manifold, invalidating subsequent ground-truth labels.

### coupled-state-vector-propagation

> **Whenever local window optimization updates Personality from $`P_{u,v}`$ to $`P_{u,v}'`$, the compacted memory $`M_{u,v}'`$ must be synthesized from the trajectory generated under $`P_{u,v}'`$, propagating the coupled vector $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$ to subsequent windows.**

Because Memory is a function of both dataset $`D`$ and Personality $`P`$, $`M = f(D, P)`$, a personality that scored $`75`$ produces higher-fidelity `OS` traces than one that scored $`50`$; keeping their $`(P', M')`$ state coupled preserves internal coherence.

### reflective-compression-evaluability

> **The single-level `compress` operator must be treated as a trainable prompt policy whose score is determined by the agent's ability to reflect from `MemoryIndex_{0,x}` back to the essential content of the underlying `MemoryItem` sequence.**

Measuring compression quality by reflective reconstruction and downstream QA score eliminates arbitrary hand-tuned summarization rules.

---

## Drawbacks
[drawbacks]: #drawbacks

1. **Compute Cost of Multi-Pass Local & Global Rollouts**:
   Running local retries on windows $`[X, Y]`$ and multiple epochs over $`2000+`$ items requires substantial LLM inference budget.
   - *Mitigation*: Trigger local retries only when window scores fall below a threshold, and leverage batch window evaluation at `compact` boundaries.

2. **Local Overfitting Risk**:
   A personality $`P_{u,v}'`$ greedily tuned to raise score from $`50 \to 75`$ on window $`[X, Y]`$ may overfit to scene-specific context and underperform on $`[Y, Y+Z]`$.
   - *Mitigation*: Propagate a vector beam of candidate pairs $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$ and select the globally best-generalizing trajectory across epochs.

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### Why a Single-Level In-Context `MemoryIndex` First?

Across a full-length visual novel (~200 scenes, ~2000 turns), compressing each scene into a single-level `MemoryIndex` entry yields roughly 100–200 index entries (~3k–5k tokens total), which fits comfortably inside modern LLM context windows. Avoiding premature multi-tier hierarchies eliminates cascading summarization loss and makes the single-level `compress` prompt directly trainable via reflection scoring.

### Why Context-Space RSI Instead of Weight Fine-Tuning (SFT/RL)?

Fine-tuning model weights bakes episodic memories into opaque parameters, sacrificing interpretability, instant memory inspection/decompression, and cross-model portability. Optimizing explicit $`(P, M, C)`$ artifacts in context space yields human-auditable persona sheets and structured memory archives.

---

## Prior art
[prior-art]: #prior-art

- **Teacher Forcing in Sequence Learning (Williams & Zipser, 1989)**: Grounds sequential state transitions on ground-truth history; extended here to hybrid `<Input, Student_OS, GT_Action>` memory synthesis.
- **Agentic Context Engineering (ACE), OPRO, and TextGrad**: Iterative prompt/playbook refinement from execution traces; generalized here to the coupled dynamical system $`\Theta = (P, M, C)`$.
- **Penguin Benchmark & Evaluation Framework**: Standardized case-level scoring and iterative calibration loops.

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

This RFC intentionally leaves four concrete modeling and algorithmic questions open to be resolved in **RFC-0004** and **RFC-0005**:

1. **Memory Format (`memory format`)**:
   What is the optimal structural schema and annotation syntax for `MemoryItem = <Input, OS, Action>` and single-level `MemoryIndex_{0,x}` so that the agent can scan the index in-context and reflect/decompress accurately?
2. **Memory Contents (`what are contained in memory`)**:
   Which exact semantic, affective, relational, and causal dimensions must be preserved inside `MemoryItem` and `MemoryIndex_{0,x}`, and what transient dialogue filler should be discarded during compression?
3. **Personality Format (`format of personality`)**:
   How should Personality $`P`$ be parameterized and structured so that it reliably steers `OS` and `Action` generation while remaining resilient against catastrophic forgetting during repeated updates?
4. **Personality Update Rule (`how to update personality to get better score`)**:
   How should the Teacher diagnose failure traces and compute updates $`P_{u,v} \to P_{u,v}'`$ to achieve monotonic score improvements (both locally from $`50 \to 75`$ on $`[X, Y]`$ and globally across epochs $`P_{n,m_n}`$)?

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **RFC-0004**: Formalizes the first-generation `In-Context Memory-Index + OS` model, decompression/reflection mechanics, and trainable `compress` prompt optimization.
- **RFC-0005**: Formalizes the inverse Script-to-Personality-and-Memory distillation algorithm (both fixed- $`P`$ memory format inversion and joint $`(P, M)`$ closed-loop discovery).
- **Pareto Beam Search over $`\lbrace P, M \rbrace`$ State Vectors**: Maintaining diverse persona-memory hypotheses across narrative branches.

---

## Changes

### v1.0.0

- Initial version establishing the Meta-Theory of EMA Training, the RFC-0003 / RFC-0004 / RFC-0005 roadmap, and the four core unresolved questions.
