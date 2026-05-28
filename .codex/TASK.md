# Actor Token Usage Statistics

## Branch

- `disviel/feat/actor-token-usage`

## Goal

Add actor-level token usage statistics in three commits. Keep backend, mocked UI, and real frontend/backend integration separated so each step is reviewable.

## Token Usage Scope

- Track usage by actor.
- Token buckets:
  - `cacheReadTokens`
  - `cacheWriteTokens`
  - `outputTokens`
  - `totalTokens`
- Source values:
  - `chat`
  - `activity`
  - `conversation_rollup`
  - `memory_rollup`
  - `wake`
  - `sleep`
  - `training`
- Mapping from AgentHub usage metadata:
  - `cacheReadTokens = cachedTokens ?? 0`
  - `cacheWriteTokens = promptTokens ?? 0`
  - `outputTokens = (thoughtTokens ?? 0) + (responseTokens ?? 0)`
  - `totalTokens = cacheReadTokens + cacheWriteTokens + outputTokens`

## Step 1: Backend in `packages/ema`

- [x] Add token usage source/type definitions and DB entity interfaces.
- [x] Add a Mongo-backed token usage records collection.
- [x] Add indexes for actor/time and actor/source/time queries.
- [x] Add DB methods for inserting records, summarizing actor usage, and deleting actor-owned usage records.
- [x] Extend `AgentState` with usage context.
- [x] Emit one usage event after each successful `llm.generate()` response that contains usage metadata.
- [x] Persist usage from chat actor runs with source `chat`.
- [x] Persist usage from runtime background tasks with source equal to the background task name.
- [x] Persist usage from training-mode background tasks with source `training`.
- [x] Clean up token usage records during actor deletion.
- [x] Add core tests for event emission, source assignment, DB insert/summary/delete behavior, and actor cleanup.
- [x] Run `pnpm format`, `pnpm test`, and `pnpm build:core`.
- [x] Commit: `feat(ema): record actor token usage`

## Step 2: Web UI Mock in `packages/ema-webui`

Build the actor statistics UI against mocked token usage data only. The actor side panel now shows range switching, total and bucket metrics, source distribution, seven-day stacked trend bars, empty state handling, and hover/focus token detail bubbles.

Commit: `feat(webui): mock actor token usage stats`

## Step 3: Frontend/Backend Integration (To Discuss)

- [x] Confirm the backend summary API shape from `packages/ema`, including range parameters, source labels, daily trend shape, and zero-data behavior.
- [x] Add the `packages/ema-webui` server adapter method that reads actor token usage summaries from the EMA backend instead of mock data.
- [x] Add the WebUI API route for actor token usage summaries, preserving the existing actor-scoped API conventions and auth/error handling.
- [x] Replace `ActorTokenUsageStats` mock data usage with real client-side loading through the WebUI transport layer.
- [x] Add loading, error, and empty states that match the current statistics panel layout.
- [x] Keep the current visual behavior for range switching, source distribution, stacked trend bars, and hover/focus token detail bubbles.
- [x] Remove all mock-only code paths, mock data generators, mock-specific exports, and mock-only tests; there must be no mock fallback in the final integration.
- [x] Add focused tests for the server adapter/API route mapping and the frontend data transformation.
- [x] Run `pnpm format`, `pnpm webui:lint`, `pnpm webui:build`, and any focused WebUI tests added in this step.

Commit: `feat(webui): connect actor token usage stats`

## Notes

- Do not store a separate `task` field; `source` carries the display and grouping value.
- Scheduled `chat` and `focus` still flow through the chat actor worker in the first version, so they are counted as `chat`.
- Failed or aborted LLM calls are not recorded unless AgentHub provides reliable usage metadata.
- Usage writes should not break actor replies; write failures should be logged and isolated from the actor run.
- Use append-only records as the source of truth. Do not maintain mutable aggregate totals in the hot path.
