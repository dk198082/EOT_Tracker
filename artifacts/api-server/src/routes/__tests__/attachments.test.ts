import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { Router } from "express";
import { Readable } from "stream";

// ── Mocks (hoisted before imports) ─────────────────────────────────────────

// vi.hoisted ensures these are available inside vi.mock() factory closures,
// which are hoisted before variable declarations.
const { mockDbSelect, mockDbInsert, mockGetObjectEntityDownloadURL, mockGetObjectEntityFile } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockGetObjectEntityDownloadURL: vi.fn(),
  mockGetObjectEntityFile: vi.fn(),
}));

// Mock DB before @workspace/db is imported so the module-level `db` init
// (which throws without DATABASE_URL) never executes.
vi.mock("@workspace/db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    insert: (...args: any[]) => mockDbInsert(...args),
  },
  attachmentsTable: { id: "id", etoRequestId: "etoRequestId", uploaderId: "uploaderId" },
  usersTable: { id: "id", name: "name", clerkId: "clerkId" },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.get("x-test-unauthenticated") === "true") {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }
    if (req.get("x-test-no-role") === "true") {
      res.status(403).json({ error: "An ETO app role must be assigned before accessing app data" });
      return;
    }
    res.locals.dbUser = {
      id: 7,
      name: "Ada Lovelace",
      role: "submitter",
      clerkId: "clerk_ada",
      email: "ada@example.com",
      createdAt: new Date("2024-01-01"),
    };
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  ObjectStorageService: class {
    getObjectEntityDownloadURL = mockGetObjectEntityDownloadURL;
    getObjectEntityFile = mockGetObjectEntityFile;
  },
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import attachmentsRouter from "../attachments";
import { recordPendingUpload } from "../../lib/pendingUploads";
vi.mock("../../lib/shared-merge/database", () => ({
  archiveStore: { epoch: vi.fn(async () => null) },
}));

// ── Shared test fixtures ────────────────────────────────────────────────────

const TEST_USER = {
  id: 7,
  name: "Ada Lovelace",
  role: "submitter" as const,
  clerkId: "clerk_ada",
  email: "ada@example.com",
  createdAt: new Date("2024-01-01"),
};

const MOCK_ATTACHMENT = {
  id: 1,
  etoRequestId: 42,
  uploaderId: 7,
  filename: "spec.pdf",
  storageKey: "/objects/uploads/abc-123",
  contentType: "application/pdf",
  fileSize: 2048,
  createdAt: new Date("2024-06-01").toISOString(),
};

// ── Test app factory ─────────────────────────────────────────────────────────

/**
 * Wraps the attachments router inside a parent router that provides the :id
 * param, matching how the real app mounts it.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => req.get("x-test-unauthenticated") !== "true";
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });

  // Mirror the real mount: /eto-requests/:id/attachments
  const parent = Router();
  parent.use("/:id/attachments", attachmentsRouter);
  app.use("/eto-requests", parent);

  return app;
}

// ── Helper ───────────────────────────────────────────────────────────────────

/** Make a chainable Drizzle-like select mock that resolves to `rows`. */
function makeSelectChain(rows: any[]) {
  const chain: any = {};
  const terminal = vi.fn().mockResolvedValue(rows);
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = terminal;
  chain.limit = terminal;
  return chain;
}

/** Make a chainable Drizzle-like insert mock that resolves to `rows`. */
function makeInsertChain(rows: any[]) {
  return {
    values: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue(rows),
    })),
  };
}

// ── GET /eto-requests/:id/attachments ────────────────────────────────────────

describe("GET /eto-requests/:id/attachments", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("returns an empty array when no attachments exist", async () => {
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const res = await request(app).get("/eto-requests/42/attachments");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns attachment rows with uploader name", async () => {
    mockDbSelect.mockReturnValue(
      makeSelectChain([{ a: MOCK_ATTACHMENT, uploaderName: TEST_USER.name }]),
    );

    const res = await request(app).get("/eto-requests/42/attachments");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 1,
      filename: "spec.pdf",
      storageKey: "/objects/uploads/abc-123",
      uploaderName: "Ada Lovelace",
    });
  });

  it("reflects a newly registered file in the list", async () => {
    const newAttachment = { ...MOCK_ATTACHMENT, id: 2, filename: "drawing.png" };
    mockDbSelect.mockReturnValue(
      makeSelectChain([
        { a: MOCK_ATTACHMENT, uploaderName: TEST_USER.name },
        { a: newAttachment, uploaderName: TEST_USER.name },
      ]),
    );

    const res = await request(app).get("/eto-requests/42/attachments");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[1].filename).toBe("drawing.png");
  });

  it("returns 400 for a non-numeric ETO id", async () => {
    const res = await request(app).get("/eto-requests/not-a-number/attachments");
    expect(res.status).toBe(400);
  });
});

// ── POST /eto-requests/:id/attachments ───────────────────────────────────────

describe("POST /eto-requests/:id/attachments", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("registers an attachment and returns 201 when a valid pending token exists", async () => {
    // Mint a pending upload for this user + ETO
    const storageKey = "/objects/uploads/valid-key-001";
    recordPendingUpload(storageKey, {
      userId: TEST_USER.id,
      etoRequestId: 42,
      contentType: "application/pdf",
      fileSize: 2048,
    });

    mockDbInsert.mockReturnValue(
      makeInsertChain([
        { ...MOCK_ATTACHMENT, storageKey },
      ]),
    );

    const res = await request(app)
      .post("/eto-requests/42/attachments")
      .send({
        filename: "spec.pdf",
        storageKey,
        contentType: "application/pdf",
        fileSize: 2048,
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 1,
      storageKey,
      filename: "spec.pdf",
      uploaderName: TEST_USER.name,
    });
  });

  it("rejects registration when no pending upload token exists for the key", async () => {
    const res = await request(app)
      .post("/eto-requests/42/attachments")
      .send({
        filename: "spec.pdf",
        storageKey: "/objects/uploads/unknown-key",
        contentType: "application/pdf",
        fileSize: 2048,
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/unknown or expired/i);
  });

  it("rejects registration when the token was minted for a different ETO", async () => {
    const storageKey = "/objects/uploads/wrong-eto-key";
    recordPendingUpload(storageKey, {
      userId: TEST_USER.id,
      etoRequestId: 99, // different ETO
      contentType: "application/pdf",
      fileSize: 2048,
    });

    const res = await request(app)
      .post("/eto-requests/42/attachments") // ETO 42, but token is for 99
      .send({
        filename: "spec.pdf",
        storageKey,
        contentType: "application/pdf",
        fileSize: 2048,
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/different eto/i);
  });

  it("rejects registration when the token was minted for a different user", async () => {
    const storageKey = "/objects/uploads/wrong-user-key";
    recordPendingUpload(storageKey, {
      userId: 999, // different user
      etoRequestId: 42,
      contentType: "application/pdf",
      fileSize: 2048,
    });

    const res = await request(app)
      .post("/eto-requests/42/attachments")
      .send({
        filename: "spec.pdf",
        storageKey,
        contentType: "application/pdf",
        fileSize: 2048,
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/different user/i);
  });

  it("consumes the pending upload token (replay is rejected)", async () => {
    const storageKey = "/objects/uploads/one-time-key";
    recordPendingUpload(storageKey, {
      userId: TEST_USER.id,
      etoRequestId: 42,
      contentType: "application/pdf",
      fileSize: 512,
    });

    mockDbInsert.mockReturnValue(makeInsertChain([{ ...MOCK_ATTACHMENT, storageKey }]));

    // First attempt succeeds
    await request(app)
      .post("/eto-requests/42/attachments")
      .send({ filename: "f.pdf", storageKey, contentType: "application/pdf", fileSize: 512 });

    // Second attempt with the same key must be rejected
    const replay = await request(app)
      .post("/eto-requests/42/attachments")
      .send({ filename: "f.pdf", storageKey, contentType: "application/pdf", fileSize: 512 });

    expect(replay.status).toBe(422);
  });

  it("returns 400 for a non-numeric ETO id", async () => {
    const res = await request(app)
      .post("/eto-requests/nan/attachments")
      .send({ filename: "x.pdf", storageKey: "/objects/uploads/k", contentType: "application/pdf", fileSize: 1 });
    expect(res.status).toBe(400);
  });
});

// ── GET /eto-requests/:id/attachments/:attachmentId/download ─────────────────

describe("GET /eto-requests/:id/attachments/:attachmentId/download", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  it("returns a signed download URL for a valid attachment", async () => {
    mockDbSelect.mockReturnValue(makeSelectChain([MOCK_ATTACHMENT]));
    mockGetObjectEntityDownloadURL.mockResolvedValue("https://signed.url/file?token=abc");

    const res = await request(app).get("/eto-requests/42/attachments/1/download");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://signed.url/file?token=abc" });
  });

  it("returns 404 when the attachment does not exist", async () => {
    mockDbSelect.mockReturnValue(makeSelectChain([])); // no rows returned

    const res = await request(app).get("/eto-requests/42/attachments/999/download");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 when the attachment belongs to a different ETO", async () => {
    const wrongEto = { ...MOCK_ATTACHMENT, etoRequestId: 77 }; // different ETO
    mockDbSelect.mockReturnValue(makeSelectChain([wrongEto]));

    const res = await request(app).get("/eto-requests/42/attachments/1/download");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 500 (not a crash) when the storage key is invalid/unrecognised", async () => {
    const badKey = { ...MOCK_ATTACHMENT, storageKey: "not-a-valid-path" };
    mockDbSelect.mockReturnValue(makeSelectChain([badKey]));
    mockGetObjectEntityDownloadURL.mockRejectedValue(new Error("Object not found"));

    const res = await request(app).get("/eto-requests/42/attachments/1/download");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to generate download url/i);
  });

  it("returns 500 (not a crash) when the storage service is unavailable", async () => {
    mockDbSelect.mockReturnValue(makeSelectChain([MOCK_ATTACHMENT]));
    mockGetObjectEntityDownloadURL.mockRejectedValue(new Error("GCS timeout"));

    const res = await request(app).get("/eto-requests/42/attachments/1/download");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to generate download url/i);
  });

  it("returns 400 for a non-numeric attachment id", async () => {
    const res = await request(app).get("/eto-requests/42/attachments/bad-id/download");
    expect(res.status).toBe(400);
  });
});

// ── GET /eto-requests/:id/attachments/:attachmentId/preview ──────────────────

describe("GET /eto-requests/:id/attachments/:attachmentId/preview", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "attachment-preview-test-secret";
    app = buildApp();
  });

  it("streams a PDF inline from the authenticated app origin", async () => {
    const bytes = Buffer.from("%PDF-1.4 preview");
    mockDbSelect.mockReturnValue(makeSelectChain([{
      ...MOCK_ATTACHMENT,
      fileSize: bytes.length,
    }]));
    mockGetObjectEntityFile.mockResolvedValue({
      createReadStream: () => Readable.from(bytes),
    });

    const res = await request(app).get("/eto-requests/42/attachments/1/preview");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.headers["content-disposition"]).toContain("spec.pdf");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(mockGetObjectEntityFile).toHaveBeenCalledWith(MOCK_ATTACHMENT.storageKey);
  });

  it("returns 404 when the attachment belongs to a different ETO", async () => {
    mockDbSelect.mockReturnValue(makeSelectChain([{
      ...MOCK_ATTACHMENT,
      etoRequestId: 77,
    }]));

    const res = await request(app).get("/eto-requests/42/attachments/1/preview");

    expect(res.status).toBe(404);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });

  it("rejects types that are unsafe or unsupported for inline preview", async () => {
    mockDbSelect.mockReturnValue(makeSelectChain([{
      ...MOCK_ATTACHMENT,
      filename: "worksheet.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }]));

    const res = await request(app).get("/eto-requests/42/attachments/1/preview");

    expect(res.status).toBe(415);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });

  it("issues a signed preview link and accepts it without an auth header", async () => {
    const bytes = Buffer.from("%PDF-1.7 signed preview");
    mockDbSelect.mockReturnValue(makeSelectChain([{
      ...MOCK_ATTACHMENT,
      fileSize: bytes.length,
    }]));
    mockGetObjectEntityFile.mockResolvedValue({
      createReadStream: () => Readable.from(bytes),
    });

    const linkResponse = await request(app)
      .get("/eto-requests/42/attachments/1/preview-link");

    expect(linkResponse.status).toBe(200);
    expect(linkResponse.body.url).toMatch(
      /^\/api\/eto-requests\/42\/attachments\/1\/preview\?expires=\d+&signature=/,
    );

    const previewPath = linkResponse.body.url.replace(/^\/api/, "");
    const previewResponse = await request(app)
      .get(previewPath)
      .set("x-test-unauthenticated", "true");

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(previewResponse.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("denies a signed preview to a signed-in user without an ETO role", async () => {
    const bytes = Buffer.from("%PDF-1.7 signed preview");
    mockDbSelect.mockReturnValue(makeSelectChain([{
      ...MOCK_ATTACHMENT,
      fileSize: bytes.length,
    }]));
    mockGetObjectEntityFile.mockResolvedValue({
      createReadStream: () => Readable.from(bytes),
    });

    const linkResponse = await request(app)
      .get("/eto-requests/42/attachments/1/preview-link");
    const previewPath = linkResponse.body.url.replace(/^\/api/, "");

    const previewResponse = await request(app)
      .get(previewPath)
      .set("x-test-no-role", "true");

    expect(linkResponse.status).toBe(200);
    expect(previewResponse.status).toBe(403);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });

  it("rejects an unsigned preview request without authentication", async () => {
    const res = await request(app)
      .get("/eto-requests/42/attachments/1/preview")
      .set("x-test-unauthenticated", "true");

    expect(res.status).toBe(401);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
  });
});
