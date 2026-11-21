import type { FieldKind, ValueKind, CounterKind, TextKind } from './kinds.js';

/** A record of field-kind descriptors, e.g. `{ name: value<string>(), stock: counter() }`. */
export type FieldMap = Record<string, FieldKind>;

/**
 * Keeps only the `ValueKind` fields from a `FieldMap`.
 * Used to constrain the key-extractor parameter to value fields only,
 * because counter and text fields are derived and have no stable key identity.
 */
export type ValueFields<F extends FieldMap> = {
  [K in keyof F as F[K] extends ValueKind<unknown> ? K : never]: F[K];
};

/**
 * Map a `FieldMap` to its runtime record shape:
 *   - `ValueKind<T>`  → `T`
 *   - `CounterKind`   → `number`
 *   - `TextKind`      → `string`
 */
export type InferRecord<F extends FieldMap> = {
  [K in keyof F]: F[K] extends ValueKind<infer T>
    ? T
    : F[K] extends CounterKind
      ? number
      : F[K] extends TextKind
        ? string
        : never;
};

/** Typed descriptor returned by `collection()`. */
export interface CollectionDescriptor<F extends FieldMap> {
  readonly fields: F;
  /** Optional function that extracts the natural key from a record's value fields. */
  readonly key?: (record: InferRecord<ValueFields<F>>) => string;
}

/**
 * Escape-hatch interface for use in `CollectionMap` and other places that
 * need to hold any `CollectionDescriptor` regardless of its concrete `F`.
 *
 * The `key` parameter is typed as `never` so that every concrete
 * `CollectionDescriptor<F>` is assignable here (contravariance: a function
 * that accepts `never` accepts any argument type).
 */
export interface AnyCollectionDescriptor {
  readonly fields: FieldMap;
  readonly key?: (record: never) => string;
}

export interface CollectionOptions<F extends FieldMap> {
  /**
   * Natural-key extractor. When provided, `create` with a record whose key
   * matches an existing record returns the existing ID instead of a new one.
   * Only value fields are available; counters and text fields are excluded.
   */
  key?: (record: InferRecord<ValueFields<F>>) => string;
}

/**
 * Declares a collection with the given field descriptors and optional options.
 *
 * ```ts
 * collection(
 *   { name: value<string>(), stock: counter() },
 *   { key: (p) => p.name },
 * )
 * ```
 */
export function collection<F extends FieldMap>(
  fields: F,
  options?: CollectionOptions<F>,
): CollectionDescriptor<F> {
  if (options?.key !== undefined) {
    return { fields, key: options.key };
  }
  return { fields };
}
