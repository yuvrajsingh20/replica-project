# Rule Engine — Build Spec (IDE Agent Workflow)

> Drop this file at the repo root as `CLAUDE.md` (or `AGENTS.md`). The IDE agent reads it every session.
> Product: standalone, Nected-style business rule engine. Rules: Simple Rule + Decision Table + API trigger.
> Stack: Node ≥20 · TypeScript (strict) · Supabase (Auth + Postgres + RLS) · Next.js (management) · Fastify (execute only) · Drizzle ORM · Zod · Vitest · pnpm workspaces.

---

## 0. How the agent must work (non-negotiable)

1. **Phase gates.** Work only inside the current phase. When the phase's Definition of Done is met, run `pnpm check` (typecheck + lint + test), post a short summary + what you'd do next, and **STOP**. Do not start the next phase without explicit "approved / go".
2. **Tests first for engine code.** Anything in `packages/engine` gets a failing Vitest test before implementation.
3. **No `eval`, no `new Function`, no `vm` for rule execution.** Rules compile to closures from a validated JSON AST (see §4).
4. **Never touch a production DB.** Migrations use `DIRECT_URL` only when it contains `localhost`, `_dev`, or a Supabase project ref clearly marked as local/dev in `.env.local`. Refuse loudly otherwise — fail, don't warn.
5. **Small commits, conventional messages** (`feat(engine): …`, `test(api): …`). One logical change per commit.
6. **Ask before** adding a dependency not listed in §2, changing the DB schema after the persistence phase is approved, or changing a public API contract.
7. **Report honestly.** If a test is skipped or a corner is cut, say so in the phase summary.
8. **Follow §2b.** Supabase connection / RLS / pooler mistakes are treated as bugs, not "later".

---

## 1. Product model (what we are cloning, minimal)

| Concept | Behaviour |
|---|---|
| **Workspace** | Tenant boundary. All entities belong to one workspace. RLS enforces isolation for user sessions. |
| **Rule** | Named unit of logic. `type ∈ {simple, decision_table}`. |
| **Input attributes** | Typed schema: `string · numeric · boolean · date · datetime · json · list`. |
| **Globals** | Workspace-scoped variables (`global_variables`). `workspaces.globals_version` bumps on every write. |
| **Rule status** | `draft → tested → published`. Editing a published rule creates a new draft; the published version keeps serving. |
| **Version** | Every publish snapshots an immutable `rule_version`. Rollback = re-point the environment at an older version. |
| **Environments** | `staging` and `production`. Test console runs against staging only. Production is API-only. |
| **Trigger** | `POST /v1/execute/:env/:ruleSlug` with an API key — the **only** Fastify surface. |
| **Result** | Deterministic JSON: `{ output, matched, meta }` (see §5). |
| **Execution log** | Every run stored (batched writes — see §2b). |

---

## 2. Repo layout & dependencies

```
rule-engine/
├─ CLAUDE.md
├─ package.json                  ← pnpm workspaces; scripts: dev, build, check, test, test:rls, db:migrate, db:seed
├─ pnpm-workspace.yaml
├─ tsconfig.base.json            ← strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├─ .env.example                  ← DIRECT_URL, DATABASE_URL, SUPABASE_* keys (no docker-compose Postgres/Redis)
├─ packages/
│  ├─ shared/                    ← Zod schemas + TS types (engine, api, web)
│  └─ engine/                    ← PURE. No I/O, no DB, no Fastify/Next. Compile + execute rules.
└─ apps/
   ├─ web/                       ← Next.js: Auth UI + management CRUD (rules, keys, globals, lifecycle) via Supabase session
   └─ api/                       ← Fastify: /health + /v1/execute(+bulk) only. service_role + API-key auth.
```

**Deleted from earlier drafts:** custom email/password + JWT issuance, Redis, docker-compose Postgres/Redis, Fastify management CRUD.

Allowed deps (ask before adding others):

- runtime: `@supabase/supabase-js`, `@supabase/ssr`, `next`, `react`, `react-dom`, `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/swagger-ui`, `zod`, `fastify-type-provider-zod`, `drizzle-orm`, `postgres`, `nanoid`, `pino`, `date-fns`, `bcryptjs`
- dev: `typescript`, `tsx`, `vitest`, `@vitest/coverage-v8`, `drizzle-kit`, `eslint`, `@typescript-eslint/*`, `prettier`, `dotenv`

---

## 2b. Supabase conventions (read before touching DB or execute path)

### Auth & profiles

- **Supabase Auth** owns credentials (email/password, magic link, OAuth — product choice later).
- `public.users` is a **profile** table: `id` UUID **FK → `auth.users(id)`**, plus `workspace_id`, `email`, `role`, `created_at`. **No `password_hash`.**
- A Postgres trigger on `auth.users` insert creates the profile row (and optionally the first workspace / membership — see §3).

### Two connection URLs (trap #1)

| Env var | Port | Use |
|---|---|---|
| `DIRECT_URL` | **5432** (direct) | Migrations (`drizzle-kit` / `db:migrate`) only |
| `DATABASE_URL` | **6543** (transaction pooler) | Runtime (Next.js route handlers, Fastify) |

Runtime client **must** be:

```ts
postgres(process.env.DATABASE_URL, { prepare: false })
```

Missing `prepare: false` on the pooler → intermittent failures under load. Never run migrations through the pooler.

### RLS vs service_role (trap #2)

- **Management (Next.js):** use the user session (anon key + JWT). RLS authorizes reads/writes. No manual `workspace_id` checks as the primary authz layer (still pass `workspace_id` in inserts).
- **Execution (Fastify):** uses **`service_role`** and therefore **bypasses RLS**. Every query **must** filter by `workspace_id` derived from the validated API key. This is the only place a bug leaks tenant data — those queries get **dedicated tests**.
- Custom **API keys** stay (Supabase Auth has no machine credentials): store **bcrypt** hash; index **`key_prefix`** (first 8 chars) to find candidate rows, then `bcrypt.compare` one row. Raw key returned **once** on create.

### Execution log batching (trap #3)

- Do **not** open/await one insert per request on the pooler.
- Buffer execution rows in-process; **flush every 1s or 50 rows** (whichever first). Drain on shutdown.
- Hot path never blocks on the log write.

### RLS test gate

- `pnpm test:rls` must assert workspace A cannot read workspace B's **rules, globals, api_keys, or executions**.
- RLS without these tests is a false sense of safety.

---

## 3. Database schema (Drizzle / Supabase Postgres)

```
workspaces        id, name, slug (unique), globals_version (int, default 0), created_at
users             id (uuid FK auth.users), workspace_id, email (unique), role ('owner'|'editor'|'viewer'), created_at
                  -- profile only; created by trigger on auth.users
api_keys          id, workspace_id, name, key_hash (bcrypt), key_prefix (first 8 chars, indexed), env ('staging'|'production'),
                  last_used_at, revoked_at, created_at
rules             id, workspace_id, slug (unique per workspace), name, description, type ('simple'|'decision_table'),
                  status ('draft'|'tested'|'published'), draft_definition (jsonb), input_schema (jsonb),
                  sample_input (jsonb, nullable), created_by, created_at, updated_at, deleted_at
rule_versions     id, rule_id, version (int, per rule), definition (jsonb), input_schema (jsonb),
                  published_by, published_at, changelog (text)
rule_environments rule_id, env ('staging'|'production'), version_id (fk rule_versions), updated_at
                  PRIMARY KEY (rule_id, env)
global_variables  id, workspace_id, name (unique per workspace), value (jsonb), created_at, updated_at
executions        id, workspace_id, rule_id, version_id, env, input (jsonb), output (jsonb), matched (jsonb),
                  status ('success'|'no_match'|'error'), error (text), latency_ms (int), api_key_id, created_at
                  INDEX (rule_id, created_at desc); INDEX (workspace_id, created_at desc)
```

Indexes: `rules(workspace_id, slug)` unique; `api_keys(key_prefix)`; `api_keys(key_hash)` unique (or unique on hash if collision-safe).

**RLS:** enabled on all tenant tables. Policies: member of `workspace_id` can CRUD per role (viewer read-only; editor/owner write; owner manages keys/members as needed).

**Write validation:** `rules.draft_definition` and `rule_versions.definition` validated with Phase 1 Zod + `compileRule` before insert/update — a definition that can't compile never reaches the DB.

---

## 4. Rule definition DSL (the core — `packages/shared/src/dsl.ts`)

All definitions are JSON, validated by Zod. The engine compiles them to closures once and caches by `version_id`.

### 4.1 Input schema

```ts
type AttrType = 'string'|'numeric'|'boolean'|'date'|'datetime'|'json'|'list';
type InputAttr = { name: string; type: AttrType; required?: boolean; sample?: unknown };
type InputSchema = { attributes: InputAttr[] };
```

### 4.2 Expressions

```ts
type Operand =
  | { kind: 'const'; value: unknown }
  | { kind: 'attr'; path: string }
  | { kind: 'global'; name: string }
  | { kind: 'output'; key: string };

type Operator =
  | 'eq' | 'neq' | 'is_null' | 'is_not_null'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'matches'
  | 'in' | 'not_in' | 'any_in' | 'all_in' | 'length_eq' | 'length_gt' | 'length_lt';

type Condition = { left: Operand; op: Operator; right?: Operand | Operand[] };
type ConditionGroup = { logic: 'and'|'or'; items: (Condition | ConditionGroup)[] };
```

Globals resolve from `execute(input, { globals })`. Missing global → `undefined` (null semantics apply).

### 4.3 Actions

```ts
type Action =
  | { kind: 'set'; key: string; value: Operand }
  | { kind: 'formula'; key: string; expr: FormulaAst }  // + - * / % min max round abs floor ceil; attr|global|output|const
  | { kind: 'template'; key: string; text: string };    // {{attr.*}} {{global.*}} {{output.*}}; unknown → '' + meta.unknownTokens
```

No side-effects (no HTTP, no DB) in actions.

### 4.4 Simple Rule / 4.5 Decision Table

Unchanged from Phase 1: `simple` with `when`/`then`/`else`; `decision_table` with `hitPolicy ∈ {first,all,collect}`, `priority`, `defaultRow`, optional per-row `actions`.

---

## 5. Engine contract (`packages/engine`)

```ts
compileRule(def: RuleDef, schema: InputSchema): CompiledRule
compiled.execute(input: unknown, ctx?: { globals?: Record<string, unknown> }): RuleResult
```

`RuleResult` as before, plus optional `meta.unknownTokens` for templates. Pure package; no Supabase/I/O.

---

## 6. Surfaces by trust boundary

### 6a. Next.js (`apps/web`) — management (user session + RLS)

Route handlers / server actions with the Supabase user client:

```
Auth (Supabase-hosted or @supabase/ssr helpers)
Rules CRUD, test, publish, rollback, versions, executions log (read)
API keys CRUD (raw key once)
Globals CRUD (bumps globals_version)
```

RBAC via RLS + `users.role`. No Fastify involvement.

### 6b. Fastify (`apps/api`) — execute only (service_role + API key)

```
GET    /health
POST   /v1/execute/:env/:ruleSlug
POST   /v1/execute/:env/:ruleSlug/bulk   body = { inputs: [...] } (max 500)
```

- Auth: `X-API-Key`; key `env` must match `:env`.
- Lookup + compile cache keyed by `version_id` (in-process LRU). Invalidate on publish/rollback via version id change (no Redis required for MVP).
- Every DB read/write filters `workspace_id` from the API key row.
- Batch execution logging (§2b).
- Headers: `X-Rule-Version`, `X-Latency-Ms`.
- Errors: RFC 7807 problem+json.

Swagger at `/docs` for the execute surface is fine; do not re-expose management CRUD here.

---

## 7. Phases with gates

### Phase 0 — Scaffold *(done)*
Monorepo, strict tsconfig, eslint/prettier, vitest, `.env.example`, `packages/shared` Zod DSL.

### Phase 1 — Engine *(done)*
`compileRule` / `execute` for simple + decision table; operators; formulas; globals/output/template; ≥90% engine coverage; golden fixtures including `dynamic-pricing.json`; bench P95 &lt; 5 ms on 50-row warm table.

### Phase 2 — Supabase persistence + RLS *(done)*
- Schema §3 including `global_variables`, `globals_version`, profile `users` FK → `auth.users`, trigger SQL.
- Migrations via **`DIRECT_URL`** only; runtime docs/`createDb` use pooler + `{ prepare: false }`.
- RLS policies on tenant tables; **`pnpm test:rls`** (A cannot read B's rules/globals/keys/executions).
- Seed: 1 workspace, 1 simple rule, 1 decision table, globals for dynamic-pricing.
- Definition compile-gate on write.
- Strip Fastify management CRUD if still present; keep Fastify skeleton `/health` only (execute is Phase 4).
- DoD: migrations apply on direct URL; `test:rls` green; seed green; `pnpm check` green.

### Phase 3 — Next.js management + lifecycle *(done)*
- `apps/web`: Supabase Auth session (cookie clients + middleware), rules/keys/globals CRUD via RLS.
- Lifecycle: test → tested; publish → version + env pointer; rollback; versions list; edit resets to draft.
- Auth profile trigger provisions workspace + owner; `rule_versions` append-only at the DB.
- DoD: e2e create → test → publish staging → publish production → edit → rollback; `pnpm check` green.

### Phase 4 — Execute API *(current when approved)*
- Fastify `/v1/execute` + bulk; API-key auth (prefix + bcrypt); service_role queries **always** scoped by `workspace_id` (dedicated tests); batched execution log; in-process compile cache.
- Load optional for MVP; cache invalidation via new `version_id` after publish.
- DoD: execute tests + tenant-isolation tests on service_role path green.

### Phase 5 — (Optional) Richer web console
Visual polish, DSL editor UX, etc. No change to trust boundaries.

---

## 8. Definition of "optimized" for this project

- Pure engine package ⇒ browser / worker / Lambda later without touching API.
- Compile once, execute many; cache by immutable `version_id`.
- Management scales with Next + RLS; execute scales separately on Fastify.
- Pooler-safe runtime (`prepare: false`) + batched logs ⇒ no connection exhaustion.
- JSON DSL ⇒ safe multi-tenancy, diffable versions, future visual builder.

---

## 9. Phase summary template

```
## Phase N complete — <name>
Done: …
Tests: X passed / coverage Y% / bench or load numbers
Deviations from spec: … (or "none")
Open questions: …
Next (needs approval): Phase N+1 — …
```
