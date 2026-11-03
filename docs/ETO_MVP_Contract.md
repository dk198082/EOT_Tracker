# ETO Tracker — MVP Contract
**Updated September 2026 · Current MVP baseline**
*This document describes the ETO Tracker as currently built. Deferred ideas are listed separately; statements about email delivery depend on the sending service being configured.*

---

## Business

### Objective
Replace the email-and-spreadsheet ETO process with a single, web-based system of record that provides: a centralized, searchable request repository; enforced workflow accountability; automated notifications and inactivity reminders; and a real-time metrics dashboard — eliminating the root causes of slow turnaround, invisible status, and absent data.

### Users

| Role | Description |
|---|---|
| **Sales** | Creates and submits requests, supplies missing information when a request returns to Draft, tracks quoted requests, and marks orders Won/Lost |
| **ART** | Central gatekeeper: reviews requests, chooses whether Engineering and Production reviews are needed, may override the default engineer, records final market price and lead time, and communicates declines |
| **Engineering** | Reviews assigned requests; enters estimated design hours and P/N guidance. The configured design formula calculates estimated design cost and lead time. |
| **Production** | Reviews assigned requests; enters procurement cost/lead time and assembly hours. The configured assembly formula calculates assembly cost and lead time. |
| **Admin / SuperUser** | Manages users, roles, default Engineering and Production reviewers, and design/assembly formula settings. SuperUser can simulate operational roles without changing their stored identity. |

One shared application. Access and available actions are controlled by role. No separate portals.

### Process
Sales creates a draft ETO request and submits it → ART accepts and independently includes or skips Engineering and Production → included reviewers provide their inputs → ART records final market price and lead time → the request becomes Quoted, then Sales/ART marks it Won or Lost. ART may decline at ART Review or ART Final Review. Role-specific returns move the request back to an earlier stage with a reason and preserve the audit history; these are not same-stage "More Info" actions. ART can abandon an active request and later re-open it at its previous stage. Comments, decisions, and optional attachments live on the ETO record; email is notification-only.

### Critical Success Factors
1. Every ETO request has one authoritative record, accessible by all parties at any time.
2. Every action is timestamped and attributed — full audit trail.
3. Inactivity is surfaced after 3 days for non-Engineering active stages or 5 days for Engineering; reminders are attempted on a daily sweep when email sending and a recipient are available.
4. Stage-change emails are attempted for the submitter and the new assignee when outbound email is configured.
5. ART can view live counts and KPIs without running a report.
6. Engineering receives complete, structured inputs and does not manage follow-ups.

---

## Product

### Screens

| # | Screen | Purpose |
|---|---|---|
| 1 | **Dashboard** | Stage counts, open/won/lost/declined totals, overdue count, decline breakdown, and "assigned to me" queue |
| 2 | **ETO List** | Searchable, filterable table of all requests — ETO #, customer, stage, assignee, age |
| 3 | **New Request Form** | Sales intake: customer and quote, distributor, request/system type, force/displacement ranges with units, materials, specimen dimensions, results required, custom requests, and optional standards, budget, lead time, similar parts, and attachments |
| 4 | **ETO Detail** | Request data, stage history, comments, attachments, specialist outputs, edits, split-family links, and role-appropriate actions |
| 5 | **Admin** | Users and roles, Engineering/Production default assignees, configurable design/assembly formulas and their change history |

### Workflow

```
Draft → ART Review → [Engineering Review] → [Production Review] → ART Final Review → Quoted → Won / Lost
                   ↘ Declined (ART only)                          ↘ Declined (ART only)
Active stages → Abandoned → Re-opened at the previous active stage
```

**Stage rules:**
- Engineering and Production Review are independent, optional stages selected by ART; both are initially included.
- On entry to a specialist stage, assignment uses the role-specific default from Admin → Users. ART may choose a different engineer for a particular ETO. A returning Engineering review retains its sticky engineer; changing a default does not reassign work already in progress.
- A return requires a reason and moves to a prior stage: Engineering → ART Review; Production → Engineering if included, otherwise ART Review; ART Final → Production, Engineering, or ART Review as applicable; Quoted → ART Final. Direct ART Final → Engineering requires a previously completed Engineering review.
- ART can split an unsplit request during ART Review into linked child requests, with copied intake details and attachments. Work continues on the children.
- No part number or documentation is automatically created by ETO Tracker; Engineering records P/N guidance only.

**Decisions by role:**

| Owner | Available decisions |
|---|---|
| ART Review | Accept with either/both specialist reviews or neither · Return to Draft · Decline (reason required) · Split request |
| Engineering | Quote Ready (positive estimated design hours and P/N guidance required) · Return to ART Review |
| Production | Approve (procurement and assembly estimates) · Return to Engineering, or ART Review if Engineering was skipped; **cannot decline** |
| ART Final | Record market price + lead time → Quoted · Return to Production/Engineering · Decline |
| Quoted (Sales / ART) | Mark Won · Mark Lost · Return to ART Final |
| ART / SuperUser | Abandon active work or re-open abandoned work |

### Data

| Object | Key fields |
|---|---|
| **ETO Request** | Auto-generated ETO number, customer and quote, distributor, request/system type, entered force/displacement values and their separate units, materials, specimen dimensions, results required, custom requests, optional budget with currency, stage inclusion flags, assignee/sticky engineer, split-family links, timestamps |
| **Comment** | Author, body, timestamp — threaded on a request |
| **Attachment** | Filename, storage reference, uploader, timestamp |
| **Stage Transition** | From stage, to stage, actor, decision, reason (for returns, declines, Lost, or abandonment), timestamp |
| **Review Output — Engineering** | Estimated design hours, calculated design cost/lead time and formula-rate snapshot, P/N guidance, notes; historical cost/documentation fields remain on older records |
| **Review Output — Production** | Procurement cost/currency and lead time, assembly hours, calculated assembly cost/lead time and formula-rate snapshot, notes; historical manufacturing/production values remain on older records |
| **Review Output — ART Final** | Market price/currency, market lead time, notes |
| **User / Review Defaults** | Name, email, local role linked to Microsoft identity; separately configurable Engineering and Production default users |

### Notifications
Notifications use email only, with an ETO number in the subject and a link back to the record. Resend must be configured; otherwise delivery is skipped, and delivery failures do not block workflow transitions. A durable delivery history is not currently available.

| Trigger | Recipients |
|---|---|
| New ETO submitted | ART team |
| Other stage changes | Submitter + newly assigned reviewer, when present |
| Order marked Won | Submitter + previous assignee, when present |
| No action after 3 days | Available owner of an active non-Engineering stage |
| No action after 5 days | Available owner of an active Engineering stage |

### Reporting
Dashboard counts combine current request stages with transition history; there is no separate reporting module.

- Live counts by stage
- Total open / won / lost / declined and overdue
- Decline count broken down by stage
- Per-user "assigned to me" queue with age

The API exposes a legacy "more info" count, but it does not count the current return decisions. Average time per stage is not calculated yet; neither should be presented as a complete current KPI.

---

## Technical

### Architecture

| Layer | Technology |
|---|---|
| Frontend | React + Vite SPA (`react-vite` artifact), served at `/` |
| API | Express 5 (existing `api-server` artifact), served at `/api` |
| Database | PostgreSQL via Drizzle ORM (Replit managed) |
| File storage | Replit Object Storage (attachments) |
| Auth | Microsoft Entra ID via OIDC; local app user records retain roles (`sales`, `art`, `engineering`, `production`, `admin`, `superuser`) |
| Email | Resend (stage notifications and reminders, only when configured) |
| Scheduled jobs | Node-cron in the API server (daily sweep for inactivity reminders) |

### Integrations

| Integration | Scope |
|---|---|
| **Microsoft Entra ID** | Authentication and identity. Admins may pre-create app users and set local roles in Admin → Users; first Entra sign-in links the account. |
| **Resend** | Outbound email notifications and reminders. No inbound email. |
| **Replit Object Storage** | Optional private attachments, authenticated access and signed download links; supported documents/images may be text-extracted or OCR-indexed. |
| **D365 / Azure CRM** | No two-way workflow sync or won-order webhook. The ETO number is available for manual use in D365; an optional read-only Azure CRM PostgreSQL health connection does not write orders. |

### Security
- Workflow and data routes require an authenticated Entra-backed application session; login/callback and health routes are public by necessity.
- Server-side role gates apply to actions and Admin settings. SuperUser may simulate an operational role for permissions, while their stored identity and audit actor remain unchanged.
- Attachments are private; downloads use signed short-lived links, and safe inline previews use an authenticated same-origin endpoint.
- Workflow payloads and specialist inputs are validated server-side; stage transitions are recorded as audit entries.

---

## Out of Scope

The following capabilities are not part of the current application:

| Deferred feature | Notes |
|---|---|
| D365 two-way integration | Auto field sync and won-order webhook; manual ETO number entry covers the MVP need |
| AI similarity search | Requires sufficient historical data volume to be useful |
| AI communication summaries | Nice-to-have; structured data is the core value at this stage |
| AI-generated white papers on won orders | Future polish |
| AI screening of incoming orders against sales lists | Complex; requires order feed integration |
| SharePoint push of engineering packages | Dependent on D365/SharePoint environment setup |
| Historical ETO bulk import | Targeted user/submitter role imports exist, but a general bulk import of historical ETO records is not established |
| Quote document generation (PDF/Word) | Manual process is acceptable at MVP scale |
| Mobile app | Web app on desktop is the primary use context |
| Reliable time-in-stage and current return-loop KPIs | Current dashboard does not compute these accurately |
| Notification delivery history | Send attempts can be logged, but there is no persistent admin delivery log |
