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
  ruleVersions,
} from '@rule-engine/db';
import { eq } from 'drizzle-orm';
import { POST as createRule } from '../src/app/api/v1/rules/route.js';
import { PATCH as patchRule, GET as getRule } from '../src/app/api/v1/rules/[id]/route.js';
import { POST as testRule } from '../src/app/api/v1/rules/[id]/test/route.js';
import { POST as publishRule } from '../src/app/api/v1/rules/[id]/publish/route.js';
import { POST as rollbackRule } from '../src/app/api/v1/rules/[id]/rollback/route.js';
import { GET as listVersions } from '../src/app/api/v1/rules/[id]/versions/route.js';
import { GET as listEnvironments } from '../src/app/api/v1/rules/[id]/environments/route.js';
import { PUT as putGlobal } from '../src/app/api/v1/globals/[name]/route.js';

const OWNER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

type Fixture = { schema: unknown; def: unknown };

function loadPricing(): Fixture {
  return JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../packages/engine/test/fixtures/dynamic-pricing.json'),
      'utf8',
    ),
  ) as Fixture;
}

function headers(userId: string) {
  return { 'x-user-id': userId, 'content-type': 'application/json' };
}

async function json<T>(res: Response | unknown): Promise<{ status: number; body: T }> {
  const r = res as Response;
  return { status: r.status, body: (await r.json()) as T };
}

describe('lifecycle.e2e', () => {
  let direct: ReturnType<typeof createDirectDb>;
  let workspaceId: string;

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
      await tx.execute(sql`delete from auth.users where id = ${OWNER}::uuid`);
      const provisioned = await signupViaAuthTrigger(tx, {
        userId: OWNER,
        email: 'owner-e2e@test.local',
        workspaceName: 'E2E',
      });
      workspaceId = provisioned.workspaceId;
    });
  });

  it('runs draft → tested → published → edit → rollback with immutable versions', async () => {
    const pricing = loadPricing();
    const h = headers(OWNER);

    const created = await json<{ id: string; status: string }>(
      await createRule(
        new Request('http://localhost/api/v1/rules', {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ name: 'Dynamic pricing', type: 'decision_table', slug: 'dynamic-pricing' }),
        }),
      ),
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    const ruleId = created.body.id;

    const patched = await json<{ status: string }>(
      await patchRule(
        new Request(`http://localhost/api/v1/rules/${ruleId}`, {
          method: 'PATCH',
          headers: h,
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
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('draft');

    await putGlobal(
      new Request('http://localhost/api/v1/globals/min_price_policy', {
        method: 'PUT',
        headers: h,
        body: JSON.stringify({ value: 18000 }),
      }),
      { params: Promise.resolve({ name: 'min_price_policy' }) },
    );

    const publishTooEarly = await json<{ status: number }>(
      await publishRule(
        new Request(`http://localhost/api/v1/rules/${ruleId}/publish`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ env: 'staging' }),
        }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(publishTooEarly.status).toBe(409);

    const tested = await json<{
      status: string;
      output: { final_price: number };
    }>(
      await testRule(
        new Request(`http://localhost/api/v1/rules/${ruleId}/test`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(tested.status).toBe(200);
    expect(tested.body.status).toBe('success');
    expect(tested.body.output.final_price).toBe(18000);

    const afterTest = await json<{ status: string }>(
      await getRule(new Request(`http://localhost/api/v1/rules/${ruleId}`, { headers: h }), {
        params: Promise.resolve({ id: ruleId }),
      }),
    );
    expect(afterTest.body.status).toBe('tested');

    const pubStaging = await json<{ versionId: string; version: number }>(
      await publishRule(
        new Request(`http://localhost/api/v1/rules/${ruleId}/publish`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ env: 'staging', changelog: 'v1 staging' }),
        }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(pubStaging.status).toBe(200);
    expect(pubStaging.body.version).toBe(1);
    const v1 = pubStaging.body.versionId;

    let envs = await json<{
      staging: { versionId: string; version: number } | null;
      production: { versionId: string; version: number } | null;
    }>(
      await listEnvironments(
        new Request(`http://localhost/api/v1/rules/${ruleId}/environments`, { headers: h }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(envs.body.staging?.versionId).toBe(v1);
    expect(envs.body.staging?.version).toBe(1);
    expect(envs.body.production).toBeNull();

    const pubProd = await json<{ versionId: string; version: number }>(
      await publishRule(
        new Request(`http://localhost/api/v1/rules/${ruleId}/publish`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ env: 'production', changelog: 'v2 prod' }),
        }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(pubProd.status).toBe(200);
    expect(pubProd.body.version).toBe(2);
    const v2 = pubProd.body.versionId;

    envs = await json(await listEnvironments(
      new Request(`http://localhost/api/v1/rules/${ruleId}/environments`, { headers: h }),
      { params: Promise.resolve({ id: ruleId }) },
    ));
    expect(envs.body.staging?.versionId).toBe(v1);
    expect(envs.body.production?.versionId).toBe(v2);

    // Edit draft (change a discount) → status draft; both env pointers unchanged
    const editedDef = structuredClone(pricing.def) as {
      rows: Array<{
        id: string;
        actions?: Array<{
          kind: string;
          key?: string;
          expr?: {
            kind: string;
            name?: string;
            args?: Array<{
              kind: string;
              op?: string;
              right?: { kind: string; value: number };
            }>;
          };
        }>;
      }>;
    };
    const intlVolume = editedDef.rows.find((r) => r.id === 'chevy_international_volume');
    const discountAction = intlVolume?.actions?.find((a) => a.key === 'discount');
    const mult = discountAction?.expr?.args?.[0]?.right;
    expect(mult?.value).toBe(0.88);
    mult!.value = 0.8;

    const edited = await json<{ status: string }>(
      await patchRule(
        new Request(`http://localhost/api/v1/rules/${ruleId}`, {
          method: 'PATCH',
          headers: h,
          body: JSON.stringify({
            draftDefinition: editedDef,
            description: 'edited discount draft',
          }),
        }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('draft');

    envs = await json(await listEnvironments(
      new Request(`http://localhost/api/v1/rules/${ruleId}/environments`, { headers: h }),
      { params: Promise.resolve({ id: ruleId }) },
    ));
    expect(envs.body.staging?.versionId).toBe(v1);
    expect(envs.body.production?.versionId).toBe(v2);

    const retest = await json<{ status: string }>(
      await testRule(
        new Request(`http://localhost/api/v1/rules/${ruleId}/test`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(retest.status).toBe(200);

    const afterRetest = await json<{ status: string }>(
      await getRule(new Request(`http://localhost/api/v1/rules/${ruleId}`, { headers: h }), {
        params: Promise.resolve({ id: ruleId }),
      }),
    );
    expect(afterRetest.body.status).toBe('tested');

    const pubV3 = await json<{ versionId: string; version: number }>(
      await publishRule(
        new Request(`http://localhost/api/v1/rules/${ruleId}/publish`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ env: 'production', changelog: 'v3' }),
        }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(pubV3.body.version).toBe(3);

    const versionsBeforeRollback = await json<{ items: Array<{ id: string; version: number }> }>(
      await listVersions(
        new Request(`http://localhost/api/v1/rules/${ruleId}/versions`, { headers: h }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(versionsBeforeRollback.body.items.map((v) => v.version)).toEqual([3, 2, 1]);

    const rolled = await json<{ env: string; versionId: string }>(
      await rollbackRule(
        new Request(`http://localhost/api/v1/rules/${ruleId}/rollback`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ env: 'production', versionId: v2 }),
        }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(rolled.status).toBe(200);
    expect(rolled.body.versionId).toBe(v2);

    envs = await json(await listEnvironments(
      new Request(`http://localhost/api/v1/rules/${ruleId}/environments`, { headers: h }),
      { params: Promise.resolve({ id: ruleId }) },
    ));
    expect(envs.body.production?.versionId).toBe(v2);

    const versionsAfter = await json<{ items: Array<{ version: number }> }>(
      await listVersions(
        new Request(`http://localhost/api/v1/rules/${ruleId}/versions`, { headers: h }),
        { params: Promise.resolve({ id: ruleId }) },
      ),
    );
    expect(versionsAfter.body.items).toHaveLength(3);

    const statusAfterRollback = await json<{ status: string }>(
      await getRule(new Request(`http://localhost/api/v1/rules/${ruleId}`, { headers: h }), {
        params: Promise.resolve({ id: ruleId }),
      }),
    );
    expect(statusAfterRollback.body.status).toBe('published');

    await expect(
      withServiceRole(direct.db, async (tx) => {
        await tx
          .update(ruleVersions)
          .set({ changelog: 'tampered' })
          .where(eq(ruleVersions.id, v1));
      }),
    ).rejects.toThrow(/immutable|append-only/i);

    expect(workspaceId).toBeTruthy();
  });
});
