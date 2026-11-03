import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const { authState } = vi.hoisted(() => ({ authState: { user: null as any } }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = authState.user;
    res.locals.simulatedRole = null;
    next();
  },
}));
vi.mock("../../lib/objectStorage", () => ({ ObjectStorageService: class {} }));
vi.mock("../../lib/email", () => ({ sendTransitionEmails: vi.fn().mockResolvedValue(undefined) }));
// Exercise the real PostgreSQL allocator in a future year so these tests do
// not consume the user's current-year numbers.
vi.mock("../../lib/eto-number", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/eto-number")>();
  return {
    allocateEtoNumber: (tx: Parameters<typeof original.allocateEtoNumber>[0]) =>
      original.allocateEtoNumber(tx, new Date("2098-06-01T12:00:00Z")),
  };
});

import { db, etoRequestsTable, usersTable, stageTransitionsTable } from "@workspace/db";
import etoRouter from "../eto-requests";
import transitionsRouter from "../transitions";

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  next();
});
const router = Router();
router.use("/eto-requests", etoRouter);
router.use("/eto-requests/:id/transitions", transitionsRouter);
app.use(router);
app.use((_err: unknown, _req: unknown, res: any, _next: unknown) => {
  res.status(500).json({ error: "Internal server error" });
});

let testUser: typeof usersTable.$inferSelect;
const ownedIds: number[] = [];
beforeAll(async () => {
  [testUser] = await db.insert(usersTable).values({
    authId: `numbering-test-${randomUUID()}`,
    name: "Numbering Test",
    email: `numbering-${randomUUID()}@example.com`,
    role: "sales",
  }).returning();
  authState.user = testUser;
});
afterEach(async () => {
  vi.restoreAllMocks();
  authState.user = testUser;
  if (ownedIds.length) {
    await db.delete(etoRequestsTable).where(inArray(etoRequestsTable.id, ownedIds.splice(0)));
  }
});
afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, testUser.id));
});

async function draft() {
  const response = await request(app).post("/eto-requests").send({
    customerName: "Numbering Test Customer", quoteNumber: `Q-${randomUUID()}`,
    materials: "Steel", specimenDimensions: "10 x 10 mm",
    distributor: "No", requestType: "Machine", machineType: "ST",
    expectedForceRange: "10", expectedForceUnit: "N",
    expectedDisplacement: "25", expectedDisplacementUnit: "mm",
    resultsRequired: "Report", customDetails: "Disposable numbering test",
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  ownedIds.push(response.body.id);
  expect(response.body.etoNumber).toBeNull();
  expect(response.body.stage).toBe("draft");
  return response.body.id as number;
}
function submit(id: number) {
  return request(app).post(`/eto-requests/${id}/transitions`).send({ decision: "submit" });
}
function sequence(number: string) { return BigInt(number.split("-")[2]); }

describe("Draft numbering lifecycle", () => {
  it("lets one submitter create multiple unnumbered drafts and numbers in submission order", async () => {
    const first = await draft();
    const second = await draft();
    const laterCreated = await submit(second);
    const earlierCreated = await submit(first);
    expect(laterCreated.status).toBe(200);
    expect(earlierCreated.status).toBe(200);
    expect(laterCreated.body.etoNumber).toMatch(/^ETO-2098-\d{4,}$/);
    expect(sequence(earlierCreated.body.etoNumber)).toBe(sequence(laterCreated.body.etoNumber) + 1n);
  });

  it("assigns unique consecutive numbers to simultaneous submissions", async () => {
    const ids = await Promise.all([draft(), draft(), draft()]);
    const responses = await Promise.all(ids.map(submit));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const numbers = responses.map((response) => sequence(response.body.etoNumber)).sort((a, b) => a < b ? -1 : 1);
    expect(new Set(numbers).size).toBe(3);
    expect(numbers[1]).toBe(numbers[0] + 1n);
    expect(numbers[2]).toBe(numbers[1] + 1n);
  });

  it("does not renumber or duplicate audit entries when the same draft is submitted twice", async () => {
    const id = await draft();
    const responses = await Promise.all([submit(id), submit(id)]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect([409, 422]).toContain(responses.find((response) => response.status !== 200)?.status);
    const [saved] = await db.select().from(etoRequestsTable).where(eq(etoRequestsTable.id, id));
    expect(saved.etoNumber).toBe(responses.find((response) => response.status === 200)?.body.etoNumber);
    const audits = await db.select().from(stageTransitionsTable).where(eq(stageTransitionsTable.etoRequestId, id));
    expect(audits.filter((row) => row.fromStage === "draft" && row.toStage === "art-review")).toHaveLength(1);
  });

  it("keeps the assigned number after ART returns a request to Draft and it is resubmitted", async () => {
    const id = await draft();
    const initial = await submit(id);
    expect(initial.status).toBe(200);
    authState.user = { ...testUser, role: "art" };
    const returned = await request(app).post(`/eto-requests/${id}/transitions`).send({
      decision: "return-draft", reason: "Needs clarification",
    });
    expect(returned.status).toBe(200);
    authState.user = testUser;
    const resubmitted = await submit(id);
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.etoNumber).toBe(initial.body.etoNumber);
  });

  it("preserves an existing numbered draft instead of assigning a new number", async () => {
    const id = await draft();
    const existingNumber = `ETO-2097-${String(id).padStart(4, "0")}`;
    await db.update(etoRequestsTable).set({ etoNumber: existingNumber }).where(eq(etoRequestsTable.id, id));
    const response = await submit(id);
    expect(response.status).toBe(200);
    expect(response.body.etoNumber).toBe(existingNumber);
  });

  it("rolls back the number and stage if the submission audit cannot be saved", async () => {
    const id = await draft();
    const allocator = await vi.importActual<typeof import("../../lib/eto-number")>("../../lib/eto-number");
    const expectedNext = await db.transaction((tx) =>
      allocator.allocateEtoNumber(tx, new Date("2098-06-01T12:00:00Z")));
    const originalTransaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce((callback) =>
      originalTransaction(async (tx) => {
        const originalInsert = tx.insert.bind(tx);
        tx.insert = ((table) => {
          if (Object.is(table, stageTransitionsTable)) throw new Error("Synthetic audit failure");
          return originalInsert(table);
        }) as typeof tx.insert;
        return callback(tx);
      }));
    try {
      expect((await submit(id)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    const [saved] = await db.select().from(etoRequestsTable).where(eq(etoRequestsTable.id, id));
    expect(saved.stage).toBe("draft");
    expect(saved.etoNumber).toBeNull();
    const retried = await submit(id);
    expect(retried.status).toBe(200);
    expect(retried.body.etoNumber).toBe(expectedNext);
  });

  it("leaves unauthorized submissions unnumbered", async () => {
    const id = await draft();
    authState.user = { ...testUser, role: "engineering" };
    expect((await submit(id)).status).toBe(403);
    const [saved] = await db.select().from(etoRequestsTable).where(eq(etoRequestsTable.id, id));
    expect(saved.stage).toBe("draft");
    expect(saved.etoNumber).toBeNull();
  });
});