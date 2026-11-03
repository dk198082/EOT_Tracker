import { describe, expect, it, vi } from "vitest";

// Runtime URL avoids pulling browser DOM sources into the server TS project.
const moduleUrl = new URL("../../../../../lib/api-client-react/src/shared-identity.ts", import.meta.url).href;
describe("Trusted browser identity across migration and ID remapping", () => {
  it("does not adopt remapped identities or a new epoch from a background refetch", async () => {
    vi.resetModules();
    const identity = await import(moduleUrl);
    identity.observeSharedEpoch("old-epoch");
    identity.observeSharedIdentity("/api/eto-requests/16", "GET", { id:16, recordKey:"original-workspace", migrationEpoch:"old-epoch" });
    identity.observeSharedEpoch("new-epoch");
    identity.observeSharedIdentity("/api/eto-requests/16", "GET", { id:16, recordKey:"different-production", migrationEpoch:"new-epoch" });
    const headers = identity.sharedIdentityHeaders("/api/eto-requests/16/comments", "POST");
    expect(headers.get("x-eto-record-key")).toBe("original-workspace");
    expect(headers.get("x-eto-migration-epoch")).toBe("old-epoch");
  });
  it("list data cannot authorize a write against a cached legacy detail, and old sessions cannot create after cutover", async () => {
    vi.resetModules();
    const identity = await import(moduleUrl);
    identity.observeSharedEpoch("legacy");
    identity.observeSharedIdentity("/api/eto-requests/16", "GET", { id:16 });
    identity.observeSharedEpoch("new-epoch");
    identity.observeSharedIdentity("/api/eto-requests?archive=all", "GET", {
      migrationEpoch:"new-epoch", items:[{ id:16, recordKey:"production", migrationEpoch:"new-epoch" }],
    });
    const headers = identity.sharedIdentityHeaders("/api/eto-requests/16", "PATCH");
    expect(headers.has("x-eto-record-key")).toBe(false);
    expect(identity.sharedIdentityHeaders("/api/eto-requests", "POST").has("x-eto-migration-epoch")).toBe(false);
  });
  it("carries detail identity through upload issuance, attachment writes, and settings mutations", async () => {
    vi.resetModules();
    const identity = await import(moduleUrl);
    identity.observeSharedEpoch("current-epoch");
    identity.observeSharedIdentity("/api/eto-requests/16", "GET", { id:16, recordKey:"stable", migrationEpoch:"current-epoch" });
    for (const [url,body] of [
      ["/api/storage/uploads/request-url", JSON.stringify({etoRequestId:16})],
      ["/api/eto-requests/16/attachments", "{}"],
    ]) {
      const headers = identity.sharedIdentityHeaders(url, "POST", body);
      expect(headers.get("x-eto-record-key")).toBe("stable");
      expect(headers.get("x-eto-migration-epoch")).toBe("current-epoch");
    }
    expect(identity.sharedIdentityHeaders("/api/admin/price-calculator", "PUT").get("x-eto-migration-epoch")).toBe("current-epoch");
    identity.observeSharedIdentity("/api/eto-requests", "POST", { id:1001, recordKey:"created-draft", migrationEpoch:"current-epoch" });
    expect(identity.sharedIdentityHeaders("/api/storage/uploads/request-url", "POST", JSON.stringify({etoRequestId:1001}))
      .get("x-eto-record-key")).toBe("created-draft");
  });
});
