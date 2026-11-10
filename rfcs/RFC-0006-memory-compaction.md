# RFC-0006 Memory Compaction and Hierarchical Indexing Engine

[中文版](RFC-0006-memory-compaction.zh.md)

- Feature Name: `memory-compaction`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)

> **Status & Provenance**:
> - State: draft (Draft for Board Review)
> - Rev: v1.0.0

## Summary
[summary]: #summary

This RFC specifies the **Memory Compaction and Hierarchical Indexing Engine (`compact` algorithm)** for EverMemoryArchive (EMA). It generalizes the training-time scene compression operator $`C`$ introduced in [RFC-0003](RFC-0003-ema-training-meta-theory.md) and [RFC-0004](RFC-0004-in-context-memory-index-and-os.md) into a continuous, self-healing, multi-level runtime and session-boundary memory compaction subsystem.

While offline script training operates over pre-segmented narrative scenes, a live lifelong companion faces an unbounded stream of multi-channel interactions without predefined scene markers. This specification introduces four core mechanisms to bridge training-time compression and lifelong runtime operation:
1. **Dynamic Episodic Boundary Detection**: Slicing active uncompacted turns $`\lbrace \text{MemoryItem}_t \rbrace`$ into coherent episodic windows $`w_x`$ via a composite trigger over turn/token watermarks ($`N_{\text{max}}`$), temporal idle gaps ($`\Delta t_{\text{idle}}`$), and semantic/channel context shifts;
2. **Self-Healing `compact + reflect` Closed Loop**: Folding $`w_x \xrightarrow{C} \text{MemoryIndex}_{0,x}`$ (`summary`, `innerOSArc`, `keyFacts`, `archiveRef`), scoring reconstructibility $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$, automatically re-compacting with injected `missingDetail` diagnostics whenever $`\mathcal{R} \lt \tau_{\text{reflect}}`$, and mutating the compression prompt policy $`C \to C'`$ when recurring detail loss is detected;
3. **Hierarchical Multi-Level Rollup ($`\text{MemoryIndex}_{0,x} \to \text{MemoryIndex}_{1,y}`$)**: Recursively applying the `compact + reflect` operator across memory tiers so that when L0 scene indices exceed capacity $`K_{\text{L0}}`$, contiguous L0 batches fold into L1 chapter/epoch indices $`\text{MemoryIndex}_{1,y}`$ while keeping recent L0 indices in hot context (`AGENTS.md`) and archiving raw trajectories to cold JSONL storage (`archiveRef`);
4. **Cursor-Idempotent Incremental Compaction**: Tracking a monotonic `lastCompactedCursor` ledger so repeated, retried, or background compaction runs over an active session never duplicate memory indices.

---

## Motivation
[motivation]: #motivation

### 1. From Static Script Scenes to Unbounded Live Streams

During offline script training ([RFC-0003](RFC-0003-ema-training-meta-theory.md)), the dataset $`D = \bigcup_{v=0}^{m} W_v`$ is naturally partitioned by chapter and scene boundaries authored in the source script. At runtime, however, a companion interacts with a user across days, months, and years over continuous sessions and asynchronous channels. Waiting until a session terminates—or slicing strictly at arbitrary fixed token counts in the middle of an emotional exchange—either starves long-running sessions of compacted memory or severs causal psychological arcs ($`\text{Input}_t \to \text{OS}_t \to \text{Action}_t`$) across incompatible boundaries.

EMA therefore needs a **Dynamic Episodic Boundary Detector** that identifies natural episodic breakpoints online from turn/token watermarks, temporal pauses, and semantic or channel shifts while retaining a trailing continuity buffer.

### 2. Preventing Silent Information Decay via Self-Healing Reflection

A single-pass LLM summarization call is inherently lossy: it frequently drops subtle promises, specific named entities, sensory anchors, or the nuanced turning points in the companion's inner monologue (`OS`). Once raw turns are evicted from the active window, any detail omitted from $`\text{MemoryIndex}_{0,x}`$ is effectively forgotten during normal in-context inference.

In [RFC-0003](RFC-0003-ema-training-meta-theory.md), reflective reconstruction $`\mathcal{R}`$ was formulated as an evaluation metric for $`C`$. At runtime, we elevate $`\mathcal{R}`$ from a passive metric into an **active self-healing gate**: every newly compacted index $`\text{MemoryIndex}_{0,x}`$ is immediately probed for reconstructibility against its source window $`w_x`$. If $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) \lt \tau_{\text{reflect}}`$, the compaction engine extracts the exact `missingDetail` residuals and re-runs compaction in a closed loop before committing the index, and evolves $`C \to C'`$ when systematic blind spots recur.

### 3. Scaling Beyond Single-Level Context Limits over Lifelong Horizons

As established in [RFC-0003](RFC-0003-ema-training-meta-theory.md), a single-level L0 `MemoryIndex` comfortably holds $`100\text{--}200`$ scenes (~$`3\text{k--}5\text{k}`$ tokens), covering an entire visual novel or several weeks of daily companionship. Yet a lifelong companion operating over years will accumulate thousands of L0 scene indices. Placing thousands of L0 entries directly into `AGENTS.md` eventually exhausts the hot context budget and degrades attention precision.

Rather than abandoning in-context indexing for opaque vector-only RAG, EMA introduces **Hierarchical Multi-Level Rollup**: recursively applying the exact same verifiable `compact + reflect` operator to fold contiguous batches of older L0 scene indices into L1 chapter/epoch indices $`\text{MemoryIndex}_{1,y}`$, while keeping recent L0 indices hot and linking every index tier down to cold JSONL archives via `archiveRef`.

### 4. Concurrency and Crash Safety in Incremental Compaction

In a live system where compaction may be triggered at session boundaries, on watermark thresholds, or asynchronously by background consolidation workers (**RFC-0007**), an interrupted retry or overlapping run over the same conversation trace could easily re-compact already indexed turns. Tracking a strict monotonic cursor (`lastCompactedCursor`) makes incremental compaction idempotent under arbitrary retries.

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. Core Data Structures

The runtime compaction engine operates on three primary artifacts:

1. **Committed Episodic Turn (`MemoryItem`)**:
   Every completed runtime turn $`t`$ produces a monotonically cursor-stamped tuple:
   ```json
   {
     "cursor": 142,
     "timestamp": "2026-11-10T21:14:05Z",
     "channel": "direct-chat",
     "inputs": ["<Input><name>User</name>I finally passed the architecture defense today, though I nearly froze on the last question.</Input>"],
     "os": "Relieved pride mixed with gentle teasing: User worked sleepless nights for this defense; I want to celebrate wholeheartedly while playfully reminding them of their nervous habit.",
     "actions": ["(Exhales a long breath and smiles warmly) Look at you—still standing, and officially past the hardest hurdle. Here, sit down before your legs give out; tell me what that last question was."]
   }
   ```

2. **L0 Scene Memory Index (`MemoryIndex_{0,x}`)**:
   Produced by folding a contiguous episodic window $`w_x`$ of `MemoryItem` entries:
   ```json
   {
     "id": "L0-scene-0018",
     "level": 0,
     "turnRange": [129, 148],
     "timestampRange": ["2026-11-10T20:40:12Z", "2026-11-10T21:25:30Z"],
     "summary": "User returned after passing their system architecture defense; Companion celebrated with them and listened as User unpacked the tense final Q&A.",
     "innerOSArc": "Anxious anticipation waiting for User's result -> warm relief and quiet pride upon hearing they passed -> protective determination to make sure User rests tonight.",
     "keyFacts": [
       "User passed the system architecture defense on 2026-11-10.",
       "User promised to take the entire weekend off without opening work repositories.",
       "Companion promised to wake User at 10:00 AM tomorrow with hand-drip coffee."
     ],
     "reflectionScore": 92,
     "archiveRef": "archive/L0/L0-scene-0018.jsonl"
   }
   ```

3. **L1 Chapter / Epoch Memory Index (`MemoryIndex_{1,y}`)**:
   Produced when active L0 indices exceed capacity $`K_{\text{L0}}`$, folding a contiguous batch of $`B_{\text{L0}}`$ oldest L0 entries:
   ```json
   {
     "id": "L1-epoch-0003",
     "level": 1,
     "childIds": ["L0-scene-0001", "L0-scene-0002", "...", "L0-scene-0020"],
     "turnRange": [1, 310],
     "timestampRange": ["2026-11-01T08:00:00Z", "2026-11-10T21:25:30Z"],
     "summary": "Early November preparation arc: Companion accompanied User through ten days of late-night rehearsals leading up to the successful architecture defense.",
     "innerOSArc": "Initial cautious attentiveness to User's stress -> growing shared camaraderie during late-night debugging -> deep mutual trust and celebratory warmth after the defense.",
     "keyFacts": [
       "User completed and passed the November system architecture defense.",
       "Established late-night study routine: herbal tea after 23:00 and mandatory rest reminders.",
       "Pending promise: weekend break following the defense."
     ],
     "reflectionScore": 89,
     "archiveRef": "archive/L1/L1-epoch-0003-children.json"
   }
   ```

---

### 2. End-to-End Runtime `compact` Pipeline

```
Live Session Stream: {MemoryItem_t} (cursor c_t > lastCompactedCursor)
=======================================================================================

[Step 1: Cursor Filter & Dynamic Episodic Boundary Detection]
  Filter uncompacted items: U = { MemoryItem_t | c_t > lastCompactedCursor }
  Evaluate boundary triggers over U:
    - Watermark trigger: |U| >= N_max or tokens(U) >= L_max
    - Temporal trigger:  t_{i} - t_{i-1} >= Delta_t_idle
    - Context trigger:   channel_i != channel_{i-1} or semantic shift detected
  ──> Slice completed episodic window w_x = {MemoryItem_a .. MemoryItem_b}
      (retaining trailing overlap buffer N_tail in active hot history)

[Step 2: Self-Healing L0 Compaction (compact + reflect Loop)]
  Attempt k = 1..K_retry:
    1. Generate candidate index:
         MemoryIndex_{0,x}^{(k)} = compress_C(w_x, missingDetail^{(k-1)})
    2. Evaluate reflective reconstructibility:
         (R_score, missingDetail^{(k)}) = reflect_eval(MemoryIndex_{0,x}^{(k)}, w_x)
    3. If R_score >= tau_reflect:
         Accept MemoryIndex_{0,x} = MemoryIndex_{0,x}^{(k)}; break
       Else:
         Inject missingDetail^{(k)} and retry compaction
  ──> If recurring 1st-pass failures across windows: mutate C ──> C'

[Step 3: Cold Archive Persistence & Cursor Advancement]
  1. Write raw w_x items to cold storage: archive/L0/L0-scene-{x}.jsonl
  2. Set MemoryIndex_{0,x}.archiveRef = "archive/L0/L0-scene-{x}.jsonl"
  3. Advance lastCompactedCursor = b

[Step 4: Hierarchical Multi-Level Rollup (L0 ──> L1)]
  If |Active_L0_Indices| > K_{L0}:
    Select oldest contiguous batch B_x = {MemoryIndex_{0,j}}_{j=p..q} (size B_{L0})
    Run self-healing (compact + reflect) over B_x:
      MemoryIndex_{1,y} = compress_C_L1(B_x)  with R(MemoryIndex_{1,y}, B_x) >= tau_reflect
    Archive B_x to archive/L1/L1-epoch-{y}-children.json
    Replace B_x in hot AGENTS.md with MemoryIndex_{1,y}
```

#### (1) Dynamic Episodic Boundary Detection in Action

Suppose the companion and user are conversing in a live session with `lastCompactedCursor = 128`, watermark threshold $`N_{\text{max}} = 20`$, trailing buffer $`N_{\text{tail}} = 4`$, and idle threshold $`\Delta t_{\text{idle}} = 30\text{ min}`$:
- **Case A (Idle Gap Boundary)**: Turns $`129 \dots 142`$ occur between `20:40` and `21:15`, after which the user goes offline for $`45\text{ min}`$. When the background or session-boundary trigger inspects the stream at `22:00`, $`\Delta t \ge \Delta t_{\text{idle}}`$ fires and cleanly slices $`w_x = [129, 142]`$ as a self-contained episode.
- **Case B (Watermark + Semantic Split)**: During a continuous $`25`$-turn marathon conversation ($`\lvert U \rvert = 25 \ge N_{\text{max}}`$), the boundary detector scans turns $`[129, 149]`$ (leaving the most recent $`N_{\text{tail}} = 4`$ turns $`[150, 153]`$ in the active sliding window for immediate conversational continuity) and picks the strongest topic transition point $`b \in [144, 149]`$ to close window $`w_x = [129, b]`$.

#### (2) Self-Healing Reflection Loop Walkthrough

Suppose on attempt $`k = 1`$, $`\text{compress}_C(w_x)`$ produces an initial $`\text{MemoryIndex}_{0,18}^{(1)}`$ that summarizes the celebration of the user's architecture defense but omits the specific promise to wake the user at `10:00 AM` with hand-drip coffee.
1. The reflection probe asks the reconstruction evaluator to recover all concrete commitments, emotional transitions, and causal triggers from $`\text{MemoryIndex}_{0,18}^{(1)}`$ alone and scores the reconstruction against raw $`w_x`$.
2. Because the `10:00 AM` wake-up promise is missing, the evaluator returns $`\mathcal{R} = 72 \lt \tau_{\text{reflect}} = 80`$ along with:
   `missingDetail: ["Turn 146: Companion explicitly promised to wake User at 10:00 AM tomorrow with hand-drip coffee."]`.
3. On attempt $`k = 2`$, the compaction engine re-runs $`\text{compress}_C(w_x, \text{missingDetail})`$, weaving the missed commitment into `keyFacts`. The subsequent reflection check scores $`\mathcal{R} = 92 \ge 80`$, and the healed index is committed.

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Formal Specification of Dynamic Boundary Detection

Let $`\mathcal{S} = \lbrace \text{MemoryItem}_t \rbrace_{t=1}^{T_{\text{now}}}`$ denote the ordered sequence of committed interaction tuples in the session trace, where each item carries a strictly increasing integer cursor $`c_t \in \mathbb{N}`$, timestamp $`\tau_t \in \mathbb{R}_{\ge 0}`$, and channel identifier $`\chi_t`$.

Given persisted cursor state $`c_{\text{last}} = \text{lastCompactedCursor}`$, the uncompacted active sequence is:

```math
U(c_{\text{last}}) = \lbrace \text{MemoryItem}_t \in \mathcal{S} \mid c_t \gt c_{\text{last}} \rbrace
```

Define the composite boundary indicator function $`\mathcal{B}(U, i) \in \lbrace 0, 1 \rbrace`$ at split index $`i`$ within $`U = \lbrace m_1, \dots, m_n \rbrace`$:

```math
\mathcal{B}(U, i) = \mathbb{I}\big(\tau_{i+1} - \tau_i \ge \Delta t_{\text{idle}}\big) \lor \mathbb{I}\big(\chi_{i+1} \neq \chi_i\big) \lor \mathbb{I}\Big(\big(i \ge N_{\text{max}} - N_{\text{tail}} \lor \ell(m_{1\dots i}) \ge L_{\text{max}}\big) \land \sigma_{\text{sem}}(m_i, m_{i+1}) \ge \theta_{\text{sem}}\Big)
```

where $`\ell(m_{1\dots i})`$ is the token length of prefix $`m_{1\dots i}`$ and $`\sigma_{\text{sem}}(m_i, m_{i+1}) \in [0, 1]`$ measures topic shift divergence (defaulting to $`1`$ at $`i = n - N_{\text{tail}}`$ when the hard watermark $`n \ge N_{\text{max}}`$ is reached). The next episodic window to compact is $`w_x = \lbrace m_1, \dots, m_{i^\ast} \rbrace`$, where $`i^\ast = \min \lbrace i \mid \mathcal{B}(U, i) = 1 \rbrace`$.

---

### 2. Formal Specification of the Self-Healing `compact + reflect` Operator

Let $`C_\theta`$ be the parameterized compression prompt policy. For any episodic window $`w_x`$:

1. **Iterative Self-Healing Recursion ($`k = 1, \dots, K_{\text{retry}}`$)**:
   With initial diagnostic set $`\Delta_0 = \varnothing`$, at iteration $`k`$:

   $`\displaystyle I_{0,x}^{(k)} = \text{compress}_{C_\theta}\big(w_x, \Delta_{k-1}\big)`$

   $`\displaystyle \big(r_k, \delta_k\big) = \mathcal{R}_{\text{eval}}\Big(\text{reflect}\big(I_{0,x}^{(k)}\big), \; w_x\Big), \quad r_k \in [0, 100]`$

   where $`\mathcal{R}_{\text{eval}}`$ decomposes into factual recall ($`w_{\text{fact}} = 0.4`$), psychological $`\text{OS}`$ arc fidelity ($`w_{\text{os}} = 0.4`$), and relational/promise retention ($`w_{\text{rel}} = 0.2`$):

   $`\displaystyle r_k = 0.4 \cdot R_{\text{fact}}\big(I_{0,x}^{(k)}, w_x\big) + 0.4 \cdot R_{\text{os}}\big(I_{0,x}^{(k)}, w_x\big) + 0.2 \cdot R_{\text{rel}}\big(I_{0,x}^{(k)}, w_x\big)`$

   If $`r_k \ge \tau_{\text{reflect}}`$, iteration terminates early with $`\text{MemoryIndex}_{0,x} = I_{0,x}^{(k)}`$. Otherwise, missing details accumulate as $`\Delta_k = \Delta_{k-1} \cup \delta_k`$, and the best-scoring candidate across $`K_{\text{retry}}`$ attempts is selected if the ceiling is reached:

   $`\displaystyle \text{MemoryIndex}_{0,x} = I_{0,x}^{(k^\ast)}, \quad k^\ast = \arg\max_{1 \le k \le K_{\text{retry}}} r_k`$

2. **Prompt Policy Mutation ($`C_\theta \to C_{\theta'}`$)**:
   Let $`\mathcal{H}_{\text{miss}} = \lbrace \delta_1^{(x - M + 1)}, \dots, \delta_1^{(x)} \rbrace`$ be the first-pass missing-detail residuals over a rolling window of $`M`$ compactions. Whenever the first-pass failure rate satisfies:

   $`\displaystyle \frac{1}{M} \sum_{j=x-M+1}^{x} \mathbb{I}\big(r_1^{(j)} \lt \tau_{\text{reflect}}\big) \ge \eta_{\text{mutate}}`$

   the meta-optimizer synthesizes a mutated compression prompt $`C_{\theta'} = \text{MutatePrompt}(C_\theta, \mathcal{H}_{\text{miss}})`$ incorporating explicit extraction rules for the recurring missed categories, and adopts $`C_{\theta'}`$ if and only if its first-pass reflection score over the validation window improves:

   $`\displaystyle \frac{1}{M} \sum_{j=x-M+1}^{x} \mathcal{R}_{\text{eval}}\Big(\text{reflect}\big(\text{compress}_{C_{\theta'}}(w_j, \varnothing)\big), \; w_j\Big) \gt \frac{1}{M} \sum_{j=x-M+1}^{x} r_1^{(j)}`$

---

### 3. Hierarchical Multi-Level Rollup Algebra ($`\text{L0} \to \text{L1}`$)

Let $`\mathcal{I}_{\text{L0}}^{\text{hot}} = \lbrace \text{MemoryIndex}_{0,1}, \dots, \text{MemoryIndex}_{0,m} \rbrace`$ denote the ordered list of L0 scene indices currently resident in hot context (`AGENTS.md`).

When $`\lvert \mathcal{I}_{\text{L0}}^{\text{hot}} \rvert \gt K_{\text{L0}}`$, the engine partitions $`\mathcal{I}_{\text{L0}}^{\text{hot}}`$ into a rollup batch $`B_y`$ of the oldest $`B_{\text{L0}}`$ entries and a retained hot suffix $`\mathcal{I}_{\text{L0}}^{\text{retain}}`$ of size $`m - B_{\text{L0}} \ge K_{\text{L0}}^{\text{hot}}`$:

```math
B_y = \lbrace \text{MemoryIndex}_{0,1}, \dots, \text{MemoryIndex}_{0,B_{\text{L0}}} \rbrace, \quad \mathcal{I}_{\text{L0}}^{\text{retain}} = \lbrace \text{MemoryIndex}_{0,B_{\text{L0}}+1}, \dots, \text{MemoryIndex}_{0,m} \rbrace
```

Applying the level-1 reflective compaction operator $`\mathcal{C}_{\text{L1}}`$ over $`B_y`$ yields:

```math
\text{MemoryIndex}_{1,y} = \mathcal{C}_{\text{L1}}(B_y) \quad \text{subject to} \quad \mathcal{R}_{\text{eval}}\Big(\text{reflect}\big(\text{MemoryIndex}_{1,y}\big), \; B_y\Big) \ge \tau_{\text{reflect}}
```

The hot memory state $`M_{\text{hot}}`$ rendered into `AGENTS.md` is then updated to:

```math
M_{\text{hot}}' = \big(\mathcal{I}_{\text{L1}}^{\text{hot}} \cup \lbrace \text{MemoryIndex}_{1,y} \rbrace, \; \mathcal{I}_{\text{L0}}^{\text{retain}}, \; H_{\text{active}}\big)
```

while $`B_y`$ is persisted to `archive/L1/L1-epoch-{y}-children.json`. Thus, any historical turn $`t`$ remains reachable in $`\mathcal{O}(1)`$ pointer hops via the three-tier hierarchy:

```math
\text{MemoryIndex}_{1,y} \xrightarrow{\text{archiveRef}} \text{MemoryIndex}_{0,x} \xrightarrow{\text{archiveRef}} \text{MemoryItem}_t \text{ (JSONL)}
```

---

### 4. Cursor-Idempotent State Transition & Atomic Persistence

Let the persistent compaction ledger state be $`\Sigma = \langle c_{\text{last}}, s_{\text{L0}}, s_{\text{L1}}, M_{\text{hot}} \rangle`$, where $`c_{\text{last}}`$ is `lastCompactedCursor` and $`s_{\text{L0}}, s_{\text{L1}}`$ are monotonic sequence counters.

For any compaction invocation `RunCompact`($`\Sigma, \mathcal{S}`$):
1. If $`\max_{m_t \in \mathcal{S}} c_t \le c_{\text{last}}`$ or $`\forall i, \; \mathcal{B}(U(c_{\text{last}}), i) = 0`$, then `RunCompact`($`\Sigma, \mathcal{S}`$) $`= \Sigma`$ (no-op).
2. When window $`w_x = \lbrace m_a, \dots, m_b \rbrace`$ with $`c_a \gt c_{\text{last}}`$ is compacted:
   - Write cold archive file `archive/L0/L0-scene-{s_L0 + 1}.jsonl` first (idempotent overwrite by deterministic scene ID);
   - Construct $`\Sigma' = \langle c_b, s_{\text{L0}} + 1, s_{\text{L1}}', M_{\text{hot}}' \rangle`$;
   - Write updated `memory-state.json.tmp` and `AGENTS.md.tmp` and atomically rename (`rename(2)`) to their canonical targets.

Because $`c_b \gt c_{\text{last}}`$ strictly advances only inside the atomic state commit, any crash prior to the rename leaves $`c_{\text{last}}`$ unchanged and safely re-runs `w_x` on recovery, whereas any duplicate invocation after the rename observes $`c_t \le c_b`$ for all items in $`w_x`$ and skips them immediately.

---

## Invariants
[invariants]: #invariants

### reflective-self-healing-before-commit

> **No compacted memory index (`MemoryIndex_{0,x}` or `MemoryIndex_{1,y}`) may be committed to hot memory without first undergoing reflective reconstructibility evaluation $`\mathcal{R}`$ against its source items and executing closed-loop `missingDetail` repair whenever $`\mathcal{R} \lt \tau_{\text{reflect}}`$.**

Unverified single-pass summarization silently drops causal promises and inner psychological shifts (`OS`). Gating every index commit with `compact + reflect` ensures that compression losses are detected and repaired while the raw window $`w_x`$ is still in memory.

### lossless-cold-archive-reachability

> **Every compacted `MemoryIndex` entry at any hierarchy level must carry a valid `archiveRef` pointer resolving to its underlying lower-level records on disk (`L1 -> L0 batch JSON -> L0 raw MemoryItem JSONL`), and raw `MemoryItem` records must never be deleted during compaction.**

Compaction reduces *in-context token footprint*, not *total historical knowledge*. Preserving immutable cold JSONL archives behind `archiveRef` guarantees that the companion can always decompress and recall exact verbatim exchanges when a conversation references deep history.

### cursor-monotonic-idempotence

> **The compaction engine must filter candidate turns strictly by $`c_t \gt \text{lastCompactedCursor}`$ and advance `lastCompactedCursor` atomically with the committed `MemoryIndex`, guaranteeing that repeated or concurrent triggers over the same session trace produce zero duplicate indices.**

At runtime, compaction can be invoked by turn watermarks, idle timers, and background consolidation workers (**RFC-0007**). Monotonic cursor gating makes the compaction operator idempotent across retries and restarts.

### bounded-hot-context-footprint

> **The total number of active L0 scene indices resident in `AGENTS.md` must remain bounded by $`K_{\text{L0}}`$ via automatic L0-to-L1 rollup, keeping in-context memory overhead sublinear in total interaction turns $`T`$.**

Without hierarchical rollup, hot context grows linearly $`\mathcal{O}(T)`$ and eventually overflows the context window or dilutes model attention. Rolling older L0 batches into L1 epoch digests bounds hot context while preserving multi-scale temporal visibility.

---

## Drawbacks
[drawbacks]: #drawbacks

1. **Additional LLM Calls During Reflection & Self-Healing Retries**:
   Evaluating $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$ and running repair retries when $`\mathcal{R} \lt \tau_{\text{reflect}}`$ consumes $`2\times\text{--}3\times`$ the tokens of a naive single-pass summary call.
   - *Mitigation*: Compaction runs only once per episodic window ($`15\text{--}25`$ turns) and is executed asynchronously outside the foreground reply path (**RFC-0007**); furthermore, evolving $`C \to C'`$ steadily raises first-pass pass rates so retries become rare.

2. **Granularity Trade-Off in L1 Epoch Indices**:
   Folding $`B_{\text{L0}}`$ L0 scene indices into a single $`\text{MemoryIndex}_{1,y}`$ inevitably coarsens scene-by-scene temporal resolution in hot context.
   - *Mitigation*: `MemoryIndex_{1,y}` explicitly aggregates persistent `keyFacts` across all child scenes and retains `childIds` and `archiveRef` so the agent can decompress specific L0 scenes on demand.

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### Why Hierarchical In-Context Indexing (`L0 -> L1`) Instead of Pure Vector Database RAG?

Vector top-$`K`$ retrieval fragments narrative continuity: it retrieves isolated chunks matching lexical or embedding similarity to the current message, completely losing the global chronological arc of how the companion's relationship and inner `OS` evolved over weeks. By maintaining L1 epoch indices and recent L0 scene indices directly in `AGENTS.md`, the companion always possesses an uninterrupted chronological map of its entire shared history, using `archiveRef` only when deep verbatim recall is needed.

### Why Composite Boundary Detection Instead of Fixed-Size Sliding Windows?

Fixed-size sliding windows slice conversations mid-scene—often separating a user's vulnerable confession in turn $`N`$ from the companion's emotional response in turn $`N+1`$. Combining idle-time gaps ($`\Delta t_{\text{idle}}`$), channel transitions, and semantic breakpoints within a soft watermark range respects natural episodic boundaries.

---

## Prior art
[prior-art]: #prior-art

- **MemGPT / OS-Style Virtual Context Management (Packer et al., 2023)**: Tiered hot/cold memory paging between active context and external archival storage; extended here with explicit first-person `innerOSArc` preservation and closed-loop reflective verification.
- **RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval (Sarthi et al., 2024)**: Hierarchical summarization trees over long documents; adapted here to chronological episodic trajectories ($`\text{MemoryItem}_t \to \text{L0} \to \text{L1}`$) with `archiveRef` back-pointers.
- **EMA Training Meta-Theory ([RFC-0003](RFC-0003-ema-training-meta-theory.md))**: Introduced the trainable compression operator $`C`$ and reflection score $`S_{\text{compress}}(C)`$ over offline script scenes.

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

1. **L2+ Multi-Year Rollup Thresholds**:
   At what scale of L1 epoch indices ($`K_{\text{L1}}`$) should a third tier ($`\text{MemoryIndex}_{2,z}`$, representing yearly or life-era digests) be triggered, and should L2 indices partition by calendar era or thematic life arcs?
2. **Automatic In-Turn Decompression Heuristic**:
   When should the runtime inference loop automatically dereference an L1 or L0 `archiveRef` into context prior to generating `OS`, versus exposing `decompress_memory(id)` as an explicit agent tool call?

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **Integration with Parallel Background Consolidation (`RFC-0007`)**: Running the `compact + reflect` pipeline inside isolated ephemeral worker sessions alongside hindsight persona dreaming.
- **Cross-Channel Entity & Fact Graph Linking**: Indexing `keyFacts` across L0/L1 entries by canonical entity and promise status (`active`, `fulfilled`, `superseded`) to accelerate cross-epoch fact reconciliation.

---

## Changes

### v1.0.0

- Initial specification of the runtime and session-boundary `compact` engine, defining dynamic episodic boundary detection, the self-healing `compact + reflect` loop with prompt evolution $`C \to C'`$, hierarchical `L0 -> L1` rollup with cold `archiveRef` links, and cursor-idempotent incremental compaction.
