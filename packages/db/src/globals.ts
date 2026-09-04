import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { newId } from './ids.js';
import { globalVariables, workspaces } from './schema.js';

/**
 * Upsert a global and bump workspaces.globals_version in the **same transaction**.
 * globals_version is the Phase 4 cache key — a missed bump means stale pricing.
 */
export async function upsertGlobalInTransaction(
  db: Db,
  args: { workspaceId: string; name: string; value: unknown },
): Promise<{ row: typeof globalVariables.$inferSelect; globalsVersion: number; created: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(globalVariables)
      .where(
        and(
          eq(globalVariables.workspaceId, args.workspaceId),
          eq(globalVariables.name, args.name),
        ),
      )
      .limit(1);

    const now = new Date();
    let row: typeof globalVariables.$inferSelect;
    let created = false;
    if (existing) {
      const [updated] = await tx
        .update(globalVariables)
        .set({ value: args.value as never, updatedAt: now })
        .where(eq(globalVariables.id, existing.id))
        .returning();
      row = updated!;
    } else {
      const [inserted] = await tx
        .insert(globalVariables)
        .values({
          id: newId('gvar'),
          workspaceId: args.workspaceId,
          name: args.name,
          value: args.value as never,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      row = inserted!;
      created = true;
    }

    const [bumped] = await tx
      .update(workspaces)
      .set({ globalsVersion: sql`${workspaces.globalsVersion} + 1` })
      .where(eq(workspaces.id, args.workspaceId))
      .returning();

    return { row, globalsVersion: bumped!.globalsVersion, created };
  });
}

export async function deleteGlobalInTransaction(
  db: Db,
  args: { workspaceId: string; name: string },
): Promise<{ deleted: boolean; globalsVersion: number }> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(globalVariables)
      .where(
        and(
          eq(globalVariables.workspaceId, args.workspaceId),
          eq(globalVariables.name, args.name),
        ),
      )
      .returning();

    if (!deleted) {
      return { deleted: false, globalsVersion: -1 };
    }

    const [bumped] = await tx
      .update(workspaces)
      .set({ globalsVersion: sql`${workspaces.globalsVersion} + 1` })
      .where(eq(workspaces.id, args.workspaceId))
      .returning();

    return { deleted: true, globalsVersion: bumped!.globalsVersion };
  });
}
