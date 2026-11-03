import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { engineeringOutputsTable, productionOutputsTable, assemblyFormulaSettingsTable, detailChangesTable, mockSelect, mockInsert } = vi.hoisted(() => ({
  engineeringOutputsTable: { etoRequestId: "etoRequestId" },
  productionOutputsTable: { etoRequestId: "etoRequestId" },
  assemblyFormulaSettingsTable: { id: "id" },
  detailChangesTable: {},
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
  },
  designFormulaSettingsTable: { id: "id" },
  assemblyFormulaSettingsTable,
}));
vi.mock("@workspace/db/schema", () => ({
  engineeringOutputsTable,
  detailChangesTable,
  productionOutputsTable,
  artFinalOutputsTable: {},
  usersTable: {},
}));
let activeRole = "engineering";
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = { id: 7, role: activeRole };
    next();
  },
}));

import outputsRouter from "../outputs";

describe("Engineering Output calculation snapshots", () => {
  it("keeps the original formula when design hours are edited after Admin changes settings", async () => {
    activeRole = "engineering";
    const existing = {
      id: 9,
      etoRequestId: 42,
      costEstimate: null,
      costEstimateCurrency: "USD",
      docLeadtime: null,
      estimatedDesignHours: "40",
      designCost: "4000",
      designLeadTimeWeeks: "2.86",
      designHourlyRate: "100",
      designHoursPerWeek: "40",
      designCapacityFactor: "0.35",
      pnGuidance: "Use existing design",
      notes: null,
      createdAt: new Date("2026-09-29"),
    };
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({ limit: async () => [existing] }),
      }),
    });
    let saved: Record<string, unknown> = {};
    mockInsert.mockImplementation((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === detailChangesTable) return Promise.resolve();
        saved = values;
        return {
          onConflictDoUpdate: () => ({
            returning: async () => [{ ...existing, ...values }],
          }),
        };
      },
    }));

    const app = express();
    app.use(express.json());
    app.use("/eto-requests/:id", outputsRouter);

    const response = await request(app)
      .put("/eto-requests/42/engineering-output")
      .send({
        estimatedDesignHours: "20",
        riskScore: "Low",
        pnGuidance: "Use existing design",
      });

    expect(response.status).toBe(200);
    expect(saved).toMatchObject({
      estimatedDesignHours: "20",
      designCost: "2000",
      designLeadTimeWeeks: "1.43",
      designHourlyRate: "100",
      designHoursPerWeek: "40",
      designCapacityFactor: "0.35",
    });
  });
});


describe("Production Output values", () => {
  it("saves new fields without changing historical week-based values", async () => {
    activeRole = "production";
    let row: Record<string, unknown> = {
      id: 11,
      etoRequestId: 42,
      mfgLeadtime: "4",
      prodLeadtime: "2",
      procurementCost: null,
      procurementCostCurrency: "USD",
      procurementLeadTime: null,
      assemblyTimeHours: null,
      assemblyCost: null,
      assemblyCostCurrency: "USD",
      assemblyLeadTimeWeeks: null,
      notes: null,
      createdAt: new Date("2026-09-29"),
    };
    let activeFormula: Record<string, unknown> | null = null;
    mockSelect.mockReturnValue({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => table === assemblyFormulaSettingsTable
            ? activeFormula ? [activeFormula] : []
            : [row],
        }),
      }),
    });
    mockInsert.mockImplementation((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === detailChangesTable) return Promise.resolve();
        return {
          onConflictDoUpdate: () => ({
            returning: async () => {
              row = { ...row, ...values };
              return [row];
            },
          }),
        };
      },
    }));
    const app = express();
    app.use(express.json());
    app.use("/eto-requests/:id", outputsRouter);

    const saved = await request(app)
      .put("/eto-requests/42/production-output")
      .send({
        procurementCost: "0",
        riskScore: "Low",
        procurementCostCurrency: "EUR",
        procurementLeadTime: "3",
        assemblyTimeHours: "8.5",
        mfgLeadtime: "4",
        prodLeadtime: "2",
      });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      procurementCost: "0",
      procurementCostCurrency: "EUR",
      procurementLeadTime: "3",
      assemblyTimeHours: "8.5",
      assemblyCost: "595",
      assemblyCostCurrency: "USD",
      assemblyLeadTimeWeeks: "0.33",
      mfgLeadtime: "4",
      prodLeadtime: "2",
    });

    const loaded = await request(app).get("/eto-requests/42/production-output");
    expect(loaded.status).toBe(200);
    expect(loaded.body).toMatchObject(saved.body);

    activeFormula = { hourlyRate: "200", hoursPerWeek: "20", capacityFactor: "0.5" };
    const edited = await request(app)
      .put("/eto-requests/42/production-output")
      .send({
        procurementCost: "0",
        procurementCostCurrency: "EUR",
        procurementLeadTime: "3",
        assemblyTimeHours: "13",
        mfgLeadtime: "4",
        prodLeadtime: "2",
      });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      assemblyTimeHours: "13",
      assemblyCost: "910",
      assemblyLeadTimeWeeks: "0.50",
      mfgLeadtime: "4",
      prodLeadtime: "2",
    });
    expect(row).toMatchObject({
      assemblyHourlyRate: "70",
      assemblyHoursPerWeek: "40",
      assemblyCapacityFactor: "0.65",
    });
  });
});

describe("Engineering and Production risk score output edits", () => {
  const app = express();
  app.use(express.json());
  app.use("/eto-requests/:id", outputsRouter);

  let row: Record<string, unknown>;
  let savedValues: Record<string, unknown> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    activeRole = "engineering";
    savedValues = null;
  });

  function configureExistingOutput(table: unknown) {
    mockSelect.mockImplementation(() => {
      let selectedTable: unknown;
      const chain: any = {
        from: (source: unknown) => {
          selectedTable = source;
          return chain;
        },
        where: () => chain,
        limit: async () => selectedTable === table ? [row] : [],
      };
      return chain;
    });
    mockInsert.mockImplementation((target: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (target === detailChangesTable) return Promise.resolve();
        savedValues = values;
        return {
          onConflictDoUpdate: () => ({
            returning: async () => {
              row = { ...row, ...values };
              return [row];
            },
          }),
        };
      },
    }));
  }

  const specialistCases = [
    {
      label: "Engineering",
      role: "engineering",
      table: engineeringOutputsTable,
      path: "engineering-output",
      row: {
        id: 9,
        etoRequestId: 42,
        estimatedDesignHours: "40",
        designHourlyRate: "100",
        designHoursPerWeek: "40",
        designCapacityFactor: "0.35",
        riskScore: "High",
        riskNotes: "Existing engineering explanation",
        createdAt: new Date("2026-09-29"),
      },
      body: { estimatedDesignHours: "40" },
    },
    {
      label: "Production",
      role: "production",
      table: productionOutputsTable,
      path: "production-output",
      row: {
        id: 11,
        etoRequestId: 42,
        assemblyTimeHours: "8",
        assemblyHourlyRate: "70",
        assemblyHoursPerWeek: "40",
        assemblyCapacityFactor: "0.65",
        riskScore: "High",
        riskNotes: "Existing production explanation",
        createdAt: new Date("2026-09-29"),
      },
      body: {
        procurementCost: "100",
        procurementLeadTime: "3",
        assemblyTimeHours: "8",
      },
    },
  ] as const;

  it.each(specialistCases)(
    "requires a score when editing historical unscored $label output",
    async ({ role, table, path, row: existing, body }) => {
      activeRole = role;
      row = { ...existing, riskScore: null, riskNotes: null };
      configureExistingOutput(table);
      const response = await request(app).put(`/eto-requests/42/${path}`).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Risk Score is required");
      expect(savedValues).toBeNull();
    },
  );

  it.each(specialistCases)(
    "preserves omitted $label risk values on ordinary edits and returns them from GET",
    async ({ role, table, path, row: existing, body }) => {
      activeRole = role;
      row = { ...existing };
      configureExistingOutput(table);

      const edited = await request(app)
        .put(`/eto-requests/42/${path}`)
        .send(body);

      expect(edited.status).toBe(200);
      expect(savedValues).toMatchObject({
        riskScore: "High",
        riskNotes: existing.riskNotes,
      });
      expect(edited.body).toMatchObject({
        riskScore: "High",
        riskNotes: existing.riskNotes,
      });

      const loaded = await request(app).get(`/eto-requests/42/${path}`);
      expect(loaded.status).toBe(200);
      expect(loaded.body).toMatchObject({
        riskScore: "High",
        riskNotes: existing.riskNotes,
      });
    },
  );

  it.each(specialistCases)(
    "accepts and trims a High risk explanation for $label output",
    async ({ role, table, path, row: existing, body }) => {
      activeRole = role;
      row = { ...existing, riskScore: null, riskNotes: null };
      configureExistingOutput(table);

      const response = await request(app)
        .put(`/eto-requests/42/${path}`)
        .send({ ...body, riskScore: "High", riskNotes: "  Supplier availability is uncertain \n" });

      expect(response.status).toBe(200);
      expect(savedValues).toMatchObject({
        riskScore: "High",
        riskNotes: "Supplier availability is uncertain",
      });
      expect(response.body).toMatchObject({
        riskScore: "High",
        riskNotes: "Supplier availability is uncertain",
      });
    },
  );

  it.each(specialistCases.flatMap((specialist) => [
    { ...specialist, badRisk: { riskScore: null, riskNotes: null } },
    { ...specialist, badRisk: { riskScore: "", riskNotes: null } },
    { ...specialist, badRisk: { riskScore: "Critical", riskNotes: "Not an allowed value" } },
    { ...specialist, badRisk: { riskScore: "high", riskNotes: "Not case-correct" } },
    { ...specialist, badRisk: { riskScore: "High", riskNotes: " \t\n" } },
  ]))(
    "rejects invalid or unexplained High risk values with 400 for $label output",
    async ({ role, table, path, row: existing, body, badRisk }) => {
      activeRole = role;
      row = { ...existing, riskScore: null, riskNotes: null };
      configureExistingOutput(table);

      const response = await request(app)
        .put(`/eto-requests/42/${path}`)
        .send({ ...body, ...badRisk });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Risk");
      expect(savedValues).toBeNull();
    },
  );
});