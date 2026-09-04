import type { SimpleRuleDef } from '@rule-engine/shared';
import { applyActions, compileActions } from './action.js';
import { compileConditionGroup } from './condition.js';
import type { ExecEnv } from './env.js';

export type SimpleExecutor = (env: ExecEnv) => {
  status: 'success' | 'no_match';
  output: Record<string, unknown>;
  matched: string[];
  evaluated: number;
};

export function compileSimpleRule(def: SimpleRuleDef): SimpleExecutor {
  const when = compileConditionGroup(def.when, 'when');
  const thenActions = compileActions(def.then, 'then');
  const elseActions = def.else ? compileActions(def.else, 'else') : undefined;

  return (env) => {
    const matched = when(env);
    if (matched) {
      env.output = {};
      return {
        status: 'success',
        output: applyActions(thenActions, env),
        matched: ['then'],
        evaluated: 1,
      };
    }
    if (elseActions) {
      env.output = {};
      return {
        status: 'success',
        output: applyActions(elseActions, env),
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
