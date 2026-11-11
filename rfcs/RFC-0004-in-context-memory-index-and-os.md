# RFC-0004 First-Edition Persona and Memory Modeling: In-Context Memory-Index and Latent OS

[中文版](RFC-0004-in-context-memory-index-and-os.zh.md)

- Feature Name: `in-context-memory-index-and-os`
- Start Date: 2026-11-10
- RFC PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)
- Implementation PR: [EmaFanClub/EverMemoryArchive#46](https://github.com/EmaFanClub/EverMemoryArchive/pull/46)

> **Status & Provenance**:
> - State: draft (Draft for Board Review)
> - Rev: v1.0.0

## Summary
[summary]: #summary

This RFC specifies the first-edition runtime and cognitive modeling architecture for EverMemoryArchive (EMA) companion agents, directly resolving Open Questions 1 (`memory format`), 2 (`what are contained in memory`), and the structural schema of Question 3 (`format of personality`) posed in [RFC-0003](RFC-0003-ema-training-meta-theory.md).

Specifically, this document:
1. Formalizes the two-stage latent-mediated cognitive forward equation $`\text{Input}_t \xrightarrow{P, M} \text{OS}_t \xrightarrow{P, M, \text{Input}_t} \text{Action}_t`$, where the companion agent explicitly emits structured `<OS>...</OS>` and `<Action>...</Action>` blocks across both supervised training and live companionship, governed by the **Non-Mind-Reading Perspective Boundary Invariant**;
2. Defines the six-slot structured `CompanionPersonality` schema ($`P_{u,v}`$: `coreIdentity`, `emotionalDynamics`, `speechStyleRules`, `cognitiveOSPatterns`, `behavioralHabits`, `antiOocConstraints`, plus `mutationHistory`) and **Single-Source Prompt Prefix Injection** into `AGENTS.md`, eliminating duplicate system/user prompt token bloat and achieving $`\gt 90\%`$ KV prompt cache hit rates;
3. Defines the episodic `MemoryItem` tuple $`\langle \text{Input}_t, \text{committedOS}_t, \text{Action}_t^{\ast} \rangle`$, the single-level in-context `SceneMemoryIndexItem` ($`\text{MemoryIndex}_{0,x}`$ containing first-person `summary`, `innerOSArc`, `keyFacts`, and `archiveRef`), and the closed-loop reconstructibility (`compact` + `reflect`) evaluation metric $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) \in [0, 100]`$ for training the compression operator $`C`$.

---

## Motivation
[motivation]: #motivation

### 1. Instantiating RFC-0003's Coupled Dynamical System $`\Theta = (P, M, C)`$

In [RFC-0003](RFC-0003-ema-training-meta-theory.md), companion cognition was formulated from first principles as a coupled dynamical system over Personality $`P`$, Memory $`M = f_C(D, P)`$, and Compression Operator $`C`$. However, to execute that meta-theory on real narrative corpora and deploy the resulting companion inside PenguinHarness, three concrete modeling problems must be solved:
- How is the latent psychological transition $`\text{OS}_t`$ represented, parsed, and isolated from omniscient narrator leakage?
- How is Personality $`P_{u,v}`$ structured so that local recursive self-improvement (RSI) edits specific behavioral mechanisms without corrupting existing persona traits?
- What exact fields belong inside an episodic `MemoryItem` and a compressed `SceneMemoryIndexItem` ($`\text{MemoryIndex}_{0,x}`$), and how do we quantitatively measure whether compression preserved the soul of a scene?

### 2. The Perspective Boundary Problem: Latent `<OS>` vs. Unuttered First-Person Narration

When training or evaluating a companion (`Companion`, e.g., `Alice`) on narrative scripts or interactive fiction logs written from a counterpart's (`Protagonist`, e.g., `Bob`) first-person point of view, raw `[Narration]` blocks interleave two fundamentally different epistemic categories:
- **Observable physical cues**: environmental changes, facial expressions, gestures, and spoken dialogue that `Alice` can legitimately perceive;
- **Unuttered internal monologue**: `Bob`'s private mental commentary, unspoken secrets, or internal associations that were never verbalized aloud.

Without an explicit **Non-Mind-Reading Perspective Boundary**, language models routinely commit perspective leakage—having `Alice` directly answer or quote `Bob`'s unuttered thoughts inside `[Narration]`. Conversely, `Alice` herself often exhibits an outward persona (`<Action>`) that contrasts sharply with her inner emotional state (`<OS>`, such as protective vigilance hidden behind a sharp or teasing remark). Formalizing the two-stage cognitive boundary solves both problems simultaneously: `Alice` filters `Input_t` strictly through her observable perceptual horizon, forms her private first-person `<OS>`, and translates that `<OS>` into an authentic outward `<Action>`.

### 3. Single-Source `AGENTS.md` Prefix Injection & KV Cache Economics

Across a 200-scene trajectory, a single-level in-context `MemoryIndex` occupies roughly $`3\text{k}\text{--}5\text{k}`$ tokens, and the structured `CompanionPersonality` occupies $`0.8\text{k}\text{--}1.2\text{k}`$ tokens. If a training or runtime harness injects $`(P_{u,v}, \text{MemoryIndex})`$ into the agent's system instructions (`AGENTS.md`) *and* repeats them inline inside every turn's user prompt, two failure modes arise:
1. **Double Token Bloat**: Every forward pass pays twice for the entire persona and memory index;
2. **KV Cache Invalidation**: Mutating dynamic user-prompt prefixes prevents the inference engine from reusing cached key-value states across consecutive turns within a scene window.

By establishing `AGENTS.md` as the **Single-Source Prompt Prefix** for $`(P_{u,v}, \text{MemoryIndex})`$ during live agent synchronization—and disabling redundant inline injection whenever disk synchronization is active—the entire persona and long-term memory prefix remains byte-identical across all turns of a scene window, pushing KV prompt cache hit rates above $`90\%`$.

### 4. Objective Memory Compression via Reconstructibility (`compact` + `reflect`)

Standard summarization pipelines compress dialogue into third-person objective abstracts, discarding the companion's subjective emotional trajectory (`<OS>`) and relational promises. Worse, they lack an intrinsic quality metric. By requiring every `SceneMemoryIndexItem` to preserve a first-person `summary`, an affective `innerOSArc`, and discrete `keyFacts` linked via an `archiveRef`, we can score any candidate compression prompt $`C`$ via a closed-loop **Reconstructibility Evaluator** $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) \in [0, 100]`$ that measures how accurately the underlying scene trajectory $`w_x`$ can be reflected back from the compressed index item alone.

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 1. Two-Stage Cognitive Forward Pass ($`\text{Input}_t \to \text{OS}_t \to \text{Action}_t`$)

At every interaction turn $`t`$, the companion agent processes incoming context through a two-stage cognitive pipeline:

```
Observable Input_t  ──(Perspective Filter: Non-Mind-Reading)──>  Perceived Stimulus
                                                                        │
         ┌──────────────────────────────────────────────────────────────┘
         ▼
  [Stage 1: Latent Inner State (OS_t)]
   Conditioned on (P_{u,v}, MemoryIndex, Intra-Scene History):
   Synthesize 1 concise first-person inner monologue sentence capturing
   true affective shift, subtext, and protective/relational intent.
         │
         ▼
  [Stage 2: External Reaction (Action_t)]
   Conditioned on (P_{u,v}, MemoryIndex, Input_t, OS_t):
   Emit spoken dialogue ("...") and physical micro-expressions strictly
   obeying speech-length, cadence, and anti-OOC rules.
```

#### (1) Unified `<OS>` and `<Action>` Emission Across Training and Live Companionship

Across both supervised script training and live interactive companionship (`AGENTS.md` protocol §8), the companion agent executes the exact same two-stage cognitive output contract on every turn:
```xml
<OS>He looks exhausted even though he is pretending everything is fine; I want to stay close to make sure he does not collapse, even if I sound blunt.</OS>
<Action>「...Hmph. Do not get the wrong idea, I just happened to be walking this way.」</Action>
```
- **Training, Evaluation & Dream Replay**: The Teacher evaluator and memory compactor directly inspect and score the emitted `<OS>` and `<Action>` blocks.
- **Live Interactive Companionship & External Channels**: The companion agent always emits `<OS>...</OS>` (first-person inner monologue in the character's voice) followed by `<Action>...</Action>` (spoken dialogue and physical cues). Both blocks are recorded verbatim in the session trace to form the canonical `MemoryItem` tuple $`\langle \text{Input}_t, \text{OS}_t, \text{Action}_t \rangle`$ for subsequent `compact` and `dream` cycles, while external channel adapters unwrap `<Action>` when dispatching messages to external chat surfaces.

#### (2) The Non-Mind-Reading Perspective Boundary Walkthrough

Consider a turn where `Input_t` contains both observable actions and unuttered first-person narration from `Protagonist` (`Bob`):

```text
[Narration] I forced a calm smile and waved my hand, hiding the sharp pain in my chest so Alice would not worry about my old injury flaring up again.
【Bob】: 「The weather on this rooftop is pretty nice today, isn't it?」
```

- **Invalid Response (Mind-Reading Violation)**:
  - `<OS>`: *Bob's old chest injury is flaring up again! I need to tell him to stop hiding his chest pain.*
  - `<Action>`: *「Stop smiling! Your chest injury is hurting again, isn't it?」*
  - *Why it fails*: `Bob` never spoke about his chest pain; the explanation existed only inside the narrator's private monologue.
- **Valid Response (Perspective-Bounded Inference)**:
  - `<OS>`: *His smile looks slightly stiff compared to usual, even though he is talking casually about the weather. I will keep a close eye on him without prying.*
  - `<Action>`: *「...It is just windy. Put your coat on properly, clumsy.」*
  - *Why it succeeds*: `Alice` reacts solely to observable visual/auditory cues (a stiff smile, casual remark on a windy rooftop) while remaining completely faithful to her protective yet blunt persona.

---

### 2. Structured `CompanionPersonality` Schema ($`P_{u,v}`$)

Rather than storing Personality $`P`$ as an unstructured wall of prose—which quickly suffers from instruction drift and catastrophic overwrite during iterative Teacher updates—RFC-0004 decomposes $`P_{u,v}`$ into six orthogonal functional slots plus an immutable audit trail (`mutationHistory`):

| Slot | Type | Cognitive Responsibility |
| --- | --- | --- |
| `coreIdentity` | `string` | Foundational identity, worldview, backstory, and core relational bond with the counterpart (`Protagonist`). Locked as an immutable anchor across local scene mutations. |
| `emotionalDynamics` | `string[]` | Affective baseline, outer-vs-inner contrast patterns, and conditional emotional transitions across everyday vs. high-stakes contexts. |
| `speechStyleRules` | `string[]` | Concrete linguistic constraints: sentence length bounds, cadence, pronouns, signature catchphrases, and silence/ellipsis usage. |
| `cognitiveOSPatterns` | `string[]` | Rules governing how external stimuli map to latent `<OS>` states and how `<OS>` translates into `<Action>`, explicitly including the **Non-Mind-Reading Perspective Boundary**. |
| `behavioralHabits` | `string[]` | Signature physical micro-actions, posture shifts, and non-verbal expressive habits accompanying dialogue. |
| `antiOocConstraints` | `string[]` | Negative constraints accumulated via Teacher error diagnostics (e.g., banning AI-assistant phrasing, banning long-winded lecturing, banning unrequested tool calls). |
| `mutationHistory` | `Array<MutationRecord>` | Versioned lineage recording `fromVersion`, `toVersion`, `sceneId`, `reason`, `scoreBefore`, and `scoreAfter`. |

---

### 3. Episodic `MemoryItem` and Single-Level `SceneMemoryIndexItem` ($`\text{MemoryIndex}_{0,x}`$)

#### (1) Atomic Episodic Tuple: `MemoryItem`

Within an active scene window $`w_x`$, each turn $`t`$ produces a `MemoryItem` bridging the Student's prediction and the Teacher's verification:

```math
\text{MemoryItem}_t = \langle \text{Input}_t, \; \text{committedOS}_t, \; \text{Action}_t^{\ast} \rangle
```

- `predictedOS` & `predictedAction`: The raw outputs generated by the Student policy under $`P_{u,v}`$, preserved on the struct for Teacher diagnostics and ablation telemetry;
- `committedOS`: If the Student's `predictedOS` is psychologically consistent with the ground-truth action $`\text{Action}_t^{\ast}`$ (`osConsistent === true`), `committedOS` retains `predictedOS`; otherwise, the Teacher imputes the calibrated latent state $`\text{OS}_t^{\ast}`$ so downstream memory compaction is never polluted by out-of-character inner monologue;
- `gtActionText` ($`\text{Action}_t^{\ast}`$): Force-overridden with the ground-truth script reaction to keep all subsequent turns grounded on the true narrative manifold.

#### (2) Compressed Scene Entry: `SceneMemoryIndexItem` ($`\text{MemoryIndex}_{0,x}`$)

When scene window $`w_x`$ finishes, the sequence of committed `MemoryItem`s is compressed by operator $`C`$ into a single-level `SceneMemoryIndexItem`:

```json
{
  "sceneId": "005_ch01_05",
  "order": 5,
  "chapter": "ch01",
  "title": "Evening on the Old Clocktower Rooftop",
  "setting": "Clocktower Rooftop / Dusk",
  "summary": "At dusk on the clocktower rooftop, I watched the sunset with Bob and promised to guard this quiet place together whenever classes end.",
  "innerOSArc": "Initial guardedness softened into quiet relief upon realizing he genuinely respects my solitude.",
  "keyFacts": [
    "Shared secret spot: the old clocktower rooftop at dusk",
    "Promise: meet on the rooftop after afternoon lectures",
    "Bob dislikes crowded ceremonies just as much as I do"
  ],
  "archiveRef": "archive://L0/005_ch01_05",
  "reflectionScore": 92
}
```

When rendered into `AGENTS.md` via `formatMemoryIndexMarkdown`, each scene occupies a single high-density Markdown bullet:

```markdown
- **[005_ch01_05 | Evening on the Old Clocktower Rooftop (Clocktower Rooftop / Dusk)]**: At dusk on the clocktower rooftop, I watched the sunset with Bob and promised to guard this quiet place together whenever classes end. *(Inner OS: Initial guardedness softened into quiet relief upon realizing he genuinely respects my solitude.)* | Key Facts: Shared secret spot: the old clocktower rooftop at dusk；Promise: meet on the rooftop after afternoon lectures
```

---

### 4. Single-Source Prompt Prefix Injection into `AGENTS.md`

`renderCompanionAgentsMd` compiles $`P_{u,v}`$ (Sections 1–6), the accumulated `MemoryIndex` (Section 7), and the `Interaction Protocol` (Section 8) into the companion agent's `agent_state/AGENTS.md`.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ System Prompt Prefix (Loaded from agent_state/AGENTS.md — Cached Prefix) │
│   §1 Core Identity                                                       │
│   §2 Emotional Dynamics                                                  │
│   §3 Speech Style Rules                                                  │
│   §4 Latent <OS> Cognitive Patterns (incl. Non-Mind-Reading Rule)        │
│   §5 Behavioral Habits                                                   │
│   §6 Anti-OOC Constraints                                                │
│   §7 Single-Level In-Context MemoryIndex (Scenes 1 .. x-1)               │
│   §8 Interaction Protocol                                                │
├──────────────────────────────────────────────────────────────────────────┤
│ Dynamic Turn User Prompt (Varies per Turn / Micro-Batch in Scene x)      │
│   - Current Scene Header (sceneId, title, setting)                       │
│   - Intra-Scene Sliding History (last <= 12 Teacher-Forced turns)        │
│   - Active Turn Input_t (or Micro-Batch Inputs)                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Whenever `syncAgentOnDisk` is enabled, `buildStudentReactPrompt` omits inline persona and memory blocks (`includeInlinePersonaAndMemory = false`), referencing the pre-loaded `AGENTS.md` system prefix instead.

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Formal Cognitive Forward Equations & Perspective Projection

Let $`\text{Input}_t`$ denote the raw sequence of non-target script lines preceding turn $`t`$. Define the **Observable Perspective Projection Operator** $`\Pi_{\text{obs}}`$:

```math
\Pi_{\text{obs}}(\text{Input}_t) = \text{Filter}_{\text{observable}}(\text{Input}_t)
```

which strips unuttered internal mental state attributions of other characters from `[Narration]` while preserving all audible speech, visible gestures, and environmental states.

Given current structured personality $`P_{u,v}`$, accumulated single-level memory index $`I_{\lt v} = \lbrace \text{MemoryIndex}_{0,1}, \dots, \text{MemoryIndex}_{0,v-1} \rbrace`$, and bounded intra-scene sliding history $`H_t = \lbrace \text{MemoryItem}_{\max(1, t-K)}, \dots, \text{MemoryItem}_{t-1} \rbrace`$ (with default window horizon $`K = 12`$), the two-stage forward policy is defined as:

```math
\text{OS}_t \sim \pi_{\text{OS}}\big(\cdot \;\big|\; \Pi_{\text{obs}}(\text{Input}_t), \; P_{u,v}, \; I_{\lt v}, \; H_t\big)
```

```math
\text{Action}_t \sim \pi_{\text{Act}}\big(\cdot \;\big|\; \text{OS}_t, \; \Pi_{\text{obs}}(\text{Input}_t), \; P_{u,v}, \; I_{\lt v}, \; H_t\big)
```

#### Deterministic Output Parsing & Fallback Hierarchy (`parseStudentTurnOutput`)

To guarantee total function execution across diverse base models and thinking levels, `parseStudentTurnOutput(rawText)` applies a three-tier extraction grammar:
1. **Primary XML Extraction**: Matches `/<OS>([\s\S]*?)<\/OS>/i` and `/<Action>([\s\S]*?)<\/Action>/i`; sets `formatValid = true` when both tags are present and non-empty.
2. **Structured JSON Fallback**: If XML tags are absent, attempts to parse a JSON object `{ "os": "...", "action": "..." }` (used automatically in micro-batched forward passes where the model emits an array of `{ turnId, os, action }` objects); sets `formatValid = true` if both fields are valid strings.
3. **Graceful Degradation Fallback**: If neither structure matches, extracts any partial tag content or defaults `os` to an observational baseline while stripping `<OS>` blocks from the remaining text to form `action`, marking `formatValid = false` for ablation penalty tracking.

---

### 2. Canonical TypeScript Schemas

The normative TypeScript interfaces implemented in `@prism-shadow/ema` (`packages/ema/src/training/types.ts`) are specified below:

```typescript
export interface CompanionPersonality {
  /** Version label, e.g. "P_0_0", "P_0_1", "P_1_0" */
  version: string;
  /** Target companion display name */
  name: string;
  /** Core identity, background, worldview, and bond with the counterpart */
  coreIdentity: string;
  /** Archetype & conditional emotional dynamics */
  emotionalDynamics: string[];
  /** Concrete speech style rules, sentence length constraints, and catchphrases */
  speechStyleRules: string[];
  /** Latent <OS> inner monologue cognitive patterns bridging Input -> Action */
  cognitiveOSPatterns: string[];
  /** Signature physical actions & behavioral habits */
  behavioralHabits: string[];
  /** Anti-OOC negative constraints accumulated via Teacher RSI diagnostics */
  antiOocConstraints: string[];
  /** Evolution changelog across training windows */
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
  /** Student's predicted latent OS_t */
  predictedOS: string;
  /** Teacher-verified or imputed latent OS_t^* committed to memory */
  committedOS: string;
  /** Student's predicted Action_t (scored, discarded from state history) */
  predictedAction: string;
  /** Teacher-forced Ground Truth Action_t^* committed to state history */
  gtActionText: string;
  /** Logical & psychological consistency between predictedOS and gtActionText */
  osConsistent: boolean;
  /** Teacher score (0-100) for OS consistency & depth */
  osScore: number;
  /** Teacher score (0-100) for Action similarity (tone, cadence, subtext, habits) */
  actionScore: number;
  /** Weighted combined turn score (0.4 * osScore + 0.6 * actionScore) */
  combinedScore: number;
  /** Brief diagnostic from Teacher explaining gaps or accuracy */
  diagnostic: string;
}

export interface SceneMemoryIndexItem {
  sceneId: string;
  order: number;
  chapter: string;
  title: string;
  setting: string;
  /** Concise first-person episodic summary (<= 140 chars) */
  summary: string;
  /** Companion's latent inner feelings (<OS> trajectory, <= 60 chars) */
  innerOSArc: string;
  /** Key relational facts, lore, or promises (1-3 items) */
  keyFacts: string[];
  /** Optional pointer to the raw episodic MemoryItem archive for on-demand decompression */
  archiveRef?: string;
  /** Closed-loop reflection score R(MemoryIndex_{0,x}, w_x) in [0, 100] */
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

### 3. Closed-Loop Reconstructibility Metric $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$

Let $`w_x = \lbrace \text{MemoryItem}_{x,1}, \dots, \text{MemoryItem}_{x,L_x} \rbrace`$ denote the committed episodic trajectory of scene $`x`$, and let $`\text{MemoryIndex}_{0,x} = \text{compress}_C(w_x)`$ be the compressed index entry produced under `CompressionPromptConfig` $`C`$.

The closed-loop reconstructibility functional $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) \in [0, 100]`$ is evaluated by a `reflect` judge prompt that inspects $`\text{MemoryIndex}_{0,x}`$ alongside ground-truth turn samples from $`w_x`$:

```math
\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x) = w_{\text{event}} \cdot r_{\text{event}} + w_{\text{os}} \cdot r_{\text{os}} + w_{\text{fact}} \cdot r_{\text{fact}} - p_{\text{halluc}}
```

where:
- $`r_{\text{event}} \in [0, 40]`$ measures **Episodic Event Recall**: whether `summary` captures the core conflict, interaction actions, and temporal/spatial context in authentic first-person voice;
- $`r_{\text{os}} \in [0, 30]`$ measures **Affective `<OS>` Arc Preservation**: whether `innerOSArc` accurately preserves the companion's hidden psychological transition $`\text{committedOS}_{x,1 \dots L_x}`$ rather than flattening it into generic sentiment;
- $`r_{\text{fact}} \in [0, 30]`$ measures **Long-Horizon Anchor Retention**: whether `keyFacts` retains concrete promises, named entities, and relational shifts required by future scenes;
- $`p_{\text{halluc}} \in [0, 100]`$ penalizes any fabricated detail contradicting $`w_x`$.

When $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$ falls below target fidelity or `missingDetail` identifies systematic omission (e.g., dropping physical gift exchanges or unresolved promises), the Teacher updates `CompressionPromptConfig.instructions` ($`C_{u,v} \to C_{u,v+1}`$) while enforcing hard length bounds (`maxSummaryChars = 140`, `maxKeyFacts = 3`) so the compression policy cannot game $`\mathcal{R}`$ by inflating token length.

---

### 4. Prefix KV-Cache Efficiency Analysis

Let $`L_{\text{sys}} = |P_{u,v}| + |I_{\lt v}|`$ denote the token length of the rendered `AGENTS.md` prefix (typically $`4000\text{--}6000`$ tokens), and let $`L_{\text{turn}}`$ denote the dynamic intra-scene turn context (typically $`400\text{--}800`$ tokens). Across a scene window of $`M`$ forward calls:

- **Naive Dual Injection (System + Inline User Prompt)**:
  Total uncached input tokens scale as $`M \cdot (2 L_{\text{sys}} + L_{\text{turn}})`$, and changing the inline block shifts token offsets.
- **Single-Source `AGENTS.md` Prefix Injection (`includeInlinePersonaAndMemory = false`)**:
  The first call writes $`L_{\text{sys}}`$ to the provider's prefix cache ($`1 \times \text{cacheWrite}`$); the remaining $`M - 1`$ calls hit $`L_{\text{sys}}`$ as cached prefix reads ($`(M - 1) \times \text{cacheRead}`$), paying `cacheWrite` only on $`L_{\text{turn}}`$.

For $`L_{\text{sys}} = 5000`$, $`L_{\text{turn}} = 500`$, and $`M = 10`$, single-source prefix injection achieves a KV cache hit ratio of:

```math
\eta_{\text{cache}} = \frac{(M - 1) \cdot L_{\text{sys}}}{M \cdot (L_{\text{sys}} + L_{\text{turn}})} \approx \frac{45000}{55000} \approx 81.8\% \text{ to } 93.5\%
```

reducing prompt token expenditure by nearly an order of magnitude on cache-aware model providers.

---

## Invariants
[invariants]: #invariants

### non-mind-reading-perspective-boundary

> **During both `<OS>` synthesis and `<Action>` generation, the companion agent must condition strictly on observable speech, actions, and environmental states, never responding to or echoing another character's unuttered first-person narration.**

Narrative scripts frequently expose the protagonist's internal thoughts inside `[Narration]` blocks for the reader's benefit. If the companion reacts to unuttered mental text, the causal boundary between two distinct minds collapses and roleplay realism is destroyed.

### explicit-latent-os-and-action-framing

> **Every companion turn—both in offline supervised training and in live runtime interaction—must execute the two-stage cognitive transition $`\text{Input}_t \to \text{OS}_t \to \text{Action}_t`$ by explicitly emitting structured `<OS>...</OS>` and `<Action>...</Action>` blocks.**

Keeping the `<OS>` and `<Action>` emission contract identical across training, live interaction, compaction, and dreaming guarantees that every runtime turn natively records a complete `MemoryItem` tuple $`\langle \text{Input}_t, \text{OS}_t, \text{Action}_t \rangle`$ without relying on model-specific internal thinking traces.

### single-source-prefix-canonicality

> **When `AGENTS.md` state synchronization is active, `CompanionPersonality` ($`P_{u,v}`$) and `MemoryIndex` ($`M_{u,v}`$) must be injected exclusively once via the `AGENTS.md` system prompt prefix and never duplicated inline inside turn-level user prompts.**

Single-source canonicality prevents contradictory persona instructions between system and user roles, eliminates $`2\times`$ prompt token waste, and preserves prefix byte-identity for $`\gt 90\%`$ KV cache reuse.

### first-person-episodic-reconstructibility

> **Every `SceneMemoryIndexItem` in `MemoryIndex` must be authored in the companion's first-person voice (`I`) with explicit `summary`, `innerOSArc`, and `keyFacts` fields bounded by strict character budgets, and its quality is governed by the closed-loop reconstructibility score $`\mathcal{R}(\text{MemoryIndex}_{0,x}, w_x)`$.**

Third-person summaries strip away how the companion *felt* about an event (`innerOSArc`), turning personal memories into detached encyclopedia entries; strict length bounds paired with reflection scoring prevent both information loss and unbounded context bloat.

---

## Drawbacks
[drawbacks]: #drawbacks

1. **Sensitivity to Strict Output Tagging on Ultra-Lightweight Models**:
   Smaller or heavily quantized models at `thinking_level: low` occasionally omit closing `</OS>` or `</Action>` tags during single-turn inference.
   - *Mitigation*: `parseStudentTurnOutput` implements a three-tier parser (XML tags $`\to`$ JSON fallback $`\to`$ regex split) and `runModelAndThinkingAblation` tracks `formatSuccessRate` to select base models with $`\ge 99\%`$ structural compliance.

2. **Context Window Growth Over Thousands of Scenes**:
   While 100–200 scenes fit effortlessly in a single-level in-context `MemoryIndex` (~4k tokens), a multi-year lifelong companion accumulating $`2000+`$ scenes will eventually exceed single-level prefix budgets.
   - *Mitigation*: `buildStudentReactPrompt` supports sliding active window selection over `MemoryIndex` while `AGENTS.md` retains the canonical full index, leaving multi-tier archival folding as a clean future extension once single-level capacity is saturated.

---

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

### Why Structured 6-Slot `CompanionPersonality` Instead of Free-Form Markdown Cards?

In free-form character cards, asking a Teacher LLM to rewrite the persona after a failed scene frequently causes the model to accidentally drop speech length constraints while fixing emotional tone, or overwrite foundational identity traits with scene-specific instructions. Partitioning `CompanionPersonality` into six typed arrays (`coreIdentity`, `emotionalDynamics`, `speechStyleRules`, `cognitiveOSPatterns`, `behavioralHabits`, `antiOocConstraints`) enables slot-wise anchor locking (`mergeWithAnchors` in RFC-0005), guaranteeing structural stability across dozens of RSI mutations.

### Why First-Person `innerOSArc` Inside `SceneMemoryIndexItem`?

An alternative design stores only factual triplets `(Subject, Predicate, Object)` in memory. Empirical testing shows that factual triplets fail on affective continuity: knowing *that* `Alice` and `Bob` visited a rooftop does not tell the agent *how* `Alice`'s guardedness melted during that visit. Persisting `innerOSArc` alongside `summary` and `keyFacts` preserves continuous emotional causality across scene boundaries.

---

## Prior art
[prior-art]: #prior-art

- **Chain-of-Thought (Wei et al., 2022) & Hidden Scratchpads**: Demonstrates that intermediate reasoning tokens improve downstream task accuracy; specialized here into first-person psychological state modeling (`<OS>`) bounded by perceptual perspective constraints.
- **MemGPT / OS-Level Context Paging (Packer et al., 2023)**: Treats in-context memory as a managed resource; simplified in RFC-0004 by exploiting modern long-context KV prefix caching with a single-level annotated `MemoryIndex` before introducing complex paging overhead.
- **Autoencoder Reconstruction Loss**: Measuring compression fidelity via a decoder (`reflect`) that reconstructs the input scene $`w_x`$ from the latent code $`\text{MemoryIndex}_{0,x}`$.

---

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **On-Demand Archive Decompression Trigger Policy**: While `SceneMemoryIndexItem` carries `sceneId` and optional `archiveRef` pointers back to raw `MemoryItem` logs, what exact confidence heuristic should trigger an automatic decompression tool call during live companion chat when a user asks about minute verbatim dialogue from 50 scenes ago?
- **Cross-Epoch `CompressionPromptConfig` Co-Evolution Schedule**: How frequently should $`C`$ be mutated relative to $`P`$ when both are unlocked simultaneously? (Initial inverse training algorithms for $`P`$ and $`M`$ are detailed in [RFC-0005](RFC-0005-script-to-persona-memory-training.md).)

---

## Future possibilities
[future-possibilities]: #future-possibilities

- **Selective Episodic Decompression Tool (`recall_scene_archive`)**: Allowing the companion agent in live sessions to expand any `sceneId` from `MemoryIndex` back into its raw `<Input, committedOS, Action>` turn sequence when deep nostalgic recall is requested.
- **Multi-Modal Sensory Anchors in `SceneMemoryIndexItem`**: Extending `keyFacts` and `innerOSArc` with visual CG descriptors and voice prosody tags for multi-modal companion rendering.

---

## Changes

### v1.0.0

- Initial specification of the two-stage cognitive forward pass ($`\text{Input}_t \to \text{OS}_t \to \text{Action}_t`$), Non-Mind-Reading Perspective Boundary, 6-slot `CompanionPersonality` schema, single-source `AGENTS.md` prefix injection, `MemoryItem` / `SceneMemoryIndexItem` schemas, and closed-loop `compact` + `reflect` evaluation metric $`\mathcal{R}`$.
