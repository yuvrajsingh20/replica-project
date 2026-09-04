import { rollbackRule } from '@rule-engine/db';
import { z } from 'zod';
import { withAuth } from '../../../../../../lib/auth/require.js';
import { problem } from '../../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  env: z.enum(['staging', 'production']),
  versionId: z.string().min(1),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = bodySchema.safeParse(await request.json());
  if (!body.success) return problem(400, 'Bad Request', 'Invalid body');

  return withAuth(request, 'editor', async ({ db, workspaceId }) => {
    const result = await rollbackRule(db, {
      workspaceId,
      ruleId: id,
      env: body.data.env,
      versionId: body.data.versionId,
    });
    if (!result.ok) {
      return problem(result.error.status, result.error.title, result.error.detail);
    }
    return Response.json({ env: result.env, versionId: result.versionId });
  });
}
