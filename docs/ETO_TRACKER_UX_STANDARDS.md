# ETO Tracker UX Standards Discovery

**Refreshed:** November 2026
**Purpose:** Current implementation inventory and reusable-pattern candidates.
This is not an approved cross-application design system or an accessibility
certification. Evidence references use component paths, not brittle line numbers.

## Classification

- **Implemented:** Observable behavior in the active app code.
- **Candidate:** A pattern worth standardizing after review.
- **ETO-specific:** Domain behavior, not a generic reusable standard.
- **Gap:** Inconsistent or unverified behavior; not a convention to copy.

## 1. Shell, identity and access

The desktop shell uses a navy sidebar, light content surfaces, icon+text
navigation and a visible identity/role area. Navigation includes Dashboard,
ETO Requests and Workflow, plus New Request/Admin where allowed.

Microsoft sign-in authenticates identity; the external Admin Console authorizes
app admission. ETO roles govern business access separately. A Console-approved
user with role None gets an access-pending state instead of ETO content.
User-facing authentication errors must never expose keys, tokens or provider
payloads.

SuperUser simulation shows effective-role context and an exit control. It must
not imply that actor identity or the stored role has changed.

**Evidence:** App.tsx, components/AppLayout.tsx,
API routes/auth.ts and middlewares/requireAuth.ts.
**Assessment:** Identity placement is a candidate; roles and access-pending
semantics are ETO-specific. No continuous-access-revalidation guarantee is implied.

## 2. Screen organization

| Area | Current interaction |
|---|---|
| Dashboard | Metric cards, stage/outcome breakdowns and personal queue |
| ETO Requests | Search and filters over a paginated, dense grid |
| New Request | Grouped intake fields, validation feedback and optional files |
| Request detail | Information/output cards with role/stage-specific workflow actions |
| Audit Trail | Stage, Details and Email tabs |
| Admin | Users, Assignment Defaults, Email Notifications, Design Formula, Assembly Formula, Price Calculator |

Card grouping, headings and responsive content grids are reusable candidates.
ETO stage vocabulary, metrics and department controls are domain-specific.
Dense tables/diagrams need overflow handling. Sidebar collapse and phone
usability must not be claimed as fully verified without viewport testing.

**Evidence:** pages/Dashboard.tsx, EtoList.tsx, NewEtoRequest.tsx, EtoDetail.tsx,
Admin.tsx, WorkflowDiagram.tsx.

## 3. Typography and color

Inter is the app sans-serif. The effective visual language uses navy
(`#1E3A5F`), slate neutrals, light cards, amber navigation emphasis and
stage/status colors. Labels and metadata use smaller text than page headings.

The CSS still contains unresolved semantic values such as `red` placeholders.
Direct page styles and semantic primitives coexist. Do not adopt unresolved
values as brand tokens, claim a finished dark theme, or infer contrast
compliance from screenshots.

**Candidate:** A replaceable palette, consistent font scale, focus treatment,
surface/border tokens and spacing vocabulary.
**Gap:** Resolve and measure tokens before adopting them across applications.
**Evidence:** src/index.css and components/ui/button.tsx.

## 4. Forms and validation

- Required inputs need a **red asterisk**, including conditional requirements.
- Show useful validation near the field and reject invalid writes server-side.
- Keep labels separate from optional helper text; avoid placeholders that
  repeat the label or are mistaken for entered content.
- Monetary values use a currency symbol and no decimal places. Reject a
  decimal-entry attempt rather than deleting its separator and changing value.
- Keep currencies and measurement units separate from entered amount/range text.
- Do not silently replace missing historical values with Low risk or zero.

ETO-specific changes:

| Form | Current requirement |
|---|---|
| New Request | System Type includes Other; structured budget/currency and force/displacement units |
| ART Review | Entity TOUS/TOUK is first; include/skip Engineering and Production independently |
| Engineering | Positive design hours, P/N guidance and required risk; High risk requires notes |
| Production | Procurement cost/weeks, assembly hours and required risk; High risk requires notes |
| Generate Quote | Market Price, Market Lead Time and required nonblank Description; Notes separate |

Description is placed after lead time and before parts guidance. It has no
“Describe the part being quoted” placeholder.

**Evidence:** pages/NewEtoRequest.tsx, EtoDetail.tsx; API routes/outputs.ts,
transitions.ts; lib/money.ts, review-risk.ts and quote-description.ts.

## 5. Workflow actions and reassignment

Completion is the primary action; Re-Assign is between Complete Review and
Back during Engineering/Production Review. The reassignment dialog explains
that stage and saved work remain unchanged, requires a department user, and
provides Cancel/Save Assignment.

Backward decisions and destructive lifecycle choices request a reason where
required. Reassignment must not look like a completed stage or reset progress.
Entity defaults live in their own Admin tab, not the Users tab.

Use explicit opaque popup surfaces and readable foregrounds. Backdrop tint
must not darken the dialog content itself. Verify actual computed portal
colors because unresolved semantic variables can make popovers transparent.

**Evidence:** pages/EtoDetail.tsx and Admin.tsx; assignment components;
API routes/eto-requests.ts.

## 6. Calculator presentation

Show Design, Procurement and Assembly costs with their recorded currencies,
then Contingency, additive Margin and Sales Price. Saved per-request
percentages are not overwritten when Admin changes defaults.

Show **Calculated Lead Time below price calculation**, with Design,
Procurement and Assembly week estimates and their total. Generate Quote starts
with whole-week ceiling(total), while ART's manual quote overrides remain
independent. Show missing-input states explicitly, not as a fabricated zero.

Show Engineering/Production risks independently and High-risk explanations.
Multi-Currency is a conspicuous calculated label, not a stored ISO currency
or evidence of FX conversion.

**Evidence:** calculator components, pages/EtoDetail.tsx; API
lib/price-calculator.ts, design-formula.ts and assembly-formula.ts.

## 7. Grid, filters and search

The Requests grid includes **Assignee** as well as stage, inactivity-overdue,
search and split-family controls. Preserve family context and provide clear
ways to remove filters. Search includes related business/audit/extracted text;
it is not a global omnibox or AI similarity search.

**Candidate:** Grouped filters, obvious selected state, loading/empty/error
treatment, accessible navigation to details.
**Gap:** Keyboard-safe row navigation and consistent shareable URL state
across every filter require review; do not claim them as completed standards.
**Evidence:** pages/EtoList.tsx and Dashboard.tsx.

## 8. Notifications and audit feedback

Admin → Email Notifications offers an individual switch for each of ten
notification types plus **Set all to yes / Set all to no**. New types start
off. Bulk changes must not leave a partially applied persisted result.

Audit Trail → Email shows one originating event with all recipients, not a
separate event per person. Multiple underlying messages can appear inside it.
Loading, empty, failure, Refresh and polling behavior keep status understandable.

Use **Accepted by Graph**, not “Delivered,” when only Graph acceptance is
known. Keep pending/unconfirmed, partial, failed and skipped distinguishable.
Historical failed entries stay historical; enabling a switch does not backfill.

**Evidence:** components/EmailAuditTrail.tsx, Admin notification components;
API lib/notification-settings.ts and email-delivery-history.ts.

## 9. Attachments and sensitive actions

File actions are authorized; safe previews use an inline same-origin endpoint.
Deletion needs an explicit destructive confirmation where provided. The server
allowlist and size/count limits are authoritative; never advertise unrestricted
uploads unless the UI matches actual limits.

Do not treat attachment extraction/OCR as a promise to preview every format.
Some legacy/archived formats may be accepted without searchable extraction.
**Evidence:** attachment components and API routes/attachments.ts, storage.ts.

## 10. Accessibility and reusable inventory

Existing candidates include native controls, visible labels, shared Button,
Card, Input, Textarea, Label, Select, AlertDialog, Tabs, Skeleton and Tooltip
primitives. StagePill, StageProgressBar and SplitFamilyBadge remain ETO-specific.
Unused scaffold components do not establish an implemented UX pattern.

Items needing a separate measured review:

- Keyboard access to clickable rows and all custom overlay controls.
- Dialog role, focus trapping, Escape/return-focus behavior for each overlay.
- Labels and accessible names on icon-only actions.
- Contrast and focus visibility after resolving theme tokens.
- Screen-reader announcement of validation, async outcomes and selected tabs.
- Narrow-screen navigation, overflow and reduced-motion behavior.
- Consistent error/retry states and feedback systems across Admin and detail.

These are review gaps, not proven failures for every screen and not approved
patterns to copy. This documentation refresh did not redesign or accessibility-
test the application.

## 11. Consolidation boundary

Reusable candidates concern structure, labels, actions, feedback and accessible
interaction. ETO-specific stage order, risks, numbering, TOUS/TOUK, quote
calculations, deadlines, roles and notification recipients remain product rules.
Approve shared standards only after comparing other applications and resolving
the implementation gaps above.
