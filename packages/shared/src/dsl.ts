import { z, type ZodType } from 'zod';

// ---------------------------------------------------------------------------
// 4.1 Input schema
// ---------------------------------------------------------------------------

export const ATTR_TYPES = [
  'string',
  'numeric',
  'boolean',
  'date',
  'datetime',
  'json',
  'list',
] as const;

export const attrTypeSchema = z.enum(ATTR_TYPES);
export type AttrType = z.infer<typeof attrTypeSchema>;

export const inputAttrSchema = z.object({
  name: z.string().min(1),
  type: attrTypeSchema,
  required: z.boolean().optional(),
  sample: z.unknown().optional(),
});
export type InputAttr = z.infer<typeof inputAttrSchema>;

export const inputSchemaSchema = z
  .object({
    attributes: z.array(inputAttrSchema),
  })
  .superRefine((schema, ctx) => {
    const seen = new Set<string>();
    for (const [i, attr] of schema.attributes.entries()) {
      if (seen.has(attr.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate attribute name '${attr.name}'`,
          path: ['attributes', i, 'name'],
        });
      }
      seen.add(attr.name);
    }
  });
export type InputSchema = z.infer<typeof inputSchemaSchema>;

// ---------------------------------------------------------------------------
// 4.2 Expressions
// ---------------------------------------------------------------------------

export const operandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('const'), value: z.unknown() }),
  z.object({ kind: z.literal('attr'), path: z.string().min(1) }),
  z.object({ kind: z.literal('global'), name: z.string().min(1) }),
  z.object({ kind: z.literal('output'), key: z.string().min(1) }),
]);
export type Operand = z.infer<typeof operandSchema>;

export const OPERATORS = [
  'eq',
  'neq',
  'is_null',
  'is_not_null',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches',
  'in',
  'not_in',
  'any_in',
  'all_in',
  'length_eq',
  'length_gt',
  'length_lt',
] as const;

export const operatorSchema = z.enum(OPERATORS);
export type Operator = z.infer<typeof operatorSchema>;

export const conditionSchema = z.object({
  left: operandSchema,
  op: operatorSchema,
  right: z.union([operandSchema, z.array(operandSchema)]).optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export type ConditionGroup = {
  logic: 'and' | 'or';
  items: Array<Condition | ConditionGroup>;
};

export const conditionGroupSchema: ZodType<ConditionGroup> = z.lazy(() =>
  z.object({
    logic: z.enum(['and', 'or']),
    items: z.array(z.union([conditionGroupSchema, conditionSchema])),
  }),
);

// ---------------------------------------------------------------------------
// Formula AST (safe arithmetic; node shapes are defined here — spec named the
// operators but not the JSON node kinds)
// ---------------------------------------------------------------------------

export const FORMULA_BINARY_OPS = ['+', '-', '*', '/', '%'] as const;
export const FORMULA_FNS = ['min', 'max', 'round', 'abs', 'floor', 'ceil'] as const;

export type FormulaAst =
  | { kind: 'const'; value: number }
  | { kind: 'attr'; path: string }
  | { kind: 'global'; name: string }
  | { kind: 'output'; key: string }
  | {
      kind: 'binary';
      op: (typeof FORMULA_BINARY_OPS)[number];
      left: FormulaAst;
      right: FormulaAst;
    }
  | { kind: 'unary'; op: '-'; arg: FormulaAst }
  | { kind: 'call'; name: (typeof FORMULA_FNS)[number]; args: FormulaAst[] };

export const formulaAstSchema: ZodType<FormulaAst> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('const'), value: z.number().finite() }),
    z.object({ kind: z.literal('attr'), path: z.string().min(1) }),
    z.object({ kind: z.literal('global'), name: z.string().min(1) }),
    z.object({ kind: z.literal('output'), key: z.string().min(1) }),
    z.object({
      kind: z.literal('binary'),
      op: z.enum(FORMULA_BINARY_OPS),
      left: formulaAstSchema,
      right: formulaAstSchema,
    }),
    z.object({
      kind: z.literal('unary'),
      op: z.literal('-'),
      arg: formulaAstSchema,
    }),
    z.object({
      kind: z.literal('call'),
      name: z.enum(FORMULA_FNS),
      args: z.array(formulaAstSchema).min(1),
    }),
  ]),
);

// ---------------------------------------------------------------------------
// 4.3 Actions
// ---------------------------------------------------------------------------

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('set'),
    key: z.string().min(1),
    value: operandSchema,
  }),
  z.object({
    kind: z.literal('formula'),
    key: z.string().min(1),
    expr: formulaAstSchema,
  }),
  z.object({
    kind: z.literal('template'),
    key: z.string().min(1),
    text: z.string(),
  }),
]);
export type Action = z.infer<typeof actionSchema>;

// ---------------------------------------------------------------------------
// 4.4 Simple Rule
// ---------------------------------------------------------------------------

export const simpleRuleDefSchema = z.object({
  type: z.literal('simple'),
  when: conditionGroupSchema,
  then: z.array(actionSchema),
  else: z.array(actionSchema).optional(),
});
export type SimpleRuleDef = z.infer<typeof simpleRuleDefSchema>;

// ---------------------------------------------------------------------------
// 4.5 Decision Table
// ---------------------------------------------------------------------------

export const HIT_POLICIES = ['first', 'all', 'collect'] as const;
export const hitPolicySchema = z.enum(HIT_POLICIES);
export type HitPolicy = z.infer<typeof hitPolicySchema>;

export const decisionTableColumnSchema = z.object({
  id: z.string().min(1),
  left: operandSchema,
  op: operatorSchema,
});
export type DecisionTableColumn = z.infer<typeof decisionTableColumnSchema>;

export const decisionTableOutputSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
});
export type DecisionTableOutput = z.infer<typeof decisionTableOutputSchema>;

export const cellValueSchema = z.union([operandSchema, z.array(operandSchema), z.null()]);
export type CellValue = z.infer<typeof cellValueSchema>;

export const rowResultSchema = z.union([
  operandSchema,
  z.object({ formula: formulaAstSchema }),
]);
export type RowResult = z.infer<typeof rowResultSchema>;

export const decisionTableRowSchema = z
  .object({
    id: z.string().min(1),
    priority: z.number().int().optional(),
    cells: z.record(z.string(), cellValueSchema),
    results: z.record(z.string(), rowResultSchema).optional(),
    actions: z.array(actionSchema).optional(),
  })
  .superRefine((row, ctx) => {
    if (row.results === undefined && row.actions === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'row requires results or actions',
        path: ['results'],
      });
    }
  });
export type DecisionTableRow = z.infer<typeof decisionTableRowSchema>;

function addDuplicateIdIssues(
  ids: readonly string[],
  ctx: z.RefinementCtx,
  pathPrefix: Array<string | number>,
  label: string,
): void {
  const seen = new Set<string>();
  for (const [i, id] of ids.entries()) {
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate ${label} id '${id}'`,
        path: [...pathPrefix, i, 'id'],
      });
    }
    seen.add(id);
  }
}

const decisionTableDefObjectSchema = z.object({
  type: z.literal('decision_table'),
  hitPolicy: hitPolicySchema,
  columns: z.array(decisionTableColumnSchema),
  outputs: z.array(decisionTableOutputSchema),
  rows: z.array(decisionTableRowSchema),
  defaultRow: z.record(z.string(), operandSchema).optional(),
});

function refineDecisionTable(
  table: z.infer<typeof decisionTableDefObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  addDuplicateIdIssues(
    table.columns.map((c) => c.id),
    ctx,
    ['columns'],
    'column',
  );
  addDuplicateIdIssues(
    table.outputs.map((o) => o.id),
    ctx,
    ['outputs'],
    'output',
  );
  addDuplicateIdIssues(
    table.rows.map((r) => r.id),
    ctx,
    ['rows'],
    'row',
  );

  const columnIds = new Set(table.columns.map((c) => c.id));
  const outputIds = new Set(table.outputs.map((o) => o.id));

  for (const [ri, row] of table.rows.entries()) {
    for (const cellId of Object.keys(row.cells)) {
      if (!columnIds.has(cellId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown column id '${cellId}'`,
          path: ['rows', ri, 'cells', cellId],
        });
      }
    }
    if (row.results) {
      for (const resultId of Object.keys(row.results)) {
        if (!outputIds.has(resultId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown output id '${resultId}'`,
            path: ['rows', ri, 'results', resultId],
          });
        }
      }
    }
  }

  if (table.defaultRow) {
    for (const key of Object.keys(table.defaultRow)) {
      if (!outputIds.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown output id '${key}' in defaultRow`,
          path: ['defaultRow', key],
        });
      }
    }
  }
}

export const decisionTableDefSchema = decisionTableDefObjectSchema.superRefine(refineDecisionTable);
export type DecisionTableDef = z.infer<typeof decisionTableDefSchema>;

// ---------------------------------------------------------------------------
// RuleDef
// ---------------------------------------------------------------------------

export const ruleDefSchema = z
  .discriminatedUnion('type', [simpleRuleDefSchema, decisionTableDefObjectSchema])
  .superRefine((def, ctx) => {
    if (def.type === 'decision_table') {
      refineDecisionTable(def, ctx);
    }
  });
export type RuleDef = z.infer<typeof ruleDefSchema>;

export function parseRuleDef(input: unknown): RuleDef {
  return ruleDefSchema.parse(input);
}

export function parseInputSchema(input: unknown): InputSchema {
  return inputSchemaSchema.parse(input);
}
