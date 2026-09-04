import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InputSchema, RuleDef } from '@rule-engine/shared';
import { parseInputSchema, parseRuleDef } from '@rule-engine/shared';
import { describe, expect, it } from 'vitest';
import { compileRule } from '../src/index.js';

type FixtureCase = {
  input: unknown;
  globals?: Record<string, unknown>;
  expected: {
    status: string;
    matched: string[];
    output: unknown;
    meta?: { unknownTokens?: string[] };
  };
};

type Fixture = {
  name: string;
  schema: InputSchema;
  def: RuleDef;
  cases: FixtureCase[];
};

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixtures(): Fixture[] {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) as Fixture;
      return {
        ...raw,
        schema: parseInputSchema(raw.schema),
        def: parseRuleDef(raw.def),
      };
    });
}

describe('golden fixtures', () => {
  for (const fixture of loadFixtures()) {
    describe(fixture.name, () => {
      const compiled = compileRule(fixture.def, fixture.schema);
      for (const [i, c] of fixture.cases.entries()) {
        it(`case ${i}`, () => {
          const result = compiled.execute(
            c.input,
            c.globals !== undefined ? { globals: c.globals } : undefined,
          );
          expect(result.status).toBe(c.expected.status);
          expect(result.matched).toEqual(c.expected.matched);
          expect(result.output).toEqual(c.expected.output);
          expect(result.meta.latencyMs).toBeTypeOf('number');
          if (c.expected.meta?.unknownTokens) {
            expect(result.meta.unknownTokens).toEqual(c.expected.meta.unknownTokens);
          }
        });
      }
    });
  }
});
