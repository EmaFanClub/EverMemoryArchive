# EverMemoryArchive QA Scenarios (`tests/scenarios/`)

This directory houses automated end-to-end Quality Assurance (QA) scenarios and test suites for the EverMemoryArchive (EMA) companion system and its architectural variants.

Future agents and engineers use these scenarios to automatically test and certify that EMA components, variants, input adapters, and storage engines remain valid across changes.

## Directory Structure

```text
tests/scenarios/
├── README.md                      # This document: how to discover, initiate, and run QA scenarios
└── prototype/
    └── minimal/                   # Minimal EMA Prototype QA scenario
        ├── TASK.md                # Scenario definition, preconditions, steps, and pass criteria
        └── minimal-prototype.mjs  # Executable scenario runner and channel watcher
```

## How to Start a QA Scenario

When an automated agent, CI job, or human engineer needs to run a QA verification pass, follow this standard procedure:

### 1. Identify the Target Scenario
Browse the scenario directory corresponding to the component or variant under test:
- `prototype/minimal/`: Zero-personality, zero-memory, channel I/O baseline prototype.
- *(Future scenarios will cover memory-augmented variants, personality layers, and adversarial evaluations)*.

Read the scenario's `TASK.md` to understand:
- Target components and packages under test.
- Required preconditions and environment variables (`PENGUIN_AGENT_ID`, `PENGUIN_ORG_ID`).
- Specific verification steps and pass criteria.

### 2. Verify Pre-requisites & Environment
Before executing a scenario, ensure the workspace is built and the test agent exists:
```bash
# 1. Build workspace packages
pnpm build

# 2. Run unit test suite
pnpm test

# 3. Verify agent identity is exported (prevents server owner impersonation)
export PENGUIN_AGENT_ID=emafanclub_ema_dev
export PENGUIN_ORG_ID=emafanclub
```

### 3. Execute the Scenario
Each scenario provides an executable script and clear task commands in `TASK.md`.

For example, to run the Minimal Prototype QA:
```bash
# A. Quick dry-run check (no external side effects)
node tests/scenarios/prototype/minimal/minimal-prototype.mjs --dry-run --prompt "QA validation test."

# B. Live channel round-trip test
penguin org channel send --channel ch_ema_minimal_test -m "QA status check."
node tests/scenarios/prototype/minimal/minimal-prototype.mjs --channel ch_ema_minimal_test --read-latest --dispatch

# C. Verify channel output
penguin org channel tail --channel ch_ema_minimal_test -n 2
```

### 4. Evaluate Pass/Fail Criteria
Compare observed results against the checklist in the scenario's `TASK.md`:
- Did all assertions hold?
- Were the architectural invariants maintained (e.g. zero personality, zero memory storage)?
- Was identity preserved without unauthorized impersonation (messages sent by `agent:<id>`, never `user:admin`)?
- Did the session transcript accumulate correctly (`penguin session log <session_id>`)?

### 5. Report Findings
Log results and evidence in ticket progress lines (`penguin org ticket progress <ticket_id> -m "..."`) and channel status updates per organizational protocol.
