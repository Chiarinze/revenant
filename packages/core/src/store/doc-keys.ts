import * as Y from 'yjs';

// ---------------------------------------------------------------------------
// Pure key-building functions — no Y.Doc dependency
// ---------------------------------------------------------------------------

/**
 * Name of the top-level Y.Map that marks record existence.
 * Maps record ID → `{ createdAt: number }`.
 */
export function recordsMapName(collection: string): string {
  return `${collection}:records`;
}

/**
 * Name of the top-level Y.Map that holds `value` fields.
 * Maps `recordId/field` → value.  Soft-delete key is `recordId/_deleted`.
 */
export function valuesMapName(collection: string): string {
  return `${collection}:values`;
}

/**
 * Name of the top-level Y.Map that holds `counter` tallies.
 * Maps `recordId/field/clientId` → `{ inc: number; dec: number }`.
 */
export function talliesMapName(collection: string): string {
  return `${collection}:tallies`;
}

/**
 * Name of the top-level Y.Text for a `text` field.
 * Top-level shared types with the same name are the same object on every copy.
 */
export function textName(
  collection: string,
  recordId: string,
  field: string,
): string {
  return `${collection}:text:${recordId}/${field}`;
}

/**
 * Key inside `c:values` for a `value` field.
 */
export function valueKey(recordId: string, field: string): string {
  return `${recordId}/${field}`;
}

/**
 * Key inside `c:tallies` for one copy's tally of a `counter` field.
 * Each copy only writes keys whose `clientId` matches its own `doc.clientID`,
 * so writes never collide — including two tabs on one device.
 */
export function tallyKey(
  recordId: string,
  field: string,
  clientId: number,
): string {
  return `${recordId}/${field}/${clientId}`;
}

/**
 * Soft-delete key inside `c:values`.  Set to `true` to mark a record deleted.
 */
export function deletedKey(recordId: string): string {
  return `${recordId}/_deleted`;
}

// ---------------------------------------------------------------------------
// Tally value shape
// ---------------------------------------------------------------------------

export interface TallyValue {
  inc: number;
  dec: number;
}

// ---------------------------------------------------------------------------
// Record-existence helpers — c:records
// ---------------------------------------------------------------------------

/**
 * Marks a record as existing in `c:records` and stores its creation metadata.
 * Runs inside a Yjs transaction so the write is atomic.
 */
export function setRecord(
  doc: Y.Doc,
  collection: string,
  id: string,
  meta: { createdAt: number },
): void {
  const map = doc.getMap<{ createdAt: number }>(recordsMapName(collection));
  doc.transact(() => {
    map.set(id, meta);
  });
}

/**
 * Returns `true` if the record ID is present in `c:records`.
 */
export function hasRecord(
  doc: Y.Doc,
  collection: string,
  id: string,
): boolean {
  return doc.getMap(recordsMapName(collection)).has(id);
}

/**
 * Returns all record IDs currently stored in `c:records`.
 */
export function getRecordIds(doc: Y.Doc, collection: string): string[] {
  return Array.from(
    doc.getMap(recordsMapName(collection)).keys(),
  );
}

// ---------------------------------------------------------------------------
// Value-field helpers — c:values
// ---------------------------------------------------------------------------

/**
 * Writes a `value` field (or any `c:values` entry) within a transaction.
 */
export function setValue(
  doc: Y.Doc,
  collection: string,
  recordId: string,
  field: string,
  v: unknown,
): void {
  const map = doc.getMap<unknown>(valuesMapName(collection));
  doc.transact(() => {
    map.set(valueKey(recordId, field), v);
  });
}

/**
 * Reads a `value` field from `c:values`.  Returns `undefined` if absent.
 */
export function getValue(
  doc: Y.Doc,
  collection: string,
  recordId: string,
  field: string,
): unknown {
  return doc.getMap<unknown>(valuesMapName(collection)).get(
    valueKey(recordId, field),
  );
}

// ---------------------------------------------------------------------------
// Tally helpers — c:tallies
// ---------------------------------------------------------------------------

/**
 * Merges a delta into the tally for `clientId` for a `counter` field.
 * Reads the existing `{ inc, dec }`, adds the delta amounts, and writes back —
 * all inside a single transaction.  Only the calling copy's own `clientId` key
 * is ever written, so concurrent tally writes never collide.
 */
export function addTally(
  doc: Y.Doc,
  collection: string,
  recordId: string,
  field: string,
  clientId: number,
  delta: { inc: number; dec: number },
): void {
  const map = doc.getMap<TallyValue>(talliesMapName(collection));
  const key = tallyKey(recordId, field, clientId);
  doc.transact(() => {
    const existing = map.get(key) ?? { inc: 0, dec: 0 };
    map.set(key, {
      inc: existing.inc + delta.inc,
      dec: existing.dec + delta.dec,
    });
  });
}

/**
 * Returns all tally objects for every clientId that has written a tally for
 * `recordId/field`.  The caller sums `inc` and subtracts `dec` to get the
 * counter value.
 */
export function getTallies(
  doc: Y.Doc,
  collection: string,
  recordId: string,
  field: string,
): Array<TallyValue> {
  const map = doc.getMap<TallyValue>(talliesMapName(collection));
  const prefix = `${recordId}/${field}/`;
  const result: TallyValue[] = [];
  for (const [key, tally] of map.entries()) {
    if (key.startsWith(prefix)) {
      result.push(tally);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Text helpers — c:text
// ---------------------------------------------------------------------------

/**
 * Returns the Y.Text for a `text` field, creating it on first access.
 * Yjs auto-creates top-level shared types on `doc.getText()`, and two copies
 * that call this with the same name get the same collaborative object after
 * syncing.
 */
export function getOrCreateText(
  doc: Y.Doc,
  collection: string,
  recordId: string,
  field: string,
): Y.Text {
  return doc.getText(textName(collection, recordId, field));
}
