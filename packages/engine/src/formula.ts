import type { FormulaAst } from '@rule-engine/shared';
import { CompileError } from './errors.js';
import { compilePathGetter } from './path.js';

export type CompiledFormula = (input: Record<string, unknown>) => number;

function asNumber(v: unknown, path: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error(`formula expected number at ${path}`);
}

export function compileFormula(expr: FormulaAst, path: string): CompiledFormula {
  switch (expr.kind) {
    case 'const':
      return () => expr.value;
    case 'attr': {
      const get = compilePathGetter(expr.path);
      return (input) => {
        const v = get(input);
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(`formula attr '${expr.path}' is not a finite number`);
        }
        return v;
      };
    }
    case 'unary': {
      const arg = compileFormula(expr.arg, `${path}.arg`);
      return (input) => -arg(input);
    }
    case 'binary': {
      const left = compileFormula(expr.left, `${path}.left`);
      const right = compileFormula(expr.right, `${path}.right`);
      const { op } = expr;
      if (op === '+') return (input) => left(input) + right(input);
      if (op === '-') return (input) => left(input) - right(input);
      if (op === '*') return (input) => left(input) * right(input);
      if (op === '/') return (input) => left(input) / right(input);
      if (op === '%') return (input) => left(input) % right(input);
      throw new CompileError(`unknown binary op`, path);
    }
    case 'call': {
      const args = expr.args.map((a, i) => compileFormula(a, `${path}.args.${i}`));
      if (expr.name === 'abs') return (input) => Math.abs(asNumber(args[0]!(input), path));
      if (expr.name === 'round') return (input) => Math.round(asNumber(args[0]!(input), path));
      if (expr.name === 'min') return (input) => Math.min(...args.map((fn) => fn(input)));
      if (expr.name === 'max') return (input) => Math.max(...args.map((fn) => fn(input)));
      throw new CompileError(`unknown formula fn`, path);
    }
    default:
      throw new CompileError(`unknown formula kind`, path);
  }
}
