import type { SimpleRuleDef } from '@rule-engine/shared';
import { applyActions, compileActions } from './action.js';
import { compileConditionGroup } from './condition.js';

export type SimpleExecutor = (input: Record<string, unknown>) => {
  status: 'success' | 'no_match';
  output: Record<string, unknown>;
  matched: string[];
  evaluated: number;
};

export function compileSimpleRule(def: SimpleRuleDef): SimpleExecutor {
  const when = compileConditionGroup(def.when, 'when');
  const thenActions = compileActions(def.then, 'then');
  const elseActions = def.else ? compileActions(def.else, 'else') : undefined;

  return (input) => {
    const matched = when(input);
    if (matched) {
      return {
        status: 'success',
        output: applyActions(thenActions, input),
        matched: ['then'],
        evaluated: 1,
      };
    }
    if (elseActions) {
      return {
        status: 'success',
        output: applyActions(elseActions, input),
        matched: ['else'],
        evaluated: 1,
      };
    }
    return {
      status: 'no_match',
      output: {},
      matched: [],
      evaluated: 1,
    };
  };
}
