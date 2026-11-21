import { describe, it, expect } from 'vitest';
import { value, counter, text } from './kinds.js';
import { collection } from './collection.js';
import { defineSchema } from './define-schema.js';

// ---------------------------------------------------------------------------
// kinds
// ---------------------------------------------------------------------------

describe('value()', () => {
  it('has kind "value"', () => {
    expect(value<string>().kind).toBe('value');
  });

  it('_type is undefined at runtime', () => {
    // The phantom property carries no runtime cost.
    expect(value<string>()._type).toBeUndefined();
  });
});

describe('counter()', () => {
  it('has kind "counter"', () => {
    expect(counter().kind).toBe('counter');
  });
});

describe('text()', () => {
  it('has kind "text"', () => {
    expect(text().kind).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// collection
// ---------------------------------------------------------------------------

describe('collection()', () => {
  it('stores fields verbatim', () => {
    const name = value<string>();
    const stock = counter();
    const notes = text();
    const c = collection({ name, stock, notes });
    expect(c.fields.name).toBe(name);
    expect(c.fields.stock).toBe(stock);
    expect(c.fields.notes).toBe(notes);
  });

  it('key is undefined when no options are passed', () => {
    const c = collection({ name: value<string>() });
    expect(c.key).toBeUndefined();
  });

  it('stores the key extractor', () => {
    const keyFn = (r: { name: string }) => r.name;
    const c = collection({ name: value<string>() }, { key: keyFn });
    expect(c.key).toBe(keyFn);
  });
});

// ---------------------------------------------------------------------------
// defineSchema — valid schemas
// ---------------------------------------------------------------------------

describe('defineSchema()', () => {
  it('returns collections unchanged', () => {
    const products = collection({ name: value<string>(), stock: counter() });
    const schema = defineSchema({ products });
    expect(schema.collections.products).toBe(products);
  });

  it('accepts multiple collections', () => {
    const schema = defineSchema({
      products: collection({ name: value<string>() }),
      sales: collection({ qty: value<number>() }),
    });
    expect(Object.keys(schema.collections)).toEqual(['products', 'sales']);
  });

  it('accepts the full design-document example', () => {
    expect(() =>
      defineSchema({
        products: collection(
          { name: value<string>(), unit: value<string>(), stock: counter(), notes: text() },
          { key: (p) => p.name },
        ),
        sales: collection({ productId: value<string>(), qty: value<number>() }),
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// defineSchema — invalid names
// ---------------------------------------------------------------------------

describe('defineSchema() — name validation', () => {
  it('throws when a collection name is empty', () => {
    expect(() => defineSchema({ '': collection({ name: value<string>() }) })).toThrow(
      /must not be empty/,
    );
  });

  it('throws when a collection name contains ":"', () => {
    expect(() =>
      defineSchema({ 'bad:name': collection({ name: value<string>() }) }),
    ).toThrow(/must not contain/);
  });

  it('throws when a collection name contains "/"', () => {
    expect(() =>
      defineSchema({ 'bad/name': collection({ name: value<string>() }) }),
    ).toThrow(/must not contain/);
  });

  it('throws when a field name is empty', () => {
    expect(() =>
      defineSchema({ products: collection({ '': value<string>() }) }),
    ).toThrow(/must not be empty/);
  });

  it('throws when a field name contains ":"', () => {
    expect(() =>
      defineSchema({ products: collection({ 'bad:field': value<string>() }) }),
    ).toThrow(/must not contain/);
  });

  it('throws when a field name contains "/"', () => {
    expect(() =>
      defineSchema({ products: collection({ 'bad/field': value<string>() }) }),
    ).toThrow(/must not contain/);
  });

  it('throws when a field name starts with "_"', () => {
    expect(() =>
      defineSchema({ products: collection({ _deleted: value<boolean>() }) }),
    ).toThrow(/must not start with "_"/);
  });

  it('throws when a field is named "id"', () => {
    expect(() =>
      defineSchema({
        items: collection({ id: value<string>() }),
      }),
    ).toThrow(/"id".*reserved/i);
  });

  it('error message includes the offending name', () => {
    let err: Error | undefined;
    try {
      defineSchema({ 'bad:col': collection({ name: value<string>() }) });
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toContain('bad:col');
  });
});

// ---------------------------------------------------------------------------
// TypeScript inference smoke-test (compile-time only, runs fine at runtime)
// ---------------------------------------------------------------------------

describe('InferRecord type inference', () => {
  it('key extractor receives correctly-typed fields', () => {
    // If inference is broken this file won't compile.
    // key receives only ValueFields — counter and text fields are excluded.
    defineSchema({
      items: collection(
        { label: value<string>(), count: counter(), note: text() },
        {
          key: (r) => {
            // r.label is the only value field → string
            const _l: string = r.label;
            void _l;
            return r.label;
          },
        },
      ),
    });
    expect(true).toBe(true);
  });
});
