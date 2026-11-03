import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), transaction: vi.fn(),
  settings: { id: "settings.id" },
  pricing: { etoRequestId: "pricing.etoRequestId" },
  eto: { id: "eto.id" },
  changes: {},
}));
vi.mock("@workspace/db", () => ({
  db: { select: mocks.select, insert: mocks.insert, transaction: mocks.transaction },
  priceCalculatorSettingsTable: mocks.settings,
  etoPriceCalculatorTable: mocks.pricing,
  etoRequestsTable: mocks.eto,
  detailChangesTable: mocks.changes,
}));
let role = "art";
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = { id: 7, role };
    next();
  },
}));
import router from "../price-calculator";
import { parsePricePercentages } from "../../lib/price-calculator";

const app = express();
app.use(express.json());
app.use(router);
let settings: Record<string, unknown> | null;
let pricing: Record<string, unknown> | null;
let eto: Record<string, unknown> | null;
let audit: Record<string, unknown>[];

beforeEach(() => {
  vi.clearAllMocks();
  role = "art";
  settings = null;
  pricing = null;
  eto = { id: 42, stage: "art-final-review" };
  audit = [];
  mocks.select.mockImplementation(() => {
    let table: unknown;
    const chain: any = {
      from: (source: unknown) => { table = source; return chain; },
      where: () => chain,
      limit: () => chain,
      for: () => chain,
      then: (resolve: (rows: unknown[]) => unknown) => {
        const row = table === mocks.settings ? settings : table === mocks.pricing ? pricing : eto;
        return Promise.resolve(row ? [row] : []).then(resolve);
      },
    };
    return chain;
  });
  mocks.insert.mockImplementation((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      if (table === mocks.changes) { audit.push(values); return Promise.resolve(); }
      const row = { ...values, updatedAt: new Date("2026-10-02T12:00:00Z") };
      if (table === mocks.settings) settings = row;
      else pricing = row;
      const chain = { onConflictDoUpdate: () => chain, returning: async () => [row] };
      return chain;
    },
  }));
  mocks.transaction.mockImplementation((run: (tx: unknown) => unknown) =>
    run({ select: mocks.select, insert: mocks.insert }));
});

describe("Price Calculator", () => {
  it("starts with Admin defaults of 10% and 55%", async () => {
    role = "admin";
    const res = await request(app).get("/admin/price-calculator");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contingencyPercent: "10", marginPercent: "55", updatedAt: null });
  });

  it.each(["admin", "superuser"])("lets %s save Admin defaults", async (r) => {
    role = r;
    const res = await request(app).put("/admin/price-calculator")
      .send({ contingencyPercent: "12.5", marginPercent: "60" });
    expect(res.status).toBe(200);
    expect(settings).toMatchObject({ contingencyPercent: "12.5", marginPercent: "60" });
  });

  it.each(["art", "engineering", "production", "sales"])("blocks %s from Admin defaults", async (r) => {
    role = r;
    for (const method of ["get", "put"] as const) {
      const res = await request(app)[method]("/admin/price-calculator")
        .send({ contingencyPercent: "15", marginPercent: "60" });
      expect(res.status).toBe(403);
    }
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("lets ART read effective defaults without Admin access", async () => {
    settings = { contingencyPercent: "18", marginPercent: "62", updatedAt: new Date() };
    const res = await request(app).get("/eto-requests/42/price-calculator");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ contingencyPercent: "18", marginPercent: "62", saved: false });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each(["art", "superuser"])("saves per-ETO values as %s and records the audit actor", async (r) => {
    role = r;
    const res = await request(app).put("/eto-requests/42/price-calculator")
      .send({ contingencyPercent: "20", marginPercent: "65" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ contingencyPercent: "20", marginPercent: "65", saved: true });
    expect(audit[0]).toMatchObject({ etoRequestId: 42, changedById: 7, section: "art-final" });
    expect(audit[0].changes).toEqual([
      { field: "Contingency %", oldValue: "10", newValue: "20" },
      { field: "Margin %", oldValue: "55", newValue: "65" },
    ]);
  });

  it("preserves saved percentages after Admin defaults change", async () => {
    await request(app).put("/eto-requests/42/price-calculator")
      .send({ contingencyPercent: "15", marginPercent: "57" });
    settings = { contingencyPercent: "30", marginPercent: "80", updatedAt: new Date() };
    const res = await request(app).get("/eto-requests/42/price-calculator");
    expect(res.body).toMatchObject({ contingencyPercent: "15", marginPercent: "57", saved: true });
  });

  it.each(["sales", "engineering", "production", "admin"])("blocks %s from changing ETO pricing", async (r) => {
    role = r;
    const res = await request(app).put("/eto-requests/42/price-calculator")
      .send({ contingencyPercent: "15", marginPercent: "60" });
    expect(res.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["draft", "engineering-review", "quoted", "won"])("blocks saving outside Final Review (%s)", async (stage) => {
    eto = { id: 42, stage };
    const res = await request(app).put("/eto-requests/42/price-calculator")
      .send({ contingencyPercent: "15", marginPercent: "60" });
    expect(res.status).toBe(409);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([
    {}, { contingencyPercent: "", marginPercent: "55" },
    { contingencyPercent: " ", marginPercent: "55" },
    { contingencyPercent: "-1", marginPercent: "55" },
    { contingencyPercent: "101", marginPercent: "55" },
    { contingencyPercent: "10", marginPercent: "NaN" },
    { contingencyPercent: "Infinity", marginPercent: "55" },
    { contingencyPercent: 10, marginPercent: "55" },
  ])("rejects missing or invalid percentages before writes: %j", async (body) => {
    const res = await request(app).put("/eto-requests/42/price-calculator").send(body);
    expect(res.status).toBe(422);
    expect(mocks.insert).not.toHaveBeenCalled();
    role = "admin";
    expect((await request(app).put("/admin/price-calculator").send(body)).status).toBe(422);
  });

  it("allows zero, decimal and 100% values without treating zero as missing", () => {
    expect(parsePricePercentages({ contingencyPercent: "0", marginPercent: "100" }))
      .toEqual({ contingencyPercent: "0", marginPercent: "100" });
    expect(parsePricePercentages({ contingencyPercent: " 12.5 ", marginPercent: "55.5" }))
      .toEqual({ contingencyPercent: "12.5", marginPercent: "55.5" });
  });

  it("returns 404 rather than defaults for a missing ETO", async () => {
    eto = null;
    expect((await request(app).get("/eto-requests/42/price-calculator")).status).toBe(404);
    expect((await request(app).put("/eto-requests/42/price-calculator")
      .send({ contingencyPercent: "10", marginPercent: "55" })).status).toBe(404);
  });
});