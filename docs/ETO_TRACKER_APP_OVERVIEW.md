# ETO Tracker — Application Overview

**Refreshed:** November 2026
**Status:** Current implementation reference, not a certification of every published environment.

## 1. Purpose

ETO Tracker is the shared record for Engineer-To-Order requests: customer
requirements, review decisions, specialist estimates, commercial outputs,
ownership, attachments, comments, and audit history. Email points people back
to the request; it is not the system of record.

This revision replaces earlier descriptions of mandatory specialist reviews,
Replit Auth/Clerk sign-in, Resend delivery, and a separate local ETO database.
Those descriptions are no longer the current implementation.

## 2. Authentication and access

Sign-in has three distinct layers:

1. **Microsoft Entra ID** authenticates the person using the configured tenant
   and application registration.
2. **Admin Console** authorizes access to the registered application **ETO**.
   The server checks the person's Entra object ID using a server-side API key.
   A denial blocks login. A service or credential failure also blocks login;
   the application does not bypass this gate.
3. **ETO application role** controls actions and access to business data.
   Existing ETO users retain their assigned roles. Newly provisioned,
   Console-approved users start with **None**, not Sales.

A user with Role None can authenticate and view their own profile/access
message, but cannot see ETO data until an ETO administrator assigns a role.
Admin Console role labels do not silently replace ETO roles. The app's
integration does not modify the external Console's users or permissions.

Sessions are stored in Azure PostgreSQL, not just in server memory.

## 3. Roles

| Role | Main responsibility |
|---|---|
| None | Await an ETO role assignment; no ETO business-data access |
| Sales | Create drafts, submit requests, supply requirements, and perform permitted quote close-out actions |
| ART | Accept and route work, choose Entity/reviews/reviewers, decline, split, generate quotes, and manage supported lifecycle actions |
| Engineering | Enter design estimates, part-number guidance and risk; complete, return, or reassign Engineering Review |
| Production | Enter procurement/assembly estimates and risk; complete, return, or reassign Production Review |
| Admin | Manage users, entity-specific defaults, formulas, calculator defaults, and notification controls |
| SuperUser | Exceptional operational permissions and operational-role simulation |

Role simulation changes effective permissions only. The authenticated
SuperUser, stored role, record ownership, and audit actor remain unchanged.
Simulation is not an ordinary user's ability to select their own role.

## 4. Workflow

Drafts receive an ETO number on first submission to ART, not on creation.
Previously numbered requests retain their number on returns or reopening.

```text
Draft → ART Review → [Engineering?] → [Production?] → ART Final Review
      → Quoted → Won or Lost
```

ART independently includes or skips Engineering and Production:

| Included reviews | Forward path after ART acceptance |
|---|---|
| Engineering + Production | Engineering → Production → ART Final |
| Engineering only | Engineering → ART Final |
| Production only | Production → ART Final |
| Neither | ART Final |

Engineering can return work to ART. Production returns to Engineering if it
was included, otherwise ART. ART Final normally returns to the last included
specialist, or ART if neither was included; the workflow also supports the
specific return-to-Engineering decision. Quoted work can return to ART Final.
Returns require a reason and preserve saved outputs and history.

ART may decline during ART Review or ART Final Review. Lost is a commercial
outcome after quoting, not another name for Declined. ART/SuperUser can abandon
supported active work and reopen an abandoned request to its recorded prior
stage. Won, Lost, and Declined are terminal in the current state machine.
`closed` remains a legacy terminal value, not a new workflow route.

## 5. Entity, assignments, and scheduling

- ART Review begins with an **Entity** selector: **TOUS** or **TOUK**.
- Admin → **Assignment Defaults** contains a separate Engineering/Production
  pair for each Entity. The original defaults belong to TOUS.
- TOUK does not silently borrow the TOUS pair. Legacy requests without Entity
  retain backward-compatible behavior without fabricating an Entity.
- ART can choose request-specific specialist reviewers. Explicit choices,
  sticky Engineering ownership, and retained Production assignments survive
  applicable return loops; changing an Admin default does not rewrite them.
- **Re-Assign** appears during Engineering and Production Review between
  Complete Review and Back. It selects another user in the same department
  without changing stage, deadlines, or saved review work.
- The schedule starts at initial ART acceptance. Included Engineering and
  Production durations plus ART Final duration determine the overall due date.
  Planned review deadlines are cumulative from that original acceptance.
  Returns do not restart the schedule.

Inactivity-based overdue indicators/reminders are separate from planned
calendar due dates. Historical requests without a saved schedule do not gain
invented deadlines.

## 6. Intake, details, and split families

New Request captures customer and quote references, request/system context,
test requirements, specimen/material information, budget with currency, and
acceptable lead time. System Type includes **Other**. Measurement units are
stored separately from force/displacement range text.

Only ART/SuperUser may edit existing Request Details; being the submitter does
not grant an exception. Review-output permissions are separate.

During ART Review, ART/SuperUser may split an eligible request into 2–10
children. Children start in ART Review with inherited intake/quote context
and independent attachment objects. Child numbers append `-01`, `-02`, etc.
The parent remains linked and workflow-read-only. Children receive their split
event, not a fabricated copy of all parent history. Nested splitting and
merging are not implemented.

## 7. Reviews and the Price Calculator

**Engineering** captures estimated design hours, calculated design cost/time,
currency, P/N guidance, notes, and required risk. **Production** captures
procurement cost/time and assembly hours, calculated assembly cost/time,
currencies, notes, and required risk. High risk requires an explanation.
Historical missing scores remain unscored, not Low.

Admin controls hourly-rate/capacity formula settings; outputs retain the
assumptions used to produce their saved estimates. Earlier legacy output
fields remain preserved rather than being reinterpreted as new hour inputs.

The calculator combines Design, Procurement, and Assembly costs, then adds:

```text
Base = Design + Procurement + Assembly
Contingency = round(Base × Contingency %)
Margin = round((Base + Contingency) × Margin %)
Sales Price = Base + Contingency + Margin
```

Money uses whole-number entry/display and half-up rounding. Margin is an
additive markup, not division by `(1 − margin)`. Admin defaults initially use
10% contingency and 55% margin; saved per-request percentages are independent
of later default changes.

Mixed-currency amounts are not converted. Their numeric total is explicitly
labelled **Multi-Currency**, requiring ART review.

Below price calculation:

```text
Calculated Lead Time = Design Time + Procurement Time + Assembly Time
```

Times are in weeks. Generate Quote prepopulates Market Lead Time by rounding
the final sum upward to a whole week; missing estimates are not silently zero.
Market Price also starts from the calculator. Both quote fields remain
independently editable without changing calculator assumptions.

ART Final Review requires **Description** for the quoted part, positioned
between lead time and parts guidance. It is separate from Notes and has no
“Describe the part being quoted” placeholder.

## 8. Main screens

- **Dashboard:** stage/outcome counts, decline breakdown, inactivity-overdue
  count, and assigned-to-me queue.
- **ETO Requests:** paginated search, stage, Assignee, overdue and split-family
  filters. Search includes related comments, indexed attachments and audit text.
- **Request detail:** requirements, progress, assignments, schedule, review
  outputs, calculator, actions, comments, attachments and audit.
- **Workflow:** an in-app route reference with downloadable SVG.
- **Admin:** Users, Assignment Defaults, Email Notifications, Design Formula,
  Assembly Formula, and Price Calculator.

Audit Trail contains **Stage**, **Details**, and **Email** tabs. Same-stage
reassignment is assignment maintenance, not a false stage transition.

## 9. Email notifications

Outbound mail uses **Microsoft Graph**, normally from
`no-reply@tiniusolsen.com`; it does not use Resend.

| Event | Recipient/content |
|---|---|
| Submission to ART | ART users; ETO number and link |
| ART Review completion | Original Submitted by user; expected due date and link |
| ART confirmation | Next reviewer, or ART users for its shared queue |
| Engineering confirmation | Next reviewer, or ART users for its shared queue |
| Production confirmation | Next reviewer, or ART users for its shared queue |
| Engineering reassignment | Newly selected engineer |
| Production reassignment | Newly selected Production reviewer |
| Generate Quote | Submitted by user; Price, Lead Time, Description, Notes; subject includes ETO and Quote numbers |
| Inactivity reminder | Current owner, subject to reminder eligibility |
| Other workflow updates | Submitter/relevant owner for supported remaining stage changes |

Each of these ten types has an independent Admin toggle. All start off when
introduced; existing choices persist. **Set all to yes/no** updates all types.
Changing an email switch does not change workflow routing.

Email history has one entry per originating event with all recipients grouped,
including events producing multiple messages. Outcomes include pending,
accepted, partial, failed, and skipped. **Accepted by Graph is not confirmed
inbox delivery.** Disabled events are not fabricated as sent, and historical
messages cannot be backfilled reliably from stage transitions.

Graph app-only sending requires application authorization, normally
Application `Mail.Send` with tenant admin consent and sender-mailbox access.
After an explicit 401/403 rejection, the sender refreshes its token once.
Accepted sends and ambiguous network failures are not automatically replayed.

## 10. Data and integration boundaries

The app's ORM reads/writes **Azure PostgreSQL database `d365crm`, schema `crm`**.
All 20 mapped application tables use the **`eto_`** prefix. Development and
published app configuration target the shared ETO dataset, not permanent
parallel local/production ETO table sets.

Files live in private App Storage; metadata and extracted text live in
PostgreSQL. Preview/download access is authorized. Supported safe previews
include same-origin streaming to avoid signed/blob PDF iframe problems.

D365/Dataverse order creation, automated quote synchronization, ERP posting,
AI similarity search and summary generation are **not** delivered by the
current API. Azure PostgreSQL storage does not itself constitute those
business integrations.

## 11. Limits and operating notes

- No durable email outbox/replay UI or confirmed inbox-delivery tracking.
- Average time per stage is not a completed reporting capability.
- Search/OCR is not semantic similarity matching.
- Admin Console outages or invalid keys intentionally block new sign-ins.
- A successful Console test for an unknown identity checks connectivity and
  credential validity, not permission for every actual user.
- A development restart does not restart or verify the published application.
  Verify deployment configuration and additive schema changes before publishing.

Companion references: Business & Process Brief; MVP Contract; MVP Solution
Blueprint; UX Standards Discovery; Technical Details and End-to-End Flow;
ETO Workflow Diagram.
