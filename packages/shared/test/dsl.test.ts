import { ZodError } from 'zod';
import { parseInputSchema, parseRuleDef, ruleDefSchema } from '../src/dsl.js';
import { describe, expect, it } from 'vitest';

const validSimple: unknown = {
  type: 'simple',
  when: {
    logic: 'and',
    items: [
      {
        left: { kind: 'attr', path: 'order.total' },
        op: 'gte',
        right: { kind: 'const', value: 100 },
      },
    ],
  },
  then: [{ kind: 'set', key: 'tier', value: { kind: 'const', value: 'gold' } }],
  else: [{ kind: 'set', key: 'tier', value: { kind: 'const', value: 'silver' } }],
};

const validTable: unknown = {
  type: 'decision_table',
  hitPolicy: 'first',
  columns: [{ id: 'amount', left: { kind: 'attr', path: 'amount' }, op: 'gte' }],
  outputs: [{ id: 'fee', key: 'fee' }],
  rows: [
    {
      id: 'high',
      priority: 0,
      cells: { amount: { kind: 'const', value: 1000 } },
      results: {
        fee: {
          formula: {
            kind: 'binary',
            op: '*',
            left: { kind: 'attr', path: 'amount' },
            right: { kind: 'const', value: 0.02 },
          },
        },
      },
    },
    {
      id: 'any',
      cells: { amount: null },
      results: { fee: { kind: 'const', value: 5 } },
    },
  ],
  defaultRow: { fee: { kind: 'const', value: 0 } },
};

describe('parseRuleDef', () => {
  it('parses a valid simple rule', () => {
    const def = parseRuleDef(validSimple);
    expect(def.type).toBe('simple');
  });

  it('parses a valid decision table', () => {
    const def = parseRuleDef(validTable);
    expect(def.type).toBe('decision_table');
  });

  it('fails an invalid DSL with a Zod path', () => {
    const result = ruleDefSchema.safeParse({
      type: 'simple',
      when: { logic: 'xor', items: [] },
      then: [],
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues[0];
    expect(issue?.path).toEqual(['when', 'logic']);
    expect(issue?.message).toMatch(/and/i);
  });

  it('throws ZodError from parseRuleDef on invalid input', () => {
    expect(() => parseRuleDef({ type: 'nope' })).toThrow(ZodError);
  });
});

describe('parseInputSchema', () => {
  it('rejects duplicate attribute names with a path', () => {
    try {
      parseInputSchema({
        attributes: [
          { name: 'total', type: 'numeric' },
          { name: 'total', type: 'string' },
        ],
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const issue = (err as ZodError).issues[0];
      expect(issue?.path).toEqual(['attributes', 1, 'name']);
    }
  });
});
