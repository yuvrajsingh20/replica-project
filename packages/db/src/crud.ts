import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { compareSync } from 'bcryptjs';
import type { Db } from './client.js';
import { deleteGlobalInTransaction, upsertGlobalInTransaction } from './globals.js';
import { generateApiKey, newId, slugify } from './ids.js';
import { apiKeys, globalVariables, rules, users, workspaces } from './schema.js';
import {
  defaultDraftDefinition,
  defaultInputSchema,
  validateCompilableDefinition,
} from './validate-definition.js';

export type Problem = {
  status: number;
  title: string;
  detail?: string;
  path?: string;
  issues?: Array<{ path: Array<string | number>; message: string }>;
};

export function serializeRule(row: typeof rules.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    type: row.type,
    status: row.status,
    draftDefinition: row.draftDefinition,
    inputSchema: row.inputSchema,
    sampleInput: row.sampleInput,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export async function getUserWorkspaceId(
  db: Db,
  userId: string,
): Promise<string | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row?.workspaceId ?? null;
}

export async function listRules(
  db: Db,
  workspaceId: string,
  query: {
    status?: 'draft' | 'tested' | 'published' | undefined;
    type?: 'simple' | 'decision_table' | undefined;
    search?: string | undefined;
    page: number;
    limit: number;
  },
) {
  const conditions = [eq(rules.workspaceId, workspaceId), isNull(rules.deletedAt)];
  if (query.status) conditions.push(eq(rules.status, query.status));
  if (query.type) conditions.push(eq(rules.type, query.type));
  if (query.search) conditions.push(ilike(rules.name, `%${query.search}%`));
  const where = and(...conditions);
  const offset = (query.page - 1) * query.limit;
  const [rows, countRow] = await Promise.all([
    db
      .select()
      .from(rules)
      .where(where)
      .orderBy(desc(rules.updatedAt))
      .limit(query.limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(rules).where(where),
  ]);
  return {
    items: rows.map(serializeRule),
    page: query.page,
    limit: query.limit,
    total: countRow[0]?.count ?? 0,
  };
}

export async function createRule(
  db: Db,
  args: {
    workspaceId: string;
    userId: string;
    name: string;
    type: 'simple' | 'decision_table';
    slug?: string;
    description?: string;
  },
): Promise<{ ok: true; rule: ReturnType<typeof serializeRule> } | { ok: false; error: Problem }> {
  const draftDefinition = defaultDraftDefinition(args.type);
  const inputSchema = defaultInputSchema();
  const checked = validateCompilableDefinition(draftDefinition, inputSchema);
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

  const slug = args.slug ?? slugify(args.name);
  const id = newId('rul');
  const now = new Date();
  try {
    const [row] = await db
      .insert(rules)
      .values({
        id,
        workspaceId: args.workspaceId,
        slug,
        name: args.name,
        description: args.description ?? null,
        type: args.type,
        status: 'draft',
        draftDefinition: checked.definition,
        inputSchema: checked.inputSchema,
        sampleInput: null,
        createdBy: args.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return { ok: true, rule: serializeRule(row!) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('rules_workspace_slug_uidx') || message.includes('unique')) {
      return {
        ok: false,
        error: { status: 409, title: 'Conflict', detail: `Slug '${slug}' already exists` },
      };
    }
    throw err;
  }
}

export async function getRule(db: Db, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.id, id), eq(rules.workspaceId, workspaceId), isNull(rules.deletedAt)))
    .limit(1);
  return row ? serializeRule(row) : null;
}

export async function patchRule(
  db: Db,
  workspaceId: string,
  id: string,
  body: {
    name?: string | undefined;
    description?: string | null | undefined;
    draftDefinition?: unknown;
    inputSchema?: unknown;
    sampleInput?: unknown | null | undefined;
  },
): Promise<{ ok: true; rule: ReturnType<typeof serializeRule> } | { ok: false; error: Problem }> {
  const [existing] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.id, id), eq(rules.workspaceId, workspaceId), isNull(rules.deletedAt)))
    .limit(1);
  if (!existing) {
    return { ok: false, error: { status: 404, title: 'Not Found', detail: 'Rule not found' } };
  }

  const nextDefinition =
    body.draftDefinition !== undefined ? body.draftDefinition : existing.draftDefinition;
  const nextSchema = body.inputSchema !== undefined ? body.inputSchema : existing.inputSchema;
  const checked = validateCompilableDefinition(nextDefinition, nextSchema);
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

  const [row] = await db
    .update(rules)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      draftDefinition: checked.definition,
      inputSchema: checked.inputSchema,
      ...(body.sampleInput !== undefined ? { sampleInput: body.sampleInput } : {}),
      status: 'draft',
      updatedAt: new Date(),
    })
    .where(eq(rules.id, id))
    .returning();

  return { ok: true, rule: serializeRule(row!) };
}

export async function softDeleteRule(db: Db, workspaceId: string, id: string) {
  const [row] = await db
    .update(rules)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(rules.id, id), eq(rules.workspaceId, workspaceId), isNull(rules.deletedAt)))
    .returning();
  return Boolean(row);
}

export function serializeApiKey(row: typeof apiKeys.$inferSelect, raw?: string) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    env: row.env,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    ...(raw !== undefined ? { key: raw } : {}),
  };
}

export async function listApiKeys(db: Db, workspaceId: string) {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)));
  return { items: rows.map((r) => serializeApiKey(r)) };
}

export async function createApiKey(
  db: Db,
  args: { workspaceId: string; name: string; env: 'staging' | 'production' },
) {
  const { raw, hash, prefix } = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      id: newId('key'),
      workspaceId: args.workspaceId,
      name: args.name,
      keyHash: hash,
      keyPrefix: prefix,
      env: args.env,
    })
    .returning();
  return serializeApiKey(row!, raw);
}

export async function revokeApiKey(db: Db, workspaceId: string, id: string) {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)),
    )
    .returning();
  return Boolean(row);
}

/** Lookup by prefix then bcrypt.compare — for Phase 4 execute path. */
export async function findApiKeyByRaw(db: Db, raw: string) {
  const prefix = raw.slice(0, 8);
  const candidates = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)));
  for (const row of candidates) {
    if (compareSync(raw, row.keyHash)) return row;
  }
  return null;
}

export function serializeGlobal(row: typeof globalVariables.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    value: row.value,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listGlobals(db: Db, workspaceId: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) return null;
  const rows = await db
    .select()
    .from(globalVariables)
    .where(eq(globalVariables.workspaceId, workspaceId));
  return { globalsVersion: ws.globalsVersion, items: rows.map(serializeGlobal) };
}

export async function upsertGlobal(
  db: Db,
  workspaceId: string,
  name: string,
  value: unknown,
) {
  const result = await upsertGlobalInTransaction(db, { workspaceId, name, value });
  return {
    ...serializeGlobal(result.row),
    globalsVersion: result.globalsVersion,
    created: result.created,
  };
}

export async function deleteGlobal(db: Db, workspaceId: string, name: string) {
  return deleteGlobalInTransaction(db, { workspaceId, name });
}
