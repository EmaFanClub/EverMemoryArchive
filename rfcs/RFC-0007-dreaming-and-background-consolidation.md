# RFC-0007 Dreaming and Parallel Background Consolidation Engine

[中文版](RFC-0007-dreaming-and-background-consolidation.zh.md)

- Feature Name: `dreaming-and-background-consolidation`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)

> **Status & Provenance**:
> - State: draft (Draft for Board Review)
> - Rev: v1.0.0

## Summary
[summary]: #summary

This RFC specifies the **Dreaming and Parallel Background Consolidation Engine (`dream` algorithm)** for EverMemoryArchive (EMA). It transforms the offline supervised recursive self-improvement (RSI) `train` loop of [RFC-0003](RFC-0003-ema-training-meta-theory.md) and [RFC-0005](RFC-0005-script-to-persona-memory-training.md) into a self-supervised memory consolidation and persona evolution engine that operates **both during circadian rest cycles and continuously in parallel with the Actor's live foreground Route Session**.

Unlike offline script training—where a script author supplies ground-truth actions $`a_t^\ast`$ and the training harness can pause progression to re-roll local windows—a live companion serves real-time World and Channel messages in its foreground Route Session without ground-truth labels or blocking windows. This RFC introduces three core innovations to close the lifelong learning loop at runtime:
1. **Parallel Route-Session Non-Blocking Architecture**: The Actor processes inbound messages in its foreground **Route Session** (`actor.session`), while the Dreaming & Background Consolidation worker executes concurrently inside isolated ephemeral worker sessions (`DELETE /api/sessions/:id` upon completion), reading committed turns from the Route Session trace non-destructively and atomically syncing updated state vectors $`\lbrace P_{u+1,0}, M' \rbrace`$ to `AGENTS.md` without blocking or polluting the foreground conversation;
2. **Hindsight Target Synthesis ($`a_t^{\text{dream}}`$) without Script Ground Truth**: In the absence of an authored $`a_t^\ast`$, the Dream Teacher inspects the delayed future trajectory $`\text{Input}_{t+1 \dots t+k}`$ (whether the user resonated, opened up, corrected a misstep, or disengaged) alongside immutable `anchorPersonality` ($`P_{0,0}`$) invariants to score daytime turns $`\langle \text{OS}_t, \text{Action}_t \rangle`$ and synthesize counterfactual ideal targets $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$;
3. **Three-Phase Dreaming Loop**:
   - *Phase 1 — Background Memory Compaction & Cross-Scene Consolidation*: Runs cursor-idempotent L0 compaction ([RFC-0006](RFC-0006-memory-compaction.md)) over uncompacted Route Session turns, deduplicates cross-scene `keyFacts`, and rolls up older L0 scenes into L1 epoch digests;
   - *Phase 2 — Anti-OOC Drift Audit & Anchor-Preserving Persona Evolution*: Audits daytime traces for persona drift (length inflation, loss of signature voice, generic assistant-speak) and newly formed relational bonds, applying Anchor-Preserving Modulation $`P_{u,v} \to P_{u,v}'`$ while locking $`P_{0,0}`$ core traits;
   - *Phase 3 — Counterfactual Replay & Anchor Regression Gate*: Replays daytime low-score windows and classic anchor benchmark scenes under candidate $`\lbrace P_{u,v}', M' \rbrace`$, committing the update to `AGENTS.md` if and only if counterfactual replay score strictly improves ($`\bar{S}_{\text{dream}}(P') \gt \bar{S}_{\text{dream}}(P)`$) and anchor benchmark fidelity does not regress ($`\bar{S}_{\text{anchor}}(P') \ge \tau_{\text{anchor}}`$).

---

## Motivation
[motivation]: #motivation

### 1. Decoupling Live Conversational Latency from Deep Cognitive Consolidation

In EMA's runtime architecture ([RFC-0001](RFC-0001-ema-worlds-and-actors.md)), an Actor receives live user messages and multi-channel events through a dedicated foreground **Route Session** (`actor.session`). Performing multi-pass reflective memory compaction ([RFC-0006](RFC-0006-memory-compaction.md)), persona drift diagnosis, and counterfactual replay inline within `actor.session` would introduce tens of seconds of turn-to-turn latency and pollute the conversational context with meta-evaluation prompts.

Conversely, postponing all consolidation until an explicit multi-hour offline maintenance window leaves fast-moving daytime sessions uncompacted and vulnerable to mid-day persona drift. EMA therefore requires a **Parallel Route-Session Non-Blocking Architecture** that runs consolidation and dreaming continuously in isolated background worker sessions alongside the live Route Session, as well as during scheduled circadian rest cycles.

### 2. Self-Supervision in the Wild: Synthesizing Targets without a Playwright

During script-based pre-training ([RFC-0003](RFC-0003-ema-training-meta-theory.md)), every prompt $`q_t`$ is paired with a ground-truth reaction $`a_t^\ast`$ written by the original author. Once the companion enters live service with a real human user, $`a_t^\ast`$ no longer exists.

Yet live conversation contains a rich, naturally delayed supervisory signal: **the subsequent trajectory $`\text{Input}_{t+1 \dots t+k}`$**. Whether a companion's response at turn $`t`$ genuinely comforted the user, sparked deeper rapport, fell flat, or triggered subtle correction only becomes observable $`1\text{--}5`$ turns later. By combining this hindsight trajectory lookahead with the companion's immutable core identity (`anchorPersonality`), the Dream Teacher can retroactively evaluate daytime turns and synthesize counterfactual hindsight targets $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$—turning hindsight reflection ("how I wish I had responded") into a rigorous self-supervised training signal.

### 3. Combating Daytime OOC Drift While Allowing Genuine Relational Growth

Over hundreds of live turns, LLMs naturally gravitate toward base-model attractors: responses gradually lengthen, sharp or understated character voices soften into polite generic helpfulness ("assistant-speak"), and subtle emotional boundaries blur. At the same time, the companion *must* evolve—internalizing new shared memories, inside jokes, and deepening trust with the user.

Without a disciplined consolidation loop, either the persona is frozen statically (preventing relational evolution) or unconstrained self-modification erodes the character's soul ($`P_{0,0}`$). Combining **Anchor-Preserving Persona Modulation** with a **Dual-Gate Verification (Counterfactual Replay + Anchor Regression Gate)** ensures that the companion grows closer to the user while never drifting out of character.

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. Parallel Route-Session & Background Dreaming Architecture

```
                     ┌──────────────────────────────────────────────────────────┐
Inbound World /      │ Foreground Route Session (actor.session)                 │
Channel Events ────> │   Context: AGENTS.md {P_{u,v}, M_hot} + Active History   │
                     │   Fast Path: Input_t ──> set_os(OS_t) ──> react(Action_t)│
                     └───────────────┬──────────────────────────────────────────┘
                                     │ Append committed turn (cursor c_t)
                                     ▼
                     ┌──────────────────────────────────────────────────────────┐
                     │ Non-Destructive Trace Snapshot (c_t <= c_snap)           │
                     └───────────────┬──────────────────────────────────────────┘
                                     │ Read-only trace slice (Zero blocking)
                                     ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ Background Consolidation & Dreaming Worker (Isolated Ephemeral Sessions)      │
│   Spawn ephemeral session S_work ──> run task ──> DELETE /api/sessions/S_work │
│                                                                               │
│   [Phase 1: Background Memory Compaction & Cross-Scene Consolidation]         │
│     - Incremental L0 compact + reflect over turns (lastCompacted < c <= c_snap│
│     - Deduplicate cross-scene keyFacts & roll up L0 batches ──> L1 digests    │
│                                                                               │
│   [Phase 2: Anti-OOC Drift Audit & Hindsight Persona Evolution]               │
│     - Score daytime turns using future lookahead Input_{t+1..t+k} + P_{0,0}   │
│     - Synthesize hindsight targets <OS_t*, a_t^{dream}> for low-score turns   │
│     - Anchor-Preserving Modulation: P_{u,v} ──> P_{u,v}' (locking P_{0,0})    │
│                                                                               │
│   [Phase 3: Counterfactual Replay & Anchor Regression Gate]                   │
│     - Gate 1 (Daytime Replay): S_dream(P', M') > S_dream(P, M)                │
│     - Gate 2 (Anchor Bench):   S_anchor(P') >= tau_anchor                     │
└────────────────────────────────────┬──────────────────────────────────────────┘
                                     │ Atomic write-then-rename (if Gates pass)
                                     ▼
                     ┌──────────────────────────────────────────────────────────┐
                     │ Updated AGENTS.md {P_{u+1,0}, M_hot'}                    │
                     │ (Picked up seamlessly by Route Session on next turn)     │
                     └──────────────────────────────────────────────────────────┘
```

#### Key Isolation Guarantees

1. **Foreground Non-Interference**: The foreground Route Session (`actor.session`) only executes live `Input -> OS -> Action` turns. It is never paused, locked, or injected with reflection/scoring prompts.
2. **Ephemeral Worker Hygiene**: Every background `compact`, `reflect`, hindsight scoring, or counterfactual replay invocation creates a short-lived worker session and unconditionally destroys it via `DELETE /api/sessions/:id` in a `finally` block, preventing orphan session accumulation.
3. **Dual Trigger Modes**:
   - **Continuous Parallel Mode**: Triggered asynchronously whenever uncompacted turns in `actor.session` cross watermark $`N_{\text{max}}`$ or idle gap $`\Delta t_{\text{idle}}`$ while the user is still active or between bursts;
   - **Circadian Rest Mode**: Triggered during scheduled nightly/idle rest windows to run full-day cross-scene consolidation, deep drift auditing, and multi-window counterfactual replay.

---

### 2. Hindsight Target Synthesis ($`a_t^{\text{dream}}`$) Walkthrough

Consider a daytime interaction where the user indirectly hints at exhaustion after a failed project pitch:

1. **Daytime Trace ($`t`$ and Lookahead $`t+1, t+2`$)**:
   - **Turn $`t`$ (`Input_t`)**: User says, `"The client rejected the prototype in five minutes. Anyway, it's fine, let's just talk about something else."`
   - **Daytime Response (`OS_t`, `Action_t`)**: The companion took the surface deflection literally:
     - `OS_t`: `"User wants to change the subject; I should suggest a cheerful topic to distract them."`
     - `Action_t`: `"Okay! Let's talk about what movies are coming out this weekend—there's a great new sci-fi release!"`
   - **Subsequent Trajectory (`Input_{t+1}`, `Input_{t+2}`)**:
     - `Input_{t+1}`: `"Yeah... maybe later. I think I'm going to log off early tonight."` (User withdraws and disengages prematurely).

2. **Dream Teacher Hindsight Diagnosis**:
   During dreaming, the Teacher inspects Turn $`t`$ together with `Input_{t+1}` and the companion's `anchorPersonality` ($`P_{0,0}`$: *perceptive, quietly protective, sees through forced bravado without being pushy*):
   - **Hindsight Score**: $`s_t^{\text{dream}} = 48 \lt \tau_{\text{dream}} = 75`$.
   - **Diagnosis**: The companion drifted into generic cheerful distraction, violating its perceptive core trait and causing the user to feel unheld and disengage in $`t+1`$.
   - **Counterfactual Target Synthesis ($`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$)**:
     - $`\text{OS}_t^\ast`$: `"Sharp heartache beneath calm composure: User's 'it's fine' is clearly forced armor after a painful rejection; I won't pry into the pitch details since they asked not to, but I must quietly stay beside them rather than forcing fake cheerfulness."`
     - $`a_t^{\text{dream}}`$: `"(Sits down quietly beside you without turning on the bright lights) We don't have to talk about the pitch at all. Just lean back and close your eyes for a bit—I'm right here."`

---

### 3. The Three-Phase Dreaming Loop in Detail

#### Phase 1: Background Memory Compaction & Cross-Scene Consolidation

1. **Incremental L0 Compaction**: The worker snapshots committed turns up to $`c_{\text{snap}}`$ from `actor.session` and executes the self-healing `compact + reflect` loop ([RFC-0006](RFC-0006-memory-compaction.md)) to fold uncompacted episodic windows into L0 indices $`\text{MemoryIndex}_{0,x}`$.
2. **Cross-Scene Fact Reconciliation**: Scans `keyFacts` across newly created and recent L0 indices to merge duplicates and update state transitions (e.g., marking a previously pending defense or pitch in `L0-scene-0015` as completed/resolved in `L0-scene-0019`).
3. **Hierarchical L0-to-L1 Rollup**: If active L0 indices exceed $`K_{\text{L0}}`$, folds the oldest contiguous L0 batch into an L1 epoch digest $`\text{MemoryIndex}_{1,y}`$.

#### Phase 2: Anti-OOC Drift Audit & Anchor-Preserving Persona Evolution

The Dream Teacher scans all daytime turns in the consolidation horizon along two orthogonal axes:
1. **Anti-OOC Drift Audit**:
   - Detects quantitative and stylistic drift relative to `anchorPersonality` ($`P_{0,0}`$): utterance length inflation (e.g., drifting from concise 2-sentence lines to 3-paragraph monologues), loss of signature speech cadence, or infiltration of generic assistant phrases;
   - Synthesizes targeted corrective constraints in the mutable behavioral guardrails section of $`P`$.
2. **Relational & Experiential Growth**:
   - Extracts enduring interpersonal updates verified across multiple scenes (new shared habits, deepened emotional boundaries, user preferences learned through experience);
   - Applies **Anchor-Preserving Modulation** $`P_{u,v} \to P_{u,v}'`$, where $`P = \langle P_{0,0}^{\text{locked}}, P_{\text{rel}}, P_{\text{guard}} \rangle`$: $`P_{0,0}^{\text{locked}}`$ remains bit-for-bit immutable while $`(P_{\text{rel}}', P_{\text{guard}}')`$ are updated and coupled with the consolidated memory $`M'`$.

#### Phase 3: Counterfactual Replay & Anchor Regression Gate

Before committing $`\lbrace P_{u,v}', M' \rbrace`$ to the Actor's live `AGENTS.md`, the worker runs two verification suites in fresh ephemeral sessions:
1. **Counterfactual Daytime Replay**: Re-runs the daytime low-score windows $`W_{\text{low}}`$ under $`\lbrace P_{u,v}', M' \rbrace`$ and evaluates the newly generated $`\langle \widehat{\text{OS}}_t', \hat{a}_t' \rangle`$ against the hindsight targets $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$. Requires strict score gain:
   $`\bar{S}_{\text{dream}}(P_{u,v}', M') \gt \bar{S}_{\text{dream}}(P_{u,v}, M)`$.
2. **Anchor Benchmark Gate**: Re-runs a curated set of canonical character-defining benchmark scenes $`D_{\text{anchor}}`$ (with ground-truth $`a_t^\ast`$ from initial training) under $`P_{u,v}'`$. Requires zero persona regression:
   $`\bar{S}_{\text{anchor}}(P_{u,v}') \ge \tau_{\text{anchor}}`$.

If both gates succeed, $`\lbrace P_{u+1,0} \leftarrow P_{u,v}', M' \rbrace`$ is atomically synced to `AGENTS.md`; if either gate fails, the persona mutation $`P_{u,v}'`$ is rejected and only the Phase 1 memory consolidation $`\lbrace P_{u,v}, M' \rbrace`$ is committed.

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Non-Blocking Concurrent State Synchronization Protocol

Let the Actor's foreground Route Session be $`\mathcal{S}_{\text{route}}`$ and its persistent context specification file be `AGENTS.md`, parameterized by state tuple $`\mathbf{s}_{u,v} = \langle P_{u,v}, M_{\text{hot}}, c_{\text{last}}, \nu \rangle`$ where $`\nu \in \mathbb{N}`$ is a monotonic state version counter.

When a background consolidation/dreaming job starts at time $`t_0`$:
1. **Snapshot Acquisition**: The worker reads $`\mathbf{s}_{u,v}`$ and snapshots the read-only prefix of committed Route Session turns up to cursor $`c_{\text{snap}} = \max_t c_t(t_0)`$:

   $`\displaystyle \mathcal{T}_{\text{snap}} = \lbrace \text{MemoryItem}_t \in \mathcal{S}_{\text{route}} \mid c_{\text{last}} \lt c_t \le c_{\text{snap}} \rbrace`$

2. **Ephemeral Worker Execution**: All LLM calls in Phases 1–3 execute inside ephemeral sessions $`s_{\text{eph}} \sim \text{CreateSession}(\text{isolated} = \text{true})`$ guarded by:

   $`\displaystyle \text{try } \lbrace \text{ExecutePhase}(s_{\text{eph}}) \rbrace \text{ finally } \lbrace \text{DeleteSession}(s_{\text{eph}}) \rbrace`$

3. **Optimistic Atomic Commit**: Upon completing Phase 3 with validated state $`\langle P_{\text{next}}, M_{\text{hot}}', c_{\text{snap}}, \nu + 1 \rangle`$, the worker acquires a lightweight file lock on `AGENTS.md.lock`, verifies that no conflicting cursor regression occurred ($`c_{\text{snap}} \ge c_{\text{last}}^{\text{disk}}`$), renders `AGENTS.md.tmp`, and executes an atomic POSIX `rename("AGENTS.md.tmp", "AGENTS.md")`. Meanwhile, any new turns $`c_t \gt c_{\text{snap}}`$ produced by $`\mathcal{S}_{\text{route}}`$ during the background run remain intact in $`\mathcal{S}_{\text{route}}`$'s active history for the next incremental cycle.

---

### 2. Formal Equations of Hindsight Evaluation & Target Synthesis

Let $`\tau_{\text{day}} = \lbrace \langle \text{Input}_t, \text{OS}_t, \text{Action}_t \rangle \rbrace_{t=a}^{b}`$ be a daytime episodic window. For each turn $`t \in [a, b]`$, define its $`k`$-step future lookahead window:

```math
F_{t,k} = \lbrace \text{Input}_{t+1}, \text{OS}_{t+1}, \text{Action}_{t+1}, \dots, \text{Input}_{\min(t+k, b)} \rbrace
```

1. **Hindsight Alignment Functional ($`\mathcal{E}_{\text{dream}}`$)**:
   Conditioned on the immutable anchor personality $`P_{0,0}`$, consolidated memory $`M`$, and future trajectory $`F_{t,k}`$, the Dream Teacher evaluates turn $`t`$:

   $`\displaystyle s_t^{\text{dream}} = \mathcal{E}_{\text{dream}}\big(\text{Input}_t, \text{OS}_t, \text{Action}_t \;\big|\; F_{t,k}, P_{0,0}, M\big) \in [0, 100]`$

   decomposed into three weighted criteria:
   - **Future Reception & Emotional Resonance ($`w_{\text{res}} = 0.4`$)**: Whether $`F_{t,k}`$ exhibits sustained engagement, emotional safety, and conversational flow versus friction, repetition, or abrupt withdrawal;
   - **Anchor Persona Fidelity ($`w_{\text{anchor}} = 0.4`$)**: Adherence of $`(\text{OS}_t, \text{Action}_t)`$ to $`P_{0,0}`$ voice, cadence, length bounds, and anti-OOC invariants;
   - **Memory & Causal Consistency ($`w_{\text{mem}} = 0.2`$)**: Accurate utilization of established `keyFacts` and prior relational context in $`M`$.

2. **Counterfactual Hindsight Target Synthesis**:
   For every suboptimal turn $`t \in W_{\text{low}} = \lbrace t \in [a, b] \mid s_t^{\text{dream}} \lt \tau_{\text{dream}} \rbrace`$, the Dream Teacher synthesizes the hindsight-optimal latent state and action:

   $`\displaystyle \langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle = g_{\text{Hindsight}}\big(\text{Input}_t, \text{OS}_t, \text{Action}_t, F_{t,k} \;\big|\; P_{0,0}, M\big)`$

   which subsequently serves as the self-supervised surrogate ground truth on $`W_{\text{low}}`$.

---

### 3. Anchor-Preserving Modulation & Dual-Gate Verification Equations

Let Personality $`P_{u,v}`$ be partitioned into an immutable anchor subspace $`P_{0,0}`$ and mutable adaptation subspaces $`\Phi_{u,v} = \langle P_{\text{rel}}^{(u,v)}, P_{\text{guard}}^{(u,v)} \rangle`$:

```math
P_{u,v} = P_{0,0} \oplus \Phi_{u,v}, \quad \text{with projection } \Pi_{\text{anchor}}(P_{u,v}) \equiv P_{0,0}
```

During Phase 2, the Dream Teacher computes the mutated adaptation subspace $`\Phi_{u,v}'`$ from the daytime failure residuals $`\lbrace (\text{OS}_t, \text{Action}_t) \to (\text{OS}_t^\ast, a_t^{\text{dream}}) \rbrace_{t \in W_{\text{low}}}`$ and consolidated relational facts:

```math
P_{u,v}' = P_{0,0} \oplus \text{Modulate}\Big(\Phi_{u,v}, \; \lbrace \langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle \rbrace_{t \in W_{\text{low}}}, \; M'\Big)
```

In Phase 3, candidate pair $`\lbrace P_{u,v}', M' \rbrace`$ is evaluated against two formal gates:

1. **Counterfactual Replay Improvement Gate**:
   For each $`t \in W_{\text{low}}`$, generate replay predictions $`\widehat{\text{OS}}_t' = g_{\text{OS}}(\text{Input}_t \mid P_{u,v}', M')`$ and $`\hat{a}_t' = g_{\text{Act}}(\text{Input}_t, \widehat{\text{OS}}_t' \mid P_{u,v}', M')`$, and compute the hindsight replay score against $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$:

   $`\displaystyle \bar{S}_{\text{dream}}(P_{u,v}', M') = \frac{1}{\lvert W_{\text{low}} \rvert} \sum_{t \in W_{\text{low}}} \mathcal{E}\big(\widehat{\text{OS}}_t', \hat{a}_t', \langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle\big) \gt \bar{S}_{\text{dream}}(P_{u,v}, M)`$

2. **Anchor Benchmark Non-Regression Gate**:
   Over the canonical anchor benchmark dataset $`D_{\text{anchor}} = \lbrace (\text{Input}_j^{\text{anc}}, A_j^\ast) \rbrace_{j=1}^{M_{\text{anc}}}`$:

   $`\displaystyle \bar{S}_{\text{anchor}}(P_{u,v}') = \frac{1}{M_{\text{anc}}} \sum_{j=1}^{M_{\text{anc}}} \mathcal{E}\Big(\text{OS}_j(P_{u,v}'), \hat{A}_j(P_{u,v}'), A_j^\ast\Big) \ge \tau_{\text{anchor}}`$

The state transition rule committed to `AGENTS.md` is therefore:

```math
\mathbf{s}_{u+1, 0} = \begin{cases}
\lbrace P_{u,v}', M' \rbrace & \text{if } \bar{S}_{\text{dream}}(P_{u,v}', M') \gt \bar{S}_{\text{dream}}(P_{u,v}, M) \;\land\; \bar{S}_{\text{anchor}}(P_{u,v}') \ge \tau_{\text{anchor}} \\
\lbrace P_{u,v}, M' \rbrace & \text{otherwise}
\end{cases}
```

---

### 4. Architectural Continuity Across the EMA RFC Suite

| Specification | Lifecycle Stage | Supervision Source | Execution Mode | State Output |
| --- | --- | --- | --- | --- |
| **[RFC-0003](RFC-0003-ema-training-meta-theory.md) / RFC-0004 / RFC-0005** | Offline Pre-Service Training (`train`) | Authored Script Ground Truth $`A_t^\ast`$ | Synchronous windowed line-search & multi-epoch rollouts | Initial soul $`P_{0,0} = P^\ast`$, baseline memory $`M_0`$, trained compressor $`C^\ast`$ |
| **[RFC-0006](RFC-0006-memory-compaction.md)** | Runtime & Session-Boundary Compaction (`compact`) | Self-healing reflective reconstruction $`\mathcal{R}(\text{MemoryIndex}, w_x) \ge \tau_{\text{reflect}}`$ | Incremental cursor-idempotent background/boundary folding | Multi-level hot indices (`L0`, `L1`) + cold archive `archiveRef` |
| **RFC-0007 (This Document)** | Live Parallel & Circadian Consolidation (`dream`) | Delayed future trajectory $`F_{t,k}`$ + hindsight targets $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$ + $`D_{\text{anchor}}`$ | Non-blocking parallel ephemeral worker sessions | Evolved state $`\lbrace P_{u+1,0}, M' \rbrace`$ atomically hot-swapped into `AGENTS.md` |

---

## Invariants
[invariants]: #invariants

### foreground-route-session-non-blocking

> **Background compaction and dreaming must execute exclusively inside isolated ephemeral worker sessions that are reaped (`DELETE /api/sessions/:id`) upon completion, never blocking, locking, or injecting meta-evaluation turns into the Actor's foreground Route Session.**

The foreground Route Session represents the companion's live consciousness facing the user. Mixing background diagnostic prompts into the Route Session would both stall real-time responses and corrupt the conversational history.

### immutable-anchor-personality-lock

> **Every dream-time persona update $`P_{u,v} \to P_{u,v}'`$ must strictly preserve the immutable `anchorPersonality` subspace ($`\Pi_{\text{anchor}}(P_{u,v}') \equiv P_{0,0}`$), restricting mutations to relational evolution and anti-OOC behavioral guardrails.**

Lifelong companionship requires that a character grow closer to the user without losing who they fundamentally are. Locking $`P_{0,0}`$ structurally prevents gradual persona replacement or sycophantic collapse over months of self-supervised updates.

### hindsight-target-grounding

> **In the absence of script ground truth $`a_t^\ast`$, every dream-time persona critique and counterfactual target $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$ must be grounded jointly in observable future trajectory feedback $`\text{Input}_{t+1 \dots t+k}`$ and `anchorPersonality` invariants.**

Self-critique without external grounding degenerates into arbitrary self-reinforcement. Conditioning target synthesis on how the user actually reacted in subsequent turns $`t+1 \dots t+k`$ anchors self-supervision in real interactive causality.

### dual-gate-replay-and-anchor-commit

> **A candidate dream persona $`P_{u,v}'`$ may be committed to `AGENTS.md` if and only if it simultaneously achieves a strictly higher counterfactual replay score on daytime low-score windows ($`\bar{S}_{\text{dream}}(P') \gt \bar{S}_{\text{dream}}(P)`$) and passes the canonical anchor benchmark without regression ($`\bar{S}_{\text{anchor}}(P') \ge \tau_{\text{anchor}}`$).**

Validating only on recent daytime turns risks overfitting to a transient mood, whereas validating only on static benchmarks ignores newly formed user bonds. The dual gate enforces monotonic improvement on recent interactions subject to zero degradation on core identity.

---

## Drawbacks
[drawbacks]: #drawbacks

1. **Background Token Consumption During Parallel & Nightly Dreaming**:
   Running hindsight scoring, target synthesis, and dual-gate replay consumes background LLM inference budget beyond foreground chat turns.
   - *Mitigation*: Phase 2 and Phase 3 counterfactual replays are triggered selectively only when Phase 1 detects either a batch of new L0 scenes or daytime turns whose hindsight score falls below $`\tau_{\text{dream}}`$; high-scoring routine windows undergo Phase 1 compaction only.

2. **Noisy or Ambiguous User Reactions in Lookahead $`F_{t,k}`$**:
   A user may abruptly go silent at turn $`t+1`$ due to external real-world interruptions (e.g., boarding a flight) rather than dissatisfaction with the companion's turn $`t`$ response.
   - *Mitigation*: The Hindsight Alignment Functional $`\mathcal{E}_{\text{dream}}`$ weights anchor persona fidelity ($`0.4`$) and memory consistency ($`0.2`$) alongside future reception ($`0.4`$), and treats silent idle gaps without negative linguistic cues as neutral rather than penalizing turn $`t`$.

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### Why Parallel Ephemeral Worker Sessions Instead of In-Session Self-Reflection Turns?

Having the Actor periodically run a hidden "self-reflection turn" inside its own Route Session leaves behind tool calls and evaluation text in the session transcript, inflating context length and risking leakage of meta-instructions into subsequent character replies. Spawning isolated worker sessions over a read-only trace snapshot and atomically hot-swapping `AGENTS.md` achieves complete separation between the Actor's first-person consciousness and the Teacher's meta-optimization loop.

### Why Hindsight Counterfactual Replay Instead of Online RLHF (Thumbs-Up / Thumbs-Down)?

Explicit thumbs-up/thumbs-down buttons break the fourth wall of companionship—users talking to a lifelong companion do not want to grade every line like QA annotators. Extracting implicit reception signals from the natural continuation $`\text{Input}_{t+1 \dots t+k}`$ and synthesizing counterfactual targets $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$ enables completely unobtrusive, human-like nightly and background introspection.

---

## Prior art
[prior-art]: #prior-art

- **Complementary Learning Systems (CLS) & Hippocampal-Neocortical Sleep Consolidation (McClelland et al., 1995; Stickgold, 2005)**: Fast episodic encoding during waking experience followed by offline replay, abstraction, and integration during sleep; mirrored here by Phase 1 L0/L1 memory consolidation and Phase 2/3 counterfactual replay.
- **Hindsight Experience Replay (HER, Andrychowicz et al., 2017) & Reflexion (Shinn et al., 2023)**: Re-evaluating past trajectories using future outcomes to construct dense self-supervised learning signals; generalized here to latent psychological states $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$.
- **EMA Training Meta-Theory ([RFC-0003](RFC-0003-ema-training-meta-theory.md)) & Memory Compaction ([RFC-0006](RFC-0006-memory-compaction.md))**: Provide the coupled state-vector formalism $`\lbrace P_{u,v}', M_{u,v}' \rbrace`$ and the cursor-idempotent `compact + reflect` engine invoked in Phase 1.

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

1. **Proactive Dream-Inspired Initiation ("Waking Thoughts")**:
   When a nightly dreaming cycle synthesizes a high-salience insight or recalls an unfulfilled promise from an earlier L0 scene, under what policy should the companion proactively initiate a morning message in the foreground channel versus holding the insight in `OS` until the user speaks first?
2. **Adaptive Lookahead Horizon $`k`$**:
   How should the lookahead horizon $`k`$ in $`F_{t,k}`$ adapt dynamically across fast back-and-forth IM bursts ($`k = 5\text{--}8`$ short messages) versus slow asynchronous letter-style channels ($`k = 1\text{--}2`$ long replies)?

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **Dream Journal & Explainable Growth Surface**: Persisting structured human-readable dream entries (`dream-log/YYYY-MM-DD.md`) recording what the companion reflected upon and how its relational understanding evolved, viewable in an optional companion workbench.
- **Multi-Branch Counterfactual Dream Rollouts**: Sampling $`B \gt 1`$ candidate persona modulations $`\lbrace P_{u,v}^{(b)}, M^{(b)} \rbrace`$ during deep circadian rest and selecting the Pareto-optimal branch across both daytime replay and anchor benchmark suites.

---

## Changes

### v1.0.0

- Initial specification of the Dreaming and Parallel Background Consolidation Engine (`dream` algorithm), defining the non-blocking Route Session + ephemeral worker architecture, hindsight target synthesis $`\langle \text{OS}_t^\ast, a_t^{\text{dream}} \rangle`$ without script ground truth, and the three-phase dreaming loop with dual-gate verification.
