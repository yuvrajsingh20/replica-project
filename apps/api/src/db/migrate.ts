/**
 * Run migrations. Hard-refuses non-dev DATABASE_URL.
 * Usage: pnpm --filter @rule-engine/api db:migrate
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import { createDb } from './client.js';
import { assertSafeDatabaseUrl, getDatabaseUrl } from './env.js';

async function main(): Promise<void> {
  const url = getDatabaseUrl();
  assertSafeDatabaseUrl(url);

  const { db, client } = createDb(url);
  const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
  try {
    await migrate(db, { migrationsFolder });
    process.stdout.write('Migrations applied.\n');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
