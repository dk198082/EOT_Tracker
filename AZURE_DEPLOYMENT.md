# Deploying ETO Tracker to Azure

The app is a pnpm workspace with two deployable pieces:

- `artifacts/api-server` — Express 5 API (Microsoft Entra ID login, Drizzle ORM
  against a shared Azure Postgres database, email via Microsoft Graph,
  attachment OCR).
- `artifacts/eto-tracker` — the Vite/React frontend.

They are shipped as **one container**: the API server also serves the built
frontend as static files, so the whole app runs as a single Azure App Service
(Web App for Containers) or Container Apps instance on one origin. That keeps
the session cookie same-site and avoids a second Azure resource.

---

## ⚠️ Known blocker: file attachments will not work on Azure (not fixed — by your choice)

Unchanged from the last round, and still **not touched** per your decision to
document only, no code change. Read this before you deploy — uploads,
downloads, and OCR on attachments will fail at runtime until you act on it.

**What's broken:** `artifacts/api-server/src/lib/objectStorage.ts` is hardcoded
to talk to a sidecar at `http://127.0.0.1:1106` that only exists inside
Replit's own infrastructure. It uses that sidecar to mint short‑lived Google
Cloud Storage "Workload Identity Federation" credentials and to sign
upload/download URLs. On Azure there is no such sidecar — every attachment
upload or download will fail with an error that literally says *"make sure
you're running on Replit."*

**What this affects:** the attachment upload/download endpoints in
`artifacts/api-server/src/routes/storage.ts`, and the OCR indexing job
(`runAttachmentIndexing`, via `node-cron`) which reads those files.

**What everything else does NOT depend on this:** login, the ETO request
workflow, comments, stage transitions, email notifications, and the
database all work independently of object storage.

**Your options, if/when you want this fixed** (not done here — needs a
decision and credentials only you can provide):

1. **Migrate to Azure Blob Storage** — fits an Azure deployment most
   naturally, but is a real code change (new SDK, new signing logic,
   updated `routes/storage.ts` checks).
2. **Keep Google Cloud Storage, with a real service account key** — smaller
   code change, but keeps you on a second cloud provider for storage.

Tell me which path and I'll make the change.

---

## Required environment variables

### Microsoft Entra ID (login and, as of this round, email)

| Variable | Notes |
|---|---|
| `CLIENT_ID` | Entra App Registration's Application (client) ID |
| `CLIENT_SECRET` | Entra App Registration client secret |
| `TENANT_ID` (or `ENTRA_TENANT_ID` / `AZURE_TENANT_ID`) | Entra tenant ID. Login code checks `ENTRA_TENANT_ID ?? TENANT_ID ?? AZURE_TENANT_ID`; email code checks `ENTRA_TENANT_ID ?? TENANT_ID ?? AZURE_TENANT_ID` as well — same precedence, keep them consistent. |

**New in this round: the app now also uses this same App Registration to send
email via Microsoft Graph** (previously it used Resend — see "New changes"
below). That means the App Registration needs an **application permission**
it may not have yet: **`Mail.Send`** (admin-consented), so it can send mail
as the mailbox in `GRAPH_SENDER_EMAIL` below.

Make sure the App Registration's redirect URI includes
`https://<your-app>.azurewebsites.net/api/auth/callback` (or your Container
Apps domain). The app discovers OIDC endpoints itself at runtime — no
separate issuer URL setting.

### Email via Microsoft Graph (replaces the old Resend integration)

| Variable | Notes |
|---|---|
| `GRAPH_SENDER_EMAIL` | mailbox address the app sends as; needs `Mail.Send` permission on the App Registration above |
| `APP_BASE_URL` | **must** be an `https://` URL identifying the published app (used to build links in emails). Email sending throws if this is missing or not HTTPS. |

If `CLIENT_ID`/`CLIENT_SECRET`/a tenant ID/`GRAPH_SENDER_EMAIL` aren't all
set, email sending is disabled with a logged warning — not fatal, same
graceful-degradation pattern as before.

`RESEND_API_KEY`/`RESEND_FROM` are **gone** — the `resend` package was
removed from `package.json` in this update. If you had those set as App
Settings from a previous deployment, they're now unused and can be removed.

### Shared Azure Postgres "CRM" database (this app's primary datastore)

Unchanged: ETO Tracker's primary database is the shared Azure Postgres
instance used by the other apps in this family, targeting database
`d365crm`, schema `crm`.

| Variable | Notes |
|---|---|
| `AZURE_PG_HOST` | Postgres server hostname |
| `AZURE_PG_PORT` | usually `5432` |
| `AZURE_PG_DATABASE` | **must be** `d365crm` — the app refuses to start against anything else |
| `AZURE_PG_SCHEMA` | **must be** `crm` |
| `AZURE_PG_SP_USER` | service principal / DB user |
| `AZURE_PG_PASSWORD` | |
| `AZURE_PG_SSLMODE` | e.g. `require` for Azure Database for PostgreSQL |

Before first boot (or after this update, to add the one new table — see
below), push the schema:

```bash
cd lib/db
pnpm push            # drizzle-kit push --config ./drizzle.config.ts
# if it reports a conflict and you're sure it's safe:
pnpm push-force
```

There's also a `lib/db/migrations/` folder with generated SQL snapshots
(including a new `20261105_email_delivery_events.sql` from this round) — this
is reference/history only; the app's actual deploy path is still
`drizzle-kit push`, not `drizzle-kit migrate`.

`verifyEtoDatabase()` still fails fast on boot if the database is
misconfigured, unwritable, or missing expected tables/columns.

### Admin Console entitlement check (Data Admin Suite)

Unchanged.

| Variable | Notes |
|---|---|
| `ADMIN_CONSOLE_URL` | base URL of your Data Admin Suite deployment |
| `ADMIN_CONSOLE_API_KEY` | sent as `X-API-Key` |
| `ADMIN_CONSOLE_APP_NAME` | **required** — easy to miss |

### Optional: cross-origin support

| Variable | Notes |
|---|---|
| `CORS_ORIGIN` | comma-separated allowed origins. **Not needed** for the default single-container deployment described here — only set this if you deploy the frontend on its own origin, separate from the API. |

### Platform

| Variable | Notes |
|---|---|
| `PORT` | App Service/Container Apps typically injects this |
| `NODE_ENV` | set to `production` |
| `STATIC_DIR` | set by the Dockerfile to the built frontend's path |

---

## New changes in this round

This export picked up real feature work done since the last Azure pass
(email notifications moved from Resend to Microsoft Graph, plus a delivery
audit trail) — my Azure scaffolding from before had been stripped by that
re-export (expected: a fresh Replit export doesn't carry forward code added
outside Replit), so it's reapplied here along with updates for what changed.

### Reapplied (same as before, no functional change from last round)

- `artifacts/api-server/src/app.ts` — `trust proxy`, `STATIC_DIR`-gated
  static/SPA-fallback serving.
- `artifacts/api-server/src/lib/trustedOrigins.ts` — optional `CORS_ORIGIN`.
- `Dockerfile`, `.dockerignore` — unchanged; no new workspace packages were
  added, so the existing build steps still apply as-is.
- `.gitignore` — `.config/` entry.
- Two of the three test fixes from last round (`requireAuthAllowNone` missing
  from two mocks; `req.log` stub + error-handler arity in
  `auth-callback.integration.test.ts`) — all three bugs had resurfaced in
  this export and are fixed again, identically to before.

### New this round, because of the Resend → Microsoft Graph migration

- **`GRAPH_SENDER_EMAIL`** and **`APP_BASE_URL`** are new required env vars
  for email (see table above). `RESEND_API_KEY`/`RESEND_FROM` no longer
  apply.
- **Your Entra App Registration needs the `Mail.Send` application permission,
  admin-consented**, for the mailbox in `GRAPH_SENDER_EMAIL`. Without it,
  email sending will fail at the Graph API call (logged, non-fatal — the app
  degrades gracefully, same as a missing config).
- A new table, `eto_email_delivery_events`, was added to record a durable
  audit trail of every notification batch sent (who, what, delivery status
  per recipient). Covered by the `pnpm push` above.
- No code changes were needed for this migration to work on Azure — Graph
  auth reuses the same Entra credentials as login, which is actually simpler
  than the old Resend setup (one less third-party API key to manage).

---

## Flagged but intentionally NOT fixed — needs your decision

**Stale table-count guard in `artifacts/api-server/src/lib/shared-merge/contracts.ts`**
is now even more out of date. `getMergeContracts()` throws unless the app has
exactly **18** tables. The app now has **20** (two new tables since that
check was last updated: `eto_email_notification_settings`, added before the
last round, and `eto_email_delivery_events`, added in this round). This
causes dozens of test failures in `shared-merge.test.ts` and
`shared-archive.integration.test.ts`.

As before, I did **not** bump the number, because this check exists
specifically to force a human decision about how each new table should merge
across environments — not just a count (the file's `SINGLETONS` and
`NEW_PRICING_TABLES` sets may need one or both new tables added). Two tables
are now pending this review, not one; worth prioritizing before this drifts
further.

---

## Suggestions (non-blocking)

Carried forward from last round (still true):

- `http-proxy-middleware` dependency is unused — safe to remove.
- `node-cron` jobs (`runReminders`, `runAttachmentIndexing`) run
  per-instance; fine at 1 instance, worth a distributed lock if you scale out.
- `tesseract.js` downloads its WASM core + language data over the network at
  runtime unless cached — re-downloads on every cold start on Azure's
  ephemeral storage.
- No custom production error-handling middleware in `app.ts`/`index.ts` — an
  uncaught error falls through to Express's bare default handler. Not a bug,
  but a friendlier 500 handler would be nicer in production.

---

## Files that need renaming

None.

---

## Validation performed this round

- `pnpm -r --if-present run test` — full suite. Found and fixed the same 3
  test bugs as last round (they'd resurfaced in this export). Found 2
  additional test "failures" that are **not bugs**:
  - `email-delivery-history.integration.test.ts` needs an existing row in
    `crm.eto_requests` to run against — same pattern as other
    `.integration.test.ts` files needing real seed data, not something to
    fix here.
  - `email-notifications.test.ts`'s Graph token-refresh test initially
    appeared to fail in my sandbox, but that was **my own test-environment
    pollution** (a `TENANT_ID` shell variable I'd set for an unrelated check
    took precedence over the test's env stub, due to the same
    `ENTRA_TENANT_ID ?? TENANT_ID ?? AZURE_TENANT_ID` precedence used in
    production code) — not a bug in the app or the test. Confirmed by
    re-running with a clean environment: passes.
  - All remaining failures are the known stale-merge-contract-count issue
    (now worse: 20 tables vs. a hardcoded 18) and the Admin-Console-dependent
    `auth-callback.integration.test.ts` (needs a real Admin Console; 503
    without one, by design).
- Pushed the Drizzle schema to a local Postgres standing in for Azure
  Postgres — confirmed all **20** tables (one more than last round) create
  successfully.
- Rebuilt both workspaces and re-ran the full boot-test checklist against the
  compiled server, now with `GRAPH_SENDER_EMAIL`/`APP_BASE_URL` set too:
  - `GET /` → 200, deep route → 200 (SPA fallback)
  - `GET /api/auth/user` (no session) → `{"user":null}`
  - unknown `/api/*` → 404
  - unauthenticated `/api/users/me` → 401
  - `GET /api/login` → 500, same as last round — expected with a fake
    `TENANT_ID` against the real Entra discovery endpoint; nothing to fix.

---

## Deploy steps summary

1. Create an Azure Database for PostgreSQL (or point at the existing shared
   one) and run `pnpm push` from `lib/db` to create/update the `crm.eto_*`
   tables (20 as of this version).
2. Register (or reuse) an Entra App Registration; add the `Mail.Send`
   application permission (admin-consented) in addition to login scopes; add
   the Azure redirect URI.
3. Build and push the image: `docker build -t <registry>/eto-tracker:latest .`
4. Deploy to Azure App Service (Web App for Containers) or Container Apps,
   setting all the environment variables above as App Settings/secrets —
   including the new `GRAPH_SENDER_EMAIL`/`APP_BASE_URL`, and removing any
   old `RESEND_*` settings from a prior deployment.
5. Decide on and (separately) implement one of the two object-storage options
   above before relying on file attachments in production.
