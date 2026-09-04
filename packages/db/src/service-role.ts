import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { sessionWorkspace } from './schema.js';

/** Bypass RLS for seed / service_role paths (sets app.role for the transaction). */
export async function withServiceRole<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.role', 'service_role', true)`);
    return fn(tx as unknown as Db);
  });
}

export async function syncSessionWorkspace(
  db: Db,
  args: { userId: string; workspaceId: string; role: string },
): Promise<void> {
  await db
    .insert(sessionWorkspace)
    .values({
      userId: args.userId,
      workspaceId: args.workspaceId,
      role: args.role,
    })
    .onConflictDoUpdate({
      target: sessionWorkspace.userId,
      set: { workspaceId: args.workspaceId, role: args.role },
    });
}
