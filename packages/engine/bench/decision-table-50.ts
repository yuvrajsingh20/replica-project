/**
 * Warm compiled 50-row decision table — prove P95 < 5ms.
 * Run: pnpm --filter @rule-engine/engine bench
 */
import { compileRule } from '../src/index.js';
import type { DecisionTableDef, InputSchema } from '@rule-engine/shared';

const schema: InputSchema = {
  attributes: [
    { name: 'amount', type: 'numeric', required: true },
    { name: 'region', type: 'string', required: true },
  ],
};

const rows: DecisionTableDef['rows'] = [];
for (let i = 0; i < 50; i++) {
  rows.push({
    id: `row_${i}`,
    priority: i,
    cells: {
      amount: { kind: 'const', value: i * 10 },
      region: i % 2 === 0 ? { kind: 'const', value: 'US' } : null,
    },
    results: {
      fee: {
        formula: {
          kind: 'binary',
          op: '*',
          left: { kind: 'attr', path: 'amount' },
          right: { kind: 'const', value: 0.01 * ((i % 5) + 1) },
        },
      },
    },
  });
}

const def: DecisionTableDef = {
  type: 'decision_table',
  hitPolicy: 'first',
  columns: [
    { id: 'amount', left: { kind: 'attr', path: 'amount' }, op: 'gte' },
    { id: 'region', left: { kind: 'attr', path: 'region' }, op: 'eq' },
  ],
  outputs: [{ id: 'fee', key: 'fee' }],
  rows,
};

const compiled = compileRule(def, schema);

// warmup
for (let i = 0; i < 1000; i++) {
  compiled.execute({ amount: 250, region: 'US' });
}

const samples: number[] = [];
const N = 5000;
for (let i = 0; i < N; i++) {
  const start = performance.now();
  compiled.execute({ amount: 250 + (i % 50), region: i % 2 === 0 ? 'US' : 'EU' });
  samples.push(performance.now() - start);
}

samples.sort((a, b) => a - b);
const p50 = samples[Math.floor(N * 0.5)]!;
const p95 = samples[Math.floor(N * 0.95)]!;
const p99 = samples[Math.floor(N * 0.99)]!;

console.log(
  JSON.stringify(
    {
      iterations: N,
      p50_ms: Number(p50.toFixed(4)),
      p95_ms: Number(p95.toFixed(4)),
      p99_ms: Number(p99.toFixed(4)),
      budget_p95_ms: 5,
      pass: p95 < 5,
    },
    null,
    2,
  ),
);

if (p95 >= 5) {
  process.exitCode = 1;
}
