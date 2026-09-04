import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  createDirectDb,
  getDirectUrl,
  withServiceRole,
  users,
  workspaces,
  sessionWorkspace,
  signupViaAuthTrigger,
} from '../src/index.js';

const USER_1 = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_2 = '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('auth profile trigger', () => {
  let direct: ReturnType<typeof createDirectDb>;

  beforeAll(async () => {
    direct = createDirectDb(getDirectUrl());
    await migrate(direct.db, {
      migrationsFolder: resolve(import.meta.dirname, '../drizzle'),
    });
  }, 60_000);

  afterAll(async () => {
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
      await tx.execute(
        sql`delete from auth.users where id in (${USER_1}::uuid, ${USER_2}::uuid)`,
      );
    });
  });

  it('creates a workspace and owner profile on auth.users insert', async () => {
    await withServiceRole(direct.db, async (tx) => {
      const { workspaceId, role } = await signupViaAuthTrigger(tx, {
        userId: USER_1,
        email: 'alice@test.local',
        workspaceName: 'Alice Co',
      });
      expect(role).toBe('owner');

      const [ws] = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      expect(ws?.name).toBe('Alice Co');
      expect(ws?.slug).toMatch(/^alice-/);

      const [profile] = await tx.select().from(users).where(eq(users.id, USER_1)).limit(1);
      expect(profile?.email).toBe('alice@test.local');
      expect(profile?.workspaceId).toBe(workspaceId);

      const [sw] = await tx
        .select()
        .from(sessionWorkspace)
        .where(eq(sessionWorkspace.userId, USER_1))
        .limit(1);
      expect(sw?.workspaceId).toBe(workspaceId);
      expect(sw?.role).toBe('owner');
    });
  });

  it('gives a second signup a different workspace', async () => {
    await withServiceRole(direct.db, async (tx) => {
      const a = await signupViaAuthTrigger(tx, {
        userId: USER_1,
        email: 'one@test.local',
      });
      const b = await signupViaAuthTrigger(tx, {
        userId: USER_2,
        email: 'two@test.local',
      });
      expect(a.workspaceId).not.toBe(b.workspaceId);
      const all = await tx.select().from(workspaces);
      expect(all).toHaveLength(2);
    });
  });
});
