---
name: Shared ETO dataset policy
description: User-selected target architecture for reconciling workspace and published ETO data.
---

Use one shared application dataset in Azure PostgreSQL d365crm, schema crm, with the existing eto_* table names. Do not introduce a separate permanent eto_prod_* runtime dataset.

**Why:** On 2026-10-08, the user explicitly chose “Plan one shared dataset instead” rather than the proposed separate production table set.

**How to apply:** Plan reconciliation into the existing shared table set. Explain that preview and published actions will affect the same data. Temporary validation, staging and backup copies are not separate live datasets. This architecture choice does not authorize migration execution, deletion, renumbering, archiving, role changes or publishing; obtain the relevant approvals before those actions.

When distinct legacy production and workspace requests share an assigned ETO number, keep the production version active and retain the conflicting workspace version as a read-only archive in the shared dataset. Preserve its original number, history and files; do not delete or renumber it.

**Why:** On 2026-10-08, the user selected the archive-workspace-conflicts policy instead of keeping both conflicting versions active.

**How to apply:** Include archive visibility, server-enforced mutation restrictions and active-number uniqueness in the migration plan. New allocations must not reuse historical numbers, including archived references. This policy selection is not approval to execute the migration or expand archival scope to additional dependent records.

Keep the database-switch request focused on the Azure connection, `crm.eto_*`
tables, application reads/writes and publishing compatibility. Do not make a
larger legacy-data reconciliation project an automatic prerequisite to that
configuration change.

**Why:** On 2026-10-08, the user explicitly corrected the expanded scope: they
asked to change the database/schema/tables so publishing works, not to create
additional migration plans and tasks.

**How to apply:** Complete the necessary connection/configuration verification
directly. Explain separately whether legacy published-only records have been
copied; do not imply that publishing copies them or authorize changes to those
records without approval. Do not generate extra project tasks for this switch
unless the user requests them.

Do not use Replit's Development/Production database pane as evidence of the
external Azure table names or the app's current database connection.

**Why:** The pane displays Replit-managed databases, while this app uses
external Azure. The retained managed source tables caused the user to believe
the requested `crm.eto_*` tables had not been created.

**How to apply:** Inspect Azure's physical catalog through the app's Azure
connection and inspect published startup logs separately. Direct table browsing
belongs in an Azure-connected PostgreSQL client. Do not rename or delete
retained managed tables just to change what the Replit pane displays.
