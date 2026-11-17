# ETO Tracker — Technical Details and End-to-End Flow

**Refreshed:** November 2026
**Scope:** As-built source/configuration reference. No credentials or user
records are included. Runtime verification of a published deployment remains
a separate activity.

## 1. Runtime architecture

- React/Vite/TypeScript frontend in artifacts/eto-tracker.
- Express/TypeScript API in artifacts/api-server, mounted under /api.
- Shared Drizzle schema/connection package in lib/db.
- OpenAPI contract in lib/api-spec; generated client/types in shared packages.
- Private App Storage for file objects; PostgreSQL for metadata/extracted text.
- Microsoft Entra authentication; external Admin Console admission check.
- Microsoft Graph app-only outbound email.

Services bind their configured PORT and run via artifact-managed workflows.
Frontend requests use the app's same-origin routing rather than hardcoded
localhost. Public deployment configuration and secrets must be checked
independently from a development workflow restart.

## 2. Identity, admission, provisioning and session

GET /api/login starts Entra authorization-code authentication with PKCE,
state and nonce. GET /api/auth/callback validates the response and obtains the
Entra object ID. Tenant resolution uses ENTRA_TENANT_ID, then TENANT_ID, then
AZURE_TENANT_ID; CLIENT_ID and CLIENT_SECRET identify the configured application.

Before local-user provisioning or session issuance, checkAdminConsoleAccess
calls the configured Console base URL plus /api/access-check, with:

- Query parameters entraObjectId and app=ETO.
- Server-side X-API-Key from ADMIN_CONSOLE_API_KEY.
- HTTPS, JSON response, five-second timeout, no redirects and no response cache.

The expected body contains boolean allowed, nullable/string reason and a
string-array roles. Invalid/missing configuration, network failure, non-success
HTTP response or invalid body fails closed. Allowed=false denies login with
403. An unavailable check returns the generic 503 “Application access could
not be verified” message; it is not permission to create a session anyway.

Entra identity links to the existing role-bearing app user. Preserve existing
integer IDs, request relationships and roles. New approved users receive None.
Console role strings do not overwrite application roles. Admission is checked
at sign-in; do not claim immediate Console revocation of every existing session.

Opaque session IDs reference crm.eto_sessions; session TTL is seven days.
GET /api/auth/user exposes current authentication state; GET /api/users/me
permits a None-role user to inspect their own mapped profile. Other business
data routes deny None-role access. Logout deletes the server session/cookie.

SuperUser simulation is validated server-side; effective operational role is
distinct from real identity, stored role and audit actor.

## 3. Authoritative database namespace

The connection exported by lib/db uses Azure PostgreSQL **d365crm**. Drizzle
definitions use **crm** explicitly. All 20 mapped app tables have the **eto_**
prefix; eto_requests and eto_price_calculator are not double-prefixed.

Startup verifies database identity, writeability, expected tables/CRUD
privileges and required additive quote/entity columns. Use the current schema
and migrations as authority, not the historic 18-table reports.

| Table (crm.) | Main data / operation |
|---|---|
| eto_users | Profile, Entra link, ETO role; resolve/create at authorized login; Admin role maintenance |
| eto_sessions | Create/read/refresh/delete sessions and expiry |
| eto_requests | Intake CRUD supported by routes; numbering, stage, Entity, reviewer/schedule/family state |
| eto_stage_transitions | Insert/read stage decisions and reasons |
| eto_detail_changes | Insert/read detail and assignment changes |
| eto_comments | Insert/read discussion |
| eto_attachments | Register/read/delete metadata and object links; update indexing state/text |
| eto_engineering_outputs | Per-request design estimate, formula assumptions, risk, P/N guidance and preserved legacy fields |
| eto_production_outputs | Per-request procurement/assembly estimate, assumptions, risk and preserved legacy fields |
| eto_art_final_outputs | Per-request quote price/currency, lead time, description and notes |
| eto_review_assignment_defaults | Entity-specific specialist defaults |
| eto_price_calculator_settings | Global initial contingency/margin |
| eto_price_calculator | Saved per-request contingency/margin |
| eto_design_formula_settings | Current design assumptions |
| eto_design_formula_changes | Design configuration history |
| eto_assembly_formula_settings | Current assembly assumptions |
| eto_assembly_formula_changes | Assembly configuration history |
| eto_email_notification_settings | One persisted switch per notification type |
| eto_email_delivery_events | Event recipient union, nested message outcomes and timestamps |
| eto_data_imports | Import/reconciliation bookkeeping |

Relationships to users and requests are defined by the schema. Outputs are
unique per request. Child metadata such as transitions/comments/outputs/email
events uses the declared request foreign-key rules. Physical object deletion
is a separate storage operation, not automatic database-byte deletion.

Development and published configurations use one shared ETO dataset; avoid a
second permanent live table set. The shared-cutover safeguards preserve archive
and identity integrity. An old open form must not silently refresh into a
different remapped request identity.

## 4. Request creation, numbering and edits

POST /api/eto-requests creates a draft with structured intake and submitted-by
identity. Numbering occurs on first submit-to-ART; an already assigned number
is retained. New Request includes System Type Other and separate currency and
measurement-unit values.

GET list supports text, stage, Assignee, overdue and split-family criteria
with pagination. GET /:id returns a request. PATCH /:id updates authorized
Request Details and records field-level changes; ART/SuperUser is required for
existing details, not merely record ownership.

POST /:id/split serializes an eligible ART Review split into 2–10 children,
creates suffixed numbers, copies intake/quote context and independent storage
objects, and appends split events. Parent remains workflow-read-only; no nested
split/merge-back. Prior parent history is not copied as if performed on children.

There is no general user-facing request-delete action. Special administrative
cleanup scripts are not the standard request lifecycle.

## 5. Workflow transaction and specialist routing

POST /api/eto-requests/:id/transitions validates decision, effective role,
stage and required fields before committing outputs/ownership/stage/history.
The central state machine is lib/workflow.ts.

| Decision / stage | Result |
|---|---|
| submit / Draft | ART Review |
| approve-engineering / ART | Engineering if included; else Production if included; else ART Final |
| engineering-quote-ready / Engineering | Production if included; else ART Final |
| production-approve / Production | ART Final |
| art-final-quote / ART Final | Quoted |
| mark-won or mark-lost / Quoted | Won or Lost |
| return-draft / ART | Draft |
| engineering-return-art | ART Review |
| production-return-engineering | Engineering if included; otherwise ART Review |
| art-final-return-production | Last included specialist, otherwise ART Review |
| art-final-return-engineering | Specific return to Engineering |
| quoted-return-art-final | ART Final Review |
| decline / ART gates | Declined |
| mark-abandoned / supported active stages | Abandoned |
| reopen / Abandoned | Recorded prior stage |

Won/Lost/Declined are terminal; closed is a retained legacy terminal value.
Returns, decline, lost and abandon require reasons. The backward decisions are
not same-stage More Info loops even if legacy fields/counters retain that name.

Entity is TOUS/TOUK. Four defaults in Admin → Assignment Defaults resolve by
Entity/department. TOUK does not silently fall back to TOUS; null-Entity legacy
behavior does not populate an invented Entity. Explicit ART reviewer choices
and retained assignments take precedence on applicable later returns.

POST /api/eto-requests/:id/reassign validates current specialist stage,
authorized department and target user, updates assignment/detail audit without
a stage transition, preserves saved outputs/deadlines, then notifies only on an
actual committed change if enabled.

## 6. Review outputs, formulas, calculator and schedule

GET/PUT engineering-output, production-output and art-final-output operate
under /api/eto-requests/:id. Output permissions/validation are server-side.

Engineering captures positive estimatedDesignHours, required pnGuidance and
risk; Production captures whole-number procurement cost, nonnegative
procurement weeks and assembly hours, and risk. High risk requires explanatory
notes. Derived cost/week estimates retain the formula assumptions used at save.
Legacy costEstimate/docLeadtime and mfgLeadtime/prodLeadtime values are preserved,
not silently reinterpreted as the new outputs.

Design Cost = round(design hours × design hourly rate); Design Weeks =
design hours ÷ design hours-per-week ÷ design capacity factor. Assembly uses
the corresponding assembly hours/rate/hours-per-week/capacity factor. The
capacity-adjusted estimates are separate from procurement weeks. Settings and
saved snapshots, rather than an assumed fixed global rate, drive each output.

Admin design/assembly settings and histories are under /api/admin/design-formula
and /api/admin/assembly-formula. Histories describe configuration changes, not
a complete revision history of every specialist output.

Price settings: /api/admin/price-calculator. Per-request percentages:
/api/eto-requests/:id/price-calculator. Defaults initially 10% contingency and
55% margin initialize unsaved requests; saved per-request values are independent.

Money uses exact-decimal half-up whole-number rounding. With rounded source
costs D/P/A: B=D+P+A; C=round(B×contingency%); M=round((B+C)×margin%);
Sales Price=B+C+M. Margin is additive, not gross-margin division.
Mixed currencies are labelled Multi-Currency without conversion.

Lead time uses saved Design + Procurement + Assembly weeks. Generate Quote
starts Market Lead Time at ceil(total), not ceil(each component). Missing
estimates remain missing. ART may override Market Price/currency/lead time
independently of calculator settings. Quote Description is required, trimmed
and separate from Notes, including later quote-output writes.

The review schedule starts on the reviewer's ART-acceptance calendar day,
includes only selected specialist durations plus ART Final, rounds combined
partial days upward and exposes cumulative review deadlines. Returns preserve
the original baseline. Inactivity-overdue calculation is a separate mechanism.

## 7. Email delivery and event history

lib/notification-settings.ts defines ten opt-in settings: art_submission,
sales_art_complete, art_assignment, engineering_assignment, production_assignment,
engineering_reassignment, production_reassignment, quote_generated,
inactivity_reminder, other_workflow_updates.

Admin GET/PUT /api/admin/email-notifications and PUT
/api/admin/email-notifications/:notificationType read/update settings. Bulk
yes/no is one atomic persisted operation. Missing/new types are off; existing
choices are not reset by startup or deployment.

Recipient rules:

- ART submission → ART users.
- ART completion → original Submitted by, including expected due date.
- Review confirmations → next assigned reviewer; shared ART queue → ART users.
- Department reassignment → newly assigned reviewer after an actual change.
- Generate Quote → Submitted by with Price, Lead Time, Description and Notes;
  subject contains ETO and Quote numbers.
- Eligible reminders → current owner; remaining enabled workflow updates →
  submitter/relevant owner.

lib/email.ts obtains an Entra client-credentials token with Graph .default
scope and POSTs to /v1.0/users/{sender}/sendMail. GRAPH_SENDER_EMAIL normally
identifies no-reply@tiniusolsen.com. App-only Application Mail.Send/admin
consent or an explicitly configured Exchange application equivalent is
required; delegated scopes alone do not authorize this background sender.

Tokens are cached. An explicit 401/403 rejection invalidates authorization and
retries once with a fresh token; it is not a general retry loop. Token/send
requests have bounded timeouts. Sanitized provider error codes/correlation IDs
are logged without raw tokens or provider message bodies.

deliverLoggedEmails creates one crm.eto_email_delivery_events row per originating
event before sending. A union of recipients and per-message name, subject,
recipients/status is stored, not message bodies or credentials. Multiple enabled
messages for one action stay under that event. Aggregate states are pending,
accepted, partial, failed or skipped. Completion-write failure can leave the
outcome unconfirmed even if Graph accepted the message.

GET /api/eto-requests/:id/email-history powers Audit Trail → Email with Refresh
and polling. Acceptance is not delivery/read confirmation. Disabled events
are not sent; no historical backfill or automatic manual-retry UI exists.
Business transitions commit independently; email failure does not undo them.
There is no durable outbox guaranteeing delivery after a process interruption.
POST /api/admin/email/test exists for an authorized administrator's own address;
there is no corresponding dedicated UI button in the current implementation.

## 8. Attachments, comments and audit

Request-scoped comments support list/create. Attachments support metadata
list/register/delete plus download and preview-link issuance. Private file
objects use App Storage; upload URLs and object access require authorization.
The upload ceiling is 50 MB, with server allowlist and contextual count checks.

Safe preview types can stream through an authenticated/signed same-origin
inline endpoint so PDF viewers do not depend on blocked blob/external frames.
Preview access is validated before archive inspection.

Text extraction/OCR runs asynchronously with persisted indexing status,
attempts and leases. Tesseract is isolated in a child process; office parsers
remain external to the API bundle. Not every accepted file type is indexed.

Stage decisions are append-only audit records; detail edits have field-level
old/new values. Email is a distinct event audit, not proof inferred from stage
changes. Same-stage assignment changes do not fabricate stage transitions.

## 9. API groups and administration

Other principal routes: /api/dashboard/metrics, /api/dashboard/my-queue;
/api/users and /api/users/:id/role; /api/users/review-defaults;
/api/healthz and /api/healthz/azure-crm; authenticated storage upload routes.
Consult lib/api-spec for exact HTTP bodies and generated response contracts.

Admin UI tabs: Users, Assignment Defaults, Email Notifications, Design Formula,
Assembly Formula, Price Calculator. Admin/SuperUser checks are distinct from
ART's operational controls. No user-promote button or broad resource editor
should be assumed solely from a backend route's existence.

## 10. Configuration and recovery guide

Names only; actual credential values belong in secure configuration.

| Group | Configuration |
|---|---|
| Entra | CLIENT_ID, CLIENT_SECRET; tenant aliases described above |
| Admin Console | ADMIN_CONSOLE_URL, ADMIN_CONSOLE_API_KEY, ADMIN_CONSOLE_APP_NAME=ETO |
| Graph | Same configured Entra credentials; GRAPH_SENDER_EMAIL |
| Notification links | APP_BASE_URL set to the verified published origin |
| Azure PostgreSQL | AZURE_PG_HOST, AZURE_PG_PORT, AZURE_PG_DATABASE, AZURE_PG_SCHEMA, AZURE_PG_USER, AZURE_PG_PASSWORD and TLS settings |
| Storage | Platform-managed bucket/private-object configuration |

**Sign-in cannot verify access:** Check the Console access-check response.
401/“Invalid or revoked API key” means the integration credential is rejected,
not that a person's ETO role should be changed. Confirm the Console instance
and active key, update the app secret securely, restart the affected runtime
and recheck. A valid response denying a synthetic unknown identity proves the
gate is reachable and closed for that identity; it does not approve a real user.

**Graph 403:** Inspect fresh application permissions; delegated Mail.Send is
insufficient. Permission changes do not update an already-issued cached token.
Then check sender mailbox and Exchange application restrictions if denial
persists with fresh authorization. Do not move a request backward/forward
merely to resend mail; its accepted business transition may already be correct.

**Failed historical event:** Keep it as historical evidence. Fixing credentials
does not rewrite old outcomes or authorize replay. Send live diagnostics only
with authorization and distinguish acceptance from inbox receipt.

## 11. Limits and release cautions

No automated D365 order/quote synchronization, ERP posting, semantic similarity,
AI summary generation, nested split/merge-back, full stage-duration analytics,
durable email outbox or guaranteed inbox delivery is implemented.

This documentation refresh did not mutate business data, change access
permissions or send test email. Source inspection is not a new production
end-to-end acceptance run. Publish/restart behavior, schema additions, secret
scope and verified published links must be checked in the intended runtime.
