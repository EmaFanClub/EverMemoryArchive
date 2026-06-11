## 1. Data Model and Querying

- [ ] 1.1 Add optional `conversationId` and `sourceType: "background"` fields to short-term memory types and DB entities.
- [ ] 1.2 Persist source metadata when appending and updating short-term memory records.
- [ ] 1.3 Add source-aware filters to short-term memory list/query APIs.
- [ ] 1.4 Add or adjust Mongo indexes for actor/kind/source/processed/date activity reads.
- [ ] 1.5 Add helper logic for deriving the runtime activity source key from `conversationId`, `sourceType`, or missing metadata.

## 2. Activity Writes

- [ ] 2.1 Write `conversationId` on activity records created by conversation rollup tasks.
- [ ] 2.2 Write `sourceType: "background"` on activity records created by non-conversation activity tasks.
- [ ] 2.3 Avoid or normalize conflicting activity source metadata on new writes.

## 3. Prompt Context

- [ ] 3.1 Replace actor-wide activity prompt reads with source-grouped activity window reads.
- [ ] 3.2 Render activity prompt sections grouped by source, then by date/time within each source.
- [ ] 3.3 Generate source labels at render time, including conversation metadata lookup and fallback labels.
- [ ] 3.4 Enforce the per-source prompt window size of 5 activity records.
- [ ] 3.5 Add a stable cap or ordering policy for many active sources.

## 4. Source-Scoped Rollup

- [ ] 4.1 Change pending activity threshold checks from actor-wide to actor/source scoped.
- [ ] 4.2 Create source-scoped rollup snapshots using `createdBefore` and source filters.
- [ ] 4.3 Pass rollup source metadata through memory-rollup task context.
- [ ] 4.4 Ensure activity-to-day tasks consume only snapshot records from the selected source.
- [ ] 4.5 Mark only successfully consumed snapshot ids as processed.

## 5. Concurrency and Compatibility

- [ ] 5.1 Change the threshold rollup running guard to key by actor/source.
- [ ] 5.2 Keep actor-level serialization for day/month/year memory writes.
- [ ] 5.3 Treat missing source metadata as the unclassified source without requiring data migration.
- [ ] 5.4 Preserve existing day/month/year uniqueness and rollup behavior.

## 6. Tests and Verification

- [ ] 6.1 Add tests for activity source key derivation and unclassified fallback.
- [ ] 6.2 Add tests for conversation and background activity source writes.
- [ ] 6.3 Add tests for source-grouped prompt formatting with per-source limit.
- [ ] 6.4 Add tests for source-scoped threshold triggering and snapshot selection.
- [ ] 6.5 Add tests for processed marking that does not consume other sources.
- [ ] 6.6 Add concurrency-focused scheduler tests for same-source dedupe and actor-level day memory serialization.
- [ ] 6.7 Run `pnpm format`, `pnpm openspec:validate`, and relevant package tests.
