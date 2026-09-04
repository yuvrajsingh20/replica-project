import { compileRule, CompileError } from '@rule-engine/engine';
import { parseInputSchema, parseRuleDef } from '@rule-engine/shared';
import { ZodError } from 'zod';

export type DefinitionValidationError = {
  statusCode: 422;
  title: string;
  detail: string;
  path?: string;
  issues?: Array<{ path: Array<string | number>; message: string }>;
};

export function validateCompilableDefinition(
  definition: unknown,
  inputSchema: unknown,
): { ok: true; definition: ReturnType<typeof parseRuleDef>; inputSchema: ReturnType<typeof parseInputSchema> } | { ok: false; error: DefinitionValidationError } {
  try {
    const parsedSchema = parseInputSchema(inputSchema);
    const parsedDef = parseRuleDef(definition);
    compileRule(parsedDef, parsedSchema);
    return { ok: true, definition: parsedDef, inputSchema: parsedSchema };
  } catch (err) {
    if (err instanceof ZodError) {
      const firstPath = err.issues[0]?.path.join('.');
      return {
        ok: false,
        error: {
          statusCode: 422,
          title: 'Validation Error',
          detail: 'Rule definition or input schema failed Zod validation',
          issues: err.issues.map((i) => ({
            path: i.path as Array<string | number>,
            message: i.message,
          })),
          ...(firstPath ? { path: firstPath } : {}),
        },
      };
    }
    if (err instanceof CompileError) {
      return {
        ok: false,
        error: {
          statusCode: 422,
          title: 'Compile Error',
          detail: err.message,
          path: err.path,
        },
      };
    }
    return {
      ok: false,
      error: {
        statusCode: 422,
        title: 'Invalid Definition',
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function defaultDraftDefinition(type: 'simple' | 'decision_table'): unknown {
  if (type === 'simple') {
    return {
      type: 'simple',
      when: { logic: 'and', items: [] },
      then: [],
    };
  }
  return {
    type: 'decision_table',
    hitPolicy: 'first',
    columns: [],
    outputs: [],
    rows: [],
  };
}

export function defaultInputSchema(): unknown {
  return { attributes: [] };
}
