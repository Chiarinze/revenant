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
   * Becomes `true` asynchronously once the browser grants the request.
   *
   * Requirements: 2.1
   */
  readonly persisted: boolean;

  /**
   * Returns a Uint8Array containing the full Yjs state of the doc,
   * suitable for sending to another copy or persisting externally.
   *
   * Requirements: 5.5
   */
  encodeState(): Uint8Array;

  /**
   * Applies a Yjs update (produced by `encodeState` or by the sync layer)
   * to the local doc. This triggers the update listener, so subscribers
   * are notified.
   *
   * The optional `origin` is passed through to Yjs so the sync layer can
   * identify its own echoed updates and discard them.
   *
   * Requirements: 5.5
   */
  applyUpdate(update: Uint8Array, origin?: unknown): void;

  /**
   * Destroys the IndexedDB provider and the Y.Doc, releasing all resources.
   *
   * Requirements: 2.4
   */
  close(): Promise<void>;
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
 * - Calls `navigator.storage.persist()` as a best-effort request in the
 *   background (never awaited on the main path, so Firefox's permission
 *   prompt never blocks openSpace). `space.persisted` is a getter that
 *   returns `true` once granted and notifies subscribers when it changes.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 5.5
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
  // After probing, delete the probe database so it doesn't accumulate.
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
        // Delete the probe database to avoid leaving it behind.
        try {
          indexedDB.deleteDatabase('__revenant_probe__');
        } catch {
          // Best effort — ignore deletion errors.
        }
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

  // --- Best-effort durable storage request (non-blocking) ---
  // We deliberately do NOT await this. Firefox may show a prompt, and we
  // must not block openSpace on user interaction. `persistedFlag` is updated
  // in the background; the getter below reflects it once it resolves.
  let persistedFlag = false;

  // Closed flag — set to true in close(); guards every public method.
  let closed = false;

  // Snapshot state: stale=true initially so the first call always builds.
  // Declared here (before the persist IIFE) so the IIFE can set stale=true.
  let stale = true;
  let cachedSnapshot: Snapshot<C> | null = null;

  void (async () => {
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.storage != null &&
        typeof navigator.storage.persist === 'function'
      ) {
        const granted = await navigator.storage.persist();
        // If the space was closed while we waited, do nothing.
        if (closed) return;
        if (granted && !persistedFlag) {
          persistedFlag = true;
          // Mark snapshot stale so useSyncExternalStore re-renders.
          stale = true;
          // Notify subscribers so UI can react to the granted state.
          notifySubscribers();
        }
      }
    } catch {
      // Ignore — best effort only.
    }
  })();

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

  function notifySubscribers(): void {
    for (const cb of subscribers) {
      try {
        cb();
      } catch (err) {
        // Report the error but don't let it break the notification loop.
        console.error('openSpace: subscriber threw an error', err);
      }
    }
  }

  // Listen to every update on the doc (local writes AND applyUpdate).
  doc.on('update', () => {
    stale = true;
    notifySubscribers();
  });

  // ---------------------------------------------------------------------------
  // Space implementation
  // ---------------------------------------------------------------------------

  const space: Space<C> = {
    get persisted(): boolean {
      return persistedFlag;
    },

    collection<K extends keyof C & string>(name: K): CollectionHandles<C>[K] {
      if (closed) throw new Error('space is closed');
      const handle = (handles as Record<string, CollectionHandle<FieldMap>>)[name];
      if (handle === undefined) {
        throw new Error(`Collection "${name}" is not declared in this schema`);
      }
      return handle as CollectionHandles<C>[K];
    },

    subscribe(cb: SubscribeCallback): () => void {
      if (closed) throw new Error('space is closed');
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    getSnapshot(): Snapshot<C> {
      if (closed) throw new Error('space is closed');
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

    encodeState(): Uint8Array {
      if (closed) throw new Error('space is closed');
      return Y.encodeStateAsUpdate(doc);
    },

    applyUpdate(update: Uint8Array, origin?: unknown): void {
      if (closed) throw new Error('space is closed');
      Y.applyUpdate(doc, update, origin);
      // The doc's 'update' listener fires automatically, so subscribers
      // are notified and the snapshot is marked stale.
    },

    async close(): Promise<void> {
      // Idempotent — subsequent calls are a no-op.
      if (closed) return;
      closed = true;
      await provider.destroy();
      doc.destroy();
      // Clear all subscribers so no callbacks fire after close.
      subscribers.clear();
    },
  };

  return space;
}
