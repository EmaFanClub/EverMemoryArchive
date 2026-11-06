# @prism-shadow/use-ema

> Penguin Workbench plugin for **EverMemoryArchive (EMA)**.
> Guides users to create lifelong AI companions or install personality features into existing Penguin agents using `@prism-shadow/ema`.

---

## Overview

`@prism-shadow/use-ema` provides a Penguin Workbench tab (`use-ema.main`) and visual wizard interface:

- **Create EMA Companion:** Interactively customize companion personas, emotional tone, memory tiers, and circadian cycles with live previews of `AGENTS.md` and `system_config.yaml`.
- **Install Personality Feature:** Seamlessly inject an EMA personality layer into any existing Penguin agent without breaking existing domain rules.
- **Memory Architecture Guide:** Visual documentation explaining EMA's 4-tier episodic memory, LanceDB semantic vector storage, and sleep/wake consolidation.

## Package Structure

```
packages/use-ema/
├── manifest.json       # Penguin Workbench Manifest
├── module.ts           # Workbench Backend Module & API Router
├── index.ts            # Entry point re-exporting module
├── ui/
│   ├── index.html      # Workbench UI Page
│   ├── app.js          # Interactive Studio Logic
│   └── style.css       # Penguin Theme Compatible Styles
└── tests/
    └── workbench.spec.ts
```

## Running inside PenguinHarness

When placed under an agent's `agent_state/workbenches/use-ema/`, PenguinHarness mounts the workbench automatically as a tab beside the chat.

## API Endpoints

- `GET /api/health`: Health status.
- `GET /api/presets`: Retrieve companion and personality presets.
- `GET /api/agents`: Retrieve project agents from WorkbenchHost.
- `POST /api/generate-agent`: Generates system prompt, `AGENTS.md`, and `system_config.yaml`.
- `POST /api/install-personality`: Injects EMA personality block into existing `AGENTS.md`.

## License

Apache-2.0 © Ema Fan Club
