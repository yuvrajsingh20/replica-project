import type { Condition, ConditionGroup } from '@rule-engine/shared';
import type { CompiledPredicate } from './operators.js';
import { compileOperator } from './operators.js';
import { compileOperand, compileRight } from './operand.js';

function isConditionGroup(item: Condition | ConditionGroup): item is ConditionGroup {
  return 'logic' in item && 'items' in item && !('op' in item);
}

export function compileCondition(cond: Condition, path: string): CompiledPredicate {
  const left = compileOperand(cond.left, `${path}.left`);
  const right = compileRight(cond.right, `${path}.right`);
  return compileOperator(cond.op, left, right, `${path}.op`, cond.right);
}

export function compileConditionGroup(group: ConditionGroup, path: string): CompiledPredicate {
  const items = group.items.map((item, i) => {
    const itemPath = `${path}.items.${i}`;
    if (isConditionGroup(item)) {
      return compileConditionGroup(item, itemPath);
    }
    return compileCondition(item, itemPath);
  });

  if (group.logic === 'and') {
    return (env) => items.every((fn) => fn(env));
  }
  return (env) => items.some((fn) => fn(env));
}
