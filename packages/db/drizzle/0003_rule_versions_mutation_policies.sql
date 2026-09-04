-- Allow UPDATE/DELETE attempts to see rows so the immutability trigger can reject them.
-- Without these policies, FORCE RLS silently no-ops mutations (0 rows) and the trigger never runs.
CREATE POLICY rule_versions_update ON rule_versions FOR UPDATE
  USING (is_service_role() OR rule_id IN (SELECT id FROM rules));
--> statement-breakpoint
CREATE POLICY rule_versions_delete ON rule_versions FOR DELETE
  USING (is_service_role() OR rule_id IN (SELECT id FROM rules));
