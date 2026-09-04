import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { assertSafeDatabaseUrl, getDatabaseUrl } from '../src/db/env.js';

describe('api health (execute-only shell)', () => {
  let app: FastifyInstance;
  let client: ReturnType<typeof createDb>['client'];
  let db: ReturnType<typeof createDb>['db'];

  beforeAll(async () => {
    // Legacy api env still uses DATABASE_URL; prefer same peer URL as packages/db
    const url =
      process.env['DATABASE_URL'] ??
      'postgresql:///express_writer?host=/var/run/postgresql&options=-csearch_path%3Drule_engine_p2_dev';
    process.env['DATABASE_URL'] = url;
    assertSafeDatabaseUrl(getDatabaseUrl());
    ({ db, client } = createDb(url));
    app = await buildApp({ db, sql: client, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.end({ timeout: 5 });
  });

  it('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: true });
  });

  it('Swagger docs render', async () => {
    const docs = await app.inject({ method: 'GET', url: '/docs' });
    expect(docs.statusCode).toBe(200);
  });

  it('management routes are gone', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/rules' });
    expect(res.statusCode).toBe(404);
  });
});
