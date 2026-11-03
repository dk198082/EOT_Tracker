import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { assemblyFormulaSettingsTable, assemblyFormulaChangesTable, mockSelect, mockTransaction } = vi.hoisted(() => ({
  assemblyFormulaSettingsTable: { id: "id" },
  assemblyFormulaChangesTable: { changedAt: "changedAt", id: "id" },
  mockSelect: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
  assemblyFormulaSettingsTable,
  assemblyFormulaChangesTable,
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

describe("Admin assembly formula settings", () => {
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
      from: (table: unknown) => table === assemblyFormulaSettingsTable
        ? { where: () => ({ limit: async () => saved ? [saved] : [] }) }
        : { orderBy: async () => history.slice().reverse() },
    }));
    mockTransaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      let nextSaved = saved;
      const nextHistory = history.slice();
      const tx = {
        execute: async () => undefined,
        select: () => ({ from: () => ({ where: () => ({ limit: async () => nextSaved ? [nextSaved] : [] }) }) }),
        insert: (table: unknown) => ({
          values: (input: Record<string, unknown>) => table === assemblyFormulaSettingsTable
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

  it("starts at 70/40/0.65, saves admin updates, and records meaningful changes", async () => {
    const original = await request(app).get("/admin/assembly-formula");
    expect(original.status).toBe(200);
    expect(original.body).toMatchObject({ hourlyRate: "70", hoursPerWeek: "40", capacityFactor: "0.65" });

    const updated = await request(app).put("/admin/assembly-formula")
      .send({ hourlyRate: "85", hoursPerWeek: "35", capacityFactor: "0.7" });
    expect(updated.status).toBe(200);
    expect((await request(app).get("/admin/assembly-formula")).body)
      .toMatchObject({ hourlyRate: "85", hoursPerWeek: "35", capacityFactor: "0.7" });
    expect((await request(app).get("/admin/assembly-formula/history")).body).toMatchObject([{
      actorUserId: 7, actorName: "Admin Example", actorEmail: "admin@example.com",
      previousValues: { hourlyRate: "70", hoursPerWeek: "40", capacityFactor: "0.65" },
      newValues: { hourlyRate: "85", hoursPerWeek: "35", capacityFactor: "0.7" },
    }]);

    await request(app).put("/admin/assembly-formula")
      .send({ hourlyRate: "85", hoursPerWeek: "35", capacityFactor: "0.7" });
    expect(history).toHaveLength(1);
  });

  it("rejects unauthorized updates and invalid settings", async () => {
    role = "production";
    expect((await request(app).put("/admin/assembly-formula")
      .send({ hourlyRate: "85", hoursPerWeek: "35", capacityFactor: "0.7" })).status).toBe(403);
    expect((await request(app).get("/admin/assembly-formula")).status).toBe(403);
    expect((await request(app).get("/admin/assembly-formula/history")).status).toBe(403);
    role = "admin";
    expect((await request(app).put("/admin/assembly-formula")
      .send({ hourlyRate: "0", hoursPerWeek: "40", capacityFactor: "0.65" })).status).toBe(400);
  });
});