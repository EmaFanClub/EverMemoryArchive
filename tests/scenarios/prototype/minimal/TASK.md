# QA Task: Minimal EMA Prototype Verification

This scenario tests and validates that the Minimal EMA Prototype variant remains functional, correct, and compliant with all four architectural invariants.

## Target Component

- **Variant**: Minimal Prototype (`node-mw3db9t0-696h` under `node-mw3db1jd-1mck`)
- **Package**: `@prism-shadow/ema` (`packages/ema/src/minimal.ts`)
- **Agent**: `ema_minimal` (Project Agent)
- **Script**: `tests/scenarios/prototype/minimal/minimal-prototype.mjs`

## Architectural Invariants to Verify (RFC-0001)

1. **Zero Personality**:
   - The agent prompt has no character sheet, emotional tone, or roleplay personas.
   - All responses must remain direct, factual, and neutral.
2. **Zero Memory**:
   - EverMemoryArchive (EMA) storage, vector search (LanceDB), document stores (MongoDB), and memory consolidation are 100% disabled.
   - The session transcript in PenguinHarness retains turn continuity for user/evaluator visibility, while EMA long-term cognitive storage remains untouched.
3. **World Abstraction & Ema Router (`PenguinChannelWorld`)**:
   - Implements `EmaWorld` (`@Interface()`) with multi-part channel topology.
   - Mounts routes under `/world/channel` (inspected via `ema.js world ls` and `ema.js world get`).
4. **Transactional Input Ingestion**:
   - Ingests incoming messages via channel polling (`penguin org channel tail --json`).
   - Filters strictly for human users (`sender: user:*`). Messages from `agent:*` and `system` are ignored to prevent recursive reply loops.
   - Debounces and coalesces input into atomic XML `<Input>` payloads with entity escaping.
   - Stateful deduplication via workspace state (`seen-messages.json`).
5. **Penguin Channel Output & Identity Guard**:
   - Output dispatches via `world.interact(...)` calling `penguin org channel send --channel <channel> -m "<message>"`.
   - **Identity Guard**: Enforces `assertAgentIdentity(env)`; refuses to dispatch without `PENGUIN_AGENT_ID` so the prototype cannot impersonate `user:admin`.
   - **Tool Isolation**: Model execution runs with `--approve deny-all` to prevent rogue subshell commands.

## Pre-requisites

1. `@prism-shadow/ema` package must be built:
   ```bash
   pnpm --filter @prism-shadow/ema build
   ```
2. The `ema_minimal` agent must exist in PenguinHarness:
   ```bash
   penguin agent ls | grep ema_minimal
   ```
   If not present:
   ```bash
   penguin agent create --agent-id ema_minimal --name "Ema Minimal" --description "Minimal EMA prototype agent with zero personality, zero memory, and Penguin channel I/O."
   ```
3. A test scratch channel must exist (or be created):
   ```bash
   penguin org channel create ch_ema_minimal_test --name "Ema Minimal Test" --purpose "QA scratch channel" || true
   ```
4. Calling environment must have employee agent identity set:
   ```bash
   export PENGUIN_AGENT_ID=emafanclub_ema_dev
   export PENGUIN_ORG_ID=emafanclub
   ```

## Execution Steps

### Step 1: Unit & Guard Validation
Run package tests to ensure guards, prompt definitions, and deduplication logic pass:
```bash
pnpm test
```

### Step 2: Dry-run Single Turn
Verify invocation and prompt structure without dispatching to the channel:
```bash
node tests/scenarios/prototype/minimal/minimal-prototype.mjs --dry-run --prompt "QA status check."
```
Expected output:
- `Memory Accessed: false`
- `Personality Applied: false`
- `Dispatched Agent ID: <agent_id>`

### Step 3: Live Channel Round-Trip
Post a user message to the scratch channel and verify end-to-end receipt and reply:
```bash
# 1. Post test message
penguin org channel send --channel ch_ema_minimal_test -m "QA test prompt: Confirm channel round-trip."

# 2. Run single-shot read and dispatch
node tests/scenarios/prototype/minimal/minimal-prototype.mjs --channel ch_ema_minimal_test --read-latest --dispatch

# 3. Verify reply in channel tail
penguin org channel tail --channel ch_ema_minimal_test -n 2
```
Expected verification:
- Latest message in channel is from `agent:<agent_id>` (never `user:admin`).
- Message addresses `@agent:<agent_id>` or `@user:<id>` properly.

### Step 4: Long-lived Channel Watcher
To run the continuous watch loop:
```bash
node tests/scenarios/prototype/minimal/minimal-prototype.mjs \
  --channel ch_ema_minimal_test \
  --watch \
  --session session-2026-11-05-10-19-24-d6815237 \
  --watch-for 12h
```
Verify accumulation in session transcript:
```bash
penguin session log d6815237
```

## Success / Pass Criteria

- [ ] All unit tests pass (`pnpm test`).
- [ ] No messages sent as `user:admin`.
- [ ] Turns accumulate in persistent session `d6815237`.
- [ ] Agent replies strictly factually without adopting personas.
- [ ] Zero EMA memory storage/vector activity.
