/**
 * Seed: 1 workspace, 1 owner, 1 simple rule, 1 decision table, dynamic-pricing globals.
 * Usage: pnpm --filter @rule-engine/api db:seed
 */
import { hashSync } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb } from './client.js';
import { assertSafeDatabaseUrl, getDatabaseUrl } from './env.js';
import {
  globalVariables,
  rules,
  users,
  workspaces,
} from './schema.js';
import { newId } from '../lib/ids.js';
import { validateCompilableDefinition } from '../lib/validate-definition.js';

type Fixture = {
  schema: unknown;
  def: unknown;
};

function loadFixture(name: string): Fixture {
  const path = resolve(
    import.meta.dirname,
    '../../../../packages/engine/test/fixtures',
    name,
  );
  return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

async function main(): Promise<void> {
  const url = getDatabaseUrl();
  assertSafeDatabaseUrl(url);
  const { db, client } = createDb(url);

  try {
    const existing = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, 'demo'))
      .limit(1);

    if (existing[0]) {
      process.stdout.write(`Seed already present (workspace ${existing[0].id}).\n`);
      return;
    }

    const workspaceId = newId('ws');
    const userId = newId('usr');

    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Demo Workspace',
      slug: 'demo',
      globalsVersion: 0,
    });

    await db.insert(users).values({
      id: userId,
      workspaceId,
      email: 'owner@demo.local',
      passwordHash: hashSync('demo-password', 10),
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
      await db.insert(rules).values({
        id: newId('rul'),
        workspaceId,
        slug,
        name,
        description: `Seeded ${name}`,
        type,
        status: 'draft',
        draftDefinition: checked.definition,
        inputSchema: checked.inputSchema,
        sampleInput: type === 'simple' ? { order: { total: 150 } } : {
          brand: 'Chevrolet',
          market: 'domestic',
          inventory: 40,
          list_price: 25000,
        },
        createdBy: userId,
      });
    }

    await db.insert(globalVariables).values({
      id: newId('gvar'),
      workspaceId,
      name: 'min_price_policy',
      value: 18000,
    });
    await db
      .update(workspaces)
      .set({ globalsVersion: 1 })
      .where(eq(workspaces.id, workspaceId));

    process.stdout.write(
      JSON.stringify(
        {
          workspaceId,
          userId,
          email: 'owner@demo.local',
          globals: { min_price_policy: 18000 },
          globalsVersion: 1,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
