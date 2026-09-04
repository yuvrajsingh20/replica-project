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
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" "user_role" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email"),
  CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action
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
  CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_uidx" ON "api_keys" USING btree ("key_hash");
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
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rules_workspace_slug_uidx" ON "rules" USING btree ("workspace_id","slug");
--> statement-breakpoint
CREATE TABLE "rule_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "rule_id" text NOT NULL,
  "version" integer NOT NULL,
  "definition" jsonb NOT NULL,
  "input_schema" jsonb NOT NULL,
  "published_by" text,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "changelog" text,
  CONSTRAINT "rule_versions_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "rule_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "rule_environments" (
  "rule_id" text NOT NULL,
  "env" "rule_env" NOT NULL,
  "version_id" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rule_environments_rule_id_env_pk" PRIMARY KEY("rule_id","env"),
  CONSTRAINT "rule_environments_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "rule_environments_version_id_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "rule_versions"("id") ON DELETE no action ON UPDATE no action
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
  CONSTRAINT "executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "executions_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "executions_version_id_rule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "rule_versions"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "executions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "executions_rule_created_idx" ON "executions" USING btree ("rule_id","created_at");
--> statement-breakpoint
CREATE INDEX "executions_workspace_created_idx" ON "executions" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE TABLE "global_variables" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "value" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "global_variables_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "global_variables_workspace_name_uidx" ON "global_variables" USING btree ("workspace_id","name");
