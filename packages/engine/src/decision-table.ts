import type { DecisionTableDef, Operand, RowResult } from '@rule-engine/shared';
import { applyActions, compileActions, type CompiledAction } from './action.js';
import type { ExecEnv } from './env.js';
import { compileFormula } from './formula.js';
import { compileOperand, compileRight, type CompiledOperand } from './operand.js';
import { compileOperator, type CompiledPredicate } from './operators.js';

export type DecisionExecutor = (env: ExecEnv) => {
  status: 'success' | 'no_match';
  output: Record<string, unknown> | Record<string, unknown>[];
  matched: string[];
  evaluated: number;
};

type CompiledCell = null | CompiledOperand | CompiledOperand[];

type CompiledRow = {
  id: string;
  priority: number;
  order: number;
  predicates: CompiledPredicate[];
  apply: (env: ExecEnv) => Record<string, unknown>;
};

function compileRowResult(
  result: RowResult,
  path: string,
): (env: ExecEnv) => unknown {
  if ('formula' in result) {
    const fn = compileFormula(result.formula, `${path}.formula`);
    return (env) => fn(env);
  }
  const op = compileOperand(result, path);
  return (env) => op(env);
}

function projectKeys(
  full: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(full, key)) {
      out[key] = full[key];
    }
  }
  return out;
}

export function compileDecisionTable(def: DecisionTableDef): DecisionExecutor {
  const outputById = new Map(def.outputs.map((o) => [o.id, o.key]));
  const outputKeys = new Set(def.outputs.map((o) => o.key));

  const columns = def.columns.map((col, i) => {
    const left = compileOperand(col.left, `columns.${i}.left`);
    return { id: col.id, left, op: col.op, index: i };
  });

  const rows: CompiledRow[] = def.rows.map((row, ri) => {
    const predicates: CompiledPredicate[] = [];
    for (const col of columns) {
      const cellRaw = row.cells[col.id];
      const cell: CompiledCell =
        cellRaw === undefined || cellRaw === null
          ? null
          : Array.isArray(cellRaw)
            ? compileRight(cellRaw as Operand[], `rows.${ri}.cells.${col.id}`)!
            : compileOperand(cellRaw as Operand, `rows.${ri}.cells.${col.id}`);

      if (cell === null) {
        predicates.push(() => true);
        continue;
      }
      predicates.push(
        compileOperator(
          col.op,
          col.left,
          cell,
          `rows.${ri}.cells.${col.id}`,
          cellRaw === undefined || cellRaw === null ? undefined : (cellRaw as Operand | Operand[]),
        ),
      );
    }

    let apply: CompiledRow['apply'];
    if (row.actions) {
      const actions: CompiledAction[] = compileActions(row.actions, `rows.${ri}.actions`);
      apply = (env) => {
        env.output = {};
        applyActions(actions, env);
        return projectKeys(env.output, outputKeys);
      };
    } else {
      const results: Array<{ key: string; resolve: (env: ExecEnv) => unknown }> = [];
      for (const [outId, value] of Object.entries(row.results ?? {})) {
        const key = outputById.get(outId);
        if (!key) continue;
        results.push({
          key,
          resolve: compileRowResult(value, `rows.${ri}.results.${outId}`),
        });
      }
      apply = (env) => {
        const o: Record<string, unknown> = {};
        env.output = o;
        for (const r of results) {
          o[r.key] = r.resolve(env);
        }
        return o;
      };
    }

    return {
      id: row.id,
      priority: row.priority ?? ri,
      order: ri,
      predicates,
      apply,
    };
  });

  rows.sort((a, b) => a.priority - b.priority || a.order - b.order);

  const defaultResolvers: Array<{ key: string; resolve: CompiledOperand }> = [];
  if (def.defaultRow) {
    for (const [outId, operand] of Object.entries(def.defaultRow)) {
      const key = outputById.get(outId);
      if (!key) continue;
      defaultResolvers.push({
        key,
        resolve: compileOperand(operand, `defaultRow.${outId}`),
      });
    }
  }

  const hitPolicy = def.hitPolicy;

  return (env) => {
    let evaluated = 0;
    const matchedIds: string[] = [];
    const matchingRows: CompiledRow[] = [];

    for (const row of rows) {
      evaluated += 1;
      const ok = row.predicates.every((p) => p(env));
      if (!ok) continue;
      matchedIds.push(row.id);
      matchingRows.push(row);
      if (hitPolicy === 'first') break;
    }

    if (matchingRows.length === 0) {
      if (defaultResolvers.length > 0) {
        const output: Record<string, unknown> = {};
        env.output = output;
        for (const r of defaultResolvers) {
          output[r.key] = r.resolve(env);
        }
        return { status: 'success', output, matched: ['default'], evaluated };
      }
      return { status: 'no_match', output: {}, matched: [], evaluated };
    }

    if (hitPolicy === 'collect') {
      const output = matchingRows.map((row) => row.apply(env));
      return { status: 'success', output, matched: matchedIds, evaluated };
    }

    // first | all — merge into one object; for all, later rows override
    const output: Record<string, unknown> = {};
    for (const row of matchingRows) {
      Object.assign(output, row.apply(env));
    }
    return { status: 'success', output, matched: matchedIds, evaluated };
  };
}
