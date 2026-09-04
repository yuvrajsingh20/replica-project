import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  createDirectDb,
  getDirectUrl,
  withServiceRole,
  signupViaAuthTrigger,
  reassignUserWorkspace,
  sql,
} from '@rule-engine/db';
import { POST as createRule } from '../src/app/api/v1/rules/route.js';
import { POST as publishRule } from '../src/app/api/v1/rules/[id]/publish/route.js';
import { POST as testRule } from '../src/app/api/v1/rules/[id]/test/route.js';
import { POST as createApiKey } from '../src/app/api/v1/api-keys/route.js';
import { PATCH as patchRule } from '../src/app/api/v1/rules/[id]/route.js';

const OWNER = 'aaaaaaaa-1111-1111-1111-111111111111';
const EDITOR = 'bbbbbbbb-2222-2222-2222-222222222222';
const VIEWER = 'cccccccc-3333-3333-3333-333333333333';

function headers(userId: string) {
  return { 'x-user-id': userId, 'content-type': 'application/json' };
}

describe('rbac', () => {
  let direct: ReturnType<typeof createDirectDb>;
  let ruleId: string;

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
        sql`delete from auth.users where id in (${OWNER}::uuid, ${EDITOR}::uuid, ${VIEWER}::uuid)`,
      );

      const owner = await signupViaAuthTrigger(tx, {
        userId: OWNER,
        email: 'owner-rbac@test.local',
      });
      await signupViaAuthTrigger(tx, { userId: EDITOR, email: 'editor-rbac@test.local' });
      await signupViaAuthTrigger(tx, { userId: VIEWER, email: 'viewer-rbac@test.local' });
      await reassignUserWorkspace(tx, {
        userId: EDITOR,
        workspaceId: owner.workspaceId,
        role: 'editor',
        deleteOldWorkspace: true,
      });
      await reassignUserWorkspace(tx, {
        userId: VIEWER,
        workspaceId: owner.workspaceId,
        role: 'viewer',
        deleteOldWorkspace: true,
      });
    });

    const created = await createRule(
      new Request('http://localhost/api/v1/rules', {
        method: 'POST',
        headers: headers(OWNER),
        body: JSON.stringify({ name: 'RBAC rule', type: 'simple', slug: 'rbac-rule' }),
      }),
    );
    const body = (await (created as Response).json()) as { id: string };
    ruleId = body.id;

    await patchRule(
      new Request(`http://localhost/api/v1/rules/${ruleId}`, {
        method: 'PATCH',
        headers: headers(OWNER),
        body: JSON.stringify({
          sampleInput: {},
          draftDefinition: { type: 'simple', when: { logic: 'and', items: [] }, then: [] },
        }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );

    await testRule(
      new Request(`http://localhost/api/v1/rules/${ruleId}/test`, {
        method: 'POST',
        headers: headers(OWNER),
        body: JSON.stringify({ input: {} }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );
  });

  it('viewer gets 403 on publish; editor succeeds', async () => {
    const viewerPub = await publishRule(
      new Request(`http://localhost/api/v1/rules/${ruleId}/publish`, {
        method: 'POST',
        headers: headers(VIEWER),
        body: JSON.stringify({ env: 'staging' }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );
    expect((viewerPub as Response).status).toBe(403);

    const editorPub = await publishRule(
      new Request(`http://localhost/api/v1/rules/${ruleId}/publish`, {
        method: 'POST',
        headers: headers(EDITOR),
        body: JSON.stringify({ env: 'staging' }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );
    expect((editorPub as Response).status).toBe(200);
  });

  it('non-owner gets 403 on api-key create', async () => {
    const editorKey = await createApiKey(
      new Request('http://localhost/api/v1/api-keys', {
        method: 'POST',
        headers: headers(EDITOR),
        body: JSON.stringify({ name: 'k', env: 'staging' }),
      }),
    );
    expect((editorKey as Response).status).toBe(403);

    const ownerKey = await createApiKey(
      new Request('http://localhost/api/v1/api-keys', {
        method: 'POST',
        headers: headers(OWNER),
        body: JSON.stringify({ name: 'k', env: 'staging' }),
      }),
    );
    expect((ownerKey as Response).status).toBe(201);
  });
});
