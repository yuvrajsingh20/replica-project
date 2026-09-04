import { describe, expect, it } from 'vitest';
import { assertSafeDatabaseUrl } from '../src/db/env.js';
import { validateCompilableDefinition } from '../src/lib/validate-definition.js';

describe('DATABASE_URL safety', () => {
  it('allows localhost and _dev', () => {
    expect(() =>
      assertSafeDatabaseUrl('postgres://u:p@localhost:5432/x'),
    ).not.toThrow();
    expect(() =>
      assertSafeDatabaseUrl('postgres://u@/db?options=-csearch_path%3Drule_engine_dev'),
    ).not.toThrow();
  });

  it('hard-refuses production-looking URLs', () => {
    expect(() =>
      assertSafeDatabaseUrl('postgres://u:p@db.example.com:5432/prod'),
    ).toThrow(/REFUSING/);
  });
});

describe('definition persistence gate', () => {
  it('rejects definitions that cannot compile', () => {
    const result = validateCompilableDefinition(
      { type: 'simple', when: { logic: 'xor', items: [] }, then: [] },
      { attributes: [] },
    );
    expect(result.ok).toBe(false);
  });

  it('accepts compilable definitions', () => {
    const result = validateCompilableDefinition(
      {
        type: 'simple',
        when: { logic: 'and', items: [] },
        then: [{ kind: 'set', key: 'x', value: { kind: 'const', value: 1 } }],
      },
      { attributes: [] },
    );
    expect(result.ok).toBe(true);
  });
});
