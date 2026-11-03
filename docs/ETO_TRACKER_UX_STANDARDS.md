# ETO Tracker UX Standards Discovery

**Status:** Discovery record; not an approved enterprise standard  
**Scope:** Current ETO Tracker React/TypeScript frontend in `artifacts/eto-tracker`  
**Purpose:** Capture implemented UX decisions for comparison with other applications and eventual consolidation into a shared TypeScript UX foundation. This document does **not** redesign the app or prescribe that its business workflow be copied elsewhere.

## How to use this document

The evidence below describes **code that is actually used by the app**, not everything available in its UI scaffold. File references are relative to `artifacts/eto-tracker/src/` unless otherwise stated. Tailwind colors are reported by their actual class names; a hex value is used only where the source defines one. Implementation evidence is not automatically an endorsement.

| Classification | Meaning |
| --- | --- |
| **STANDARD** | Repeated, implemented convention worth retaining as a cross-app baseline, subject to enterprise approval. |
| **CANDIDATE STANDARD** | Intentional, reusable behavior that needs review or consolidation. |
| **APPLICATION-SPECIFIC** | ETO business process or branding choice; do not promote unchanged to an enterprise rule. |
| **INCONSISTENT** | More than one implementation for the same UX concern. |
| **UNKNOWN** | Insufficient implemented evidence to establish a convention. |

## 1. Application shell

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| App frame | Full-height flex layout with fixed `w-64` (256px) navy sidebar, scrolling slate main area; no implemented mobile sidebar. | `components/AppLayout.tsx:55-59,127-153` | CANDIDATE STANDARD for shell structure; INCONSISTENT with responsive pages |
| Identity and title | Light logo plus “ETO Tracker” in sidebar; signed-in user's name/email and role at bottom. Separate logo/title on signed-out landing. | `components/AppLayout.tsx:60-65,112-125`; `App.tsx:53-69` | CANDIDATE STANDARD for identity placement; APPLICATION-SPECIFIC branding |
| Global navigation | Dashboard, ETO Requests, Workflow; New Request and Admin shown by role. Icon and text on each item; active item gets amber-tinted highlight. | `components/AppLayout.tsx:9-39,66-85` | CANDIDATE STANDARD for icon+label/active feedback; APPLICATION-SPECIFIC routes/roles |
| Access context | Sidebar user role; SuperUser role simulation has selector, sticky amber notice, and exit control. | `components/AppLayout.tsx:89-150` | APPLICATION-SPECIFIC permission-preview behavior |
| Breadcrumbs / global search / help / settings / notification center | Not implemented in the active shell. List-page search is not global search. Scaffolded `ui/breadcrumb.tsx` alone is not evidence of usage. | `components/AppLayout.tsx:55-155`; `pages/EtoList.tsx:143-153` | UNKNOWN |
| Authenticated routing | Sign-in and loading screens gate authenticated pages; unknown route has not-found page. | `App.tsx:19-87,107-145` | CANDIDATE STANDARD |

## 2. Layout

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Page spacing | Common `p-6 space-y-6` on Dashboard/List; cards divide related information. No global content max-width established. | `pages/Dashboard.tsx:43-44,117-118`; `pages/EtoList.tsx:118-120` | CANDIDATE STANDARD |
| Responsive content | Dashboard metrics: two columns, six at `lg`; analytics: one/two at `lg`. New Request and Detail stack some grids at `md`, `sm`, or `lg`. | `pages/Dashboard.tsx:69,146`; `pages/NewEtoRequest.tsx:273,328,382,503`; `pages/EtoDetail.tsx:273-275` | CANDIDATE STANDARD |
| Dense data | Tables keep columns with horizontal scroll on list/dashboard; diagram has `minWidth:800` and scroll. Shell sidebar itself does not collapse. | `pages/EtoList.tsx:254`; `pages/Dashboard.tsx:260`; `pages/WorkflowDiagram.tsx:218-318`; `components/AppLayout.tsx:59` | CANDIDATE STANDARD for overflow; INCONSISTENT at shell |
| Card composition | White bordered Card/Header/Content segments for KPI, analytics and detail information. | `pages/Dashboard.tsx:117-313,318-346`; `components/ui/card.tsx` | CANDIDATE STANDARD |

## 3. Typography

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Font | Inter, loaded at weights 400–700; CSS maps `--app-font-sans` to Inter. Georgia and Menlo exist as fallback families, not demonstrated as a page typography system. | `artifacts/eto-tracker/index.html:16-18`; `index.css:60-62,144-147` | CANDIDATE STANDARD |
| Headings | Main Dashboard/List headings `text-2xl font-bold`; card headings `text-base font-semibold`; Admin modal title `text-lg font-semibold`. | `pages/Dashboard.tsx:48,120`; `pages/EtoList.tsx:123`; `pages/Admin.tsx:76` | CANDIDATE STANDARD; not a formal heading scale |
| Body and metadata | Most labels/body/table text use `text-sm`; secondary context uses `text-slate-500`/`600`; pills/errors use `text-xs`. Explicit line-height scale is not centralized. | `pages/EtoList.tsx:124-125,254-353`; `components/StagePill.tsx:38`; `pages/NewEtoRequest.tsx:80-83` | CANDIDATE STANDARD |

## 4. Color

The implemented app is a **navy/slate light UI**, not the dark-green visual concept previously explored in the isolated mockup sandbox. Do not treat mockups as evidence of the current app.

| Role | Observed implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Brand/navigation/action | `#1E3A5F` navy; action hover `#162d4a`. Active nav uses `#E8A020` at 20% opacity with amber text. | `components/AppLayout.tsx:59,76-80`; `pages/EtoList.tsx:132-139`; `App.tsx:26-30` | APPLICATION-SPECIFIC palette; CANDIDATE STANDARD for hierarchy |
| Background/surface/text | `bg-slate-50` page; `bg-white` cards; slate-900 headings; slate-500/600 metadata; slate-200 borders common. | `components/AppLayout.tsx:129`; `pages/Dashboard.tsx:48-49`; `pages/Admin.tsx:68-70` | CANDIDATE STANDARD |
| Success/warning/error/info | Emerald/green for Won/Quoted; amber for Production Review; red for Declined/Overdue; blue/cyan/purple for intermediate stage identity. Semantic use is partly domain-specific. | `components/StagePill.tsx:1-26`; `pages/EtoList.tsx:176-210`; `pages/Dashboard.tsx:73-113` | CANDIDATE STANDARD for semantic grouping; APPLICATION-SPECIFIC stage palette |
| Disabled/selected/hover | Buttons use `disabled:opacity-50` and no pointer events; nav selected background; direct navy hover classes and token-based elevation coexist. | `components/ui/button.tsx:6-40`; `components/AppLayout.tsx:76-80`; `pages/Admin.tsx:134-139` | INCONSISTENT |
| Semantic theme variables | `index.css` defines `--color-*` mappings, but many underlying light **and** dark values are literal `red` placeholders. Do **not** use these as corporate color values. | `index.css:8-68,70-146,221-289` | INCONSISTENT / not an established palette |

## 5. Buttons and actions

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Shared Button | `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`; `default`, `sm`, `lg`, `icon` sizes; keyboard focus ring and disabled behavior. Actual color of token-based variants requires the unresolved theme to be fixed. | `components/ui/button.tsx:6-59` | CANDIDATE STANDARD |
| Primary action | New Request, Submit, Add User: prominent filled navy; usually next to page heading or at end of form. Some pages override shared Button, others use raw `<button>`. | `pages/EtoList.tsx:120-140`; `pages/NewEtoRequest.tsx:622-640`; `pages/Admin.tsx:126-141` | INCONSISTENT implementation; CANDIDATE STANDARD hierarchy |
| Secondary / destructive | Cancel or filters use outline/neutral treatment; Remove uses red plus confirmation. Some stage-changing actions act immediately. | `pages/Admin.tsx:126-179`; `pages/EtoList.tsx:176-210`; `pages/EtoDetail.tsx:763-779,985-1005,1636-1697` | CANDIDATE STANDARD for cancel/destructive; INCONSISTENT confirmation |
| Busy/disabled | Pending mutation disables submit, sometimes shows spinner and verb ending in ellipsis (“Submitting…”, “Removing…”). | `pages/NewEtoRequest.tsx:622-640`; `pages/Admin.tsx:126-140,164-175` | CANDIDATE STANDARD |
| Icon-only action | Used for refresh, attachment operations and delete; accessible labels vary between `aria-label` and only `title`. | `pages/Admin.tsx:271-279,347-355`; `pages/EtoDetail.tsx:720-778` | INCONSISTENT |

## 6. Forms and data entry

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Structured form | New Request uses React Hook Form + Zod, labeled fields in sections, responsive one/two-column grids, and errors directly below fields. | `pages/NewEtoRequest.tsx:47-83,264-643` | CANDIDATE STANDARD for field/error placement; APPLICATION-SPECIFIC fields |
| Required / optional | Requiredness comes from schema and on-submit validation; optional inputs are not a globally standardized visual convention. | `pages/NewEtoRequest.tsx:49-68,273-315` | UNKNOWN as an enterprise marking rule |
| Selection and units | Shared Select for list filtering and some forms; native select for Admin; domain-specific force/displacement and currency selectors. | `pages/EtoList.tsx:154-170`; `pages/Admin.tsx:114-124`; `pages/NewEtoRequest.tsx:382-431` | INCONSISTENT control styling; APPLICATION-SPECIFIC units |
| Save/cancel and unsaved changes | Buttons disable while submitting; detail inline edits have Save/Cancel. No global unsaved-changes prompt or autosave convention established. | `pages/NewEtoRequest.tsx:622-640`; `pages/EtoDetail.tsx:1718-1816` | CANDIDATE STANDARD for explicit save; UNKNOWN for unsaved-change policy |
| Upload | New Request supports keyboard/click/drop and queued removable files; detail uploader has count/size limits. New Request says “Any file type” and only surfaces upload rejection later. | `pages/NewEtoRequest.tsx:565-618`; `pages/EtoDetail.tsx:422-504` | INCONSISTENT; do not reuse the current allowlist copy |

## 7. Tables and data grids

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Data table | Native `<table>` with `text-sm`, padded cells, muted header, bordered/hovered rows; implemented separately in Dashboard, List, Admin and workflow reference. `ui/table.tsx` is available but not the shared implementation. | `pages/Dashboard.tsx:260-311`; `pages/EtoList.tsx:254-353`; `pages/Admin.tsx:290-370` | CANDIDATE STANDARD for anatomy; INCONSISTENT reuse |
| Navigation | Dashboard ETO number is a link; List row clicks navigate to detail. List row is not a keyboard-activatable control. | `pages/Dashboard.tsx:277-305`; `pages/EtoList.tsx:269-276` | INCONSISTENT / accessibility gap |
| Sorting / selection / expansion / sticky headers / export | No recurring implemented table convention. Analytics are code-sorted but not user-sortable. | `pages/EtoList.tsx:234-381`; `pages/Dashboard.tsx:167-169` | UNKNOWN |
| Pagination | List uses server-side page size of 50 with Previous/Next and counts; Dashboard queue and Admin users table do not paginate. | `pages/EtoList.tsx:21-22,355-381`; `pages/Dashboard.tsx:260-311`; `pages/Admin.tsx:290-370` | APPLICATION-SPECIFIC list size; UNKNOWN as general rule |
| Loading/empty/responsive | List and Dashboard use skeletons and empty messaging; list/dashboard/workflow scroll wide tables, but Admin lacks an explicit overflow wrapper. | `pages/EtoList.tsx:234-254`; `pages/Dashboard.tsx:247-260`; `pages/Admin.tsx:290-370` | INCONSISTENT |

## 8. Status and state

The established **component pattern** is a compact, rounded, labeled pill (`px-2.5 py-0.5 rounded-full text-xs font-medium`). The **labels and colors** below are ETO workflow semantics, not enterprise statuses.

| Implemented state | Treatment | Evidence | Classification |
| --- | --- | --- | --- |
| Draft / Abandoned | Slate pill; abandoned darker than draft. | `components/StagePill.tsx:2,12,15-26,34-40` | APPLICATION-SPECIFIC |
| ART / Engineering / Production / ART Final Review | Blue / purple / amber / cyan pill respectively. | `components/StagePill.tsx:3-6,17-20` | APPLICATION-SPECIFIC |
| Quoted / Won | Green / emerald pill. | `components/StagePill.tsx:7-8,21-22` | APPLICATION-SPECIFIC |
| Declined / Lost | Red / orange pill; legacy `closed` is displayed as “Lost.” | `components/StagePill.tsx:9-11,23-26` | APPLICATION-SPECIFIC |
| Overdue / unassigned | Red overdue treatment; assignee/Unassigned labels in list; not the same as a single global StatusBadge. | `pages/EtoList.tsx:277-345`; `pages/Dashboard.tsx:105-114` | CANDIDATE STANDARD for risk emphasis |
| Generic Active, Inactive, Pending, Complete, Failed, Warning, Error, New, In Progress, On Hold, Archived | No unified cross-application badge/wording/color vocabulary demonstrated. | `components/StagePill.tsx:1-44`; `pages/EtoList.tsx:21-49` | UNKNOWN |

Status should never be conveyed by color alone; existing stage pills include text. Workflow progress separately shows stage nodes, connecting lines, action metadata and state indicators (`components/StageProgressBar.tsx:24-43,298-434`); its state machine stays ETO-specific.

## 9. Notifications and feedback

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Success/failure toasts | New Request and Detail call Sonner `toast.success/error`; Admin calls a separate `useToast` hook. | `pages/NewEtoRequest.tsx:207-227`; `pages/EtoDetail.tsx:137-187`; `pages/Admin.tsx:9,58-64,219-243` | INCONSISTENT |
| Persistent context banners | Split-family info banner and amber role-simulation notice provide contextual information and exit/clear controls. | `pages/EtoList.tsx:213-231`; `components/AppLayout.tsx:130-150` | CANDIDATE STANDARD for contextual feedback |
| Duration, dismissal, severity order | No unified app-level policy established; notification libraries have defaults, but their availability does not establish a product standard. | `App.tsx:140-145`; `pages/Admin.tsx:58-64` | UNKNOWN |

## 10. Dialogs and modals

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Destructive confirmation | Attachment removal uses Radix AlertDialog, explicit title, consequence copy, Cancel and Remove. | `pages/EtoDetail.tsx:763-781` | CANDIDATE STANDARD |
| Admin add/remove | Custom centered white overlays (`max-w-md` / `max-w-sm`), dark backdrop, close-on-backdrop, Cancel/confirm. These lack the dialog semantics and focus handling of the Radix primitive. | `pages/Admin.tsx:67-179` | INCONSISTENT |
| Inline confirmation | Abandon workflow requires reason in an inline two-step confirmation; reopen / Mark Won can act immediately. | `pages/EtoDetail.tsx:922-1005,1636-1697` | APPLICATION-SPECIFIC; confirmation policy needs review |
| Multi-step general dialog | Not implemented as a reusable pattern. | `pages/Admin.tsx:38-179`; `pages/EtoDetail.tsx:763-781` | UNKNOWN |

## 11. Navigation and interaction

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Hierarchy | Sidebar links for sections; page headers and card sections inside; detail has a back control and StageProgressBar. | `components/AppLayout.tsx:66-85`; `pages/EtoDetail.tsx:211-233` | CANDIDATE STANDARD for hierarchy; APPLICATION-SPECIFIC route labels |
| Tabs | Audit card uses Stage/Details tabs with count badges through the shared Radix-based Tabs primitive. | `pages/EtoDetail.tsx:506-628` | CANDIDATE STANDARD |
| Hover/focus | Nav and rows respond on hover; Button primitive has focus-visible styling; raw links/buttons do not consistently mirror this. | `components/AppLayout.tsx:73-84`; `pages/EtoList.tsx:269-276`; `components/ui/button.tsx:6-8` | INCONSISTENT |
| Accordions / drawers / keyboard shortcuts | No implemented app usage established; existence in `components/ui/` is insufficient. | `App.tsx:107-145`; `components/ui/` | UNKNOWN |

## 12. Loading, empty and error states

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Loading | Skeletons in Dashboard/List/Detail; Admin and auth use loading text; mutations disable controls, sometimes add spinner. | `pages/Dashboard.tsx:123-141,247-258`; `pages/EtoList.tsx:234-242`; `pages/EtoDetail.tsx:191-198`; `pages/Admin.tsx:199-205`; `App.tsx:73-79` | INCONSISTENT visual treatment |
| Empty | Dashboard queue, filtered list, attachment/comment sections and admin user list show explicit messages; some have icons or a next action, others do not. | `pages/Dashboard.tsx:253-258`; `pages/EtoList.tsx:243-252`; `pages/EtoDetail.tsx:326-391,422-504`; `pages/Admin.tsx:361-367` | CANDIDATE STANDARD; specifics vary |
| Error/recovery | Detail has missing-request/back state; action failures toast, sometimes suggest refresh/retry. List/Admin query errors lack a consistent explicit page-level recovery state. | `pages/EtoDetail.tsx:191-209,151-167`; `pages/EtoList.tsx:234-252`; `pages/Admin.tsx:199-215` | INCONSISTENT |

## 13. Search and filtering

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Search | At top of ETO list, text input with search icon and 400ms debounce; API filters results, resets page. Not global search. | `pages/EtoList.tsx:51-79,143-153` | CANDIDATE STANDARD for local search; APPLICATION-SPECIFIC scope |
| Filters | Stage select and overdue/split toggle buttons; family context banner offers explicit Clear family. No saved filters or generic chip system. | `pages/EtoList.tsx:154-231` | CANDIDATE STANDARD for filter grouping; UNKNOWN saved-filter rule |
| URL state | Dashboard overdue link sets URL parameter. Split filters update URL but overdue toggle only updates local state; there is no unified URL-state rule. | `pages/Dashboard.tsx:105-114`; `pages/EtoList.tsx:56-65,176-205` | INCONSISTENT |

## 14. Accessibility: implemented evidence and gaps

| UX pattern | Current implementation | Evidence | Classification |
| --- | --- | --- | --- |
| Semantic structure | `aside`, `nav`, `main`, headings and native buttons are used. Document declares `lang="en"`. | `components/AppLayout.tsx:55-59,66,128`; `artifacts/eto-tracker/index.html:2`; `App.tsx:26-32` | CANDIDATE STANDARD |
| Labels and non-text controls | Some form controls and remove/refresh actions have `aria-label`; decorative sidebar logo has empty alt next to visible text. | `pages/NewEtoRequest.tsx:399,430,581`; `pages/Admin.tsx:271-279`; `components/AppLayout.tsx:62-64` | CANDIDATE STANDARD but inconsistently applied |
| Keyboard/focus | Button primitive defines `focus-visible`; list `<tr onClick>` is not keyboard accessible; raw sidebar links have visual active state without `aria-current`. | `components/ui/button.tsx:6-8`; `pages/EtoList.tsx:269-276`; `components/AppLayout.tsx:67-84` | INCONSISTENT |
| Dialog accessibility | Attachment AlertDialog uses structured title/description/actions; Admin custom overlays do not declare dialog roles, trap focus, or handle Escape explicitly. Admin form labels lack `htmlFor`. | `pages/EtoDetail.tsx:763-781`; `pages/Admin.tsx:67-124,155-179` | INCONSISTENT |
| Table accessibility | Native tables and header cells exist; interactive list row and explicit header scope/caption conventions are not established. | `pages/EtoList.tsx:254-353`; `pages/Admin.tsx:290-370` | INCONSISTENT |
| Contrast / motion | No measured contrast audit or reduced-motion policy is evident. Tokenized focus ring can resolve to placeholder `red`. | `index.css:70-146,221-289`; `components/ui/button.tsx:6-8` | UNKNOWN for contrast/motion; INCONSISTENT focus token |

## Reusable component inventory

Only actual implementations are listed below. “Potential interface” describes how one could extract a pattern; it is **not** a claim that such a shared API exists today.

| Current name/location | Purpose and behavior | Implemented variants / props | Dependencies / reuse potential |
| --- | --- | --- | --- |
| `components/ui/Button` | Accessible native button or Slot; styles action emphasis, hover, focus, disabled. | `variant`: default/destructive/outline/secondary/ghost/link; `size`: default/sm/lg/icon; `asChild` plus button props. | Tokenized theme is incomplete. **High**, after token review. |
| `components/ui/Card` | Header/content container; used for metrics, analytics, detail. | Card/Header/Title/Content composition, `className` overrides. | Visual colors depend on CSS tokens and page overrides. **High**. |
| `components/ui/Input`, `Textarea`, `Label`, `Select` | Text entry and selection primitives. | Native input/textarea attrs; composed Select trigger/content/items; classes. | Admin still uses raw controls. **High** after consistency review. |
| `components/ui/AlertDialog`, `Tabs`, `Skeleton`, `Tooltip` | Confirmation, section switching, loading placeholders, extra context. | Composition with primitive subcomponents; size/state generally via classes. | Radix primitives where used; **high** reuse potential. |
| `components/StagePill` | Labeled compact status badge. | `stage`, optional `className`; unknown stage falls back to its string label. | Tightly bound to ETO stage map; extract badge anatomy, **not** stage vocabulary. **Medium**. |
| `pages/Dashboard.tsx` `KpiCard` | Title/value/icon and optional warning border; value skeleton while loading. | `title`, `value`, `loading`, `icon`, `color`, `highlight`. | Nested, not shared; metric semantics and colors are app-specific. **Medium**. |
| `pages/NewEtoRequest.tsx` `FieldError` | Small inline error beneath field. | `msg`; returns null if absent. | Local helper; **medium** if connected to form semantics. |
| `pages/EtoDetail.tsx` attachment row and delete AlertDialog | File actions, busy states, explicit deletion confirmation. | Props/API state depend on attachment and ownership. | ETO/storage dependencies; generic file-row pattern is **medium**. |
| `components/AppLayout` | Navigation/sidebar/main shell, user context and role simulation. | `children`; role-driven links and simulation. | ETO routes/role semantics/logo baked in; abstract structural shell only. **Medium**. |
| `components/StageProgressBar`, `SplitFamilyBadge` | ETO workflow and family relationships. | Stage/progress/family metadata. | Business-specific; **low** direct reuse. |

The `components/ui/` directory also contains many unused scaffold primitives (for example `sidebar`, `breadcrumb`, `pagination`, `drawer`, `calendar`). Their presence does **not** establish an implemented UX pattern.

## Token inventory and foundation candidates

**Existing implementation:** `index.css` maps Tailwind semantic names to CSS variables, sets `--app-font-sans: 'Inter', sans-serif` and `--radius: 0.5rem`, but most semantic HSL values are the literal placeholder `red`. Direct Tailwind classes and hard-coded hexes are the effective visual source for much of the app. The mappings below are **extraction candidates**, not approved token definitions.

| Proposed token role | Observable source today | Readiness |
| --- | --- | --- |
| `--color-primary` | `#1E3A5F` navy for app-specific shell/actions; hover `#162d4a` | Candidate, not currently the resolved CSS `--primary` |
| `--color-secondary` | No stable semantic secondary brand color; amber `#E8A020` appears for active nav | UNKNOWN; do not equate amber with generic secondary |
| `--color-background` / `--color-surface` | `bg-slate-50` / `bg-white` | Candidate; existing CSS vars are placeholders |
| `--color-text` / `--color-text-muted` / `--color-border` | slate-900 / slate-500–600 / slate-200 Tailwind classes | Candidate; resolve exact scale values during foundation work |
| `--color-success` / `--color-warning` / `--color-error` / `--color-info` | Green/emerald, amber, red, blue families in domain badges and notices | Candidate semantic groups, **not** one fixed value per role |
| `--font-family` | `Inter`, sans-serif | Candidate |
| `--font-size-xs/sm/md/lg/xl` | Used Tailwind `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-2xl`; **no matching custom CSS tokens** | Candidate mapping requires approval |
| `--font-weight-normal/medium/bold` | `font-normal`, `font-medium`, `font-semibold`, `font-bold` used contextually; no consolidated token set | Candidate; include semibold explicitly if formalized |
| `--space-xs/sm/md/lg/xl` | Tailwind utility scale such as `gap-3`, `p-4`, `p-6`, `space-y-6`; not named product tokens | UNKNOWN mapping; do not invent values |
| `--radius-sm/md/lg` | Global `--radius: 0.5rem`; Tailwind `rounded-md/lg/xl/full` overrides in use | Candidate; no approved 3-level scale |
| Elevation | `shadow-xs` etc. defined in CSS; many are zero-opacity placeholders; Admin modal uses `shadow-xl`. | UNKNOWN as formal elevation scale |

## Inconsistencies requiring human review

| Pattern | Implementation A | Implementation B | Likely intent / human review question |
| --- | --- | --- | --- |
| Theme source | Hard-coded navy/slate/amber classes in shell/pages | Semantic CSS vars resolve to `red` placeholders (`index.css`) | Should the foundation use an approved palette and replace placeholders before tokenized primitives are adopted? |
| Primary controls | Shared Button variants with focus/disabled states | Raw navy buttons in Sign In/Admin | Which button implementation and focus/disabled contract should be standard? |
| Notifications | Sonner on detail/new request | `useToast` on Admin | Which feedback system should own timing, placement and accessibility? |
| Confirmation | Radix AlertDialog for attachment removal | Custom Admin backdrop dialogs; immediate reopen/Mark Won; inline abandon confirmation | Which actions need confirmation and which component should handle it? |
| Form controls/validation | New Request shared inputs, schema errors below fields | Admin raw controls and hand-rolled validation | Should forms share field/error/label semantics without imposing ETO fields? |
| Tables/responsive | List/Dashboard scroll wide tables | Admin lacks overflow wrapper; List row is click-only | What is the keyboard-safe row navigation and narrow-screen table policy? |
| Filter URL state | Split filters synchronize query string | Overdue toggle does not; initial overdue parameter does | Which filters should persist/share via URL? |
| Loading/error states | Skeleton + explicit missing-detail state | Admin plain loading; List/Admin lack comparable query-error view | Define consistent loading, empty, retry and error treatment. |
| Upload guidance | New Request advertises any file type | Detail enforces count/size limits | Align copy with real constraints before extracting an uploader. |
| Focus/active state | Shared Button focus ring | Sidebar visual active class without `aria-current`; raw button styles vary | Establish a visible keyboard focus and selected-state contract. |

**No winner is selected by this inventory.** These are review questions for the future cross-app standards process.

## Decisions that must remain application-specific

- ETO stage names, order, branching, split-family behavior, terminal outcomes and reviewer/assignee transitions (`StagePill`, `StageProgressBar`, `WorkflowDiagram`, `EtoDetail`).
- ETO KPI definitions, “My Queue,” overdue threshold, analytics labels and pipeline counts (`Dashboard`).
- Sales/ART/Engineering/Production/Admin/SuperUser roles, simulated-role workflow and which routes/actions each can see (`AppLayout`, `Admin`, `EtoDetail`).
- Quote/customer/test-lab fields, measurement units, attachment business limits and workflow reason requirements (`NewEtoRequest`, `EtoDetail`).
- ETO-specific navy brand and logo until an enterprise brand decision is made; a reusable foundation should define replaceable theme slots rather than mandate this app's colors.

## Next consolidation review

Compare this record with other applications using the same taxonomy. Approve only patterns supported by evidence across apps or an explicit design decision; resolve inconsistent implementations; establish real color/focus/typography tokens; and distinguish shared component contracts from domain-specific copy, statuses, data, and permissions. Accessibility and responsive gaps are findings to address, **not** standards to carry forward.