import type { InputSchema, RuleDef } from '@rule-engine/shared';
import { coerceInput } from './coerce.js';
import { compileDecisionTable } from './decision-table.js';
import { createExecEnv, type ExecuteContext } from './env.js';
import { compileSimpleRule } from './simple.js';
import type { CompiledRule, RuleResult } from './types.js';

export type { CompiledRule, RuleResult, ExecuteContext } from './types.js';
export { CompileError } from './errors.js';

export function compileRule(def: RuleDef, schema: InputSchema): CompiledRule {
  const executor =
    def.type === 'simple' ? compileSimpleRule(def) : compileDecisionTable(def);

  return {
    execute(input: unknown, ctx?: ExecuteContext): RuleResult {
      const start = performance.now();
      try {
        const coerced = coerceInput(input, schema);
        if (!coerced.ok) {
          return {
            status: 'error',
            output: {},
            matched: [],
            meta: {
              latencyMs: performance.now() - start,
              evaluated: 0,
            },
            error: {
              code: coerced.error.code,
              message: coerced.error.message,
              ...(coerced.error.path ? { path: coerced.error.path } : {}),
            },
          };
        }

        const env = createExecEnv(coerced.value, ctx);
        const result = executor(env);
        const unknownTokens = [...new Set(env.unknownTokens)];
        return {
          status: result.status,
          output: result.output,
          matched: result.matched,
          meta: {
            latencyMs: performance.now() - start,
            evaluated: result.evaluated,
            ...(unknownTokens.length > 0 ? { unknownTokens } : {}),
          },
        };
      } catch (err) {
        return {
          status: 'error',
          output: {},
          matched: [],
          meta: {
            latencyMs: performance.now() - start,
            evaluated: 0,
          },
          error: {
            code: 'runtime_error',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
  };
}
