import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const { authState } = vi.hoisted(() => ({
  authState: { user: null as any },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = authState.user;
    res.locals.simulatedRole = null;
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {},
}));

import { db } from "@workspace/db";
import {
  etoRequestsTable,
  stageTransitionsTable,
  usersTable,
} from "@workspace/db/schema";
import etoRequestsRouter from "../eto-requests";

let testUser: typeof usersTable.$inferSelect;
const createdRequestIds: number[] = [];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use("/eto-requests", etoRequestsRouter);
  app.use((_err: unknown, _req: unknown, res: any, _next: unknown) => {
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

beforeAll(async () => {
  [testUser] = await db
    .insert(usersTable)
    .values({
      authId: `create-eto-test-${randomUUID()}`,
      name: "ETO Create Test",
      email: `create-eto-${randomUUID()}@example.com`,
      role: "sales",
    })
    .returning();
  authState.user = testUser;
});

afterEach(async () => {
  if (createdRequestIds.length > 0) {
    await db
      .delete(etoRequestsTable)
      .where(inArray(etoRequestsTable.id, createdRequestIds.splice(0)));
  }
});

afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, testUser.id));
});

describe("POST /eto-requests", () => {
  it("stores the submission time and records the initial stage audit entry", async () => {
    const response = await request(buildApp())
      .post("/eto-requests")
      .send({
        customerName: "Submission Timestamp Customer",
        quoteNumber: `Q-${randomUUID().slice(0, 8)}`,
        quoteRevision: "",
        distributor: "No",
        requestType: "Machine",
        machineType: "ST",
        expectedForceRange: "10",
        expectedForceUnit: "N",
        expectedDisplacement: "25",
        expectedDisplacementUnit: "mm",
        materials: "Steel",
        specimenDimensions: "10 x 10 mm",
        resultsRequired: "Report",
        customDetails: "Creation audit integration test",
      });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.etoNumber).toBeNull();
    expect(response.body.stage).toBe("draft");
    createdRequestIds.push(response.body.id);
    expect(new Date(response.body.createdAt).toString()).not.toBe("Invalid Date");

    const [audit] = await db
      .select()
      .from(stageTransitionsTable)
      .where(eq(stageTransitionsTable.etoRequestId, response.body.id));

    expect(audit).toMatchObject({
      actorId: testUser.id,
      fromStage: "draft",
      toStage: "draft",
      decision: "submit",
    });
    expect(audit.createdAt.toISOString()).toBe(
      new Date(response.body.createdAt).toISOString(),
    );
  });
});