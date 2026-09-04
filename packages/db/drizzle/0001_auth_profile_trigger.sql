-- Phase 3: provision workspace + owner profile + session_workspace on auth signup.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = rule_engine_p2_dev
AS $$
DECLARE
  ws_id text;
  ws_slug text;
  ws_name text;
  local_part text;
BEGIN
  local_part := lower(split_part(coalesce(NEW.email, 'user'), '@', 1));
  ws_slug := regexp_replace(local_part, '[^a-z0-9]', '-', 'g')
    || '-' || substr(replace(NEW.id::text, '-', ''), 1, 6);
  ws_id := 'ws_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 21);
  ws_name := coalesce(NEW.raw_user_meta_data->>'workspace_name', ws_slug);

  INSERT INTO workspaces (id, name, slug)
  VALUES (ws_id, ws_name, ws_slug);

  INSERT INTO users (id, workspace_id, email, role)
  VALUES (NEW.id, ws_id, coalesce(NEW.email, ws_slug || '@local'), 'owner');

  INSERT INTO session_workspace (user_id, workspace_id, role)
  VALUES (NEW.id, ws_id, 'owner');

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
