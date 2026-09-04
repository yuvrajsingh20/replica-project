import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import * as schema from './db/schema.js';
import { healthRoutes } from './routes/health.js';

export type AppDb = PostgresJsDatabase<typeof schema>;

export const schemaRef = schema;

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDb;
    sql: Sql;
  }
}

export type BuildAppOptions = {
  db: AppDb;
  sql: Sql;
  logger?: boolean;
};

/**
 * Phase 2+: Fastify is execute-only. Management CRUD lives in Next.js.
 * /v1/execute arrives in Phase 4.
 */
export async function buildApp(opts: BuildAppOptions) {
  const app = Fastify({
    logger: opts.logger ?? true,
  });

  app.decorate('db', opts.db);
  app.decorate('sql', opts.sql);

  await app.register(cors, { origin: true });
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Rule Engine Execute API',
        description: 'Fastify execute surface only — management is apps/web',
        version: '0.2.0',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(healthRoutes);

  return app;
}
