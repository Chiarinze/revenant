import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';

import { collection } from '../schema/collection.js';
import { value, counter, text } from '../schema/kinds.js';
import { CollectionHandle } from './collection.js';
import { valuesMapName, deletedKey } from './doc-keys.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const productFields = {
  name: value<string>(),
  unit: value<string>(),
  stock: counter(),
  notes: text(),
};

const productDescriptor = collection(productFields, { key: (p) => p.name });
const productDescriptorNoKey = collection(productFields);

function makeHandle(doc: Y.Doc, withKey = true) {
  return new CollectionHandle(
    'products',
    withKey ? productDescriptor : productDescriptorNoKey,
    doc,
  );
}

// Soft-delete a record directly via the Y.Doc (bypasses CollectionHandle).
function softDelete(doc: Y.Doc, collectionName: string, id: string) {
  const valuesMap = doc.getMap<unknown>(valuesMapName(collectionName));
  doc.transact(() => {
    valuesMap.set(deletedKey(id), true);
  });
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('CollectionHandle.create', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('creates a record and returns a string ID', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('with a natural key: second create returns the same ID and does not overwrite fields', () => {
    const handle = makeHandle(doc);
    const id1 = handle.create({ name: 'Rice', unit: 'kg' });
    const id2 = handle.create({ name: 'Rice', unit: 'bag' }); // different unit

    expect(id2).toBe(id1);

    // Original unit should be unchanged.
    const record = handle.get(id1);
    expect(record?.unit).toBe('kg');
  });

  it('with a natural key: restores a soft-deleted record on re-create', () => {
    const handle = makeHandle(doc);
    const id = handle.create({ name: 'Beans', unit: 'kg' });

    softDelete(doc, 'products', id);
    expect(handle.get(id)).toBeUndefined();

    handle.create({ name: 'Beans', unit: 'kg' });
    expect(handle.get(id)).toBeDefined();
  });

  it('throws for an undeclared field name', () => {
    const handle = makeHandle(doc);
    expect(() =>
      // @ts-expect-error intentional undeclared field
      handle.create({ name: 'Rice', unit: 'kg', ghost: 'oops' }),
    ).toThrowError(/Field "ghost" is not declared/);
  });

  it('throws when a counter field is passed as a create argument', () => {
    const handle = makeHandle(doc);
    expect(() =>
      // @ts-expect-error intentional counter field passed
      handle.create({ name: 'Rice', unit: 'kg', stock: 5 }),
    ).toThrowError(/is not a value field \(kind: "counter"\)/);
  });

  it('throws when a text field is passed as a create argument', () => {
    const handle = makeHandle(doc);
    expect(() =>
      // @ts-expect-error intentional text field passed
      handle.create({ name: 'Rice', unit: 'kg', notes: 'hello' }),
    ).toThrowError(/is not a value field \(kind: "text"\)/);
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe('CollectionHandle.get', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('returns the record with correct field values and an id property', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Maize', unit: 'bags' });
    const record = handle.get(id);

    expect(record).toBeDefined();
    expect(record?.id).toBe(id);
    expect(record?.name).toBe('Maize');
    expect(record?.unit).toBe('bags');
    expect(record?.stock).toBe(0); // counter starts at 0
    expect(record?.notes).toBe('');  // text starts empty
  });

  it('returns undefined for an unknown ID', () => {
    const handle = makeHandle(doc);
    expect(handle.get('nonexistent-id')).toBeUndefined();
  });

  it('returns undefined for a soft-deleted record', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Yam', unit: 'tubers' });

    softDelete(doc, 'products', id);
    expect(handle.get(id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// all
// ---------------------------------------------------------------------------

describe('CollectionHandle.all', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('returns all non-deleted records', () => {
    const handle = makeHandle(doc, false);
    handle.create({ name: 'A', unit: 'u' });
    handle.create({ name: 'B', unit: 'u' });
    handle.create({ name: 'C', unit: 'u' });

    expect(handle.all()).toHaveLength(3);
  });

  it('excludes soft-deleted records', () => {
    const handle = makeHandle(doc, false);
    const id1 = handle.create({ name: 'A', unit: 'u' });
    handle.create({ name: 'B', unit: 'u' });

    softDelete(doc, 'products', id1);

    const records = handle.all();
    expect(records).toHaveLength(1);
    expect(records[0]?.name).toBe('B');
  });

  it('returns records sorted by id in ascending lexicographic order', () => {
    // Use natural keys so the ids are deterministic (k:<normalised>).
    const handle = makeHandle(doc);
    handle.create({ name: 'Yam', unit: 'u' });
    handle.create({ name: 'Beans', unit: 'u' });
    handle.create({ name: 'Maize', unit: 'u' });

    const records = handle.all();
    const ids = records.map((r) => r.id);
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(ids).toEqual(sorted);
  });

  it('each returned record has an id property', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Z', unit: 'u' });

    const records = handle.all();
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('CollectionHandle.update', () => {
  let doc: Y.Doc;
  beforeEach(() => { doc = new Y.Doc(); });

  it('writes changed value fields to the record', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.update(id, { unit: 'bag' });
    expect(handle.get(id)?.unit).toBe('bag');
  });

  it('skips undefined values in the patch', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    // Cast through unknown to test runtime behaviour with an undefined value.
    const patch = { unit: undefined } as unknown as Partial<{ name: string; unit: string }>;
    handle.update(id, patch);
    expect(handle.get(id)?.unit).toBe('kg');
  });

  it('throws for a missing record', () => {
    const handle = makeHandle(doc, false);
    expect(() => handle.update('no-such-id', { name: 'X' })).toThrow();
  });

  it('throws for a deleted record', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    softDelete(doc, 'products', id);
    expect(() => handle.update(id, { name: 'X' })).toThrow();
  });

  it('throws for an undeclared field', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    // @ts-expect-error intentional
    expect(() => handle.update(id, { ghost: 'oops' })).toThrowError(/not declared/);
  });

  it('throws when patching a counter field', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    // @ts-expect-error intentional
    expect(() => handle.update(id, { stock: 5 })).toThrowError(/not a value field/);
  });

  it('blocks a natural-key change', () => {
    const handle = makeHandle(doc); // withKey = true
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.update(id, { name: 'Beans' })).toThrowError(/natural key cannot change/);
  });

  it('allows a rename when casing changes but natural key stays the same (RICE)', () => {
    const handle = makeHandle(doc); // withKey = true
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.update(id, { name: 'RICE' })).not.toThrow();
    expect(handle.get(id)?.name).toBe('RICE');
  });

  it('allows a rename when punctuation differs but natural key stays the same (rice!)', () => {
    const handle = makeHandle(doc); // withKey = true
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.update(id, { name: 'rice!' })).not.toThrow();
    expect(handle.get(id)?.id).toBe(id);
    expect(handle.get(id)?.name).toBe('rice!');
  });
});

// ---------------------------------------------------------------------------
// increment
// ---------------------------------------------------------------------------

describe('CollectionHandle.increment', () => {
  let doc: Y.Doc;
  beforeEach(() => { doc = new Y.Doc(); });

  it('increases the counter', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.increment(id, 'stock', 5);
    expect(handle.get(id)?.stock).toBe(5);
  });

  it('accumulates across multiple increments', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.increment(id, 'stock', 3);
    handle.increment(id, 'stock', 7);
    expect(handle.get(id)?.stock).toBe(10);
  });

  it('throws for a non-positive amount', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.increment(id, 'stock', 0)).toThrow();
    expect(() => handle.increment(id, 'stock', -1)).toThrow();
  });

  it('throws for a non-integer amount', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.increment(id, 'stock', 1.5)).toThrow();
  });

  it('throws for a missing record', () => {
    const handle = makeHandle(doc, false);
    expect(() => handle.increment('no-such-id', 'stock', 1)).toThrow();
  });

  it('throws for a deleted record', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    softDelete(doc, 'products', id);
    expect(() => handle.increment(id, 'stock', 1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// decrement
// ---------------------------------------------------------------------------

describe('CollectionHandle.decrement', () => {
  let doc: Y.Doc;
  beforeEach(() => { doc = new Y.Doc(); });

  it('decreases the counter', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.increment(id, 'stock', 10);
    handle.decrement(id, 'stock', 3);
    expect(handle.get(id)?.stock).toBe(7);
  });

  it('throws for a non-positive amount', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.decrement(id, 'stock', 0)).toThrow();
  });

  it('throws for a missing record', () => {
    const handle = makeHandle(doc, false);
    expect(() => handle.decrement('no-such-id', 'stock', 1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// editText
// ---------------------------------------------------------------------------

describe('CollectionHandle.editText', () => {
  let doc: Y.Doc;
  beforeEach(() => { doc = new Y.Doc(); });

  it('inserts text', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.editText(id, 'notes', { index: 0, insert: 'hello' });
    expect(handle.get(id)?.notes).toBe('hello');
  });

  it('deletes text', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.editText(id, 'notes', { index: 0, insert: 'hello world' });
    handle.editText(id, 'notes', { index: 5, delete: 6 });
    expect(handle.get(id)?.notes).toBe('hello');
  });

  it('replace: deletes first then inserts when op has both delete and insert', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.editText(id, 'notes', { index: 0, insert: 'hello' });
    handle.editText(id, 'notes', { index: 0, delete: 5, insert: 'world' });
    expect(handle.get(id)?.notes).toBe('world');
  });

  it('throws when op has neither insert nor delete', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.editText(id, 'notes', { index: 0 })).toThrowError(/insert, delete, or both/);
  });

  it('throws for a negative index', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.editText(id, 'notes', { index: -1, insert: 'x' })).toThrowError(/non-negative integer/);
  });

  it('throws when delete length is out of bounds', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.editText(id, 'notes', { index: 0, insert: 'hi' });
    expect(() => handle.editText(id, 'notes', { index: 0, delete: 99 })).toThrowError(/out of bounds/);
  });

  it('throws for a missing record', () => {
    const handle = makeHandle(doc, false);
    expect(() => handle.editText('no-such-id', 'notes', { index: 0, insert: 'x' })).toThrow();
  });

  it('throws when field is not a text field', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    // @ts-expect-error intentional wrong field kind
    expect(() => handle.editText(id, 'stock', { index: 0, insert: 'x' })).toThrowError(/not a text field/);
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('CollectionHandle.remove', () => {
  let doc: Y.Doc;
  beforeEach(() => { doc = new Y.Doc(); });

  it('soft-deletes a record so get returns undefined', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.remove(id);
    expect(handle.get(id)).toBeUndefined();
  });

  it('throws for a missing record', () => {
    const handle = makeHandle(doc, false);
    expect(() => handle.remove('no-such-id')).toThrow();
  });

  it('throws when already deleted', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.remove(id);
    expect(() => handle.remove(id)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// increment — additional error cases
// ---------------------------------------------------------------------------

describe('CollectionHandle.increment — additional error cases', () => {
  let doc: Y.Doc;
  beforeEach(() => { doc = new Y.Doc(); });

  it('throws for a value field (not a counter)', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    // @ts-expect-error intentional wrong field kind
    expect(() => handle.increment(id, 'name', 1)).toThrowError(/not a counter field/);
  });

  it('throws for a text field (not a counter)', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    // @ts-expect-error intentional wrong field kind
    expect(() => handle.increment(id, 'notes', 1)).toThrowError(/not a counter field/);
  });

  it('throws for a non-safe-integer amount', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.increment(id, 'stock', Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => handle.increment(id, 'stock', Infinity)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// decrement — additional error cases
// ---------------------------------------------------------------------------

describe('CollectionHandle.decrement — additional error cases', () => {
  let doc: Y.Doc;
  beforeEach(() => { doc = new Y.Doc(); });

  it('throws for a value field (not a counter)', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    // @ts-expect-error intentional wrong field kind
    expect(() => handle.decrement(id, 'name', 1)).toThrowError(/not a counter field/);
  });

  it('throws for a text field (not a counter)', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    // @ts-expect-error intentional wrong field kind
    expect(() => handle.decrement(id, 'notes', 1)).toThrowError(/not a counter field/);
  });

  it('throws for a deleted record', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.increment(id, 'stock', 5);
    softDelete(doc, 'products', id);
    expect(() => handle.decrement(id, 'stock', 1)).toThrow();
  });

  it('throws for a non-safe-integer amount', () => {
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    expect(() => handle.decrement(id, 'stock', 1.5)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cross-doc tally: increment/decrement across two independent Y.Doc copies
// ---------------------------------------------------------------------------

describe('Counter tally across two Y.Doc copies', () => {
  it('sums tallies from two separate docs after exchanging updates', () => {
    const docA = new Y.Doc({ guid: 'shop' });
    const docB = new Y.Doc({ guid: 'shop' });

    const handleA = makeHandle(docA, false);
    const handleB = makeHandle(docB, false);

    // Create the record on A and sync it to B.
    const id = handleA.create({ name: 'Rice', unit: 'kg' });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Each doc increments independently.
    handleA.increment(id, 'stock', 10);
    handleB.increment(id, 'stock', 5);

    // Exchange updates.
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(handleA.get(id)?.stock).toBe(15);
    expect(handleB.get(id)?.stock).toBe(15);
  });

  it('two copies each decrement; total reflects both decrements', () => {
    const docA = new Y.Doc({ guid: 'shop' });
    const docB = new Y.Doc({ guid: 'shop' });

    const handleA = makeHandle(docA, false);
    const handleB = makeHandle(docB, false);

    // Start with stock 20 on A and sync.
    const id = handleA.create({ name: 'Beans', unit: 'kg' });
    handleA.increment(id, 'stock', 20);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Both decrements happen independently (offline).
    handleA.decrement(id, 'stock', 3);
    handleB.decrement(id, 'stock', 7);

    // Sync.
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    // 20 − 3 − 7 = 10
    expect(handleA.get(id)?.stock).toBe(10);
    expect(handleB.get(id)?.stock).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Single transaction per operation (one subscriber notification per call)
// ---------------------------------------------------------------------------

describe('Each write emits exactly one subscriber notification per operation', () => {
  it('create fires exactly one update event', () => {
    const doc = new Y.Doc();
    let callCount = 0;
    doc.on('update', () => { callCount++; });

    const handle = makeHandle(doc, false);
    handle.create({ name: 'Rice', unit: 'kg' });
    expect(callCount).toBe(1);
  });

  it('update fires exactly one update event', () => {
    const doc = new Y.Doc();
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });

    let callCount = 0;
    doc.on('update', () => { callCount++; });

    handle.update(id, { unit: 'bag', name: 'Rice 50kg' });
    expect(callCount).toBe(1);
  });

  it('increment fires exactly one update event', () => {
    const doc = new Y.Doc();
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });

    let callCount = 0;
    doc.on('update', () => { callCount++; });

    handle.increment(id, 'stock', 5);
    expect(callCount).toBe(1);
  });

  it('decrement fires exactly one update event', () => {
    const doc = new Y.Doc();
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });
    handle.increment(id, 'stock', 10);

    let callCount = 0;
    doc.on('update', () => { callCount++; });

    handle.decrement(id, 'stock', 3);
    expect(callCount).toBe(1);
  });

  it('editText fires exactly one update event', () => {
    const doc = new Y.Doc();
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });

    let callCount = 0;
    doc.on('update', () => { callCount++; });

    handle.editText(id, 'notes', { index: 0, insert: 'hello' });
    expect(callCount).toBe(1);
  });

  it('remove fires exactly one update event', () => {
    const doc = new Y.Doc();
    const handle = makeHandle(doc, false);
    const id = handle.create({ name: 'Rice', unit: 'kg' });

    let callCount = 0;
    doc.on('update', () => { callCount++; });

    handle.remove(id);
    expect(callCount).toBe(1);
  });
});
