import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { randomId, naturalKeyId } from './id.js';
import {
  recordsMapName,
  valuesMapName,
  talliesMapName,
  textName,
  valueKey,
  tallyKey,
  deletedKey,
  setRecord,
  hasRecord,
  getRecordIds,
  setValue,
  getValue,
  addTally,
  getTallies,
  getOrCreateText,
} from './doc-keys.js';

// ---------------------------------------------------------------------------
// naturalKeyId — deterministic mapping
// ---------------------------------------------------------------------------

describe('naturalKeyId — deterministic mapping', () => {
  it('strips parentheses and spaces: "Rice (50 kg)" → "k:rice50kg"', () => {
    expect(naturalKeyId('Rice (50 kg)')).toBe('k:rice50kg');
  });

  it('strips tone marks: "Ògì" → "k:ogi"', () => {
    expect(naturalKeyId('Ògì')).toBe('k:ogi');
  });

  it('"Ogi" → "k:ogi" (same result as "Ògì")', () => {
    expect(naturalKeyId('Ogi')).toBe('k:ogi');
  });

  it('case-insensitive: "RICE 50KG" → "k:rice50kg"', () => {
    expect(naturalKeyId('RICE 50KG')).toBe('k:rice50kg');
  });

  it('case-insensitive: "rice 50kg" → "k:rice50kg"', () => {
    expect(naturalKeyId('rice 50kg')).toBe('k:rice50kg');
  });

  it('Turkish İ: "İ" → "k:i" (combining dot removed via NFD + mark-strip)', () => {
    expect(naturalKeyId('İ')).toBe('k:i');
  });
});

// ---------------------------------------------------------------------------
// naturalKeyId — error on empty result
// ---------------------------------------------------------------------------

describe('naturalKeyId — error on empty result', () => {
  it('throws for "!!!" with message matching /empty/i', () => {
    expect(() => naturalKeyId('!!!')).toThrowError(/empty/i);
  });

  it('throws for "" with message matching /empty/i', () => {
    expect(() => naturalKeyId('')).toThrowError(/empty/i);
  });
});

// ---------------------------------------------------------------------------
// randomId
// ---------------------------------------------------------------------------

describe('randomId', () => {
  it('returns a string', () => {
    expect(typeof randomId()).toBe('string');
  });

  it('two successive calls return different values', () => {
    expect(randomId()).not.toBe(randomId());
  });
});

// ---------------------------------------------------------------------------
// doc-keys smoke tests
// ---------------------------------------------------------------------------

describe('doc-keys — key-building functions', () => {
  it('recordsMapName returns a string containing the collection name', () => {
    expect(recordsMapName('items')).toBe('items:records');
  });

  it('valuesMapName returns a string containing the collection name', () => {
    expect(valuesMapName('items')).toBe('items:values');
  });

  it('talliesMapName returns a string containing the collection name', () => {
    expect(talliesMapName('items')).toBe('items:tallies');
  });

  it('textName returns a string with collection, recordId, and field', () => {
    expect(textName('items', 'rec1', 'notes')).toBe('items:text:rec1/notes');
  });

  it('valueKey returns "recordId/field"', () => {
    expect(valueKey('rec1', 'name')).toBe('rec1/name');
  });

  it('tallyKey returns "recordId/field/clientId"', () => {
    expect(tallyKey('rec1', 'stock', 42)).toBe('rec1/stock/42');
  });

  it('deletedKey returns "recordId/_deleted"', () => {
    expect(deletedKey('rec1')).toBe('rec1/_deleted');
  });
});

describe('doc-keys — record helpers', () => {
  it('setRecord / hasRecord round-trip', () => {
    const doc = new Y.Doc();
    expect(hasRecord(doc, 'items', 'r1')).toBe(false);
    setRecord(doc, 'items', 'r1', { createdAt: 1 });
    expect(hasRecord(doc, 'items', 'r1')).toBe(true);
  });

  it('getRecordIds returns inserted IDs', () => {
    const doc = new Y.Doc();
    setRecord(doc, 'items', 'r1', { createdAt: 1 });
    setRecord(doc, 'items', 'r2', { createdAt: 2 });
    expect(getRecordIds(doc, 'items').sort()).toEqual(['r1', 'r2']);
  });
});

describe('doc-keys — value helpers', () => {
  it('setValue / getValue round-trip', () => {
    const doc = new Y.Doc();
    setValue(doc, 'items', 'r1', 'name', 'Tomatoes');
    expect(getValue(doc, 'items', 'r1', 'name')).toBe('Tomatoes');
  });

  it('getValue returns undefined for missing field', () => {
    const doc = new Y.Doc();
    expect(getValue(doc, 'items', 'r1', 'name')).toBeUndefined();
  });
});

describe('doc-keys — tally helpers', () => {
  it('addTally accumulates and getTallies returns them', () => {
    const doc = new Y.Doc();
    addTally(doc, 'items', 'r1', 'stock', doc.clientID, { inc: 5, dec: 0 });
    addTally(doc, 'items', 'r1', 'stock', doc.clientID, { inc: 3, dec: 1 });
    const tallies = getTallies(doc, 'items', 'r1', 'stock');
    expect(tallies).toHaveLength(1);
    expect(tallies[0]).toEqual({ inc: 8, dec: 1 });
  });

  it('getTallies returns empty array when no tallies exist', () => {
    const doc = new Y.Doc();
    expect(getTallies(doc, 'items', 'r1', 'stock')).toEqual([]);
  });
});

describe('doc-keys — text helpers', () => {
  it('getOrCreateText returns a Y.Text instance', () => {
    const doc = new Y.Doc();
    const text = getOrCreateText(doc, 'items', 'r1', 'notes');
    expect(text).toBeInstanceOf(Y.Text);
  });

  it('getOrCreateText returns the same instance on repeated calls', () => {
    const doc = new Y.Doc();
    const a = getOrCreateText(doc, 'items', 'r1', 'notes');
    const b = getOrCreateText(doc, 'items', 'r1', 'notes');
    expect(a).toBe(b);
  });
});
