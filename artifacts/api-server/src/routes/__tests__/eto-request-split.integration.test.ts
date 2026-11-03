import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";

const { authState, mockCopyObjectEntity, mockDeleteObjectEntity } = vi.hoisted(() => ({
  authState: { user: null as any },
  mockCopyObjectEntity: vi.fn(),
  mockDeleteObjectEntity: vi.fn(),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = authState.user;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    copyObjectEntity = (...args: unknown[]) => mockCopyObjectEntity(...args);
    deleteObjectEntity = (...args: unknown[]) => mockDeleteObjectEntity(...args);
  },
}));

vi.mock("../../lib/email", () => ({
  sendTransitionEmails: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@workspace/db";
import {
  attachmentsTable,
  etoRequestsTable,
  stageTransitionsTable,
  usersTable,
} from "@workspace/db/schema";
import etoRequestsRouter from "../eto-requests";
import transitionsRouter from "../transitions";

const TEST_PREFIX = `ETO-SPLIT-TEST-${randomUUID().slice(0, 8)}`;
let testUser: typeof usersTable.$inferSelect;
let copySequence = 0;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  const router = Router();
  router.use("/eto-requests", etoRequestsRouter);
  router.use("/eto-requests/:id/transitions", transitionsRouter);
  app.use(router);
  app.use((_err: unknown, _req: unknown, res: any, _next: unknown) => {
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

async function createSource(stage = "art-review") {
  const [source] = await db
    .insert(etoRequestsTable)
    .values({
      etoNumber: `${TEST_PREFIX}-${randomUUID().slice(0, 6)}`,
      customerName: "Split Test Customer",
      quoteNumber: "Q-SPLIT-TEST",
      quoteRevision: "A",
      testType: "",
      distributor: "No",
      requestType: "Machine",
      machineType: "ST",
      expectedForceRange: "10 kN",
      expectedForceUnit: "N",
      expectedDisplacement: "25 mm",
      expectedDisplacementUnit: "mm",
      resultsRequired: "Report",
      budgetRange: "1000",
      budgetCurrency: "USD",
      acceptableLeadTime: "4",
      similarParts: "None",
      materials: "Steel",
      specimenDimensions: "10 x 10 mm",
      relevantStandards: "ASTM",
      customerComponents: "Fixture",
      customDetails: "Route integration test",
      stage,
      submittedById: testUser.id,
    })
    .returning();
  return source;
}

async function cleanupTestRequests() {
  const roots = await db
    .select({ id: etoRequestsTable.id })
    .from(etoRequestsTable)
    .where(like(etoRequestsTable.etoNumber, `${TEST_PREFIX}%`));
  const rootIds = roots.map((row) => row.id);
  for (const rootId of rootIds) {
    await db
      .delete(etoRequestsTable)
      .where(eq(etoRequestsTable.parentEtoRequestId, rootId));
  }
  await db
    .delete(etoRequestsTable)
    .where(like(etoRequestsTable.etoNumber, `${TEST_PREFIX}%`));
}

describe("POST /eto-requests/:id/split integration", () => {
  beforeAll(async () => {
    [testUser] = await db
      .insert(usersTable)
      .values({
        authId: `split-test-${randomUUID()}`,
        name: "Split Route Test",
        email: `split-${randomUUID()}@example.com`,
        role: "art",
      })
      .returning();
    authState.user = testUser;
  });

  beforeEach(() => {
    copySequence = 0;
    authState.user = testUser;
    mockCopyObjectEntity.mockReset();
    mockDeleteObjectEntity.mockReset();
    mockCopyObjectEntity.mockImplementation(async () => {
      copySequence += 1;
      return `/objects/splits/test-copy-${copySequence}`;
    });
    mockDeleteObjectEntity.mockResolvedValue(undefined);
  });

  afterEach(cleanupTestRequests);

  afterAll(async () => {
    await cleanupTestRequests();
    await db.delete(usersTable).where(eq(usersTable.id, testUser.id));
  });

  it("enforces ART permissions and source eligibility", async () => {
    const app = buildApp();
    const source = await createSource();

    authState.user = { ...testUser, role: "sales" };
    expect((await request(app).post(`/eto-requests/${source.id}/split`).send({ count: 2 })).status).toBe(403);

    authState.user = testUser;
    const draft = await createSource("draft");
    expect((await request(app).post(`/eto-requests/${draft.id}/split`).send({ count: 2 })).status).toBe(422);

    const parent = await createSource();
    const [child] = await db
      .insert(etoRequestsTable)
      .values({
        ...parent,
        id: undefined,
        etoNumber: `${parent.etoNumber}-01`,
        parentEtoRequestId: parent.id,
        splitSequence: 1,
      })
      .returning();
    expect((await request(app).post(`/eto-requests/${child.id}/split`).send({ count: 2 })).status).toBe(422);
  });

  it("copies details and attachments, records audit entries, and rejects a second split", async () => {
    const app = buildApp();
    const source = await createSource();
    await db.insert(attachmentsTable).values({
      etoRequestId: source.id,
      uploaderId: testUser.id,
      filename: "source.txt",
      storageKey: "/objects/uploads/source",
      contentType: "text/plain",
      fileSize: 12,
      searchText: "source attachment",
      searchStatus: "complete",
    });

    const response = await request(app)
      .post(`/eto-requests/${source.id}/split`)
      .send({ count: 2 });

    expect(response.status).toBe(201);
    expect(response.body.children.map((child: any) => child.etoNumber)).toEqual([
      `${source.etoNumber}-01`,
      `${source.etoNumber}-02`,
    ]);
    expect(response.body.original).toMatchObject({
      splitFamilyId: source.id,
      splitFamilyNumber: source.etoNumber,
      splitFamilyPosition: 0,
    });
    expect(response.body.children.map((child: any) => ({
      familyId: child.splitFamilyId,
      familyNumber: child.splitFamilyNumber,
      position: child.splitFamilyPosition,
    }))).toEqual([
      { familyId: source.id, familyNumber: source.etoNumber, position: 1 },
      { familyId: source.id, familyNumber: source.etoNumber, position: 2 },
    ]);

    const children = await db
      .select()
      .from(etoRequestsTable)
      .where(eq(etoRequestsTable.parentEtoRequestId, source.id));
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.stage === "art-review")).toBe(true);
    expect(children.every((child) => child.customerName === source.customerName)).toBe(true);
    expect(children.every((child) => child.expectedForceUnit === "N")).toBe(true);
    expect(children.every((child) => child.expectedDisplacementUnit === "mm")).toBe(true);

    const childAttachments = await db
      .select()
      .from(attachmentsTable)
      .where(eq(attachmentsTable.etoRequestId, children[0].id));
    expect(childAttachments).toHaveLength(1);
    expect(childAttachments[0].storageKey).not.toBe("/objects/uploads/source");

    const firstChild = children.find((child) => child.splitSequence === 1)!;
    const secondChild = children.find((child) => child.splitSequence === 2)!;
    const memberOnlySearch = `member-only-${randomUUID()}`;
    await db
      .update(etoRequestsTable)
      .set({
        stage: "engineering-review",
        assigneeId: testUser.id,
        customDetails: memberOnlySearch,
        updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      })
      .where(eq(etoRequestsTable.id, firstChild.id));
    await db
      .update(etoRequestsTable)
      .set({ stage: "production-review" })
      .where(eq(etoRequestsTable.id, secondChild.id));

    const expectedFamilyNumbers = [
      source.etoNumber,
      `${source.etoNumber}-01`,
      `${source.etoNumber}-02`,
    ];
    for (const query of [
      { stage: "engineering-review", search: source.etoNumber },
      { assigneeId: testUser.id, search: source.etoNumber },
      { overdue: true, search: source.etoNumber },
      { search: memberOnlySearch },
    ]) {
      const filteredFamilyResponse = await request(app)
        .get("/eto-requests")
        .query(query);
      expect(filteredFamilyResponse.status).toBe(200);
      expect(filteredFamilyResponse.body.total).toBe(3);
      expect(filteredFamilyResponse.body.totalGroups).toBe(1);
      expect(filteredFamilyResponse.body.items.map((item: any) => item.etoNumber))
        .toEqual(expectedFamilyNumbers);
    }

    const familyResponse = await request(app)
      .get("/eto-requests")
      .query({
        splitFamilyId: source.id,
        search: "does-not-match",
        stage: "won",
        overdue: true,
        assigneeId: -1,
      });
    expect(familyResponse.status).toBe(200);
    expect(familyResponse.body.total).toBe(3);
    expect(familyResponse.body.totalGroups).toBe(1);
    expect(familyResponse.body.items.map((item: any) => item.etoNumber))
      .toEqual(expectedFamilyNumbers);

    const newerRequestOne = await createSource();
    const newerRequestTwo = await createSource();
    const firstPage = await request(app)
      .get("/eto-requests")
      .query({ search: TEST_PREFIX, page: 1, limit: 2 });
    const secondPage = await request(app)
      .get("/eto-requests")
      .query({ search: TEST_PREFIX, page: 2, limit: 2 });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.total).toBe(5);
    expect(firstPage.body.totalGroups).toBe(3);
    expect(firstPage.body.items.map((item: any) => item.id)).toEqual([
      newerRequestTwo.id,
      newerRequestOne.id,
    ]);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items.map((item: any) => item.etoNumber)).toEqual([
      source.etoNumber,
      `${source.etoNumber}-01`,
      `${source.etoNumber}-02`,
    ]);

    const audits = await db
      .select()
      .from(stageTransitionsTable)
      .where(eq(stageTransitionsTable.decision, "split-request"));
    const testAudits = audits.filter((audit) =>
      audit.etoRequestId === source.id || children.some((child) => child.id === audit.etoRequestId),
    );
    expect(testAudits).toHaveLength(3);

    const second = await request(app)
      .post(`/eto-requests/${source.id}/split`)
      .send({ count: 2 });
    expect(second.status).toBe(409);
  });

  it("rolls back database rows and cleans copied objects when copying fails", async () => {
    const app = buildApp();
    const source = await createSource();
    await db.insert(attachmentsTable).values({
      etoRequestId: source.id,
      uploaderId: testUser.id,
      filename: "source.txt",
      storageKey: "/objects/uploads/source",
    });
    mockCopyObjectEntity
      .mockResolvedValueOnce("/objects/splits/copied-before-failure")
      .mockRejectedValueOnce(new Error("copy failed"));

    const response = await request(app)
      .post(`/eto-requests/${source.id}/split`)
      .send({ count: 2 });
    expect(response.status).toBe(500);

    const children = await db
      .select()
      .from(etoRequestsTable)
      .where(eq(etoRequestsTable.parentEtoRequestId, source.id));
    expect(children).toHaveLength(0);

    const [reloaded] = await db
      .select()
      .from(etoRequestsTable)
      .where(eq(etoRequestsTable.id, source.id));
    expect(reloaded.hasSplitChildren).toBe(false);
    expect(mockDeleteObjectEntity).toHaveBeenCalledWith("/objects/splits/copied-before-failure");
  });

  it("blocks a transition that races behind a split transaction", async () => {
    const app = buildApp();
    const source = await createSource();
    await db.insert(attachmentsTable).values({
      etoRequestId: source.id,
      uploaderId: testUser.id,
      filename: "source.txt",
      storageKey: "/objects/uploads/source",
    });

    let releaseCopy!: (path: string) => void;
    let markCopyStarted!: () => void;
    const copyStarted = new Promise<void>((resolve) => {
      markCopyStarted = resolve;
    });
    const delayedCopy = new Promise<string>((resolve) => {
      releaseCopy = resolve;
    });
    mockCopyObjectEntity.mockImplementationOnce(async () => {
      markCopyStarted();
      return delayedCopy;
    });

    const splitPromise = request(app)
      .post(`/eto-requests/${source.id}/split`)
      .send({ count: 2 })
      .then((response) => response);
    await copyStarted;

    const transitionPromise = request(app)
      .post(`/eto-requests/${source.id}/transitions`)
      .send({ decision: "return-draft", reason: "Concurrent transition test" })
      .then((response) => response);

    releaseCopy("/objects/splits/delayed-copy");
    const [splitResponse, transitionResponse] = await Promise.all([
      splitPromise,
      transitionPromise,
    ]);

    expect(splitResponse.status).toBe(201);
    expect(transitionResponse.status).toBe(409);

    const [reloaded] = await db
      .select()
      .from(etoRequestsTable)
      .where(eq(etoRequestsTable.id, source.id));
    expect(reloaded.stage).toBe("art-review");
    expect(reloaded.hasSplitChildren).toBe(true);

    const forbiddenTransition = await db
      .select()
      .from(stageTransitionsTable)
      .where(and(
        eq(stageTransitionsTable.etoRequestId, source.id),
        eq(stageTransitionsTable.decision, "return-draft"),
      ));
    expect(forbiddenTransition).toHaveLength(0);
  });
});