import { describe, expect, it } from 'vitest';
import { compileRule, CompileError } from '../src/index.js';
import type { InputSchema, RuleDef } from '@rule-engine/shared';

const numericSchema: InputSchema = {
  attributes: [
    { name: 'n', type: 'numeric', required: true },
    { name: 's', type: 'string' },
    { name: 'flag', type: 'boolean' },
    { name: 'when', type: 'date' },
    { name: 'items', type: 'list' },
    { name: 'meta', type: 'json' },
  ],
};

function simple(
  op: string,
  right?: unknown,
  leftPath = 'n',
): RuleDef {
  const rightOperand =
    right === undefined
      ? undefined
      : Array.isArray(right)
        ? right.map((v) => ({ kind: 'const' as const, value: v }))
        : { kind: 'const' as const, value: right };

  return {
    type: 'simple',
    when: {
      logic: 'and',
      items: [
        {
          left: { kind: 'attr', path: leftPath },
          op: op as never,
          ...(rightOperand !== undefined ? { right: rightOperand as never } : {}),
        },
      ],
    },
    then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
  };
}

describe('coercion', () => {
  it('coerces numeric strings and rejects NaN', () => {
    const rule = compileRule(simple('eq', 10), numericSchema);
    expect(rule.execute({ n: '10' }).status).toBe('success');
    expect(rule.execute({ n: 'nope' }).status).toBe('error');
    expect(rule.execute({ n: Number.NaN }).status).toBe('error');
  });

  it('requires attributes and coerces dates', () => {
    const def: RuleDef = {
      type: 'simple',
      when: {
        logic: 'and',
        items: [
          {
            left: { kind: 'attr', path: 'when' },
            op: 'gte',
            right: { kind: 'const', value: '2020-01-01' },
          },
        ],
      },
      then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
    };
    const rule = compileRule(def, {
      attributes: [{ name: 'when', type: 'date', required: true }],
    });
    expect(rule.execute({}).status).toBe('error');
    const ok = rule.execute({ when: '2021-06-01' });
    expect(ok.status).toBe('success');
  });

  it('coerces boolean, list, datetime and rejects bad shapes', () => {
    const schema: InputSchema = {
      attributes: [
        { name: 'flag', type: 'boolean', required: true },
        { name: 'items', type: 'list', required: true },
        { name: 'at', type: 'datetime', required: true },
        { name: 'meta', type: 'json' },
      ],
    };
    const def: RuleDef = {
      type: 'simple',
      when: {
        logic: 'and',
        items: [
          { left: { kind: 'attr', path: 'flag' }, op: 'eq', right: { kind: 'const', value: true } },
          { left: { kind: 'attr', path: 'items' }, op: 'length_eq', right: { kind: 'const', value: 1 } },
        ],
      },
      then: [
        { kind: 'set', key: 'meta', value: { kind: 'attr', path: 'meta' } },
        { kind: 'set', key: 'at', value: { kind: 'attr', path: 'at' } },
      ],
    };
    const rule = compileRule(def, schema);
    expect(rule.execute({ flag: 'yes', items: [], at: '2020-01-01T00:00:00Z' }).status).toBe(
      'error',
    );
    expect(rule.execute({ flag: true, items: 'x', at: '2020-01-01T00:00:00Z' }).status).toBe(
      'error',
    );
    expect(rule.execute({ flag: true, items: [1], at: 'not-a-date' }).status).toBe('error');
    const ok = rule.execute({
      flag: true,
      items: [1],
      at: '2020-01-01T00:00:00.000Z',
      meta: { a: 1 },
    });
    expect(ok.status).toBe('success');
    expect(ok.output).toMatchObject({ meta: { a: 1 } });
    expect((ok.output as Record<string, unknown>).at).toBeInstanceOf(Date);
  });

  it('rejects non-object input and invalid Date instances', () => {
    const rule = compileRule(simple('eq', 1), numericSchema);
    expect(rule.execute(null).status).toBe('error');
    expect(rule.execute('x').status).toBe('error');

    const dateRule = compileRule(
      {
        type: 'simple',
        when: {
          logic: 'and',
          items: [{ left: { kind: 'attr', path: 'when' }, op: 'is_not_null' }],
        },
        then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
      },
      { attributes: [{ name: 'when', type: 'date', required: true }] },
    );
    expect(dateRule.execute({ when: new Date('not-a-date') }).status).toBe('error');
    expect(dateRule.execute({ when: new Date('2021-06-01') }).status).toBe('success');
    expect(dateRule.execute({ when: Date.parse('2021-06-01') }).status).toBe('success');
  });

  it('coerces string attrs and rejects wrong types', () => {
    const schema: InputSchema = {
      attributes: [{ name: 's', type: 'string', required: true }],
    };
    const def = simple('eq', 'hi', 's');
    const rule = compileRule(def, schema);
    expect(rule.execute({ s: 1 }).status).toBe('error');
    expect(rule.execute({ s: 'hi' }).matched).toEqual(['then']);
  });
});

describe('null semantics', () => {
  it('is_null / is_not_null work; other ops with null are false', () => {
    const schema: InputSchema = {
      attributes: [{ name: 'n', type: 'numeric' }],
    };
    const nullRule = compileRule(simple('is_null', undefined, 'n'), schema);
    expect(nullRule.execute({}).matched).toEqual(['then']);

    const gtRule = compileRule(simple('gt', 1, 'n'), schema);
    expect(gtRule.execute({ n: null }).status).toBe('no_match');

    const eqNull: RuleDef = {
      type: 'simple',
      when: {
        logic: 'and',
        items: [
          {
            left: { kind: 'attr', path: 'n' },
            op: 'eq',
            right: { kind: 'const', value: null },
          },
        ],
      },
      then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
    };
    expect(compileRule(eqNull, schema).execute({ n: null }).matched).toEqual(['then']);
  });

  it('global operands resolve to undefined', () => {
    const def: RuleDef = {
      type: 'simple',
      when: {
        logic: 'and',
        items: [{ left: { kind: 'global', name: 'x' }, op: 'is_null' }],
      },
      then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
    };
    expect(compileRule(def, { attributes: [] }).execute({}).matched).toEqual(['then']);
  });

  it('resolves globals from execute ctx; missing stays undefined', () => {
    const def: RuleDef = {
      type: 'simple',
      when: {
        logic: 'and',
        items: [
          {
            left: { kind: 'global', name: 'min_price_policy' },
            op: 'gte',
            right: { kind: 'const', value: 100 },
          },
        ],
      },
      then: [
        {
          kind: 'set',
          key: 'floor',
          value: { kind: 'global', name: 'min_price_policy' },
        },
      ],
    };
    const rule = compileRule(def, { attributes: [] });
    expect(rule.execute({}).status).toBe('no_match');
    expect(
      rule.execute({}, { globals: { min_price_policy: 18000 } }).output,
    ).toEqual({ floor: 18000 });
  });
});

describe('operators', () => {
  it('covers string and list operators', () => {
    const schema: InputSchema = {
      attributes: [
        { name: 's', type: 'string', required: true },
        { name: 'items', type: 'list', required: true },
      ],
    };

    const cases: Array<{ def: RuleDef; input: Record<string, unknown>; match: boolean }> = [
      { def: simple('contains', 'lo', 's'), input: { s: 'hello', items: [] }, match: true },
      { def: simple('not_contains', 'x', 's'), input: { s: 'hello', items: [] }, match: true },
      { def: simple('starts_with', 'he', 's'), input: { s: 'hello', items: [] }, match: true },
      { def: simple('ends_with', 'lo', 's'), input: { s: 'hello', items: [] }, match: true },
      { def: simple('matches', '^h.*o$', 's'), input: { s: 'hello', items: [] }, match: true },
      { def: simple('in', ['a', 'b'], 's'), input: { s: 'a', items: [] }, match: true },
      { def: simple('not_in', ['a'], 's'), input: { s: 'b', items: [] }, match: true },
      {
        def: simple('any_in', ['x', 'y'], 'items'),
        input: { s: '', items: ['y'] },
        match: true,
      },
      {
        def: simple('all_in', ['x', 'y'], 'items'),
        input: { s: '', items: ['x', 'y'] },
        match: true,
      },
      {
        def: simple('all_in', ['x'], 'items'),
        input: { s: '', items: ['x', 'z'] },
        match: false,
      },
      { def: simple('length_eq', 2, 'items'), input: { s: '', items: [1, 2] }, match: true },
      { def: simple('length_gt', 1, 's'), input: { s: 'ab', items: [] }, match: true },
      { def: simple('length_lt', 5, 's'), input: { s: 'ab', items: [] }, match: true },
      { def: simple('between', [1, 5], 's'), input: { s: '3', items: [] }, match: false },
    ];

    // between on numeric
    const between = compileRule(
      {
        type: 'simple',
        when: {
          logic: 'and',
          items: [
            {
              left: { kind: 'attr', path: 'n' },
              op: 'between',
              right: [
                { kind: 'const', value: 1 },
                { kind: 'const', value: 5 },
              ],
            },
          ],
        },
        then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
      },
      { attributes: [{ name: 'n', type: 'numeric', required: true }] },
    );
    expect(between.execute({ n: 3 }).matched).toEqual(['then']);
    expect(between.execute({ n: 9 }).status).toBe('no_match');

    for (const c of cases) {
      if (c.def.type !== 'simple') continue;
      // skip invalid between-on-string case used as control — handled above
      const op = c.def.when.items[0];
      if (op && 'op' in op && op.op === 'between') continue;
      const result = compileRule(c.def, schema).execute(c.input);
      expect(result.matched.includes('then')).toBe(c.match);
    }
  });

  it('neq and comparison ops', () => {
    const rule = compileRule(simple('neq', 1), numericSchema);
    expect(rule.execute({ n: 2 }).matched).toEqual(['then']);
    expect(rule.execute({ n: 1 }).status).toBe('no_match');

    expect(compileRule(simple('gt', 1), numericSchema).execute({ n: 2 }).matched).toEqual([
      'then',
    ]);
    expect(compileRule(simple('gte', 2), numericSchema).execute({ n: 2 }).matched).toEqual([
      'then',
    ]);
    expect(compileRule(simple('lt', 5), numericSchema).execute({ n: 2 }).matched).toEqual([
      'then',
    ]);
    expect(compileRule(simple('lte', 2), numericSchema).execute({ n: 2 }).matched).toEqual([
      'then',
    ]);
  });

  it('throws CompileError for invalid matches regex const', () => {
    try {
      compileRule(simple('matches', '(', 's'), {
        attributes: [{ name: 's', type: 'string', required: true }],
      });
      expect.unreachable('expected CompileError');
    } catch (err) {
      expect(err).toBeInstanceOf(CompileError);
      expect((err as CompileError).path).toContain('op');
    }
  });

  it('matches an attr-backed regex at execute time', () => {
    const def: RuleDef = {
      type: 'simple',
      when: {
        logic: 'and',
        items: [
          {
            left: { kind: 'attr', path: 's' },
            op: 'matches',
            right: { kind: 'attr', path: 's' },
          },
        ],
      },
      then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
    };
    const rule = compileRule(def, {
      attributes: [{ name: 's', type: 'string', required: true }],
    });
    expect(rule.execute({ s: 'hello' }).matched).toEqual(['then']);
  });

  it('in matches a scalar right operand', () => {
    const def: RuleDef = {
      type: 'simple',
      when: {
        logic: 'and',
        items: [
          {
            left: { kind: 'attr', path: 's' },
            op: 'in',
            right: { kind: 'const', value: 'a' },
          },
        ],
      },
      then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
    };
    const rule = compileRule(def, {
      attributes: [{ name: 's', type: 'string', required: true }],
    });
    expect(rule.execute({ s: 'a' }).matched).toEqual(['then']);
    expect(rule.execute({ s: 'b' }).status).toBe('no_match');
  });
});

describe('formula', () => {
  it('evaluates arithmetic and functions', () => {
    const def: RuleDef = {
      type: 'simple',
      when: { logic: 'and', items: [] },
      then: [
        {
          kind: 'formula',
          key: 'v',
          expr: {
            kind: 'call',
            name: 'max',
            args: [
              {
                kind: 'binary',
                op: '+',
                left: { kind: 'unary', op: '-', arg: { kind: 'const', value: 2 } },
                right: {
                  kind: 'call',
                  name: 'abs',
                  args: [{ kind: 'const', value: -3 }],
                },
              },
              {
                kind: 'binary',
                op: '%',
                left: {
                  kind: 'binary',
                  op: '/',
                  left: { kind: 'attr', path: 'n' },
                  right: { kind: 'const', value: 2 },
                },
                right: { kind: 'const', value: 4 },
              },
            ],
          },
        },
      ],
    };
    // empty and-group: every([]) === true
    const result = compileRule(def, numericSchema).execute({ n: 10 });
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ v: 1 }); // max((-2+3)=1, (10/2)%4=1) = 1
  });

  it('evaluates remaining arithmetic ops', () => {
    const def: RuleDef = {
      type: 'simple',
      when: { logic: 'and', items: [] },
      then: [
        {
          kind: 'formula',
          key: 'div',
          expr: {
            kind: 'binary',
            op: '/',
            left: { kind: 'const', value: 10 },
            right: { kind: 'const', value: 2 },
          },
        },
        {
          kind: 'formula',
          key: 'mod',
          expr: {
            kind: 'binary',
            op: '%',
            left: { kind: 'const', value: 10 },
            right: { kind: 'const', value: 3 },
          },
        },
        {
          kind: 'formula',
          key: 'minv',
          expr: {
            kind: 'call',
            name: 'min',
            args: [
              { kind: 'const', value: 3 },
              { kind: 'const', value: 1 },
            ],
          },
        },
        {
          kind: 'formula',
          key: 'fl',
          expr: {
            kind: 'call',
            name: 'floor',
            args: [{ kind: 'const', value: 3.9 }],
          },
        },
        {
          kind: 'formula',
          key: 'cl',
          expr: {
            kind: 'call',
            name: 'ceil',
            args: [{ kind: 'const', value: 3.1 }],
          },
        },
      ],
    };
    expect(compileRule(def, numericSchema).execute({ n: 1 }).output).toEqual({
      div: 5,
      mod: 1,
      minv: 1,
      fl: 3,
      cl: 4,
    });
  });
});

describe('output operand and template action', () => {
  it('reads earlier action output and renders template tokens', () => {
    const def: RuleDef = {
      type: 'simple',
      when: { logic: 'and', items: [] },
      then: [
        {
          kind: 'formula',
          key: 'discount',
          expr: {
            kind: 'binary',
            op: '*',
            left: { kind: 'attr', path: 'n' },
            right: { kind: 'const', value: 0.5 },
          },
        },
        {
          kind: 'formula',
          key: 'final_price',
          expr: {
            kind: 'call',
            name: 'max',
            args: [
              { kind: 'output', key: 'discount' },
              { kind: 'global', name: 'min_price_policy' },
            ],
          },
        },
        {
          kind: 'template',
          key: 'promo_message',
          text: 'n={{attr.n}} floor={{global.min_price_policy}} out={{output.final_price}} miss={{nope.x}}',
        },
      ],
    };
    const rule = compileRule(def, numericSchema);
    const result = rule.execute({ n: 10 }, { globals: { min_price_policy: 8 } });
    expect(result.output).toEqual({
      discount: 5,
      final_price: 8,
      promo_message: 'n=10 floor=8 out=8 miss=',
    });
    expect(result.meta.unknownTokens).toEqual(['nope.x']);
  });

  it('same rule yields different final_price for different globals snapshots', () => {
    const def: RuleDef = {
      type: 'decision_table',
      hitPolicy: 'first',
      columns: [
        { id: 'c_brand', left: { kind: 'attr', path: 'brand' }, op: 'eq' },
      ],
      outputs: [{ id: 'o_price', key: 'final_price' }],
      rows: [
        {
          id: 'chevy',
          cells: { c_brand: { kind: 'const', value: 'Chevrolet' } },
          actions: [
            {
              kind: 'formula',
              key: 'discount',
              expr: {
                kind: 'call',
                name: 'round',
                args: [
                  {
                    kind: 'binary',
                    op: '*',
                    left: { kind: 'attr', path: 'list_price' },
                    right: { kind: 'const', value: 0.88 },
                  },
                ],
              },
            },
            {
              kind: 'formula',
              key: 'final_price',
              expr: {
                kind: 'call',
                name: 'max',
                args: [
                  { kind: 'output', key: 'discount' },
                  { kind: 'global', name: 'min_price_policy' },
                ],
              },
            },
          ],
        },
      ],
    };
    const schema: InputSchema = {
      attributes: [
        { name: 'brand', type: 'string', required: true },
        { name: 'list_price', type: 'numeric', required: true },
      ],
    };
    const rule = compileRule(def, schema);
    const input = { brand: 'Chevrolet', list_price: 20000 };
    expect(rule.execute(input, { globals: { min_price_policy: 18000 } }).output).toEqual({
      final_price: 18000,
    });
    expect(rule.execute(input, { globals: { min_price_policy: 17000 } }).output).toEqual({
      final_price: 17600,
    });
  });
});

describe('path getters', () => {
  it('returns undefined for broken paths', () => {
    const def: RuleDef = {
      type: 'simple',
      when: {
        logic: 'and',
        items: [{ left: { kind: 'attr', path: 'a.b.c' }, op: 'is_null' }],
      },
      then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
    };
    const rule = compileRule(def, {
      attributes: [{ name: 'a', type: 'json' }],
    });
    expect(rule.execute({ a: null }).matched).toEqual(['then']);
    expect(rule.execute({ a: 1 }).matched).toEqual(['then']);
  });
});

describe('condition groups', () => {
  it('supports nested or/and', () => {
    const def: RuleDef = {
      type: 'simple',
      when: {
        logic: 'or',
        items: [
          {
            left: { kind: 'attr', path: 'n' },
            op: 'eq',
            right: { kind: 'const', value: 1 },
          },
          {
            logic: 'and',
            items: [
              {
                left: { kind: 'attr', path: 'n' },
                op: 'gt',
                right: { kind: 'const', value: 5 },
              },
              {
                left: { kind: 'attr', path: 'n' },
                op: 'lt',
                right: { kind: 'const', value: 10 },
              },
            ],
          },
        ],
      },
      then: [{ kind: 'set', key: 'ok', value: { kind: 'const', value: true } }],
    };
    const rule = compileRule(def, numericSchema);
    expect(rule.execute({ n: 1 }).matched).toEqual(['then']);
    expect(rule.execute({ n: 7 }).matched).toEqual(['then']);
    expect(rule.execute({ n: 3 }).status).toBe('no_match');
  });
});

describe('decision table defaultRow', () => {
  it('uses default when nothing matches', () => {
    const def: RuleDef = {
      type: 'decision_table',
      hitPolicy: 'first',
      columns: [{ id: 'c', left: { kind: 'attr', path: 'n' }, op: 'eq' }],
      outputs: [{ id: 'o', key: 'v' }],
      rows: [
        {
          id: 'one',
          cells: { c: { kind: 'const', value: 1 } },
          results: { o: { kind: 'const', value: 'one' } },
        },
      ],
      defaultRow: { o: { kind: 'const', value: 'fallback' } },
    };
    const rule = compileRule(def, numericSchema);
    expect(rule.execute({ n: 9 })).toMatchObject({
      status: 'success',
      matched: ['default'],
      output: { v: 'fallback' },
    });
  });
});

describe('decision table priority', () => {
  it('runs lower priority before declaration order', () => {
    const def: RuleDef = {
      type: 'decision_table',
      hitPolicy: 'first',
      columns: [{ id: 'c', left: { kind: 'attr', path: 'n' }, op: 'gte' }],
      outputs: [{ id: 'o', key: 'v' }],
      rows: [
        {
          id: 'declared_first',
          priority: 5,
          cells: { c: { kind: 'const', value: 0 } },
          results: { o: { kind: 'const', value: 'late' } },
        },
        {
          id: 'declared_second',
          priority: 1,
          cells: { c: { kind: 'const', value: 0 } },
          results: { o: { kind: 'const', value: 'early' } },
        },
      ],
    };
    const rule = compileRule(def, numericSchema);
    expect(rule.execute({ n: 1 })).toMatchObject({
      status: 'success',
      matched: ['declared_second'],
      output: { v: 'early' },
    });
  });
});

describe('execute never throws', () => {
  it('surfaces formula runtime errors in result', () => {
    const def: RuleDef = {
      type: 'simple',
      when: { logic: 'and', items: [] },
      then: [
        {
          kind: 'formula',
          key: 'v',
          expr: { kind: 'attr', path: 's' },
        },
      ],
    };
    const result = compileRule(def, numericSchema).execute({ n: 1, s: 'x' });
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('runtime_error');
  });
});
