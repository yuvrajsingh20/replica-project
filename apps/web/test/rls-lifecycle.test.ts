import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  createDirectDb,
  getDirectUrl,
  withServiceRole,
  signupViaAuthTrigger,
  sql,
} from '@rule-engine/db';
import { POST as createRule } from '../src/app/api/v1/rules/route.js';
import { PATCH as patchRule } from '../src/app/api/v1/rules/[id]/route.js';
import { POST as testRule } from '../src/app/api/v1/rules/[id]/test/route.js';
import { POST as publishRule } from '../src/app/api/v1/rules/[id]/publish/route.js';
import { POST as rollbackRule } from '../src/app/api/v1/rules/[id]/rollback/route.js';
import { GET as listVersions } from '../src/app/api/v1/rules/[id]/versions/route.js';
import { PUT as putGlobal } from '../src/app/api/v1/globals/[name]/route.js';

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

function headers(userId: string) {
  return { 'x-user-id': userId, 'content-type': 'application/json' };
}

describe('rls-lifecycle', () => {
  let direct: ReturnType<typeof createDirectDb>;
  let ruleA: string;
  let versionA: string;

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
      await tx.execute(sql`delete from auth.users where id in (${USER_A}::uuid, ${USER_B}::uuid)`);
      await signupViaAuthTrigger(tx, { userId: USER_A, email: 'rls-a@test.local' });
      await signupViaAuthTrigger(tx, { userId: USER_B, email: 'rls-b@test.local' });
    });

    const pricing = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../packages/engine/test/fixtures/dynamic-pricing.json'),
        'utf8',
      ),
    ) as { schema: unknown; def: unknown };

    const created = await createRule(
      new Request('http://localhost/api/v1/rules', {
        method: 'POST',
        headers: headers(USER_A),
        body: JSON.stringify({ name: 'A pricing', type: 'decision_table', slug: 'a-pricing' }),
      }),
    );
    ruleA = ((await (created as Response).json()) as { id: string }).id;

    await patchRule(
      new Request(`http://localhost/api/v1/rules/${ruleA}`, {
        method: 'PATCH',
        headers: headers(USER_A),
        body: JSON.stringify({
          draftDefinition: pricing.def,
          inputSchema: pricing.schema,
          sampleInput: {
            brand: 'Chevrolet',
            market: 'international',
            inventory: 40,
            list_price: 20000,
          },
        }),
      }),
      { params: Promise.resolve({ id: ruleA }) },
    );

    await putGlobal(
      new Request('http://localhost/api/v1/globals/min_price_policy', {
        method: 'PUT',
        headers: headers(USER_A),
        body: JSON.stringify({ value: 18000 }),
      }),
      { params: Promise.resolve({ name: 'min_price_policy' }) },
    );

    await testRule(
      new Request(`http://localhost/api/v1/rules/${ruleA}/test`, {
        method: 'POST',
        headers: headers(USER_A),
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: ruleA }) },
    );

    const published = await publishRule(
      new Request(`http://localhost/api/v1/rules/${ruleA}/publish`, {
        method: 'POST',
        headers: headers(USER_A),
        body: JSON.stringify({ env: 'staging' }),
      }),
      { params: Promise.resolve({ id: ruleA }) },
    );
    versionA = ((await (published as Response).json()) as { versionId: string }).versionId;
  });

  it('workspace B cannot test, publish, rollback, or read versions of workspace A rule', async () => {
    const testRes = await testRule(
      new Request(`http://localhost/api/v1/rules/${ruleA}/test`, {
        method: 'POST',
        headers: headers(USER_B),
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: ruleA }) },
    );
    expect([403, 404]).toContain((testRes as Response).status);

    const pubRes = await publishRule(
      new Request(`http://localhost/api/v1/rules/${ruleA}/publish`, {
        method: 'POST',
        headers: headers(USER_B),
        body: JSON.stringify({ env: 'production' }),
      }),
      { params: Promise.resolve({ id: ruleA }) },
    );
    expect([403, 404]).toContain((pubRes as Response).status);

    const rbRes = await rollbackRule(
      new Request(`http://localhost/api/v1/rules/${ruleA}/rollback`, {
        method: 'POST',
        headers: headers(USER_B),
        body: JSON.stringify({ env: 'staging', versionId: versionA }),
      }),
      { params: Promise.resolve({ id: ruleA }) },
    );
    expect([403, 404]).toContain((rbRes as Response).status);

    const verRes = await listVersions(
      new Request(`http://localhost/api/v1/rules/${ruleA}/versions`, {
        headers: headers(USER_B),
      }),
      { params: Promise.resolve({ id: ruleA }) },
    );
    expect([403, 404]).toContain((verRes as Response).status);
    if ((verRes as Response).status === 200) {
      const body = (await (verRes as Response).json()) as { items: unknown[] };
      expect(body.items).toEqual([]);
    }
  });
});
