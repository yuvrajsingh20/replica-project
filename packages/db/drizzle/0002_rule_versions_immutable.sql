-- Phase 3: rule_versions are append-only.
CREATE OR REPLACE FUNCTION deny_rule_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rule_versions are immutable (append-only)'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS rule_versions_immutable_update ON rule_versions;
--> statement-breakpoint
DROP TRIGGER IF EXISTS rule_versions_immutable_delete ON rule_versions;
--> statement-breakpoint
CREATE TRIGGER rule_versions_immutable_update
  BEFORE UPDATE ON rule_versions
  FOR EACH ROW EXECUTE FUNCTION deny_rule_version_mutation();
--> statement-breakpoint
CREATE TRIGGER rule_versions_immutable_delete
  BEFORE DELETE ON rule_versions
  FOR EACH ROW EXECUTE FUNCTION deny_rule_version_mutation();
