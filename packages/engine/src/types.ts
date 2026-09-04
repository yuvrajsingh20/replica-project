import type { ExecuteContext } from './env.js';

export type RuleResult = {
  status: 'success' | 'no_match' | 'error';
  output: Record<string, unknown> | Record<string, unknown>[];
  matched: string[];
  meta: {
    latencyMs: number;
    version?: number;
    evaluated: number;
    unknownTokens?: string[];
  };
  error?: { code: string; message: string; path?: string };
};

export type CompiledRule = {
  execute: (input: unknown, ctx?: ExecuteContext) => RuleResult;
};

export type { ExecuteContext };
