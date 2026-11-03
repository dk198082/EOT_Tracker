# ETO Tracker — Published App Operations & Azure Table Reference

For users, administrators and support teams. Includes an activity-to-table mapping and a full column/constraint appendix. No live data or credentials are included.

## Document directory
User guide: connection, roles, workflow, storage, audits and important limitations.

Activity index: quickly identify tables changed by each operation.

Activity details: roles, reads, writes, principal fields, endpoints and behavior.

Table directory: purpose and row structure for all 18 application tables.

Schema appendix: all 181 columns, defaults, nullability, primary/unique/foreign keys.

## 1. Purpose and verified scope
This reference maps published ETO Tracker activities to Azure PostgreSQL tables and describes what each action reads, inserts, updates or deletes. It is an operations reference, not a migration plan. Prepared 8 October 2026 from current API/UI code and read-only Azure catalog inspection.

Published app: https://process-brief-generator.replit.app (private deployment at the time of verification). Database: d365crm. Application schema: crm. All 18 current app tables begin eto_. The catalog contains 181 columns and 19 physical foreign keys. No business rows, user identities, credentials or session payloads are included.

Scope distinction: table structures and route behavior were inspected. This document is not a claim that every production form was retested in a signed-in browser. It does not perform database changes, publish the app or create project tasks.

## 2. Connection and where to view the tables
Published browser → API under /api → Azure PostgreSQL connection pool → d365crm → crm.eto_* tables. Application runtime uses the AZURE_PG_* connection settings, not the retained legacy DATABASE_URL. Secrets are never included in this document.

The Replit Development/Production database pane shows Replit-managed databases, not the external Azure database. Inspect Azure using an Azure-connected PostgreSQL client: d365crm → Schemas → crm → Tables. Old managed public-schema tables remaining in that pane do not mean Azure table creation failed.

If development and published environments point to the same Azure database/schema, they share the same records. A development edit can affect data visible in the published app. They are not independent copies simply because Replit has separate database panes.

## 3. Reading the operation descriptions
READ = SELECT existing data. INSERT = add a row. UPDATE = modify an existing row. DELETE = remove a row. INSERT / UPDATE means save-or-update (upsert). Conditional writes happen only when the stated condition applies.

All protected activities implicitly read crm.eto_sessions and crm.eto_users for authentication/role enforcement. Operation-specific Read tables below list additional or principal business dependencies; pages may load separate sections through multiple requests.

Table names and columns are physical PostgreSQL names (snake_case). JSON/form fields may use camelCase; eto_request_id and etoRequestId refer to the same link at their respective layers. Database NOT NULL is not the complete UI-required-field rule.

## 4. Roles and important limits
Sales creates drafts; Sales or ART may submit/close quoted requests under workflow rules. ART edits existing Request Details, coordinates reviews, splits requests and completes ART Final Review. Engineering and Production perform their own completion decisions; ART can also save their output sections.

Admin and SuperUser manage users and global defaults/formulas. SuperUser can perform business role actions; ordinary Admin does not automatically bypass every business-role check. Simulation changes effective permission only, retaining the real identity and stored role.

Every transition must also be valid for the current stage. Being the request creator/owner does not give permission to edit existing Request Details. Privileged user edits/deletes have lockout/default-reviewer protections.

## 5. Normal request journey
Draft → ART Review → Engineering Review (if selected) → Production Review (if selected) → ART Final Review → Quoted → Won or Lost. Returns can move the request back to the permitted earlier stage; ART may decline or abandon under the allowed stage rules. An abandoned request may be reopened.

The database numeric id is created when the draft is inserted. The displayed ETO number remains empty until first successful submission to ART. Subsequent returns/resubmissions keep that number. Split children have a parent_eto_request_id, split_sequence and suffixed references.

Due dates start at the first ART acceptance and count only included Engineering/Production durations plus ART Final Review. Return loops do not reset the deadline. Old missing schedule values remain unknown rather than being invented.

Saving a review output and completing its workflow stage are different actions: output saves do not independently advance the stage. Completing a review updates the request and activity history and may save its output inside the same transition transaction.

## 6. Storage, audit and data rules
PostgreSQL stores attachment metadata and extraction/search state. File bytes are stored in object storage; upload URL creation, byte transfer and metadata registration are separate steps. Downloads/previews read metadata and storage bytes, without changing request state.

Money is stored in text amount fields with separate currency codes; amounts use whole-number money rules. No silent exchange-rate conversion is performed for mixed-currency totals. Measurement units are independent from entered range text. Historical cost/lead-time fields remain distinguishable from current design-hours, procurement and assembly estimates.

Risk score is required when saving/completing reviews; High risk requires a dedicated explanation. A historical null risk score is unknown, not Low. Nullable columns support historical records and do not mean those values are optional for current forms.

Workflow events go to eto_stage_transitions. Field edits go to eto_detail_changes. Global design/assembly changes have their own history tables; actors are retained in formula-history snapshots. Identical formula saves do not create a new change entry.

Settings tables use id=1 as their singleton setting. Empty settings tables can use code defaults on READ; reading them does not necessarily create a row. Global formula changes do not retroactively recalculate every saved request output.

## 7. Operations not to confuse with deletion or activation
There is no current request DELETE endpoint and no comment edit/delete endpoint. Won/Lost/Declined/Abandoned are status changes, not physical deletion. Database ON DELETE CASCADE rules describe what SQL would do if a parent were deleted; they are not proof of a user-facing delete button.

Attachment DELETE is available under its permission checks. User DELETE is available to privileged users but can be rejected by protection checks or existing restrictive foreign keys. No user-facing operation deletes audit history.

Optional shared-archive controls are conditional on a separately installed compatible schema. At the last direct verification, archive mode was inactive and the catalog remained the 18 tables documented here. Do not assume every request is an archive or that future archive-state/number-registry tables already exist.

Opening the app does not automatically send email if provider settings are missing. There is no notification delivery-log table. Object-storage work and email delivery are external side effects, not PostgreSQL rows.

## 8. Relationships and troubleshooting
eto_requests is the parent business record. Transitions, comments, attachments, edit history and review outputs point to its id using eto_request_id. Each Engineering/Production/ART Final output has a unique eto_request_id, allowing one saved output per request.

eto_price_calculator uses eto_request_id as both primary key and foreign key. eto_requests links back to eto_users for submitter/reviewers and to itself for split parents. Activity/comment/attachment/edit-history authors reference eto_users.

Formula-history actor_user_id values are logical links to users without physical FK constraints; actor_name/actor_email snapshots retain the attribution. The schema appendix lists actual physical FK delete behaviors, not implied ones.

If an operation fails: confirm sign-in, effective role, request stage, required values and current record context. Verify the Azure target and table/sequence permissions through authorized diagnostics. Do not rename/delete legacy managed tables or rerun bootstrap/imports just because the database pane looks different.

For inspection only, run in the Azure connection: SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'crm' AND left(table_name, 4) = 'eto_' ORDER BY table_name;

## 9. Sources and maintenance
Operation mappings: current routes/auth, users, eto-requests, transitions, outputs, comments, attachments, dashboard, price-calculator and admin; authentication/session helpers; workflow state machine; local-user identity mapping; upload/storage and background processing code. Inventory: live Azure information_schema.columns and pg_constraint, read only.

Keep this reference aligned with deployed code when adding routes, columns, permissions or archive activation. The following appendix records the schema observed for this document; it is not a migration script or a copy of production row data.

## Activity index
| No. | User or system activity | Tables changed |
| --- | --- | --- |
| 01 | Sign in with Microsoft Entra ID | crm.eto_users: INSERT / UPDATE; crm.eto_sessions: INSERT |
| 02 | Use an authenticated page or check the signed-in user | crm.eto_sessions: DELETE (conditional) |
| 03 | Browse, filter and search ETO requests | Read only / no business-table writes |
| 04 | Open dashboard and My Queue | Read only / no business-table writes |
| 05 | Open request details and review sections | Read only / no business-table writes |
| 06 | Create a draft ETO | crm.eto_requests: INSERT; crm.eto_stage_transitions: INSERT |
| 07 | Edit request details or assignment | crm.eto_requests: UPDATE; crm.eto_detail_changes: INSERT (when fields change) |
| 08 | Submit draft to ART | crm.eto_requests: UPDATE; crm.eto_stage_transitions: INSERT |
| 09 | ART accepts, returns or declines the initial review | crm.eto_requests: UPDATE; crm.eto_stage_transitions: INSERT |
| 10 | Save Engineering output without completing the stage | crm.eto_engineering_outputs: INSERT / UPDATE; crm.eto_detail_changes: INSERT (changed existing fields) |
| 11 | Complete Engineering or return to ART | crm.eto_requests: UPDATE; crm.eto_engineering_outputs: INSERT / UPDATE (completion); crm.eto_stage_transitions: INSERT |
| 12 | Save Production output without completing the stage | crm.eto_production_outputs: INSERT / UPDATE; crm.eto_detail_changes: INSERT (changed existing fields) |
| 13 | Complete Production or return for review | crm.eto_requests: UPDATE; crm.eto_production_outputs: INSERT / UPDATE (completion); crm.eto_stage_transitions: INSERT |
| 14 | Save ART Final output | crm.eto_art_final_outputs: INSERT / UPDATE; crm.eto_detail_changes: INSERT (changed existing fields) |
| 15 | Issue quote or return from ART Final Review | crm.eto_requests: UPDATE; crm.eto_art_final_outputs: INSERT / UPDATE (quote decision); crm.eto_stage_transitions: INSERT |
| 16 | Mark quoted request Won/Lost or return to ART Final | crm.eto_requests: UPDATE; crm.eto_stage_transitions: INSERT |
| 17 | Abandon a request or reopen an abandoned request | crm.eto_requests: UPDATE; crm.eto_stage_transitions: INSERT |
| 18 | Split a request into related ETOs | crm.eto_requests: UPDATE + INSERT; crm.eto_attachments: INSERT; crm.eto_stage_transitions: INSERT |
| 19 | Read discussion or add a comment | crm.eto_comments: INSERT (add only) |
| 20 | Upload a request attachment | crm.eto_attachments: INSERT |
| 21 | List, preview or download attachments | Read only / no business-table writes |
| 22 | Delete an attachment | crm.eto_attachments: DELETE |
| 23 | Read or save request Price Calculator | crm.eto_price_calculator: INSERT / UPDATE; crm.eto_detail_changes: INSERT (changed percentages) |
| 24 | Set default reviewers | crm.eto_review_assignment_defaults: INSERT / UPDATE |
| 25 | Set design formula and read its history | crm.eto_design_formula_settings: INSERT / UPDATE (changed inputs); crm.eto_design_formula_changes: INSERT (changed inputs) |
| 26 | Set assembly formula and read its history | crm.eto_assembly_formula_settings: INSERT / UPDATE (changed inputs); crm.eto_assembly_formula_changes: INSERT (changed inputs) |
| 27 | Set global Price Calculator defaults | crm.eto_price_calculator_settings: INSERT / UPDATE |
| 28 | List users or pre-create a user | crm.eto_users: INSERT (create) |
| 29 | Change a user role | crm.eto_users: UPDATE |
| 30 | Delete a user | crm.eto_users: DELETE (only when allowed) |
| 31 | Simulate a business role | Read only / no business-table writes |
| 32 | Read workflow and edit audit history | Read only / no business-table writes |
| 33 | Sign out | crm.eto_sessions: DELETE |
| 34 | Index or extract searchable attachment text | crm.eto_attachments: UPDATE |
| 35 | Send transition emails, reminders or an admin delivery test | crm.eto_requests: UPDATE (successful reminder only) |
| 36 | One-time bootstrap, identity/role/submitter imports | crm.eto_users: UPDATE (applicable import); crm.eto_requests: UPDATE (applicable submitter import); crm.eto_data_imports: INSERT |
| 37 | Check service and Azure connection health | Read only / no business-table writes |

## Activity details
### 01. Sign in with Microsoft Entra ID
Who: All permitted application users

Reads: crm.eto_users, crm.eto_sessions

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_users | INSERT / UPDATE | clerk_id, name, email, updated_at; role preserved for existing identities |
| crm.eto_sessions | INSERT | sid, sess, expire |

API / trigger: GET /api/login; GET /api/auth/callback

Behavior: The callback verifies the identity and creates a session. The historical physical column clerk_id stores the current authentication link; it does not mean the app signs in through Clerk. An unlinked pre-created user may be linked by matching email. New users receive the default Sales role. No passwords are stored in these tables.

### 02. Use an authenticated page or check the signed-in user
Who: Signed-in users

Reads: crm.eto_sessions, crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_sessions | DELETE (conditional) | Expired session only |

API / trigger: GET /api/auth/user; GET /api/users/me

Behavior: Authentication is an implicit dependency of all protected operations below: sessions and users are read for identity/role checks. Expired sessions can be removed during validation. The session helper also supports updates when invoked; browsing does not imply a business-record write.

### 03. Browse, filter and search ETO requests
Who: Signed-in users

Reads: crm.eto_requests, crm.eto_users, crm.eto_engineering_outputs, crm.eto_production_outputs, crm.eto_art_final_outputs, crm.eto_comments, crm.eto_attachments, crm.eto_stage_transitions, crm.eto_detail_changes

Writes: none for this business activity (normal authentication/expired-session handling still applies).

API / trigger: GET /api/eto-requests

Behavior: Simple listing reads requests and user assignments; text search can additionally inspect outputs, discussions, attachments/extracted text, transitions and detail history. Search/filter/sort/pagination do not update request rows. Split-family context is read from eto_requests itself.

### 04. Open dashboard and My Queue
Who: Signed-in users

Reads: crm.eto_requests, crm.eto_stage_transitions, crm.eto_users

Writes: none for this business activity (normal authentication/expired-session handling still applies).

API / trigger: GET /api/dashboard/metrics; GET /api/dashboard/my-queue

Behavior: Counts and queue information are calculated from existing rows. There is no dashboard table. No request data is changed merely by opening the dashboard.

### 05. Open request details and review sections
Who: Signed-in users

Reads: crm.eto_requests, crm.eto_users, crm.eto_engineering_outputs, crm.eto_production_outputs, crm.eto_art_final_outputs, crm.eto_comments, crm.eto_attachments, crm.eto_stage_transitions, crm.eto_detail_changes, crm.eto_price_calculator, crm.eto_price_calculator_settings

Writes: none for this business activity (normal authentication/expired-session handling still applies).

API / trigger: GET /api/eto-requests/:id; GET /api/eto-requests/:id/engineering-output; GET /api/eto-requests/:id/production-output; GET /api/eto-requests/:id/art-final-output

Behavior: The detail screen requests related sections separately. Formula/default settings can also be read for calculations. Reading an output/default is not an INSERT; some empty settings tables legitimately use built-in defaults.

### 06. Create a draft ETO
Who: Sales or SuperUser

Reads: crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | INSERT | customer_name, quote_number, quote_revision, submitted_by_id, stage=draft, eto_number=NULL |
| crm.eto_stage_transitions | INSERT | Creation activity: from_stage=draft, to_stage=draft, actor_id, simulated_role |

API / trigger: POST /api/eto-requests

Behavior: Request and initial activity are committed in one transaction. The creation activity currently uses decision=submit but remains draft→draft; it is not the real submission to ART. No ETO number is assigned at draft creation.

### 07. Edit request details or assignment
Who: ART or SuperUser

Reads: crm.eto_requests, crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE | Changed request fields, applicable assignment fields, currency/units and updated_at |
| crm.eto_detail_changes | INSERT (when fields change) | section, changed_by_id, simulated_role, changes JSON |

API / trigger: PATCH /api/eto-requests/:id

Behavior: The existing Request Details form is not editable merely because someone created/owns the request. Budget values, currency and force/displacement units are validated separately. An edit does not itself advance the workflow.

### 08. Submit draft to ART
Who: Sales, ART or SuperUser

Reads: crm.eto_requests, crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE | stage, first assigned eto_number, assignment/workflow fields, updated_at |
| crm.eto_stage_transitions | INSERT | from_stage, to_stage, decision=submit, actor_id, reason |

API / trigger: POST /api/eto-requests/:id/transitions

Behavior: A successful first submission assigns the annual ETO number under the allocator lock and enters art-review. Existing assigned numbers remain unchanged on later returns/resubmissions. A serial numeric request id is different from the displayed ETO number.

### 09. ART accepts, returns or declines the initial review
Who: ART or SuperUser

Reads: crm.eto_requests, crm.eto_users, crm.eto_review_assignment_defaults

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE | stage, assignee_id, production_assignee_id, review flags/durations, acceptance date, due date, reason as applicable |
| crm.eto_stage_transitions | INSERT | Decision, previous/new stage, actor and selected review flags |

API / trigger: POST /api/eto-requests/:id/transitions

Behavior: approve-engineering routes to Engineering if included, otherwise Production if included, otherwise ART Final Review. return-draft routes back to Draft; decline ends as Declined. The first ART acceptance starts the due-date schedule; returns do not reset it. Reviewer defaults apply on stage entry while established assignments/sticky reviewers are preserved.

### 10. Save Engineering output without completing the stage
Who: Engineering, ART or SuperUser

Reads: crm.eto_requests, crm.eto_engineering_outputs, crm.eto_design_formula_settings

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_engineering_outputs | INSERT / UPDATE | estimated_design_hours, derived design estimates and formula snapshot, risk_score/risk_notes, guidance and notes |
| crm.eto_detail_changes | INSERT (changed existing fields) | Engineering edit history |

API / trigger: PUT /api/eto-requests/:id/engineering-output

Behavior: One output row is retained per request (unique eto_request_id). Saving output does not itself create a stage transition. Risk score is required for saves; High risk needs its explanation. Current estimated design hours do not erase legacy estimate fields. First output creation may have no field-change history entry; edits of existing output record actual differences.

### 11. Complete Engineering or return to ART
Who: Engineering or SuperUser

Reads: crm.eto_requests, crm.eto_users, crm.eto_engineering_outputs, crm.eto_design_formula_settings, crm.eto_review_assignment_defaults

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE | Next stage, assignment and updated_at |
| crm.eto_engineering_outputs | INSERT / UPDATE (completion) | Submitted Engineering values, risk and calculated snapshot |
| crm.eto_stage_transitions | INSERT | engineering-quote-ready or engineering-return-art |

API / trigger: POST /api/eto-requests/:id/transitions

Behavior: Completion goes to Production if that review is included, otherwise ART Final Review. Return goes to ART Review. Completion outputs and transition/request state are written in the transition transaction.

### 12. Save Production output without completing the stage
Who: Production, ART or SuperUser

Reads: crm.eto_requests, crm.eto_production_outputs, crm.eto_assembly_formula_settings

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_production_outputs | INSERT / UPDATE | procurement_cost/currency, procurement_lead_time, assembly_time_hours, derived assembly estimates, formula snapshot, risk and notes |
| crm.eto_detail_changes | INSERT (changed existing fields) | Production edit history |

API / trigger: PUT /api/eto-requests/:id/production-output

Behavior: One output per request. Procurement and assembly estimates use their dedicated fields/units; historic week-based estimates are retained. Risk score is required and High risk needs an explanation. Saving does not advance the stage.

### 13. Complete Production or return for review
Who: Production or SuperUser

Reads: crm.eto_requests, crm.eto_users, crm.eto_production_outputs, crm.eto_assembly_formula_settings, crm.eto_review_assignment_defaults

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE | Next stage, assignments and updated_at |
| crm.eto_production_outputs | INSERT / UPDATE (completion) | Submitted procurement/assembly values, risk and calculation snapshot |
| crm.eto_stage_transitions | INSERT | production-approve or production-return-engineering |

API / trigger: POST /api/eto-requests/:id/transitions

Behavior: Production approval enters ART Final Review. Return goes to Engineering when included, otherwise ART Review. Transition validation determines whether the action is legal from the current stage.

### 14. Save ART Final output
Who: ART or SuperUser

Reads: crm.eto_requests, crm.eto_art_final_outputs

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_art_final_outputs | INSERT / UPDATE | market_price, market_price_currency, market_leadtime, notes, updated_at |
| crm.eto_detail_changes | INSERT (changed existing fields) | ART Final edit history |

API / trigger: PUT /api/eto-requests/:id/art-final-output

Behavior: A saved ART Final output is separate from issuing the quote. Monetary values are whole-number amounts with a separate currency code.

### 15. Issue quote or return from ART Final Review
Who: ART or SuperUser

Reads: crm.eto_requests, crm.eto_users, crm.eto_art_final_outputs

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE | stage and workflow/assignment fields |
| crm.eto_art_final_outputs | INSERT / UPDATE (quote decision) | Final market price/currency, lead time and notes |
| crm.eto_stage_transitions | INSERT | art-final-quote or an allowed return/decline decision |

API / trigger: POST /api/eto-requests/:id/transitions

Behavior: art-final-quote moves to Quoted. Return paths depend on which reviews were included. Decline is also available from ART Final Review. Issuing a quote is a business-state change, not a deletion.

### 16. Mark quoted request Won/Lost or return to ART Final
Who: Sales, ART or SuperUser

Reads: crm.eto_requests, crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE | stage, related outcome/reason fields and updated_at |
| crm.eto_stage_transitions | INSERT | mark-won, mark-lost or quoted-return-art-final |

API / trigger: POST /api/eto-requests/:id/transitions

Behavior: Terminal Won/Lost records retain their outputs, attachments and audit trails. They are not physically deleted by these buttons.

### 17. Abandon a request or reopen an abandoned request
Who: ART or SuperUser

Reads: crm.eto_requests, crm.eto_stage_transitions, crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE | stage, abandon/restore workflow state, assignment and updated_at |
| crm.eto_stage_transitions | INSERT | mark-abandoned or reopen |

API / trigger: POST /api/eto-requests/:id/transitions

Behavior: These controls obey the state machine. Reopen is available from Abandoned, not as a universal reopen of Won/Lost/Declined. History is retained; no child records are deleted.

### 18. Split a request into related ETOs
Who: ART or SuperUser

Reads: crm.eto_requests, crm.eto_users, crm.eto_attachments

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE + INSERT | Parent has_split_children=true; child rows, parent_eto_request_id, split_sequence and child ETO references |
| crm.eto_attachments | INSERT | Copied-file metadata linked to each child |
| crm.eto_stage_transitions | INSERT | Split parent/child activity |

API / trigger: POST /api/eto-requests/:id/split

Behavior: Splitting is limited to eligible ART Review requests and cannot repeat an existing split. Current child references append a padded numeric suffix, e.g. parent-number-01. File objects are copied by the storage service and metadata is inserted; these are not file bytes inside PostgreSQL. Failed-copy cleanup is separate from database rollback.

### 19. Read discussion or add a comment
Who: Signed-in users

Reads: crm.eto_requests, crm.eto_comments, crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_comments | INSERT (add only) | eto_request_id, author_id, body, simulated_role, created_at |

API / trigger: GET /api/eto-requests/:id/comments; POST /api/eto-requests/:id/comments

Behavior: A comment adds a row and does not update workflow stage. No comment edit/delete endpoint is currently provided. Author attribution is linked to the authenticated user, including during role simulation.

### 20. Upload a request attachment
Who: Signed-in users

Reads: crm.eto_requests, crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_attachments | INSERT | eto_request_id, uploader_id, filename, storage_key, content_type, file_size |

API / trigger: POST /api/storage/uploads/request-url; POST /api/eto-requests/:id/attachments

Behavior: Upload URL issuance uses temporary server-side pending-upload state and object storage. The attachment registration endpoint verifies that the storage key belongs to that user/request before inserting metadata. Signing a URL is not an attachment INSERT. File bytes stay in object storage.

### 21. List, preview or download attachments
Who: Signed-in users; validated signed preview access where supported

Reads: crm.eto_requests, crm.eto_attachments, crm.eto_users

Writes: none for this business activity (normal authentication/expired-session handling still applies).

API / trigger: GET /api/eto-requests/:id/attachments; GET /api/eto-requests/:id/attachments/:attachmentId/download; GET /api/eto-requests/:id/attachments/:attachmentId/preview-link; GET /api/eto-requests/:id/attachments/:attachmentId/preview

Behavior: The table supplies metadata and storage references; the storage service supplies/streams bytes. A signed preview is an access check, not a new database file record. Opening/downloading a file does not delete or replace it.

### 22. Delete an attachment
Who: Its uploader, Admin or SuperUser

Reads: crm.eto_requests, crm.eto_attachments, crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_attachments | DELETE | The selected metadata row |

API / trigger: DELETE /api/eto-requests/:id/attachments/:attachmentId

Behavior: Metadata is unlinked first. The object is deleted only if no other attachment row references the same storage_key. Another active or archived reference must keep the blob available. Object-storage deletion and PostgreSQL deletion are distinct operations; storage errors can occur after metadata removal.

### 23. Read or save request Price Calculator
Who: Read: signed-in users. Save: ART or SuperUser during ART Final Review

Reads: crm.eto_requests, crm.eto_engineering_outputs, crm.eto_production_outputs, crm.eto_art_final_outputs, crm.eto_price_calculator, crm.eto_price_calculator_settings

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_price_calculator | INSERT / UPDATE | eto_request_id, contingency_percent, margin_percent, updated_at |
| crm.eto_detail_changes | INSERT (changed percentages) | ART Final calculator field changes |

API / trigger: GET /api/eto-requests/:id/price-calculator; PUT /api/eto-requests/:id/price-calculator

Behavior: The request-specific row uses eto_request_id as both primary key and request FK. Percentages are independently stored; calculations shown in the browser do not persist every intermediate total. If no row exists, the app reads global defaults, then built-in defaults. Values must be 0–100. Money is rounded to whole units and mixed currencies are not silently converted.

### 24. Set default reviewers
Who: Admin or SuperUser

Reads: crm.eto_users, crm.eto_review_assignment_defaults

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_review_assignment_defaults | INSERT / UPDATE | id=1, engineering_user_id, production_user_id, updated_at |

API / trigger: GET /api/users/review-defaults; PUT /api/users/review-defaults

Behavior: The selected accounts must have Engineering and Production roles respectively. Defaults influence future stage-entry assignment; changing them does not silently rewrite all existing request assignments.

### 25. Set design formula and read its history
Who: Admin or SuperUser

Reads: crm.eto_design_formula_settings, crm.eto_design_formula_changes

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_design_formula_settings | INSERT / UPDATE (changed inputs) | id=1, hourly_rate, hours_per_week, capacity_factor, updated_at |
| crm.eto_design_formula_changes | INSERT (changed inputs) | actor_user_id/name/email, previous/new inputs, changed_at |

API / trigger: GET /api/admin/design-formula; PUT /api/admin/design-formula; GET /api/admin/design-formula/history

Behavior: Actual changes save current inputs and one history record transactionally. Identical saves create no extra history. Request outputs store their own calculation snapshots; changing the global formula does not automatically rewrite every historical Engineering output.

### 26. Set assembly formula and read its history
Who: Admin or SuperUser

Reads: crm.eto_assembly_formula_settings, crm.eto_assembly_formula_changes

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_assembly_formula_settings | INSERT / UPDATE (changed inputs) | id=1, hourly_rate, hours_per_week, capacity_factor, updated_at |
| crm.eto_assembly_formula_changes | INSERT (changed inputs) | actor snapshots, previous/new inputs, changed_at |

API / trigger: GET /api/admin/assembly-formula; PUT /api/admin/assembly-formula; GET /api/admin/assembly-formula/history

Behavior: Same current-setting plus history pattern as the design formula. Identical saves create no duplicate history. Formula-history actor_user_id fields are logical references to users, not physical foreign-key constraints in the current schema.

### 27. Set global Price Calculator defaults
Who: Admin or SuperUser

Reads: crm.eto_price_calculator_settings

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_price_calculator_settings | INSERT / UPDATE | id=1, contingency_percent, margin_percent, updated_at |

API / trigger: GET /api/admin/price-calculator; PUT /api/admin/price-calculator

Behavior: Changes affect requests that have no saved request-specific percentages. They do not overwrite existing eto_price_calculator rows. There is no separate global price-default history table among the 18 tables.

### 28. List users or pre-create a user
Who: List: signed-in users. Create: Admin or SuperUser

Reads: crm.eto_users

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_users | INSERT (create) | name, email, role; auth link initially unclaimed |

API / trigger: GET /api/users; POST /api/users

Behavior: Admin > Users provides user management. A pre-created account can be linked at first Entra sign-in without discarding its assigned role. The operation creates an app user, not a Microsoft Entra directory account.

### 29. Change a user role
Who: Admin/SuperUser, with restricted first-user bootstrap logic

Reads: crm.eto_users, crm.eto_review_assignment_defaults

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_users | UPDATE | role and updated_at |

API / trigger: PATCH /api/users/:id/role

Behavior: The role-change handler locks the relevant user set and protects against self-lockout and demoting the last privileged account. A default reviewer cannot be changed to an incompatible role without resolving the default. Changing an application role does not alter the Microsoft Entra directory account.

### 30. Delete a user
Who: Admin or SuperUser

Reads: crm.eto_users, crm.eto_review_assignment_defaults

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_users | DELETE (only when allowed) | Selected user row |

API / trigger: DELETE /api/users/:id

Behavior: Self-delete, removal of the last privileged account and removal of configured default reviewers are blocked. Existing request/history/comment/file FK references may also block deletion with RESTRICT. This is not a cascade delete of that user’s ETO requests.

### 31. Simulate a business role
Who: Actual SuperUser

Reads: crm.eto_users

Writes: none for this business activity (normal authentication/expired-session handling still applies).

API / trigger: Role selector and x-eto-simulated-role on protected requests

Behavior: Simulation changes effective permissions, not the stored user role or identity. It does not UPDATE eto_users. Actions taken while simulating still make their normal business writes and capture simulated_role in the applicable audit/activity records.

### 32. Read workflow and edit audit history
Who: Signed-in users

Reads: crm.eto_stage_transitions, crm.eto_detail_changes, crm.eto_users

Writes: none for this business activity (normal authentication/expired-session handling still applies).

API / trigger: GET /api/eto-requests/:id/transitions; GET /api/eto-requests/:id/detail-changes

Behavior: History pages read existing events/field differences. There is no user-facing edit/delete history action. stage_transitions records stage decisions; detail_changes records field edits. They are not interchangeable.

### 33. Sign out
Who: Signed-in users

Reads: crm.eto_sessions

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_sessions | DELETE | Current session |

API / trigger: GET /api/logout; POST /api/mobile-auth/logout

Behavior: The browser cookie is cleared; web logout also uses the Entra end-session redirect. Sign-out does not delete the user account or any ETO data.

### 34. Index or extract searchable attachment text
Who: Background/server job, not a separate user form

Reads: crm.eto_attachments

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_attachments | UPDATE | search_text, search_status, search_error, search_attempts, search_indexed_at where applicable |

API / trigger: Attachment indexing worker / indexAttachments script

Behavior: The server retrieves file bytes, extracts text/OCR where supported and stores searchable text/state in the metadata row. No separate OCR table is part of the current 18-table design. A successful file upload and successful text indexing are distinct outcomes.

### 35. Send transition emails, reminders or an admin delivery test
Who: Transition handler/background job; delivery test: Admin or SuperUser

Reads: crm.eto_requests, crm.eto_users, crm.eto_stage_transitions

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_requests | UPDATE (successful reminder only) | last_reminded_at |

API / trigger: Transition notifications; Reminder script; POST /api/admin/email/test

Behavior: Transition emails are sent after the main workflow transaction. Reminder scheduling requires the job to run and the email provider to be configured; it is not guaranteed merely by publishing. A failed notification does not roll back an already committed transition. No delivery-log table currently exists. The admin delivery-test API does not itself write an ETO table.

### 36. One-time bootstrap, identity/role/submitter imports
Who: Controlled startup/admin tooling

Reads: crm.eto_users, crm.eto_requests, crm.eto_data_imports

| Table | Operation | Principal columns / effect |
| --- | --- | --- |
| crm.eto_users | UPDATE (applicable import) | Verified role/identity records |
| crm.eto_requests | UPDATE (applicable submitter import) | submitted_by_id |
| crm.eto_data_imports | INSERT | id marker, matched_users, applied_at |

API / trigger: POST /api/users/sync; POST /api/users/bootstrap-admin; Startup one-time import helpers

Behavior: These are not ordinary CRUD forms run on every click. Markers prevent repeated one-time jobs. Preserve verified identities and roles. Do not manually rerun bootstrap/imports as a normal production troubleshooting step.

### 37. Check service and Azure connection health
Who: Operational health check

Reads: Connection metadata or no app-table read for this specific step.

Writes: none for this business activity (normal authentication/expired-session handling still applies).

API / trigger: GET /api/healthz; GET /api/healthz/azure-crm

Behavior: Azure health queries connection metadata; startup also verifies the target database and CRUD privileges on all app tables. Health checks do not create/rename tables or expose credentials.

## Table directory
| Azure table | Columns | Purpose |
| --- | --- | --- |
| crm.eto_art_final_outputs | 8 | Final market price, currency, lead time and ART notes. |
| crm.eto_assembly_formula_changes | 11 | Assembly-formula change history with actor snapshots and previous/new inputs. |
| crm.eto_assembly_formula_settings | 5 | Current assembly hourly rate, hours/week and capacity factor. |
| crm.eto_attachments | 14 | File metadata, storage reference, uploader and extraction/search state. Not the file bytes. |
| crm.eto_comments | 6 | Discussion messages and author attribution. |
| crm.eto_data_imports | 3 | One-time initialization/import markers and matched-user counts. |
| crm.eto_design_formula_changes | 11 | Design-formula change history with actor snapshots and previous/new inputs. |
| crm.eto_design_formula_settings | 5 | Current design hourly rate, hours/week and capacity factor. |
| crm.eto_detail_changes | 7 | Field-level audit records for request details, review output edits and calculator changes. |
| crm.eto_engineering_outputs | 17 | Engineering estimates, saved design-formula inputs, design hours, risk and notes. |
| crm.eto_price_calculator | 4 | Per-request contingency and margin percentages. |
| crm.eto_price_calculator_settings | 4 | Global default contingency and margin percentages. |
| crm.eto_production_outputs | 19 | Procurement/assembly estimates, saved assembly-formula inputs, risk and notes. |
| crm.eto_requests | 42 | Core request, current stage, assignments, numbering, split family, review selections, durations and due date. |
| crm.eto_review_assignment_defaults | 4 | Default Engineering and Production reviewers. |
| crm.eto_sessions | 3 | Server-side sign-in sessions and expiry. |
| crm.eto_stage_transitions | 11 | Append-only workflow activity: actor, decision, previous/new stage and reason. |
| crm.eto_users | 7 | User identity, email, application role and Microsoft Entra account link. |

## Schema appendix — verified Azure structures
All tables below belong to database d365crm, schema crm. Required means PostgreSQL NOT NULL, not the full set of application/form requirements. SQL defaults do not mean that a table already contains a settings row. Sequence defaults generate numeric IDs; displayed ETO references use separate allocation logic. FK definitions are schema-qualified below for readability.

### crm.eto_art_final_outputs
Final market price, currency, lead time and ART notes.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| eto_request_id | integer | Yes | None |
| market_price | text | No | None |
| market_leadtime | text | No | None |
| notes | text | No | None |
| created_at | timestamp with time zone | Yes | now() |
| updated_at | timestamp with time zone | Yes | now() |
| market_price_currency | text | Yes | 'USD'::text |

FOREIGN KEY (eto_request_id) REFERENCES crm.eto_requests(id) ON DELETE CASCADE

PRIMARY KEY (id)

UNIQUE (eto_request_id)

### crm.eto_assembly_formula_changes
Assembly-formula change history with actor snapshots and previous/new inputs.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| actor_user_id | integer | Yes | None |
| actor_name | text | Yes | None |
| actor_email | text | Yes | None |
| changed_at | timestamp with time zone | Yes | now() |
| previous_hourly_rate | text | Yes | None |
| previous_hours_per_week | text | Yes | None |
| previous_capacity_factor | text | Yes | None |
| new_hourly_rate | text | Yes | None |
| new_hours_per_week | text | Yes | None |
| new_capacity_factor | text | Yes | None |

PRIMARY KEY (id)

Logical relationship: actor_user_id identifies crm.eto_users.id, but no physical user foreign-key constraint exists on this history table. Actor name/email snapshots are stored.

### crm.eto_assembly_formula_settings
Current assembly hourly rate, hours/week and capacity factor.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | None |
| hourly_rate | text | Yes | None |
| hours_per_week | text | Yes | None |
| capacity_factor | text | Yes | None |
| updated_at | timestamp with time zone | Yes | now() |

PRIMARY KEY (id)

### crm.eto_attachments
File metadata, storage reference, uploader and extraction/search state. Not the file bytes.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| eto_request_id | integer | Yes | None |
| uploader_id | integer | Yes | None |
| filename | text | Yes | None |
| storage_key | text | Yes | None |
| content_type | text | No | None |
| file_size | bigint | No | None |
| created_at | timestamp with time zone | Yes | now() |
| search_text | text | No | None |
| search_status | text | Yes | 'pending'::text |
| search_error | text | No | None |
| search_attempts | integer | Yes | 0 |
| search_processed_at | timestamp with time zone | No | None |
| search_lease_token | text | No | None |

FOREIGN KEY (uploader_id) REFERENCES crm.eto_users(id) ON DELETE RESTRICT

FOREIGN KEY (eto_request_id) REFERENCES crm.eto_requests(id) ON DELETE CASCADE

PRIMARY KEY (id)

### crm.eto_comments
Discussion messages and author attribution.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| eto_request_id | integer | Yes | None |
| author_id | integer | Yes | None |
| body | text | Yes | None |
| created_at | timestamp with time zone | Yes | now() |
| simulated_role | text | No | None |

FOREIGN KEY (eto_request_id) REFERENCES crm.eto_requests(id) ON DELETE CASCADE

FOREIGN KEY (author_id) REFERENCES crm.eto_users(id) ON DELETE RESTRICT

PRIMARY KEY (id)

### crm.eto_data_imports
One-time initialization/import markers and matched-user counts.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | text | Yes | None |
| matched_users | integer | Yes | 0 |
| applied_at | timestamp with time zone | Yes | now() |

PRIMARY KEY (id)

### crm.eto_design_formula_changes
Design-formula change history with actor snapshots and previous/new inputs.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| actor_user_id | integer | Yes | None |
| actor_name | text | Yes | None |
| actor_email | text | Yes | None |
| changed_at | timestamp with time zone | Yes | now() |
| previous_hourly_rate | text | Yes | None |
| previous_hours_per_week | text | Yes | None |
| previous_capacity_factor | text | Yes | None |
| new_hourly_rate | text | Yes | None |
| new_hours_per_week | text | Yes | None |
| new_capacity_factor | text | Yes | None |

PRIMARY KEY (id)

Logical relationship: actor_user_id identifies crm.eto_users.id, but no physical user foreign-key constraint exists on this history table. Actor name/email snapshots are stored.

### crm.eto_design_formula_settings
Current design hourly rate, hours/week and capacity factor.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | None |
| hourly_rate | text | Yes | None |
| hours_per_week | text | Yes | None |
| capacity_factor | text | Yes | None |
| updated_at | timestamp with time zone | Yes | now() |

PRIMARY KEY (id)

### crm.eto_detail_changes
Field-level audit records for request details, review output edits and calculator changes.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| eto_request_id | integer | Yes | None |
| section | text | Yes | None |
| changed_by_id | integer | Yes | None |
| changed_at | timestamp with time zone | Yes | now() |
| changes | jsonb | Yes | None |
| simulated_role | text | No | None |

FOREIGN KEY (changed_by_id) REFERENCES crm.eto_users(id) ON DELETE RESTRICT

FOREIGN KEY (eto_request_id) REFERENCES crm.eto_requests(id) ON DELETE CASCADE

PRIMARY KEY (id)

### crm.eto_engineering_outputs
Engineering estimates, saved design-formula inputs, design hours, risk and notes.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| eto_request_id | integer | Yes | None |
| cost_estimate | text | No | None |
| doc_leadtime | text | No | None |
| pn_guidance | text | No | None |
| notes | text | No | None |
| created_at | timestamp with time zone | Yes | now() |
| updated_at | timestamp with time zone | Yes | now() |
| cost_estimate_currency | text | Yes | 'USD'::text |
| estimated_design_hours | text | No | None |
| design_cost | text | No | None |
| design_lead_time_weeks | text | No | None |
| design_hourly_rate | text | No | None |
| design_hours_per_week | text | No | None |
| design_capacity_factor | text | No | None |
| risk_score | text | No | None |
| risk_notes | text | No | None |

FOREIGN KEY (eto_request_id) REFERENCES crm.eto_requests(id) ON DELETE CASCADE

PRIMARY KEY (id)

UNIQUE (eto_request_id)

### crm.eto_price_calculator
Per-request contingency and margin percentages.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| eto_request_id | integer | Yes | None |
| contingency_percent | text | Yes | None |
| margin_percent | text | Yes | None |
| updated_at | timestamp with time zone | Yes | now() |

FOREIGN KEY (eto_request_id) REFERENCES crm.eto_requests(id) ON DELETE CASCADE

PRIMARY KEY (eto_request_id)

### crm.eto_price_calculator_settings
Global default contingency and margin percentages.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | None |
| contingency_percent | text | Yes | None |
| margin_percent | text | Yes | None |
| updated_at | timestamp with time zone | Yes | now() |

PRIMARY KEY (id)

### crm.eto_production_outputs
Procurement/assembly estimates, saved assembly-formula inputs, risk and notes.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| eto_request_id | integer | Yes | None |
| mfg_leadtime | text | No | None |
| prod_leadtime | text | No | None |
| notes | text | No | None |
| created_at | timestamp with time zone | Yes | now() |
| updated_at | timestamp with time zone | Yes | now() |
| procurement_cost | text | No | None |
| procurement_cost_currency | text | Yes | 'USD'::text |
| procurement_lead_time | text | No | None |
| assembly_time_hours | text | No | None |
| assembly_cost | text | No | None |
| assembly_cost_currency | text | Yes | 'USD'::text |
| assembly_lead_time_weeks | text | No | None |
| assembly_hourly_rate | text | No | None |
| assembly_hours_per_week | text | No | None |
| assembly_capacity_factor | text | No | None |
| risk_score | text | No | None |
| risk_notes | text | No | None |

FOREIGN KEY (eto_request_id) REFERENCES crm.eto_requests(id) ON DELETE CASCADE

PRIMARY KEY (id)

UNIQUE (eto_request_id)

### crm.eto_requests
Core request, current stage, assignments, numbering, split family, review selections, durations and due date.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| eto_number | text | No | None |
| customer_name | text | Yes | None |
| quote_number | text | Yes | None |
| quote_revision | text | Yes | ''::text |
| test_type | text | Yes | ''::text |
| materials | text | Yes | None |
| specimen_dimensions | text | Yes | None |
| relevant_standards | text | No | None |
| customer_components | text | No | None |
| custom_details | text | No | None |
| stage | text | Yes | 'draft'::text |
| assignee_id | integer | No | None |
| sticky_engineer_user_id | integer | No | None |
| submitted_by_id | integer | Yes | None |
| decline_reason | text | No | None |
| created_at | timestamp with time zone | Yes | now() |
| updated_at | timestamp with time zone | Yes | now() |
| last_reminded_at | timestamp with time zone | No | None |
| distributor | text | No | None |
| request_type | text | No | None |
| machine_type | text | No | None |
| expected_force_range | text | No | None |
| expected_displacement | text | No | None |
| results_required | text | No | None |
| budget_range | text | No | None |
| acceptable_lead_time | text | No | None |
| similar_parts | text | No | None |
| budget_currency | text | Yes | 'USD'::text |
| parent_eto_request_id | integer | No | None |
| split_sequence | integer | No | None |
| has_split_children | boolean | Yes | false |
| expected_force_unit | text | Yes | 'N'::text |
| expected_displacement_unit | text | Yes | 'mm'::text |
| include_engineering_review | boolean | Yes | true |
| include_production_review | boolean | Yes | true |
| production_assignee_id | integer | No | None |
| engineering_review_duration_weeks | double precision | No | None |
| production_review_duration_weeks | double precision | No | None |
| art_final_review_duration_weeks | double precision | No | None |
| art_review_accepted_date | date | No | None |
| due_date | date | No | None |

FOREIGN KEY (parent_eto_request_id) REFERENCES crm.eto_requests(id) ON DELETE RESTRICT

FOREIGN KEY (submitted_by_id) REFERENCES crm.eto_users(id) ON DELETE RESTRICT

FOREIGN KEY (sticky_engineer_user_id) REFERENCES crm.eto_users(id) ON DELETE SET NULL

FOREIGN KEY (production_assignee_id) REFERENCES crm.eto_users(id) ON DELETE SET NULL

FOREIGN KEY (assignee_id) REFERENCES crm.eto_users(id) ON DELETE SET NULL

PRIMARY KEY (id)

UNIQUE (eto_number)

Workflow stage and role/decision rules are enforced by the application. Split-family uniqueness also uses an index; this appendix lists column definitions and SQL constraints, not every performance index.

### crm.eto_review_assignment_defaults
Default Engineering and Production reviewers.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | None |
| engineering_user_id | integer | Yes | None |
| production_user_id | integer | Yes | None |
| updated_at | timestamp with time zone | Yes | now() |

FOREIGN KEY (engineering_user_id) REFERENCES crm.eto_users(id) ON DELETE RESTRICT

FOREIGN KEY (production_user_id) REFERENCES crm.eto_users(id) ON DELETE RESTRICT

PRIMARY KEY (id)

### crm.eto_sessions
Server-side sign-in sessions and expiry.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| sid | character varying | Yes | None |
| sess | jsonb | Yes | None |
| expire | timestamp without time zone | Yes | None |

PRIMARY KEY (sid)

### crm.eto_stage_transitions
Append-only workflow activity: actor, decision, previous/new stage and reason.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| eto_request_id | integer | Yes | None |
| actor_id | integer | Yes | None |
| from_stage | text | Yes | None |
| to_stage | text | Yes | None |
| decision | text | Yes | None |
| reason | text | No | None |
| created_at | timestamp with time zone | Yes | now() |
| simulated_role | text | No | None |
| include_engineering_review | boolean | No | None |
| include_production_review | boolean | No | None |

FOREIGN KEY (actor_id) REFERENCES crm.eto_users(id) ON DELETE RESTRICT

FOREIGN KEY (eto_request_id) REFERENCES crm.eto_requests(id) ON DELETE CASCADE

PRIMARY KEY (id)

### crm.eto_users
User identity, email, application role and Microsoft Entra account link.

| Column | PostgreSQL type | NOT NULL | Default |
| --- | --- | --- | --- |
| id | integer | Yes | Auto-generated sequence |
| clerk_id | text | No | None |
| name | text | Yes | None |
| email | text | Yes | None |
| role | text | Yes | 'sales'::text |
| created_at | timestamp with time zone | Yes | now() |
| updated_at | timestamp with time zone | Yes | now() |

PRIMARY KEY (id)

UNIQUE (clerk_id)

## Document verification
Inventory cross-check: 18 tables, 181 columns, 19 physical FKs and 42 SQL constraints. The 37 activities were mapped from current route/workflow/UI code. This document does not claim that all production write journeys were exercised during preparation.
