# QA Task: Bilibili Social Media Channel Architecture (RFC-0002)

This scenario tests, validates, and certifies that the Bilibili Channel adapter and social media primitives in EverMemoryArchive (EMA) adhere strictly to RFC-0002.

## Target Component

- **Feature**: Social Media Channel Architecture (RFC-0002)
- **Subsystem**: `packages/ema/src/worlds/bilibili/` (`BilibiliWorld`)
- **Primitives**: `packages/ema/src/channel.ts` (`Node`, `Channel`, `EmaTemporalEnvelope`, `EmaActionDoc`)
- **QA Runner**: `tests/scenarios/bilibili/channels/qa-runner.mjs`
- **Unit Suite**: `packages/ema/tests/bilibili-channels.spec.ts`

## Architectural Invariants to Verify (RFC-0002)

1. **`world-state-not-agent-memory`**:
   - Social nodes, channels, posts, comments, and danmaku are cached in local SQLite tables (`seen_social_nodes`, `seen_social_channels`, `seen_social_items`).
   - External social posts represent external platform reality and are never stored directly in agent cognitive memory files (`agent_state/memory`), avoiding recall pollution.

2. **`read-through-offline-reproducibility`**:
   - Any post or comment observed by Ema (inbound danmaku, polled comments, or published dynamics) is recorded with `fetched_at_ms`.
   - Once viewed, records are queryable offline via the identical Router endpoints (`/world/bilibili/channels/:id/items` and `/world/bilibili/items/:id`) without hitting platform network APIs or risking anti-bot blocks.

3. **`anchored-temporal-perception`**:
   - Every temporal payload supplies an anchored reference context instant (`context: { time, timestampMs, timezone }`).
   - Timestamps are formatted as human-relative duration plus explicit elapsed seconds via `formatAgentRelativeTime`: e.g. `"7 days ago (604800 seconds ago)"`, `"10 minutes ago (600 seconds ago)"`, `"just now (0 seconds ago)"`.

4. **`hierarchical-action-introspectability`**:
   - Actions follow a hierarchical dot-separated namespace (`post.publish`, `comment.reply`, `comment.like`, `danmaku.send`, `dm.send`, `danmaku.thank_*`).
   - Runtime documentation is queryable via `GET /world/bilibili/actions` and `GET /world/bilibili/actions/:name`.
   - Execution is supported via both `world.interact(...)` and HTTP `POST /world/bilibili/actions/:actionName` with parameter validation, content filtering, and anti-flooding rate limits.

## Pre-requisites

1. Workspace packages must be built:
   ```bash
   pnpm build
   ```
2. Agent identity must be exported in the environment:
   ```bash
   export PENGUIN_AGENT_ID=emafanclub_ema_dev
   ```

## Execution Steps

### Step 1: Run Full Vitest Test Suites
Run the Bilibili channels unit test suite:
```bash
pnpm --filter @prism-shadow/ema test tests/bilibili-channels.spec.ts
```

### Step 2: Execute Automated QA Runner
Run the end-to-end scenario runner:
```bash
node tests/scenarios/bilibili/channels/qa-runner.mjs
```
Optional flags:
- `--json`: Output full report in JSON format for automated ingestion.
- `--db <path>`: Specify custom SQLite database path.

## Success / Pass Criteria

- [ ] All 20 unit tests in `bilibili-channels.spec.ts` pass cleanly.
- [ ] SQLite tables `seen_social_nodes`, `seen_social_channels`, and `seen_social_items` are created with `idx_social_items_channel`.
- [ ] Owner Node and default channels (`space`, `dynamic`, `live_room`, `video`) are registered with inter-channel linkages (`linkedChannelIds`).
- [ ] Inbound danmaku and comments are read-through indexed and queryable offline with zero network calls.
- [ ] Relative time strings match `<duration> ago (<seconds> seconds ago)` or `just now (0 seconds ago)`.
- [ ] Runtime action schemas (`post.publish`, `comment.reply`, `comment.like`, `danmaku.send`, `dm.send`) are inspectable.
- [ ] Mutative dispatches succeed through `interact()` and HTTP POST with content filtering and rate limiting guards.
