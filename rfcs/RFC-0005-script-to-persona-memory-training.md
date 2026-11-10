# RFC-0005 First-Edition Script-to-Persona and Memory Reverse-Engineering Algorithm

[中文版](RFC-0005-script-to-persona-memory-training.zh.md)

- Feature Name: `script-to-persona-memory-training`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)

> **Status & Provenance**:
> - State: draft (Draft for Board Review)
> - Rev: v1.0.0

## Summary
[summary]: #summary

This RFC specifies the **First-Edition Script-to-Persona and Memory Reverse-Engineering Algorithm** for EverMemoryArchive (EMA), directly resolving Open Questions 3 (`format of personality`) and 4 (`how to update personality to get better score`) from [RFC-0003](RFC-0003-ema-training-meta-theory.md) on top of the cognitive and memory representations defined in [RFC-0004](RFC-0004-in-context-memory-index-and-os.md).

Specifically, this document defines the end-to-end algorithmic pipeline implemented in `@prism-shadow/ema`:
1. **Narrative Script Washing (`washGalgameScript`)**: Speaker alias normalization, scene-level mystery-speaker overrides, and deterministic coalescing of interleaved dialogue, narration, and monologues into causal `TurnBundle`s ($`q_t = \langle \text{Input}_t, a_t^{\ast} \rangle`$) grouped into episodic `SceneWindow`s ($`w_k`$);
2. **Cold-Start Warmup Distillation & External Seed Merging**: Initializing $`P_{0,0} = \text{distill}(q_1 \dots q_N)`$ (`distillInitialPersonalityFromWarmup`) or loading an `ExternalPersonaSeedBundle`, and locking the foundational persona anchor $`P_{\text{anchor}} = P_{0,0}`$;
3. **Micro-Batched Zero-Leakage Student Forward Pass (`runStudentSceneForward`)**: Grouping scene turns into micro-batches of size $`B`$ where prior completed batches use Teacher-Forced $`a_t^{\ast}`$ while the active batch being predicted is strictly blind to $`a_t^{\ast}`$, eliminating intra-scene target leakage;
4. **Supervised Teacher Evaluation & Anchor-Preserving Local Window RSI (`adjust_personality`)**: Scoring each turn via $`S_t = 0.4 \cdot S_{\text{OS}} + 0.6 \cdot S_{\text{Action}}`$, extracting `worstItems` whenever window mean score $`\bar{S}(w_k) \lt \tau`$, mutating $`P_{u,v} \to P_{u,v}'`$ via **Anchor-Preserving Contextual Modulation** (`mergeWithAnchors`) with strict anti-verbatim-quote regularization, and enforcing a re-verification acceptance gate $`\bar{S}(P_{u,v}') \gt \bar{S}(P_{u,v})`$;
5. **Base-Model & Thinking-Level Ablation Methodology (`runModelAndThinkingAblation`)**: A standardized multi-metric harness for empirically selecting the optimal `(provider, modelId, thinkingLevel)` Student and Teacher configurations.

---

## Motivation
[motivation]: #motivation

### 1. From Raw Narrative Scripts to Causal Training Trajectories

Long-horizon narrative scripts (such as visual novels, interactive fiction, or drama transcripts spanning $`150\text{--}300`$ scenes and $`2000+`$ target lines) are not natively structured as supervised machine learning datasets. Raw scripts exhibit three structural challenges:
- **Dynamic Speaker Aliases**: Before a companion character (`Alice`) introduces herself in the story, early prologue scenes often label her lines under generic aliases (`"Mystery Girl"`, `"???"`, or `"Unidentified Student"`), while other scenes may use those same generic labels for unrelated background characters;
- **Fragmented Multi-Line Turns**: A single conversational response by `Alice` is frequently split across two or three consecutive dialogue boxes or interleaved with an internal monologue line;
- **Scene Epilogue Context**: Crucial narrative outcomes often occur in the trailing lines of a scene *after* `Alice`'s final spoken line.

A rigorous washing algorithm (`washGalgameScript`) is required to transform raw multi-speaker scenes into clean, causally ordered `SceneWindow`s and `TurnBundle`s without losing pre-reveal prologue turns or scene-ending context.

### 2. Eliminating Causal Target Leakage in Multi-Turn Scene Evaluation

Evaluating a Student model turn-by-turn across $`2500`$ turns requires $`2500`$ sequential LLM calls per epoch. To accelerate throughput while preserving intra-scene context, turns within a scene can be grouped into micro-batches of size $`B`$ (e.g., $`B = 4`$ or $`6`$).

However, a naive batching implementation that feeds an entire scene's dialogue—including the ground-truth responses $`a_t^{\ast}`$ of later turns in the same batch—asks the model to "fill in the `<OS>` and `<Action>` for each turn." Under that naive setup, even weak models at `thinking_level: low` achieve artificially inflated scores by reading future ground-truth lines in the prompt. Conversely, running open-loop without Teacher Forcing causes the conversation to drift off the script manifold within three turns.

Our **Micro-Batched Zero-Leakage Student Forward Pass** resolves this tension: all turns *preceding* the active micro-batch $`[i, i+B-1]`$ are committed to intra-scene history using Teacher-Forced $`a_t^{\ast}`$, while every turn *inside* the active micro-batch exposes only $`\text{Input}_t`$ and completely withholds $`a_t^{\ast}`$.

### 3. Overcoming Catastrophic Forgetting and Verbatim Overfitting During Local RSI

When a Teacher LLM is asked to improve Personality $`P_{u,v} \to P_{u,v}'`$ after observing low scores on a specific scene window $`w_k`$, unconstrained prompt optimization consistently fails in two ways:
1. **Catastrophic Persona Forgetting**: If scene $`w_k`$ happens to be a rare, solemn crisis or investigation scene, an unconstrained Teacher frequently rewrites `P_{u,v}` to make the character permanently solemn and analytical—erasing the playful, sharp-tongued, or affectionate baseline anchors established in $`P_{0,0}`$ and degrading performance on all subsequent everyday scenes;
2. **Verbatim Quote Memorization**: The Teacher cheats on the local retry by copying the exact ground-truth dialogue lines ($`a_t^{\ast}`$) of the failed turns directly into `speechStyleRules`, turning `CompanionPersonality` into a bloated lookup table of plot spoilers rather than a generalizable cognitive policy.

Solving Open Question 4 from [RFC-0003](RFC-0003-ema-training-meta-theory.md) requires an update operator that mathematically guarantees **core anchor preservation**, **contextual modulation rather than replacement**, **zero verbatim plot leakage into $`P`$**, and **monotonic local verification**.

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. Stage 1: Narrative Script Washing (`washGalgameScript`)

Given a parsed `RawGalgameScript` containing ordered scenes and lines (`narration`, `dialogue`, `monologue`), `washGalgameScript(script, options)` constructs a `WashedDataset`:

```
RawGalgameScript (Scenes 1..S, Lines with speaker / type / text)
   │
   ├── 1. Speaker Resolution (isTargetSpeaker):
   │      Match speaker against global `speakerAliases` U `sceneSpeakerOverrides[sceneId]`
   │
   ├── 2. Scene Filtering:
   │      Retain scenes containing >= 1 target turn (respecting `excludeHScenes` & `maxOrder`)
   │
   └── 3. Turn Coalescing (flushTurn per SceneWindow):
          - Accumulate non-target lines (narration + other speakers) into `pendingInputLines`
          - Coalesce consecutive target lines into `pendingTargetLines` -> (gtActionText, explicitOS)
          - Emit TurnBundle q_t = <Input_t, a_t^*>
          - Capture remaining lines after the final target turn as `trailingLines` / `trailingText`
```

#### Concrete Turn Coalescing Example

Suppose scene `001_prologue_01` has a scene-specific speaker override mapping `"Mystery Girl"` to target character `Alice` (because `Alice` has not yet revealed her name in scene 1), and contains the following raw lines:

1. `narration`: `"The evening bell echoed across the empty courtyard."`
2. `dialogue` (`Bob`): `"Excuse me, is anyone still here?"`
3. `monologue` (`Mystery Girl`): `"Another noisy stranger stepping into my quiet place..."`
4. `dialogue` (`Mystery Girl`): `"...Who gave you permission to walk up here?"`
5. `dialogue` (`Mystery Girl`): `"Leave. Right now."`

`washGalgameScript` coalesces lines 1–5 into a single causal `TurnBundle` (`001_prologue_01#turn-01`):
- `inputText` ($`\text{Input}_1`$):
  ```text
  [Narration] The evening bell echoed across the empty courtyard.
  【Bob】: 「Excuse me, is anyone still here?」
  ```
- `explicitOS`: `"Another noisy stranger stepping into my quiet place..."`
- `gtActionText` ($`a_1^{\ast}`$): `"「...Who gave you permission to walk up here?」 「Leave. Right now.」"`

---

### 2. Stage 2: Cold-Start Warmup Distillation & External Seed Merging

Before scored training begins on window $`w_1`$, the trainer initializes $`P_{0,0}`$ and locks the foundational anchor $`P_{\text{anchor}} = P_{0,0}`$ through one of two pathways:

1. **Cold-Start Warmup Distillation (`distillInitialPersonalityFromWarmup`)**:
   The Teacher inspects the unscored warmup scenes $`W_0 = \lbrace q_1, \dots, q_N \rbrace`$ and reverse-engineers a generalizable six-slot `CompanionPersonality` $`P_{0,0}`$ without copying scene-specific plot lines;
2. **External Persona Seed Bundle (`loadExternalPersonaSeed`)**:
   When domain priors or curated speaker alias maps exist outside the repository, `loadExternalPersonaSeed(jsonPath)` loads an `ExternalPersonaSeedBundle` containing `targetCharacter`, `protagonistCharacter`, `speakerAliases`, `sceneSpeakerOverrides`, and the initial `personality` $`P_{0,0}`$.

In both pathways, `EmaPersonaTrainer` clones the resulting $`P_{0,0}`$ into `this.anchorPersonality` ($`P_{\text{anchor}}`$), whose core slots serve as immutable invariants during all subsequent local RSI mutations.

---

### 3. Stage 3: Micro-Batched Zero-Leakage Student Forward Pass

Within a scene window $`w_k`$ containing $`L`$ turns $`(q_1, \dots, q_L)`$, `runStudentSceneForward` partitions the turns into micro-batches of size $`B = \text{studentBatchSize}`$ (default $`B = 4`$):

```
Scene Window w_k: Turns [q_1, q_2, q_3, q_4] | [q_5, q_6, q_7, q_8] | ...
                  ──────────────────────────   ──────────────────────────
                         Micro-Batch 1                Micro-Batch 2

When predicting Micro-Batch 2 (q_5 .. q_8):
  ┌─────────────────────────────────────────────────────────────────────┐
  │ 1. System Prompt Prefix (`AGENTS.md`):                              │
  │    - Personality P_{u,v}                                            │
  │    - Single-Level MemoryIndex (Scenes 1 .. k-1)                     │
  ├─────────────────────────────────────────────────────────────────────┤
  │ 2. Teacher-Forced Intra-Scene History (Prior Completed Batches):    │
  │    - Turn 1: Input_1 -> OS_1 -> a_1^* (Ground Truth Action)         │
  │    - Turn 2: Input_2 -> OS_2 -> a_2^* (Ground Truth Action)         │
  │    - Turn 3: Input_3 -> OS_3 -> a_3^* (Ground Truth Action)         │
  │    - Turn 4: Input_4 -> OS_4 -> a_4^* (Ground Truth Action)         │
  ├─────────────────────────────────────────────────────────────────────┤
  │ 3. Active Blind Batch Queries (ZERO Ground Truth Leakage):          │
  │    - Turn 5: Input_5  (a_5^* is strictly withheld!)                 │
  │    - Turn 6: Input_6  (a_6^* is strictly withheld!)                 │
  │    - Turn 7: Input_7  (a_7^* is strictly withheld!)                 │
  │    - Turn 8: Input_8  (a_8^* is strictly withheld!)                 │
  └─────────────────────────────────────────────────────────────────────┘
```

When $`B = 1`$, this reduces to strict turn-by-turn causal inference with XML `<OS>` / `<Action>` output. When $`B \gt 1`$, the Student predicts the array of `{ turnId, os, action }` for the active batch in a single forward pass, after which the harness force-overrides the actions of $`q_5 \dots q_8`$ with $`a_5^{\ast} \dots a_8^{\ast}`$ before advancing to Micro-Batch 3.

---

### 4. Stage 4: Supervised Teacher Evaluation & Anchor-Preserving Local RSI

#### (1) Joint Teacher Evaluation (`evaluateScenePredictions`)

After the Student completes all micro-batches in scene window $`w_k`$, the Teacher evaluates each turn $`t \in w_k`$ against the ground-truth script reaction $`a_t^{\ast}`$:
- **Latent `<OS>` Consistency & Score ($`S_{\text{OS}, t} \in [0, 100]`$)**: Judges whether `predictedOS` forms a psychologically coherent bridge between $`\Pi_{\text{obs}}(\text{Input}_t)`$ and $`a_t^{\ast}`$. If `osConsistent === false`, the Teacher imputes a corrected `committedOS` ($`\text{OS}_t^{\ast}`$).
- **External `<Action>` Fidelity Score ($`S_{\text{Action}, t} \in [0, 100]`$)**: Graded across a 4-part rubric:
  1. *Tone & Subtext* ($`30`$ pts): Persona voice and outer-vs-inner emotional contrast;
  2. *Sentence Length & Cadence* ($`25`$ pts): Matching the brevity and rhythm of $`a_t^{\ast}`$ (heavily penalizing verbose or AI-assistant phrasing);
  3. *Situational & Affective Accuracy* ($`25`$ pts): Alignment of intent and attitude (rewarding $`80\text{--}95`$ points when spirit, brevity, and demeanor match even if exact phrasing differs);
  4. *Signature Habits & Catchphrases* ($`20`$ pts): Natural use of pronouns, catchphrases, and physical gestures.
- **Combined Turn Score ($`S_t`$)**:

```math
S_t = 0.4 \cdot S_{\text{OS}, t} + 0.6 \cdot S_{\text{Action}, t}
```

#### (2) Anchor-Preserving Contextual Modulation (`mutatePersonalityFromWindow`)

Let $`\bar{S}(w_k; P_{u,v}) = \frac{1}{|w_k|} \sum_{t \in w_k} S_t`$ be the window mean score. If $`\bar{S}(w_k; P_{u,v}) \lt \tau`$ (default threshold $`\tau = 78`$), the trainer triggers local RSI (`adjust_personality`):
1. **Worst-Case Diagnostic Extraction**: Sorts the window's evaluated items by `combinedScore` ascending and extracts the bottom $`K_{\text{worst}} = 6`$ failure cases (`worstItems`);
2. **Constrained Teacher Mutation Prompt**: Instructs the Teacher to diagnose underlying mechanism gaps under four strict regularization rules:
   - *Rule 1 (Preserve Core Persona Anchors)*: Never delete foundational identity, catchphrases, base sentence-length limits, or the Non-Mind-Reading Perspective Boundary from $`P_{\text{anchor}}`$;
   - *Rule 2 (Contextual Modulation, Not Replacement)*: When adapting to a special or serious scene, formulate rules as conditional branches (*"In everyday interactions, maintain X; whereas in solemn/crisis situations, shift to Y"*), never erasing the everyday baseline;
   - *Rule 3 (No Verbatim Quote Memorization)*: Strictly forbid copying ground-truth script quotes (`gtAction`) from `worstItems` into `CompanionPersonality`; episodic plot belongs exclusively in `MemoryIndex`;
   - *Rule 4 (Compact Psychological & Linguistic Abstraction)*: Distill concise, generalizable rules ($`\le 95`$ chars per rule).
3. **Programmatic Anchor Locking (`mergeWithAnchors`)**: Even after prompting, `mutatePersonalityFromWindow` programmatically locks `this.anchorPersonality.coreIdentity` and prepends the primary anchor rules from `this.anchorPersonality` to every slot (`emotionalDynamics`, `speechStyleRules`, `cognitiveOSPatterns`, `behavioralHabits`, `antiOocConstraints`) before merging new non-duplicate conditional rules;
4. **Re-Verification Gate**: The trainer re-runs `runStudentSceneForward` and `evaluateScenePredictions` on scene $`w_k`$ under candidate $`P_{u,v}'`$:
   - If $`\bar{S}(w_k; P_{u,v}') \ge \bar{S}(w_k; P_{u,v})`$, the mutation is accepted, `compactSceneMemory` synthesizes $`\text{MemoryIndex}_{0,k}'`$ from the improved trajectory, and the coupled state vector $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$ propagates to window $`w_{k+1}`$;
   - Otherwise, the trainer rolls back to $`P_{u,v}`$ and compacts the original trajectory.

---

### 5. Stage 5: Base-Model & Thinking-Level Ablation (`runModelAndThinkingAblation`)

Before launching a multi-scene training run, `runModelAndThinkingAblation` benchmarks candidate `(provider, modelId, thinkingLevel)` tuples on a fixed personality $`P_{0,0}`$ and a representative slice of early scenes, evaluated by a fixed Teacher model:

| Metric | Definition | Selection Role |
| --- | --- | --- |
| `formatSuccessRate` | Fraction of turns satisfying `<OS>` / `<Action>` or JSON schema | Hard gate (must be $`\ge 0.98`$) |
| `osConsistencyRate` | Fraction of turns where `predictedOS` is consistent with $`a_t^{\ast}`$ | Measures latent psychological reasoning quality |
| `meanOsScore` | Mean Teacher score $`\bar{S}_{\text{OS}} \in [0, 100]`$ | Measures inner monologue depth and perspective compliance |
| `meanActionScore` | Mean Teacher score $`\bar{S}_{\text{Action}} \in [0, 100]`$ | Measures outward voice, brevity, and cadence fidelity |
| `meanCombinedScore` | $`0.4 \cdot \bar{S}_{\text{OS}} + 0.6 \cdot \bar{S}_{\text{Action}}`$ | Primary quality objective |
| `msPerTurn` & `costUsd` | Wall-clock latency per turn and token cost (with KV cache metrics) | Pareto efficiency frontier selection |

Empirical ablation across 9 model/thinking configurations reveals a crucial insight: under zero-leakage evaluation, increasing a strong model's thinking budget from `low` to `medium` (e.g., `gemini-3.8-flash@medium`) substantially boosts both `osConsistencyRate` and `meanCombinedScore` because the model uses its reasoning budget to filter out unuttered `[Narration]` thoughts and calibrate sentence brevity before emitting `<Action>`.

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Formal Narrative Washing & Turn Coalescing Equations

Let a raw script scene be an ordered sequence of lines $`L_k = (l_1, l_2, \dots, l_{M_k})`$, where each line $`l_j = (\text{type}_j, \text{speaker}_j, \text{text}_j)`$ has $`\text{type}_j \in \lbrace \text{narration}, \text{dialogue}, \text{monologue} \rbrace`$.

Given target character identifier $`c_{\text{target}}`$, global alias set $`\mathcal{A}_{\text{global}}`$, and scene-specific override map $`\mathcal{A}_{\text{scene}}(k)`$, the target speaker indicator function is:

```math
\mathbb{I}_{\text{target}}(l_j, k) = \begin{cases} 1 & \text{if } \text{speaker}_j \in \lbrace c_{\text{target}} \rbrace \cup \mathcal{A}_{\text{global}} \cup \mathcal{A}_{\text{scene}}(k) \\ 0 & \text{otherwise} \end{cases}
```

The scene line sequence $`L_k`$ is partitioned into alternating maximal contiguous runs of non-target lines $`U_{k,t}`$ ($`\mathbb{I}_{\text{target}} = 0`$) and target lines $`V_{k,t}`$ ($`\mathbb{I}_{\text{target}} = 1`$) for $`t = 1, \dots, T_k`$, plus an optional trailing non-target run $`U_{k, \text{trail}}`$ after $`V_{k, T_k}`$:

```math
L_k = U_{k,1} \oplus V_{k,1} \oplus U_{k,2} \oplus V_{k,2} \oplus \dots \oplus U_{k,T_k} \oplus V_{k,T_k} \oplus U_{k,\text{trail}}
```

Each pair $`(U_{k,t}, V_{k,t})`$ forms an atomic `TurnBundle`:

```math
q_{k,t} = \big\langle \text{Input}_{k,t} = \text{FormatInput}(U_{k,t}), \; a_{k,t}^{\ast} = \text{FormatAction}(V_{k,t}), \; \text{explicitOS}_{k,t} = \text{ExtractMonologue}(V_{k,t}) \big\rangle
```

If $`U_{k,1} = \varnothing`$ (the target companion speaks the very first line of the scene), $`\text{Input}_{k,1}`$ defaults to the canonical scene-opening token `"[Scene Start]"`.

---

### 2. Zero-Leakage Micro-Batch Causal Masking

Let scene window $`w_k = (q_{k,1}, \dots, q_{k,T_k})`$ be partitioned into $`\lceil T_k / B \rceil`$ contiguous micro-batches of size $`B`$. For micro-batch index $`b \in \lbrace 0, 1, \dots, \lceil T_k / B \rceil - 1 \rbrace`$, define the active turn slice $`J_b = \lbrace bB + 1, \dots, \min((b+1)B, T_k) \rbrace`$ and the completed prior slice $`J_{\lt b} = \lbrace 1, \dots, bB \rbrace`$.

The information set $`\mathcal{I}_{k,b}`$ exposed to the Student policy during the forward call for batch $`b`$ is strictly:

```math
\mathcal{I}_{k,b} = \underbrace{\big(P_{u,v}, \; I_{\lt k}\big)}_{\text{System Prefix (AGENTS.md)}} \cup \underbrace{\big\lbrace \langle \text{Input}_{k,j}, \hat{\text{OS}}_{k,j}, a_{k,j}^{\ast} \rangle \big\rbrace_{j \in J_{\lt b}}}_{\text{Teacher-Forced Prior Batches}} \cup \underbrace{\big\lbrace \text{Input}_{k,i} \big\rbrace_{i \in J_b}}_{\text{Active Batch Inputs Only}}
```

Crucially, for every active turn $`i \in J_b`$, the ground-truth action $`a_{k,i}^{\ast}`$ satisfies:

```math
a_{k,i}^{\ast} \notin \mathcal{I}_{k,b}, \quad \forall i \in J_b
```

Once the Student emits predictions $`\lbrace (\hat{\text{OS}}_{k,i}, \hat{a}_{k,i}) \rbrace_{i \in J_b}`$, the harness immediately replaces $`\hat{a}_{k,i}`$ with $`a_{k,i}^{\ast}`$ when appending batch $`b`$ to $`J_{\lt b+1}`$.

---

### 3. Anchor-Preserving Mutation Operator & Monotonic Gate

Let $`P_{\text{anchor}} = P_{0,0}`$ denote the initial anchor personality locked after warmup distillation or seed loading, and let $`P_{u,v}`$ denote the active personality at window $`w_k`$.

When window mean score $`\bar{S}(w_k; P_{u,v}) \lt \tau`$, the Teacher diagnostic operator $`\mathcal{G}_{\text{Teacher}}`$ inspects $`P_{u,v}`$ and the $`K_{\text{worst}}`$ lowest-scoring items $`W_{\text{worst}} \subset w_k`$ to propose candidate slot rules $`\tilde{\Delta}_{u,v}`$:

```math
\tilde{\Delta}_{u,v} = \mathcal{G}_{\text{Teacher}}\big(P_{u,v}, \; W_{\text{worst}}\big)
```

To guarantee that core persona anchors are never overwritten, the **Anchor-Preserving Merge Operator** $`\text{Merge}_{\text{anchor}}`$ constructs each slot $`s \in \lbrace \text{emotionalDynamics}, \text{speechStyleRules}, \text{cognitiveOSPatterns}, \text{behavioralHabits}, \text{antiOocConstraints} \rbrace`$ of candidate personality $`P_{u,v}'`$ as:

```math
P_{u,v}'[\text{coreIdentity}] \leftarrow P_{\text{anchor}}[\text{coreIdentity}]
```

```math
P_{u,v}'[s] \leftarrow \text{LockPrefix}_s\big(P_{\text{anchor}}[s]\big) \;\oplus\; \text{Deduplicate}\Big(\text{Truncate}_{K_s}\big(\tilde{\Delta}_{u,v}[s]\big), \; \text{LockPrefix}_s\big(P_{\text{anchor}}[s]\big)\Big)
```

where $`\text{LockPrefix}_s(P_{\text{anchor}}[s])`$ preserves the primary foundational anchor rules of slot $`s`$ (specifically including both the first latent `<OS>` mapping rule and the Non-Mind-Reading Perspective Boundary rule in `cognitiveOSPatterns`), and $`K_s \in \lbrace 3, 4 \rbrace`$ bounds the maximum number of contextually modulated rules added per slot.

Finally, the state transition on window $`w_k`$ applies the **Monotonic Acceptance Gate**:

```math
(P_{u,v+1}, \; w_k^{\ast}) = \begin{cases} \big(P_{u,v}', \; w_k(P_{u,v}')\big) & \text{if } \bar{S}\big(w_k; P_{u,v}'\big) \ge \bar{S}\big(w_k; P_{u,v}\big) \\ \big(P_{u,v}, \; w_k(P_{u,v})\big) & \text{otherwise} \end{cases}
```

followed by scene memory compaction on the winning trajectory $`w_k^{\ast}`$:

```math
\text{MemoryIndex}_{0,k} = \text{compress}_C(w_k^{\ast}), \quad M_{u,v+1} = M_{u,v} \cup \lbrace \text{MemoryIndex}_{0,k} \rbrace
```

---

### 4. Dual Operating Modes: Joint Closed-Loop RSI vs. Fixed-Persona Batch Compaction

As foreshadowed in [RFC-0003](RFC-0003-ema-training-meta-theory.md), `EmaPersonaTrainer` supports two complementary inverse-engineering workflows:

1. **Mode A — Joint Closed-Loop Persona & Memory RSI (`trainSceneWindow`)**:
   Executes the full `Forward -> Evaluate -> (Conditional Anchor-Preserving RSI Mutation & Re-Verify) -> Compact -> Sync AGENTS.md` loop across high-surprisal narrative scenes, jointly evolving $`P_{0,0} \to P_{0,m}`$ and high-precision `SceneMemoryIndexItem`s;
2. **Mode B — Fixed-Persona Full-Story Batch Compaction (`compactScenesBatchFromScript`)**:
   Once Personality $`P^{\ast}`$ has converged (or when holding a high-scoring $`P`$ fixed to invert full-story episodic memory across $`100+`$ remaining scenes), `compactScenesBatchFromScript` groups scenes into batches (e.g., 5–6 scenes per call), imputes the character's latent `innerOSArc` conditioned on $`P^{\ast}`$, and distills first-person `summary` and `keyFacts` across the entire narrative script at minimal token cost.

---

## Invariants
[invariants]: #invariants

### causal-turn-bundle-isolation

> **During active micro-batch prediction for turns $`J_b`$, the Student prompt must never contain the ground-truth actions $`a_{k,i}^{\ast}`$ of any turn $`i \in J_b`$, whereas all completed prior batches $`J_{\lt b}`$ must have their actions force-overridden with $`a_{k,j}^{\ast}`$.**

Violating active-batch blindness leaks future target answers into the prompt context and invalidates evaluation scores; violating prior-batch Teacher Forcing allows early prediction errors to derail subsequent scene context.

### anchor-preserving-contextual-modulation

> **Every local personality update $`P_{u,v} \to P_{u,v}'`$ must preserve the foundational identity and core slot anchors of $`P_{\text{anchor}} = P_{0,0}`$, expressing scene-specific behavioral adaptations strictly as conditional contextual modulations rather than global overwrites.**

Without anchor locking, a single atypical crisis or somber scene in the middle of a script causes the Teacher to overwrite the companion's everyday personality, inducing catastrophic forgetting on subsequent scenes.

### anti-verbatim-quote-regularization

> **Personality rules inside `CompanionPersonality` must encode only generalizable psychological, affective, and linguistic mechanisms, and must never contain verbatim ground-truth dialogue lines ($`a_t^{\ast}`$) or scene-specific plot spoilers.**

Memorizing verbatim script lines inside $`P_{u,v}`$ conflates Personality ($`P`$) with Episodic Memory ($`M`$), causing brittle overfitting to training scenes and unnatural out-of-context quote repetition during live user conversation.

### verified-monotonic-window-commit

> **A mutated personality $`P_{u,v}'`$ generated on scene window $`w_k`$ may replace $`P_{u,v}`$ and produce the compacted scene memory $`\text{MemoryIndex}_{0,k}`$ if and only if re-evaluating $`w_k`$ under $`P_{u,v}'`$ yields a window mean score $`\bar{S}(w_k; P_{u,v}') \ge \bar{S}(w_k; P_{u,v})`$.**

Unverified prompt edits frequently degrade actual Student behavior despite sounding plausible to the Teacher; gating acceptance on a closed-loop re-run guarantees non-decreasing local trajectory quality and ensures $`M_{u,v}'`$ is always compacted from the higher-scoring cognitive trace.

---

## Drawbacks
[drawbacks]: #drawbacks

1. **Doubled Inference Cost on Windows Triggering Local RSI Retry**:
   Whenever a scene window scores below `rsiScoreThreshold` ($`\tau = 78`$), running `mutatePersonalityFromWindow` followed by a second Student forward pass and Teacher evaluation roughly doubles the LLM calls for that scene.
   - *Mitigation*: Once $`P_{u,v}`$ stabilizes across the first $`10\text{--}15`$ representative scenes, most subsequent windows pass the $`\tau = 78`$ threshold on Attempt 1, and full-story memory coverage can be completed via `compactScenesBatchFromScript`.

2. **Teacher Judge Variance Across Evaluation Chunks**:
   LLM-as-a-Judge scores can exhibit $`\pm 2`$ point stochastic variance across runs, which could occasionally trigger a borderline rollback when $`\bar{S}(P_{u,v}') \approx \bar{S}(P_{u,v})`$.
   - *Mitigation*: `evaluateScenePredictions` evaluates up to 18 turns Together in a single structured rubric call, reducing per-turn judge variance through batch calibration across the entire scene window.

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### Why Micro-Batching ($`B = 4`$) Instead of Pure Single-Turn ($`B = 1`$) or Full-Scene ($`B = L`$)?

- Pure single-turn ($`B = 1`$) requires $`L`$ separate LLM round-trips per scene, incurring high network latency overhead;
- Full-scene ($`B = L`$) without intermediate Teacher-Forced history grounding forces the Student to predict 20 turns into the future without seeing how the counterpart reacted to earlier turns in the scene;
- Micro-batching ($`B = 4`$ to $`6`$) strikes the optimal Pareto balance: cutting RPC round-trips by $`4\times\text{--}6\times`$ while re-grounding the intra-scene conversation on Teacher-Forced $`a_t^{\ast}`$ every few turns with zero target leakage.

### Why Hybrid Mode A (Full RSI) + Mode B (Batch Script Compaction) for $`100+`$ Scene Scripts?

Personality $`P`$ has low intrinsic dimensionality (converging to $`85+`$ scores within $`10\text{--}20`$ diverse scenes), whereas Episodic Memory $`M`$ scales linearly with story length ($`100\text{--}200`$ scenes). Combining full closed-loop RSI on key personality-shaping scenes (Mode A) with batch script compaction across the full narrative arc (Mode B) delivers both a deeply calibrated `CompanionPersonality` and a complete 100%-coverage `MemoryIndex` within practical compute budgets.

---

## Prior art
[prior-art]: #prior-art

- **TextGrad (Yuksekgonul et al., 2024) & OPRO (Yang et al., 2023)**: Treats natural language prompts as differentiable parameters updated via textual feedback from failure cases; extended in RFC-0005 with programmatic slot anchor locking (`mergeWithAnchors`) and anti-verbatim regularization to prevent catastrophic forgetting on sequential narrative distributions.
- **Elastic Weight Consolidation (Kirkpatrick et al., 2017)**: Prevents catastrophic forgetting in neural network continual learning by anchoring core parameters to prior tasks; mirrored in context space here by locking $`P_{\text{anchor}}`$ slots while allowing bounded conditional extensions.
- **Scheduled Sampling & Teacher Forcing (Bengio et al., 2015)**: Bridges free-running generation and ground-truth state conditioning; adapted here into micro-batched zero-leakage causal evaluation.

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **Automated High-Surprisal Scene Selection for Mode A RSI**: Rather than selecting Mode A training windows chronologically or evenly across chapters, can we use a fast zero-shot surprisal pass to automatically rank all 130+ scenes by persona difficulty and concentrate local RSI retries on the top 15 highest-surprisal scenes?
- **Multi-Branch Vector Beam Pruning Schedule**: When maintaining $`B_{\text{beam}} \gt 1`$ candidate state vectors $`\lbrace P_{u,v}^{(b)}, M_{u,v}^{(b)} \rbrace`$ across chapters, what is the optimal validation window horizon before pruning dominated branches?

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **Continual Online RSI from Live User Companionship**: Extending `evaluateScenePredictions` and `mutatePersonalityFromWindow` from offline script Ground Truth $`a_t^{\ast}`$ to implicit user engagement and preference signals during live long-term companionship.
- **Multi-Character Relational Co-Distillation**: Jointly reverse-engineering coupled personalities $`(P^{(A)}, P^{(B)})`$ for multiple interacting companions from ensemble narrative scripts.

---

## Changes

### v1.0.0

- Initial specification of the narrative script washer (`washGalgameScript`), cold-start warmup distiller (`distillInitialPersonalityFromWarmup`) and external seed loader (`ExternalPersonaSeedBundle`), micro-batched zero-leakage Student forward pass (`runStudentSceneForward`), Teacher rubric evaluator (`evaluateScenePredictions`), anchor-preserving local RSI mutator (`mutatePersonalityFromWindow`), batch scene compactor (`compactScenesBatchFromScript`), and base-model/thinking-level ablation harness (`runModelAndThinkingAblation`).
