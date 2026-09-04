import { createDb } from './db/client.js';
import { assertSafeDatabaseUrl, getDatabaseUrl } from './db/env.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const url = getDatabaseUrl();
  assertSafeDatabaseUrl(url);
  const { db, client } = createDb(url);
  const app = await buildApp({ db, sql: client });

  const port = Number(process.env['PORT'] ?? 3001);
  const host = process.env['HOST'] ?? '127.0.0.1';

  await app.listen({ port, host });
  app.log.info(`listening on http://${host}:${port}  docs at /docs`);

  const shutdown = async () => {
    await app.close();
    await client.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
