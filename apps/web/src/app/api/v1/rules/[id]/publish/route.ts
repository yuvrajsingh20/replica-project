import { publishRule } from '@rule-engine/db';
import { z } from 'zod';
import { withAuth } from '../../../../../../lib/auth/require.js';
import { problem } from '../../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  env: z.enum(['staging', 'production']),
  changelog: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = bodySchema.safeParse(await request.json());
  if (!body.success) return problem(400, 'Bad Request', 'Invalid body');

  return withAuth(request, 'editor', async ({ db, workspaceId, userId }) => {
    const result = await publishRule(db, {
      workspaceId,
      ruleId: id,
      userId,
      env: body.data.env,
      ...(body.data.changelog !== undefined ? { changelog: body.data.changelog } : {}),
    });
    if (!result.ok) {
      return problem(result.error.status, result.error.title, result.error.detail, {
        ...(result.error.path ? { path: result.error.path } : {}),
        ...(result.error.issues ? { issues: result.error.issues } : {}),
      });
    }
    return Response.json({ versionId: result.versionId, version: result.version });
  });
}
