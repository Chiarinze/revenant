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
  update(_id: string, _patch: Partial<InferRecord<ValueFields<F>>>): void {
    throw new Error('not implemented');
  }

  /**
   * Increments a `counter` field by `amount`.
   * @throws if the field is not a counter, or if the record is missing/deleted.
   */
  increment(_id: string, _field: keyof F & string, _amount: number): void {
    throw new Error('not implemented');
  }

  /**
   * Decrements a `counter` field by `amount`.
   * @throws if the field is not a counter, or if the record is missing/deleted.
   */
  decrement(_id: string, _field: keyof F & string, _amount: number): void {
    throw new Error('not implemented');
  }

  /**
   * Applies an insert or delete to a `text` field.
   * @throws if the field is not a text field, or if the record is missing/deleted.
   */
  editText(
    _id: string,
    _field: keyof F & string,
    _op: { index: number; insert?: string; delete?: number },
  ): void {
    throw new Error('not implemented');
  }

  /**
   * Soft-deletes a record by setting its `_deleted` flag.
   * @throws if the record is missing or already deleted.
   */
  remove(_id: string): void {
    throw new Error('not implemented');
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
