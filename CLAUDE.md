# Rule Engine — Phase 1 Build Spec (IDE Agent Workflow)

> Drop this file at the repo root as `CLAUDE.md` (or `AGENTS.md`). The IDE agent reads it every session.
> Product: standalone, Nected-style business rule engine. Phase 1 = **rules only**: Simple Rule + Decision Table + API trigger.
> Stack: Node 22 · TypeScript (strict) · Fastify · PostgreSQL · Drizzle ORM · Redis · Zod · Vitest · pnpm workspaces.

---

## 0. How the agent must work (non-negotiable)

1. **Phase gates.** Work only inside the current phase. When the phase's Definition of Done is met, run `pnpm check` (typecheck + lint + test), post a short summary + what you'd do next, and **STOP**. Do not start the next phase without explicit "approved / go".
2. **Tests first for engine code.** Anything in `packages/engine` gets a failing Vitest test before implementation.
3. **No `eval`, no `new Function`, no `vm` for rule execution.** Rules compile to closures from a validated JSON AST (see §4).
4. **Never touch a production DB.** Only `DATABASE_URL` from `.env.local`; refuse to run migrations if the URL doesn't contain `localhost` or `_dev`.
5. **Small commits, conventional messages** (`feat(engine): …`, `test(api): …`). One logical change per commit.
6. **Ask before** adding a dependency not listed in §2, changing the DB schema after Phase 2 is approved, or changing a public API contract.
7. **Report honestly.** If a test is skipped or a corner is cut, say so in the phase summary.

---

## 1. Product model (what we are cloning, minimal)

Mirrors Nected's Phase-1 surface:

| Concept | Behaviour |
|---|---|
| **Workspace** | Tenant boundary. All entities belong to one workspace. |
| **Rule** | Named unit of logic. `type ∈ {simple, decision_table}`. |
| **Input attributes** | Typed schema for the rule's payload: `string · numeric · boolean · date · datetime · json · list`. |
| **Rule status** | `draft → tested → published`. Editing a published rule creates a new draft; the published version keeps serving. |
| **Version** | Every publish snapshots an immutable `rule_version`. Rollback = re-point the environment at an older version. |
| **Environments** | `staging` and `production`. Test console runs against staging only. Production is API-only. |
| **Trigger** | `POST /v1/execute/:env/:ruleSlug` with an API key. That's the only trigger in Phase 1. |
| **Result** | Deterministic JSON: `{ output, matched, meta }` (see §5). |
| **Execution log** | Every run stored: input, output, version, latency, status. |

---

## 2. Repo layout & dependencies

```
rule-engine/
├─ CLAUDE.md                     ← this file
├─ package.json                  ← pnpm workspaces, scripts: dev, build, check, test, db:migrate, db:studio
├─ pnpm-workspace.yaml
├─ tsconfig.base.json            ← strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├─ .env.example
├─ docker-compose.yml            ← postgres:16, redis:7
├─ packages/
│  ├─ shared/                    ← Zod schemas + TS types shared by engine, api, (later) web
│  └─ engine/                    ← PURE. No I/O, no DB, no Fastify. Compile + execute rules.
└─ apps/
   └─ api/                       ← Fastify server, Drizzle, Redis cache, auth, routes
```

Allowed deps (ask before adding others):

- runtime: `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/swagger-ui`, `zod`, `fastify-type-provider-zod`, `drizzle-orm`, `postgres`, `ioredis`, `nanoid`, `pino`, `date-fns`, `bcryptjs`
- dev: `typescript`, `tsx`, `vitest`, `@vitest/coverage-v8`, `drizzle-kit`, `eslint`, `@typescript-eslint/*`, `prettier`, `dotenv`

---

## 3. Database schema (Drizzle, Postgres)

```
workspaces        id, name, slug (unique), created_at
users             id, workspace_id, email (unique), password_hash, role ('owner'|'editor'|'viewer'), created_at
api_keys          id, workspace_id, name, key_hash, key_prefix (first 8 chars, for display), env ('staging'|'production'),
                  last_used_at, revoked_at, created_at
rules             id, workspace_id, slug (unique per workspace), name, description, type ('simple'|'decision_table'),
                  status ('draft'|'tested'|'published'), draft_definition (jsonb), input_schema (jsonb),
                  sample_input (jsonb, nullable), created_by, created_at, updated_at, deleted_at
rule_versions     id, rule_id, version (int, per rule), definition (jsonb), input_schema (jsonb),
                  published_by, published_at, changelog (text)
rule_environments rule_id, env ('staging'|'production'), version_id (fk rule_versions), updated_at
                  PRIMARY KEY (rule_id, env)
executions        id, workspace_id, rule_id, version_id, env, input (jsonb), output (jsonb), matched (jsonb),
                  status ('success'|'no_match'|'error'), error (text), latency_ms (int), api_key_id, created_at
                  INDEX (rule_id, created_at desc); INDEX (workspace_id, created_at desc)
```

Indexes: `rules(workspace_id, slug)` unique; `api_keys(key_hash)` unique.

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
  | { kind: 'attr'; path: string }            // dot path into input, e.g. "order.total"
  | { kind: 'global'; name: string };          // global variables (Phase 2+; parse now, resolve to undefined)

type Operator =
  // universal
  | 'eq' | 'neq' | 'is_null' | 'is_not_null'
  // numeric / date
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  // string
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'matches' /* regex, precompiled */
  // list
  | 'in' | 'not_in' | 'any_in' | 'all_in' | 'length_eq' | 'length_gt' | 'length_lt';

type Condition = { left: Operand; op: Operator; right?: Operand | Operand[] };
type ConditionGroup = { logic: 'and'|'or'; items: (Condition | ConditionGroup)[] };
```

### 4.3 Actions (what a match produces)

```ts
type Action =
  | { kind: 'set'; key: string; value: Operand }                // output[key] = value
  | { kind: 'formula'; key: string; expr: FormulaAst };          // safe arithmetic AST: + - * / % min max round abs, attrs, consts
```

No side-effects (no HTTP, no DB) in Phase 1 actions.

### 4.4 Simple Rule

```ts
type SimpleRuleDef = {
  type: 'simple';
  when: ConditionGroup;
  then: Action[];
  else?: Action[];
};
```

### 4.5 Decision Table

```ts
type DecisionTableDef = {
  type: 'decision_table';
  hitPolicy: 'first' | 'all' | 'collect';   // first: stop at first matching row; all: merge every matching row (later rows override); collect: return array of row outputs
  columns: { id: string; left: Operand; op: Operator }[];    // condition columns
  outputs: { id: string; key: string }[];                    // output columns
  rows: {
    id: string;
    priority?: number;                                       // lower runs first; default = row order
    cells: Record<string /*column.id*/, Operand | Operand[] | null>;  // null = "any" (don't care)
    results: Record<string /*output.id*/, Operand | { formula: FormulaAst }>;
  }[];
  defaultRow?: Record<string, Operand>;                      // used when nothing matches
};
```

---

## 5. Engine contract (`packages/engine`)

```ts
compileRule(def: RuleDef, schema: InputSchema): CompiledRule      // throws CompileError with path + message
compiled.execute(input: unknown): RuleResult                       // synchronous, pure, never throws — errors land in result

type RuleResult = {
  status: 'success' | 'no_match' | 'error';
  output: Record<string, unknown> | Record<string, unknown>[];    // array only for hitPolicy 'collect'
  matched: string[];            // row ids (decision table) or ['then'] / ['else'] (simple)
  meta: { latencyMs: number; version?: number; evaluated: number };
  error?: { code: string; message: string; path?: string };
};
```

Engine rules:

- **Coercion at the boundary.** Validate + coerce input against `InputSchema` once (`date`/`datetime` → `Date`; `numeric` → number; reject NaN). Everything downstream trusts types.
- **Precompile.** Regexes compiled at compile time; dot paths resolved to getter closures; `in` sets become `Set`s.
- **Null handling.** Any comparison where an operand is `null`/`undefined` (except `is_null`/`is_not_null`/`eq null`) evaluates to `false`, never throws.
- **Determinism.** Same input + same version ⇒ byte-identical output. No `Date.now()` inside rule logic.
- **Performance budget.** P95 < 5 ms per execution for a 50-row table on a warm compiled rule (benchmark in `packages/engine/bench`).

---

## 6. API surface (`apps/api`) — all JSON, Zod-validated, Swagger at `/docs`

Auth:
- Management endpoints: `Authorization: Bearer <session JWT>` (email+password login, Phase 3).
- Execution endpoints: `X-API-Key: <key>`; key's `env` must match the `:env` in the path.

```
POST   /v1/auth/register                     create workspace + owner
POST   /v1/auth/login
GET    /v1/rules                              list (status, type, search, pagination)
POST   /v1/rules                              create draft  { name, slug?, type, description? }
GET    /v1/rules/:id
PATCH  /v1/rules/:id                          update draft_definition / input_schema / sample_input → status back to 'draft'
DELETE /v1/rules/:id                          soft delete
POST   /v1/rules/:id/test                     { input? } → runs draft against STAGING semantics; on success sets status 'tested'
POST   /v1/rules/:id/publish                  { env: 'staging'|'production', changelog? } requires status ≥ 'tested'
                                              → creates rule_version, points rule_environments[env] at it, status 'published'
GET    /v1/rules/:id/versions
POST   /v1/rules/:id/rollback                 { env, versionId }
GET    /v1/rules/:id/executions               paginated log
POST   /v1/api-keys                           { name, env } → returns raw key ONCE
GET    /v1/api-keys · DELETE /v1/api-keys/:id (revoke)

POST   /v1/execute/:env/:ruleSlug             API TRIGGER. body = input. Returns RuleResult + { ruleId, versionId }.
POST   /v1/execute/:env/:ruleSlug/bulk        body = { inputs: [...] } (max 500) → array of RuleResult
```

Execution path (hot, optimize):
1. Rate-limit per API key (Redis).
2. Look up `(workspace, slug, env)` → `version_id` — cached in Redis 60 s, invalidated on publish/rollback.
3. Compiled rule cached in-process `Map<versionId, CompiledRule>` (LRU 500) + Redis definition cache for cold starts.
4. Execute. Write `executions` row **asynchronously** (fire-and-forget with a bounded queue; never block the response).
5. Response headers: `X-Rule-Version`, `X-Latency-Ms`.

Errors: RFC 7807 problem+json. `404` unknown rule/env, `409` publish without test, `422` compile/validation errors with `path`.

---

## 7. Phases with gates

### Phase 0 — Scaffold  *(gate: approve before Phase 1)*
- Monorepo, tsconfig strict, eslint/prettier, vitest, docker-compose (pg + redis), `.env.example`, `pnpm check` script.
- `packages/shared`: Zod schemas for everything in §4 + inferred types + `parseRuleDef()`.
- DoD: `pnpm check` green; a test proves an invalid DSL fails Zod with a path.

### Phase 1 — Engine  *(gate)*
- `compileRule` / `execute` for Simple Rule and Decision Table (all three hit policies, priority, defaultRow).
- All operators in §4.2, formula AST evaluator, coercion, null semantics.
- ≥ 90% line coverage on `packages/engine`; golden-file tests in `packages/engine/test/fixtures/*.json` (def + input + expected).
- Benchmark script proves §5 performance budget.
- DoD: coverage report + bench numbers in the summary.

### Phase 2 — Persistence + CRUD  *(gate)*
- Drizzle schema (§3), migrations, seed script (1 workspace, 1 sample rule of each type).
- Fastify app skeleton, `/health`, rules CRUD, api-keys CRUD, Swagger.
- Integration tests against dockerised Postgres (vitest + testcontainers-style setup using compose).
- DoD: CRUD tests green; Swagger renders.

### Phase 3 — Lifecycle + Auth  *(gate)*
- Register/login (bcrypt + JWT), RBAC (owner/editor/viewer).
- `test` → `tested`; `publish` → immutable version + env pointer; `rollback`; `versions` list.
- Status transition guard table with tests (draft→tested→published, edit resets to draft).
- DoD: full lifecycle e2e test: create → test → publish staging → publish production → edit → rollback.

### Phase 4 — Execution API  *(gate)*
- `/v1/execute` + bulk, API-key auth, per-key rate limit, Redis + in-process caches with invalidation, async execution logging, execution log endpoint.
- Load test (autocannon) report: P95 latency at 200 rps on a 50-row table.
- DoD: load-test numbers + cache invalidation test (publish → next request serves new version).

### Phase 5 — (Optional, only if approved) Minimal web console
- Next.js app in `apps/web`: rule list, JSON/DSL editor with Zod errors, test console, publish button, execution log. No visual builder yet.

---

## 8. Definition of "optimized" for this project

- Pure engine package ⇒ can later run in-browser, in a worker, or as a Lambda without touching the API.
- Compile once, execute many; cache keyed by immutable `version_id` so invalidation is trivial.
- Hot path does zero DB reads on a warm cache and never awaits the log write.
- JSON DSL (not code) ⇒ safe multi-tenancy, diffable versions, and a visual builder can target it later.
- Strict Zod at every boundary ⇒ the agent can't ship a silently wrong shape.

---

## 9. Phase summary template (agent posts this at each gate)

```
## Phase N complete — <name>
Done: …
Tests: X passed / coverage Y% / bench or load numbers
Deviations from spec: … (or "none")
Open questions: …
Next (needs approval): Phase N+1 — …
```
