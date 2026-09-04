import { revokeApiKey } from '@rule-engine/db';
import { problem, withSession } from '../../../../../lib/session.js';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withSession(request, async ({ db, workspaceId }) => {
    const ok = await revokeApiKey(db, workspaceId, id);
    if (!ok) return problem(404, 'Not Found', 'API key not found');
    return new Response(null, { status: 204 });
  });
}
