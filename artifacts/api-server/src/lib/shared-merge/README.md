# Shared ETO merge preparation

The **preparation CLI** is offline, not a migration executor. Its planner imports
schema definitions only, never a database pool. Optional archive runtime controls
are separately implemented in `runtime.ts` and `database.ts`; they query optional
columns only after verifying the compatible versioned schema and protections.
The existing Drizzle models and all 18 live `crm.eto_*` tables are unchanged.
No schema installation, copying, archival execution, role changes or publishing
is authorized by this implementation.

## Run isolated verification

```sh
pnpm --filter @workspace/api-server exec vitest run src/lib/__tests__/shared-merge.test.ts
pnpm --filter @workspace/api-server exec tsx src/scripts/prepareSharedEtoMerge.ts --fixture
pnpm --filter @workspace/api-server exec vitest run src/lib/__tests__/shared-archive.integration.test.ts src/lib/__tests__/shared-identity.ui.test.ts
```

The fixture contains synthetic identities, timestamps and records only. It
simulates three conflicting numbers, numeric ID collisions, a role mismatch,
review outputs, comments, attachments, formula histories and calculator links.
No SQL or production data is read or written. `--execute` is always rejected.

The additional archive integration suite creates a **local Unix-socket-only**
PostgreSQL cluster named `eto_archive_validation`, generates the current schema
offline, loads the synthetic transformed snapshots and installs
`staged-archive.sql`. It stops/removes its owned cluster after the run.
`initdb` and `pg_ctl` must be available. It never uses Azure credentials or pools;
storage effects are mocked. The staging SQL refuses any other database name.
This is a disposable reference schema, **not a live installer**.

## Private offline snapshots

After separate authorization to obtain private full-row exports:

```sh
pnpm --filter @workspace/api-server exec tsx src/scripts/prepareSharedEtoMerge.ts \
  --production /private/production.json \
  --workspace /private/workspace.json \
  --decisions /private/decisions.json
```

Use the `Snapshot` and `Decisions` interfaces in `contracts.ts`. Logical table
keys are the historical app names (`users`, `eto_requests`, `comments`, etc.),
not qualified SQL names. Include all source columns/rows and sequence high-water
metadata. Production may omit the two new pricing tables and five new nullable
schedule columns. Set `tables.sessions` to `[]`; never export session payloads.
Both snapshots must have the same verified identity realm.

Rows/ID maps are private in-memory output of `prepareSharedMerge`, not CLI output.
`retainedOriginals` preserves merged profile versions and superseded/pending
singleton configurations for restricted audit storage; do not silently discard
it when a future executor is implemented.
The CLI emits aggregate counts and generic blocker codes only, and exits
nonzero on rejection or unresolved blockers. Do not put raw exports or
transformed rows in the Library, logs, memory or repository.

## Rules enforced in preparation

- Prioritize production IDs; remap conflicting workspace IDs above both
  captured sequence high-water positions.
- Merge auth identities only with explicit verification. Require approval of
  production-role authority for mismatched roles. Matching email never merges.
- Archive only the exact approved workspace number-conflict scope, preserving
  assigned numbers and every request's related data. Block split-family cases
  until their dependency treatment is explicitly reviewed.
- Remap all schema foreign keys and the formula-history actor references that
  are not protected by database foreign keys.
- Remap calculator primary keys using the parent request's mapping.
- Require explicit singleton-setting authority. Retain both original marker
  versions and block bootstrap activation until a separate review.
- Validate source columns, required values, primitive types, primary/unique
  keys and references. Unknown tables and session payloads are rejected.
- Keep original timestamps as strings, including microseconds. Do not invent
  historic schedules; missing legacy schedule fields become null.
- Validate transformed unique fields and compound unique groups.

`guards.ts` defines staged policies for archive mutation rejection, migration
epoch/record identity checks, preventing reuse of historical base/split
numbers, shared-blob deletion and true-first-acceptance schedule eligibility.
The runtime guard is mounted before request details, transitions, comments,
all review outputs, splitting, calculator saves, attachment registration/deletion
and upload URL issuance. Archives have no write exception for any role. Database
triggers also prohibit record/dependent-row writes and moves into/out of archives.
User/admin mutations require the current epoch too, since their numeric targets
may have been remapped. Authentication and existing role permissions still apply.

With **no archive schema**, the catalog probe returns legacy mode and never
queries optional columns or changes existing write permissions. A partial schema,
unsupported marker, missing guard or invalid active-number index fails closed
(503); no automatic DDL, source fallback, or cutover is performed. A compatible
installed schema is the activation boundary, requiring separate approval and
draining **both** apps' writers beforehand. Do not hot-remap IDs with requests or
background jobs in flight.

List discovery uses `archive=active` (default), `archived`, or `all`; source labels
distinguish production, workspace and new shared requests. Every displayed version
has its own stable `recordKey`, original `sourceId` and `migrationEpoch`. Links use
record keys where available; ambiguous numbers never resolve a mutation.
Archive filters do not archive other split-family members or expand approved scope.

In compatible mode all mutations require `x-eto-migration-epoch`. Record mutations
and upload URLs additionally require `x-eto-record-key`, compared against trusted
database state. Missing/stale identities return `409 RELOAD_REQUIRED`; matching
archive identities return `423 ARCHIVED_READ_ONLY`. The browser pins the first
displayed identity/epoch: background refetches never upgrade old open forms.
Reload the tab and reopen the intended version from the list after cutover.
These headers are concurrency identity checks, not substitutes for authentication.

Annual allocation remains within the original transactional advisory lock. The
shared allocator reads an append-only historical number registry including deleted,
archived and split references. Its insertion guard rejects every newly reused
reference; assigned numbers cannot be cleared/changed. The partial unique index
allows approved archived duplicates but only one active version.
Production installation must preserve separate schema ownership, grant the app
SELECT-only on migration metadata/registry, and deny DDL/TRUNCATE/guard-disabling.

Archive comments/audits/outputs and file preview/download remain readable. File
unlinking occurs before blob deletion; bytes are retained when any other attachment
(including an archive) still refers to them. Signed inline previews include the
epoch/stable identity in their signature after cutover. Reminders and OCR ignore
archives; shared-mode startup does not run legacy role/submitter import jobs.

## Remaining gates

Synthetic PostgreSQL/API verification is covered by the disposable suite, not by
the offline planner itself. Browser verification uses synthetic responses, not the
live schema or live authentication. See `reports/eto-archive-validation.md`.
Before live use, review and validate:

1. The separately approved live installer and schema ownership/grants. Do not run
   the disposable staging SQL on either source.
2. Apply the exact three approved workspace conflict mappings without changing
   original numbers, history/files or additional split-family scope.
3. Approved identities, roles, reviewer defaults, bootstrap activation,
   split dependencies and private snapshot freshness.
4. Source-specific staged verification, real object existence/permissions and
   genuine Entra sign-in/role mapping against an authorized validation installation.
5. Approved pause of both apps' writers, atomic install, backups and recovery.
6. User publishing and production smoke checks.

`report.preparationValid` means the supplied offline rows/decisions have no
reported blockers. It does **not** authorize or demonstrate live readiness:
`report.liveExecutionAvailable` is always false.
