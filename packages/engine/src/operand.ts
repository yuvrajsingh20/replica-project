import type { Operand } from '@rule-engine/shared';
import type { ExecEnv } from './env.js';
import { compilePathGetter, type Getter } from './path.js';

export type CompiledOperand = (env: ExecEnv) => unknown;

export function compileOperand(operand: Operand, _path: string): CompiledOperand {
  switch (operand.kind) {
    case 'const':
      return () => operand.value;
    case 'attr': {
      const get = compilePathGetter(operand.path);
      return (env) => get(env.input);
    }
    case 'global': {
      const get = compilePathGetter(operand.name);
      return (env) => get(env.globals);
    }
    case 'output':
      return (env) => env.output[operand.key];
  }
}

export function compileOperandList(
  operands: Operand[],
  path: string,
): CompiledOperand[] {
  return operands.map((op, i) => compileOperand(op, `${path}.${i}`));
}

/** Resolve a right-hand that may be one operand or an array of operands. */
export function compileRight(
  right: Operand | Operand[] | undefined,
  path: string,
): CompiledOperand | CompiledOperand[] | undefined {
  if (right === undefined) return undefined;
  if (Array.isArray(right)) {
    return compileOperandList(right, path);
  }
  return compileOperand(right, path);
}

export function resolveRight(
  compiled: CompiledOperand | CompiledOperand[] | undefined,
  env: ExecEnv,
): unknown {
  if (compiled === undefined) return undefined;
  if (Array.isArray(compiled)) {
    return compiled.map((fn) => fn(env));
  }
  return compiled(env);
}

/** True when every right operand is a compile-time constant. */
export function isConstRight(right: Operand | Operand[] | undefined): boolean {
  if (right === undefined) return false;
  if (Array.isArray(right)) {
    return right.length > 0 && right.every((r) => r.kind === 'const');
  }
  return right.kind === 'const';
}

export function constRightValues(right: Operand | Operand[]): unknown[] {
  if (Array.isArray(right)) {
    return right.map((r) => {
      if (r.kind !== 'const') throw new Error('expected const');
      return r.value;
    });
  }
  if (right.kind !== 'const') throw new Error('expected const');
  return [right.value];
}

export type { Getter };
