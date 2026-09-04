import { createRule, listRules } from '@rule-engine/db';
import { z } from 'zod';
import { withAuth } from '../../../../lib/auth/require.js';
import { problem } from '../../../../lib/session.js';

export const dynamic = 'force-dynamic';

const createBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  type: z.enum(['simple', 'decision_table']),
  description: z.string().optional(),
});

const listQuery = z.object({
  status: z.enum(['draft', 'tested', 'published']).optional(),
  type: z.enum(['simple', 'decision_table']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return problem(400, 'Bad Request', 'Invalid query');
  }

  return withAuth(request, 'viewer', async ({ db, workspaceId }) => {
    const result = await listRules(db, workspaceId, parsed.data);
    return Response.json(result);
  });
}

export async function POST(request: Request) {
  const body = createBody.safeParse(await request.json());
  if (!body.success) {
    return problem(400, 'Bad Request', 'Invalid body');
  }

  return withAuth(request, 'editor', async ({ db, workspaceId, userId }) => {
    const result = await createRule(db, {
      workspaceId,
      userId,
      name: body.data.name,
      type: body.data.type,
      ...(body.data.slug !== undefined ? { slug: body.data.slug } : {}),
      ...(body.data.description !== undefined
        ? { description: body.data.description }
        : {}),
    });
    if (!result.ok) {
      return problem(result.error.status, result.error.title, result.error.detail, {
        ...(result.error.path ? { path: result.error.path } : {}),
        ...(result.error.issues ? { issues: result.error.issues } : {}),
      });
    }
    return Response.json(result.rule, { status: 201 });
  });
}
