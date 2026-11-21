import * as Y from 'yjs';

import type {
  FieldMap,
  CollectionDescriptor,
  InferRecord,
  ValueFields,
} from '../schema/collection.js';
import type { ValueKind, CounterKind, TextKind } from '../schema/kinds.js';
import {
  setRecord,
  hasRecord,
  getRecordIds,
  setValue,
  getValue,
  addTally,
  getTallies,
  getOrCreateText,
  deletedKey,
  valuesMapName,
} from './doc-keys.js';
import { randomId, naturalKeyId } from './id.js';

// ---------------------------------------------------------------------------
// Narrowing helper types
// ---------------------------------------------------------------------------

/** Keys of F whose kind is CounterKind. */
type CounterKeys<F extends FieldMap> = {
  [K in keyof F]: F[K] extends CounterKind ? K : never;
}[keyof F] & string;

/** Keys of F whose kind is TextKind. */
type TextKeys<F extends FieldMap> = {
  [K in keyof F]: F[K] extends TextKind ? K : never;
}[keyof F] & string;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns the counter value by summing all tallies for a record/field. */
function readCounter(
  doc: Y.Doc,
  collection: string,
  recordId: string,
  field: string,
): number {
  const tallies = getTallies(doc, collection, recordId, field);
  return tallies.reduce((sum, t) => sum + t.inc - t.dec, 0);
}

/** Returns true if the record is marked as soft-deleted. */
function isDeleted(doc: Y.Doc, collection: string, recordId: string): boolean {
  const valuesMap = doc.getMap<unknown>(valuesMapName(collection));
  return valuesMap.get(deletedKey(recordId)) === true;
}

// ---------------------------------------------------------------------------
// CollectionHandle
// ---------------------------------------------------------------------------

/**
 * Typed handle for one collection inside a space.
 *
 * Generic `F` is the FieldMap from the collection descriptor. All public
 * method signatures are derived from `F` via `InferRecord<F>`.
 */
export class CollectionHandle<F extends FieldMap> {
  private readonly doc: Y.Doc;
  private readonly name: string;
  private readonly descriptor: CollectionDescriptor<F>;

  constructor(
    name: string,
    descriptor: CollectionDescriptor<F>,
    doc: Y.Doc,
  ) {
    this.name = name;
    this.descriptor = descriptor;
    this.doc = doc;
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  /**
   * Creates a new record and returns its ID.
   *
   * - If the collection declares a natural key and a record with the same
   *   normalised key already exists, the existing ID is returned and the
   *   record's fields are left unchanged (but a soft-deleted record is
   *   restored).
   * - Without a natural key, a random UUID is used.
   * - Throws if `fields` contains a key not declared in the collection, or a
   *   key that is not a `value` field.
   *
   * Requirements: 3.1, 3.7
   */
  create(fields: InferRecord<ValueFields<F>>): string {
    // Validate every key in the input before touching the doc.
    for (const fieldName of Object.keys(fields)) {
      const kind = this.descriptor.fields[fieldName] as
        | ValueKind<unknown>
        | CounterKind
        | TextKind
        | undefined;

      if (kind === undefined) {
        throw new Error(
          `Field "${fieldName}" is not declared in collection "${this.name}"`,
        );
      }
      if (kind.kind !== 'value') {
        throw new Error(
          `Field "${fieldName}" in collection "${this.name}" is not a value field (kind: "${kind.kind}")`,
        );
      }
    }

    let id: string;
    let isExisting = false;

    // Resolve the ID — natural key or random.
    if (this.descriptor.key !== undefined) {
      const rawKey = this.descriptor.key(
        fields as unknown as InferRecord<ValueFields<F>>,
      );
      id = naturalKeyId(rawKey);

      if (hasRecord(this.doc, this.name, id)) {
        isExisting = true;
      }
    } else {
      id = randomId();
    }

    this.doc.transact(() => {
      if (isExisting) {
        // Restore a soft-deleted record; leave all other fields alone.
        if (isDeleted(this.doc, this.name, id)) {
          const valuesMap = this.doc.getMap<unknown>(
            valuesMapName(this.name),
          );
          valuesMap.delete(deletedKey(id));
        }
        return;
      }

      // Write the existence entry.
      setRecord(this.doc, this.name, id, { createdAt: Date.now() });

      // Write initial value fields.
      for (const [fieldName, kind] of Object.entries(this.descriptor.fields)) {
        const typedKind = kind as ValueKind<unknown> | CounterKind | TextKind;
        if (typedKind.kind === 'value') {
          const v = (fields as Record<string, unknown>)[fieldName];
          if (v !== undefined) {
            setValue(this.doc, this.name, id, fieldName, v);
          }
        }
        // counter and text fields start at zero / empty; no write needed.
      }
    });

    return id;
  }

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  /**
   * Returns the typed record for `id`, or `undefined` if the record does not
   * exist or has been soft-deleted.
   *
   * Requirements: 3.2
   */
  get(id: string): (InferRecord<F> & { id: string }) | undefined {
    if (!hasRecord(this.doc, this.name, id)) return undefined;
    if (isDeleted(this.doc, this.name, id)) return undefined;

    return this.readRecord(id);
  }

  // -------------------------------------------------------------------------
  // all
  // -------------------------------------------------------------------------

  /**
   * Returns every non-deleted record in the collection as typed plain objects,
   * sorted ascending by `id`.
   *
   * Requirements: 3.2
   */
  all(): (InferRecord<F> & { id: string })[] {
    const ids = getRecordIds(this.doc, this.name);
    const result: (InferRecord<F> & { id: string })[] = [];
    for (const id of ids) {
      if (!isDeleted(this.doc, this.name, id)) {
        result.push(this.readRecord(id));
      }
    }
    return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // -------------------------------------------------------------------------
  // Stubs for future tasks (task 4.2)
  // -------------------------------------------------------------------------

  /**
   * Updates `value` fields on an existing, non-deleted record.
   * @throws if the record is missing or deleted.
   */
  update(id: string, patch: Partial<InferRecord<ValueFields<F>>>): void {
    if (!hasRecord(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" does not exist in collection "${this.name}"`);
    }
    if (isDeleted(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" has been deleted in collection "${this.name}"`);
    }

    for (const fieldName of Object.keys(patch)) {
      const kind = this.descriptor.fields[fieldName] as
        | ValueKind<unknown>
        | CounterKind
        | TextKind
        | undefined;

      if (kind === undefined) {
        throw new Error(
          `Field "${fieldName}" is not declared in collection "${this.name}"`,
        );
      }
      if (kind.kind !== 'value') {
        throw new Error(
          `Field "${fieldName}" in collection "${this.name}" is not a value field (kind: "${kind.kind}")`,
        );
      }
    }

    // Fix 2 — block natural-key changes.
    if (this.descriptor.key !== undefined) {
      const currentValues: Record<string, unknown> = {};
      for (const [fieldName, kind] of Object.entries(this.descriptor.fields)) {
        const typedKind = kind as ValueKind<unknown> | CounterKind | TextKind;
        if (typedKind.kind === 'value') {
          currentValues[fieldName] = getValue(this.doc, this.name, id, fieldName);
        }
      }
      const mergedSnapshot: Record<string, unknown> = { ...currentValues };
      for (const [fieldName, v] of Object.entries(patch)) {
        if (v !== undefined) {
          mergedSnapshot[fieldName] = v;
        }
      }
      const computedId = naturalKeyId(
        this.descriptor.key(mergedSnapshot as InferRecord<ValueFields<F>>),
      );
      if (computedId !== id) {
        throw new Error('natural key cannot change; create a new record instead');
      }
    }

    this.doc.transact(() => {
      for (const [fieldName, v] of Object.entries(patch)) {
        if (v !== undefined) {
          setValue(this.doc, this.name, id, fieldName, v);
        }
      }
    });
  }

  /**
   * Increments a `counter` field by `amount`.
   * @throws if the field is not a counter, or if the record is missing/deleted.
   */
  increment(id: string, field: CounterKeys<F>, amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error(`increment amount must be a positive safe integer, got ${amount}`);
    }

    const kind = this.descriptor.fields[field] as
      | ValueKind<unknown>
      | CounterKind
      | TextKind
      | undefined;

    if (kind === undefined) {
      throw new Error(
        `Field "${field}" is not declared in collection "${this.name}"`,
      );
    }
    if (kind.kind !== 'counter') {
      throw new Error(
        `Field "${field}" in collection "${this.name}" is not a counter field (kind: "${kind.kind}")`,
      );
    }
    if (!hasRecord(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" does not exist in collection "${this.name}"`);
    }
    if (isDeleted(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" has been deleted in collection "${this.name}"`);
    }

    this.doc.transact(() => {
      addTally(this.doc, this.name, id, field, this.doc.clientID, { inc: amount, dec: 0 });
    });
  }

  /**
   * Decrements a `counter` field by `amount`.
   * @throws if the field is not a counter, or if the record is missing/deleted.
   */
  decrement(id: string, field: CounterKeys<F>, amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error(`decrement amount must be a positive safe integer, got ${amount}`);
    }

    const kind = this.descriptor.fields[field] as
      | ValueKind<unknown>
      | CounterKind
      | TextKind
      | undefined;

    if (kind === undefined) {
      throw new Error(
        `Field "${field}" is not declared in collection "${this.name}"`,
      );
    }
    if (kind.kind !== 'counter') {
      throw new Error(
        `Field "${field}" in collection "${this.name}" is not a counter field (kind: "${kind.kind}")`,
      );
    }
    if (!hasRecord(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" does not exist in collection "${this.name}"`);
    }
    if (isDeleted(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" has been deleted in collection "${this.name}"`);
    }

    this.doc.transact(() => {
      addTally(this.doc, this.name, id, field, this.doc.clientID, { inc: 0, dec: amount });
    });
  }

  /**
   * Applies an insert or delete to a `text` field.
   * @throws if the field is not a text field, or if the record is missing/deleted.
   */
  editText(
    id: string,
    field: TextKeys<F>,
    op: { index: number; insert?: string; delete?: number },
  ): void {
    const kind = this.descriptor.fields[field] as
      | ValueKind<unknown>
      | CounterKind
      | TextKind
      | undefined;

    if (kind === undefined) {
      throw new Error(
        `Field "${field}" is not declared in collection "${this.name}"`,
      );
    }
    if (kind.kind !== 'text') {
      throw new Error(
        `Field "${field}" in collection "${this.name}" is not a text field (kind: "${kind.kind}")`,
      );
    }
    if (!hasRecord(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" does not exist in collection "${this.name}"`);
    }
    if (isDeleted(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" has been deleted in collection "${this.name}"`);
    }

    // --- Input validation (Fix 1) ---
    if (op.insert === undefined && op.delete === undefined) {
      throw new Error('editText op must have insert, delete, or both');
    }
    if (!Number.isInteger(op.index) || op.index < 0) {
      throw new Error('editText index must be a non-negative integer');
    }
    if (op.delete !== undefined) {
      if (!Number.isInteger(op.delete) || op.delete < 0) {
        throw new Error('editText delete length must be a non-negative integer');
      }
    }

    const yText = getOrCreateText(this.doc, this.name, id, field);
    const textLen = yText.length;

    if (op.delete !== undefined && op.index + op.delete > textLen) {
      throw new Error('editText delete range out of bounds');
    }
    const lengthAfterDelete = textLen - (op.delete ?? 0);
    if (op.index > lengthAfterDelete) {
      throw new Error('editText index out of bounds');
    }

    // Delete first, then insert (Fix 1 — replace semantics).
    this.doc.transact(() => {
      if (op.delete !== undefined) {
        yText.delete(op.index, op.delete);
      }
      if (op.insert !== undefined) {
        yText.insert(op.index, op.insert);
      }
    });
  }

  /**
   * Soft-deletes a record by setting its `_deleted` flag.
   * @throws if the record is missing or already deleted.
   */
  remove(id: string): void {
    if (!hasRecord(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" does not exist in collection "${this.name}"`);
    }
    if (isDeleted(this.doc, this.name, id)) {
      throw new Error(`Record "${id}" is already deleted in collection "${this.name}"`);
    }

    this.doc.transact(() => {
      const valuesMap = this.doc.getMap<unknown>(valuesMapName(this.name));
      valuesMap.set(deletedKey(id), true);
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Reads all fields of a record into a plain object, with `id` as the first
   * property.  Assumes the record exists and is not deleted.
   */
  private readRecord(id: string): InferRecord<F> & { id: string } {
    const record: Record<string, unknown> = { id };

    for (const [fieldName, kind] of Object.entries(this.descriptor.fields)) {
      const typedKind = kind as ValueKind<unknown> | CounterKind | TextKind;

      if (typedKind.kind === 'value') {
        record[fieldName] = getValue(this.doc, this.name, id, fieldName);
      } else if (typedKind.kind === 'counter') {
        record[fieldName] = readCounter(this.doc, this.name, id, fieldName);
      } else if (typedKind.kind === 'text') {
        record[fieldName] = getOrCreateText(
          this.doc,
          this.name,
          id,
          fieldName,
        ).toString();
      }
    }

    return record as InferRecord<F> & { id: string };
  }
}
