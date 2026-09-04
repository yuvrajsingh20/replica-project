import {
  createRuntimeDb,
  getUserWorkspaceId,
  withUser,
  type Db,
} from '@rule-engine/db';
import { createClient } from '@supabase/supabase-js';

export type SessionContext = {
  userId: string;
  workspaceId: string;
  db: Db;
  client: ReturnType<typeof createRuntimeDb>['client'];
};

/**
 * Resolve the signed-in user.
 * - Prefer Supabase session when SUPABASE env is set.
 * - In test/dev, accept X-User-Id for RLS-scoped handlers (Phase 2).
 */
export async function resolveUserId(request: Request): Promise<string | null> {
  const testUser = request.headers.get('x-user-id');
  if (testUser && process.env['ALLOW_TEST_USER_HEADER'] === '1') {
    return testUser;
  }

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !anon) return testUser;

  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!accessToken) return testUser;

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data } = await supabase.auth.getUser(accessToken);
  return data.user?.id ?? testUser;
}

export async function withSession<T>(
  request: Request,
  fn: (ctx: SessionContext) => Promise<T>,
): Promise<T | Response> {
  const userId = await resolveUserId(request);
  if (!userId) {
    return Response.json(
      {
        type: 'https://httpstatuses.com/401',
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing session',
      },
      { status: 401, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  const { db, client } = createRuntimeDb();
  try {
    return await withUser(db, userId, async (tx) => {
      const workspaceId = await getUserWorkspaceId(tx, userId);
      if (!workspaceId) {
        throw new SessionError(403, 'Forbidden', 'No workspace membership');
      }
      return fn({ userId, workspaceId, db: tx, client });
    });
  } catch (err) {
    if (err instanceof SessionError) {
      return Response.json(
        {
          type: `https://httpstatuses.com/${err.status}`,
          title: err.title,
          status: err.status,
          detail: err.detail,
        },
        { status: err.status, headers: { 'content-type': 'application/problem+json' } },
      );
    }
    throw err;
  } finally {
    await client.end({ timeout: 5 });
  }
}

export class SessionError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

export function problem(
  status: number,
  title: string,
  detail?: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    {
      type: `https://httpstatuses.com/${status}`,
      title,
      status,
      ...(detail !== undefined ? { detail } : {}),
      ...extra,
    },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}
