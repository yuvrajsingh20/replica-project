import type { Operand } from '@rule-engine/shared';
import { compilePathGetter, type Getter } from './path.js';

export type CompiledOperand = (input: Record<string, unknown>) => unknown;

export function compileOperand(operand: Operand, _path: string): CompiledOperand {
  switch (operand.kind) {
    case 'const':
      return () => operand.value;
    case 'attr':
      return compilePathGetter(operand.path);
    case 'global':
      return () => undefined;
  }
}

export function compileOperandList(
  operands: Operand[],
  path: string,
): Array<(input: Record<string, unknown>) => unknown> {
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
  input: Record<string, unknown>,
): unknown {
  if (compiled === undefined) return undefined;
  if (Array.isArray(compiled)) {
    return compiled.map((fn) => fn(input));
  }
  return compiled(input);
}

export type { Getter };
