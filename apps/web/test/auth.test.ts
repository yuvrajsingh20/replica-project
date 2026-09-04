import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  createDirectDb,
  getDirectUrl,
  withServiceRole,
  signupViaAuthTrigger,
  users,
  sql,
} from '@rule-engine/db';

const USER_1 = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const USER_2 = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

describe('auth', () => {
  let direct: ReturnType<typeof createDirectDb>;

  beforeAll(async () => {
    process.env['ALLOW_TEST_USER_HEADER'] = '1';
    direct = createDirectDb(getDirectUrl());
    await migrate(direct.db, {
      migrationsFolder: resolve(import.meta.dirname, '../../../packages/db/drizzle'),
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

  it('signup creates workspace + owner profile; second signup gets a different workspace', async () => {
    await withServiceRole(direct.db, async (tx) => {
      const a = await signupViaAuthTrigger(tx, {
        userId: USER_1,
        email: 'auth1@test.local',
        workspaceName: 'Auth One',
      });
      const b = await signupViaAuthTrigger(tx, {
        userId: USER_2,
        email: 'auth2@test.local',
        workspaceName: 'Auth Two',
      });
      expect(a.workspaceId).not.toBe(b.workspaceId);
      expect(a.role).toBe('owner');
      expect(b.role).toBe('owner');

      const [p1] = await tx.select().from(users).where(eq(users.id, USER_1)).limit(1);
      expect(p1?.email).toBe('auth1@test.local');
    });
  });

  it('login sets a session (X-User-Id test harness resolves membership)', async () => {
    await withServiceRole(direct.db, async (tx) => {
      await signupViaAuthTrigger(tx, {
        userId: USER_1,
        email: 'session@test.local',
      });
    });

    const { GET: listRules } = await import('../src/app/api/v1/rules/route.js');
    const res = await listRules(
      new Request('http://localhost/api/v1/rules', {
        headers: { 'x-user-id': USER_1 },
      }),
    );
    expect((res as Response).status).toBe(200);
  });
});
