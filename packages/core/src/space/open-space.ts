import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

import type { Schema, CollectionMap } from '../schema/define-schema.js';
import type { FieldMap, CollectionDescriptor } from '../schema/collection.js';
import { CollectionHandle } from '../store/collection.js';

// ---------------------------------------------------------------------------
// Space type
// ---------------------------------------------------------------------------

/**
 * Maps a `CollectionMap` to its handle type: for each collection name `K`,
 * `CollectionHandles<C>[K]` is `CollectionHandle<F>` where `F` is the
 * FieldMap declared for that collection.
 */
type CollectionHandles<C extends CollectionMap> = {
  [K in keyof C]: C[K] extends CollectionDescriptor<infer F>
    ? CollectionHandle<F>
    : never;
};

/**
 * Public handle for one open space.
 *
 * Tasks 6.2 and 6.3 will add subscribe, getSnapshot, encodeState,
 * applyUpdate, and close to both this interface and the implementation.
 */
export interface Space<C extends CollectionMap> {
  /**
   * Returns the typed `CollectionHandle` for the named collection.
   * TypeScript narrows the return type from the schema, so wrong names
   * fail to compile.
   */
  collection<K extends keyof C & string>(
    name: K,
  ): CollectionHandles<C>[K];
}

// ---------------------------------------------------------------------------
// openSpace
// ---------------------------------------------------------------------------

/**
 * Opens a space backed by IndexedDB.
 *
 * - Creates a fresh `Y.Doc`.
 * - Attaches an `IndexeddbPersistence` provider keyed by `id`.
 * - Awaits `provider.whenSynced` so the doc is fully loaded from IndexedDB
 *   before the promise resolves.
 * - Builds one `CollectionHandle` per collection declared in the schema.
 *
 * The space works fully offline: the y-indexeddb provider reads from and
 * writes to the local device without any network access.
 *
 * Requirements: 2.1, 2.2, 2.3
 */
export async function openSpace<C extends CollectionMap>({
  id,
  schema,
}: {
  id: string;
  schema: Schema<C>;
}): Promise<Space<C>> {
  const doc = new Y.Doc();
  const provider = new IndexeddbPersistence(id, doc);

  // Wait until all locally-persisted updates have been applied to the doc.
  await provider.whenSynced;

  // Build one CollectionHandle per collection and store in a typed map.
  const handles = {} as CollectionHandles<C>;
  for (const [name, descriptor] of Object.entries(schema.collections) as [
    keyof C & string,
    CollectionDescriptor<FieldMap>,
  ][]) {
    // The cast is safe: `C[K]` extends `CollectionDescriptor<F>` for the
    // concrete `F` belonging to that key, which is exactly what we pass in.
    (handles as Record<string, CollectionHandle<FieldMap>>)[name] =
      new CollectionHandle(name, descriptor, doc);
  }

  return {
    collection<K extends keyof C & string>(name: K): CollectionHandles<C>[K] {
      const handle = (handles as Record<string, CollectionHandle<FieldMap>>)[name];
      if (handle === undefined) {
        throw new Error(`Collection "${name}" is not declared in this schema`);
      }
      return handle as CollectionHandles<C>[K];
    },
  };
}
