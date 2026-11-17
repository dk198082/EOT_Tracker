# ETO Tracker — MVP Solution Blueprint

**Refreshed:** November 2026 · **Type:** As-built solution map

## 1. System context

```text
Browser → React/Vite ETO UI → Express API → Azure PostgreSQL d365crm / crm.eto_*
                                  ├→ Private App Storage (file objects)
                                  ├→ Microsoft Entra ID (authentication/token issuance)
                                  ├→ Admin Console (application-admission check)
                                  └→ Microsoft Graph (notification submission)
```

The browser never receives the Admin Console API key or Graph client secret.
The server authorizes actions; hiding a button is not a security boundary.
Schema changes and environment settings must be deployed intentionally;
this diagram does not claim that every published instance has the same build.

## 2. Screen map

| Screen / area | Main controls and records |
|---|---|
| Sign-in / access pending | Microsoft sign-in; separate no-ETO-access state for role None |
| Dashboard | Stage/outcome/overdue metrics; assigned-to-me queue |
| ETO Requests | Search; stage, Assignee, overdue and split-family filtering; pagination |
| New Request | Structured intake, currency/units, System Type Other, attachments; save/submit |
| Request details | Intake, Entity, numbering, ownership, planned deadlines and split links |
| Workflow Actions | Stage/role-specific completion, return and lifecycle controls |
| Specialist outputs | Engineering design and Production procurement/assembly estimates with risks |
| Price Calculator | Costs, per-request percentages, Sales Price and calculated lead time |
| Generate Quote | Independent Market Price/Lead Time, required Description, parts guidance and Notes |
| Audit Trail | Stage / Details / Email; event-grouped recipients and message outcomes |
| Workflow | On-screen route reference and downloadable SVG |
| Admin | Users / Assignment Defaults / Email Notifications / Design Formula / Assembly Formula / Price Calculator |

Re-Assign sits between Complete Review and Back in the Engineering/Production
actions. It changes a department assignee, not the stage.

## 3. Identity and authorization sequence

1. Start Entra login with PKCE, state and nonce.
2. Validate the callback and identify the authenticated Entra object ID.
3. Call Admin Console access-check for registered app ETO using server credentials.
4. Denied: reject sign-in. Unavailable/invalid credential/invalid response:
   reject sign-in without bypass.
5. Resolve or create the existing ETO user mapping. Preserve existing roles;
   new approved users get None.
6. Persist the session in crm.eto_sessions and set the session cookie.
7. On business APIs, require an authenticated mapped user with an assigned
   role and enforce the operation's role/stage rules.

Admin Console admission is not an automatic import of Console roles into ETO
permissions. Current admission occurs at login; it is not a claim of continuous
Console revalidation on every already-issued session.

## 4. Workflow and ownership model

Draft → ART → optional Engineering → optional Production → ART Final →
Quoted → Won/Lost. Entity is selected during ART Review. Both specialist
inclusion flags are independent, giving four forward routes.

ART acceptance saves schedule and reviewer decisions. Entity-specific defaults
are starting assignments; explicit per-request assignments survive applicable
return loops. TOUK's defaults are independent of TOUS. Same-stage reassignment
retains the stage, deadlines and outputs.

Returns require reasons and use applicable earlier reviews. Decline is allowed
at ART Review/ART Final only. Abandon/reopen is a separate ART/SuperUser
lifecycle path. Split parents remain linked/read-only; children proceed in ART.

## 5. Logical data design

All names below are in schema **crm**, database **d365crm**. The ORM maps
20 application tables; names already beginning eto_ receive no second prefix.

| Table | Responsibility |
|---|---|
| eto_users | Entra-linked application users, role and profile |
| eto_sessions | Server-side sessions and expiry |
| eto_requests | Intake, stage, Entity, reviewer selections, schedule, split/lifecycle context |
| eto_stage_transitions | Append-only stage decisions, reasons and actor context |
| eto_detail_changes | Field-level edit and assignment-change audit |
| eto_comments | Request discussion |
| eto_attachments | File metadata, private object references and searchable indexing state/text |
| eto_engineering_outputs | Design estimate, formula snapshot, P/N guidance, risk and legacy values |
| eto_production_outputs | Procurement/assembly estimates, formula snapshot, risk and legacy values |
| eto_art_final_outputs | Market Price/currency, Market Lead Time, Description and Notes |
| eto_review_assignment_defaults | Entity-specific Engineering and Production defaults |
| eto_price_calculator_settings | Global initial contingency/margin defaults |
| eto_price_calculator | Saved per-request calculator percentages |
| eto_design_formula_settings | Current design calculation assumptions |
| eto_design_formula_changes | Design settings history |
| eto_assembly_formula_settings | Current assembly calculation assumptions |
| eto_assembly_formula_changes | Assembly settings history |
| eto_email_notification_settings | Independent persisted notification switches |
| eto_email_delivery_events | One email audit record per originating event, recipient union and nested messages |
| eto_data_imports | Data-import/reconciliation bookkeeping |

Files are not stored as database byte arrays. Business table definitions,
relationships and delete policies live in lib/db/src/schema. Special cutover
archive helpers are not a separate permanent live ETO dataset.

## 6. Calculation and output ownership

Engineering supplies hours, P/N guidance and risk; design settings calculate
cost and weeks. Production supplies procurement cost/weeks and assembly hours;
assembly settings calculate assembly cost/weeks. Saved outputs retain their
calculation assumptions.

The Price Calculator adds whole-number source costs, contingency and additive
margin. Global percentages initialize unsaved per-request settings only.
Mixed-currency arithmetic is explicitly labelled and never silently converted.

Lead time is saved Design + Procurement + Assembly weeks. Quote generation
starts Market Lead Time at ceiling(total). Price/time quote overrides are
independent. Description is mandatory; Notes is a separate field.

## 7. Event and email design

Committed workflow/assignment actions build enabled notifications. A durable
email-history row is created before sending; messages and recipients are
grouped by originating action. If initial history persistence fails, the
messages are not sent untracked.

Graph app-only tokens authorize sendMail from the configured mailbox.
Authorization failures refresh the token once; other failures are not a
general replay mechanism. Email sending is not transactionally guaranteed
with the preceding business action, and there is no durable outbox worker.

After sends, per-message outcomes and aggregate accepted/partial/failed/skipped
status are updated. If the outcome write fails, history may stay unconfirmed;
that does not authorize resending a possibly accepted message. UI refresh and
polling read the stored event rather than inferring mail from stage history.

Ten independent settings cover ART submission/completion, three forward
assignment events, two reassignments, quote generation, inactivity reminders
and other workflow updates. They begin off and offer atomic bulk yes/no.

## 8. Storage, search and reporting

Authorized upload metadata registration associates private objects with
requests. Download/preview access is scoped; safe types can be streamed inline
from the same origin. The indexer extracts text/OCR for supported formats and
retains indexing progress/failure state.

Search uses request/related text, including extracted attachment text. It is
not semantic similarity matching. Dashboard reads current request state and
history-derived metrics; average stage-time reporting remains incomplete.

## 9. Delivery boundaries and deferred work

- Development and published apps use the shared Azure ETO namespace when
  configured as intended; this is not independent production data isolation.
- Admin Console key rotation is distinct from Entra/Graph permissions.
- APP_BASE_URL must be the verified published origin for notification links.
- D365 quote/order creation and synchronization are not implemented in the
  current business API despite the CRM database name.
- Durable notification outbox/retry UI, inbox confirmation, nested splits,
  merge-back, AI summaries/similarity and robust time-in-stage reporting are
  not part of current delivered capability.

Detailed API/configuration and recovery guidance are in the Technical Details
and End-to-End Flow reference; user expectations are in the MVP Contract.
