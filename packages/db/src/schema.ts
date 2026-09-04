import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  pgEnum,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['owner', 'editor', 'viewer']);
export const apiKeyEnvEnum = pgEnum('api_key_env', ['staging', 'production']);
export const ruleTypeEnum = pgEnum('rule_type', ['simple', 'decision_table']);
export const ruleStatusEnum = pgEnum('rule_status', ['draft', 'tested', 'published']);
export const ruleEnvEnum = pgEnum('rule_env', ['staging', 'production']);
export const executionStatusEnum = pgEnum('execution_status', [
  'success',
  'no_match',
  'error',
]);

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  globalsVersion: integer('globals_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Profile row — id FK → auth.users (Supabase). No password_hash. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  role: userRoleEnum('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Membership map without RLS — SECURITY DEFINER helpers read this so FORCE RLS
 * on tenant tables does not recurse through `users` policies.
 */
export const sessionWorkspace = pgTable('session_workspace', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    env: apiKeyEnvEnum('env').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_uidx').on(t.keyHash),
    index('api_keys_key_prefix_idx').on(t.keyPrefix),
  ],
);

export const rules = pgTable(
  'rules',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    type: ruleTypeEnum('type').notNull(),
    status: ruleStatusEnum('status').notNull().default('draft'),
    draftDefinition: jsonb('draft_definition').notNull(),
    inputSchema: jsonb('input_schema').notNull(),
    sampleInput: jsonb('sample_input'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('rules_workspace_slug_uidx').on(t.workspaceId, t.slug)],
);

export const ruleVersions = pgTable('rule_versions', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id')
    .notNull()
    .references(() => rules.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  definition: jsonb('definition').notNull(),
  inputSchema: jsonb('input_schema').notNull(),
  publishedBy: uuid('published_by').references(() => users.id),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  changelog: text('changelog'),
});

export const ruleEnvironments = pgTable(
  'rule_environments',
  {
    ruleId: text('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    env: ruleEnvEnum('env').notNull(),
    versionId: text('version_id')
      .notNull()
      .references(() => ruleVersions.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.env] })],
);

export const executions = pgTable(
  'executions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id')
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    versionId: text('version_id')
      .notNull()
      .references(() => ruleVersions.id),
    env: ruleEnvEnum('env').notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output').notNull(),
    matched: jsonb('matched').notNull(),
    status: executionStatusEnum('status').notNull(),
    error: text('error'),
    latencyMs: integer('latency_ms').notNull(),
    apiKeyId: text('api_key_id').references(() => apiKeys.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('executions_rule_created_idx').on(t.ruleId, t.createdAt),
    index('executions_workspace_created_idx').on(t.workspaceId, t.createdAt),
  ],
);

export const globalVariables = pgTable(
  'global_variables',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    value: jsonb('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('global_variables_workspace_name_uidx').on(t.workspaceId, t.name)],
);
