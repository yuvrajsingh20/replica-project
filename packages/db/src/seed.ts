/**
 * Seed: 1 workspace, 1 auth user + profile, simple rule, dynamic-pricing DT, min_price_policy global.
 */
import { eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDirectDb } from './client.js';
import { getDirectUrl } from './env.js';
import { upsertGlobalInTransaction } from './globals.js';
import { newId } from './ids.js';
import { rules, users, workspaces } from './schema.js';
import { syncSessionWorkspace, withServiceRole } from './service-role.js';
import { validateCompilableDefinition } from './validate-definition.js';

const DEMO_USER_ID = '11111111-1111-1111-1111-111111111111';

type Fixture = { schema: unknown; def: unknown };

function loadFixture(name: string): Fixture {
  const path = resolve(import.meta.dirname, '../../engine/test/fixtures', name);
  return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

async function main(): Promise<void> {
  const { db, client } = createDirectDb(getDirectUrl());
  try {
    await withServiceRole(db, async (tx) => {
      const existing = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, 'demo'))
        .limit(1);
      if (existing[0]) {
        process.stdout.write(`Seed already present (workspace ${existing[0].id}).\n`);
        return;
      }

      await tx.execute(sql`
        insert into auth.users (id, email)
        values (${DEMO_USER_ID}::uuid, 'owner@demo.local')
        on conflict (id) do nothing
      `);

      const workspaceId = newId('ws');
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: 'Demo Workspace',
        slug: 'demo',
        globalsVersion: 0,
      });

      await tx.insert(users).values({
        id: DEMO_USER_ID,
        workspaceId,
        email: 'owner@demo.local',
        role: 'owner',
      });
      await syncSessionWorkspace(tx, {
        userId: DEMO_USER_ID,
        workspaceId,
        role: 'owner',
      });

      const simple = loadFixture('simple-tier.json');
      const pricing = loadFixture('dynamic-pricing.json');

      for (const [slug, name, type, fixture] of [
        ['order-tier', 'Order tier', 'simple', simple],
        ['dynamic-pricing', 'Dynamic pricing', 'decision_table', pricing],
      ] as const) {
        const checked = validateCompilableDefinition(fixture.def, fixture.schema);
        if (!checked.ok) {
          throw new Error(`Seed fixture ${slug} invalid: ${checked.error.detail}`);
        }
        await tx.insert(rules).values({
          id: newId('rul'),
          workspaceId,
          slug,
          name,
          description: `Seeded ${name}`,
          type,
          status: 'draft',
          draftDefinition: checked.definition,
          inputSchema: checked.inputSchema,
          sampleInput:
            type === 'simple'
              ? { order: { total: 150 } }
              : {
                  brand: 'Chevrolet',
                  market: 'domestic',
                  inventory: 40,
                  list_price: 25000,
                },
          createdBy: DEMO_USER_ID,
        });
      }

      const g = await upsertGlobalInTransaction(tx, {
        workspaceId,
        name: 'min_price_policy',
        value: 18000,
      });

      process.stdout.write(
        JSON.stringify(
          {
            workspaceId,
            userId: DEMO_USER_ID,
            email: 'owner@demo.local',
            globals: { min_price_policy: 18000 },
            globalsVersion: g.globalsVersion,
          },
          null,
          2,
        ) + '\n',
      );
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
