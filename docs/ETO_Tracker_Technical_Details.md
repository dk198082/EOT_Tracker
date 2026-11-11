# ETO Tracker — Technical Details and End-to-End Flow

**Updated September 2026 · As-built application**

This is the implementation reference for the current ETO Tracker. It covers runtime components, key functions, API routes, persisted data, the stage pipeline, and what happens from sign-in through a completed request. The [MVP Contract](ETO_MVP_Contract.md), [Business & Process Brief](ETO_Business_Process_Brief.md), and [Solution Blueprint](ETO_MVP_Solution_Blueprint.md) describe the corresponding product and business scope. Code paths below are relative to the repository root.

## 1. Runtime architecture

```text
Browser
  React + Vite / Wouter / React Query
  artifacts/eto-tracker/src
            │ generated hooks and custom fetch (session cookie)
            ▼
Express API at /api
  artifacts/api-server/src
  Entra OIDC login → DB-backed session → local app role
  request validation → role gate → workflow/state validation
            │                   │                    │
            ▼                   ▼                    ▼
   PostgreSQL / Drizzle    Private Object Storage    Microsoft Graph email
  lib/db/src/schema       attachments + previews   if configured
            ▲
            │
  API background jobs: daily reminders; attachment text indexing
  Optional Azure CRM PostgreSQL: read-only connectivity health check
```

| Component | Responsibility |
|---|---|
| `artifacts/eto-tracker` | Web UI for sign-in, dashboard, ETO list, request creation/detail, workflow diagram, and administration. Wouter handles routes; React Query and the generated `@workspace/api-client-react` hooks handle API state. |
| `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | API contract, runtime request schemas, and generated frontend hooks/fetch wrapper. The UI is not the authority for permission or transition checks. |
| `artifacts/api-server` | Express routes under `/api`; OIDC/session handling, role authorization, request persistence, state machine, calculations, storage access, notifications, and background jobs. |
| `lib/db` | Drizzle schema and PostgreSQL connection. Local users retain application roles independently of Entra identity. |
| Replit Object Storage | Private attachment objects. Database attachment rows carry metadata and storage references; file bytes are not stored in PostgreSQL. |
| Microsoft Graph | Optional outbound stage-change emails and inactivity reminders, sent from the configured tenant mailbox. Email acceptance is not required for a successful stage transition. |
| Azure CRM PostgreSQL | Optional read-only **health connection**. It does not perform ETO/D365 synchronization or write orders. |

The web artifact uses its configured base path for browser routes. The API router is mounted at `/api`. The API server listens on `PORT`; its startup registers the jobs described in §10.

## 2. Sign-in, roles, and request authorization

1. `AppRouter` and `AuthenticatedRoute` in `artifacts/eto-tracker/src/App.tsx` display sign-in when there is no authenticated user and wrap protected pages with `AppLayout` otherwise. The frontend redirects to the API's Microsoft Entra OIDC login.
2. `GET /api/login` creates OIDC state, nonce, and PKCE verifier; `GET /api/auth/callback` validates the response and maps the Entra object identifier (with subject fallback) to a local user. The application creates a database-backed session and sets an HTTP-only session cookie. See `artifacts/api-server/src/routes/auth.ts` and `src/lib/auth.ts`.
3. `authMiddleware` hydrates the session on API requests; `requireAuth` rejects missing sessions (401) and identities without provisioned application access (403), then loads the local role. Roles are `sales`, `art`, `engineering`, `production`, `admin`, and `superuser`.
4. Server-side role guards control mutations; hiding a button in the UI is not authorization. Admin/SuperUser can manage users, default reviewers, and formulas. Admin is **not** automatically an ART/Engineering/Production decision-maker.
5. A SuperUser may simulate `sales`, `art`, `engineering`, or `production` permissions using the `x-eto-simulated-role` header. The real user ID remains the actor in audit records; the simulated role is recorded separately. Admin/SuperUser cannot be selected as simulated roles. The web shell stores the chosen simulation for the session and the fetch wrapper attaches the header.
6. On an authenticated-user change, `AuthQueryClientCacheInvalidator` clears React Query's cache to avoid showing the previous user's data. Login/callback, health, and the specifically signed preview route have different access handling from ordinary authenticated workflow routes.

## 3. Frontend functions and views

| View / module | Technical function |
|---|---|
| `App.tsx` | `AppRouter` declares `/dashboard`, `/eto-requests`, `/eto-requests/new`, `/eto-requests/:id`, `/workflow`, and `/admin`; `AuthenticatedRoute` gates protected pages. |
| `pages/Dashboard.tsx` | Fetches live metrics and `my-queue`; links counts, overdue items, and assigned requests to the list/detail views. |
| `pages/EtoList.tsx` | Server-backed search, stage/overdue/split-family filters, and pagination. Search is debounced; a family filter keeps split siblings together. |
| `pages/NewEtoRequest.tsx` | Zod/react-hook-form validation, creates a Draft ETO, then uploads optional files using signed URLs and registers their attachment metadata. |
| `pages/EtoDetail.tsx` | Fetches the request, decisions, audit trail, comments, attachments, outputs, and detail-change history. Renders role- and stage-specific controls, saves editable details/outputs, and submits transition decisions. |
| `pages/Admin.tsx` and formula/default components | Admin/SuperUser user creation, role changes and deletion; selection of default Engineering/Production reviewers; design/assembly formula settings and change history. |
| `pages/WorkflowDiagram.tsx` | Read-only explanation of the stage pipeline with SVG export. It does not control the server state machine. |
| `lib/api-client-react/src/custom-fetch.ts` | Connects generated API hooks to the proxied API, includes the session cookie, and sends the simulation header when applicable. |

Frontend validation improves usability, but the API independently validates payloads, roles, stage state, and reviewer assignments.

## 4. Complete request lifecycle

### A. Draft creation and optional files

1. Sales completes required intake data: customer/quote, distributor, request and system types, force and displacement ranges **with separate units**, materials, specimen dimensions, results required, and custom request details. Standards, budget/currency, requested lead time, similar parts, and attachments are optional. The API validates the create payload with `CreateEtoRequestBody`.
2. `POST /api/eto-requests` generates a unique ETO number, stores the Draft with the submitter, and records a **draft → draft creation audit entry**. Creation is not the same as submitting the request to ART.
3. For an optional attachment, the client asks `POST /api/storage/uploads/request-url` for a short-lived signed PUT URL, uploads bytes directly to private storage, then calls `POST /api/eto-requests/:id/attachments` to register a DB row. The pending upload token is scoped to the user and ETO. See §9 for download, preview, indexing, and deletion.

### B. Submit and route

4. Sales (or ART) submits the Draft using `POST /api/eto-requests/:id/transitions` with decision `submit`. The stage becomes `art-review`; its individual assignee is cleared so ART can pick it up from the queue. The transition is audited, and configured email attempts to notify ART.
5. ART Review can return to Draft (with reason), decline (with reason), or accept. Acceptance sends independent `includeEngineeringReview` and `includeProductionReview` flags; **both default to true**, but either or both can be disabled. If Engineering is included, ART may choose a particular engineer instead of the configured default.
6. Acceptance goes to Engineering if included, otherwise Production if included, otherwise ART Final. Entering a specialist review requires a valid user of that role: the per-request engineer override or Admin-selected default for Engineering, and the Admin-selected default for Production. Missing/invalid reviewers reject the transition with 422 rather than silently leaving work unassigned.

### C. Specialist outputs and final quote

7. Engineering records positive estimated design hours and P/N guidance and chooses `engineering-quote-ready`. The server calculates design cost and lead time from the configured formula, stores the resulting output and formula values, then advances to Production (if included) or ART Final.
8. Production records nonnegative procurement cost, procurement lead time in weeks, and assembly hours, then chooses `production-approve`. The server calculates assembly cost and lead time using the assembly formula, persists its output, and advances to ART Final. Production has no Decline action.
9. ART Final sets market price/currency and market lead time, then chooses `art-final-quote`; the request becomes `quoted`. These market values are separate from specialist cost and time estimates.
10. Sales or ART marks the Quoted request `won` or `lost` (Lost requires a reason), or returns it to ART Final with a reason. Won and Lost are terminal; no quote document, D365 order, or part number is automatically produced.

### D. Returns, abandonment, and split families

11. Returns are **backward stage transitions with a recorded reason**, not same-stage “More Info” loops: ART Review → Draft; Engineering → ART Review; Production → Engineering if included, otherwise ART Review; ART Final → Production when included, otherwise Engineering when included, otherwise ART Review. ART Final can explicitly return to Engineering only after a prior completed Engineering review; that action enables Engineering on the request. Quoted → ART Final is also available.
12. ART can abandon a request at any active stage (including Draft and Quoted), providing a reason. `reopen` consults the latest abandonment audit entry and restores its previous stage; the stored assignee remains parked across abandonment/reopen. Declined is an ART-only terminal outcome from ART Review or ART Final.
13. ART/SuperUser can split an **unsplit ART Review parent** into child requests. A transaction locks and marks the parent, creates numbered children with copied intake and attachments, and records split audit entries. Children each start at ART Review and move independently. The parent stays visible as the family anchor but cannot take normal stage transitions after the split.

## 5. Stage pipeline and decision matrix

```text
Draft --submit--> ART Review --accept--> [Engineering] --> [Production] --> ART Final
                        |                   |               |               |
                        +--return--> Draft  +--return--> ART+--return-----> prior applicable stage
                        +--decline--> Declined                               +--decline--> Declined

ART Final --quote--> Quoted --mark-won--> Won
                         +--mark-lost--> Lost
                         +--return----> ART Final

Any active stage --mark-abandoned--> Abandoned --reopen--> previous active stage
```

Square brackets indicate optional stages. The backend's `ALLOWED` decision map and `validateAndAdvance` in `artifacts/api-server/src/lib/workflow.ts` are authoritative; `closed` is a **legacy-only** stored terminal stage and is not a new transition target.

| Current stage | Decision → next stage | Allowed operational role / checks |
|---|---|---|
| Draft | `submit` → ART Review; `mark-abandoned` → Abandoned | Submit: Sales/ART. Abandon: ART with reason. |
| ART Review | `approve-engineering` → first included review or ART Final; `return-draft` → Draft; `decline` → Declined; `mark-abandoned` → Abandoned | ART. Returns, declines, abandonment require reasons. ART may also split an unsplit parent here via a separate endpoint. |
| Engineering Review | `engineering-quote-ready` → Production or ART Final; `engineering-return-art` → ART Review; `mark-abandoned` → Abandoned | Engineering for review actions; quote-ready requires design hours > 0 (≤ 1,000,000) and P/N guidance. ART controls abandonment. |
| Production Review | `production-approve` → ART Final; `production-return-engineering` → Engineering or ART Review; `mark-abandoned` → Abandoned | Production for review actions; approval requires procurement cost/lead time and assembly hours (all nonnegative; hours ≤ 1,000,000). ART controls abandonment. |
| ART Final Review | `art-final-quote` → Quoted; `art-final-return-production` → first applicable earlier review; `art-final-return-engineering` → Engineering; `decline` → Declined; `mark-abandoned` → Abandoned | ART. Quoting requires market price and lead time; return/decline/abandon needs reason. Direct return to Engineering requires a prior completed Engineering review. |
| Quoted | `mark-won` → Won; `mark-lost` → Lost; `quoted-return-art-final` → ART Final; `mark-abandoned` → Abandoned | Sales/ART for outcome or return. Lost/return/abandon requires reason; abandonment is ART-only. |
| Abandoned | `reopen` → the most recent abandoned-from stage | ART; previous stage must be recoverable from audit history. |
| Won / Lost / Declined | No further transitions | Terminal in the current workflow. |

SuperUser may take the operational actions above without changing their stored identity. Admin alone cannot bypass these role guards.

### Assignment invariants

- Specialist defaults live in `review_assignment_defaults` and are managed at Admin → Users. A default is applied **on entry** to its stage; changing it does not retroactively reassign in-progress requests.
- ART can override a specific engineer during ART approval or reassign an Engineering-stage request to another Engineering user. The chosen engineer is stored as `stickyEngineerUserId` and reused when the request returns to Engineering. Production uses the current Production default on entry.
- Actions that move into ART stages generally clear the individual assignee. Abandon/reopen preserves the parked assignment. A request with split children cannot advance as the parent.

## 6. Transition implementation and important functions

`POST /api/eto-requests/:id/transitions` in `artifacts/api-server/src/routes/transitions.ts` executes the critical path:

```text
authenticate + parse ID/body
  → validateDecisionFields(decision, body)
  → load ETO and any prerequisite audit rows
  → validateAndAdvance(current stage, decision, actor role, review flags)
  → resolve assignee/default/sticky engineer
  → DB transaction:
       conditional ETO stage update (expected stage; not a split parent)
       + upsert specialist/ART output when the decision completes a review
       + insert stage_transitions audit entry
  → return updated request
  → attempt transition email without blocking response
```

The conditional update returns **409** if the stage has changed or the parent has been split since it was read; no specialist output or transition audit is committed in that case. `stage_transitions` records the real actor, optional simulated role, from/to stages, decision, reason, review flags chosen at ART acceptance, and timestamp. This is not a same-stage More Info mechanism. Initial creation and splitting also write same-stage audit entries for their own events.

| Function / module | Purpose |
|---|---|
| `validateAndAdvance` / `advance` in `src/lib/workflow.ts` | Enforce allowed stage/decision pairs, operational role guards, optional-stage routing, and reopen target. |
| `validateDecisionFields` in `src/routes/transitions.ts` | Enforce decision-specific required values and reasons before the stage transaction. |
| `generateEtoNumber`, `fetchEtoWithJoins` in `src/routes/eto-requests.ts` | Issue request identifiers and assemble detail/list response with related users and split-family data. |
| `getSplitFamilyMetadata` in `src/lib/splitFamily.ts` | Provide parent/child family identity and ordering; list pagination expands complete families. |
| `getDesignFormula`, `calculateDesignEstimate` in `src/lib/design-formula.ts` | Load design rate/capacity settings and calculate cost and lead time. |
| `getAssemblyFormula`, `calculateAssemblyEstimate` in `src/lib/assembly-formula.ts` | Load assembly settings and calculate cost and lead time. |
| `sendTransitionEmails`, `sendInactivityReminder` in `src/lib/email.ts` | Create record-linked messages for stage changes and overdue owners; return unsuccessful status on skip/failure. |
| `runReminders` in `src/scripts/remind.ts` | Find overdue assigned active requests, send when eligible, and stamp successful reminder attempts. |
| `runAttachmentIndexing` in `src/scripts/indexAttachments.ts` | Claim and extract searchable attachment text asynchronously with bounded retries. |
| `ObjectStorageService` / pending-upload helpers in `src/lib/objectStorage.ts`, `src/lib/pendingUploads.ts` | Signed private upload/download operations and user-/ETO-bound registration token. |

In the function table, `src/` refers to `artifacts/api-server/src/` unless another root is shown.

### Calculation and configuration

```text
calculated cost       = estimated hours × hourly rate
calculated lead weeks = estimated hours ÷ hours per week ÷ capacity factor
```

Engineering uses estimated **design** hours; Production uses estimated **assembly** hours. Procurement cost and procurement lead time are separately entered, not computed by the assembly formula. The configured formula parameters used for a completed output are stored with that output. Admin changes to formula settings are recorded with actor and previous/new values; identical saves are skipped. Both Design and Assembly tabs expose history; design history is cursor-paginated. The API also allows appropriately authorized output editing through the output routes, with server-side numeric checks and restrictions on changing already-recorded hour fields; stage-completion decisions upsert their outputs atomically with the transition. Historical output fields remain readable.

## 7. HTTP API map

All paths in this table have the `/api` prefix. Unless noted, workflow/data routes require an authenticated application session. IDs are checked and mutation bodies are validated server-side.

| Area | Methods and paths | Behavior |
|---|---|---|
| Health | `GET /healthz`, `GET /healthz/azure-crm` | API readiness and optional read-only CRM connection check. |
| Authentication | `GET /login`, `GET /auth/callback`, `GET /auth/user`, `GET /logout`; `POST /mobile-auth/logout` | OIDC login/callback, current session user, logout. |
| Users/defaults | `GET /users/me`, `GET /users`, `POST /users`, `PATCH /users/:id/role`, `DELETE /users/:id`; `GET/PUT /users/review-defaults`; `POST /users/sync`, `POST /users/bootstrap-admin` | Local role administration and reviewer defaults; synchronization/bootstrap have additional identity and safety checks. |
| Requests | `GET/POST /eto-requests`, `GET/PATCH /eto-requests/:id`, `POST /eto-requests/:id/split` | Search/list/create/detail/edit/split with role and state checks. |
| Decisions/audit | `GET/POST /eto-requests/:id/transitions` | Ordered transition history and authoritative stage action. |
| Comments | `GET/POST /eto-requests/:id/comments` | Request-linked notes with author/timestamp. |
| Attachments | `GET/POST /eto-requests/:id/attachments`, `GET /eto-requests/:id/attachments/:attachmentId/download`, `GET /eto-requests/:id/attachments/:attachmentId/preview-link`, `GET /eto-requests/:id/attachments/:attachmentId/preview`, `DELETE /eto-requests/:id/attachments/:attachmentId` | Metadata, signed download, signed/authenticated inline preview, deletion. |
| Outputs and detail audit | `GET/PUT /eto-requests/:id/engineering-output`, `/production-output`, `/art-final-output`; `GET /eto-requests/:id/detail-changes` | Specialist outputs and recorded detail edits. |
| Dashboard | `GET /dashboard/metrics`, `GET /dashboard/my-queue` | Aggregate counts/overdue indicators and requests assigned to the current user. |
| Upload/storage | `POST /storage/uploads/request-url`; `GET /storage/public-objects/*filePath` | Signed upload authorization for private objects; separate public-object serving. Private attachments are **not** exposed by the public route. |
| Admin settings | `GET/PUT /admin/design-formula`, `GET /admin/design-formula/history`; corresponding `/admin/assembly-formula` routes; `POST /admin/email/test` | Formula config/history and an API-only admin email send test. |

`/admin/email/test` exists as an API route; the current Admin page does not provide a delivery-test button. Request-level history is available at `GET /eto-requests/:id/email-history` and Audit Trail → Email.

## 8. Database model and audit

Schema definitions live in `lib/db/src/schema`. Drizzle routes/helpers access PostgreSQL directly; there is no separate repository service layer.

| Table(s) | Role in the flow |
|---|---|
| `users`, `sessions`, `review_assignment_defaults` | Entra-linked local user/role, DB-backed session, and one Engineering/Production default setting. |
| `eto_requests` | Authoritative current stage, ETO number, intake values, separate units/currencies, inclusion flags, assignee/sticky engineer, submitter, split-parent links, abandonment/reminder timing fields. |
| `stage_transitions` | Decision history: ETO, real actor, simulated role if any, previous/next stage, decision, reason, chosen review flags, timestamp. |
| `comments`, `attachments`, `detail_changes` | Notes, private-object metadata/indexed text status, and request field-edit history. |
| `engineering_outputs`, `production_outputs`, `art_final_outputs` | One output record per request for each review; cost/lead-time formula values are saved with calculated outputs. |
| `design_formula_settings`, `assembly_formula_settings`, `design_formula_changes`, `assembly_formula_changes` | Configured parameters and their change histories. |
| `data_imports` | Ledger for targeted import/repair operations; not a general historical ETO bulk import feature. |

The request row stores the **current** state; the transition table tells how it got there. Split parents and children remain separate requests linked by a self-reference. Older `closed` rows and historical Lost representations remain readable; dashboard stage counts fold legacy terminal representations into Lost without changing the stored audit history.

## 9. Attachment flow

1. Request upload authorization: the API checks MIME type and size (maximum 50 MB), generates a private object path and signed PUT URL, and records a short-lived pending token in server memory.
2. Browser uploads directly to private storage, then registers file metadata against the ETO. Registration consumes the token and verifies its user/ETO binding. Files are optional at intake.
3. Authenticated download verifies the attachment belongs to the ETO and returns a short-lived signed private GET URL. PDF and supported image previews instead use a short-lived signed same-origin preview link (or authenticated access) that streams with inline, no-sniff, private/no-store headers.
4. A background indexer runs at startup and every two minutes. It leases pending/failed attachment rows, extracts supported document text, and uses a separate Tesseract process for supported image OCR. It records searchable text or an error/status, with limited retry attempts. This is **not** AI similarity search; scanned PDFs are not generally OCR'd by the current extractor.
5. Uploader or admin-like user may delete an attachment. The API removes the storage object before deleting the metadata row; a storage failure aborts DB deletion. If registration fails after upload, an orphaned object can remain, and abandoned uploads are not automatically cleaned up.

## 10. Background jobs, email, and dashboard

| Trigger | Processing |
|---|---|
| Successful stage transition | After the HTTP response, `sendTransitionEmails` attempts Microsoft Graph delivery for enabled notification types. Missing configuration, recipients, or provider failure does not roll back the transition. |
| API server startup and 08:00 UTC daily | `runReminders` finds assigned, nonterminal requests inactive for 5 days in Engineering or 3 days elsewhere; it attempts a Microsoft Graph email to the current owner and updates `lastRemindedAt` only after Graph accepts it. Unassigned requests have no owner reminder. |
| API server startup and every two minutes | `runAttachmentIndexing` attempts a bounded batch of text extraction/OCR without delaying upload or workflow requests. |
| Dashboard load | Stage/open/won/lost/declined counts, declines by ART stage, overdue count, and the signed-in user's assignment queue are queried from current requests and transition history. Engineering overdue threshold is 5 days; other active stages use 3. |

Average time per stage is currently returned as an empty metric. The legacy “more info” count does **not** count current backward returns. Neither is a reliable current-process KPI. New email events are persisted in `crm.eto_email_delivery_events`: one row per originating action, with the combined recipients and per-message outcomes. The record is inserted before sending; Graph acceptance, failure, partial acceptance, missing recipients and pending/unconfirmed outcomes are distinguished. History is not backfilled, disabled notifications create no records, and email bodies or credentials are not retained. Email requires Microsoft Entra app credentials, a configured Graph sender mailbox with `Mail.Send` permission, and the published app URL for request links; the optional CRM connection only checks read-only connectivity and has no two-way D365 flow.

## 11. Failure and consistency boundaries

- API role, schema, decision-field, and stage validations run even when UI controls are hidden or client-side validation passes. Typical responses: 401 unauthenticated, 403 unauthorized/unprovisioned, 404 missing request, 422 invalid business input/state/reviewer, 409 stale transition or concurrent split.
- A stage update, associated review output upsert, and its transition audit entry commit in one PostgreSQL transaction. The expected-stage and `hasSplitChildren = false` conditions prevent stale actions and post-split parent actions from silently succeeding.
- Split creation also uses a DB transaction and attempts cleanup of copied storage objects on failure. Email and OCR are outside the workflow transaction; failures there do not reverse the business decision.
- Audit entries record decisions, but the current app does not derive accurate average stage duration from them. Do not equate the presence of audit timestamps with a finished time-in-stage report.
- This implementation does **not** perform automated D365 writes, won-order webhooks, quote-document generation, part-number creation, AI similarity matching, or general historical ETO import.

## 12. Where to change behavior

| Change | Authoritative place to inspect first |
|---|---|
| Add/change stage, decision, routing, or role guard | `artifacts/api-server/src/lib/workflow.ts`, `src/routes/transitions.ts`, and the stage/decision schema in `lib/db`/`lib/api-zod`; then update detail controls and workflow diagram. |
| Change reviewer assignment | `src/routes/transitions.ts`, `src/routes/users.ts`, `lib/db/src/schema/review_assignment_defaults.ts`, and Admin/default-reviewer UI. |
| Change specialist output or formula | `src/routes/outputs.ts`, `src/routes/transitions.ts`, `src/lib/design-formula.ts`, `src/lib/assembly-formula.ts`, `src/routes/admin.ts`, and relevant DB/output schemas. |
| Change request fields, list/search, or splitting | `src/routes/eto-requests.ts`, `src/lib/splitFamily.ts`, `lib/db/src/schema/eto_requests.ts`, and the New/Detail/List pages. |
| Change authentication or roles | `src/routes/auth.ts`, `src/lib/auth.ts`, `src/middlewares/authMiddleware.ts`, `src/middlewares/requireAuth.ts`, `src/lib/roles.ts`, and the web auth/layout components. |
| Change files/notifications/jobs | `src/routes/storage.ts`, `src/routes/attachments.ts`, `src/lib/objectStorage.ts`, `src/scripts/indexAttachments.ts`, `src/lib/email.ts`, `src/scripts/remind.ts`, and `src/index.ts`. |

For rows beginning `src/`, the root is `artifacts/api-server/src/`. Changes to an API contract may require regenerating the client in `lib/api-client-react`; the workflow state machine and server checks remain the source of truth.