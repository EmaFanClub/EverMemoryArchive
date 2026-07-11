## 1. API and DTOs

- [x] 1.1 Add dashboard DTO types for actor schedule list/update responses and actor short-term memory list/update responses.
- [x] 1.2 Add transport helpers for loading, patching, and deleting actor schedules and short-term memories.
- [x] 1.3 Add actor-scoped schedule API routes for GET list, PATCH content/runAt updates, and DELETE.
- [x] 1.4 Add actor-scoped memory API routes for GET grouped short-term memories, PATCH memory text updates, and DELETE.
- [x] 1.5 Add service/adaptor logic that maps core schedule and memory records into WebUI DTOs while preserving actor scoping.

## 2. Core Access Boundaries

- [x] 2.1 Reuse `ActorScheduler.list()` for schedule reads and restrict schedule updates to `summary`, `prompt`, and one-time `runAt`.
- [x] 2.2 Implement short-term memory update by id while preserving kind, date, dayDate, processedAt, createdAt, and actor ownership.
- [x] 2.3 Reject invalid actor ids, missing records, blank memory text, unsupported schedule fields, and invalid delete requests with stable error responses.
- [x] 2.4 Add delete support for editable schedules and short-term memories with actor ownership checks.

## 3. UI

- [x] 3.1 Replace the schedule Coming soon area with a schedule panel that loads grouped actor schedules.
- [x] 3.2 Add content editing and delete controls for editable chat/activity schedules and read-only rendering for routine/focus schedules.
- [x] 3.3 Replace the memory Coming soon state with a memory panel grouped by year, month, day, and activity.
- [x] 3.4 Add memory text editing and delete controls that preserve drafts on save failure.
- [x] 3.5 Handle loading, empty, error, retry, saving, and actor-switch states without showing stale actor data.

## 4. Tests and Verification

- [x] 4.1 Add focused service/API tests for schedule list, content/runAt update, and delete behavior.
- [x] 4.2 Add focused service/API tests for grouped short-term memory list, text update, and delete behavior.
- [x] 4.3 Add component or helper tests for schedule and memory panel state mapping where practical.
- [x] 4.4 Run `pnpm format`, `pnpm openspec:validate`, `pnpm webui:lint`, and `pnpm webui:build`.
