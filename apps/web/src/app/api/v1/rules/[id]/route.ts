import { getRule, patchRule, softDeleteRule } from '@rule-engine/db';
import { z } from 'zod';
import { withAuth } from '../../../../../lib/auth/require.js';
import { problem } from '../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

const patchBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  draftDefinition: z.unknown().optional(),
  inputSchema: z.unknown().optional(),
  sampleInput: z.unknown().nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withAuth(request, 'viewer', async ({ db, workspaceId }) => {
    const rule = await getRule(db, workspaceId, id);
    if (!rule) return problem(404, 'Not Found', 'Rule not found');
    return Response.json(rule);
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = patchBody.safeParse(await request.json());
  if (!body.success) return problem(400, 'Bad Request', 'Invalid body');

  return withAuth(request, 'editor', async ({ db, workspaceId }) => {
    const result = await patchRule(db, workspaceId, id, body.data);
    if (!result.ok) {
      return problem(result.error.status, result.error.title, result.error.detail, {
        ...(result.error.path ? { path: result.error.path } : {}),
        ...(result.error.issues ? { issues: result.error.issues } : {}),
      });
    }
    return Response.json(result.rule);
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withAuth(request, 'editor', async ({ db, workspaceId }) => {
    const ok = await softDeleteRule(db, workspaceId, id);
    if (!ok) return problem(404, 'Not Found', 'Rule not found');
    return new Response(null, { status: 204 });
  });
}
