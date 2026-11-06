# @prism-shadow/ema

> Core system prompt and personality configuration library for **EverMemoryArchive (EMA)** in PenguinHarness.
>
> _"We build lifelong AI companions that grow, remember, and evolve with you."_

---

## Overview

`@prism-shadow/ema` provides structured prompt generators, memory lifecycle templates, and personality feature injectors to:

1. **Create brand-new EMA Lifelong Companion Agents** with rich episodic memory architectures, emotional grounding, circadian rhythms, and ontological knowledge pillars.
2. **Install EMA Personality Features into existing Penguin agents** (e.g., developers, researchers, assistants), endowing them with relational warmth, personal preference memory, and continuous growth without disrupting their primary domain capabilities.

## Installation

```bash
pnpm add @prism-shadow/ema
```

## Quick Start

### 1. Create a New EMA Companion Agent

```typescript
import { generateEmaAgent, EMA_AGENT_PRESETS } from "@prism-shadow/ema";

// Generate using a preset or custom config
const result = generateEmaAgent({
  id: "my_ema_companion",
  name: "Ema",
  title: "Lifelong AI Companion",
  warmthLevel: "warm",
  relationshipRole: "lifelong_companion",
});

console.log(result.systemPrompt); // Complete system prompt
console.log(result.agentsMd); // Content for agent_state/AGENTS.md
console.log(result.metadata); // Agent metadata
```

### 2. Install Personality Feature into an Existing Penguin Agent

```typescript
import { installPersonalityFeatureToAgentsMd } from "@prism-shadow/ema";

const existingAgentsMd = `# Code Reviewer\nYou review pull requests thoroughly.`;

const updatedAgentsMd = installPersonalityFeatureToAgentsMd(existingAgentsMd, {
  warmthLevel: "warm",
  relationshipRole: "empathetic_collaborator",
  personalityTraits: [
    "Attentive to user coding preferences",
    "Encouraging during difficult debugging sessions",
    "Seamless memory of past architecture decisions",
  ],
});

// The updated AGENTS.md now contains an isolated, non-destructive EMA personality block!
```

### 3. Presets Included

- **Companion Presets:**
  - `warm_companion`: Deeply empathetic, caring, and attentive companion.
  - `curious_explorer`: Thought partner eager to explore knowledge and philosophy.
  - `creative_copilot`: Imaginative muse for writing, art, and coding.
  - `mindful_mentor`: Calm, reflective, and grounding guide.

- **Personality Feature Presets:**
  - `empathetic_collaborator`: Adds collaborative warmth to engineering and technical agents.
  - `attentive_assistant`: Adds proactive care and schedule sensitivity to assistant agents.
  - `mindful_researcher`: Adds continuous intellectual dialogue memory to research agents.

---

## License

Apache-2.0 © Ema Fan Club
