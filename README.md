<h1 align="center">EverMemoryArchive (EMA)</h1>

<p align="center">
  <strong>让你所爱的角色陪你共度一生</strong><br>
  <em>We build lifelong AI companions that grow, remember, and evolve with you.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-10%2B-F69220?logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/TypeScript-5.7%2B-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-Apache--2.0-blue.svg" alt="License">
</p>

---

## 🌟 Introduction

**EverMemoryArchive (EMA)** is an open architecture and platform for lifelong AI companions. Unlike conventional stateless chatbots, companions powered by EMA:

1. **Grow and remember:** Form continuous episodic memories spanning turns, sessions, days, months, and years.
2. **Possess genuine personality & circadian rhythm:** Operate on organic sleep/wake schedules and conduct autonomous memory consolidation during rest.
3. **Deepen relationships over time:** Retain shared milestones, personal habits, and emotional nuances.

---

## 📦 Packages in this Repository

This repository is organized as a `pnpm` monorepo:

| Package                                     | Path               | Description                                                                                                                                 |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@prism-shadow/ema`](packages/ema)         | `packages/ema`     | Core system prompt & configuration library for creating EMA agents or installing personality features into existing Penguin agents.         |
| [`@prism-shadow/use-ema`](packages/use-ema) | `packages/use-ema` | Penguin Workbench plugin (`manifest.json`, `module.ts`, `ui`) providing a visual studio wizard for creating and configuring EMA companions. |

---

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 20.0.0
- pnpm ≥ 10.0.0

### Installation

```bash
# Clone the repository
git clone https://github.com/EmaFanClub/EverMemoryArchive.git -b next
cd EverMemoryArchive

# Install dependencies across all packages
pnpm install

# Build all packages
pnpm build

# Run unit tests
pnpm test

# Typecheck TypeScript source
pnpm typecheck
```

---

## 🛠️ Monorepo Scripts & Single-TOML Training CLI

All dataset washing, supervised causal persona training, and persona management accept a **single `.toml` configuration file** (see the full guide in [docs/TRAINING.md](docs/TRAINING.md)):

```bash
# 1. Wash dataset (takes the single TOML config + prompt describing what to wash)
pnpm wash --config personas/sakana-kawaii/persona.toml --prompt "清洗日常陪伴与自主意识剧本，对齐第一人称<OS>与零括号口语<Action>"

# 2. Execute training (takes the single TOML config + training prompt)
pnpm train --config personas/sakana-kawaii/persona.toml --prompt "重点强化一逗到底的绵密逗号语流，零括号动作旁白，把动作100%融进口语台词"

# 3. Manage persona (init / show / sync from the single TOML config)
pnpm persona --config personas/sakana-kawaii/persona.toml
pnpm persona sync --config personas/sakana-kawaii/persona.toml --prompt "同步训练结果并安装 companion_portal 工作台"
```

Workspace build & test scripts:

- `pnpm build`: Compiles TypeScript packages (`@prism-shadow/ema` and `@prism-shadow/use-ema`).
- `pnpm typecheck`: Performs full type-checking with `tsc --noEmit`.
- `pnpm test`: Runs Vitest across all test suites.
- `pnpm format`: Formats code with Prettier.
- `pnpm format:check`: Verifies code formatting.

---

## 💬 Community & Support

- **Discord:** [EmaFanClub](https://discord.gg/rHQNadCrTv)
- **QQ Group:** 1102326235

---

## 📄 License

Licensed under the [Apache License, Version 2.0](LICENSE).
Copyright © 2026 Ema Fan Club.
