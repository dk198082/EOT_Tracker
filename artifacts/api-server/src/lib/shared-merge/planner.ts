import { createHash } from "node:crypto";
import {
  NEW_PRICING_TABLES, SINGLETONS,
  type Contract, type Decisions, type Mapping, type Origin,
  type RequestState, type Row, type Snapshot,
} from "./contracts";

const sources: Origin[] = ["production", "workspace"];
const MAX_PG_INTEGER = 2_147_483_647;
const legacyScheduleColumns = new Set([
  "engineering_review_duration_weeks", "production_review_duration_weeks",
  "art_final_review_duration_weeks", "art_review_accepted_date", "due_date",
]);
const refKey = (origin: Origin, table: string, id: unknown) => JSON.stringify([origin, table, id]);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => JSON.parse(canonical(entry))));
  if (value && typeof value === "object") {
    return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, JSON.parse(canonical(entry))])));
  }
  return JSON.stringify(value) ?? "null";
};

export interface PreparedMerge {
  /** These rows are private preparation data; never log or present them. */
  rows: Record<string, Row[]>;
  mappings: Mapping[];
  requestStates: RequestState[];
  retainedOriginals: { origin: Origin; table: string; reason: string; row: Row }[];
  nextSequenceValues: Record<string, number>;
  blockers: string[];
  report: {
    mode: "preparation-only";
    liveExecutionAvailable: false;
    preparationValid: boolean;
    tables: { table: string; production: number; workspace: number; prepared: number }[];
    activeRequests: number;
    archivedRequests: number;
    mergedIdentities: number;
    retainedOriginalRecords: number;
    blockerCodes: string[];
    remainingReleaseGates: string[];
  };
}

function validate(snapshot: Snapshot, expected: Origin, contracts: Contract[]): void {
  if (snapshot.origin !== expected || !snapshot.identityRealm
      || !Number.isFinite(Date.parse(snapshot.capturedAt))) throw new Error("Invalid snapshot header");
  const names = new Set(contracts.map((contract) => contract.name));
  if (Object.keys(snapshot.tables).some((table) => !names.has(table))) throw new Error("Unowned snapshot table");
  if ((snapshot.tables.sessions ?? []).length) throw new Error("Session payloads must be excluded");
  for (const contract of contracts) {
    const rows = snapshot.tables[contract.name];
    if (!rows && !(expected === "production" && NEW_PRICING_TABLES.has(contract.name))) {
      throw new Error("Incomplete app snapshot");
    }
    const ids = new Set<unknown>();
    const uniqueValues = new Map(contract.uniqueColumns.map((column) => [column, new Set<unknown>()]));
    for (const row of rows ?? []) {
      const id = row[contract.primaryKey];
      if (contract.numericKey ? !Number.isSafeInteger(id) || Number(id) < 1
        : typeof id !== "string" || !id) throw new Error("Invalid source primary key");
      if (ids.has(id)) throw new Error("Duplicate source primary key");
      ids.add(id);
      if (Object.keys(row).some((column) => !contract.columns.includes(column))) {
        throw new Error("Unreviewed snapshot column");
      }
      for (const [column, value] of Object.entries(row)) {
        if (value == null) continue;
        const type = contract.columnTypes[column];
        if ((["integer", "serial"].includes(type)
            && (!Number.isSafeInteger(value) || Number(value) < -2_147_483_648 || Number(value) > MAX_PG_INTEGER))
          || (type === "double precision" && (typeof value !== "number" || !Number.isFinite(value)))
          || (type === "boolean" && typeof value !== "boolean")
          || ((type === "text" || type.startsWith("varchar")) && typeof value !== "string")
          || ((type.startsWith("timestamp") || type === "date")
            && (typeof value !== "string" || !Number.isFinite(Date.parse(value))))) {
          throw new Error("Invalid snapshot value type");
        }
      }
      if (contract.required.some((column) => row[column] === undefined || row[column] === null)) {
        throw new Error("Incomplete required source values");
      }
      if (contract.columns.some((column) => !Object.hasOwn(row, column)
          && !(expected === "production" && contract.name === "eto_requests" && legacyScheduleColumns.has(column)))) {
        throw new Error("Partial row exports are unsafe");
      }
      if (contract.name === "users"
          && (!["sales", "art", "engineering", "production", "admin", "superuser"].includes(String(row.role))
            || (row.clerk_id != null && (typeof row.clerk_id !== "string" || !row.clerk_id.trim())))) {
        throw new Error("Invalid identity or role value");
      }
      for (const [column, values] of uniqueValues) {
        if (row[column] == null) continue;
        if (values.has(row[column])) throw new Error("Source unique constraint violated");
        values.add(row[column]);
      }
      for (const fk of contract.foreignKeys) {
        if (row[fk.column] == null) continue;
        if (!(snapshot.tables[fk.table] ?? []).some((target) => target[fk.targetColumn] === row[fk.column])) {
          throw new Error("Dangling source reference");
        }
      }
    }
    for (const group of contract.uniqueGroups) {
      const seen = new Set<string>();
      for (const row of rows ?? []) {
        if (group.some((column) => row[column] == null)) continue;
        const key = canonical(group.map((column) => row[column]));
        if (seen.has(key)) throw new Error("Source compound unique constraint violated");
        seen.add(key);
      }
    }
    const high = snapshot.sequenceHighWater[contract.name] ?? 0;
    if (contract.serialKey && !Object.hasOwn(snapshot.sequenceHighWater, contract.name)) {
      throw new Error("Sequence state is required");
    }
    if (!Number.isSafeInteger(high) || high < 0 || high > MAX_PG_INTEGER) {
      throw new Error("Invalid sequence high water");
    }
  }
}

/**
 * Builds transformed rows entirely in memory. There is deliberately no DB
 * client, SQL executor, write-file side effect or --execute implementation.
 */
export function prepareSharedMerge(
  production: Snapshot, workspace: Snapshot, contracts: Contract[], decisions: Decisions,
): PreparedMerge {
  validate(production, "production", contracts);
  validate(workspace, "workspace", contracts);
  if (!decisions.epoch || production.identityRealm !== workspace.identityRealm) {
    throw new Error("Identity realm or merge epoch not verified");
  }
  const snapshots = { production, workspace };
  const blockers = new Set<string>();
  const mapping = new Map<string, string | number>();
  const mappings: Mapping[] = [];
  const rows: Record<string, Row[]> = {};
  const nextSequenceValues: Record<string, number> = {};
  const selected: { origin: Origin; contract: Contract; row: Row }[] = [];
  const retainedOriginals: PreparedMerge["retainedOriginals"] = [];
  let mergedIdentities = 0;
  const recordMapping = (origin: Origin, contract: Contract, row: Row, targetId: string | number) => {
    const sourceId = row[contract.primaryKey] as string | number;
    mapping.set(refKey(origin, contract.name, sourceId), targetId);
    mappings.push({ origin, table: contract.name, sourceId, targetId });
  };
  for (const contract of contracts) {
    rows[contract.name] = [];
    if (contract.name === "sessions") continue;
    const p = production.tables[contract.name] ?? [];
    const w = workspace.tables[contract.name] ?? [];
    let high = [...p, ...w].reduce((max, row) => Math.max(max,
      contract.numericKey ? Number(row[contract.primaryKey]) : 0),
    Math.max(production.sequenceHighWater[contract.name] ?? 0, workspace.sequenceHighWater[contract.name] ?? 0));
    const occupied = new Set<string | number>();
    const fkPrimary = contract.foreignKeys.some((fk) => fk.column === contract.primaryKey);
    const approvedSingleton = SINGLETONS.has(contract.name) && p.length && w.length;
    if (approvedSingleton && !decisions.singletonSources[contract.name]) {
      blockers.add("SINGLETON_SELECTION_REQUIRED");
    }
    for (const origin of sources) {
      for (const original of snapshots[origin].tables[contract.name] ?? []) {
        const row = structuredClone(original);
        if (approvedSingleton && origin !== decisions.singletonSources[contract.name]) {
          retainedOriginals.push({
            origin, table: contract.name,
            reason: decisions.singletonSources[contract.name] ? "singleton_authority" : "singleton_pending",
            row,
          });
          continue;
        }
        if (SINGLETONS.has(contract.name) && row[contract.primaryKey] !== 1) {
          blockers.add("UNEXPECTED_SINGLETON_ID");
        }
        if (contract.name === "users" && origin === "workspace" && row.clerk_id) {
          const sameAuth = p.find((candidate) => candidate.clerk_id === row.clerk_id);
          if (sameAuth) {
            if (!decisions.verifiedAuthIds.includes(String(row.clerk_id))) {
              blockers.add("IDENTITY_VERIFICATION_REQUIRED");
            } else {
              if (sameAuth.role !== row.role
                  && !decisions.productionRoleAuthIds.includes(String(row.clerk_id))) {
                blockers.add("ROLE_AUTHORITY_REQUIRED");
              }
              recordMapping(origin, contract, row, sameAuth.id as number);
              retainedOriginals.push({ origin, table: contract.name, reason: "verified_identity_merge", row });
              mergedIdentities++;
              continue;
            }
          }
        }
        let target = row[contract.primaryKey] as string | number;
        if (contract.name === "data_imports") {
          target = `${origin}:${String(target)}`;
          blockers.add("BOOTSTRAP_MARKERS_REQUIRE_ACTIVATION_REVIEW");
        } else if (occupied.has(target) && !fkPrimary) {
          if (!contract.numericKey) throw new Error("String-key collision needs explicit handling");
          target = ++high;
          if (!Number.isSafeInteger(target) || target > MAX_PG_INTEGER) throw new Error("Sequence exhausted");
        }
        if (!fkPrimary) {
          occupied.add(target);
          recordMapping(origin, contract, row, target);
        }
        selected.push({ origin, contract, row });
      }
    }
    if (contract.serialKey) {
      if (!Number.isSafeInteger(high + 1) || high + 1 > MAX_PG_INTEGER) throw new Error("Sequence exhausted");
      nextSequenceValues[contract.name] = high + 1;
    }
  }
  // Foreign-key primary keys (calculator) follow their mapped parent IDs.
  for (const { origin, contract, row } of selected) {
    const primaryFk = contract.foreignKeys.find((fk) => fk.column === contract.primaryKey);
    if (primaryFk) {
      const target = mapping.get(refKey(origin, primaryFk.table, row[primaryFk.column]));
      if (target === undefined) throw new Error("Missing primary-key parent");
      recordMapping(origin, contract, row, target);
    }
  }
  const requestStates: RequestState[] = [];
  const expectedArchives = new Set<number>();
  const productionNumbers = new Set((production.tables.eto_requests ?? [])
    .map((row) => row.eto_number).filter(Boolean));
  for (const row of workspace.tables.eto_requests ?? []) {
    if (row.eto_number && productionNumbers.has(row.eto_number)) expectedArchives.add(Number(row.id));
  }
  const approvedArchives = new Set(decisions.archiveWorkspaceRequestIds);
  if (approvedArchives.size !== decisions.archiveWorkspaceRequestIds.length
      || expectedArchives.size !== approvedArchives.size
      || [...expectedArchives].some((id) => !approvedArchives.has(id))) {
    blockers.add("EXACT_ARCHIVE_SCOPE_REQUIRED");
  }
  for (const { origin, contract, row } of selected) {
    const transformed = structuredClone(row);
    if (contract.name === "eto_requests") {
      for (const column of legacyScheduleColumns) {
        if (!Object.hasOwn(transformed, column)) transformed[column] = null;
      }
    }
    transformed[contract.primaryKey] = mapping.get(refKey(origin, contract.name, row[contract.primaryKey]))!;
    for (const fk of contract.foreignKeys) {
      if (row[fk.column] === null || row[fk.column] === undefined) continue;
      const target = mapping.get(refKey(origin, fk.table, row[fk.column]));
      if (target === undefined) throw new Error("Dangling source foreign key");
      transformed[fk.column] = target;
    }
    rows[contract.name].push(transformed);
    if (contract.name === "eto_requests") {
      const archived = origin === "workspace" && expectedArchives.has(Number(row.id))
        && approvedArchives.has(Number(row.id));
      if (archived) {
        const familyDependency = row.parent_eto_request_id != null
          || (workspace.tables.eto_requests ?? []).some((child) => child.parent_eto_request_id === row.id);
        if (familyDependency && !decisions.reviewedSplitRequestIds.includes(Number(row.id))) {
          blockers.add("SPLIT_FAMILY_REVIEW_REQUIRED");
        }
      }
      requestStates.push({
        id: Number(transformed.id), origin, sourceId: Number(row.id), archived,
        recordKey: createHash("sha256").update(refKey(origin, contract.name, row.id)).digest("hex"),
      });
    }
  }
  // Validate transformed uniqueness, with only the approved archive exception.
  const archivedIds = new Set(requestStates.filter((row) => row.archived).map((row) => row.id));
  for (const contract of contracts) {
    for (const column of new Set([contract.primaryKey, ...contract.uniqueColumns])) {
      const values = new Set<unknown>();
      for (const row of rows[contract.name]) {
        if (row[column] == null) continue;
        if (contract.name === "eto_requests" && column === "eto_number" && archivedIds.has(Number(row.id))) continue;
        if (values.has(row[column])) blockers.add("TRANSFORMED_UNIQUENESS_CONFLICT");
        values.add(row[column]);
      }
    }
    for (const group of contract.uniqueGroups) {
      const seen = new Set<string>();
      for (const row of rows[contract.name]) {
        if (group.some((column) => row[column] == null)) continue;
        const key = canonical(group.map((column) => row[column]));
        if (seen.has(key)) blockers.add("TRANSFORMED_COMPOUND_UNIQUENESS_CONFLICT");
        seen.add(key);
      }
    }
  }
  // Same business signature is a review warning, never an automatic overwrite.
  const signature = (row: Row) => canonical([
    String(row.customer_name).trim().toLowerCase(), String(row.quote_number).trim().toLowerCase(),
  ]);
  const pSignatures = new Set((production.tables.eto_requests ?? []).map(signature));
  if ((workspace.tables.eto_requests ?? []).some((row) => pSignatures.has(signature(row)))) {
    blockers.add("POSSIBLE_REQUEST_DUPLICATE_REVIEW_REQUIRED");
  }
  const codes = [...blockers].sort();
  return {
    rows, mappings, requestStates, retainedOriginals, nextSequenceValues, blockers: codes,
    report: {
      mode: "preparation-only", liveExecutionAvailable: false, preparationValid: !codes.length,
      tables: contracts.map((contract) => ({
        table: contract.name,
        production: (production.tables[contract.name] ?? []).length,
        workspace: (workspace.tables[contract.name] ?? []).length,
        prepared: rows[contract.name].length,
      })),
      activeRequests: requestStates.filter((row) => !row.archived).length,
      archivedRequests: archivedIds.size, mergedIdentities,
      retainedOriginalRecords: retainedOriginals.length, blockerCodes: codes,
      remainingReleaseGates: [
        "AUTHORITATIVE_FROZEN_SNAPSHOTS", "APPROVED_IDENTITY_ROLE_DEFAULT_MANIFEST",
        "ARCHIVE_SCHEMA_AND_ALL_API_UI_GUARDS", "POSTGRES_AND_BROWSER_VALIDATION",
        "APPROVED_MAINTENANCE_AND_ATOMIC_INSTALL", "USER_PUBLISH_AND_SMOKE_CHECKS",
      ],
    },
  };
}
