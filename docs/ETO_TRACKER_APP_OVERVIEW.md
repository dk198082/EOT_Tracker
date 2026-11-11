# ETO Tracker — Application Overview

**Prepared:** September 2, 2026  
**Product:** ETO Tracker  
**Purpose:** Internal workflow management for Engineer-To-Order requests

## 1. Executive summary

ETO Tracker replaces an email-and-spreadsheet process for managing custom,
non-standard product and test requests. It provides one authenticated system of
record for request details, quote context, attachments, comments, review
outputs, workflow decisions, ownership, and audit history.

The application moves an ETO request through a controlled review process:

```text
Draft → ART Review → Engineering Review → Production Review
      → ART Final Review → Quoted → Won / Lost
```

Users see work appropriate to their role, receive email notifications when
requests move, and can use the dashboard and search to find work that needs
attention. The server is authoritative for workflow and authorization rules.

## 2. Business functionality

### 2.1 Core business problem

The previous process scattered request information across email, spreadsheets,
shared drives, and manually maintained status lists. That made it difficult to:

- know the current owner or stage of a request;
- give Sales real-time status visibility;
- ensure Engineering and Production receive complete inputs;
- preserve decision history and communications;
- find similar or previously handled requests;
- remind owners about inactive work; and
- measure workload, decline activity, and workflow health.

ETO Tracker centralizes the request record and keeps email as a notification
channel rather than the system of record.

### 2.2 Users and roles

| Role | Primary responsibilities | Typical permissions |
|---|---|---|
| **Sales** | Create requests, provide intake information, respond to requests for information, close quoted work as Won or Lost | Create and edit requests; submit requests; respond to Sales-owned workflow actions; mark Won/Lost when allowed |
| **ART** (Application Review Team) | Review and route requests, request more information, make final commercial decisions, communicate declines | Review and route requests; provide ART Final output; mark Won/Lost; manage lifecycle actions; split requests |
| **Engineering** | Provide technical cost, documentation lead time, and part-number guidance | Work Engineering Review items; provide Engineering output; return work to ART |
| **Production** | Provide manufacturing and production lead-time input | Work Production Review items; provide Production output; return work to Engineering |
| **Admin** | Operational administration | Administrative user management and role-related operations |
| **SuperUser** | Exceptional operational access | Bypasses normal role guards where supported; can perform ART-level administration and split operations |

All application routes that expose business data require an authenticated
session. A user must also exist in the local `users` table before using the
business API.

For pilot testing, a SuperUser can temporarily simulate Sales, ART,
Engineering, or Production from the application sidebar. The selected role
becomes the effective role for both visible controls and server-side
authorization. The authenticated identity and stored account role do not
change.
Audit history keeps the real actor and labels transition, comment, and
detail-edit records with the simulated role. Exiting simulation restores normal
SuperUser access; the selection otherwise survives page refreshes for the
current browser tab.

### 2.3 Implemented workflow

The current implementation uses a linear workflow with Engineering and
Production stages required:

1. **Draft** — Sales or ART prepares an ETO request.
2. **ART Review** — ART validates the request and routes it to Engineering.
3. **Engineering Review** — Engineering records cost, documentation lead time,
   and part-number guidance.
4. **Production Review** — Production records manufacturing and production
   lead times.
5. **ART Final Review** — ART records the market price and market lead time.
6. **Quoted** — The request is ready for Sales/customer close-out.
7. **Won** or **Lost** — Sales or ART records the commercial outcome.

Additional lifecycle behavior:

- ART can decline at ART Review or ART Final Review, with a reason.
- Requests can be abandoned and, under the supported lifecycle rules, reopened
  to their prior active stage.
- A request can be returned to the adjacent prior stage.
- More-information decisions preserve history and route the request according
  to the implemented workflow rules.
- Engineering assignment is sticky: a return loop does not silently replace
  the assigned engineer.
- A split parent remains in ART Review but becomes workflow-read-only. Work
  continues on its linked child ETOs.

> **Planning-document reconciliation:** Earlier business planning documents
> describe Engineering and Production as optional paths and reference Clerk and
> future D365 behavior. The current running implementation is the authority for
> this overview: Engineering and Production are on the implemented linear path,
> authentication is Replit Auth, and D365 is not integrated.

### 2.4 Split Request

During ART Review, ART or SuperUser can split an unsplit request into **2 to 10
child ETOs**:

- the original request remains unchanged in ART Review from a business-stage
  perspective;
- child numbers use a zero-padded suffix, for example
  `ETO-2026-0042-01`, `ETO-2026-0042-02`, and `ETO-2026-0042-03`;
- children start in ART Review;
- request details, quote number/revision, and submitter are inherited;
- attachments are copied into independent storage objects;
- the parent and children receive a `split-request` stage audit event;
- children receive the split event, not the parent’s prior audit history;
- the parent and child pages provide linked navigation;
- nested child splitting and merging are not supported;
- the split is serialized and atomic, with a database marker preventing a
  concurrent stage transition from advancing the parent.

### 2.5 Request intake and record management

The New Request form captures customer, quote, test/request context, material,
specimen, standards, component, budget, and lead-time information. Users can
edit request details according to role, and detail changes are recorded with
the changed fields and actor.

Each request detail page brings together:

- the complete request record;
- current stage and progress visualization;
- current owner and sticky engineer;
- role-appropriate workflow actions;
- linked split-family requests;
- comments;
- attachments and downloads;
- Engineering, Production, or ART Final outputs;
- stage-transition history; and
- detail-change history.

### 2.6 Search, queue, and dashboard

The ETO list supports:

- free-text search across request fields;
- customer, quote, stage, assignee, output, comment, attachment, transition,
  and detail-change content;
- stage filtering;
- assignee filtering;
- overdue filtering;
- pagination, with a maximum page size of 100;
- split-family filtering and split-only filtering; and
- family-aware result expansion so related parent/child ETOs remain visible
  together when a split family is selected.

The dashboard provides:

- counts by current stage;
- total open, Won, Declined, and Lost counts;
- decline counts by stage;
- more-information loop count;
- overdue count; and
- an assigned-to-me queue.

Average time per stage is not currently populated because stage-entry timestamps
are not stored separately from the transition audit.

### 2.7 Attachments and document text indexing

Attachments are uploaded through an authenticated, ETO-scoped flow:

- maximum upload size is 50 MB;
- supported upload categories include PDF, images, Office documents, text,
  ZIP, and generic binary content;
- private files are accessed through authenticated download endpoints and
  short-lived signed URLs;
- attachment metadata is linked to the ETO and uploader;
- an indexing process extracts searchable text where supported; and
- indexing status, attempts, leases, completion time, and errors are retained.

The indexer supports text/CSV/SVG, image OCR through Tesseract, and
PDF/DOCX/XLSX/PPTX extraction through `officeparser`. ZIP and legacy
`.doc`/`.xls`/`.ppt` content is accepted by the upload allowlist but is not
currently indexed.

### 2.8 Comments, outputs, and audit history

Comments are stored on the ETO record with author and timestamp. Review outputs
are stored separately so each functional team can update its own structured
review data:

- Engineering: cost estimate, cost currency, documentation lead time,
  part-number guidance, notes.
- Production: manufacturing lead time, production lead time, notes.
- ART Final: market price, market-price currency, market lead time, notes.

Stage transitions are append-only audit records. Detail edits create separate
detail-change records containing the section and field-level old/new values.

### 2.9 Notifications and reminders

Microsoft Graph is used for outbound notifications when configured:

- new submission notification to the ART team;
- stage-change notification to the submitter and new owner;
- Won notification to the submitter and previous owner; and
- inactivity reminders to the current owner.

The reminder sweep runs once at startup and daily at 08:00 UTC through
`node-cron`:

- 3-day inactivity threshold for non-Engineering stages;
- 5-day inactivity threshold for Engineering Review;
- a reminder is not stamped as sent unless Graph accepts it; and
- skipped or failed sends can be retried on a later sweep.

Email is intentionally fire-and-forget: an email outage does not block a
workflow action. Audit Trail → Email shows new send attempts as one event per
workflow action, with all recipients grouped together and per-message Graph
acceptance/failure outcomes. Pending entries have no confirmed outcome;
Graph acceptance does not establish inbox delivery. History is not backfilled.

## 3. Integrations and external services

### 3.1 Services used by the application

| Service / component | Purpose | Data exchanged or stored | Current status |
|---|---|---|---|
| **Replit Auth / OIDC** | Login, logout, session refresh, and authenticated identity | OIDC identity and tokens are stored in server-side sessions; local role-bearing user record is keyed to the authenticated identity | Implemented |
| **PostgreSQL** | System-of-record database | Users, sessions, ETOs, outputs, comments, attachments metadata, audit history, and detail changes | Implemented |
| **Replit Object Storage** | Private attachment storage | Uploaded files and independent copies created during split | Implemented |
| **Microsoft Graph** | Transactional email notifications and inactivity reminders | Recipient, subject, and rendered notification body | Optional; disabled when Entra app credentials or `GRAPH_SENDER_EMAIL` are absent |
| **Tesseract** | OCR for supported image attachments | Extracted text used for search indexing | Local server-side processing |
| **officeparser** | Text extraction from supported Office/PDF formats | Extracted text used for search indexing | Local server-side processing |
| **node-cron** | Schedules the inactivity reminder sweep | No external data; triggers reminder logic | Implemented |

The workspace integration inventory currently reports no separately attached
Replit connector connections. The platform services above are used by the
application/runtime and should not be confused with user-connected SaaS
connectors.

### 3.2 Explicitly not integrated

- **Microsoft Dynamics 365 (D365):** no two-way integration, webhook, or
  automatic field synchronization exists in the MVP. Users can use the ETO
  number for manual entry.
- **SharePoint:** no engineering-package push exists.
- **Inbound email:** email is notification-only; inbound replies are not
  ingested.
- **AI similarity search or AI summaries:** not implemented.
- **Quote document generation:** no automatic PDF/Word quote package is
  generated.

### 3.3 Configuration

| Configuration | Use |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `REPL_ID` | Replit Auth OIDC client identity |
| `AZURE_TENANT_ID` (or `TENANT_ID` / `ENTRA_TENANT_ID`) | Microsoft Entra tenant for app-only Graph authentication |
| `CLIENT_ID` | Microsoft Entra application client ID |
| `CLIENT_SECRET` | Microsoft Entra application client secret |
| `GRAPH_SENDER_EMAIL` | Mailbox used for Microsoft Graph `sendMail` |
| `APP_BASE_URL` | Optional base URL for email deep links |
| `REPLIT_DEV_DOMAIN` | Fallback deep-link host in development |
| Object-storage environment values | Private/public storage paths and bucket access |

Secrets and credentials are supplied through the workspace environment and are
not part of this document.

## 4. Key data model

The database uses PostgreSQL with Drizzle ORM. Foreign keys and unique
constraints enforce core relationships. Monetary values are stored as text
values with a separate ISO-style currency field where applicable; USD is the
backward-compatible default.

### 4.1 Entity relationship summary

```text
User ──< ETO Request
User ──< Comment ──> ETO Request
User ──< Attachment ──> ETO Request
User ──< Stage Transition ──> ETO Request
User ──< Detail Change ──> ETO Request

ETO Request ──< child ETO Requests
ETO Request ──1 Engineering Output
ETO Request ──1 Production Output
ETO Request ──1 ART Final Output
ETO Request ──< Attachments
ETO Request ──< Comments
ETO Request ──< Stage Transitions
ETO Request ──< Detail Changes
```

### 4.2 `users`

Represents an authenticated application user and their application role.

| Attribute | Description |
|---|---|
| `id` | Primary key |
| `authId` / physical `clerk_id` column | External/authenticated identity key; nullable for pre-provisioned users |
| `name` | Display name |
| `email` | Email address |
| `role` | `sales`, `art`, `engineering`, `production`, `admin`, or `superuser` |
| `createdAt`, `updatedAt` | Timestamps |

### 4.3 `sessions`

Server-side Replit Auth session storage.

| Attribute | Description |
|---|---|
| `sid` | Session identifier and primary key |
| `sess` | JSON session payload, including authenticated user/session tokens |
| `expire` | Session expiration timestamp |

### 4.4 `eto_requests`

The central business entity.

| Attribute group | Attributes |
|---|---|
| Identity | `id`, unique `etoNumber` |
| Customer and quote | `customerName`, `quoteNumber`, `quoteRevision` |
| Request context | `testType`, `distributor`, `requestType`, `machineType`, `expectedForceRange`, `expectedDisplacement`, `resultsRequired` |
| Commercial context | `budgetRange`, `budgetCurrency`, `acceptableLeadTime`, `similarParts` |
| Technical/request detail | `materials`, `specimenDimensions`, `relevantStandards`, `customerComponents`, `customDetails` |
| Workflow | `stage`, `assigneeId`, `stickyEngineerUserId`, `declineReason`, `lastRemindedAt` |
| Split relationship | `parentEtoRequestId`, `splitSequence`, `hasSplitChildren` |
| Ownership | `submittedById` |
| Timestamps | `createdAt`, `updatedAt` |

Important constraints and behaviors:

- `etoNumber` is globally unique.
- `(parentEtoRequestId, splitSequence)` is unique for split children.
- `parentEtoRequestId` is a self-reference to `eto_requests`.
- child deletion is restricted by the parent relationship; attachments,
  comments, outputs, transitions, and detail changes cascade when their ETO is
  deleted.
- `hasSplitChildren` is the atomic workflow-protection marker for split parents.

### 4.5 `stage_transitions`

Append-only workflow audit log.

| Attribute | Description |
|---|---|
| `id` | Primary key |
| `etoRequestId` | Related ETO |
| `actorId` | User who made the decision |
| `fromStage`, `toStage` | Stage movement |
| `decision` | Decision code, such as `approve-engineering`, `mark-won`, or `split-request` |
| `reason` | Optional/required explanation depending on decision |
| `createdAt` | Decision timestamp |

### 4.6 `comments`

| Attribute | Description |
|---|---|
| `id` | Primary key |
| `etoRequestId` | Related ETO |
| `authorId` | Comment author |
| `body` | Comment text |
| `createdAt` | Timestamp |

### 4.7 `attachments`

| Attribute | Description |
|---|---|
| `id` | Primary key |
| `etoRequestId` | Related ETO |
| `uploaderId` | Uploading user |
| `filename` | Original file name |
| `storageKey` | Private object-storage reference |
| `contentType`, `fileSize` | File metadata |
| `searchText` | Extracted/OCR text when available |
| `searchStatus` | Indexing state, normally pending/complete/failed |
| `searchError` | Last indexing error |
| `searchAttempts` | Indexing attempt count |
| `searchLeaseToken` | Worker lease value |
| `searchProcessedAt` | Last successful/terminal processing timestamp |
| `createdAt` | Upload timestamp |

### 4.8 Review output entities

Each output is one-per-ETO and may be updated by its responsible team.

**`engineering_outputs`**

`id`, `etoRequestId`, `costEstimate`, `costEstimateCurrency`, `docLeadtime`,
`pnGuidance`, `notes`, `createdAt`, `updatedAt`.

**`production_outputs`**

`id`, `etoRequestId`, `mfgLeadtime`, `prodLeadtime`, `notes`, `createdAt`,
`updatedAt`.

**`art_final_outputs`**

`id`, `etoRequestId`, `marketPrice`, `marketPriceCurrency`, `marketLeadtime`,
`notes`, `createdAt`, `updatedAt`.

### 4.9 `detail_changes`

Field-level change history for request and review sections.

| Attribute | Description |
|---|---|
| `id` | Primary key |
| `etoRequestId` | Related ETO |
| `section` | `request`, `engineering`, `production`, or `art-final` |
| `changedById` | User making the change |
| `changedAt` | Change timestamp |
| `changes` | JSON array of `{ field, oldValue, newValue }` entries |

## 5. API surface

The Express API is mounted under `/api`. Business routes are authenticated
unless explicitly noted.

| Area | Endpoints / capabilities |
|---|---|
| Health and auth | `GET /healthz`, login/callback/logout, current auth user |
| Users | Current-user lookup, user sync, bootstrap admin, user list/create/delete, role update |
| ETO requests | List/search/filter, create, detail read, detail patch, split |
| Workflow | Transition history and decision submission |
| Comments | List and create comments |
| Attachments | List, create metadata, download, delete |
| Storage | Create authenticated upload URL and resolve authenticated download |
| Review outputs | Read/write Engineering and Production outputs; read/write ART Final output |
| Detail history | Read field-level detail changes |
| Dashboard | Metrics and assigned-to-me queue |
| Admin | Admin email test endpoint and administrative controls |

The OpenAPI contract is maintained in `lib/api-spec/openapi.yaml`. React Query
hooks and Zod types are generated from that contract with Orval.

## 6. Security and data protection

- Protected business routes require an authenticated server-side session.
- Application roles are evaluated on the server, not only hidden in the UI.
- All user inputs are validated before persistence.
- Attachments are private and downloaded through authenticated endpoints with
  short-lived signed URLs.
- Credentialed CORS uses an explicit origin allowlist.
- Stage history is append-only from the application workflow.
- Split operations are authorized for ART/SuperUser only and are atomic.
- Parent/child workflow protection is enforced at the database update boundary,
  including the split-versus-transition race.
- Storage/object cleanup is best-effort in some delete/failure paths; the
  related cleanup hardening work is tracked separately.

## 7. Technical architecture and repository map

| Layer | Location | Responsibility |
|---|---|---|
| Web app | `artifacts/eto-tracker` | React/Vite single-page application, routing, forms, React Query data access, role-aware UI |
| API | `artifacts/api-server` | Express routes, auth middleware, workflow enforcement, notifications, background jobs |
| Database schema | `lib/db/src/schema` | Drizzle PostgreSQL schema and entity types |
| API contract | `lib/api-spec/openapi.yaml` | OpenAPI source of truth |
| Generated API client | `lib/api-client-react` | React Query client/hooks generated from OpenAPI |
| Generated validation/types | `lib/api-zod` | Zod schemas and generated API types |
| Object storage web helper | `lib/object-storage-web` | Frontend upload/storage integration |
| Business documentation | `docs` | Process brief, MVP contract, and this overview |

Core runtime technologies include React, Vite, TypeScript, Express 5,
PostgreSQL, Drizzle ORM, Zod, Orval, React Query, Replit Auth OIDC,
Object Storage, Microsoft Graph, `node-cron`, Tesseract, and `officeparser`.

## 8. Operational behavior

- API development workflow: `pnpm --filter @workspace/api-server run dev`
- Full typecheck: `pnpm run typecheck`
- API tests: `pnpm --filter @workspace/api-server run test`
- API build: `pnpm --filter @workspace/api-server run build`
- Web build: `pnpm --filter @workspace/eto-tracker run build`
- OpenAPI code generation:
  `pnpm --filter @workspace/api-spec run codegen`
- Development database schema push:
  `pnpm --filter @workspace/db run push`
- The API listens on the configured `PORT`.
- The reminder sweep runs at startup and daily at 08:00 UTC.
- Missing Graph configuration is logged and disables email without preventing
  the API from starting.

## 9. Current limitations and deferred capabilities

The following are not part of the current MVP or are intentionally incomplete:

- D365 two-way integration and won-order synchronization;
- SharePoint package publishing;
- AI similarity search and communication summaries;
- historical ETO import;
- automatic quote PDF/Word generation;
- mobile-native application;
- inbox-delivery confirmation for outbound email (send-attempt history is available);
- average time-in-stage metrics;
- self-service role administration for normal users;
- configurable workflow paths beyond the implemented linear stages;
- inline explanation of which fields caused a search match;
- administrative retry controls for failed attachment indexing.

## 10. Source-of-truth files

- Business/process intent: `docs/ETO_Business_Process_Brief.md`
- MVP scope and contract: `docs/ETO_MVP_Contract.md`
- Current request schema: `lib/db/src/schema/eto_requests.ts`
- Current workflow rules: `artifacts/api-server/src/lib/workflow.ts`
- Request and split routes: `artifacts/api-server/src/routes/eto-requests.ts`
- Transition enforcement: `artifacts/api-server/src/routes/transitions.ts`
- Notification behavior: `artifacts/api-server/src/lib/email.ts`
- Reminder behavior: `artifacts/api-server/src/scripts/remind.ts`
- OpenAPI contract: `lib/api-spec/openapi.yaml`