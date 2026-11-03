import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";

  const { designFormulaSettingsTable, designFormulaChangesTable, mockSelect, mockTransaction, mockWhere } = vi.hoisted(() => ({
  designFormulaSettingsTable: { id: "id" },
  designFormulaChangesTable: { changedAt: "changedAt", id: "id" },
  mockSelect: vi.fn(),
  mockTransaction: vi.fn(),
  mockWhere: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
  designFormulaSettingsTable,
  designFormulaChangesTable,
}));
vi.mock("../../lib/email", () => ({ send: vi.fn() }));

let role = "admin";
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = { id: 7, role, name: "Admin Example", email: "admin@example.com" };
    next();
  },
}));

import adminRouter from "../admin";

describe("Admin design formula settings", () => {
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  let saved: Record<string, unknown> | null;
  let history: Record<string, unknown>[];

  beforeEach(() => {
    role = "admin";
    saved = null;
    history = [];
    mockSelect.mockImplementation(() => ({
      from: (table: unknown) => table === designFormulaSettingsTable
        ? { where: () => ({ limit: async () => saved ? [saved] : [] }) }
        : {
            where: (condition: unknown) => {
              mockWhere(condition);
              const { params } = new PgDialect().sqlToQuery(condition as Parameters<PgDialect["sqlToQuery"]>[0]);
              const cursor = params[params.length - 1] as number;
              return { orderBy: () => ({ limit: async (count: number) =>
                history.filter((row) => (row.id as number) < cursor).reverse().slice(0, count) }) };
            },
            orderBy: () => ({ limit: async (count: number) => history.slice().reverse().slice(0, count) }),
          },
    }));
    mockTransaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      let nextSaved = saved;
      const nextHistory = history.slice();
      const tx = {
        execute: async () => undefined,
        select: () => ({ from: () => ({ where: () => ({ limit: async () => nextSaved ? [nextSaved] : [] }) }) }),
        insert: (table: unknown) => ({
          values: (input: Record<string, unknown>) => table === designFormulaSettingsTable
            ? { onConflictDoUpdate: () => ({
                returning: async () => {
                  nextSaved = { ...input, updatedAt: new Date("2026-09-29") };
                  return [nextSaved];
                },
              }) }
            : (nextHistory.push({ id: nextHistory.length + 1, changedAt: new Date("2026-09-29"), ...input }), Promise.resolve()),
        }),
      };
      const result = await callback(tx);
      saved = nextSaved;
      history = nextHistory;
      return result;
    });
  });

  it("starts with default values and persists admin changes", async () => {
    const original = await request(app).get("/admin/design-formula");
    expect(original.status).toBe(200);
    expect(original.body).toMatchObject({ hourlyRate: "100", hoursPerWeek: "40", capacityFactor: "0.35" });

    const update = await request(app).put("/admin/design-formula")
      .send({ hourlyRate: "120", hoursPerWeek: "32", capacityFactor: "0.5" });
    expect(update.status).toBe(200);
    expect(saved).toMatchObject({ hourlyRate: "120", hoursPerWeek: "32", capacityFactor: "0.5" });

    const updated = await request(app).get("/admin/design-formula");
    expect(updated.body).toMatchObject({ hourlyRate: "120", hoursPerWeek: "32", capacityFactor: "0.5" });
    expect((await request(app).get("/admin/design-formula/history")).body.items).toMatchObject([{
      actorUserId: 7, actorName: "Admin Example", actorEmail: "admin@example.com",
      previousValues: { hourlyRate: "100", hoursPerWeek: "40", capacityFactor: "0.35" },
      newValues: { hourlyRate: "120", hoursPerWeek: "32", capacityFactor: "0.5" },
    }]);
    role = "superuser";
    await request(app).put("/admin/design-formula")
      .send({ hourlyRate: "150", hoursPerWeek: "32", capacityFactor: "0.5" });
    expect((await request(app).get("/admin/design-formula/history")).body.items[0]).toMatchObject({
      previousValues: { hourlyRate: "120", hoursPerWeek: "32", capacityFactor: "0.5" },
      newValues: { hourlyRate: "150", hoursPerWeek: "32", capacityFactor: "0.5" },
    });
    await request(app).put("/admin/design-formula")
      .send({ hourlyRate: "150", hoursPerWeek: "32", capacityFactor: "0.5" });
    expect(history).toHaveLength(2);
  });

  it("rejects non-admin updates and invalid factors", async () => {
    role = "engineering";
    const forbidden = await request(app).put("/admin/design-formula")
      .send({ hourlyRate: "120", hoursPerWeek: "32", capacityFactor: "0.5" });
    expect(forbidden.status).toBe(403);
    expect((await request(app).get("/admin/design-formula/history")).status).toBe(403);
    role = "admin";
    const invalid = await request(app).put("/admin/design-formula")
      .send({ hourlyRate: "120", hoursPerWeek: "32", capacityFactor: "0" });
    expect(invalid.status).toBe(400);
    expect(saved).toBeNull();
  });

  it("bounds history pages and returns a cursor from the last visible row", async () => {
    history = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1, changedAt: new Date("2026-09-29T12:00:00Z"),
      actorUserId: 7, actorName: "Admin Example", actorEmail: "admin@example.com",
      previousHourlyRate: "100", previousHoursPerWeek: "40", previousCapacityFactor: "0.35",
      newHourlyRate: "120", newHoursPerWeek: "40", newCapacityFactor: "0.35",
    }));
    const first = await request(app).get("/admin/design-formula/history");
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.items.map((item: { id: number }) => item.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => 21 - index),
    );
    expect(first.body.nextCursor).toBe(2);
    const second = await request(app).get("/admin/design-formula/history?cursor=2");
    expect(second.status).toBe(200);
    expect(second.body.items.map((item: { id: number }) => item.id)).toEqual([1]);
    expect(second.body.nextCursor).toBeNull();
    expect(mockWhere).toHaveBeenCalled();
    expect((await request(app).get("/admin/design-formula/history?cursor=invalid")).status).toBe(400);
    expect((await request(app).get("/admin/design-formula/history?cursor=0")).status).toBe(400);
  });
});