import type { FormulaAst } from '@rule-engine/shared';
import type { ExecEnv } from './env.js';
import { CompileError } from './errors.js';
import { compilePathGetter } from './path.js';

export type CompiledFormula = (env: ExecEnv) => number;

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
      return (env) => {
        const v = get(env.input);
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(`formula attr '${expr.path}' is not a finite number`);
        }
        return v;
      };
    }
    case 'global': {
      const get = compilePathGetter(expr.name);
      return (env) => {
        const v = get(env.globals);
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(`formula global '${expr.name}' is not a finite number`);
        }
        return v;
      };
    }
    case 'output':
      return (env) => {
        const v = env.output[expr.key];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(`formula output '${expr.key}' is not a finite number`);
        }
        return v;
      };
    case 'unary': {
      const arg = compileFormula(expr.arg, `${path}.arg`);
      return (env) => -arg(env);
    }
    case 'binary': {
      const left = compileFormula(expr.left, `${path}.left`);
      const right = compileFormula(expr.right, `${path}.right`);
      const { op } = expr;
      if (op === '+') return (env) => left(env) + right(env);
      if (op === '-') return (env) => left(env) - right(env);
      if (op === '*') return (env) => left(env) * right(env);
      if (op === '/') return (env) => left(env) / right(env);
      if (op === '%') return (env) => left(env) % right(env);
      throw new CompileError(`unknown binary op`, path);
    }
    case 'call': {
      const args = expr.args.map((a, i) => compileFormula(a, `${path}.args.${i}`));
      if (expr.name === 'abs') return (env) => Math.abs(asNumber(args[0]!(env), path));
      if (expr.name === 'round') return (env) => Math.round(asNumber(args[0]!(env), path));
      if (expr.name === 'floor') return (env) => Math.floor(asNumber(args[0]!(env), path));
      if (expr.name === 'ceil') return (env) => Math.ceil(asNumber(args[0]!(env), path));
      if (expr.name === 'min') return (env) => Math.min(...args.map((fn) => fn(env)));
      if (expr.name === 'max') return (env) => Math.max(...args.map((fn) => fn(env)));
      throw new CompileError(`unknown formula fn`, path);
    }
    default:
      throw new CompileError(`unknown formula kind`, path);
  }
}
