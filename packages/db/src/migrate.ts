/**
 * Run migrations against DIRECT_URL only.
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import { createDirectDb } from './client.js';
import { getDirectUrl } from './env.js';

async function main(): Promise<void> {
  const url = getDirectUrl();
  const { db, client } = createDirectDb(url);
  const migrationsFolder = resolve(import.meta.dirname, '../drizzle');
  try {
    await migrate(db, { migrationsFolder });
    process.stdout.write('Migrations applied (DIRECT_URL).\n');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
