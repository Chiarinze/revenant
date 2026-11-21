import type { FieldMap, AnyCollectionDescriptor } from './collection.js';

/** A record of collection descriptors keyed by collection name. */
export type CollectionMap = Record<string, AnyCollectionDescriptor>;

/** The typed schema object returned by `defineSchema`. */
export interface Schema<C extends CollectionMap> {
  readonly collections: C;
}

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

const FORBIDDEN_CHARS = /[:/]/;

function assertValidName(name: string, label: string): void {
  if (name.length === 0) {
    throw new Error(`${label} name must not be empty.`);
  }
  if (FORBIDDEN_CHARS.test(name)) {
    throw new Error(
      `${label} name "${name}" must not contain ":" or "/".`,
    );
  }
}

function assertValidFieldName(fieldName: string, collectionName: string): void {
  assertValidName(fieldName, `Field "${fieldName}" in collection "${collectionName}"`);
  if (fieldName.startsWith('_')) {
    throw new Error(
      `Field name "${fieldName}" in collection "${collectionName}" must not start with "_" (reserved for internal fields).`,
    );
  }
  if (fieldName === 'id') {
    throw new Error(
      `Field name "id" in collection "${collectionName}" is reserved.`,
    );
  }
}

// ---------------------------------------------------------------------------
// defineSchema
// ---------------------------------------------------------------------------

/**
 * Declares a schema composed of named collections.
 *
 * Validates names at runtime so internal Yjs map keys remain unambiguous.
 * Rules:
 * - Collection names must be non-empty and must not contain ":" or "/".
 * - Field names must be non-empty and must not contain ":" or "/".
 * - Field names must not start with "_".
 *
 * ```ts
 * const schema = defineSchema({
 *   products: collection(
 *     { name: value<string>(), unit: value<string>(), stock: counter(), notes: text() },
 *     { key: (p) => p.name },
 *   ),
 *   sales: collection({ productId: value<string>(), qty: value<number>() }),
 * });
 * ```
 */
export function defineSchema<C extends CollectionMap>(collections: C): Schema<C> {
  for (const [collectionName, descriptor] of Object.entries(collections)) {
    assertValidName(collectionName, 'Collection');

    for (const fieldName of Object.keys(descriptor.fields)) {
      assertValidFieldName(fieldName, collectionName);
    }
  }

  return { collections };
}
