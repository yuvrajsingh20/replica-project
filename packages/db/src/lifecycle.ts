import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { compileRule, type RuleResult } from '@rule-engine/engine';
import { can, LifecycleError, type RuleLifecycleStatus } from '@rule-engine/shared';
import type { Db } from './client.js';
import { serializeRule, type Problem } from './crud.js';
import { newId } from './ids.js';
import {
  globalVariables,
  ruleEnvironments,
  rules,
  ruleVersions,
} from './schema.js';
import { validateCompilableDefinition } from './validate-definition.js';

export type PublishEnv = 'staging' | 'production';

function asStatus(s: string): RuleLifecycleStatus {
  return s as RuleLifecycleStatus;
}

export function serializeVersion(row: typeof ruleVersions.$inferSelect, full: boolean) {
  return {
    id: row.id,
    ruleId: row.ruleId,
    version: row.version,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt.toISOString(),
    changelog: row.changelog,
    ...(full ? { definition: row.definition, inputSchema: row.inputSchema } : {}),
  };
}

export async function testRule(
  db: Db,
  args: {
    workspaceId: string;
    ruleId: string;
    input?: unknown;
    globalsOverride?: Record<string, unknown>;
  },
): Promise<
  | { ok: true; result: RuleResult; rule: ReturnType<typeof serializeRule> }
  | { ok: false; error: Problem }
> {
  const [rule] = await db
    .select()
    .from(rules)
    .where(
      and(
        eq(rules.id, args.ruleId),
        eq(rules.workspaceId, args.workspaceId),
        isNull(rules.deletedAt),
      ),
    )
    .limit(1);
  if (!rule) {
    return { ok: false, error: { status: 404, title: 'Not Found', detail: 'Rule not found' } };
  }

  const input = args.input ?? rule.sampleInput;
  if (input === null || input === undefined) {
    return {
      ok: false,
      error: {
        status: 422,
        title: 'Unprocessable Entity',
        detail: 'Test requires input or rule.sample_input',
      },
    };
  }

  const checked = validateCompilableDefinition(rule.draftDefinition, rule.inputSchema);
  if (!checked.ok) {
    return {
      ok: false,
      error: {
        status: 422,
        title: checked.error.title,
        detail: checked.error.detail,
        ...(checked.error.path ? { path: checked.error.path } : {}),
        ...(checked.error.issues ? { issues: checked.error.issues } : {}),
      },
    };
  }

  const globalRows = await db
    .select()
    .from(globalVariables)
    .where(eq(globalVariables.workspaceId, args.workspaceId));
  const globals: Record<string, unknown> = {};
  for (const g of globalRows) {
    globals[g.name] = g.value;
  }
  if (args.globalsOverride) {
    Object.assign(globals, args.globalsOverride);
  }

  const compiled = compileRule(checked.definition, checked.inputSchema);
  const result = compiled.execute(input, { globals });

  if (result.status !== 'error' && rule.status === 'draft') {
    await db
      .update(rules)
      .set({ status: 'tested', updatedAt: new Date() })
      .where(eq(rules.id, rule.id));
  }

  const [updated] = await db.select().from(rules).where(eq(rules.id, rule.id)).limit(1);
  return { ok: true, result, rule: serializeRule(updated!) };
}

export async function publishRule(
  db: Db,
  args: {
    workspaceId: string;
    ruleId: string;
    userId: string;
    env: PublishEnv;
    changelog?: string;
  },
): Promise<{ ok: true; versionId: string; version: number } | { ok: false; error: Problem }> {
  const locked = await db.execute(sql`
    select id, status, draft_definition, input_schema
    from rules
    where id = ${args.ruleId}
      and workspace_id = ${args.workspaceId}
      and deleted_at is null
    for update
  `);

  const ruleRow = (locked as unknown as Array<Record<string, unknown>>)[0];
  if (!ruleRow) {
    return { ok: false, error: { status: 404, title: 'Not Found', detail: 'Rule not found' } };
  }

  const status = asStatus(String(ruleRow['status']));
  if (!can(status, 'publish')) {
    return {
      ok: false,
      error: {
        status: 409,
        title: 'Conflict',
        detail: new LifecycleError(status, 'publish').message,
      },
    };
  }

  const checked = validateCompilableDefinition(
    ruleRow['draft_definition'],
    ruleRow['input_schema'],
  );
  if (!checked.ok) {
    return {
      ok: false,
      error: {
        status: 422,
        title: checked.error.title,
        detail: checked.error.detail,
        ...(checked.error.path ? { path: checked.error.path } : {}),
        ...(checked.error.issues ? { issues: checked.error.issues } : {}),
      },
    };
  }

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${ruleVersions.version}), 0)` })
    .from(ruleVersions)
    .where(eq(ruleVersions.ruleId, args.ruleId));
  const version = Number(maxRow?.max ?? 0) + 1;
  const versionId = newId('rv');

  await db.insert(ruleVersions).values({
    id: versionId,
    ruleId: args.ruleId,
    version,
    definition: checked.definition,
    inputSchema: checked.inputSchema,
    publishedBy: args.userId,
    changelog: args.changelog ?? null,
  });

  await db
    .insert(ruleEnvironments)
    .values({
      ruleId: args.ruleId,
      env: args.env,
      versionId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [ruleEnvironments.ruleId, ruleEnvironments.env],
      set: { versionId, updatedAt: new Date() },
    });

  await db
    .update(rules)
    .set({ status: 'published', updatedAt: new Date() })
    .where(eq(rules.id, args.ruleId));

  return { ok: true, versionId, version };
}

export async function rollbackRule(
  db: Db,
  args: {
    workspaceId: string;
    ruleId: string;
    env: PublishEnv;
    versionId: string;
  },
): Promise<{ ok: true; env: PublishEnv; versionId: string } | { ok: false; error: Problem }> {
  const [rule] = await db
    .select()
    .from(rules)
    .where(
      and(
        eq(rules.id, args.ruleId),
        eq(rules.workspaceId, args.workspaceId),
        isNull(rules.deletedAt),
      ),
    )
    .limit(1);
  if (!rule) {
    return { ok: false, error: { status: 404, title: 'Not Found', detail: 'Rule not found' } };
  }

  const [version] = await db
    .select()
    .from(ruleVersions)
    .where(and(eq(ruleVersions.id, args.versionId), eq(ruleVersions.ruleId, args.ruleId)))
    .limit(1);
  if (!version) {
    return {
      ok: false,
      error: { status: 404, title: 'Not Found', detail: 'Version not found for this rule' },
    };
  }

  const [envRow] = await db
    .select()
    .from(ruleEnvironments)
    .where(and(eq(ruleEnvironments.ruleId, args.ruleId), eq(ruleEnvironments.env, args.env)))
    .limit(1);

  if (envRow) {
    await db
      .update(ruleEnvironments)
      .set({ versionId: args.versionId, updatedAt: new Date() })
      .where(and(eq(ruleEnvironments.ruleId, args.ruleId), eq(ruleEnvironments.env, args.env)));
  } else {
    await db.insert(ruleEnvironments).values({
      ruleId: args.ruleId,
      env: args.env,
      versionId: args.versionId,
      updatedAt: new Date(),
    });
  }

  return { ok: true, env: args.env, versionId: args.versionId };
}

export async function listVersions(
  db: Db,
  args: {
    workspaceId: string;
    ruleId: string;
    limit: number;
    cursor?: string;
    full?: boolean;
  },
) {
  const [rule] = await db
    .select({ id: rules.id })
    .from(rules)
    .where(
      and(
        eq(rules.id, args.ruleId),
        eq(rules.workspaceId, args.workspaceId),
        isNull(rules.deletedAt),
      ),
    )
    .limit(1);
  if (!rule) return null;

  let cursorVersion: number | undefined;
  if (args.cursor) {
    const [cursorRow] = await db
      .select()
      .from(ruleVersions)
      .where(and(eq(ruleVersions.id, args.cursor), eq(ruleVersions.ruleId, args.ruleId)))
      .limit(1);
    cursorVersion = cursorRow?.version;
  }

  const rows = await db
    .select()
    .from(ruleVersions)
    .where(
      cursorVersion !== undefined
        ? and(
            eq(ruleVersions.ruleId, args.ruleId),
            sql`${ruleVersions.version} < ${cursorVersion}`,
          )
        : eq(ruleVersions.ruleId, args.ruleId),
    )
    .orderBy(desc(ruleVersions.version))
    .limit(args.limit);

  return {
    items: rows.map((r) => serializeVersion(r, Boolean(args.full))),
    nextCursor: rows.length === args.limit ? (rows[rows.length - 1]?.id ?? null) : null,
  };
}

export async function getVersion(
  db: Db,
  args: { workspaceId: string; ruleId: string; versionId: string },
) {
  const [rule] = await db
    .select({ id: rules.id })
    .from(rules)
    .where(
      and(
        eq(rules.id, args.ruleId),
        eq(rules.workspaceId, args.workspaceId),
        isNull(rules.deletedAt),
      ),
    )
    .limit(1);
  if (!rule) return null;

  const [row] = await db
    .select()
    .from(ruleVersions)
    .where(and(eq(ruleVersions.id, args.versionId), eq(ruleVersions.ruleId, args.ruleId)))
    .limit(1);
  return row ? serializeVersion(row, true) : null;
}

export async function listEnvironments(
  db: Db,
  args: { workspaceId: string; ruleId: string },
) {
  const [rule] = await db
    .select({ id: rules.id })
    .from(rules)
    .where(
      and(
        eq(rules.id, args.ruleId),
        eq(rules.workspaceId, args.workspaceId),
        isNull(rules.deletedAt),
      ),
    )
    .limit(1);
  if (!rule) return null;

  const rows = await db
    .select({
      env: ruleEnvironments.env,
      versionId: ruleEnvironments.versionId,
      updatedAt: ruleEnvironments.updatedAt,
      version: ruleVersions.version,
    })
    .from(ruleEnvironments)
    .innerJoin(ruleVersions, eq(ruleEnvironments.versionId, ruleVersions.id))
    .where(eq(ruleEnvironments.ruleId, args.ruleId));

  const result: Record<
    string,
    { versionId: string; version: number; updatedAt: string } | null
  > = {
    staging: null,
    production: null,
  };
  for (const row of rows) {
    result[row.env] = {
      versionId: row.versionId,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  return result;
}
