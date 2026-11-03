/**
 * Real storage integration tests.
 *
 * These tests exercise the actual Replit object-storage sidecar and GCS
 * presigned URLs end-to-end — no mocks.  They are gated on the environment
 * secrets that are only present inside a properly configured Replit workspace,
 * so they are skipped automatically in environments where those values are
 * absent (CI without secrets, local dev machines, etc.).
 *
 * Flow under test:
 *   getObjectEntityUploadURL()      → presigned PUT URL
 *   fetch(PUT, bytes)               → upload file to GCS
 *   normalizeObjectEntityPath()     → /objects/uploads/<uuid>
 *   getObjectEntityDownloadURL()    → presigned GET URL
 *   fetch(GET)                      → download and verify bytes match
 *
 * This is the exact path a real client takes, so a broken presigned URL,
 * signing failure, path-normalisation mismatch, or GCS permission problem
 * will cause this suite to fail visibly rather than silently pass.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ObjectStorageService } from "../objectStorage";

// ── Environment gate ────────────────────────────────────────────────────────

const STORAGE_AVAILABLE =
  !!process.env.PRIVATE_OBJECT_DIR &&
  !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

const describeWhenStorage = STORAGE_AVAILABLE ? describe : describe.skip;

// ── Tests ───────────────────────────────────────────────────────────────────

describeWhenStorage("ObjectStorageService — real sidecar integration", () => {
  let service: ObjectStorageService;

  beforeAll(() => {
    service = new ObjectStorageService();
  });

  it("uploads bytes via presigned PUT URL and retrieves identical bytes via signed GET URL", async () => {
    const TEST_CONTENT = "eto-tracker-storage-integration-test-" + Date.now();
    const TEST_BYTES = new TextEncoder().encode(TEST_CONTENT);

    // ── Step 1: request a presigned PUT URL ──────────────────────────────
    const rawUploadURL = await service.getObjectEntityUploadURL();
    expect(rawUploadURL).toMatch(/^https:\/\//);

    // ── Step 2: normalize to the canonical objectPath ────────────────────
    const objectPath = service.normalizeObjectEntityPath(rawUploadURL);
    expect(objectPath).toMatch(/^\/objects\//);

    // ── Step 3: PUT bytes to GCS via the presigned URL ───────────────────
    const putResponse = await fetch(rawUploadURL, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: TEST_BYTES,
    });
    expect(putResponse.ok).toBe(true);

    // ── Step 4: request a signed GET URL for the same objectPath ─────────
    const downloadURL = await service.getObjectEntityDownloadURL(objectPath);
    expect(downloadURL).toMatch(/^https:\/\//);

    // ── Step 5: download and verify content is identical ─────────────────
    const getResponse = await fetch(downloadURL);
    expect(getResponse.ok).toBe(true);
    const body = await getResponse.text();
    expect(body).toBe(TEST_CONTENT);
  }, 30_000); // generous timeout — GCS round-trip in CI can be slow

  it("creates an independent object copy for split-request attachments", async () => {
    const testContent = "eto-tracker-split-copy-test-" + Date.now();
    const rawUploadURL = await service.getObjectEntityUploadURL();
    const sourcePath = service.normalizeObjectEntityPath(rawUploadURL);
    let copiedPath: string | null = null;

    try {
      const putResponse = await fetch(rawUploadURL, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: testContent,
      });
      expect(putResponse.ok).toBe(true);

      copiedPath = await service.copyObjectEntity(sourcePath);
      expect(copiedPath).toMatch(/^\/objects\/splits\//);
      expect(copiedPath).not.toBe(sourcePath);

      const copiedDownloadURL = await service.getObjectEntityDownloadURL(copiedPath);
      const copiedResponse = await fetch(copiedDownloadURL);
      expect(copiedResponse.ok).toBe(true);
      expect(await copiedResponse.text()).toBe(testContent);

      await service.deleteObjectEntity(sourcePath);
      await expect(service.getObjectEntityFile(copiedPath)).resolves.toBeDefined();
    } finally {
      await Promise.allSettled([
        service.deleteObjectEntity(sourcePath),
        ...(copiedPath ? [service.deleteObjectEntity(copiedPath)] : []),
      ]);
    }
  }, 30_000);

  it("returns an error for a storageKey that does not start with /objects/", async () => {
    await expect(
      service.getObjectEntityDownloadURL("not-a-valid-path"),
    ).rejects.toThrow();
  });

  it("normalizeObjectEntityPath returns the raw path unchanged when it is not a GCS URL", () => {
    const rawPath = "/objects/uploads/already-normalized";
    const normalized = service.normalizeObjectEntityPath(rawPath);
    expect(normalized).toBe(rawPath);
  });

  it("normalizeObjectEntityPath converts a full GCS URL to /objects/ format", async () => {
    // We need a real upload URL to get a real GCS URL for this assertion
    const rawUploadURL = await service.getObjectEntityUploadURL();
    const objectPath = service.normalizeObjectEntityPath(rawUploadURL);

    expect(objectPath).toMatch(/^\/objects\//);
    // Must not contain query params
    expect(objectPath).not.toContain("?");
    // Path is stable — round-trip should be idempotent
    expect(service.normalizeObjectEntityPath(objectPath)).toBe(objectPath);
  }, 15_000);
});

// ── Always-run unit tests (no sidecar required) ─────────────────────────────

describe("ObjectStorageService — path validation (no sidecar)", () => {
  it("getObjectEntityDownloadURL rejects keys not starting with /objects/", async () => {
    process.env.PRIVATE_OBJECT_DIR = "/my-bucket/private";
    const service = new ObjectStorageService();

    await expect(
      service.getObjectEntityDownloadURL("uploads/abc-123"),
    ).rejects.toThrow();
  });

  it("getObjectEntityDownloadURL rejects an empty string key", async () => {
    process.env.PRIVATE_OBJECT_DIR = "/my-bucket/private";
    const service = new ObjectStorageService();

    await expect(
      service.getObjectEntityDownloadURL(""),
    ).rejects.toThrow();
  });

  it("normalizeObjectEntityPath returns a non-GCS path unchanged", () => {
    process.env.PRIVATE_OBJECT_DIR = "/my-bucket/private";
    process.env.PUBLIC_OBJECT_SEARCH_PATHS = "/my-bucket/public";
    const service = new ObjectStorageService();

    expect(service.normalizeObjectEntityPath("/objects/uploads/abc")).toBe(
      "/objects/uploads/abc",
    );
    expect(service.normalizeObjectEntityPath("relative/path")).toBe(
      "relative/path",
    );
  });
});
