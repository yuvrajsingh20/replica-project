import { listEnvironments } from '@rule-engine/db';
import { withAuth } from '../../../../../../lib/auth/require.js';
import { problem } from '../../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withAuth(request, 'viewer', async ({ db, workspaceId }) => {
    const result = await listEnvironments(db, { workspaceId, ruleId: id });
    if (!result) return problem(404, 'Not Found', 'Rule not found');
    return Response.json(result);
  });
}
