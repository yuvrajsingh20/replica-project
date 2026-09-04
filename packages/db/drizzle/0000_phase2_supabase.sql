CREATE SCHEMA IF NOT EXISTS rule_engine_p2_dev;
--> statement-breakpoint
-- Phase 2: schema + auth stub + RLS (default-deny, FORCE)
-- Local/dev: stub auth schema when Supabase Auth is not present.

CREATE SCHEMA IF NOT EXISTS auth;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  created_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
--> statement-breakpoint
CREATE TYPE "user_role" AS ENUM('owner', 'editor', 'viewer');
--> statement-breakpoint
CREATE TYPE "api_key_env" AS ENUM('staging', 'production');
--> statement-breakpoint
CREATE TYPE "rule_type" AS ENUM('simple', 'decision_table');
--> statement-breakpoint
CREATE TYPE "rule_status" AS ENUM('draft', 'tested', 'published');
--> statement-breakpoint
CREATE TYPE "rule_env" AS ENUM('staging', 'production');
--> statement-breakpoint
CREATE TYPE "execution_status" AS ENUM('success', 'no_match', 'error');
--> statement-breakpoint
CREATE TABLE "workspaces" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "globals_version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "email" text NOT NULL,
  "role" "user_role" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email"),
  CONSTRAINT "users_id_auth_users_fk" FOREIGN KEY ("id") REFERENCES auth.users("id") ON DELETE cascade,
  CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "session_workspace" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "role" text NOT NULL,
  CONSTRAINT "session_workspace_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade,
  CONSTRAINT "session_workspace_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "env" "api_key_env" NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash"),
  CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_uidx" ON "api_keys" ("key_hash");
--> statement-breakpoint
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" ("key_prefix");
--> statement-breakpoint
CREATE TABLE "rules" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "type" "rule_type" NOT NULL,
  "status" "rule_status" DEFAULT 'draft' NOT NULL,
  "draft_definition" jsonb NOT NULL,
  "input_schema" jsonb NOT NULL,
  "sample_input" jsonb,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rules_workspace_slug_uidx" ON "rules" ("workspace_id","slug");
--> statement-breakpoint
CREATE TABLE "rule_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "rule_id" text NOT NULL,
  "version" integer NOT NULL,
  "definition" jsonb NOT NULL,
  "input_schema" jsonb NOT NULL,
  "published_by" uuid,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "changelog" text,
  CONSTRAINT "rule_versions_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE cascade,
  CONSTRAINT "rule_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE TABLE "rule_environments" (
  "rule_id" text NOT NULL,
  "env" "rule_env" NOT NULL,
  "version_id" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rule_environments_rule_id_env_pk" PRIMARY KEY("rule_id","env"),
  CONSTRAINT "rule_environments_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE cascade,
  CONSTRAINT "rule_environments_version_id_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "rule_versions"("id")
);
--> statement-breakpoint
CREATE TABLE "executions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "rule_id" text NOT NULL,
  "version_id" text NOT NULL,
  "env" "rule_env" NOT NULL,
  "input" jsonb NOT NULL,
  "output" jsonb NOT NULL,
  "matched" jsonb NOT NULL,
  "status" "execution_status" NOT NULL,
  "error" text,
  "latency_ms" integer NOT NULL,
  "api_key_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade,
  CONSTRAINT "executions_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE cascade,
  CONSTRAINT "executions_version_id_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "rule_versions"("id"),
  CONSTRAINT "executions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
);
--> statement-breakpoint
CREATE INDEX "executions_rule_created_idx" ON "executions" ("rule_id","created_at");
--> statement-breakpoint
CREATE INDEX "executions_workspace_created_idx" ON "executions" ("workspace_id","created_at");
--> statement-breakpoint
CREATE TABLE "global_variables" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "value" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "global_variables_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "global_variables_workspace_name_uidx" ON "global_variables" ("workspace_id","name");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('app.role', true), '') = 'service_role';
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION current_workspace_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = rule_engine_p2_dev
AS $$
  SELECT workspace_id FROM session_workspace WHERE user_id = auth.uid();
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = rule_engine_p2_dev
AS $$
  SELECT role FROM session_workspace WHERE user_id = auth.uid();
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = rule_engine_p2_dev
AS $$
BEGIN
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rule_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rule_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rule_environments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rule_environments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE executions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE global_variables ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE global_variables FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspaces_select ON workspaces FOR SELECT
  USING (is_service_role() OR id IN (SELECT current_workspace_ids()));
--> statement-breakpoint
CREATE POLICY workspaces_insert ON workspaces FOR INSERT
  WITH CHECK (is_service_role());
--> statement-breakpoint
CREATE POLICY workspaces_update ON workspaces FOR UPDATE
  USING (is_service_role() OR (id IN (SELECT current_workspace_ids()) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY users_select ON users FOR SELECT
  USING (is_service_role() OR workspace_id IN (SELECT current_workspace_ids()));
--> statement-breakpoint
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (is_service_role());
--> statement-breakpoint
CREATE POLICY users_update ON users FOR UPDATE
  USING (is_service_role() OR workspace_id IN (SELECT current_workspace_ids()));
--> statement-breakpoint
CREATE POLICY api_keys_select ON api_keys FOR SELECT
  USING (is_service_role() OR workspace_id IN (SELECT current_workspace_ids()));
--> statement-breakpoint
CREATE POLICY api_keys_insert ON api_keys FOR INSERT
  WITH CHECK (is_service_role() OR (workspace_id IN (SELECT current_workspace_ids()) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY api_keys_update ON api_keys FOR UPDATE
  USING (is_service_role() OR (workspace_id IN (SELECT current_workspace_ids()) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY rules_select ON rules FOR SELECT
  USING (is_service_role() OR workspace_id IN (SELECT current_workspace_ids()));
--> statement-breakpoint
CREATE POLICY rules_insert ON rules FOR INSERT
  WITH CHECK (is_service_role() OR (workspace_id IN (SELECT current_workspace_ids()) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY rules_update ON rules FOR UPDATE
  USING (is_service_role() OR (workspace_id IN (SELECT current_workspace_ids()) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY rules_delete ON rules FOR DELETE
  USING (is_service_role() OR (workspace_id IN (SELECT current_workspace_ids()) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY rule_versions_select ON rule_versions FOR SELECT
  USING (is_service_role() OR rule_id IN (SELECT id FROM rules));
--> statement-breakpoint
CREATE POLICY rule_versions_insert ON rule_versions FOR INSERT
  WITH CHECK (is_service_role() OR (rule_id IN (SELECT id FROM rules) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY rule_environments_select ON rule_environments FOR SELECT
  USING (is_service_role() OR rule_id IN (SELECT id FROM rules));
--> statement-breakpoint
CREATE POLICY rule_environments_write ON rule_environments FOR ALL
  USING (is_service_role() OR (rule_id IN (SELECT id FROM rules) AND current_user_role() IN ('owner', 'editor')))
  WITH CHECK (is_service_role() OR (rule_id IN (SELECT id FROM rules) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY executions_select ON executions FOR SELECT
  USING (is_service_role() OR workspace_id IN (SELECT current_workspace_ids()));
--> statement-breakpoint
CREATE POLICY executions_insert ON executions FOR INSERT
  WITH CHECK (is_service_role() OR workspace_id IN (SELECT current_workspace_ids()));
--> statement-breakpoint
CREATE POLICY global_variables_select ON global_variables FOR SELECT
  USING (is_service_role() OR workspace_id IN (SELECT current_workspace_ids()));
--> statement-breakpoint
CREATE POLICY global_variables_insert ON global_variables FOR INSERT
  WITH CHECK (is_service_role() OR (workspace_id IN (SELECT current_workspace_ids()) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY global_variables_update ON global_variables FOR UPDATE
  USING (is_service_role() OR (workspace_id IN (SELECT current_workspace_ids()) AND current_user_role() IN ('owner', 'editor')));
--> statement-breakpoint
CREATE POLICY global_variables_delete ON global_variables FOR DELETE
  USING (is_service_role() OR (workspace_id IN (SELECT current_workspace_ids()) AND current_user_role() IN ('owner', 'editor')));
