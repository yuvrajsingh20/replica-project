import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  createDirectDb,
  getDirectUrl,
  withServiceRole,
  workspaces,
  users,
  newId,
  syncSessionWorkspace,
  sql,
} from '@rule-engine/db';
import { GET as listRules, POST as createRule } from '../src/app/api/v1/rules/route.js';
import { PUT as putGlobal } from '../src/app/api/v1/globals/[name]/route.js';
import { GET as listGlobals } from '../src/app/api/v1/globals/route.js';

const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

describe('Next.js management route handlers', () => {
  let direct: ReturnType<typeof createDirectDb>;
  let workspaceId: string;

  beforeAll(async () => {
    process.env['ALLOW_TEST_USER_HEADER'] = '1';
    direct = createDirectDb(getDirectUrl());
    await migrate(direct.db, {
      migrationsFolder: resolve(
        import.meta.dirname,
        '../../../packages/db/drizzle',
      ),
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
      await tx.execute(sql`delete from auth.users where id = ${USER}::uuid`);
      await tx.execute(
        sql`insert into auth.users (id, email) values (${USER}::uuid, 'd@test.local')`,
      );
      workspaceId = newId('ws');
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: 'D',
        slug: `d-${workspaceId}`,
        globalsVersion: 0,
      });
      await tx.insert(users).values({
        id: USER,
        workspaceId,
        email: 'd@test.local',
        role: 'owner',
      });
      await syncSessionWorkspace(tx, { userId: USER, workspaceId, role: 'owner' });
    });
  });

  it('creates a rule and upserts globals via route handlers', async () => {
    const headers = { 'x-user-id': USER, 'content-type': 'application/json' };

    const created = await createRule(
      new Request('http://localhost/api/v1/rules', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Tier', type: 'simple' }),
      }),
    );
    expect(created).toBeInstanceOf(Response);
    const createdRes = created as Response;
    expect(createdRes.status).toBe(201);

    const listed = await listRules(
      new Request('http://localhost/api/v1/rules', { headers }),
    );
    expect((listed as Response).status).toBe(200);
    const listBody = (await (listed as Response).json()) as { total: number };
    expect(listBody.total).toBe(1);

    const put = await putGlobal(
      new Request('http://localhost/api/v1/globals/min_price_policy', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ value: 18000 }),
      }),
      { params: Promise.resolve({ name: 'min_price_policy' }) },
    );
    expect((put as Response).status).toBe(201);
    const putBody = (await (put as Response).json()) as { globalsVersion: number };
    expect(putBody.globalsVersion).toBe(1);

    const globals = await listGlobals(
      new Request('http://localhost/api/v1/globals', { headers }),
    );
    const gBody = (await (globals as Response).json()) as {
      globalsVersion: number;
      items: Array<{ name: string }>;
    };
    expect(gBody.globalsVersion).toBe(1);
    expect(gBody.items[0]?.name).toBe('min_price_policy');
  });
});
