# ETO — Business & Process Brief

**Refreshed:** November 2026 · **Scope:** Delivered process and remaining goals

## Business purpose

ETO Tracker replaces disconnected email/spreadsheets for custom requirements
with a shared request, clear functional handoffs, structured estimates and
auditable decisions. The objective is complete inputs for specialist teams,
visible ownership for Sales, and a consistent basis for commercial quoting.
Email is a notification channel, not a replacement for the request record.

## Participants and access

| Participant | Responsibility |
|---|---|
| Sales | Prepare and submit requests; provide requirements; record permitted quoted outcomes |
| ART | Select Entity and review scope; accept/return/decline; set reviewers and schedule; issue final commercial output |
| Engineering | Design-hours estimate, P/N guidance and technical risk |
| Production | Procurement estimate, assembly-hours estimate and production risk |
| Admin | Users/roles, TOUS/TOUK defaults, formulas and notification switches |
| SuperUser | Exceptional operational access and controlled role simulation |
| None | Console-approved sign-in, but no ETO data until an app role is assigned |

Microsoft Entra authenticates users. The external Admin Console must authorize
the registered app ETO before the app issues a session. Local ETO roles remain
separate. Existing users keep their roles; new approved users start with None.

## Process from intake to outcome

1. **Prepare Draft.** Capture customer/quote references, system and test
   requirements, materials/specimen, units, budget/currency and acceptable
   lead time. System Type includes Other; attachments are optional.
2. **Submit to ART.** Assign the ETO number on first submission.
3. **ART Review.** Select Entity TOUS/TOUK first, choose Engineering and
   Production independently, choose/confirm specialist reviewers and schedule.
   ART may return to Draft with a reason, decline, or split an eligible request.
4. **Engineering, if included.** Capture positive design hours, P/N guidance,
   risk and notes. Saved formulas estimate design cost and time.
5. **Production, if included.** Capture procurement cost/time, assembly hours,
   risk and notes. Saved formulas estimate assembly cost and time.
6. **ART Final Review.** Review the cost and lead-time calculations; generate
   a quote with Market Price, Market Lead Time, required part Description, and
   optional Notes. This moves the request to Quoted.
7. **Commercial close-out.** Sales/ART record Won or Lost. Lost requires a
   reason and is distinct from ART's pre-quote Declined outcome.

## Four valid review routes

| ART's selections | Route |
|---|---|
| Both reviews | ART → Engineering → Production → ART Final |
| Engineering only | ART → Engineering → ART Final |
| Production only | ART → Production → ART Final |
| Neither | ART → ART Final |

Engineering returns to ART. Production returns to Engineering when included,
otherwise ART. ART Final returns to the last applicable review/ART; a specific
Engineering return is also supported. Quoted work may return to ART Final.
Returns require a reason; they are not same-stage “More Info” self-loops.

ART/SuperUser can abandon supported active work and reopen it to its recorded
prior stage. Won/Lost/Declined are terminal in the current workflow.

## Ownership, Entity and deadlines

Admin → Assignment Defaults contains four independent choices: TOUS
Engineering, TOUS Production, TOUK Engineering, TOUK Production. TOUK does not
silently inherit TOUS choices. Defaults apply on stage entry; explicit ART
choices and retained reviewers are preserved on returns.

Engineering/Production reviewers can use **Re-Assign** to select another user
in their department without advancing the request or losing saved review work.
An actual change can notify the new reviewer if that switch is enabled.

The due-date baseline is initial ART acceptance. Only included specialist
durations plus ART Final duration contribute. Cumulative review deadlines and
the overall due date remain fixed through rework returns. Inactivity-overdue
alerts are separate; missing historical schedules are not invented.

## Commercial calculation

The Price Calculator uses Design + Procurement + Assembly costs, then adds
Contingency and additive Margin. Admin defaults initialize per-request
percentages; saved percentages do not change with future Admin default edits.
Money is whole-number, currency-aware, and never silently FX-converted.
Mixed-currency totals are labelled Multi-Currency for ART review.

Calculated Lead Time is Design + Procurement + Assembly **weeks**. Generate
Quote starts Market Lead Time at the final sum rounded **up** to a whole week.
ART can independently override quote price/time. Description is required and
separate from Notes.

## Notifications and audit

Microsoft Graph sends enabled notifications from the configured no-reply
mailbox. ART submissions reach ART; ART completion informs the original
submitter with the expected due date; confirmations/reassignments notify the
next/new reviewer. Generate Quote informs the submitter with Price, Lead Time,
Description and Notes, with ETO/Quote references in the subject.

Admin → Email Notifications independently controls ten event categories,
including reminders/other updates; new categories start off. Set all to
yes/no is available. Current selections persist across restarts.

Audit Trail has Stage, Details and Email tabs. Email entries group all
recipients/messages under one originating event. Graph acceptance is not
proof of inbox receipt. Email failure does not roll back an accepted review.
Failed historical entries do not turn successful when credentials are fixed.

## Record continuity

ART/SuperUser can split an eligible ART Review request into 2–10 linked child
requests. The parent remains visible but workflow-read-only; children proceed
in ART Review with inherited requirements and independent attachments.

Request Details edits are restricted to ART/SuperUser. Comments, specialist
outputs and attachments have their own authorized operations and histories.
The ETO Requests grid includes Assignee, stage, inactivity-overdue and family
filters plus search. Dashboard provides current workload/outcome metrics and
the signed-in user's queue.

Records are stored in one shared Azure PostgreSQL `d365crm` / `crm.eto_*`
dataset. Private files are stored separately in App Storage.

## Current limits and future goals

- Adopt consistent input quality and role ownership across both entities.
- Average stage-duration reporting and semantic similarity matching are not
  completed features.
- D365 order entry/ERP posting and automated quote synchronization remain
  outside the current implemented business integration.
- Durable email queue/replay controls and confirmed inbox-delivery tracking
  are not implemented.
- Admin Console availability and a valid integration key are dependencies
  for sign-in; failure is not bypassed.

This brief describes current delivery, not a promise that deferred goals are
already available. Detailed acceptance boundaries are in the refreshed MVP
Contract; implementation boundaries are in the Technical Details reference.
