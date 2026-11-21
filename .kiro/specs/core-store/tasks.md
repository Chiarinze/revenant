# Implementation Plan: core-store

## Overview

Build `packages/core` from scratch: monorepo scaffolding, schema declaration, the Y.Doc data layout, all collection operations, subscriptions/snapshots, and property-based convergence tests. Each task builds on the last and ends by wiring its piece into the public API in `packages/core/src/index.ts`.

## Tasks

- [x] 1. Scaffold the monorepo and `packages/core`
  - Create `pnpm-workspace.yaml` listing `packages/*`, `apps/*`, `server`
  - Create `tsconfig.base.json` at the repo root with strict mode enabled
  - Create `packages/core/package.json` with `yjs`, `y-indexeddb` as runtime dependencies and `vitest`, `fast-check`, `fake-indexeddb`, `@vitest/coverage-v8` as dev dependencies
  - Create `packages/core/tsconfig.json` extending the base config and pointing at `src/`
  - Create `packages/core/vitest.config.ts` with fake-indexeddb environment shim
  - Create `packages/core/src/index.ts` as an empty barrel file (will be filled in later tasks)
  - _Requirements: 1.1, 2.1_

- [ ] 2. Schema declaration and type inference
  - [x] 2.1 Implement field-kind helpers and schema builder
    - Create `packages/core/src/schema/kinds.ts` exporting `value<T>()`, `counter()`, `text()` factory functions, each carrying a type tag
    - Create `packages/core/src/schema/collection.ts` exporting `collection(fields, options?)` where `options.key` is an optional natural-key extractor
    - Create `packages/core/src/schema/define-schema.ts` exporting `defineSchema(collections)` which validates names at runtime and returns the schema object
    - Infer `InferRecord<C>` mapped type so a record's shape is derived from its field declarations
    - Validate names at runtime: collection and field names must be non-empty and must not contain ":" or "/"; field names must not start with "_" (reserved for internal fields such as _deleted)
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 2.2 Write unit tests for schema declaration
    - Verify that `defineSchema` captures collection names and field kinds correctly
    - Verify that invalid collection and field names (containing ":" or "/", empty, or field names starting with "_") throw at runtime
    - _Requirements: 1.1, 1.2_

- [ ] 3. Data layout inside the Y.Doc
  - [ ] 3.1 Implement the flat Y.Doc layout helpers
    - Create `packages/core/src/store/doc-keys.ts` with pure functions that build map/text keys (`c:records`, `c:values`, `c:tallies`, `c:text:recordId/field`)
    - Write helpers that read and write `c:records`, `c:values`, `c:tallies` on a given `Y.Doc`, keeping all Yjs types at this layer
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

  - [ ] 3.2 Implement the ID strategy (random and natural-key)
    - Create `packages/core/src/store/id.ts` with `randomId()` using `crypto.randomUUID()`
    - Implement `naturalKeyId(raw)` that normalises with Unicode NFKC, lowercases, strips whitespace and punctuation, then prefixes with `k:`
    - _Requirements: 3.1, 3.7_

  - [ ] 3.3 Write unit tests for doc-keys and ID helpers
    - Verify key patterns for all four map/text names
    - Verify natural-key normalisation for representative inputs ("Rice (50 kg)" → `"k:rice50kg"`)
    - _Requirements: 3.1, 3.7_

- [ ] 4. Collection operations
  - [ ] 4.1 Implement `create` and `get`/`all`
    - Create `packages/core/src/store/collection.ts` exporting a `CollectionHandle<R>` class
    - `create(fields)` writes a row to `c:records` and sets initial `value` fields in `c:values`; uses natural-key if declared, returning the existing ID if the key already exists; uses `randomId()` otherwise
    - `get(id)` reads all fields for the record, returns `undefined` for missing or deleted records
    - `all()` returns all non-deleted records as typed plain objects
    - _Requirements: 3.1, 3.2, 3.7_

  - [ ] 4.2 Implement `update`, `increment`/`decrement`, `editText`, and `remove`
    - `update(id, patch)` writes changed `value` fields to `c:values`; throws for missing/deleted records or unknown fields
    - `increment(id, field, n)` / `decrement(id, field, n)` write to the tally key `recordId/field/clientId` without reading the total; throw for non-counter fields
    - `editText(id, field, op)` calls `Y.Text.insert` or `Y.Text.delete`; throws for non-text fields
    - `remove(id)` sets `recordId/_deleted` to `true` in `c:values`
    - _Requirements: 3.3, 3.4, 3.5, 3.6_

  - [ ] 4.3 Write unit tests for all collection operations
    - Test create → get round-trip, update, increment, decrement, text edit, remove
    - Test error cases: wrong field kind, missing record, writing to a deleted record
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 5. Checkpoint — verify collection layer
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Space: opening, persistence, subscriptions, snapshots
  - [ ] 6.1 Implement `openSpace`
    - Create `packages/core/src/space/open-space.ts` exporting `openSpace({ id, schema })`
    - Opens a `Y.Doc`, attaches a `y-indexeddb` provider using `id` as the name, waits for `provider.whenSynced` before resolving
    - Builds a `CollectionHandle` per collection and exposes it via `space.collection(name)`
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 6.2 Implement subscriptions and snapshot
    - Listen on `doc.on('update', ...)` to mark the snapshot stale and call all registered subscriber callbacks
    - `subscribe(cb)` registers a callback and returns an unsubscribe function
    - `getSnapshot()` rebuilds plain objects from the Y.Doc only when stale; returns the same reference between changes
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 6.3 Implement `encodeState`, `applyUpdate`, and `close`
    - `encodeState()` returns `Y.encodeStateAsUpdate(doc)`
    - `applyUpdate(u)` calls `Y.applyUpdate(doc, u)`; triggers the update listener, so subscribers are notified
    - `close()` destroys the provider and the doc, releasing IndexedDB resources
    - _Requirements: 2.4, 5.5_

  - [ ] 6.4 Write unit tests for openSpace, subscriptions, and close
    - Test that `subscribe` / unsubscribe work correctly
    - Test that `getSnapshot()` returns the same reference when nothing changed and a new one after a write
    - Test that `close()` does not throw and resolves cleanly
    - _Requirements: 2.4, 4.1, 4.2, 4.3_

- [ ] 7. Property-based tests
  - [ ] 7.1 Write property test for convergence (Property 1)
    - Use fast-check to generate 2–4 independent Y.Doc copies applying random sequences of create (random and natural-key), update, increment, decrement, editText and remove operations
    - Exchange all state updates between every pair of copies in random order, random grouping, and with duplicates
    - Assert all snapshots are deep-equal
    - **Property 1: Convergence**
    - **Validates: Requirements 5.1**

  - [ ] 7.2 Write property test for counter sum (Property 2)
    - Generate random increment and decrement operations across multiple copies of one doc
    - Sync all copies and assert that the counter's value equals total increments minus total decrements
    - **Property 2: Counter sum**
    - **Validates: Requirements 3.4, 5.2**

  - [ ] 7.3 Write property test for no lost tab writes (Property 3)
     - Simulate two tabs on one device: two Y.Doc instances opened with the same space ID and the same IndexedDB name, each with its own clientID
    - Make concurrent counter changes in both, sync them, and assert no change is lost
    - **Property 3: No lost tab writes**
    - **Validates: Requirements 5.3**

  - [ ] 7.4 Write property test for natural-key merge (Property 4)
    - Generate two copies that each call `create` with keys that normalise to the same value
    - Have each copy apply counter increments and text edits independently, then sync
    - Assert the result is one record with counter equal to the sum of both copies' changes and all text edits present
    - **Property 4: Natural-key merge**
    - **Validates: Requirements 3.7, 5.6**

  - [ ] 7.5 Write property test for idempotence (Property 5)
    - For any sequence of operations, encode the state once and apply the same update twice
    - Assert the result equals applying it once
    - **Property 5: Idempotence**
    - **Validates: Requirements 5.1**

  - [ ] 7.6 Write property test for delete exclusion (Property 6)
    - Generate records across multiple copies, randomly delete some, sync all copies
    - Assert every deleted record is absent from `all()` on every copy
    - **Property 6: Delete exclusion**
    - **Validates: Requirements 3.6**

  - [ ] 7.7 Write property test for persistence round-trip (Property 7)
    - Write arbitrary data to a space backed by fake-indexeddb, call `close()`, reopen with the same ID
    - Assert the snapshot is identical before close and after reopen
    - **Property 7: Persistence round-trip**
    - **Validates: Requirements 2.3**

- [ ] 8. Wire public API
  - Export `defineSchema`, `collection`, `value`, `counter`, `text`, `openSpace`, and all relevant types from `packages/core/src/index.ts`
  - Confirm that nothing beyond the public barrel file needs to be imported by an app
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 3.1–3.7, 4.1–4.3, 5.1–5.6_

- [ ] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but property tests are strongly recommended given the convergence guarantees the product makes.
- Each task references the requirements it satisfies for full traceability.
- Yjs internals (`Y.Doc`, `Y.Map`, `Y.Text`, `Y.encodeStateAsUpdate`, `Y.applyUpdate`) are used only inside `packages/core`; apps never import from `yjs` directly.
- Use `fake-indexeddb` in all Vitest tests; real IndexedDB is exercised only in the browser.
- Counter tallies are keyed by `doc.clientID`, so two tabs on the same device each get a distinct client ID and their tallies never collide.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "3.2"] },
    { "id": 3, "tasks": ["3.3"] },
    { "id": 4, "tasks": ["4.1", "4.2"] },
    { "id": 5, "tasks": ["4.3"] },
    { "id": 6, "tasks": ["5"] },
    { "id": 7, "tasks": ["6.1"] },
    { "id": 8, "tasks": ["6.2", "6.3"] },
    { "id": 9, "tasks": ["6.4"] },
    { "id": 10, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7"] },
    { "id": 11, "tasks": ["8"] },
    { "id": 12, "tasks": ["9"] }
  ]
}
```
