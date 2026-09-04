import type { Action } from '@rule-engine/shared';
import { compileFormula } from './formula.js';
import { compileOperand } from './operand.js';

export type CompiledAction = (
  input: Record<string, unknown>,
  output: Record<string, unknown>,
) => void;

export function compileAction(action: Action, path: string): CompiledAction {
  if (action.kind === 'set') {
    const value = compileOperand(action.value, `${path}.value`);
    return (input, output) => {
      output[action.key] = value(input);
    };
  }
  const expr = compileFormula(action.expr, `${path}.expr`);
  return (input, output) => {
    output[action.key] = expr(input);
  };
}

export function compileActions(actions: Action[], path: string): CompiledAction[] {
  return actions.map((a, i) => compileAction(a, `${path}.${i}`));
}

export function applyActions(
  actions: CompiledAction[],
  input: Record<string, unknown>,
  output: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const action of actions) {
    action(input, output);
  }
  return output;
}
