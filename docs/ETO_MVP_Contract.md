# ETO Tracker — MVP Contract

**Refreshed:** November 2026
**Document meaning:** Current delivered baseline and verification criteria.
This refresh records the implemented scope; it does not create new commercial
commitments or assert that all deployments have passed a fresh acceptance run.

## 1. Product boundary

An internal, authenticated application for capturing and progressing ETO
requests through scoped functional reviews to a commercial quote/outcome.
The request, review outputs and audit trail are the shared record. Email is
best-effort notification after committed actions.

## 2. Delivered scope and acceptance expectations

| Area | Baseline / expected behavior |
|---|---|
| Authentication | Microsoft Entra authorization-code sign-in with PKCE/state/nonce; server-side persistent sessions |
| Application admission | Admin Console check for app ETO using Entra object ID; explicit deny or unavailable service prevents session issuance |
| New users | Console-approved new app users get role None; own-profile access only until an ETO role is assigned |
| Roles | Sales, ART, Engineering, Production, Admin, SuperUser, None; server remains authoritative |
| Role simulation | Only an authenticated SuperUser may simulate operational roles; real actor/identity retained |
| Database | Azure PostgreSQL d365crm, crm schema, all 20 app mappings named eto_*; shared dataset |
| Draft numbering | No new ETO number until first submission; previously assigned numbers retained |
| Intake | Structured customer/quote/test/system/material/specimen/units/budget/lead-time data; System Type Other |
| Details editing | Existing Request Details restricted to ART/SuperUser; submitter ownership is not an exception |
| ART scope | Entity TOUS/TOUK first; Engineering/Production independently included or skipped |
| Assignment defaults | Four Entity/department choices under Admin → Assignment Defaults |
| Assignment preservation | Request-specific choices and retained reviewers survive applicable returns; Admin defaults do not overwrite them |
| Reassignment | Engineering/Production same-stage departmental Re-Assign; saved outputs and deadlines preserved |
| Scheduling | Initial ART acceptance baseline; included specialist durations plus ART Final; cumulative review deadlines |
| Engineering output | Positive design hours, derived cost/weeks, currency, P/N guidance, required risk; High requires notes |
| Production output | Procurement cost/weeks, assembly hours and derived cost/weeks, currencies, required risk; High requires notes |
| Formula management | Admin design/assembly settings, persisted output assumptions, and formula-change history |
| Calculator | Whole-number money; per-request contingency/margin; additive margin; explicit mixed-currency label without conversion |
| Lead-time calculator | Sum saved Design + Procurement + Assembly weeks; no silent zero for missing inputs |
| Quote defaults | Market Price starts from calculated Sales Price; Market Lead Time starts at ceiling of combined weeks |
| Quote output | ART can override quote values independently; required nonblank Description distinct from Notes |
| List and dashboard | Search, stage/Assignee/overdue/family filters, pagination, workload/outcome counts and personal queue |
| Attachments | Authorized upload/download/delete/preview; private object storage and searchable extraction where supported |
| Audit | Stage, field-level Details, and grouped Email history |
| Splitting | ART/SuperUser, 2–10 children during eligible ART Review, read-only parent, independent file objects |

## 3. Workflow acceptance matrix

| From | Forward | Return / other supported controls |
|---|---|---|
| Draft | Submit → ART Review | ART/SuperUser may abandon |
| ART Review | Accept → Engineering if included, else Production if included, else ART Final | Return to Draft; Decline; eligible split; abandon |
| Engineering Review | Complete → Production if included, else ART Final | Back to ART; same-stage Re-Assign; abandon by ART/SuperUser |
| Production Review | Complete → ART Final | Back to Engineering if included, else ART; same-stage Re-Assign; abandon by ART/SuperUser |
| ART Final Review | Generate Quote → Quoted | Back to last applicable review/ART; supported specific Engineering return; Decline; abandon |
| Quoted | Won or Lost | Return to ART Final; abandon by ART/SuperUser |
| Abandoned | Reopen → recorded prior stage | No invented reset to Draft |
| Won / Lost / Declined | None | Terminal under current state machine |

Returns, Decline, Lost and Abandon require reasons. Production has no Decline
decision. Review completion requires the applicable output fields. Skipped
reviews remain visibly skipped; previously saved output/audit is not erased.

## 4. Notification acceptance

Ten independent settings exist:

1. Submission to ART.
2. ART completion update to the Submitted by user, including expected due date.
3. ART confirmation assignment.
4. Engineering confirmation assignment.
5. Production confirmation assignment.
6. Engineering reassignment.
7. Production reassignment.
8. Quote generation to Submitted by, with Price, Lead Time, Description, Notes,
   and subject referencing ETO and Quote.
9. Inactivity reminders.
10. Other supported workflow updates.

New settings start off; existing administrator choices persist. Admin can set
all to yes/no atomically. Disabled notifications do not alter workflow.
Submission notifications target ART users, not a duplicate submission event.
Assignment messages target the next reviewer or shared ART queue as applicable.
Reassignment sends only for a committed change to a different reviewer.

Microsoft Graph is the sender, using app-only authorization and the configured
mailbox, normally no-reply@tiniusolsen.com. Application Mail.Send/admin consent
or an explicitly configured Exchange application authorization is required.
Delegated permission alone is insufficient.

Email history groups recipients and messages by originating event. Accepted,
partial, failed, pending/unconfirmed and skipped outcomes must not be presented
as verified inbox delivery. A combined ART-completion/assignment action stays
one event even when two notification categories produce messages.

An explicit 401/403 rejection may refresh the token and retry once. Accepted
sends or ambiguous network failures are not blindly replayed. No end-user
retry UI or durable outbox is promised by this baseline.

## 5. Data integrity and safety boundaries

- Preserve existing user IDs/ETO relationships while linking Entra identity.
- Preserve currency and units separately from entered values.
- Preserve legacy review values; do not reinterpret old weeks as new hours.
- Preserve historical missing risk/deadline data rather than fabricate values.
- Keep audit actor real during role simulation.
- Use one shared CRM dataset, not a second permanent production table set.
- Rejected actions must not produce assignment/completion notifications.
- An Admin Console error never becomes implicit authorization.
- Do not expose integration secrets, session credentials or private storage
  credentials to browser code or documentation.
- Historical archive/cutover identity safeguards remain separate from ordinary
  workflow. Do not re-map an old open form silently into a different request.

## 6. Explicitly outside current delivery

Automatic D365 quote/order synchronization or ERP posting; AI similarity
matching and communication summaries; nested splits and merge-back; reliable
average stage-duration reporting; guaranteed mailbox/inbox delivery; durable
email replay orchestration; automated mapping from Console roles to ETO roles.

No general-purpose request-delete screen or Admin email-test button is
included merely because server-side administrative capabilities exist.

## 7. Verification and release expectations

For a release, verify the affected flow and role paths, additive schema
requirements, environment configuration, request links and storage access.
Database table privileges must cover required CRUD operations in crm.
Development and published environments must be checked independently.

A local restart is not a production publish. A token/API-key diagnostic is
not a complete real-user sign-in test. Graph acceptance is not inbox receipt.
Testing historical logs does not authorize new live email sends.

This document supersedes earlier MVP descriptions of Clerk/Replit Auth,
mandatory Engineering+Production, Resend, and unprefixed local application
tables. It is aligned with the companion November 2026 references.
