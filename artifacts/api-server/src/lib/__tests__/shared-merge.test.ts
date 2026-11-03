import { describe, expect, it } from "vitest";
import { sharedMergeFixture } from "../shared-merge/fixture";
import { prepareSharedMerge } from "../shared-merge/planner";
import {
  assertNumberAvailable, assertSharedMutation, canDeleteUnreferencedBlob,
  nextSharedNumber, shouldCaptureFirstSchedule,
} from "../shared-merge/guards";

function prepare() {
  const f = sharedMergeFixture();
  return { ...f, plan: prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions) };
}
describe("shared merge offline preparation", () => {
  it("covers all 18 existing models and archives exactly the 3 approved workspace conflicts", () => {
    const { plan, contracts } = prepare();
    expect(plan.report.tables).toHaveLength(18);
    expect(plan.report.preparationValid).toBe(true);
    expect(plan.report.liveExecutionAvailable).toBe(false);
    expect(plan.report.activeRequests).toBe(4);
    expect(plan.report.archivedRequests).toBe(3);
    expect(plan.rows.eto_requests).toHaveLength(7);
    expect(plan.requestStates.filter((r) => r.archived).map((r) => r.sourceId)).toEqual([16, 17, 19]);
    expect(plan.requestStates.filter((r) => r.origin === "production").every((r) => !r.archived)).toBe(true);
    expect(contracts.reduce((sum, c) => sum + c.foreignKeys.length, 0)).toBe(21);
    expect(plan.nextSequenceValues).not.toHaveProperty("eto_price_calculator");
    expect(plan.nextSequenceValues).not.toHaveProperty("review_assignment_defaults");
  });
  it("keeps published IDs and numbers while remapping colliding workspace IDs above high water", () => {
    const { plan } = prepare();
    expect(plan.rows.eto_requests.slice(0, 3).map((r) => r.id)).toEqual([16, 17, 18]);
    const workspace = plan.requestStates.find((r) => r.origin === "workspace" && r.sourceId === 16)!;
    expect(workspace.id).toBeGreaterThan(100);
    expect(plan.rows.eto_requests.find((r) => r.id === workspace.id)?.eto_number).toBe("ETO-2026-0006");
    expect(plan.nextSequenceValues.eto_requests).toBeGreaterThan(workspace.id);
  });
  it("merges only verified auth IDs, preserves production SuperUser, not matching email", () => {
    const { plan } = prepare();
    expect(plan.rows.users).toHaveLength(3);
    expect(plan.rows.users.find((r) => r.id === 1)?.role).toBe("superuser");
    expect(plan.rows.users.filter((r) => r.email === "two@example.test")).toHaveLength(2);
    expect(plan.report.mergedIdentities).toBe(1);
  });
  it("blocks unverified identity merges and unapproved role changes", () => {
    const f = sharedMergeFixture();
    f.decisions.verifiedAuthIds = [];
    expect(prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions).blockers)
      .toContain("IDENTITY_VERIFICATION_REQUIRED");
    f.decisions.verifiedAuthIds = ["verified-synthetic-identity"];
    f.decisions.productionRoleAuthIds = [];
    expect(prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions).blockers)
      .toContain("ROLE_AUTHORITY_REQUIRED");
  });
  it.each(["comments", "attachments", "stage_transitions", "engineering_outputs",
    "production_outputs", "art_final_outputs", "detail_changes", "eto_price_calculator"])(
    "remaps the %s request link without losing source fields", (table) => {
      const { plan, workspace, contracts } = prepare();
      const original = workspace.tables[table][0];
      const key = contracts.find((c) => c.name === table)!.primaryKey;
      const mapped = plan.mappings.find((m) => m.origin === "workspace" && m.table === table
        && m.sourceId === original[key])!;
      const result = plan.rows[table].find((r) => r[key] === mapped.targetId)!;
      const request = plan.requestStates.find((r) => r.origin === "workspace" && r.sourceId === 16)!;
      expect(result.eto_request_id).toBe(request.id);
      expect(Object.keys(result).sort()).toEqual(Object.keys(original).sort());
    },
  );
  it("remaps semantic formula-history actors even though they lack database FKs", () => {
    const { plan } = prepare();
    const actor = plan.mappings.find((m) => m.origin === "workspace" && m.table === "users" && m.sourceId === 1)!;
    for (const table of ["design_formula_changes", "assembly_formula_changes"]) {
      const history = plan.rows[table].find((r) => r.id !== 1)!;
      expect(history.actor_user_id).toBe(actor.targetId);
      expect(history.actor_name).toBe("fixture");
    }
  });
  it("preserves sub-millisecond timestamps and historical unknown schedules", () => {
    const { plan } = prepare();
    expect(plan.rows.eto_requests[0].created_at).toBe("2026-10-08T00:00:00.123456+00:00");
    expect(plan.rows.eto_requests[0].due_date).toBeNull();
    expect(plan.rows.eto_requests[0].art_review_accepted_date).toBeNull();
  });
  it("does not mutate snapshots or decisions and is deterministic", () => {
    const f = sharedMergeFixture();
    const before = JSON.stringify(f);
    const a = prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions);
    const b = prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions);
    expect(JSON.stringify(f)).toBe(before);
    expect(a).toEqual(b);
  });
  it("retains original profiles and superseded singleton settings privately", () => {
    const { plan, workspace, production } = prepare();
    expect(plan.retainedOriginals.find((r) => r.reason === "verified_identity_merge")?.row)
      .toEqual(workspace.tables.users[1]);
    expect(plan.retainedOriginals.find((r) => r.table === "review_assignment_defaults")?.row)
      .toEqual(production.tables.review_assignment_defaults[0]);
    expect(plan.report.retainedOriginalRecords).toBe(plan.retainedOriginals.length);
    expect(JSON.stringify(plan.report)).not.toContain("one@example.test");
    expect(JSON.stringify(plan.report)).not.toContain("verified-synthetic-identity");
  });
  it.each([[16, 17], [16, 17, 19, 20]])("blocks incomplete or expanded archive scope %j", (...ids) => {
    const f = sharedMergeFixture();
    f.decisions.archiveWorkspaceRequestIds = ids;
    expect(prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions).blockers)
      .toContain("EXACT_ARCHIVE_SCOPE_REQUIRED");
  });
  it("blocks unreviewed split dependencies and maps split parent IDs", () => {
    const f = sharedMergeFixture();
    f.workspace.tables.eto_requests[3].parent_eto_request_id = 16;
    const blocked = prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions);
    expect(blocked.blockers).toContain("SPLIT_FAMILY_REVIEW_REQUIRED");
    f.decisions.reviewedSplitRequestIds = [16];
    const ready = prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions);
    const parent = ready.requestStates.find((r) => r.origin === "workspace" && r.sourceId === 16)!;
    const child = ready.requestStates.find((r) => r.origin === "workspace" && r.sourceId === 20)!;
    expect(ready.rows.eto_requests.find((r) => r.id === child.id)?.parent_eto_request_id).toBe(parent.id);
  });
  it("retains both marker versions and refuses runtime activation without review", () => {
    const f = sharedMergeFixture();
    for (const snapshot of [f.production, f.workspace]) {
      snapshot.tables.data_imports = [{ id: "same-marker", matched_users: 0, applied_at: f.production.capturedAt }];
    }
    const plan = prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions);
    expect(plan.rows.data_imports.map((r) => r.id)).toEqual(["production:same-marker", "workspace:same-marker"]);
    expect(plan.blockers).toContain("BOOTSTRAP_MARKERS_REQUIRE_ACTIVATION_REVIEW");
  });
  it("requires an explicit singleton authority", () => {
    const f = sharedMergeFixture();
    delete f.decisions.singletonSources.review_assignment_defaults;
    expect(prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions).blockers)
      .toContain("SINGLETON_SELECTION_REQUIRED");
  });
  it("rejects missing captured sequence state and PostgreSQL integer exhaustion", () => {
    const f = sharedMergeFixture();
    delete f.workspace.sequenceHighWater.users;
    expect(() => prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions)).toThrow("Sequence state");
    f.workspace.sequenceHighWater.users = 2_147_483_647;
    expect(() => prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions)).toThrow("Sequence exhausted");
  });
  it("blocks matching business signatures rather than treating them as an upsert", () => {
    const f = sharedMergeFixture();
    f.workspace.tables.eto_requests[0].customer_name = f.production.tables.eto_requests[0].customer_name;
    f.workspace.tables.eto_requests[0].quote_number = f.production.tables.eto_requests[0].quote_number;
    expect(prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions).blockers)
      .toContain("POSSIBLE_REQUEST_DUPLICATE_REVIEW_REQUIRED");
  });
  it("rejects duplicate parent/split sequences and invalid primitive values", () => {
    const f = sharedMergeFixture();
    f.workspace.tables.eto_requests[1].parent_eto_request_id = 16;
    f.workspace.tables.eto_requests[1].split_sequence = 1;
    f.workspace.tables.eto_requests[3].parent_eto_request_id = 16;
    f.workspace.tables.eto_requests[3].split_sequence = 1;
    expect(() => prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions)).toThrow("compound unique");
    f.workspace.tables.eto_requests[3].split_sequence = "bad";
    expect(() => prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions)).toThrow("value type");
  });
  it("blocks repeated archive approvals rather than interpreting them as extra authority", () => {
    const f = sharedMergeFixture();
    f.decisions.archiveWorkspaceRequestIds.push(16);
    expect(prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions).blockers)
      .toContain("EXACT_ARCHIVE_SCOPE_REQUIRED");
  });
  it.each(["session", "unknown-table", "partial-row", "orphan", "wrong-realm", "duplicate-pk"])(
    "rejects unsafe snapshots: %s", (problem) => {
      const f = sharedMergeFixture();
      if (problem === "session") f.production.tables.sessions = [{ sid: "not-exportable" }];
      if (problem === "unknown-table") f.workspace.tables.crm_accounts = [];
      if (problem === "partial-row") delete f.workspace.tables.eto_requests[0].custom_details;
      if (problem === "orphan") f.workspace.tables.comments[0].author_id = 999;
      if (problem === "wrong-realm") f.workspace.identityRealm = "unverified-other-realm";
      if (problem === "duplicate-pk") f.workspace.tables.users.push(structuredClone(f.workspace.tables.users[0]));
      expect(() => prepareSharedMerge(f.production, f.workspace, f.contracts, f.decisions)).toThrow();
    },
  );
});
describe("staged archive and stale-client policies", () => {
  const allowed = {
    currentEpoch: "epoch", clientEpoch: "epoch", expectedRecordKey: "key",
    actualRecordKey: "key", archived: false,
  };
  it("permits a fresh mutation but blocks all archived mutations", () => {
    expect(() => assertSharedMutation(allowed)).not.toThrow();
    expect(() => assertSharedMutation({ ...allowed, archived: true })).toThrow("ARCHIVED_READ_ONLY");
  });
  it.each([
    { clientEpoch: undefined }, { clientEpoch: "old" },
    { expectedRecordKey: undefined }, { expectedRecordKey: "other-record" },
  ])("rejects stale or misdirected mutation %j", (change) => {
    expect(() => assertSharedMutation({ ...allowed, ...change })).toThrow("RELOAD_REQUIRED");
  });
  it("allocates beyond archives and refuses base/split number reuse", () => {
    const rows = [{ eto_number: "ETO-2026-0042", archived: true }, { eto_number: null },
      { eto_number: "ETO-2026-0006-S1" }];
    expect(nextSharedNumber(rows, 2026)).toBe("ETO-2026-0043");
    expect(() => assertNumberAvailable(rows, "ETO-2026-0042")).toThrow("HISTORICAL_NUMBER_ALREADY_USED");
    expect(() => assertNumberAvailable(rows, "ETO-2026-0006-S1")).toThrow();
    expect(() => assertNumberAvailable(rows, "ETO-2026-0043")).not.toThrow();
  });
  it("does not delete blobs referenced by another row, including archives", () => {
    expect(canDeleteUnreferencedBlob("shared/key", [{ storage_key: "shared/key", archived: true }])).toBe(false);
    expect(canDeleteUnreferencedBlob("shared/key", [])).toBe(true);
    expect(canDeleteUnreferencedBlob("", [])).toBe(false);
  });
  it("never invents a legacy deadline on reacceptance", () => {
    expect(shouldCaptureFirstSchedule({ hasRecordedSchedule: false, hasPreviousArtAcceptance: true })).toBe(false);
    expect(shouldCaptureFirstSchedule({ hasRecordedSchedule: true, hasPreviousArtAcceptance: true })).toBe(false);
    expect(shouldCaptureFirstSchedule({ hasRecordedSchedule: false, hasPreviousArtAcceptance: false })).toBe(true);
  });
});
