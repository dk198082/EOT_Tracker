/**
 * End-to-end flow tests for file upload and download.
 *
 * These tests chain through the actual endpoints in sequence — mirroring
 * exactly what a client does:
 *
 *   1. POST /storage/uploads/request-url   → receive uploadURL + objectPath
 *   2. (client PUTs bytes to uploadURL — simulated via the storage mock)
 *   3. POST /eto-requests/:id/attachments  → register with the objectPath from step 1
 *   4. GET  /eto-requests/:id/attachments  → confirm the new file appears in the list
 *   5. GET  /eto-requests/:id/attachments/:aid/download → receive signed download URL
 *
 * Critically, steps 3–5 consume the pending-upload token that step 1 minted.
 * Any broken handoff between the two routers (wrong path, wrong user, wrong ETO)
 * is caught here without manual token seeding.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { Router } from "express";

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockGetObjectEntityUploadURL,
  mockNormalizeObjectEntityPath,
  mockGetObjectEntityDownloadURL,
  mockDbSelect,
  mockDbInsert,
  shouldAuthenticate,
} = vi.hoisted(() => ({
  mockGetObjectEntityUploadURL: vi.fn(),
  mockNormalizeObjectEntityPath: vi.fn(),
  mockGetObjectEntityDownloadURL: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  // Shared flag — set to false in a test to simulate an unauthenticated request
  shouldAuthenticate: { value: true },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    insert: (...args: any[]) => mockDbInsert(...args),
  },
  attachmentsTable: { id: "id", etoRequestId: "etoRequestId", uploaderId: "uploaderId" },
  usersTable: { id: "id", name: "name", clerkId: "clerkId" },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: any, res: any, next: any) => {
    if (!shouldAuthenticate.value) {
      res.status(401).json({ error: "Unauthenticated" });
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
  ObjectStorageService: class {
    getObjectEntityUploadURL = mockGetObjectEntityUploadURL;
    normalizeObjectEntityPath = mockNormalizeObjectEntityPath;
    getObjectEntityDownloadURL = mockGetObjectEntityDownloadURL;
  },
}));

// ── Import routers after mocks ──────────────────────────────────────────────

import storageRouter from "../storage";
import attachmentsRouter from "../attachments";

// ── Shared fixtures ─────────────────────────────────────────────────────────

const ETO_ID = 42;
const ATTACHMENT_ID = 1;

/** Chainable Drizzle-style select mock. Terminal method resolves to rows. */
function makeSelectChain(rows: any[]) {
  const terminal = vi.fn().mockResolvedValue(rows);
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: terminal,
    limit: terminal,
  };
  return chain;
}

/** Chainable Drizzle-style insert mock. */
function makeInsertChain(rows: any[]) {
  return {
    values: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue(rows),
    })),
  };
}

// ── Test app ────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });

  // Storage router sits at the root (mirrors real mount via /api prefix in app.ts)
  app.use(storageRouter);

  // Attachments router needs the parent :id param (mirrors real mount)
  const parent = Router();
  parent.use("/:id/attachments", attachmentsRouter);
  app.use("/eto-requests", parent);

  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Full upload → register → list → download flow", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    shouldAuthenticate.value = true;
    app = buildApp();
  });

  it("chains request-url → register → list → download without manual token seeding", async () => {
    // ── Step 1: request a presigned upload URL ─────────────────────────────
    const fakeUploadURL =
      "https://storage.googleapis.com/my-bucket/private/uploads/flow-uuid-001?X-Goog-Signature=sig";
    const expectedObjectPath = "/objects/uploads/flow-uuid-001";

    mockGetObjectEntityUploadURL.mockResolvedValue(fakeUploadURL);
    mockNormalizeObjectEntityPath.mockReturnValue(expectedObjectPath);

    const urlRes = await request(app)
      .post("/storage/uploads/request-url")
      .send({
        name: "drawing.pdf",
        size: 4096,
        contentType: "application/pdf",
        etoRequestId: ETO_ID,
      });

    expect(urlRes.status).toBe(200);
    expect(urlRes.body.uploadURL).toBe(fakeUploadURL);
    const objectPath: string = urlRes.body.objectPath;
    expect(objectPath).toBe(expectedObjectPath);

    // ── Step 2: client uploads bytes to the presigned URL ─────────────────
    // (In production the client PUTs directly to GCS; we verify the URL was
    // returned and trust the storage mock simulates a successful upload.)
    expect(urlRes.body.uploadURL).toMatch(/^https:\/\//);

    // ── Step 3: register the attachment using the objectPath from step 1 ──
    const savedAttachment = {
      id: ATTACHMENT_ID,
      etoRequestId: ETO_ID,
      uploaderId: 7,
      filename: "drawing.pdf",
      storageKey: objectPath,
      contentType: "application/pdf",
      fileSize: 4096,
      createdAt: new Date("2024-06-01").toISOString(),
    };
    mockDbInsert.mockReturnValue(makeInsertChain([savedAttachment]));

    const registerRes = await request(app)
      .post(`/eto-requests/${ETO_ID}/attachments`)
      .send({
        filename: "drawing.pdf",
        storageKey: objectPath, // the path minted by step 1
        contentType: "application/pdf",
        fileSize: 4096,
      });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.storageKey).toBe(objectPath);
    expect(registerRes.body.filename).toBe("drawing.pdf");

    // ── Step 4: list attachments — new file must appear ───────────────────
    mockDbSelect.mockReturnValue(
      makeSelectChain([{ a: savedAttachment, uploaderName: "Ada Lovelace" }]),
    );

    const listRes = await request(app).get(`/eto-requests/${ETO_ID}/attachments`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].storageKey).toBe(objectPath);
    expect(listRes.body[0].uploaderName).toBe("Ada Lovelace");

    // ── Step 5: request a download URL ────────────────────────────────────
    const signedDownloadURL = "https://signed.download.url/drawing.pdf?token=xyz";
    mockDbSelect.mockReturnValue(makeSelectChain([savedAttachment]));
    mockGetObjectEntityDownloadURL.mockResolvedValue(signedDownloadURL);

    const downloadRes = await request(app).get(
      `/eto-requests/${ETO_ID}/attachments/${ATTACHMENT_ID}/download`,
    );

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.body.url).toBe(signedDownloadURL);
  });

  it("rejects a second registration attempt with the same objectPath (token consumed after step 3)", async () => {
    const fakeUploadURL =
      "https://storage.googleapis.com/bucket/private/uploads/one-time?sig=abc";
    const objectPath = "/objects/uploads/one-time";

    mockGetObjectEntityUploadURL.mockResolvedValue(fakeUploadURL);
    mockNormalizeObjectEntityPath.mockReturnValue(objectPath);
    mockDbInsert.mockReturnValue(
      makeInsertChain([
        {
          id: 2,
          etoRequestId: ETO_ID,
          uploaderId: 7,
          filename: "file.pdf",
          storageKey: objectPath,
          contentType: "application/pdf",
          fileSize: 1024,
          createdAt: new Date().toISOString(),
        },
      ]),
    );

    // Step 1: mint a token
    await request(app)
      .post("/storage/uploads/request-url")
      .send({ name: "file.pdf", size: 1024, contentType: "application/pdf", etoRequestId: ETO_ID });

    // Step 3a: first registration succeeds
    const first = await request(app)
      .post(`/eto-requests/${ETO_ID}/attachments`)
      .send({ filename: "file.pdf", storageKey: objectPath, contentType: "application/pdf", fileSize: 1024 });

    expect(first.status).toBe(201);

    // Step 3b: replay with the same path is rejected — token was consumed
    const replay = await request(app)
      .post(`/eto-requests/${ETO_ID}/attachments`)
      .send({ filename: "file.pdf", storageKey: objectPath, contentType: "application/pdf", fileSize: 1024 });

    expect(replay.status).toBe(422);
    expect(replay.body.error).toMatch(/unknown or expired/i);
  });

  it("fails registration when objectPath was minted for a different ETO", async () => {
    const fakeUploadURL =
      "https://storage.googleapis.com/bucket/private/uploads/wrong-eto?sig=def";
    const objectPath = "/objects/uploads/wrong-eto";

    mockGetObjectEntityUploadURL.mockResolvedValue(fakeUploadURL);
    mockNormalizeObjectEntityPath.mockReturnValue(objectPath);

    // Mint token for ETO 99
    await request(app)
      .post("/storage/uploads/request-url")
      .send({ name: "x.pdf", size: 512, contentType: "application/pdf", etoRequestId: 99 });

    // Attempt to register on ETO 42 — must be rejected
    const res = await request(app)
      .post(`/eto-requests/${ETO_ID}/attachments`)
      .send({ filename: "x.pdf", storageKey: objectPath, contentType: "application/pdf", fileSize: 512 });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/different eto/i);
  });

  it("returns 404 from download when objectPath does not match the given ETO", async () => {
    const attachment = {
      id: 5,
      etoRequestId: 77, // different ETO than requested
      uploaderId: 7,
      filename: "secret.pdf",
      storageKey: "/objects/uploads/secret",
      contentType: "application/pdf",
      fileSize: 256,
      createdAt: new Date().toISOString(),
    };
    mockDbSelect.mockReturnValue(makeSelectChain([attachment]));

    const res = await request(app).get(`/eto-requests/${ETO_ID}/attachments/5/download`);

    expect(res.status).toBe(404);
    expect(mockGetObjectEntityDownloadURL).not.toHaveBeenCalled();
  });

  it("returns 500 from download when storage service fails, rather than crashing", async () => {
    const attachment = {
      id: 6,
      etoRequestId: ETO_ID,
      uploaderId: 7,
      filename: "broken.pdf",
      storageKey: "/objects/uploads/broken",
      contentType: "application/pdf",
      fileSize: 512,
      createdAt: new Date().toISOString(),
    };
    mockDbSelect.mockReturnValue(makeSelectChain([attachment]));
    mockGetObjectEntityDownloadURL.mockRejectedValue(new Error("GCS sidecar unavailable"));

    const res = await request(app).get(`/eto-requests/${ETO_ID}/attachments/6/download`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to generate download url/i);
  });
});

// ── Authentication boundary tests ───────────────────────────────────────────

describe("Authentication enforcement on upload and attachment endpoints", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    shouldAuthenticate.value = false; // no valid session
    app = buildApp();
  });

  it("rejects unauthenticated requests to request-url", async () => {
    const res = await request(app)
      .post("/storage/uploads/request-url")
      .send({ name: "x.pdf", size: 512, contentType: "application/pdf", etoRequestId: 1 });

    expect(res.status).toBe(401);
    expect(mockGetObjectEntityUploadURL).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests to register an attachment", async () => {
    const res = await request(app)
      .post(`/eto-requests/${ETO_ID}/attachments`)
      .send({ filename: "x.pdf", storageKey: "/objects/uploads/k", contentType: "application/pdf", fileSize: 1 });

    expect(res.status).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests to list attachments", async () => {
    const res = await request(app).get(`/eto-requests/${ETO_ID}/attachments`);

    expect(res.status).toBe(401);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests to download an attachment", async () => {
    const res = await request(app).get(`/eto-requests/${ETO_ID}/attachments/1/download`);

    expect(res.status).toBe(401);
    expect(mockGetObjectEntityDownloadURL).not.toHaveBeenCalled();
  });
});
