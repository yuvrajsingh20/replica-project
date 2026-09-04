import { testRule } from '@rule-engine/db';
import { z } from 'zod';
import { withAuth } from '../../../../../../lib/auth/require.js';
import { problem } from '../../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  input: z.unknown().optional(),
  globalsOverride: z.record(z.unknown()).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return problem(400, 'Bad Request', 'Invalid body');

  return withAuth(request, 'editor', async ({ db, workspaceId }) => {
    const result = await testRule(db, {
      workspaceId,
      ruleId: id,
      ...(body.data.input !== undefined ? { input: body.data.input } : {}),
      ...(body.data.globalsOverride !== undefined
        ? { globalsOverride: body.data.globalsOverride }
        : {}),
    });
    if (!result.ok) {
      return problem(result.error.status, result.error.title, result.error.detail, {
        ...(result.error.path ? { path: result.error.path } : {}),
        ...(result.error.issues ? { issues: result.error.issues } : {}),
      });
    }
    return Response.json(result.result);
  });
}
