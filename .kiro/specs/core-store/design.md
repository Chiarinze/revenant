# Design Document

## Overview
`packages/core` exposes `defineSchema`, `collection`, the field kinds (`value`, `counter`, `text`) and `openSpace`. Each space is one Y.Doc saved with y-indexeddb. Apps only use the typed API; Yjs stays inside core.

## Architecture
- Monorepo: pnpm workspace (`pnpm-workspace.yaml` lists `packages/*`, `apps/*`, `server`) with a shared strict `tsconfig.base.json`.
- `packages/core`: TypeScript library. Dependencies: `yjs`, `y-indexeddb`. Dev: Vitest, fast-check, fake-indexeddb (IndexedDB in Node tests).
- Layers inside core, in feature folders:
  - `schema/`: schema declaration and type inference.
  - `store/`: data layout inside the Y.Doc, reads and writes.
  - `counter/`: per-copy tallies.
  - `space/`: opening, persistence, subscriptions, snapshots.
- No React, no network code. Syncing is a later spec that uses `encodeState` and `applyUpdate`.

## Components and Interfaces
```ts
const schema = defineSchema({
  products: collection(
    { name: value<string>(), unit: value<string>(), stock: counter(), notes: text() },
    { key: (p) => p.name },            // optional natural key
  ),
  sales: collection({ productId: value<string>(), qty: value<number>() }), // random IDs
});

const space = await openSpace({ id: 'shop-123', schema });
const products = space.collection('products');

const id = products.create({ name: 'Rice 50kg', unit: 'bag' });
products.update(id, { unit: 'bag (50kg)' });
products.increment(id, 'stock', 10);
products.decrement(id, 'stock', 2);
products.editText(id, 'notes', { index: 0, insert: 'Supplier: Ade' });
products.get(id);       // typed record or undefined
products.all();         // excludes deleted
products.remove(id);    // soft delete

const unsubscribe = space.subscribe(() => {});
space.getSnapshot();    // same reference until data changes
space.encodeState();    // for sync and tests
space.applyUpdate(u);
await space.close();
```
- Record IDs: random `crypto.randomUUID()` by default. With a natural key, the ID is `k:` followed by the key normalised (Unicode NFKC, lowercased, with all whitespace and punctuation removed, e.g. "Rice (50 kg)" → "rice50kg"). `create` with an existing key returns the existing ID and leaves its fields unchanged.

## Data Models
Flat layout, no nested shared types per record, so records created at the same time on two copies never overwrite each other. For a collection named `c`:
- `doc.getMap('c:records')`: record ID → `{ createdAt }`. Marks that the record exists; `createdAt` is informational only.
- `doc.getMap('c:values')`: key `recordId/field` → value, for `value` fields. Soft delete is `recordId/_deleted` → `true`. Concurrent edits to the same key are resolved by Yjs's fixed client-ID rule, never by clock time.
- `doc.getMap('c:tallies')`: key `recordId/field/clientId` → `{ inc, dec }`, for `counter` fields. Each copy writes only keys with its own `doc.clientID`, so writes never collide, including two tabs on one device. Value = sum of `inc` minus sum of `dec` over all keys for that record and field.
- `doc.getText('c:text:recordId/field')`: a top-level Y.Text per `text` field. Top-level types with the same name are the same object on every copy, so concurrent creation merges.

## Snapshots and Subscriptions
- Listen to `doc.on('update')`. On each update, mark the snapshot stale and notify subscribers.
- `getSnapshot()` rebuilds plain objects only when stale, so the same reference is returned between changes (needed by `useSyncExternalStore`).

## Error Handling
- Unknown collection or field: TypeScript error, plus a runtime error with a clear message.
- `increment`/`decrement` on a non-counter field, or `editText` on a non-text field: runtime error.
- Writing to a missing or deleted record: runtime error.

## Correctness Properties
These must always hold. Each one becomes a property-based test.

### Property 1: Convergence
*For any* set of operations applied across copies, exchanging all updates in any order, grouping, or with duplicates SHALL give identical snapshots on every copy.
**Validates: Requirements 5.1**

### Property 2: Counter sum
*For any* sequence of increments and decrements across copies, a counter's value SHALL equal all increments minus all decrements made on every copy.
**Validates: Requirements 3.4, 5.2**

### Property 3: No lost tab writes
*For any* counter changes made in two copies on one device, no change SHALL be lost after the copies sync.
**Validates: Requirements 5.3**

### Property 4: Natural-key merge
*For any* records created on different copies whose keys normalise to the same value, they SHALL become one record after syncing, keeping all counter changes and text edits.
**Validates: Requirements 3.7, 5.6**

### Property 5: Idempotence
*For any* update, applying it twice SHALL give the same result as applying it once.
**Validates: Requirements 5.1**

### Property 6: Delete exclusion
*For any* soft-deleted record, it SHALL never appear in `all()` on any copy after syncing.
**Validates: Requirements 3.6**

### Property 7: Persistence round-trip
*For any* space contents, closing and reopening the space SHALL restore an identical snapshot.
**Validates: Requirements 2.3**

## Testing Strategy
- Unit tests for every API method and field kind.
- Property-based tests (fast-check):
  - 2–4 docs apply random operations, then exchange updates in random order, random grouping and with duplicates. All snapshots must be deep-equal.
  - Counters: final value = all increments minus all decrements across every doc.
  - Two docs acting as two tabs on one device: no counter change is lost.
  - Natural keys: two docs create the same keyed record while apart, each changes its stock and notes, then they sync. Result: one record, stock equals the sum of both, both notes edits present.
- Persistence test with fake-indexeddb: write, close, reopen, everything restored.