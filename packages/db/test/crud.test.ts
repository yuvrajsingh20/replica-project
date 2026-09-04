import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  createDirectDb,
  createRule,
  createRuntimeDb,
  getDirectUrl,
  patchRule,
  upsertGlobal,
  deleteGlobal,
  withServiceRole,
  withUser,
  workspaces,
  users,
  newId,
  listGlobals,
  syncSessionWorkspace,
} from '../src/index.js';

const USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('CRUD + globals_version transaction', () => {
  let direct: ReturnType<typeof createDirectDb>;
  let runtime: ReturnType<typeof createRuntimeDb>;
  let workspaceId: string;

  beforeAll(async () => {
    direct = createDirectDb(getDirectUrl());
    await migrate(direct.db, {
      migrationsFolder: resolve(import.meta.dirname, '../drizzle'),
    });
    runtime = createRuntimeDb();
  }, 60_000);

  afterAll(async () => {
    await runtime.client.end({ timeout: 5 });
    await direct.client.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await withServiceRole(direct.db, async (tx) => {
      await tx.execute(sql`
        truncate table
          executions, rule_environments, rule_versions, rules,
          api_keys, global_variables, users, workspaces
        restart identity cascade
      `);
      await tx.execute(sql`delete from auth.users where id = ${USER}::uuid`);
      await tx.execute(
        sql`insert into auth.users (id, email) values (${USER}::uuid, 'c@test.local')`,
      );
      workspaceId = newId('ws');
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: 'C',
        slug: `c-${workspaceId}`,
        globalsVersion: 0,
      });
      await tx.insert(users).values({
        id: USER,
        workspaceId,
        email: 'c@test.local',
        role: 'owner',
      });
      await syncSessionWorkspace(tx, { userId: USER, workspaceId, role: 'owner' });
    });
  });

  it('rejects uncompilable definitions', async () => {
    await withUser(runtime.db, USER, async (tx) => {
      const created = await createRule(tx, {
        workspaceId,
        userId: USER,
        name: 'x',
        type: 'simple',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const bad = await patchRule(tx, workspaceId, created.rule.id, {
        draftDefinition: { type: 'simple', when: { logic: 'xor', items: [] }, then: [] },
      });
      expect(bad.ok).toBe(false);
      if (bad.ok) return;
      expect(bad.error.status).toBe(422);
    });
  });

  it('bumps globals_version in the same transaction as the write', async () => {
    await withUser(runtime.db, USER, async (tx) => {
      const a = await upsertGlobal(tx, workspaceId, 'min_price_policy', 18000);
      expect(a.globalsVersion).toBe(1);
      const b = await upsertGlobal(tx, workspaceId, 'min_price_policy', 19000);
      expect(b.globalsVersion).toBe(2);
      const list = await listGlobals(tx, workspaceId);
      expect(list?.globalsVersion).toBe(2);
      const del = await deleteGlobal(tx, workspaceId, 'min_price_policy');
      expect(del.globalsVersion).toBe(3);
    });
  });
});
