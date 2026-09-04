import { createApiKey, listApiKeys } from '@rule-engine/db';
import { z } from 'zod';
import { withAuth } from '../../../../lib/auth/require.js';
import { problem } from '../../../../lib/session.js';

export const dynamic = 'force-dynamic';

const createBody = z.object({
  name: z.string().min(1),
  env: z.enum(['staging', 'production']),
});

export async function GET(request: Request) {
  return withAuth(request, 'viewer', async ({ db, workspaceId }) => {
    return Response.json(await listApiKeys(db, workspaceId));
  });
}

export async function POST(request: Request) {
  const body = createBody.safeParse(await request.json());
  if (!body.success) return problem(400, 'Bad Request', 'Invalid body');

  return withAuth(request, 'owner', async ({ db, workspaceId }) => {
    const key = await createApiKey(db, {
      workspaceId,
      name: body.data.name,
      env: body.data.env,
    });
    return Response.json(key, { status: 201 });
  });
}
