import { deleteGlobal, upsertGlobal } from '@rule-engine/db';
import { z } from 'zod';
import { withAuth } from '../../../../../lib/auth/require.js';
import { problem } from '../../../../../lib/session.js';

export const dynamic = 'force-dynamic';

const nameParam = z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
const upsertBody = z.object({ value: z.unknown() });

type Ctx = { params: Promise<{ name: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  const { name } = await ctx.params;
  const parsedName = nameParam.safeParse(name);
  if (!parsedName.success) return problem(400, 'Bad Request', 'Invalid name');
  const body = upsertBody.safeParse(await request.json());
  if (!body.success) return problem(400, 'Bad Request', 'Invalid body');

  return withAuth(request, 'editor', async ({ db, workspaceId }) => {
    const result = await upsertGlobal(db, workspaceId, parsedName.data, body.data.value);
    return Response.json(result, { status: result.created ? 201 : 200 });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { name } = await ctx.params;
  const parsedName = nameParam.safeParse(name);
  if (!parsedName.success) return problem(400, 'Bad Request', 'Invalid name');

  return withAuth(request, 'editor', async ({ db, workspaceId }) => {
    const result = await deleteGlobal(db, workspaceId, parsedName.data);
    if (!result.deleted) return problem(404, 'Not Found', 'Global variable not found');
    return Response.json({
      deleted: true,
      name: parsedName.data,
      globalsVersion: result.globalsVersion,
    });
  });
}
