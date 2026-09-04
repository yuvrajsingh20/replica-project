import { getVersion } from '@rule-engine/db';
import { withAuth } from '../../../../../../../lib/auth/require.js';
import { problem } from '../../../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; versionId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id, versionId } = await ctx.params;
  return withAuth(request, 'viewer', async ({ db, workspaceId }) => {
    const version = await getVersion(db, { workspaceId, ruleId: id, versionId });
    if (!version) return problem(404, 'Not Found', 'Version not found');
    return Response.json(version);
  });
}
