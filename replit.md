# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required Azure app env: `AZURE_PG_HOST`, `AZURE_PG_DATABASE`, `AZURE_PG_PORT`,
  `AZURE_PG_SCHEMA`, `AZURE_PG_SP_USER`, `AZURE_PG_PASSWORD`, and
  `AZURE_PG_SSLMODE` — external Dynamics 365 PostgreSQL connection.
  The database must be `d365crm` and schema must be `crm`.
- `DATABASE_URL` is the retained legacy development source/backup only. Runtime
  reads, writes, authentication sessions, and background jobs do not use it.
- Explicit one-time migration (API must be stopped):
  `pnpm --filter @workspace/api-server exec tsx src/scripts/migrateAzureEto.ts --execute`
  This refuses existing destination tables; never rerun to merge production data.
- Rollback-only table CRUD verification:
  `pnpm --filter @workspace/api-server exec tsx src/scripts/verifyAzureEtoCrud.ts`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- ETO Tracker now uses Azure PostgreSQL `d365crm`, with every application table
  explicitly qualified in `crm` and using one `eto_` prefix. Existing prefixed
  table names stay unchanged; `users` becomes `eto_users`, etc. All route SQL,
  sessions, review outputs, settings, audits, reminders, and attachment indexing
  use the same writable Azure application pool. There is no local fallback.
- Missing/incorrect Azure app configuration, missing tables, or missing CRUD
  permissions prevent startup instead of silently serving another database.
  An isolated read-only health-check pool remains for
  `GET /api/healthz/azure-crm`, which returns status without credentials or CRM
  records. Both pools handle idle connection errors without an unhandled crash.
- Azure is an external shared database: Replit Publish does not migrate it.
  Task merges must not issue automatic remote DDL. Explicit schema tooling
  is restricted to the 18 owned `crm.eto_*` tables, not other CRM tables.
- Development and deployment configure Azure independently. Pointing both at
  this same database/schema shares app data. Before publishing the cutover,
  reconcile any production-only legacy records; integer IDs and role-bearing
  users must never be blindly overwritten or merged.
- The selected reconciliation policy and execution approvals are documented in
  `reports/eto-production-migration-plan.html` and
  `.agents/memory/shared-dataset-policy.md`.
- Offline preparation tooling is in `artifacts/api-server/src/lib/shared-merge/`.
  Run `pnpm --filter @workspace/api-server exec tsx src/scripts/prepareSharedEtoMerge.ts --fixture`
  for synthetic-only verification. It has no database client or execute mode.
  Policy helpers are staged, not enabled on live routes; see its README for
  schema/UI/API, identity/default approval and migration release gates.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
