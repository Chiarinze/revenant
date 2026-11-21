/**
 * Tests for openSpace — subscriptions, snapshots, and openSpace behaviour.
 *
 * Requirements: 4.1, 4.2, 4.3, 2.1, 2.4
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { defineSchema } from '../schema/define-schema.js';
import { collection } from '../schema/collection.js';
import { value, counter, text } from '../schema/kinds.js';
import { openSpace } from './open-space.js';

// ---------------------------------------------------------------------------
// Schema shared across tests
// ---------------------------------------------------------------------------

const schema = defineSchema({
  products: collection(
    { name: value<string>(), unit: value<string>(), stock: counter(), notes: text() },
    { key: (p) => p.name },
  ),
});

const itemSchema = defineSchema({
  items: collection({ name: value<string>(), stock: counter(), notes: text() }),
});

// Each test gets a fresh, unique space ID so the fake-indexeddb instances
// don't bleed into one another.
let testSpaceId = 0;
function freshId(): string {
  return `test-space-${++testSpaceId}`;
}

beforeEach(() => {
  // Fresh fake IndexedDB for every test.
  globalThis.indexedDB = new IDBFactory();
});

// ---------------------------------------------------------------------------
// openSpace — id validation
// ---------------------------------------------------------------------------

describe('openSpace id validation', () => {
  it('throws synchronously-ish for an empty id', async () => {
    await expect(openSpace({ id: '', schema })).rejects.toThrow(
      /id must not be empty/,
    );
  });

  it('opens successfully for a non-empty id', async () => {
    const space = await openSpace({ id: freshId(), schema });
    expect(space).toBeDefined();
    await space.close();
  });
});

// ---------------------------------------------------------------------------
// subscribe / unsubscribe — Requirement 4.1
// ---------------------------------------------------------------------------

describe('space.subscribe', () => {
  it('calls the callback when a record is created', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    let calls = 0;
    space.subscribe(() => { calls++; });

    products.create({ name: 'Rice', unit: 'kg' });
    expect(calls).toBe(1);
    await space.close();
  });

  it('calls the callback when a value field is updated', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const id = products.create({ name: 'Rice', unit: 'kg' });
    let calls = 0;
    space.subscribe(() => { calls++; });

    products.update(id, { unit: 'bag' });
    expect(calls).toBe(1);
    await space.close();
  });

  it('calls the callback when a counter is incremented', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const id = products.create({ name: 'Rice', unit: 'kg' });
    let calls = 0;
    space.subscribe(() => { calls++; });

    products.increment(id, 'stock', 5);
    expect(calls).toBe(1);
    await space.close();
  });

  it('calls the callback when a record is removed', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const id = products.create({ name: 'Rice', unit: 'kg' });
    let calls = 0;
    space.subscribe(() => { calls++; });

    products.remove(id);
    expect(calls).toBe(1);
    await space.close();
  });

  it('supports multiple independent subscribers', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    let callsA = 0;
    let callsB = 0;
    space.subscribe(() => { callsA++; });
    space.subscribe(() => { callsB++; });

    products.create({ name: 'Beans', unit: 'kg' });
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);
    await space.close();
  });

  it('returned unsubscribe stops future notifications', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    let calls = 0;
    const unsubscribe = space.subscribe(() => { calls++; });

    products.create({ name: 'Maize', unit: 'kg' });
    expect(calls).toBe(1);

    unsubscribe();

    products.create({ name: 'Yam', unit: 'tubers' });
    expect(calls).toBe(1); // still 1 — no more calls after unsubscribe
    await space.close();
  });

  it('a throwing subscriber does not break other subscribers', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    let safeCallCount = 0;
    space.subscribe(() => { throw new Error('oops'); });
    space.subscribe(() => { safeCallCount++; });

    // Should not throw even though the first subscriber throws.
    expect(() => products.create({ name: 'Rice', unit: 'kg' })).not.toThrow();
    expect(safeCallCount).toBe(1);
    await space.close();
  });
});

// ---------------------------------------------------------------------------
// getSnapshot — Requirement 4.3
// ---------------------------------------------------------------------------

describe('space.getSnapshot', () => {
  it('returns an object keyed by collection name', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const snap = space.getSnapshot();
    expect(snap).toHaveProperty('products');
    expect(Array.isArray(snap.products)).toBe(true);
    await space.close();
  });

  it('snapshot is empty before any records are created', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const snap = space.getSnapshot();
    expect(snap.products).toHaveLength(0);
    await space.close();
  });

  it('returns the same reference when nothing has changed', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const snap1 = space.getSnapshot();
    const snap2 = space.getSnapshot();
    expect(snap1).toBe(snap2); // strict reference equality
    await space.close();
  });

  it('returns a new reference after a write', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const snap1 = space.getSnapshot();
    products.create({ name: 'Rice', unit: 'kg' });
    const snap2 = space.getSnapshot();

    expect(snap2).not.toBe(snap1);
    await space.close();
  });

  it('snapshot reflects the current state after multiple writes', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    products.create({ name: 'Rice', unit: 'kg' });
    products.create({ name: 'Beans', unit: 'kg' });

    const snap = space.getSnapshot();
    expect(snap.products).toHaveLength(2);
    await space.close();
  });

  it('snapshot excludes soft-deleted records', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const id = products.create({ name: 'Rice', unit: 'kg' });
    products.create({ name: 'Beans', unit: 'kg' });
    products.remove(id);

    const snap = space.getSnapshot();
    expect(snap.products).toHaveLength(1);
    expect(snap.products[0]?.name).toBe('Beans');
    await space.close();
  });

  it('stays stable across multiple no-op calls after a write', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    products.create({ name: 'Rice', unit: 'kg' });
    const snap1 = space.getSnapshot();
    const snap2 = space.getSnapshot();
    const snap3 = space.getSnapshot();

    expect(snap1).toBe(snap2);
    expect(snap2).toBe(snap3);
    await space.close();
  });

  it('snapshot includes counter and text field values', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const id = products.create({ name: 'Rice', unit: 'kg' });
    products.increment(id, 'stock', 10);
    products.editText(id, 'notes', { index: 0, insert: 'Good quality' });

    const snap = space.getSnapshot();
    const record = snap.products.find((r) => r.id === id);
    expect(record?.stock).toBe(10);
    expect(record?.notes).toBe('Good quality');
    await space.close();
  });
});

// ---------------------------------------------------------------------------
// persisted flag
// ---------------------------------------------------------------------------

describe('space.persisted', () => {
  it('exposes a persisted boolean property', async () => {
    const space = await openSpace({ id: freshId(), schema });
    // In the test environment navigator.storage.persist is not available,
    // so persisted should be false.
    expect(typeof space.persisted).toBe('boolean');
    await space.close();
  });
});

// ---------------------------------------------------------------------------
// close — Requirements 2.4
// ---------------------------------------------------------------------------

describe('space.close', () => {
  it('resolves cleanly without throwing', async () => {
    const space = await openSpace({ id: freshId(), schema });
    await expect(space.close()).resolves.toBeUndefined();
  });

  it('is idempotent — calling close twice does not throw', async () => {
    const space = await openSpace({ id: freshId(), schema });
    await space.close();
    await expect(space.close()).resolves.toBeUndefined();
  });

  it('clears subscribers — no callback fires after close', async () => {
    const space = await openSpace({ id: freshId(), schema });
    let callCount = 0;
    space.subscribe(() => { callCount++; });

    await space.close();

    // The subscriber set must be empty after close.
    // callCount was 0 before close and nothing should fire during close.
    expect(callCount).toBe(0);
  });

  it('throws "space is closed" on collection() after close', async () => {
    const space = await openSpace({ id: freshId(), schema });
    await space.close();
    expect(() => space.collection('products')).toThrowError(/space is closed/);
  });

  it('throws "space is closed" on subscribe() after close', async () => {
    const space = await openSpace({ id: freshId(), schema });
    await space.close();
    expect(() => space.subscribe(() => {})).toThrowError(/space is closed/);
  });

  it('throws "space is closed" on getSnapshot() after close', async () => {
    const space = await openSpace({ id: freshId(), schema });
    await space.close();
    expect(() => space.getSnapshot()).toThrowError(/space is closed/);
  });

  it('throws "space is closed" on encodeState() after close', async () => {
    const space = await openSpace({ id: freshId(), schema });
    await space.close();
    expect(() => space.encodeState()).toThrowError(/space is closed/);
  });

  it('throws "space is closed" on applyUpdate() after close', async () => {
    const space = await openSpace({ id: freshId(), schema });
    await space.close();
    expect(() => space.applyUpdate(new Uint8Array())).toThrowError(/space is closed/);
  });
});

// ---------------------------------------------------------------------------
// persisted — marks snapshot stale (Requirement 4.3)
// ---------------------------------------------------------------------------

describe('persisted change marks snapshot stale', () => {
  it('new snapshot reference is returned after persist() resolves', async () => {
    // Mock navigator.storage.persist to resolve after a small delay so the
    // persist microtask fires AFTER we capture snap1 (not inside openSpace).
    const mockPersist = vi.fn().mockImplementation(
      () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10)),
    );
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: { persist: mockPersist } },
      writable: true,
      configurable: true,
    });

    try {
      const space = await openSpace({ id: freshId(), schema });
      const snap1 = space.getSnapshot();

      // Wait long enough for the background persist() to resolve and fire.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      expect(space.persisted).toBe(true);

      // After persisted changed, stale must have been set, so a new snapshot
      // reference is built on the next getSnapshot() call.
      const snap2 = space.getSnapshot();
      expect(snap2).not.toBe(snap1);

      await space.close();
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    }
  });

  it('ignores a late persist() result if the space is already closed', async () => {
    // Mock navigator.storage.persist to resolve after a manual trigger,
    // simulating a late resolution after the space has been closed.
    let resolvePersist!: (v: boolean) => void;
    const persistPromise = new Promise<boolean>((res) => { resolvePersist = res; });
    const mockPersist = vi.fn().mockReturnValue(persistPromise);
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: { persist: mockPersist } },
      writable: true,
      configurable: true,
    });

    try {
      const space = await openSpace({ id: freshId(), schema });
      let callCount = 0;
      space.subscribe(() => { callCount++; });

      // Close the space before the persist promise resolves.
      await space.close();
      const countAfterClose = callCount;

      // Now resolve the persist promise.
      resolvePersist(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      // No subscriber should have fired after close.
      expect(callCount).toBe(countAfterClose);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// applyUpdate with origin — Requirement 5.5
// ---------------------------------------------------------------------------

describe('space.applyUpdate with origin', () => {
  it('applying with an origin tag does not throw and data is merged correctly', async () => {
    const spaceA = await openSpace({ id: freshId(), schema: itemSchema });
    const spaceB = await openSpace({ id: freshId(), schema: itemSchema });

    // Create a record in A, encode its state.
    const items = spaceA.collection('items');
    items.create({ name: 'Tomatoes' });
    const update = spaceA.encodeState();

    // Apply with an origin tag on B — should not throw.
    expect(() => spaceB.applyUpdate(update, 'sync-layer')).not.toThrow();

    // Data must appear in B after the update.
    const snap = spaceB.getSnapshot();
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]?.name).toBe('Tomatoes');

    await spaceA.close();
    await spaceB.close();
  });
});

// ---------------------------------------------------------------------------
// Two spaces exchange encodeState/applyUpdate — identical snapshots
// ---------------------------------------------------------------------------

describe('encodeState / applyUpdate — two-space sync', () => {
  it('after full exchange, both spaces have identical snapshots', async () => {
    const spaceA = await openSpace({ id: freshId(), schema });
    const spaceB = await openSpace({ id: freshId(), schema });

    const productsA = spaceA.collection('products');
    const productsB = spaceB.collection('products');

    // Each space creates a different record while "offline".
    productsA.create({ name: 'Rice', unit: 'kg' });
    productsB.create({ name: 'Beans', unit: 'bag' });

    // Exchange state: A → B, then B → A.
    spaceB.applyUpdate(spaceA.encodeState());
    spaceA.applyUpdate(spaceB.encodeState());

    const snapA = spaceA.getSnapshot();
    const snapB = spaceB.getSnapshot();

    // Both snapshots should contain 2 records.
    expect(snapA.products).toHaveLength(2);
    expect(snapB.products).toHaveLength(2);

    // Deep-equal: sort by id before comparing.
    const sortById = (arr: { id: string }[]) =>
      [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    expect(sortById(snapA.products)).toEqual(sortById(snapB.products));

    await spaceA.close();
    await spaceB.close();
  });

  it('counter changes from both spaces are preserved after sync', async () => {
    const spaceA = await openSpace({ id: freshId(), schema });
    const spaceB = await openSpace({ id: freshId(), schema });

    const productsA = spaceA.collection('products');
    const productsB = spaceB.collection('products');

    // Both spaces create the same keyed record and increment independently.
    const idA = productsA.create({ name: 'Rice', unit: 'kg' });
    productsA.increment(idA, 'stock', 10);

    // Sync A → B first so B knows the record exists.
    spaceB.applyUpdate(spaceA.encodeState());

    const idB = productsB.create({ name: 'Rice', unit: 'kg' });
    expect(idB).toBe(idA); // same natural key → same ID
    productsB.increment(idB, 'stock', 5);

    // Full exchange.
    spaceB.applyUpdate(spaceA.encodeState());
    spaceA.applyUpdate(spaceB.encodeState());

    const snapA = spaceA.getSnapshot();
    const snapB = spaceB.getSnapshot();

    expect(snapA.products[0]?.stock).toBe(15);
    expect(snapB.products[0]?.stock).toBe(15);

    await spaceA.close();
    await spaceB.close();
  });
});
