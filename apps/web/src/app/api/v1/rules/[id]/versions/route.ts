import { listVersions } from '@rule-engine/db';
import { z } from 'zod';
import { withAuth } from '../../../../../../lib/auth/require.js';
import { problem } from '../../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  full: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return problem(400, 'Bad Request', 'Invalid query');

  return withAuth(request, 'viewer', async ({ db, workspaceId }) => {
    const result = await listVersions(db, {
      workspaceId,
      ruleId: id,
      limit: parsed.data.limit,
      ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.full !== undefined ? { full: parsed.data.full } : {}),
    });
    if (!result) return problem(404, 'Not Found', 'Rule not found');
    return Response.json(result);
  });
}
