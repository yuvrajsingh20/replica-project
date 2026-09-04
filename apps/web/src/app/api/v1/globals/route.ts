import { listGlobals } from '@rule-engine/db';
import { problem, withSession } from '../../../../lib/session.js';

export async function GET(request: Request) {
  return withSession(request, async ({ db, workspaceId }) => {
    const result = await listGlobals(db, workspaceId);
    if (!result) return problem(404, 'Not Found', 'Workspace not found');
    return Response.json(result);
  });
}
