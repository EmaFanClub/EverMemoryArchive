## 1. API and DTOs

- [ ] 1.1 Add dashboard DTO types for actor schedule list/update responses and actor short-term memory list/update responses.
- [ ] 1.2 Add transport helpers for loading and patching actor schedules and short-term memories.
- [ ] 1.3 Add actor-scoped schedule API routes for GET list and PATCH content-only updates.
- [ ] 1.4 Add actor-scoped memory API routes for GET grouped short-term memories and PATCH memory text updates.
- [ ] 1.5 Add service/adaptor logic that maps core schedule and memory records into WebUI DTOs while preserving actor scoping.

## 2. Core Access Boundaries

- [ ] 2.1 Reuse `ActorScheduler.list()` for schedule reads and restrict schedule updates to `summary` and `prompt`.
- [ ] 2.2 Implement short-term memory update by id while preserving kind, date, dayDate, processedAt, createdAt, and actor ownership.
- [ ] 2.3 Reject invalid actor ids, missing records, blank memory text, unsupported schedule fields, and delete-like requests with stable error responses.

## 3. UI

- [ ] 3.1 Replace the schedule Coming soon area with a schedule panel that loads grouped actor schedules.
- [ ] 3.2 Add content editing controls for editable chat/activity schedules and read-only rendering for routine/focus schedules.
- [ ] 3.3 Replace the memory Coming soon state with a memory panel grouped by year, month, day, and activity.
- [ ] 3.4 Add memory text editing controls that preserve drafts on save failure.
- [ ] 3.5 Handle loading, empty, error, retry, saving, and actor-switch states without showing stale actor data.

## 4. Tests and Verification

- [ ] 4.1 Add focused service/API tests for schedule list and content-only update behavior.
- [ ] 4.2 Add focused service/API tests for grouped short-term memory list and text update behavior.
- [ ] 4.3 Add component or helper tests for schedule and memory panel state mapping where practical.
- [ ] 4.4 Run `pnpm format`, `pnpm openspec:validate`, `pnpm webui:lint`, and `pnpm webui:build`.
