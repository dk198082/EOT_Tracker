import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { reviewAssignmentDefaultsTable, usersTable, reviewDefaultsId } from "@workspace/db/schema";

const { select, transaction, connect, deleteUser } = vi.hoisted(() => ({
  select: vi.fn(), transaction: vi.fn(), connect: vi.fn(), deleteUser: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: { select, transaction, delete: deleteUser },
  pool: { connect }, ETO_SCHEMA: "crm",
}));
let role = "admin";
vi.mock("../../middlewares/requireAuth", () => {
  const mockRequireAuth = (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = { id: 1, name: "Sample Admin", role };
    next();
  };
  return {
    requireAuth: mockRequireAuth,
    requireAuthAllowNone: mockRequireAuth,
  };
});
import usersRouter from "../users";

type Defaults = { id: number; engineeringUserId: number; productionUserId: number; updatedAt: Date };
const users = [
  { id: 1, role: "admin" },
  { id: 19, role: "engineering" }, { id: 23, role: "production" },
  { id: 34, role: "engineering" }, { id: 35, role: "production" },
];
let rows: Defaults[];
const dialect = new PgDialect();

function selection() {
  let table: unknown;
  let predicate: any;
  const result = () => {
    const compiled = predicate ? dialect.sqlToQuery(predicate) : null;
    const id = compiled?.params[0];
    if (table === usersTable) return id === undefined ? users : users.filter((user) => user.id === id);
    if (table === reviewAssignmentDefaultsTable) {
      if (compiled?.sql.includes("engineering_user_id")) {
        return rows.filter((row) => row.engineeringUserId === id || row.productionUserId === id);
      }
      return rows.filter((row) => row.id === id);
    }
    throw new Error("Unexpected selected table");
  };
  const chain: any = {
    from: (value: unknown) => { table = value; return chain; },
    where: (value: unknown) => { predicate = value; return chain; },
    orderBy: () => chain,
    limit: async () => result(),
    then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}

describe("Entity-specific reviewer defaults", () => {
  const app = express();
  app.use(express.json());
  app.use("/users", usersRouter);
  app.use((error: Error, _req: unknown, res: any, _next: unknown) =>
    res.status(500).json({ error: error.message }));

  beforeEach(() => {
    vi.clearAllMocks();
    role = "admin";
    rows = [{ id: 1, engineeringUserId: 19, productionUserId: 23, updatedAt: new Date() }];
    select.mockImplementation(selection);
    transaction.mockImplementation(async (callback: any) => callback({
      execute: async () => undefined,
      select: selection,
      insert: () => ({
        values: (input: Defaults) => ({
          onConflictDoUpdate: () => ({
            returning: async () => {
              const saved = { ...input, updatedAt: new Date() };
              rows = [...rows.filter((row) => row.id !== input.id), saved];
              return [saved];
            },
          }),
        }),
      }),
    }));
    connect.mockResolvedValue({
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FOR UPDATE")) return { rows: users };
        if (sql.includes("SELECT engineering_user_id")) return {
          rows: rows.map((row) => ({
            engineering_user_id: row.engineeringUserId, production_user_id: row.productionUserId,
          })),
        };
        return { rows: [] };
      }),
    });
  });

  it("preserves existing TOUS settings and returns empty TOUK settings initially", async () => {
    expect(reviewDefaultsId("TOUS")).toBe(1);
    expect(reviewDefaultsId("TOUK")).toBe(2);
    expect(reviewDefaultsId(null)).toBe(1); // Historical requests retain their existing behavior.
    expect((await request(app).get("/users/review-defaults")).body)
      .toMatchObject({ entity: "TOUS", engineeringUserId: 19, productionUserId: 23 });
    expect((await request(app).get("/users/review-defaults?entity=TOUK")).body)
      .toEqual({ entity: "TOUK", engineeringUserId: null, productionUserId: null, updatedAt: null });
  });

  it("saves and reads each Entity independently", async () => {
    const saved = await request(app).put("/users/review-defaults")
      .send({ entity: "TOUK", engineeringUserId: 34, productionUserId: 35 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ entity: "TOUK", engineeringUserId: 34, productionUserId: 35 });
    expect((await request(app).get("/users/review-defaults?entity=TOUK")).body).toEqual(saved.body);
    expect((await request(app).get("/users/review-defaults?entity=TOUS")).body)
      .toMatchObject({ engineeringUserId: 19, productionUserId: 23 });
    await request(app).put("/users/review-defaults")
      .send({ entity: "TOUS", engineeringUserId: 34, productionUserId: 23 }).expect(200);
    expect((await request(app).get("/users/review-defaults?entity=TOUK")).body).toEqual(saved.body);
  });

  it("keeps omitted Entity backward-compatible with TOUS", async () => {
    await request(app).put("/users/review-defaults")
      .send({ engineeringUserId: 34, productionUserId: 35 }).expect(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, engineeringUserId: 34 });
  });

  it("rejects invalid Entity values, users, departments and unauthorized updates", async () => {
    await request(app).get("/users/review-defaults?entity=unknown").expect(400);
    for (const input of [
      { entity: "unknown", engineeringUserId: 19, productionUserId: 23 },
      { entity: null, engineeringUserId: 19, productionUserId: 23 },
      { entity: "TOUK", engineeringUserId: 23, productionUserId: 35 },
      { entity: "TOUK", engineeringUserId: 34, productionUserId: 19 },
      { entity: "TOUK", engineeringUserId: 999, productionUserId: 35 },
      { entity: "TOUK", engineeringUserId: 34, productionUserId: null },
    ]) await request(app).put("/users/review-defaults").send(input).expect(400);
    role = "engineering";
    await request(app).put("/users/review-defaults")
      .send({ entity: "TOUK", engineeringUserId: 34, productionUserId: 35 }).expect(403);
    expect(rows).toHaveLength(1);
  });

  it("protects TOUK default users from deletion and role changes too", async () => {
    rows.push({ id: 2, engineeringUserId: 34, productionUserId: 35, updatedAt: new Date() });
    for (const id of [34, 35]) {
      const deleted = await request(app).delete(`/users/${id}`);
      expect(deleted.status).toBe(400);
      expect(deleted.body.error).toContain("default reviewer");
      const demoted = await request(app).patch(`/users/${id}/role`).send({ role: "sales" });
      expect(demoted.status).toBe(400);
      expect(demoted.body.error).toContain("default reviewer");
    }
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
