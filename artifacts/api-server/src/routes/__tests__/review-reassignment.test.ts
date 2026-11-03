import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { etoRequestsTable, detailChangesTable } from "@workspace/db/schema";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  role: "engineering",
  simulatedRole: null as string | null,
  current: { id: 10, stage: "engineering-review", assigneeId: 2, updatedAt: new Date("2026-10-01T12:00:00Z") } as any,
  selected: { id: 3, name: "New reviewer" } as any,
  set: vi.fn(), values: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn(),
  sendEmail: vi.fn(),
  queries: [] as any[],
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = { id: 1, role: state.role };
    res.locals.simulatedRole = state.simulatedRole;
    next();
  },
}));
vi.mock("../../lib/objectStorage", () => ({ ObjectStorageService: class {} }));
vi.mock("../../lib/email", () => ({ sendReassignmentEmail: state.sendEmail }));
vi.mock("@workspace/db", async (original) => ({
  ...await original<typeof import("@workspace/db")>(),
  db: { transaction: state.transaction },
}));
import router from "../eto-requests";

const app = express();
app.use(express.json());
app.use("/eto-requests", router);
const engineeringBody = { assigneeId: 3, expectedStage: "engineering-review", expectedAssigneeId: 2 };
const productionBody = { ...engineeringBody, expectedStage: "production-review" };
const post = (body = engineeringBody) => request(app).post("/eto-requests/10/reassign").send(body);

beforeEach(() => {
  vi.clearAllMocks();
  state.sendEmail.mockResolvedValue(false);
  state.role = "engineering";
  state.simulatedRole = null;
  state.current = { id: 10, stage: "engineering-review", assigneeId: 2, updatedAt: new Date("2026-10-01T12:00:00Z") };
  state.selected = { id: 3, name: "New reviewer" };
  state.queries = [];
  const tx = {
    select: vi.fn(() => {
      const index = state.queries.length;
      const rows = () => index === 0 ? (state.current ? [state.current] : [])
        : index === 1 ? (state.selected ? [state.selected] : []) : [{ name: "Previous reviewer" }];
      const query: any = {
        from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        for: vi.fn(async () => rows()),
        then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject),
      };
      state.queries.push(query);
      return query;
    }),
    update: state.update.mockReturnValue({ set: state.set.mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: state.insert.mockReturnValue({ values: state.values.mockResolvedValue([]) }),
  };
  state.transaction.mockImplementation(async (callback) => callback(tx));
});

describe("department review reassignment", () => {
  it("updates Engineering assignment and sticky reviewer without transitioning or touching saved work", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 10, stage: "engineering-review", assigneeId: 3, department: "engineering" });
    expect(state.update).toHaveBeenCalledWith(etoRequestsTable);
    expect(state.set).toHaveBeenCalledWith({ assigneeId: 3, stickyEngineerUserId: 3, updatedAt: expect.any(Date) });
    expect(state.set.mock.calls[0][0]).not.toHaveProperty("stage");
    expect(state.set.mock.calls[0][0]).not.toHaveProperty("dueDate");
    expect(state.insert).toHaveBeenCalledExactlyOnceWith(detailChangesTable);
    expect(state.values).toHaveBeenCalledWith(expect.objectContaining({
      changedById: 1, section: "request",
      changes: [{ field: "Assigned Engineer", oldValue: "Previous reviewer", newValue: "New reviewer" }],
    }));
    expect(state.queries[0].for).toHaveBeenCalledWith("update");
    expect(state.queries[1].for).toHaveBeenCalledWith("share");
    expect(new PgDialect().sqlToQuery(state.queries[1].where.mock.calls[0][0]).params).toEqual([3, "engineering"]);
  });

  it("updates Production's persistent assignee but leaves the sticky Engineer unchanged", async () => {
    state.role = "production"; state.current.stage = "production-review";
    const response = await post(productionBody);
    expect(response.status).toBe(200);
    expect(state.set).toHaveBeenCalledWith({ assigneeId: 3, productionAssigneeId: 3, updatedAt: expect.any(Date) });
    expect(state.values.mock.calls[0][0].changes[0].field).toBe("Assigned Production");
    expect(new PgDialect().sqlToQuery(state.queries[1].where.mock.calls[0][0]).params).toEqual([3, "production"]);
  });

  it.each(["sales", "art", "production", "admin"])("blocks %s from Engineering reassignment", async (role) => {
    state.role = role;
    expect((await post()).status).toBe(403);
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it("blocks Engineering from Production reassignment", async () => {
    expect((await post(productionBody)).status).toBe(403);
  });
  it.each(["engineering-review", "production-review"])("allows SuperUser in %s", async (stage) => {
    state.role = "superuser"; state.current.stage = stage;
    expect((await post({ ...engineeringBody, expectedStage: stage })).status).toBe(200);
  });
  it("audits the authenticated actor and simulated department", async () => {
    state.simulatedRole = "engineering";
    expect((await post()).status).toBe(200);
    expect(state.values).toHaveBeenCalledWith(expect.objectContaining({ changedById: 1, simulatedRole: "engineering" }));
  });
  it("rejects an outdated stage without writes", async () => {
    state.current.stage = "production-review";
    expect((await post()).status).toBe(409);
    expect(state.set).not.toHaveBeenCalled();
  });
  it("rejects an outdated assignment without writes", async () => {
    state.current.assigneeId = 4;
    expect((await post()).status).toBe(409);
    expect(state.set).not.toHaveBeenCalled();
  });
  it("rejects missing or wrong-department candidates without writes", async () => {
    state.selected = null;
    expect((await post()).status).toBe(422);
    expect(state.set).not.toHaveBeenCalled();
    expect(state.queries[1].where).toHaveBeenCalled();
  });
  it("returns 404 for a missing request", async () => {
    state.current = null;
    expect((await post()).status).toBe(404);
    expect(state.set).not.toHaveBeenCalled();
  });
  it("can assign an unassigned specialist review without advancing it", async () => {
    state.current.assigneeId = null;
    const response = await request(app).post("/eto-requests/10/reassign")
      .send({ ...engineeringBody, expectedAssigneeId: null });
    expect(response.status).toBe(200);
    expect(response.body.stage).toBe("engineering-review");
    expect(state.values.mock.calls[0][0].changes[0].oldValue).toBeNull();
  });
  it.each([null, 0, -1, 1.5, "3"])("rejects an invalid target id %s", async (assigneeId) => {
    expect((await request(app).post("/eto-requests/10/reassign").send({ ...engineeringBody, assigneeId })).status).toBe(422);
    expect(state.transaction).not.toHaveBeenCalled();
  });
  it("does not write or create duplicate audit entries for an unchanged assignment", async () => {
    state.selected = { id: 2, name: "Previous reviewer" };
    expect((await post({ ...engineeringBody, assigneeId: 2 })).status).toBe(200);
    expect(state.set).not.toHaveBeenCalled();
    expect(state.values).not.toHaveBeenCalled();
    expect(state.sendEmail).not.toHaveBeenCalled();
  });
  it("notifies only the new reviewer after a successful reassignment", async () => {
    state.current.etoNumber = "ETO-2026-0010";
    state.selected.email = "new-reviewer@example.test";
    expect((await post()).status).toBe(200);
    expect(state.sendEmail).toHaveBeenCalledExactlyOnceWith({
      etoId: 10, etoNumber: "ETO-2026-0010", department: "engineering",
      email: "new-reviewer@example.test",
    });
  });
});
