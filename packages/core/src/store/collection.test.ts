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
