export type RuleResult = {
  status: 'success' | 'no_match' | 'error';
  output: Record<string, unknown> | Record<string, unknown>[];
  matched: string[];
  meta: { latencyMs: number; version?: number; evaluated: number };
  error?: { code: string; message: string; path?: string };
};

export type CompiledRule = {
  execute: (input: unknown) => RuleResult;
};
