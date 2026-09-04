import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  assertNotDirectPort,
  createDirectDb,
  createRule,
  createRuntimeDb,
  getDirectUrl,
  listGlobals,
  listRules,
  rules,
  withServiceRole,
  withUser,
  globalVariables,
  apiKeys,
  executions,
  newId,
  signupViaAuthTrigger,
} from '../src/index.js';

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('env guards', () => {
  it('refuses runtime URL on port 5432', () => {
    expect(() =>
      assertNotDirectPort('postgres://u:p@db.example.com:5432/postgres'),
    ).toThrow(/5432/);
  });

  it('allows pooler-style URLs without :5432', () => {
    expect(() =>
      assertNotDirectPort(
        'postgresql:///express_writer?host=/var/run/postgresql&options=-csearch_path%3Drule_engine_p2',
      ),
    ).not.toThrow();
  });
});

describe('RLS tenant isolation', () => {
  let direct: ReturnType<typeof createDirectDb>;
  let runtime: ReturnType<typeof createRuntimeDb>;
  let wsA: string;
  let wsB: string;

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
      await tx.execute(sql`delete from auth.users where id in (${USER_A}::uuid, ${USER_B}::uuid)`);

      const a = await signupViaAuthTrigger(tx, {
        userId: USER_A,
        email: 'a@test.local',
        workspaceName: 'A',
      });
      const b = await signupViaAuthTrigger(tx, {
        userId: USER_B,
        email: 'b@test.local',
        workspaceName: 'B',
      });
      wsA = a.workspaceId;
      wsB = b.workspaceId;

      await createRule(tx, {
        workspaceId: wsA,
        userId: USER_A,
        name: 'Rule A',
        type: 'simple',
        slug: 'rule-a',
      });
      await createRule(tx, {
        workspaceId: wsB,
        userId: USER_B,
        name: 'Rule B',
        type: 'simple',
        slug: 'rule-b',
      });

      await tx.insert(globalVariables).values([
        {
          id: newId('gvar'),
          workspaceId: wsA,
          name: 'secret_a',
          value: 1,
        },
        {
          id: newId('gvar'),
          workspaceId: wsB,
          name: 'secret_b',
          value: 2,
        },
      ]);
      await tx.insert(apiKeys).values([
        {
          id: newId('key'),
          workspaceId: wsA,
          name: 'ka',
          keyHash: 'hash-a',
          keyPrefix: 're_aaaaa',
          env: 'staging',
        },
        {
          id: newId('key'),
          workspaceId: wsB,
          name: 'kb',
          keyHash: 'hash-b',
          keyPrefix: 're_bbbbb',
          env: 'staging',
        },
      ]);
    });
  });

  it('workspace A cannot read workspace B rules, globals, or keys', async () => {
    await withUser(runtime.db, USER_A, async (tx) => {
      const aRules = await listRules(tx, wsA, { page: 1, limit: 20 });
      expect(aRules.total).toBe(1);
      expect(aRules.items[0]?.slug).toBe('rule-a');

      const leakRules = await tx.select().from(rules).where(sql`true`);
      expect(leakRules.every((r) => r.workspaceId === wsA)).toBe(true);
      expect(leakRules.some((r) => r.workspaceId === wsB)).toBe(false);

      const globals = await listGlobals(tx, wsA);
      expect(globals?.items.map((g) => g.name)).toEqual(['secret_a']);

      const allGlobals = await tx.select().from(globalVariables);
      expect(allGlobals.every((g) => g.workspaceId === wsA)).toBe(true);

      const keys = await tx.select().from(apiKeys);
      expect(keys.every((k) => k.workspaceId === wsA)).toBe(true);
      expect(keys.some((k) => k.workspaceId === wsB)).toBe(false);

      const execs = await tx.select().from(executions);
      expect(execs).toEqual([]);
    });
  });

  it('workspace B cannot read workspace A data', async () => {
    await withUser(runtime.db, USER_B, async (tx) => {
      const listed = await listRules(tx, wsB, { page: 1, limit: 20 });
      expect(listed.items[0]?.slug).toBe('rule-b');
      const all = await tx.select().from(rules);
      expect(all.some((r) => r.slug === 'rule-a')).toBe(false);
    });
  });
});
