import { revokeApiKey } from '@rule-engine/db';
import { withAuth } from '../../../../../lib/auth/require.js';
import { problem } from '../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withAuth(request, 'owner', async ({ db, workspaceId }) => {
    const ok = await revokeApiKey(db, workspaceId, id);
    if (!ok) return problem(404, 'Not Found', 'API key not found');
    return new Response(null, { status: 204 });
  });
}
