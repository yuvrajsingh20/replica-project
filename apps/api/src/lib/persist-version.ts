import { eq } from 'drizzle-orm';
import type { AppDb } from '../app.js';
import { ruleVersions } from '../db/schema.js';
import { newId } from './ids.js';
import {
  validateCompilableDefinition,
  type DefinitionValidationError,
} from './validate-definition.js';

/**
 * Insert an immutable rule_version only after Phase 1 Zod + compile succeed.
 * Used by Phase 3 publish; available now so bad definitions never hit the table.
 */
export async function insertValidatedRuleVersion(
  db: AppDb,
  args: {
    ruleId: string;
    version: number;
    definition: unknown;
    inputSchema: unknown;
    publishedBy?: string | null;
    changelog?: string | null;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: DefinitionValidationError }> {
  const checked = validateCompilableDefinition(args.definition, args.inputSchema);
  if (!checked.ok) {
    return { ok: false, error: checked.error };
  }

  const id = newId('rv');
  await db.insert(ruleVersions).values({
    id,
    ruleId: args.ruleId,
    version: args.version,
    definition: checked.definition,
    inputSchema: checked.inputSchema,
    publishedBy: args.publishedBy ?? null,
    changelog: args.changelog ?? null,
  });

  const [row] = await db.select().from(ruleVersions).where(eq(ruleVersions.id, id)).limit(1);
  if (!row) {
    throw new Error('rule_version insert failed');
  }
  return { ok: true, id };
}
