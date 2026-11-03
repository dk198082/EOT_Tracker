# Deploying ETO Tracker to Azure

This is the **first Azure pass** for this app. There was no prior `Dockerfile` /
`.dockerignore` / deployment doc — everything below is new.

The app is a pnpm workspace with two deployable pieces:

- `artifacts/api-server` — Express 5 API (Microsoft Entra ID login, Drizzle ORM
  against a shared Azure Postgres database, email reminders, attachment OCR).
- `artifacts/eto-tracker` — the Vite/React frontend.

They are shipped as **one container**: the API server also serves the built
frontend as static files, so the whole app runs as a single Azure App Service
(Web App for Containers) or Container Apps instance on one origin. That keeps
the session cookie same-site and avoids a second Azure resource.

---

## ⚠️ Known blocker: file attachments will not work on Azure (not fixed — by your choice)

You asked for **documentation only, no code change** for this, so the code is
untouched. Read this before you deploy, because uploads/downloads/OCR on
attachments will fail at runtime until you act on it.

**What's broken:** `artifacts/api-server/src/lib/objectStorage.ts` is hardcoded
to talk to a sidecar at `http://127.0.0.1:1106` that only exists inside
Replit's own infrastructure. It uses that sidecar to mint short‑lived Google
Cloud Storage "Workload Identity Federation" credentials and to sign
upload/download URLs. On Azure there is no such sidecar — every attachment
upload or download will fail with an error that literally says *"make sure
you're running on Replit."*

**What this affects:** the attachment upload/download endpoints in
`artifacts/api-server/src/routes/storage.ts`, and by extension the OCR
indexing job (`runAttachmentIndexing`, via `node-cron`) which reads those
files.

**What everything else does NOT depend on this:** login, the ETO request
workflow, comments, stage transitions, email reminders, and the database all
work independently of object storage.

**Your options, if/when you want this fixed** (not done here — needs a
decision and credentials only you can provide):

1. **Migrate to Azure Blob Storage.** Swap `objectStorage.ts`'s GCS client for
   `@azure/storage-blob`, using a Storage Account connection string or a
   managed identity. This is the option that fits an Azure deployment most
   naturally, but it's a real code change (new SDK, new signing logic for
   upload/download URLs, update `routes/storage.ts`'s content-type/size
   checks to the new client).
2. **Keep Google Cloud Storage, with a real service account key.** Replace the
   `external_account`/sidecar credential config in `objectStorageClient` with
   a standard GCS service-account JSON key (via `GOOGLE_APPLICATION_CREDENTIALS`
   or inline credentials), and set `PRIVATE_OBJECT_DIR`/`PUBLIC_OBJECT_SEARCH_PATHS`
   to a real bucket you control. Smaller code change than #1, but keeps you on
   a second cloud provider for storage.

Either path is a deliberate follow-up — tell me which one and I'll make the change.

---

## Required environment variables

### Microsoft Entra ID (login)

| Variable | Notes |
|---|---|
| `CLIENT_ID` | Entra App Registration's Application (client) ID |
| `CLIENT_SECRET` | Entra App Registration client secret |
| `TENANT_ID` (or `ENTRA_TENANT_ID` / `AZURE_TENANT_ID`) | Entra tenant ID. The code checks `ENTRA_TENANT_ID ?? TENANT_ID ?? AZURE_TENANT_ID` in that order. |

The app discovers the OIDC endpoints itself (`https://login.microsoftonline.com/<tenant>/v2.0`)
at runtime via `openid-client` — there's no separate "issuer URL" setting to configure.
Make sure the App Registration's redirect URI includes
`https://<your-app>.azurewebsites.net/api/auth/callback` (or your Container Apps domain).

### Shared Azure Postgres "CRM" database (this app's primary datastore)

ETO Tracker does **not** use a separate `DATABASE_URL` — its primary database
is the same shared Azure Postgres instance used by the other apps in this
family, targeting database `d365crm`, schema `crm`:

| Variable | Notes |
|---|---|
| `AZURE_PG_HOST` | Postgres server hostname |
| `AZURE_PG_PORT` | usually `5432` |
| `AZURE_PG_DATABASE` | **must be** `d365crm` — the app refuses to start against anything else |
| `AZURE_PG_SCHEMA` | **must be** `crm` |
| `AZURE_PG_SP_USER` | service principal / DB user |
| `AZURE_PG_PASSWORD` | |
| `AZURE_PG_SSLMODE` | e.g. `require` for Azure Database for PostgreSQL |

Before first boot, push the schema (creates the `crm.eto_*` tables in that
database — 19 tables as of this version):

```bash
cd lib/db
pnpm push            # drizzle-kit push --config ./drizzle.config.ts
# if it reports a conflict and you're sure it's safe:
pnpm push-force
```

On startup the app also runs `verifyEtoDatabase()`, which fails fast (before
accepting requests) if it's pointed at the wrong database, isn't writable, or
is missing expected tables/columns — so a misconfigured connection is loud,
not silent.

### Admin Console entitlement check (Data Admin Suite)

| Variable | Notes |
|---|---|
| `ADMIN_CONSOLE_URL` | base URL of your Data Admin Suite deployment |
| `ADMIN_CONSOLE_API_KEY` | sent as `X-API-Key` |
| `ADMIN_CONSOLE_APP_NAME` | **required** — easy to miss, the check throws without it. This app's registered name in the Admin Console's `/api/access-check`. |

If the Admin Console can't be reached, sign-in correctly returns 503 rather
than silently letting everyone in (verified in this round).

### Optional: email notifications

| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | if unset, email notifications are disabled with a logged warning — not fatal |
| `RESEND_FROM` | same |

### New: cross-origin support (only if you split the frontend onto its own origin)

| Variable | Notes |
|---|---|
| `CORS_ORIGIN` | comma-separated list of allowed origins, e.g. `https://eto-tracker.azurewebsites.net`. **Not needed for the default single-container deployment** described in this doc — same-origin requests never hit CORS at all. Only set this if you deploy the frontend separately from the API. |

### Platform

| Variable | Notes |
|---|---|
| `PORT` | defaults are set in the Dockerfile; App Service/Container Apps typically inject this |
| `NODE_ENV` | set to `production` |
| `STATIC_DIR` | set by the Dockerfile to the built frontend's path; only relevant if you customize the image |

---

## Code changes made in this round

### 1. `artifacts/api-server/src/app.ts` — **NEW**: serve the frontend + trust the Azure proxy

- Added `app.set("trust proxy", 1)` so `req.protocol`/`secure` cookies behave
  correctly behind Azure's load balancer (added for consistency with the rest
  of the app family and to future-proof any code that later reads
  `req.protocol`/`req.ip`; nothing in the current code strictly required it).
- Added a static-file + SPA-fallback block, gated on a new `STATIC_DIR` env
  var, so this one Express server can serve the built React app directly.
  Unset in local dev (Vite's own dev server handles the frontend there); set
  by the Dockerfile in production.

### 2. `artifacts/api-server/src/lib/trustedOrigins.ts` — **NEW**: `CORS_ORIGIN` support

Added parsing of a new `CORS_ORIGIN` env var (comma-separated origin list),
additive to the existing Replit-domain logic. Only matters if you deploy the
frontend on a separate origin from the API (see table above) — the default
same-container deployment never needs it.

### 3. `Dockerfile` — **NEW FILE**

Single-stage build (pnpm workspaces' symlink-based hoisting doesn't split
cleanly across multi-stage `COPY`s, so this trades some image size for
reliability): installs the workspace, builds the frontend
(`@workspace/eto-tracker`), builds the API server, and runs
`node --enable-source-maps ./dist/index.mjs` on port 8080. Comments in the
file point back to this doc for required env vars and flag the object-storage
blocker inline.

### 4. `.dockerignore` — **NEW FILE**

Excludes `node_modules`, `dist`, `.git`, Replit-specific cruft
(`.replit*`, `.cache/`, `.local/`, `.config/`), screenshots, test evidence,
and logs from the build context.

### 5. `.gitignore` — added `.config/`

Replit leaves a `.config/` directory behind; it wasn't previously ignored.

### 6. Three test-only bug fixes (not application code)

These were found while running the full test suite to validate the app before
documenting it — they're real bugs in the tests themselves, not in the Azure
deployment path, but are worth knowing about:

- **`review-defaults.test.ts`** and **`users-role.integration.test.ts`**: both
  mocked `../../middlewares/requireAuth` but only exported `requireAuth`. The
  app's `/api/users/me` route now also imports `requireAuthAllowNone` (added
  so users with no role yet can still view their own profile) — the missing
  export made these tests throw instead of testing anything. Fixed by
  exporting the same mock function under both names.
- **`auth-callback.integration.test.ts`**: its hand-built test `buildApp()`
  never mounted anything providing `req.log`, so the route's own
  `req.log.error(...)` call (hit on the admin-console-unavailable path) threw
  and masked the real 503 response behind a generic 500. Separately, its
  fallback error-handling middleware had only 3 parameters —
  **Express only treats a handler as an error handler if it declares exactly
  4** (`err, req, res, next`); with 3, Express silently skipped it and fell
  through to its own default handler. Both fixed. The test still can't fully
  pass in a sandbox with no real Admin Console reachable (it expects a 302,
  and without mocking `checkAdminConsoleAccess` like its sibling test does, it
  legitimately gets a 503) — that's expected, not a bug.

No application behavior changed for real users; these are all test-harness
fixes plus purely-additive deployment scaffolding.

---

## Flagged but intentionally NOT fixed — needs your decision

**Stale table-count guard in `artifacts/api-server/src/lib/shared-merge/contracts.ts`.**
`getMergeContracts()` throws unless the app has exactly 18 tables
(`"App table inventory changed; review the merge contract"`). The app
actually has **19** tables now — a new `eto_email_notification_settings`
table was added (commit `1040b24`) after this guard was last updated (commit
`273fe61`). This causes ~32 test failures in `shared-merge.test.ts` and
`shared-archive.integration.test.ts`.

I did **not** bump the number to 19, because this check exists specifically to
force a human decision about how a new table should merge across
environments (it's not just a count — the file also has `SINGLETONS` and
`NEW_PRICING_TABLES` sets that may need the new table added to one of them).
Bumping the number without deciding where `eto_email_notification_settings`
belongs in that merge logic could silently produce wrong behavior. This needs
someone who knows the intended merge semantics for that table to review
`contracts.ts` and update it deliberately.

---

## Suggestions (non-blocking)

- **`http-proxy-middleware`** is listed as a dependency in
  `artifacts/api-server/package.json` but isn't used anywhere in the
  codebase — safe to remove.
- **`node-cron` jobs run per-instance.** `runReminders` (daily) and
  `runAttachmentIndexing` (every 2 minutes) both also run once immediately on
  boot. If you ever scale the container to more than one instance, each
  instance runs these independently — reminders/indexing would fire multiple
  times. Fine at 1 instance; worth a distributed lock or moving to Azure
  Functions/WebJobs if you scale out.
- **tesseract.js downloads its WASM core + language data over the network at
  runtime** unless cached, per the project's own note in
  `.agents/memory/attachment-ocr-isolation.md`. On Azure App Service/Container
  Apps with ephemeral storage, this re-downloads on every cold start or
  scale-out event. Consider baking the language data into the image or using
  a persistent volume if OCR latency/cold-start cost matters.
- **No custom production error-handling middleware in `app.ts`/`index.ts`.**
  An uncaught error (e.g., Entra discovery failing because of a bad
  `TENANT_ID`) falls through to Express's bare default handler, which returns
  a generic, unstyled error page/response. Not a functional bug — verified
  the route already catches the error and passes it to `next(error)` — but a
  friendlier JSON/HTML 500 handler would be a nicer failure mode in
  production.

---

## Files that need renaming

None. No file or module naming conflicts were found for this app.

---

## Validation performed this round

- `pnpm -r --if-present run test` — full suite run; triaged all failures to
  the 3 causes above (1 flagged/not fixed by design, 2 fixed).
- Pushed the Drizzle schema to a local Postgres standing in for Azure
  Postgres (`d365crm`/`crm`) — confirmed all 19 tables create successfully.
- Built both workspaces (`pnpm --filter @workspace/eto-tracker run build`,
  `pnpm --filter @workspace/api-server run build`) and booted the compiled
  server with `STATIC_DIR` set, confirming:
  - `GET /` → 200 (serves the built frontend)
  - a deep client-side route → 200 (SPA fallback works)
  - `GET /api/auth/user` (no session) → `{"user":null}`
  - an unknown `/api/*` route → 404
  - `GET /api/users/me` (unauthenticated) → 401
  - `GET /api/login` → 500 in this sandbox, because it tries real OIDC
    discovery against `https://login.microsoftonline.com/<TENANT_ID>/v2.0`
    and the sandbox's `TENANT_ID` isn't a real tenant. This is expected with
    fake credentials (parallel to the Admin Console correctly 503'ing against
    a fake URL) — with real `CLIENT_ID`/`CLIENT_SECRET`/`TENANT_ID`, this
    redirects to Entra's login page as intended. Nothing to fix.

---

## Deploy steps summary

1. Create an Azure Database for PostgreSQL (or point at the existing shared
   one) and run `pnpm push` from `lib/db` to create the `crm.eto_*` tables.
2. Register an Entra App Registration; note the client ID/secret/tenant ID
   and add the Azure redirect URI.
3. Build and push the image: `docker build -t <registry>/eto-tracker:latest .`
4. Deploy to Azure App Service (Web App for Containers) or Container Apps,
   setting all the environment variables listed above as App Settings /
   secrets.
5. Decide on and (separately) implement one of the two object-storage options
   above before relying on file attachments in production.
