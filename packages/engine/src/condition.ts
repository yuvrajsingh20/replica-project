import type { Condition, ConditionGroup } from '@rule-engine/shared';
import { compileOperand, compileRight } from './operand.js';
import { compileOperator, type CompiledPredicate } from './operators.js';

function isConditionGroup(item: Condition | ConditionGroup): item is ConditionGroup {
  return 'logic' in item && 'items' in item && !('op' in item);
}

export function compileCondition(cond: Condition, path: string): CompiledPredicate {
  const left = compileOperand(cond.left, `${path}.left`);
  const right = compileRight(cond.right, `${path}.right`);
  return compileOperator(cond.op, left, right, `${path}.op`);
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
    return (input) => items.every((fn) => fn(input));
  }
  return (input) => items.some((fn) => fn(input));
}
