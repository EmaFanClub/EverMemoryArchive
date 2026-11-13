# RFC-0008 EMA Data Storage, Configuration Architecture, and Workspace Boundaries

[中文版](RFC-0008-ema-data-and-config.zh.md)

> **State**: In Review (Draft for Board Review)  
> **Rev**: v1.0.0  

- Feature Name: `ema-data-and-config`
- Start Date: 2026-11-13
- RFC PR: [EmaFanClub/EverMemoryArchive#54](https://github.com/EmaFanClub/EverMemoryArchive/pull/54)
- Implementation PR: [EmaFanClub/EverMemoryArchive#54](https://github.com/EmaFanClub/EverMemoryArchive/pull/54)

## Summary
[summary]: #summary

This RFC specifies the **Data Storage Topology**, **Configuration Architecture**, **Workspace Boundaries**, and **Core Lifecycle Scenarios (Runtime Launch & Offline Training)** for EverMemoryArchive (EMA):

0. **Actor Concept & Ownership Hierarchy (citing [RFC-0001](RFC-0001-ema-worlds-and-actors.md))**: In EMA, the **Actor (`EmaActor`)** that interacts with external worlds (`EmaWorld`) **is an EMA Agent**. Every EMA Agent is a first-class entity belonging to a **Penguin Project** or **Penguin Company (Organization)** (stored under `<app_data_dir>/agents/<agent_id>/` and `<app_data_dir>/organizations/<org_id>/`). Its identity, long-term memory, and agent-specific configuration persist across its lifetime, decoupled from whichever working directory (`workspace`) a session attaches to.
1. **Data Storage Architecture**: Strictly partitioned into three layers: **Machine-Shared World State** (`~/.penguin/data/ema/worlds/*.sqlite`, owned exclusively by a single-instance World HTTP Server), **Actor (EMA Agent) State & Long-Term Memory** (`<app_data_dir>/agents/<agent_id>/agent_state/`), and **Persona Training Assets** (`<personas_dir>/<persona_id>/`).
2. **Explicit TOML Configuration & Panic-First Principle**:
   - **No Environment Variables (`process.env.*`) by Default**: Unless specifically justified, all runtime and CLI configuration is read from **agent-specific `config.toml`** and **global `config.toml`** (`~/.penguin/data/ema/config.toml`).
   - **No Silent Fallbacks; Prefer Panic**: Unless specifically justified, fallback chains and silent `catch {}` blocks are forbidden. Missing files, invalid fields, or unreachable services trigger an immediate explicit panic.
3. **Workspace as a Pure Working Directory**: `workspace` (`CWD`) is the EMA Agent's working directory for a session and **never stores EMA's memory or World state**. Running inside the `workspace-write` sandbox, users can:
   - **a. Use EMA like a normal Coding Agent (`workspace = some repo`)**: Point `workspace` at any git repository to write code, run tests, and ship PRs without polluting the repo with companion memory or SQLite files;
   - **b. Use EMA as a Bot (saving images and deliverables to `workspace`)**: Have EMA save generated, downloaded, or curated images into `workspace` for permanent retention (`scratchpad` can hold temporary intermediates, but `scratchpad` may be lost across session resets or cleanup).
4. **Core Lifecycle Scenarios**: Formalizes the end-to-end data and configuration flows for **(1) Launching an EMA Agent in a `workspace`** and **(2) Training an EMA Agent (`wash` -> `train` -> `persona sync`)**.

---

## Motivation
[motivation]: #motivation

### 0. Clarifying Actor Ownership: An Actor is an EMA Agent belonging to a Penguin Project / Company

In [RFC-0001 (Ema Worlds and Actors)](RFC-0001-ema-worlds-and-actors.md), we defined `EmaActor` (`{ id, name, session, agentId }`) as the entity that perceives and acts upon an `EmaWorld`. At the system architecture level, its ownership hierarchy must be explicit:
- **An Actor is an EMA Agent**: Every Actor corresponds to a named EMA Agent in PenguinHarness (e.g., `sakana_kawaii`, `sakana_chan`, `aoi_rei`, `shirobana`).
- **An EMA Agent belongs to a Penguin Project / Company**: An EMA Agent is not a transient script tied to a single git repository folder; it is a persistent entity owned by a Penguin Project (`<app_data_dir>/agents/<agent_id>/`) or a Penguin Company (`<app_data_dir>/organizations/<org_id>/`). Consequently, the same EMA Agent can work across multiple `workspace` directories over time while preserving a unified persona and continuous lifelong memory.

### 1. Eliminating per-Agent World SQLite duplication and gateway connection collisions

When multiple EMA Agents on the same machine each instantiate their own `QQWorld` / `WebWorld` or open separate SQLite connections directly:
- **Gateway Collisions**: Multiple agents open duplicate long-lived connections to QQ / Bilibili gateways, causing rate-limiting or duplicate event consumption;
- **Fragmented State & Lock Contention**: World state becomes scattered across directories or suffers SQLite write-lock contention across processes;
- **Sandbox Escape Pressure**: Writing directly to host-wide SQLite files from inside agent subprocesses forces sessions out of `workspace-write` into `danger-full-access`.

Consolidating all World SQLite databases on the same machine into `~/.penguin/data/ema/worlds/` behind a single **Shared World HTTP Server** (`http://127.0.0.1:17480`) allows sandboxed agents to interact with all worlds over HTTP via `ema.js world ls | get | post`.

### 2. Eliminating implicit environment variables (`process.env`) and silent fallbacks

Relying on `process.env.EMA_*` variables and multi-step fallback chains (port fallback, multi-URL probing, multi-directory guessing, `catch {}` blocks) causes:
- **Non-Reproducible State**: Subprocesses spawned in different shells inherit different environment variables, silently switching database or persona paths;
- **Masked Failures**: Misconfigured paths silently fall back to empty temporary databases instead of alerting the operator.

Enforcing **TOML-first configuration** (global `config.toml` + agent-specific `config.toml`) and **Panic-First error handling** guarantees deterministic behavior and immediate fault visibility.

### 3. Decoupling Companion Memory & World State from the User's `workspace`

If EMA's memory index or World databases were stored inside `workspace`:
- Using EMA as a **Coding Agent** (`workspace = some repo`) would litter the user's git repository with personal companion memories and SQLite files;
- Switching `workspace` to another project would cause the companion to lose its memories.

By keeping all memory in `agent_state/` and all World state in `~/.penguin/data/ema/worlds/`, `workspace` remains a clean working directory—ideal both for software engineering in a code repository and for persisting user-visible Bot deliverables such as images.

---

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 0. Actor Concept and Ownership Topology (citing [RFC-0001](RFC-0001-ema-worlds-and-actors.md))

Per [RFC-0001](RFC-0001-ema-worlds-and-actors.md), an `EmaActor` perceives external `EmaWorld` instances and dispatches actions to specific `Part` loci via `world.interact(ctx, actor, id, action, payload)`:

```ts
export interface EmaActor {
  /** Logical Actor identifier */
  readonly id: string;
  /** Display name (e.g., "Sakana", "Aoi Rei") */
  readonly name: string;
  /** Bound Penguin Route Session ID */
  readonly session: string;
  /** Underlying Agent ID belonging to a Penguin Project / Company (e.g., "sakana_kawaii") */
  readonly agentId?: string;
}
```

The ownership hierarchy follows three levels:

```
Penguin Project (<app_data_dir>) / Penguin Company (<app_data_dir>/organizations/<org_id>)
  └── EMA Agent / Actor (<app_data_dir>/agents/<agent_id>/)
        ├── Agent State (agent_state/)       <-- Lifelong persona (AGENTS.md), agent config (config.toml), memory (memory/)
        ├── Session Scratchpad (scratchpad/) <-- Ephemeral per-session scratch space (may be lost on cleanup)
        └── Active Session (workspace-write) <-- Attaches to working directory Workspace (CWD); accesses shared World via HTTP
```

---

### 1. Data Storage Architecture

EMA partitions persistent data into three strictly separated storage locations:

| Storage Tier | Canonical Path | Contents | Ownership & Access |
| :--- | :--- | :--- | :--- |
| **1. Machine-Shared World Data** | `~/.penguin/data/ema/worlds/` | `web-world.sqlite`<br>`qq-world.sqlite`<br>`bilibili-world.sqlite`<br>`channel-world.sqlite` | **Owned exclusively by the host's single-instance World HTTP Server**; read-only (`EROFS`) inside agent sandboxes, accessed via HTTP API. |
| **2. Actor (EMA Agent) State & Memory** | `<app_data_dir>/agents/<agent_id>/agent_state/` | `AGENTS.md` (persona & hot memory index [RFC-0004](RFC-0004-in-context-memory-index-and-os.md))<br>`config.toml` (agent-specific config)<br>`memory/user/` (cross-workspace memory)<br>`memory/<workspace>/` (workspace memory)<br>`workbenches/companion_portal/` | Owned by the **EMA Agent under the Penguin Project / Company**; maintained by compaction/dreaming engines ([RFC-0006](RFC-0006-memory-compaction.md) / [RFC-0007](RFC-0007-dreaming-and-background-consolidation.md)) and memory tools. |
| **3. Persona Training Assets** | `<personas_dir>/<persona_id>/` | `persona.toml` (training & persona spec)<br>`script/chapters.toml` & `autonomy.toml`<br>`washed-dataset.json`<br>`trained-checkpoint.json`<br>`AGENTS.md` (compiled artifact) | Read and written by the offline training pipeline (`ema.js wash \| train \| persona`, [RFC-0003](RFC-0003-ema-training-meta-theory.md) / [RFC-0005](RFC-0005-script-to-persona-memory-training.md)). |

> **Single-Instance Machine Invariant**: On the same machine, all `EmaWorld` SQLite databases live together in `~/.penguin/data/ema/worlds/`. Individual EMA Agents never instantiate separate `QQWorld` connections or open World SQLite files directly.

---

### 2. Configuration Architecture

#### 2.1 Core Engineering Principles

1. **No Environment Variables (`process.env.*`) by Default**:
   - Database paths, ports, gateway URLs, persona directories, and target groups are never read from `process.env.EMA_*`.
   - Configuration is driven by **agent-specific `config.toml`** and **global `config.toml`** (`~/.penguin/data/ema/config.toml`).
2. **No Silent Fallbacks; Prefer Panic (Fail-Fast)**:
   - When `config.toml` is missing, required fields are absent or malformed, port binding fails (`EADDRINUSE`), HTTP requests fail, or JSON parsing fails, the system **panics immediately** with an explicit error (`[EMA Config Panic]`, `[EMA World Server Panic]`, `[EMA World CLI Panic]`).
   - Silent `catch {}` blocks, multi-URL probing chains, and fallback temporary paths are forbidden.

#### 2.2 Global Configuration: `~/.penguin/data/ema/config.toml`

Defines machine-wide directories, the shared World HTTP Server endpoint, and parameters for all mounted worlds:

```toml
# Global EMA Configuration (~/.penguin/data/ema/config.toml)
app_data_dir = "/home/rei/.penguin/data/default_project"
personas_dir = "/home/rei/work/EverMemoryArchive/personas"

[world]
host = "127.0.0.1"
port = 17480
url = "http://127.0.0.1:17480"
data_dir = "/home/rei/.penguin/data/ema/worlds"

[world.web]
db_path = "/home/rei/.penguin/data/ema/worlds/web-world.sqlite"
initial_sessions = ["default"]

[world.qq]
db_path = "/home/rei/.penguin/data/ema/worlds/qq-world.sqlite"
self_id = "1000000001"
gateway_url = "http://127.0.0.1:6099"
gateway_token = ""
groups = ["2000000001"]
private_users = []

[world.bilibili]
db_path = "/home/rei/.penguin/data/ema/worlds/bilibili-world.sqlite"
rooms = ["123456"]
video_targets = ["BV1xx411c7mD"]
dm_targets = ["3000000001"]

[world.channel]
db_path = "/home/rei/.penguin/data/ema/worlds/channel-world.sqlite"
channels = ["ch_ema_minimal_test", "ch_general"]
```

#### 2.3 Agent-Specific Configuration: `<app_data_dir>/agents/<agent_id>/agent_state/config.toml`

Each EMA Agent maintains its own `config.toml` inside `agent_state/`:

```toml
# Agent-specific EMA Configuration (<app_data_dir>/agents/sakana_kawaii/agent_state/config.toml)
[agent]
id = "sakana_kawaii"
name = "大肥鱼"
owner = "rei"

[world]
url = "http://127.0.0.1:17480"

[world.web]
channel_id = "web:chatroom:default"
```

#### 2.4 Persona Training Configuration: `<personas_dir>/<persona_id>/persona.toml`

Single-TOML configuration driving offline dataset washing, RSI training, and agent synchronization (see Section 4.2).

---

### 3. Workspace Boundaries and Usage Patterns

#### 3.1 Core Boundary: Workspace Never Stores Memory or World State

- `workspace` (the session's `CWD`) is **exclusively the working directory** for the EMA Agent.
- **No Memory in Workspace**: Persona weights, in-context hot memory indices (`AGENTS.md`), and long-term memories (`memory/`) reside strictly in `<app_data_dir>/agents/<agent_id>/agent_state/`.
- **No World State in Workspace**: Message histories, channel rosters, and batcher cursors reside strictly in `~/.penguin/data/ema/worlds/*.sqlite`.
- **`workspace-write` Sandbox Isolation**: All EMA Agent sessions run inside the `{"mode": "workspace-write"}` sandbox, restricting file writes to the active `workspace` (and session `scratchpad`) while blocking direct writes to `~/.penguin/data/ema/worlds/` (`EROFS`).

#### 3.2 Pattern A: Using EMA as a Normal Coding Agent (`workspace = some repo`)

A user can point an EMA Agent session's `workspace` at any software repository (e.g., `/home/rei/work/my-app`):
- The EMA Agent retains its companion personality, emotional warmth, and cross-project user memories;
- It reads code, edits files, runs test suites, and commits changes inside `workspace` just like a standard Coding Agent;
- Because neither companion memories nor World SQLite files are stored in `workspace`, the repository's working tree stays completely clean.

#### 3.3 Pattern B: Using EMA as a Bot (Saving Images & Deliverables to `workspace`)

When a user interacts with EMA as a companion or creative Bot (e.g., asking EMA to generate illustrations, save images, create cards, or organize media):
- EMA writes the resulting images or files directly into `workspace` (e.g., `<workspace>/images/2026-11-13-whale.png`).
- **Why `workspace` is preferred over `scratchpad` for persistent Bot outputs**:
  - The session `scratchpad` (`<app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/`) is bound to a single session's lifecycle and may be lost when sessions are rotated or cleaned up.
  - `workspace` is writable inside the `workspace-write` sandbox and persists across sessions as a user-visible directory for durable deliverables.

---

### 4. Core Lifecycle Scenarios

#### 4.1 Scenario 1: Launching an EMA Agent Normally in a `workspace`

```
+-----------------------------------------------------------------------------+
| Host Shared Layer                                                           |
|   ~/.penguin/data/ema/config.toml                                           |
|          │                                                                  |
|          ▼                                                                  |
|   Shared World HTTP Server (http://127.0.0.1:17480)                         |
|     ├── WebWorld       -> ~/.penguin/data/ema/worlds/web-world.sqlite       |
|     ├── QQWorld        -> ~/.penguin/data/ema/worlds/qq-world.sqlite        |
|     ├── BilibiliWorld  -> ~/.penguin/data/ema/worlds/bilibili-world.sqlite  |
|     └── ChannelWorld   -> ~/.penguin/data/ema/worlds/channel-world.sqlite   |
+-----------------------------------------------------------------------------+
           │                                                ▲
           │ 1. Batched <Input> XML push                    │ 3. HTTP GET/POST
           ▼    (penguin input)                             │    (ema.js world ls|get|post)
+-----------------------------------------------------------------------------+
| EMA Agent Session (Sandbox: workspace-write)                                |
|   Actor = EMA Agent (owned by Penguin Project / Company)                    |
|                                                                             |
|   [Agent State] <app_data_dir>/agents/<agent_id>/agent_state/               |
|     ├── config.toml  (agent-specific config, zero process.env)              |
|     ├── AGENTS.md    (anchor persona P_{u,v} + hot memory index M_hot)      |
|     └── memory/      (cross-session long-term memories)                     |
|                                                                             |
|   [Workspace]   /path/to/repo  OR  /path/to/bot-gallery/                    |
|     └── 2. Desarrolla code (Pattern A) or saves persistent images (Pattern B)|
+-----------------------------------------------------------------------------+
```

**Execution Flow**:
1. **Shared World Server Boot**: The host loads `~/.penguin/data/ema/config.toml` and starts the singleton World HTTP Server on `127.0.0.1:17480`, mounting `WebWorld`, `QQWorld`, `BilibiliWorld`, and `PenguinChannelWorld`. Any missing config or port conflict panics immediately.
2. **Session Launch in `workspace`**: The EMA Agent (owned by the Penguin Project / Company) starts a session in the target `workspace` under `{"mode": "workspace-write"}`.
3. **Identity & Memory Load**: PenguinHarness loads `AGENTS.md` and `memory/` from `<app_data_dir>/agents/<agent_id>/agent_state/`.
4. **Interaction & Execution**:
   - External world events are coalesced by `InputBatcher` and pushed into the session via `penguin input`;
   - Code edits (Pattern A) or saved images (Pattern B) are written to `workspace`;
   - World queries and outbound replies execute over HTTP via `ema.js world ls | get | post` using the URL configured in `config.toml`.
5. **Background Compaction & Dreaming**: Background workers ([RFC-0006](RFC-0006-memory-compaction.md) / [RFC-0007](RFC-0007-dreaming-and-background-consolidation.md)) run in isolated ephemeral sessions and atomically update `<app_data_dir>/agents/<agent_id>/agent_state/AGENTS.md` without touching `workspace`.

#### 4.2 Scenario 2: Training an EMA Agent (Offline Script-to-Persona Training)

Offline training is driven by a single `<personas_dir>/<persona_id>/persona.toml` file ([RFC-0003](RFC-0003-ema-training-meta-theory.md) / [RFC-0005](RFC-0005-script-to-persona-memory-training.md)):

```
<personas_dir>/<persona_id>/
  ├── persona.toml                (Single source of truth for training)
  ├── script/
  │     ├── chapters.toml         (Daily companion playscript)
  │     └── autonomy.toml         (Autonomy & pre-meeting peer playscript)
  │
  ├── [Step 1: pnpm wash --config persona.toml --prompt "..."]
  │     └──> washed-dataset.json  (Causally aligned Input_t -> <OS>_t -> <Action>_t + Golden Exemplars)
  │
  ├── [Step 2: pnpm train --config persona.toml --prompt "..."]
  │     ├──> trained-checkpoint.json (Student rollout + Teacher grading + RSI modulation + memory pruning)
  │     └──> AGENTS.md               (Compiled system prompt & initial memory index)
  │
  └── [Step 3: pnpm persona sync --config persona.toml]
        └──> Syncs into <app_data_dir>/agents/<agent_id>/agent_state/
               ├── AGENTS.md
               ├── config.toml
               └── workbenches/companion_portal/
```

**Three-Step Training Pipeline**:
1. **Wash Dataset (`wash`)**: Reads the playscripts configured in `persona.toml`, aligns `Input_t -> <OS>_t -> <Action>_t`, extracts Golden Exemplars, and writes `<persona_dir>/washed-dataset.json`.
2. **Run RSI Training (`train`)**: Executes Student rollouts, Teacher evaluation, anchor-locked RSI persona evolution, and scene memory compaction in ephemeral sessions; applies `[memory_policy]` (retaining `pre_meeting_peer` memories while pruning pre-rehearsed `companion_daily` episodic memories into persona weights), producing `trained-checkpoint.json` and `<persona_dir>/AGENTS.md`.
3. **Sync to Penguin Agent (`persona sync`)**: Installs the compiled `AGENTS.md`, agent-specific `config.toml`, and `companion_portal` workbench into `<app_data_dir>/agents/<agent_id>/agent_state/`, making the trained Actor ready to launch in any `workspace` (Scenario 1).

---

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 1. Configuration Loader Contract (`packages/ema/src/config.ts`)

```ts
export const DEFAULT_GLOBAL_CONFIG_PATH = path.join(
  os.homedir(),
  ".penguin",
  "data",
  "ema",
  "config.toml",
);

export function loadEmaGlobalConfig(
  configPath: string = DEFAULT_GLOBAL_CONFIG_PATH,
): EmaGlobalConfig;

export function loadEmaAgentConfig(
  agentId: string,
  appDataDir?: string,
): EmaAgentSpecificConfig;
```

### 2. Panic-First Error Semantics

| Component | Failure Condition | Panic Behavior |
| :--- | :--- | :--- |
| `config.ts` | Missing global or agent `config.toml`, invalid TOML syntax, or missing required fields | Immediately throws `Error("[EMA Config Panic] ...")` |
| `world-server.ts` | Port already in use (`EADDRINUSE`), SQLite open failure, or unknown route | Immediately throws `Error("[EMA World Server Panic] ...")` |
| `bin/ema.js world` | HTTP connection failure, non-2xx response, or invalid `--body` JSON | Immediately throws `Error("[EMA World CLI Panic] ...")` and exits non-zero (no fallback to local `--db`) |
| `use-ema/module.ts` | Configured `personas_dir` does not exist on disk | Immediately throws `Error("[EMA Personas Panic] ...")` |

---

## Drawbacks
[drawbacks]: #drawbacks

- **Explicit `config.toml` provisioning required**: Because implicit environment variable fallbacks are removed, `~/.penguin/data/ema/config.toml` and agent `config.toml` files must be present before starting the server or CLI.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Why hierarchical `config.toml` instead of environment variables?**
  Environment variables easily drift across shells, background daemons, and sandboxed subprocesses. On-disk TOML files provide an explicit, inspectable, and deterministic configuration source.
- **Why not store memory under `<workspace>/.ema/`?**
  Because an Actor (EMA Agent) belongs to a Penguin Project / Company and works across many workspaces over its lifetime. Storing memory inside `workspace` would both fragment the companion's memory across folders and pollute user git repositories.

## Prior art
[prior-art]: #prior-art

- **[RFC-0001: Ema Worlds and Actors](RFC-0001-ema-worlds-and-actors.md)**
- **[RFC-0003: EMA Training Meta-Theory](RFC-0003-ema-training-meta-theory.md)** & **[RFC-0005: Script-to-Persona and Memory Training Engine](RFC-0005-script-to-persona-memory-training.md)**
- **[RFC-0004: In-Context Memory Index and Inner Monologue](RFC-0004-in-context-memory-index-and-os.md)**, **[RFC-0006: Memory Compaction](RFC-0006-memory-compaction.md)**, & **[RFC-0007: Dreaming and Background Consolidation](RFC-0007-dreaming-and-background-consolidation.md)**

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- Multi-host World state federation when EMA Agents are distributed across multiple physical machines.
