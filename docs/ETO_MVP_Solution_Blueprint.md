# ETO Tracker — MVP Solution Blueprint
**Updated September 2026 · As-built solution**

---

## 1. Primary Users

| User | Role in MVP |
|---|---|
| **Sales** | Creates and submits requests, supplies structured inputs, tracks progress, and records Won/Lost outcomes |
| **ART** | Reviews and routes requests, includes/skips specialist stages, can split a request, and records final market price and lead time |
| **Engineering** | Supplies estimated design hours and P/N guidance on assigned requests; design cost/lead time are formula-calculated |
| **Production** | Supplies procurement cost/lead time and assembly hours; assembly cost/lead time are formula-calculated |
| **Admin / SuperUser** | Manages users, roles, Engineering/Production defaults, and formula settings; SuperUser may simulate operational roles without changing their stored identity |

One shared app, role-based views. No separate portals.

---

## 2. Core Screens

1. **Dashboard** — stage and open/won/lost/declined counts, overdue count, decline breakdown, and "assigned to me" queue
2. **ETO List** — searchable/filterable table of all requests (ETO #, customer, status, assignee, age)
3. **New ETO Request Form** — Sales intake: customer and quote, distributor, request/system type, force and displacement with units, materials, specimen dimensions, results required, custom requests; standards, budget/currency, desired lead time, similar parts, and attachments are optional
4. **ETO Detail** — intake, audit timeline, comments, optional private attachments/previews, specialist outputs, split-family links, and role-appropriate actions
5. **Admin** — Users tab for role management and specialist default reviewers; Design Formula and Assembly Formula tabs for rates and change history

---

## 3. Core Data Objects

- **ETO Request** — auto-generated ETO number, structured form fields (units and currency stored separately), stage inclusion choices, assignee/sticky engineer, parent/child split links, timestamps
- **Comment / Communication** — threaded notes on a request (replaces email chains)
- **Attachment** — private files linked to a request; supported documents/images can be indexed by text extraction/OCR
- **Stage Transition (audit log)** — who moved it, from/to, decision, reason, timestamp (powers metrics)
- **Review Outputs** — Engineering (design hours, calculated cost/lead time, P/N guidance); Production (procurement cost/lead time, assembly hours, calculated cost/lead time); ART Final (market price/currency, market lead time, notes). Historical output values remain readable.
- **Formula Settings / History** — configurable hourly rate, hours per week, and capacity factor for design and assembly; completed outputs retain their formula-rate snapshot
- **User / Review Defaults** — local role-bearing user linked on Microsoft Entra sign-in; one admin-selected Engineering and one Production default reviewer

---

## 4. Workflow Stages

```
Draft → ART Review → [Engineering Review] → [Production Review] → ART Final Review → Quoted → Won / Lost
                   ↘ Declined (ART only)                          ↘ Declined (ART only)
Active stages → Abandoned → Re-opened at the previous active stage
```

ART independently includes or skips Engineering and Production. Backward returns require a reason and create a new stage-transition record; there are no same-stage "More Info" transitions. On entering a specialist stage, the configured reviewer is assigned unless an allowed per-request choice or sticky engineer takes precedence. Changes to Admin defaults do not overwrite existing assignments. ART can split an unsplit request at ART Review into linked children.

---

## 5. Key Decisions

| Owner | Decisions |
|---|---|
| ART Review | Accept with optional specialist reviews · Return to Draft · Decline · Split |
| Engineering | Quote Ready → Production if included, otherwise ART Final · Return to ART Review (engineer remains sticky for later Engineering returns) |
| Production | Approve → ART Final · Return to Engineering if included, otherwise ART Review; no Decline action |
| ART Final | Quote (market price + lead time) · Return to Production or Engineering · Decline |
| Quoted (Sales / ART) | Mark Won or Lost · Return to ART Final |
| ART / SuperUser | Abandon active work or re-open abandoned work |

---

## 6. Email Notification Behavior

Email templates link back to the record and include the ETO number in the subject. Microsoft Entra app credentials and a Graph sender mailbox with `Mail.Send` permission are required; skipped or failed delivery does not block the transition. Each request's Audit Trail → Email shows persistent, event-grouped send history with all recipients, message subjects and Graph acceptance outcomes. Disabled notifications are not logged, and earlier emails cannot be reconstructed.

| Trigger | Recipients |
|---|---|
| New ETO submitted | ART |
| Other stage changes | Submitter + new assignee, if any |
| Order won | Submitter + previous assignee, if any |
| Inactivity — 3 days no action | Available owner of an active non-Engineering stage |
| Inactivity — 5 days no action | Available owner of an active Engineering stage |

---

## 7. Required Dashboards / KPIs

- Requests by stage (live counts)
- Won / Lost / Declined / Open totals and overdue count
- ART decline count by stage
- "Assigned to me" queue (per-user view on dashboard)

The dashboard does **not** yet calculate average time per stage. Its legacy "more info" count does not capture the current backward-return decisions and should not be treated as a current-process KPI.

---

## 8. Integrations Required for MVP

- **Microsoft Entra ID (OIDC)** authenticates users. App records hold roles; admins can pre-create users and set roles in the Users tab, with identity linking on first sign-in.
- **Private Replit Object Storage** holds optional attachments; uploads/downloads are authenticated, with signed links or a safe inline preview endpoint.
- **Microsoft Graph** sends stage notifications and daily-sweep inactivity reminders only when configured.
- **D365 remains manual**: the app displays the ETO number for manual use, and Won is recorded in-app. An optional read-only Azure CRM database connection is not two-way D365/Dataverse workflow integration.

---

## 9. Features Explicitly Deferred to a Future Phase

| Feature | Reason deferred |
|---|---|
| D365 two-way integration (auto field sync, won-order webhook) | Integration risk; manual paste covers MVP need |
| AI similarity search on new requests | Requires sufficient historical data to be useful |
| AI summaries of communications | Nice-to-have; core value is structured data, not AI summaries |
| AI white papers on won orders | Future polish |
| AI screening of incoming orders against sales lists | Complex; requires order feed integration |
| SharePoint push of engineering packages | Dependent on D365/SharePoint setup |
| Historical ETO bulk import | Targeted user/submitter imports exist, but a general historical ETO import is not established |
| Quote-document generation | Manual process is acceptable at MVP scale |
| Accurate average time-in-stage and current return-loop metrics | Current dashboard does not compute these |
| Inbox-delivery confirmation | Send attempts are recorded per request, but inbox delivery is not confirmed |

---

## Design Principle

The solution centers on one shared, role-gated request workflow and its audit trail. Admin controls, private attachments, configurable reviewer/formula settings, and split ETOs support that workflow. AI, D365 write automation, SharePoint, and order-completion analysis remain separate future work; dashboard metrics should be described only where they are actually computed.
