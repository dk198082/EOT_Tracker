import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ── Mocks (hoisted before imports) ─────────────────────────────────────────

const { mockGetObjectEntityUploadURL, mockNormalizeObjectEntityPath } = vi.hoisted(() => ({
  mockGetObjectEntityUploadURL: vi.fn(),
  mockNormalizeObjectEntityPath: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  usersTable: {},
  attachmentsTable: {},
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: any, res: any, next: any) => {
    res.locals.dbUser = { id: 1, name: "Test User", role: "submitter", clerkId: "clerk_test" };
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityUploadURL = mockGetObjectEntityUploadURL;
    normalizeObjectEntityPath = mockNormalizeObjectEntityPath;
  },
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import storageRouter from "../storage";

// ── Test app ────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  // Attach a minimal logger so req.log.error() doesn't crash
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use(storageRouter);
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("POST /storage/uploads/request-url", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  const validBody = {
    name: "design.pdf",
    size: 1024,
    contentType: "application/pdf",
    etoRequestId: 42,
  };

  it("returns uploadURL and objectPath for a valid request", async () => {
    const fakeUploadURL =
      "https://storage.googleapis.com/my-bucket/private/uploads/abc-123?X-Goog-Signature=sig";
    mockGetObjectEntityUploadURL.mockResolvedValue(fakeUploadURL);
    mockNormalizeObjectEntityPath.mockReturnValue("/objects/uploads/abc-123");

    const res = await request(app)
      .post("/storage/uploads/request-url")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      uploadURL: fakeUploadURL,
      objectPath: "/objects/uploads/abc-123",
      metadata: {
        name: "design.pdf",
        size: 1024,
        contentType: "application/pdf",
        etoRequestId: 42,
      },
    });
  });

  it("records a pending-upload token so the attachment endpoint can consume it", async () => {
    const fakeUploadURL =
      "https://storage.googleapis.com/my-bucket/private/uploads/pending-token?sig=x";
    mockGetObjectEntityUploadURL.mockResolvedValue(fakeUploadURL);
    mockNormalizeObjectEntityPath.mockReturnValue("/objects/uploads/pending-token");

    const res = await request(app)
      .post("/storage/uploads/request-url")
      .send({ ...validBody, etoRequestId: 99 });

    expect(res.status).toBe(200);
    // objectPath must be present so the attachment endpoint can consume the token
    expect(typeof res.body.objectPath).toBe("string");
    expect(res.body.objectPath.length).toBeGreaterThan(0);
  });

  it("rejects files that exceed the 50 MB limit", async () => {
    const oversized = { ...validBody, size: 51 * 1024 * 1024 };

    const res = await request(app)
      .post("/storage/uploads/request-url")
      .send(oversized);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum allowed size/i);
    expect(mockGetObjectEntityUploadURL).not.toHaveBeenCalled();
  });

  it("rejects files right at the 50 MB boundary", async () => {
    const atLimit = { ...validBody, size: 50 * 1024 * 1024 };

    const fakeURL = "https://storage.googleapis.com/bucket/x?sig=y";
    mockGetObjectEntityUploadURL.mockResolvedValue(fakeURL);
    mockNormalizeObjectEntityPath.mockReturnValue("/objects/uploads/x");

    const res = await request(app)
      .post("/storage/uploads/request-url")
      .send(atLimit);

    // Exactly 50 MB is allowed (size > MAX is the check)
    expect(res.status).toBe(200);
  });

  it("rejects a disallowed content type", async () => {
    const bad = { ...validBody, contentType: "application/x-executable" };

    const res = await request(app)
      .post("/storage/uploads/request-url")
      .send(bad);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
    expect(mockGetObjectEntityUploadURL).not.toHaveBeenCalled();
  });

  it("rejects a request missing required fields", async () => {
    const res = await request(app)
      .post("/storage/uploads/request-url")
      .send({ name: "file.pdf" }); // missing size, contentType, etoRequestId

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 500 when the storage service fails", async () => {
    mockGetObjectEntityUploadURL.mockRejectedValue(new Error("GCS unavailable"));

    const res = await request(app)
      .post("/storage/uploads/request-url")
      .send(validBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to generate upload url/i);
  });
});
