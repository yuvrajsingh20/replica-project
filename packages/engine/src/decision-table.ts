import type { DecisionTableDef, Operand, RowResult } from '@rule-engine/shared';
import { compileFormula } from './formula.js';
import { compileOperand, compileRight, type CompiledOperand } from './operand.js';
import { compileOperator, type CompiledPredicate } from './operators.js';

export type DecisionExecutor = (input: Record<string, unknown>) => {
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
  results: Array<{ key: string; resolve: (input: Record<string, unknown>) => unknown }>;
};

function compileRowResult(
  result: RowResult,
  path: string,
): (input: Record<string, unknown>) => unknown {
  if ('formula' in result) {
    const fn = compileFormula(result.formula, `${path}.formula`);
    return (input) => fn(input);
  }
  const op = compileOperand(result, path);
  return (input) => op(input);
}

export function compileDecisionTable(def: DecisionTableDef): DecisionExecutor {
  const outputById = new Map(def.outputs.map((o) => [o.id, o.key]));

  const columns = def.columns.map((col, i) => {
    const left = compileOperand(col.left, `columns.${i}.left`);
    return { id: col.id, left, op: col.op, index: i };
  });

  const rows: CompiledRow[] = def.rows.map((row, ri) => {
    const predicates: CompiledPredicate[] = [];
    for (const col of columns) {
      const cell: CompiledCell =
        row.cells[col.id] === undefined
          ? null
          : row.cells[col.id] === null
            ? null
            : Array.isArray(row.cells[col.id])
              ? compileRight(row.cells[col.id] as Operand[], `rows.${ri}.cells.${col.id}`)!
              : compileOperand(row.cells[col.id] as Operand, `rows.${ri}.cells.${col.id}`);

      if (cell === null) {
        predicates.push(() => true);
        continue;
      }
      predicates.push(
        compileOperator(col.op, col.left, cell, `rows.${ri}.cells.${col.id}`),
      );
    }

    const results: CompiledRow['results'] = [];
    for (const [outId, value] of Object.entries(row.results)) {
      const key = outputById.get(outId);
      if (!key) continue;
      results.push({
        key,
        resolve: compileRowResult(value, `rows.${ri}.results.${outId}`),
      });
    }

    return {
      id: row.id,
      priority: row.priority ?? ri,
      order: ri,
      predicates,
      results,
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

  return (input) => {
    let evaluated = 0;
    const matchedIds: string[] = [];
    const matchingRows: CompiledRow[] = [];

    for (const row of rows) {
      evaluated += 1;
      const ok = row.predicates.every((p) => p(input));
      if (!ok) continue;
      matchedIds.push(row.id);
      matchingRows.push(row);
      if (hitPolicy === 'first') break;
    }

    if (matchingRows.length === 0) {
      if (defaultResolvers.length > 0) {
        const output: Record<string, unknown> = {};
        for (const r of defaultResolvers) {
          output[r.key] = r.resolve(input);
        }
        return { status: 'success', output, matched: ['default'], evaluated };
      }
      return { status: 'no_match', output: {}, matched: [], evaluated };
    }

    if (hitPolicy === 'collect') {
      const output = matchingRows.map((row) => {
        const o: Record<string, unknown> = {};
        for (const r of row.results) {
          o[r.key] = r.resolve(input);
        }
        return o;
      });
      return { status: 'success', output, matched: matchedIds, evaluated };
    }

    // first | all — merge into one object; for all, later rows override
    const output: Record<string, unknown> = {};
    for (const row of matchingRows) {
      for (const r of row.results) {
        output[r.key] = r.resolve(input);
      }
    }
    return { status: 'success', output, matched: matchedIds, evaluated };
  };
}
