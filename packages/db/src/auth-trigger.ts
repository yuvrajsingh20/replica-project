import { eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { users, workspaces } from './schema.js';

/**
 * Insert an auth.users row so handle_new_auth_user provisions workspace + profile.
 * Returns the auto-created workspace id.
 */
export async function signupViaAuthTrigger(
  db: Db,
  args: { userId: string; email: string; workspaceName?: string },
): Promise<{ workspaceId: string; role: 'owner' | 'editor' | 'viewer' }> {
  const meta = args.workspaceName
    ? JSON.stringify({ workspace_name: args.workspaceName })
    : '{}';
  await db.execute(sql`
    insert into auth.users (id, email, raw_user_meta_data)
    values (${args.userId}::uuid, ${args.email}, ${meta}::jsonb)
  `);
  const [profile] = await db.select().from(users).where(eq(users.id, args.userId)).limit(1);
  if (!profile) {
    throw new Error(`Auth trigger did not create profile for ${args.email}`);
  }
  return { workspaceId: profile.workspaceId, role: profile.role };
}

/** Move an existing profile into another workspace (for multi-role RBAC fixtures). */
export async function reassignUserWorkspace(
  db: Db,
  args: {
    userId: string;
    workspaceId: string;
    role: 'owner' | 'editor' | 'viewer';
    deleteOldWorkspace?: boolean;
  },
): Promise<void> {
  const [profile] = await db.select().from(users).where(eq(users.id, args.userId)).limit(1);
  const oldWs = profile?.workspaceId;
  await db.execute(sql`
    update users
    set workspace_id = ${args.workspaceId}, role = ${args.role}::user_role
    where id = ${args.userId}::uuid
  `);
  await db.execute(sql`
    update session_workspace
    set workspace_id = ${args.workspaceId}, role = ${args.role}
    where user_id = ${args.userId}::uuid
  `);
  if (args.deleteOldWorkspace && oldWs && oldWs !== args.workspaceId) {
    await db.delete(workspaces).where(eq(workspaces.id, oldWs));
  }
}
