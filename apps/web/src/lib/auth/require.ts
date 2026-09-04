import { eq } from 'drizzle-orm';
import {
  createRuntimeDb,
  getUserWorkspaceId,
  users,
  withUser,
  type Db,
} from '@rule-engine/db';
import { createClient as createServerSupabase } from '../supabase/server.js';
import { SessionError, problem } from '../session.js';

export type AuthRole = 'viewer' | 'editor' | 'owner';

export type AuthCtx = {
  userId: string;
  workspaceId: string;
  role: AuthRole;
  db: Db;
};

const ROLE_RANK: Record<AuthRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export function roleAtLeast(role: AuthRole, min: AuthRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

async function resolveSessionUserId(request?: Request): Promise<string | null> {
  if (request) {
    const testUser = request.headers.get('x-user-id');
    if (testUser && process.env['ALLOW_TEST_USER_HEADER'] === '1') {
      return testUser;
    }
    const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (accessToken) {
      const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
      const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
      if (url && anon) {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(url, anon, {
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
        });
        const { data } = await supabase.auth.getUser(accessToken);
        if (data.user?.id) return data.user.id;
      }
    }
  }

  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Run `fn` under the signed-in user's RLS session.
 * 401 if no session; 403 if role is below `min` (when provided).
 */
export async function withAuth<T>(
  request: Request | undefined,
  min: AuthRole | null,
  fn: (ctx: AuthCtx) => Promise<T>,
): Promise<T | Response> {
  const userId = await resolveSessionUserId(request);
  if (!userId) {
    return problem(401, 'Unauthorized', 'Missing session');
  }

  const { db, client } = createRuntimeDb();
  try {
    return await withUser(db, userId, async (tx) => {
      const workspaceId = await getUserWorkspaceId(tx, userId);
      if (!workspaceId) {
        throw new SessionError(403, 'Forbidden', 'No workspace membership');
      }
      const [profile] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!profile) {
        throw new SessionError(403, 'Forbidden', 'No workspace membership');
      }
      if (min && !roleAtLeast(profile.role, min)) {
        throw new SessionError(403, 'Forbidden', `Requires ${min} role`);
      }
      return fn({
        userId,
        workspaceId,
        role: profile.role,
        db: tx,
      });
    });
  } catch (err) {
    if (err instanceof SessionError) {
      return problem(err.status, err.title, err.detail);
    }
    throw err;
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** 401 if no session. Opens an RLS transaction for `fn`. */
export async function requireUser<T>(
  fn: (ctx: AuthCtx) => Promise<T>,
  request?: Request,
): Promise<T | Response> {
  return withAuth(request, null, fn);
}

/** 403 if below min. Rank: viewer < editor < owner. */
export async function requireRole<T>(
  min: AuthRole,
  fn: (ctx: AuthCtx) => Promise<T>,
  request?: Request,
): Promise<T | Response> {
  return withAuth(request, min, fn);
}
