import { listGlobals } from '@rule-engine/db';
import { withAuth } from '../../../../lib/auth/require.js';
import { problem } from '../../../../lib/session.js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withAuth(request, 'viewer', async ({ db, workspaceId }) => {
    const result = await listGlobals(db, workspaceId);
    if (!result) return problem(404, 'Not Found', 'Workspace not found');
    return Response.json(result);
  });
}
