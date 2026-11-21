/**
 * Field-kind descriptors.
 *
 * Each factory returns a plain object with a `kind` discriminant so TypeScript
 * can narrow the type at the call-site. The `_type` phantom on `ValueKind<T>`
 * holds no runtime value; it exists only to carry `T` through inference.
 */

export interface ValueKind<T> {
  readonly kind: 'value';
  /** Phantom property — always `undefined` at runtime. */
  readonly _type: T;
}

export interface CounterKind {
  readonly kind: 'counter';
}

export interface TextKind {
  readonly kind: 'text';
}

export type FieldKind = ValueKind<unknown> | CounterKind | TextKind;

/**
 * Declares a single-value field that holds a value of type `T`.
 * Concurrent edits are resolved by Yjs's fixed client-ID rule — the edit from
 * the copy with the higher client ID wins, never by clock time.
 */
export function value<T>(): ValueKind<T> {
  return { kind: 'value', _type: undefined as unknown as T };
}

/**
 * Declares a counter field. Increments and decrements from every copy are all
 * summed; no edit is lost. The value is always derived, never stored directly.
 */
export function counter(): CounterKind {
  return { kind: 'counter' };
}

/**
 * Declares a collaborative-text field backed by a Y.Text. Concurrent inserts
 * and deletes from every copy are all kept.
 */
export function text(): TextKind {
  return { kind: 'text' };
}
