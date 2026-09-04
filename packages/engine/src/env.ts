export type ExecuteContext = {
  globals?: Record<string, unknown>;
};

export type ExecEnv = {
  input: Record<string, unknown>;
  globals: Record<string, unknown>;
  output: Record<string, unknown>;
  unknownTokens: string[];
};

export function createExecEnv(
  input: Record<string, unknown>,
  ctx?: ExecuteContext,
  output: Record<string, unknown> = {},
): ExecEnv {
  return {
    input,
    globals: ctx?.globals ?? {},
    output,
    unknownTokens: [],
  };
}
