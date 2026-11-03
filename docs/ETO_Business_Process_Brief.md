# ETO (Engineer-To-Order) — Business & Process Brief
**Updated September 2026 · Current application and remaining business goals**

---

## What Problem We're Solving

Historically, custom product requests were managed by email, spreadsheets, and shared drives. ETO Tracker now provides a central record, role-based handoffs, history, an assigned-work queue, and overdue indicators. Measuring average time per stage and finding similar past requests remain future goals; the current dashboard does not deliver those capabilities.

---

## Who Uses It

| Role | Involvement |
|---|---|
| **Sales** | Creates and submits ETO requests, supplies structured requirements, reviews progress, and marks quoted orders Won or Lost (ART may also mark outcomes) |
| **ART (Application Review Team)** | Accepts or declines requests, independently includes/skips Engineering and Production, may override the default engineer, and sets final market price and lead time |
| **Engineering** | Supplies estimated design hours and P/N guidance; the configured formula estimates design cost and lead time |
| **Production** | Supplies procurement cost/lead time and estimated assembly hours; the configured formula estimates assembly cost and lead time |
| **Admin / SuperUser** | Manages app users and roles, default specialist reviewers, and design/assembly formula settings; SuperUser can simulate operational permissions |
| **Order Mapping Team** | Downstream business participant; top-level part-number creation is not automated by ETO Tracker |

---

## Prior Manual Process

Sales submits a custom request via email/spreadsheet → ART reviews manually → Engineering and/or Production consulted by email → ART sets price and communicates back → Won orders manually logged in D365 and a spreadsheet.

---

## Process in ETO Tracker Today

Sales creates a draft using the structured intake form, with optional attachments, then submits it to ART. ART chooses either, both, or neither specialist review. Engineering and Production receive assignments from the defaults in Admin → Users when their stages begin; ART can choose another engineer for a specific ETO. ART Final records market price and lead time, creating a Quoted request. Sales or ART records Won or Lost in the app. D365 entry remains manual. Comments, attachments, review outputs, and stage decisions stay with the request; ART can split a request into linked children during ART Review.

Returns require a reason and move to the earlier applicable stage (not a same-stage "More Info" state). An assigned engineer remains sticky on backward routing. ART can decline during ART Review or ART Final Review, or abandon and later re-open active work. Production does not have a Decline decision.

---

## Pain Points

- The former email/spreadsheet process lacked a central request and audit trail; migration to the app depends on teams using it consistently.
- Notifications and reminders require a configured email sender and an available recipient; delivery failures do not stop the workflow, and there is no persistent delivery log.
- Time-in-stage and frequency of the **current** backward-return decisions are not accurately reported yet.
- Engineering spends disproportionate time on information-gathering rather than engineering
- Similarity search across past ETOs is not implemented; attachment text extraction/OCR alone is not AI similarity matching.

---

## Desired Outcomes / Critical Success Factors

1. **Single source of truth** — request data, optional attachments, comments, specialist outputs, and decisions in one record; email is notification-only (with a link back to the record)
2. **Automated accountability** — overdue status and attempted reminders after 3 days at non-Engineering stages or 5 days in Engineering, subject to email configuration
3. **Real-time metrics dashboard** — ETOs by current stage, open/won/lost/declined totals, ART decline breakdown, overdue count, and each user's queue; average stage duration remains future work
4. **Reduced engineering overhead** — Engineering receives complete, structured inputs; does not manage follow-ups
5. **Future D365 integration** — automatically link ETOs to orders and downstream processes; current app only exposes the generated ETO number for manual use and records Won in-app
6. **Future AI assistance** — similarity review and communication summaries are not current app features

---

## Major Process Stages

```
[1] Draft             →  Sales intake and optional attachments; submit to ART
[2] ART Review        →  Include/skip Engineering and Production independently; return to Draft, decline, or split
[3] Engineering       →  Design hours, calculated design estimate, P/N guidance (optional)
[4] Production        →  Procurement and calculated assembly estimates (optional)
[5] ART Final Review  →  Market price and market lead time; advance to Quoted
[6] Quoted            →  Sales/ART marks Won or Lost, or returns to ART Final
```

ART may abandon and re-open active requests. Order-completion analysis and D365-triggered part-number creation are outside the current app.

---

## Major Decisions

| Stage | Decision Options |
|---|---|
| **ART Review** | Accept with optional specialist stages · Return to Draft · Decline · Split request |
| **Engineering Review** | Quote Ready → Production if included, otherwise ART Final · Return to ART Review |
| **Production Review** | Approve → ART Final · Return to Engineering if included, otherwise ART Review; no Decline |
| **ART Final Review** | Quote with market price and lead time · Return to Production or Engineering · Decline |
| **Quoted** | Mark Won or Lost · Return to ART Final |

---

## Key Business Rules

- **ETO number** is generated in the app. Copying it into D365 remains manual; there is no won-order webhook or generated quote document.
- **No automatic part-number/documentation creation** — Engineering records P/N guidance rather than creating downstream artifacts.
- **Review assignments** default to Admin-selected users on entry to Engineering and Production; ART may override an individual engineer. Backward Engineering returns preserve that request's sticky reviewer. Changing defaults does not retroactively move open work.
- **Engineering/Production versus ART** — specialist design and procurement/assembly estimates inform ART's separate final market price and market lead time. Monetary amounts carry a currency code; force and displacement carry separate units.
- **Reminder cadence:** active non-Engineering stages become overdue after 3 days, Engineering after 5; the daily email sweep attempts delivery when configured.
- **Comments and history stay in the app** — external email contains an ETO number and link, not a replacement conversation.
- **Recorded transitions and details** are timestamped for traceability; average time-in-stage is not yet computed.
- **Won-order trigger:** Won is an in-app decision, not a D365 action. The current email template targets the submitter and previous assignee when sending is configured; it does not initiate PN creation.
