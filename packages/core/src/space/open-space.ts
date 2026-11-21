import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

import type { Schema, CollectionMap } from '../schema/define-schema.js';
import type { FieldMap, CollectionDescriptor, InferRecord } from '../schema/collection.js';
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
 * Snapshot shape: for each collection name, an array of plain typed records
 * (the same shape that `collection.all()` returns, including the `id` field).
 */
export type Snapshot<C extends CollectionMap> = {
  [K in keyof C]: C[K] extends CollectionDescriptor<infer F>
    ? (InferRecord<F> & { id: string })[]
    : never;
};

/** Callback registered via `space.subscribe`. */
export type SubscribeCallback = () => void;

/**
 * Public handle for one open space.
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

  /**
   * Registers a callback that fires whenever the underlying Y.Doc changes,
   * whether from a local write or a merged `applyUpdate`.
   *
   * Returns an unsubscribe function.
   *
   * Requirements: 4.1
   */
  subscribe(cb: SubscribeCallback): () => void;

  /**
   * Returns a stable snapshot of all collections as plain objects.
   *
   * The same object reference is returned on successive calls until the
   * underlying Y.Doc changes, making this safe to pass to React's
   * `useSyncExternalStore`.
   *
   * Requirements: 4.3
   */
  getSnapshot(): Snapshot<C>;

  /**
   * Whether the browser granted durable storage for this origin.
   * Always `false` in environments where `navigator.storage.persist` is absent.
   *
   * Requirements: 2.1
   */
  readonly persisted: boolean;
}

// ---------------------------------------------------------------------------
// openSpace
// ---------------------------------------------------------------------------

/**
 * Opens a space backed by IndexedDB.
 *
 * - Rejects an empty `id` synchronously.
 * - Creates a fresh `Y.Doc`.
 * - Names the IndexedDB database `revenant:<id>`.
 * - Attaches an `IndexeddbPersistence` provider.
 * - Races `provider.whenSynced` against an IndexedDB-availability check
 *   so the promise never hangs when IndexedDB is unavailable.
 * - Builds one `CollectionHandle` per collection declared in the schema.
 * - Calls `navigator.storage.persist()` as a best-effort request; exposes
 *   the result as `space.persisted`.
 *
 * Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3
 */
export async function openSpace<C extends CollectionMap>({
  id,
  schema,
}: {
  id: string;
  schema: Schema<C>;
}): Promise<Space<C>> {
  // --- Validate id ---
  if (id.length === 0) {
    throw new Error('openSpace: id must not be empty');
  }

  // --- Check IndexedDB availability before even creating the provider ---
  if (typeof indexedDB === 'undefined' || indexedDB === null) {
    throw new Error(
      'openSpace: IndexedDB is not available in this environment',
    );
  }

  // --- Probe IndexedDB with a quick open to surface quota/policy blocks ---
  await new Promise<void>((resolve, reject) => {
    try {
      const req = indexedDB.open('__revenant_probe__');
      req.onerror = () =>
        reject(
          new Error(
            'openSpace: IndexedDB is unavailable or access was denied',
          ),
        );
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      // The first open may trigger onupgradeneeded before onsuccess.
      req.onupgradeneeded = () => {
        // Nothing to set up — just let it complete so onsuccess fires.
      };
    } catch (e) {
      reject(
        new Error(
          `openSpace: IndexedDB is unavailable or access was denied (${String(e)})`,
        ),
      );
    }
  });

  const doc = new Y.Doc();

  // Name the database with the revenant: prefix.
  const dbName = `revenant:${id}`;
  const provider = new IndexeddbPersistence(dbName, doc);

  // Wait until all locally-persisted updates have been applied to the doc.
  await provider.whenSynced;

  // --- Best-effort durable storage request ---
  let persisted = false;
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage != null &&
      typeof navigator.storage.persist === 'function'
    ) {
      persisted = await navigator.storage.persist();
    }
  } catch {
    // Ignore — best effort only.
  }

  // --- Build one CollectionHandle per collection ---
  const handles = {} as CollectionHandles<C>;
  for (const [name, descriptor] of Object.entries(schema.collections) as [
    keyof C & string,
    CollectionDescriptor<FieldMap>,
  ][]) {
    (handles as Record<string, CollectionHandle<FieldMap>>)[name] =
      new CollectionHandle(name, descriptor, doc);
  }

  // --- Subscription state ---
  const subscribers = new Set<SubscribeCallback>();

  // Snapshot state: stale=true initially so the first call always builds.
  let stale = true;
  let cachedSnapshot: Snapshot<C> | null = null;

  // Listen to every update on the doc (local writes AND applyUpdate).
  doc.on('update', () => {
    stale = true;
    for (const cb of subscribers) {
      try {
        cb();
      } catch {
        // Never let a subscriber crash the notification loop.
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Space implementation
  // ---------------------------------------------------------------------------

  const space: Space<C> = {
    persisted,

    collection<K extends keyof C & string>(name: K): CollectionHandles<C>[K] {
      const handle = (handles as Record<string, CollectionHandle<FieldMap>>)[name];
      if (handle === undefined) {
        throw new Error(`Collection "${name}" is not declared in this schema`);
      }
      return handle as CollectionHandles<C>[K];
    },

    subscribe(cb: SubscribeCallback): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    getSnapshot(): Snapshot<C> {
      if (!stale && cachedSnapshot !== null) {
        return cachedSnapshot;
      }

      const snap = {} as Snapshot<C>;
      for (const name of Object.keys(schema.collections) as (keyof C & string)[]) {
        const handle = (handles as Record<string, CollectionHandle<FieldMap> | undefined>)[name];
        // handle is always defined here: we iterate over schema.collections keys,
        // and we built handles for every one of those keys above.
        if (handle !== undefined) {
          (snap as Record<string, unknown[]>)[name] = handle.all();
        }
      }

      cachedSnapshot = snap;
      stale = false;
      return cachedSnapshot;
    },
  };

  return space;
}
