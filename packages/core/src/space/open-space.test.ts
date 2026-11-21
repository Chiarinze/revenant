/**
 * Tests for openSpace — subscriptions, snapshots, and openSpace behaviour.
 *
 * Requirements: 4.1, 4.2, 4.3, 2.1
 */
import { describe, it, expect, beforeEach } from 'vitest';

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

// Each test gets a fresh, unique space ID so the fake-indexeddb instances
// don't bleed into one another.
let testSpaceId = 0;
function freshId(): string {
  return `test-space-${++testSpaceId}`;
}

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
  });

  it('calls the callback when a value field is updated', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const id = products.create({ name: 'Rice', unit: 'kg' });
    let calls = 0;
    space.subscribe(() => { calls++; });

    products.update(id, { unit: 'bag' });
    expect(calls).toBe(1);
  });

  it('calls the callback when a counter is incremented', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const id = products.create({ name: 'Rice', unit: 'kg' });
    let calls = 0;
    space.subscribe(() => { calls++; });

    products.increment(id, 'stock', 5);
    expect(calls).toBe(1);
  });

  it('calls the callback when a record is removed', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const id = products.create({ name: 'Rice', unit: 'kg' });
    let calls = 0;
    space.subscribe(() => { calls++; });

    products.remove(id);
    expect(calls).toBe(1);
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
  });

  it('snapshot is empty before any records are created', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const snap = space.getSnapshot();
    expect(snap.products).toHaveLength(0);
  });

  it('returns the same reference when nothing has changed', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const snap1 = space.getSnapshot();
    const snap2 = space.getSnapshot();
    expect(snap1).toBe(snap2); // strict reference equality
  });

  it('returns a new reference after a write', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    const snap1 = space.getSnapshot();
    products.create({ name: 'Rice', unit: 'kg' });
    const snap2 = space.getSnapshot();

    expect(snap2).not.toBe(snap1);
  });

  it('snapshot reflects the current state after multiple writes', async () => {
    const space = await openSpace({ id: freshId(), schema });
    const products = space.collection('products');

    products.create({ name: 'Rice', unit: 'kg' });
    products.create({ name: 'Beans', unit: 'kg' });

    const snap = space.getSnapshot();
    expect(snap.products).toHaveLength(2);
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
  });
});
