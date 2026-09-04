import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              db: { type: 'boolean' },
            },
            required: ['status', 'db'],
          },
        },
      },
    },
    async (_request, reply) => {
      let dbOk = false;
      try {
        await app.db.execute(sql`select 1`);
        dbOk = true;
      } catch {
        dbOk = false;
      }
      return reply.send({ status: dbOk ? 'ok' : 'degraded', db: dbOk });
    },
  );
};
