import {
  getMergeContracts, NEW_PRICING_TABLES, SINGLETONS,
  type Decisions, type Row, type Snapshot,
} from "./contracts";

/** Entirely synthetic, no names/identities/rows are read from either database. */
export function sharedMergeFixture() {
  const contracts = getMergeContracts();
  const snapshots = (["production", "workspace"] as const).map((origin): Snapshot => ({
    origin, capturedAt: "2026-10-08T00:00:00Z", identityRealm: "synthetic-only",
    tables: Object.fromEntries(contracts.map((contract) => [contract.name, []])),
    sequenceHighWater: Object.fromEntries(contracts.filter((contract) => contract.numericKey)
      .map((contract) => [contract.name, 100])),
  }));
  const [production, workspace] = snapshots;
  const row = (table: string, overrides: Row): Row => {
    const contract = contracts.find((entry) => entry.name === table)!;
    const result: Row = Object.fromEntries(contract.columns.map((column) => [column, null]));
    for (const column of contract.required) {
      const type = contract.columnTypes[column];
      result[column] = type.includes("timestamp") ? "2026-10-08T00:00:00.123456+00:00"
        : type === "boolean" ? false : type.includes("integer") || type === "serial" ? 1
          : type === "jsonb" ? [] : "fixture";
    }
    Object.assign(result, overrides);
    return result;
  };
  production.tables.users.push(
    row("users", { id: 1, clerk_id: "verified-synthetic-identity", role: "superuser", email: "one@example.test" }),
    row("users", { id: 2, clerk_id: "production-only", role: "engineering", email: "two@example.test" }),
  );
  workspace.tables.users.push(
    row("users", { id: 1, clerk_id: "workspace-only", role: "production", email: "two@example.test" }),
    row("users", { id: 3, clerk_id: "verified-synthetic-identity", role: "sales", email: "one@example.test" }),
  );
  for (const snapshot of snapshots) {
    for (const [id, sequence] of [[16, 6], [17, 7], [snapshot.origin === "production" ? 18 : 19, 8]]) {
      const request = row("eto_requests", {
        id, eto_number: `ETO-2026-${String(sequence).padStart(4, "0")}`,
        customer_name: `${snapshot.origin}-${id}`, quote_number: `${snapshot.origin}-${sequence}`,
        submitted_by_id: snapshot.origin === "production" ? 1 : 3, stage: "draft",
      });
      if (snapshot.origin === "production") {
        for (const column of ["engineering_review_duration_weeks", "production_review_duration_weeks",
          "art_final_review_duration_weeks", "art_review_accepted_date", "due_date"]) delete request[column];
      }
      snapshot.tables.eto_requests.push(request);
    }
    for (const contract of contracts) {
      if (["users", "eto_requests", "sessions", "data_imports"].includes(contract.name)) continue;
      if (snapshot.origin === "production" && NEW_PRICING_TABLES.has(contract.name)) {
        delete snapshot.tables[contract.name];
        continue;
      }
      const overrides: Row = { [contract.primaryKey]: contract.primaryKey === "eto_request_id" ? 16 : 1 };
      for (const fk of contract.foreignKeys) overrides[fk.column] = fk.table === "users" ? 1 : 16;
      snapshot.tables[contract.name].push(row(contract.name, overrides));
    }
  }
  workspace.tables.eto_requests.push(row("eto_requests", {
    id: 20, eto_number: null, customer_name: "workspace-draft", quote_number: "draft",
    submitted_by_id: 1, stage: "draft",
  }));
  const decisions: Decisions = {
    epoch: "synthetic-merge-epoch",
    verifiedAuthIds: ["verified-synthetic-identity"],
    productionRoleAuthIds: ["verified-synthetic-identity"],
    archiveWorkspaceRequestIds: [16, 17, 19],
    reviewedSplitRequestIds: [],
    singletonSources: Object.fromEntries([...SINGLETONS].map((table) => [table, "workspace" as const])),
  };
  return { production, workspace, contracts, decisions };
}
