import { createApiKey, listApiKeys } from '@rule-engine/db';
import { z } from 'zod';
import { problem, withSession } from '../../../../lib/session.js';

const createBody = z.object({
  name: z.string().min(1),
  env: z.enum(['staging', 'production']),
});

export async function GET(request: Request) {
  return withSession(request, async ({ db, workspaceId }) => {
    return Response.json(await listApiKeys(db, workspaceId));
  });
}

export async function POST(request: Request) {
  const body = createBody.safeParse(await request.json());
  if (!body.success) return problem(400, 'Bad Request', 'Invalid body');

  return withSession(request, async ({ db, workspaceId }) => {
    const key = await createApiKey(db, {
      workspaceId,
      name: body.data.name,
      env: body.data.env,
    });
    return Response.json(key, { status: 201 });
  });
}
