import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express, { Router } from "express";

const {
  mockDbSelect,
  mockDbTransaction,
  mockSendTransitionEmails,
  etoRequestsTable,
  stageTransitionsTable,
  engineeringOutputsTable,
  productionOutputsTable,
  designFormulaSettingsTable,
  assemblyFormulaSettingsTable,
  reviewAssignmentDefaultsTable,
  usersTable,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockSendTransitionEmails: vi.fn(),
  etoRequestsTable: {
    id: "id",
    stage: "stage",
    assigneeId: "assigneeId",
    productionAssigneeId: "productionAssigneeId",
    stickyEngineerUserId: "stickyEngineerUserId",
    declineReason: "declineReason",
    updatedAt: "updatedAt",
  },
  stageTransitionsTable: {
    id: "id",
    etoRequestId: "etoRequestId",
    actorId: "actorId",
    fromStage: "fromStage",
    toStage: "toStage",
    decision: "decision",
    reason: "reason",
    createdAt: "createdAt",
  },
  engineeringOutputsTable: { etoRequestId: "etoRequestId" },
  productionOutputsTable: { etoRequestId: "etoRequestId" },
  designFormulaSettingsTable: { id: "id" },
  assemblyFormulaSettingsTable: { id: "id" },
  reviewAssignmentDefaultsTable: { id: "id" },
  usersTable: { id: "id", email: "email", role: "role" },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    transaction: (...args: any[]) => mockDbTransaction(...args),
  },
  ETO_STAGES: [
    "draft",
    "art-review",
    "engineering-review",
    "production-review",
    "art-final-review",
    "quoted",
    "won",
    "declined",
    "lost",
    "abandoned",
    "closed",
  ],
  designFormulaSettingsTable,
  assemblyFormulaSettingsTable,
  reviewAssignmentDefaultsTable,
  reviewDefaultsId: (entity?: string | null) => entity === "TOUK" ? 2 : 1,
}));

vi.mock("@workspace/db/schema", () => ({
  etoRequestsTable,
  stageTransitionsTable,
  usersTable,
  engineeringOutputsTable,
  productionOutputsTable,
  artFinalOutputsTable: {},
  detailChangesTable: {},
  reviewAssignmentDefaultsTable,
  reviewDefaultsId: (entity?: string | null) => entity === "TOUK" ? 2 : 1,
}));

let activeRole = "art";
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: any, res: any, next: any) => {
    res.locals.dbUser = {
      id: 7,
      name: "Ada Lovelace",
      role: activeRole,
      clerkId: "clerk_ada",
      email: "ada@example.com",
      createdAt: new Date("2024-01-01"),
    };
    next();
  },
}));

vi.mock("../../lib/email", () => ({
  sendTransitionEmails: (...args: any[]) => mockSendTransitionEmails(...args),
}));

import transitionsRouter from "../transitions";

type Stage =
  | "draft"
  | "art-review"
  | "engineering-review"
  | "production-review"
  | "art-final-review"
  | "abandoned";

type RequestState = {
  id: number;
  entity?: string | null;
  etoNumber: string;
  customerName: string;
  quoteNumber: string;
  quoteRevision: string;
  testType: string;
  materials: string;
  specimenDimensions: string;
  relevantStandards: string | null;
  customerComponents: string | null;
  customDetails: string | null;
  budgetCurrency: string;
  stage: Stage;
  includeEngineeringReview: boolean;
  includeProductionReview: boolean;
  engineeringReviewDurationWeeks?: number | null;
  productionReviewDurationWeeks?: number | null;
  artFinalReviewDurationWeeks?: number | null;
  artReviewAcceptedDate?: string | null;
  dueDate?: string | null;
  hasSplitChildren: boolean;
  assigneeId: number | null;
  productionAssigneeId: number | null;
  stickyEngineerUserId: number | null;
  submittedById: number;
  declineReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AuditRow = {
  id: number;
  etoRequestId: number;
  actorId: number;
  fromStage: string;
  toStage: string;
  decision: string;
  reason: string | null;
  createdAt: Date;
};

const BASE_REQUEST: RequestState = {
  id: 42,
  etoNumber: "ETO-2026-0042",
  customerName: "Acme Testing",
  quoteNumber: "Q-42",
  quoteRevision: "A",
  testType: "Tensile",
  materials: "Steel",
  specimenDimensions: "10 x 10",
  relevantStandards: null,
  customerComponents: null,
  customDetails: null,
  budgetCurrency: "USD",
  stage: "art-review",
  includeEngineeringReview: true,
  includeProductionReview: true,
  hasSplitChildren: false,
  assigneeId: null,
  productionAssigneeId: null,
  stickyEngineerUserId: null,
  submittedById: 7,
  declineReason: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

let currentRequest: RequestState;
let auditRows: AuditRow[];
let engineeringOutputInserts: Array<Record<string, unknown>>;
let productionOutputInserts: Array<Record<string, unknown>>;
let formulaSettings: { hourlyRate: string; hoursPerWeek: string; capacityFactor: string };
let assemblyFormulaSettings: { hourlyRate: string; hoursPerWeek: string; capacityFactor: string } | null;
let reviewDefaults: { engineeringUserId: number; productionUserId: number } | null;
let ukReviewDefaults: typeof reviewDefaults;
let nextAuditId: number;
let holdInitialReads = false;
let initialReadWaiters: Array<{
  snapshot: RequestState;
  resolve: (rows: RequestState[]) => void;
}> = [];

function makeSelectChain(selection?: Record<string, unknown>) {
  let source: unknown;
  let hasJoins = false;
  let requestSnapshot: RequestState | undefined;
  let selectedUserId: number | undefined;
  let defaultsId = 1;

  const resolveRows = () => {
    if (source === designFormulaSettingsTable) return [formulaSettings];
    if (source === assemblyFormulaSettingsTable) return assemblyFormulaSettings ? [assemblyFormulaSettings] : [];
    if (source === reviewAssignmentDefaultsTable) {
      const defaults = defaultsId === 2 ? ukReviewDefaults : reviewDefaults;
      return defaults ? [defaults] : [];
    }
    if (source === stageTransitionsTable) {
      if (selection && "id" in selection) {
        const completion = auditRows.find(
          (row) =>
            row.etoRequestId === currentRequest.id &&
            row.decision === "engineering-quote-ready",
        );
        return completion ? [{ id: completion.id }] : [];
      }

      const abandonments = auditRows
        .filter(
          (row) =>
            row.etoRequestId === currentRequest.id &&
            row.toStage === "abandoned" &&
            row.decision === "mark-abandoned",
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const latest = abandonments[abandonments.length - 1];
      return latest ? [{ fromStage: latest.fromStage }] : [];
    }

    if (source === usersTable) {
      if (selection && "role" in selection && selectedUserId) {
        return [{ id: selectedUserId, role: [23, 35].includes(selectedUserId) ? "production" : "engineering" }];
      }
      return [];
    }

    if (source === etoRequestsTable && hasJoins) {
      return [
        {
          r: currentRequest,
          assigneeName: null,
          assigneeEmail: null,
          assigneeRole: null,
          stickyEngineerName: null,
          submittedByName: "Ada Lovelace",
          submittedByEmail: "ada@example.com",
        },
      ];
    }

    return [requestSnapshot ?? currentRequest];
  };

  const initialRows = () => {
    const snapshot = requestSnapshot ?? currentRequest;
    if (!holdInitialReads) return Promise.resolve([snapshot]);

    return new Promise<RequestState[]>((resolve) => {
      initialReadWaiters.push({ snapshot, resolve });
      if (initialReadWaiters.length === 2) {
        const waiters = initialReadWaiters;
        initialReadWaiters = [];
        holdInitialReads = false;
        for (const waiter of waiters) waiter.resolve([waiter.snapshot]);
      }
    });
  };

  const chain: any = {
    from: vi.fn((table: unknown) => {
      source = table;
      selectedUserId = undefined;
      if (table === etoRequestsTable && !hasJoins) {
        requestSnapshot = { ...currentRequest };
      }
      return chain;
    }),
    leftJoin: vi.fn(() => {
      hasJoins = true;
      return chain;
    }),
    innerJoin: vi.fn(() => {
      hasJoins = true;
      return chain;
    }),
    where: vi.fn((predicate: unknown) => {
      if (source === reviewAssignmentDefaultsTable) {
        defaultsId = containsQueryChunk(predicate, 2) ? 2 : 1;
      }
      if (source === usersTable) {
        selectedUserId = [19, 23, 34, 35, 7].find((id) => containsQueryChunk(predicate, id));
      }
      return chain;
    }),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => {
      if (source === etoRequestsTable && !hasJoins) return initialRows();
      return Promise.resolve(resolveRows());
    }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(resolveRows()).then(resolve, reject),
  };

  return chain;
}

function configureDatabaseDouble() {
  mockDbSelect.mockImplementation((selection?: Record<string, unknown>) =>
    makeSelectChain(selection),
  );
  mockDbTransaction.mockImplementation(async (callback: (tx: any) => Promise<boolean>) =>
    callback({
      update: vi.fn(() => ({
        set: vi.fn((values: Partial<RequestState>) => ({
          where: vi.fn((whereExpression: unknown) => ({
            returning: vi.fn(async () => {
              // This mirrors the route's SQL predicate:
              // WHERE id = :id AND stage = :stage-read-by-this-request.
              // A second request sees the stage changed by the first and gets
              // no row back, so it cannot create an audit entry.
              if (!containsQueryChunk(whereExpression, "stage")) {
                throw new Error("Test setup expected the atomic stage predicate");
              }

              const canApply =
                values.stage === "abandoned"
                  ? currentRequest.stage !== "abandoned"
                  : currentRequest.stage === "abandoned"
                    ? true
                    : currentRequest.stage === "art-review" &&
                      (values.stage === "engineering-review" || values.stage === "production-review" || values.stage === "art-final-review")
                      ? true
                    : currentRequest.stage === "engineering-review" &&
                      values.stage === "production-review"
                      ? true
                    : currentRequest.stage === "production-review" &&
                      values.stage === "art-final-review"
                      ? true
                    : currentRequest.stage === "art-final-review" &&
                      (values.stage === "engineering-review" || values.stage === "production-review");

              if (!canApply) return [];

              currentRequest = {
                ...currentRequest,
                ...values,
                stage: values.stage as Stage,
              };
              return [{ id: currentRequest.id }];
            }),
          })),
        })),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Omit<AuditRow, "id" | "createdAt">) => {
          if (table === engineeringOutputsTable) {
            return {
              onConflictDoUpdate: vi.fn(async () => {
                engineeringOutputInserts.push(values);
              }),
            };
          }
          if (table === productionOutputsTable) {
            return {
              onConflictDoUpdate: vi.fn(async () => {
                productionOutputInserts.push(values);
              }),
            };
          }
          auditRows.push({
            ...values,
            id: nextAuditId++,
            createdAt: new Date(),
          });
          return Promise.resolve();
        }),
      })),
    }),
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });

  const parent = Router();
  parent.use("/:id/transitions", transitionsRouter);
  app.use("/eto-requests", parent);
  return app;
}

function seedAbandonedRequest(...previousStages: Stage[]) {
  currentRequest = { ...BASE_REQUEST, stage: "abandoned" };
  auditRows = previousStages.map((fromStage, index) => ({
    id: index + 1,
    etoRequestId: currentRequest.id,
    actorId: 7,
    fromStage,
    toStage: "abandoned",
    decision: "mark-abandoned",
    reason: `abandoned from ${fromStage}`,
    createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, index)),
  }));
  nextAuditId = auditRows.length + 1;
}

function containsQueryChunk(value: unknown, target: unknown, seen = new Set<object>()): boolean {
  if (value === target) return true;
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => containsQueryChunk(item, target, seen));
  }

  const queryChunks = (value as { queryChunks?: unknown }).queryChunks;
  if (queryChunks) return containsQueryChunk(queryChunks, target, seen);

  const chunkValue = (value as { value?: unknown }).value;
  return chunkValue !== undefined && containsQueryChunk(chunkValue, target, seen);
}

describe("POST /eto-requests/:id/transitions lifecycle controls", () => {
  const app = buildApp();

  beforeEach(() => {
    vi.clearAllMocks();
    activeRole = "art";
    currentRequest = { ...BASE_REQUEST };
    auditRows = [];
    engineeringOutputInserts = [];
    productionOutputInserts = [];
    formulaSettings = { hourlyRate: "100", hoursPerWeek: "40", capacityFactor: "0.35" };
    assemblyFormulaSettings = null;
    reviewDefaults = { engineeringUserId: 19, productionUserId: 23 };
    ukReviewDefaults = { engineeringUserId: 34, productionUserId: 35 };
    nextAuditId = 1;
    holdInitialReads = false;
    initialReadWaiters = [];
    configureDatabaseDouble();
    mockSendTransitionEmails.mockResolvedValue(undefined);
  });

  it("assigns the configured engineer when ART accepts without a manual choice", async () => {
    const response = await request(app).post("/eto-requests/42/transitions")
      .send({ decision: "approve-engineering", includeEngineeringReview: true, includeProductionReview: true });
    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({
      stage: "engineering-review", assigneeId: 19, stickyEngineerUserId: 19,
    });
  });

  it("keeps a manually chosen engineer sticky instead of the default", async () => {
    const response = await request(app).post("/eto-requests/42/transitions")
      .send({ decision: "approve-engineering", assigneeId: 34 });
    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({
      stage: "engineering-review", assigneeId: 34, stickyEngineerUserId: 34,
    });
  });

  it("saves the default three-week deadline at ART acceptance", async () => {
    const response = await request(app).post("/eto-requests/42/transitions")
      .send({ decision: "approve-engineering", reviewTimeZone: "UTC" });
    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({
      engineeringReviewDurationWeeks: 1,
      productionReviewDurationWeeks: 1,
      artFinalReviewDurationWeeks: 1,
      artReviewAcceptedDate: new Date().toISOString().slice(0, 10),
    });
    const expected = new Date(`${currentRequest.artReviewAcceptedDate}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() + 21);
    expect(response.body.dueDate).toBe(expected.toISOString().slice(0, 10));
    expect(currentRequest.dueDate).toBe(response.body.dueDate);
  });

  it.each([
    [true, true, 63],
    [false, true, 49],
    [true, false, 42],
    [false, false, 28],
  ])("counts only included reviews (Engineering=%s, Production=%s)", async (engineering, production, days) => {
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering",
      includeEngineeringReview: engineering,
      includeProductionReview: production,
      engineeringReviewDurationWeeks: 2,
      productionReviewDurationWeeks: 3,
      artFinalReviewDurationWeeks: 4,
    });
    expect(response.status).toBe(200);
    const expected = new Date(`${currentRequest.artReviewAcceptedDate}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() + Number(days));
    expect(currentRequest.dueDate).toBe(expected.toISOString().slice(0, 10));
    expect(response.body.dueDate).toBe(currentRequest.dueDate);
    expect(response.body.engineeringReviewDurationWeeks).toBe(2);
    expect(response.body.productionReviewDurationWeeks).toBe(3);
    expect(response.body.artFinalReviewDurationWeeks).toBe(4);
    expect(currentRequest.stage).toBe(engineering
      ? "engineering-review" : production ? "production-review" : "art-final-review");
  });

  it("does not reset an existing deadline or durations on ART reacceptance", async () => {
    currentRequest = {
      ...BASE_REQUEST,
      engineeringReviewDurationWeeks: 2,
      productionReviewDurationWeeks: 1,
      artFinalReviewDurationWeeks: 1,
      artReviewAcceptedDate: "2026-09-01",
      dueDate: "2026-09-29",
    };
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering",
      engineeringReviewDurationWeeks: 9,
      productionReviewDurationWeeks: 9,
      artFinalReviewDurationWeeks: 9,
    });
    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({
      engineeringReviewDurationWeeks: 2,
      productionReviewDurationWeeks: 1,
      artFinalReviewDurationWeeks: 1,
      artReviewAcceptedDate: "2026-09-01",
      dueDate: "2026-09-29",
    });
    expect(response.body.dueDate).toBe("2026-09-29");
  });

  it.each([-1, 521, "", "two", null])("rejects invalid review duration %j without advancing", async (duration) => {
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering", engineeringReviewDurationWeeks: duration,
    });
    expect(response.status).toBe(422);
    expect(currentRequest.stage).toBe("art-review");
    expect(currentRequest.dueDate).toBeUndefined();
    expect(auditRows).toHaveLength(0);
  });

  it("rejects an invalid acceptance time zone without setting a deadline", async () => {
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering", reviewTimeZone: "Not/AZone",
    });
    expect(response.status).toBe(422);
    expect(currentRequest.dueDate).toBeUndefined();
    expect(auditRows).toHaveLength(0);
  });

  it("assigns ART's chosen Production reviewer when Engineering is skipped", async () => {
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering",
      includeEngineeringReview: false,
      includeProductionReview: true,
      productionAssigneeId: 35,
    });
    expect(response.status).toBe(200);
    expect(response.body.productionAssigneeId).toBe(35);
    expect(currentRequest).toMatchObject({
      stage: "production-review", assigneeId: 35, productionAssigneeId: 35,
    });
  });

  it("keeps the selected Production reviewer while Engineering happens first", async () => {
    const accepted = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering", productionAssigneeId: 35,
    });
    expect(accepted.status).toBe(200);
    expect(currentRequest).toMatchObject({
      stage: "engineering-review", assigneeId: 19, productionAssigneeId: 35,
    });

    activeRole = "engineering";
    const completed = await request(app).post("/eto-requests/42/transitions").send({
      decision: "engineering-quote-ready",
      engineeringEstimatedDesignHours: "8",
      engineeringPnGuidance: "PN-42",
      engineeringRiskScore: "Low",
    });
    expect(completed.status).toBe(200);
    expect(currentRequest).toMatchObject({
      stage: "production-review", assigneeId: 35, productionAssigneeId: 35,
    });
  });

  it("uses TOUK defaults immediately when ART changes the Entity to TOUK", async () => {
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering", entity: "TOUK",
    });
    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({
      entity: "TOUK", stage: "engineering-review", assigneeId: 34,
    });
  });

  it("uses the stored TOUK Entity when Engineering advances to Production", async () => {
    currentRequest = { ...currentRequest, entity: "TOUK", stage: "engineering-review", assigneeId: 34 };
    activeRole = "engineering";
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "engineering-quote-ready", engineeringEstimatedDesignHours: "8",
      engineeringPnGuidance: "PN-42", engineeringRiskScore: "Low",
    });
    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({ stage: "production-review", assigneeId: 35 });
  });

  it("does not silently use TOUS defaults when TOUK has not been configured", async () => {
    ukReviewDefaults = null;
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering", entity: "TOUK",
    });
    expect(response.status).toBe(422);
    expect(currentRequest.stage).toBe("art-review");
  });

  it("does not replace ART's saved selection when the Production default changes", async () => {
    const accepted = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering", productionAssigneeId: 23,
    });
    expect(accepted.status).toBe(200);
    reviewDefaults = { engineeringUserId: 19, productionUserId: 35 };
    activeRole = "engineering";
    const completed = await request(app).post("/eto-requests/42/transitions").send({
      decision: "engineering-quote-ready",
      engineeringEstimatedDesignHours: "8",
      engineeringPnGuidance: "PN-42",
      engineeringRiskScore: "Low",
    });
    expect(completed.status).toBe(200);
    expect(currentRequest.assigneeId).toBe(23);
  });

  it("restores the chosen Production reviewer on a backward return", async () => {
    currentRequest = {
      ...BASE_REQUEST, stage: "art-final-review", productionAssigneeId: 35,
    };
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "art-final-return-production", reason: "Revise procurement estimate",
    });
    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({
      stage: "production-review", assigneeId: 35, productionAssigneeId: 35,
    });
  });

  it("rejects a non-Production selection before starting Engineering", async () => {
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering", productionAssigneeId: 34,
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toContain("'production' role");
    expect(currentRequest.stage).toBe("art-review");
    expect(auditRows).toHaveLength(0);
  });

  it("does not accept Production reassignment through other workflow decisions", async () => {
    currentRequest = { ...BASE_REQUEST, stage: "engineering-review", assigneeId: 19 };
    activeRole = "engineering";
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "engineering-quote-ready",
      productionAssigneeId: 35,
      engineeringEstimatedDesignHours: "8",
      engineeringPnGuidance: "PN-42",
    });
    expect(response.status).toBe(422);
    expect(currentRequest.stage).toBe("engineering-review");
  });

  it("clears the saved Production reviewer when ART skips Production", async () => {
    currentRequest = { ...BASE_REQUEST, productionAssigneeId: 35 };
    const response = await request(app).post("/eto-requests/42/transitions").send({
      decision: "approve-engineering", includeProductionReview: false,
    });
    expect(response.status).toBe(200);
    expect(currentRequest.productionAssigneeId).toBeNull();
  });

  it("assigns the Production default when ART skips Engineering", async () => {
    const response = await request(app).post("/eto-requests/42/transitions")
      .send({ decision: "approve-engineering", includeEngineeringReview: false, includeProductionReview: true });
    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({
      stage: "production-review", assigneeId: 23, stickyEngineerUserId: null,
    });
  });

  it("does not advance into Production without a configured default", async () => {
    reviewDefaults = null;
    const response = await request(app).post("/eto-requests/42/transitions")
      .send({ decision: "approve-engineering", includeEngineeringReview: false, includeProductionReview: true });
    expect(response.status).toBe(422);
    expect(response.body.error).toContain("default production reviewer");
    expect(currentRequest.stage).toBe("art-review");
  });

  it("requires a default engineer when ART has not chosen an override", async () => {
    reviewDefaults = null;
    const response = await request(app).post("/eto-requests/42/transitions")
      .send({ decision: "approve-engineering" });
    expect(response.status).toBe(422);
    expect(response.body.error).toContain("default engineering reviewer");
    expect(currentRequest.stage).toBe("art-review");
  });

  it("assigns the Production default when ART Final sends a review back", async () => {
    currentRequest = { ...BASE_REQUEST, stage: "art-final-review", assigneeId: null };
    const response = await request(app).post("/eto-requests/42/transitions")
      .send({ decision: "art-final-return-production", reason: "Update procurement estimate" });
    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({ stage: "production-review", assigneeId: 23 });
  });

  it.each([undefined, "0", "-1", "not a number"])(
    "requires positive Estimated Design hours to complete Engineering Review (%s)",
    async (hours) => {
      activeRole = "engineering";
      currentRequest = { ...BASE_REQUEST, stage: "engineering-review" };

      const response = await request(app)
        .post("/eto-requests/42/transitions")
        .send({
          decision: "engineering-quote-ready",
          engineeringEstimatedDesignHours: hours,
          engineeringPnGuidance: "Use existing design",
        });

      expect(response.status).toBe(422);
      expect(response.body.error).toContain("engineeringEstimatedDesignHours");
      expect(mockDbTransaction).not.toHaveBeenCalled();
    },
  );

  it("saves Estimated Design hours when Engineering Review is completed", async () => {
    activeRole = "engineering";
    currentRequest = { ...BASE_REQUEST, stage: "engineering-review" };

    const response = await request(app)
      .post("/eto-requests/42/transitions")
      .send({
        decision: "engineering-quote-ready",
        engineeringEstimatedDesignHours: "12.5",
        engineeringPnGuidance: "Use existing design",
        engineeringRiskScore: "Low",
      });

    expect(response.status).toBe(200);
    expect(currentRequest.stage).toBe("production-review");
    expect(currentRequest.assigneeId).toBe(23);
    expect(engineeringOutputInserts).toEqual([
      expect.objectContaining({
        estimatedDesignHours: "12.5",
        designCost: "1250",
        designLeadTimeWeeks: "0.89",
        designHourlyRate: "100",
        designHoursPerWeek: "40",
        designCapacityFactor: "0.35",
        pnGuidance: "Use existing design",
      }),
    ]);
  });

  it.each([
    ["engineering-quote-ready", "engineering", "engineering-review", "engineeringRiskScore", "engineeringRiskNotes"],
    ["production-approve", "production", "production-review", "productionRiskScore", "productionRiskNotes"],
  ] as const)(
    "rejects a High %s risk score without an explanation before changing workflow state",
    async (decision, role, stage, scoreField, notesField) => {
      activeRole = role;
      currentRequest = { ...BASE_REQUEST, stage };
      const requiredInputs = decision === "engineering-quote-ready"
        ? { engineeringEstimatedDesignHours: "8", engineeringPnGuidance: "PN-42" }
        : {
            productionProcurementCost: "100",
            productionProcurementLeadTime: "3",
            productionAssemblyTimeHours: "8",
          };

      for (const notes of [undefined, " \n\t"]) {
        const response = await request(app)
          .post("/eto-requests/42/transitions")
          .send({ decision, ...requiredInputs, [scoreField]: "High", [notesField]: notes });

        expect(response.status).toBe(422);
        expect(response.body.error).toContain("Risk Notes");
        expect(currentRequest.stage).toBe(stage);
        expect(auditRows).toHaveLength(0);
        expect(engineeringOutputInserts).toHaveLength(0);
        expect(productionOutputInserts).toHaveLength(0);
        expect(mockDbTransaction).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["engineering-quote-ready", "engineering", "engineering-review", "engineeringRiskScore", "engineeringRiskNotes"],
    ["production-approve", "production", "production-review", "productionRiskScore", "productionRiskNotes"],
  ] as const)(
    "persists a trimmed High explanation for %s",
    async (decision, role, stage, scoreField, notesField) => {
      activeRole = role;
      currentRequest = { ...BASE_REQUEST, stage };
      const requiredInputs = decision === "engineering-quote-ready"
        ? { engineeringEstimatedDesignHours: "8", engineeringPnGuidance: "PN-42" }
        : {
            productionProcurementCost: "100",
            productionProcurementLeadTime: "3",
            productionAssemblyTimeHours: "8",
          };

      const response = await request(app)
        .post("/eto-requests/42/transitions")
        .send({
          decision,
          ...requiredInputs,
          [scoreField]: "High",
          [notesField]: "  Elevated risk due to supplier lead time \n",
        });

      expect(response.status).toBe(200);
      expect(currentRequest.stage).not.toBe(stage);
      expect(auditRows).toHaveLength(1);
      const output = decision === "engineering-quote-ready"
        ? engineeringOutputInserts[0]
        : productionOutputInserts[0];
      expect(output).toMatchObject({
        riskScore: "High",
        riskNotes: "Elevated risk due to supplier lead time",
      });
    },
  );

  it.each([
    ["engineering-quote-ready", "engineering", "engineering-review", "engineeringRiskScore", "engineeringRiskNotes"],
    ["production-approve", "production", "production-review", "productionRiskScore", "productionRiskNotes"],
  ] as const)(
    "accepts Low and Med %s scores without risk notes",
    async (decision, role, stage, scoreField, notesField) => {
      activeRole = role;
      currentRequest = { ...BASE_REQUEST, stage };
      const requiredInputs = decision === "engineering-quote-ready"
        ? { engineeringEstimatedDesignHours: "8", engineeringPnGuidance: "PN-42" }
        : {
            productionProcurementCost: "100",
            productionProcurementLeadTime: "3",
            productionAssemblyTimeHours: "8",
          };

      for (const riskScore of ["Low", "Med"]) {
        currentRequest = { ...BASE_REQUEST, stage };
        auditRows = [];
        engineeringOutputInserts = [];
        productionOutputInserts = [];
        const response = await request(app)
          .post("/eto-requests/42/transitions")
          .send({ decision, ...requiredInputs, [scoreField]: riskScore });

        expect(response.status).toBe(200);
        const output = decision === "engineering-quote-ready"
          ? engineeringOutputInserts[engineeringOutputInserts.length - 1]
          : productionOutputInserts[productionOutputInserts.length - 1];
        expect(output).toMatchObject({ riskScore, riskNotes: null });
        expect(output).not.toHaveProperty(notesField);
      }
    },
  );

  it.each([
    ["engineering-quote-ready", "engineering", "engineering-review", "engineeringRiskScore", "engineeringRiskNotes"],
    ["production-approve", "production", "production-review", "productionRiskScore", "productionRiskNotes"],
  ] as const)(
    "rejects invalid risk scores for %s",
    async (decision, role, stage, scoreField, notesField) => {
      activeRole = role;
      currentRequest = { ...BASE_REQUEST, stage };
      const requiredInputs = decision === "engineering-quote-ready"
        ? { engineeringEstimatedDesignHours: "8", engineeringPnGuidance: "PN-42" }
        : {
            productionProcurementCost: "100",
            productionProcurementLeadTime: "3",
            productionAssemblyTimeHours: "8",
          };

      for (const riskScore of ["Critical", "low"]) {
        const response = await request(app)
          .post("/eto-requests/42/transitions")
          .send({ decision, ...requiredInputs, [scoreField]: riskScore, [notesField]: "Explanation" });

        expect(response.status).toBe(422);
        expect(response.body.error).toBe("Validation failed");
        expect(response.body.issues).toEqual(expect.arrayContaining([
          expect.objectContaining({ path: [scoreField] }),
        ]));
        expect(currentRequest.stage).toBe(stage);
        expect(auditRows).toHaveLength(0);
        expect(engineeringOutputInserts).toHaveLength(0);
        expect(productionOutputInserts).toHaveLength(0);
        expect(mockDbTransaction).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["engineering-quote-ready", "engineering", "engineering-review", "engineeringRiskScore"],
    ["production-approve", "production", "production-review", "productionRiskScore"],
  ] as const)("requires a risk score for %s before advancing", async (decision, role, stage, scoreField) => {
    activeRole = role;
    currentRequest = { ...BASE_REQUEST, stage };
    const inputs = decision === "engineering-quote-ready"
      ? { engineeringEstimatedDesignHours: "8", engineeringPnGuidance: "PN-42" }
      : { productionProcurementCost: "100", productionProcurementLeadTime: "3", productionAssemblyTimeHours: "8" };
    for (const missing of [undefined, null]) {
      const response = await request(app).post("/eto-requests/42/transitions")
        .send({ decision, ...inputs, [scoreField]: missing });
      expect(response.status).toBe(422);
      expect(response.body.error).toBe("Risk Score is required");
      expect(currentRequest.stage).toBe(stage);
      expect(auditRows).toHaveLength(0);
      expect(mockDbTransaction).not.toHaveBeenCalled();
    }
  });

  it("uses the current admin formula for a new Engineering completion", async () => {
    activeRole = "engineering";
    currentRequest = { ...BASE_REQUEST, stage: "engineering-review" };
    formulaSettings = { hourlyRate: "120", hoursPerWeek: "32", capacityFactor: "0.5" };

    const response = await request(app)
      .post("/eto-requests/42/transitions")
      .send({
        decision: "engineering-quote-ready",
        engineeringEstimatedDesignHours: "40",
        engineeringPnGuidance: "Use existing design",
        engineeringRiskScore: "Low",
      });

    expect(response.status).toBe(200);
    expect(engineeringOutputInserts).toEqual([
      expect.objectContaining({
        designCost: "4800",
        designLeadTimeWeeks: "2.50",
        designHourlyRate: "120",
        designHoursPerWeek: "32",
        designCapacityFactor: "0.5",
      }),
    ]);
  });

  it.each([
    { productionProcurementCost: "-1", productionProcurementLeadTime: "3", productionAssemblyTimeHours: "8" },
    { productionProcurementCost: "100", productionProcurementLeadTime: "", productionAssemblyTimeHours: "8" },
    { productionProcurementCost: "100", productionProcurementLeadTime: "3", productionAssemblyTimeHours: "hours" },
  ])("rejects invalid Production inputs: %j", async (fields) => {
    activeRole = "production";
    currentRequest = { ...BASE_REQUEST, stage: "production-review" };

    const response = await request(app)
      .post("/eto-requests/42/transitions")
      .send({ decision: "production-approve", ...fields });

    expect(response.status).toBe(422);
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("saves Procurement Cost, Procurement Lead Time, and Assembly Time on completion", async () => {
    activeRole = "production";
    currentRequest = { ...BASE_REQUEST, stage: "production-review" };

    const response = await request(app)
      .post("/eto-requests/42/transitions")
      .send({
        decision: "production-approve",
        productionProcurementCost: "251",
        productionRiskScore: "Low",
        productionProcurementCostCurrency: "GBP",
        productionProcurementLeadTime: "3",
        productionAssemblyTimeHours: "8.5",
      });

    expect(response.status).toBe(200);
    expect(currentRequest.stage).toBe("art-final-review");
    expect(productionOutputInserts).toEqual([
      expect.objectContaining({
        procurementCost: "251",
        procurementCostCurrency: "GBP",
        procurementLeadTime: "3",
        assemblyTimeHours: "8.5",
        assemblyCost: "595",
        assemblyCostCurrency: "USD",
        assemblyLeadTimeWeeks: "0.33",
        assemblyHourlyRate: "70",
        assemblyHoursPerWeek: "40",
        assemblyCapacityFactor: "0.65",
      }),
    ]);
    expect(productionOutputInserts[0]).not.toHaveProperty("prodLeadtime");
  });

  it("uses the current Admin Assembly Formula for new Production estimates", async () => {
    activeRole = "production";
    currentRequest = { ...BASE_REQUEST, stage: "production-review" };
    assemblyFormulaSettings = { hourlyRate: "85", hoursPerWeek: "35", capacityFactor: "0.7" };

    const response = await request(app)
      .post("/eto-requests/42/transitions")
      .send({
        decision: "production-approve",
        productionProcurementCost: "100",
        productionProcurementLeadTime: "1",
        productionAssemblyTimeHours: "40",
        productionRiskScore: "Low",
      });

    expect(response.status).toBe(200);
    expect(productionOutputInserts).toEqual([
      expect.objectContaining({
        assemblyCost: "3400",
        assemblyLeadTimeWeeks: "1.63",
        assemblyHourlyRate: "85",
        assemblyHoursPerWeek: "35",
        assemblyCapacityFactor: "0.7",
      }),
    ]);
  });

  it("allows only one of two parallel Mark Abandoned requests and audits the success once", async () => {
    holdInitialReads = true;

    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post("/eto-requests/42/transitions")
          .send({ decision: "mark-abandoned", reason: "Customer paused the project" }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(currentRequest.stage).toBe("abandoned");
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      etoRequestId: 42,
      actorId: 7,
      fromStage: "art-review",
      toStage: "abandoned",
      decision: "mark-abandoned",
      reason: "Customer paused the project",
    });
  });

  it("allows only one of two parallel Re-open requests and restores the latest abandonment stage", async () => {
    seedAbandonedRequest("art-review", "engineering-review");
    holdInitialReads = true;

    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post("/eto-requests/42/transitions")
          .send({ decision: "reopen" }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(currentRequest.stage).toBe("engineering-review");
    expect(auditRows).toHaveLength(3);

    const reopenRows = auditRows.filter((row) => row.decision === "reopen");
    expect(reopenRows).toHaveLength(1);
    expect(reopenRows[0]).toMatchObject({
      etoRequestId: 42,
      actorId: 7,
      fromStage: "abandoned",
      toStage: "engineering-review",
      decision: "reopen",
      reason: null,
    });
  });

  it.each(["art", "superuser"])(
    "allows %s users to mark an active request abandoned",
    async (role) => {
      activeRole = role;

      const response = await request(app)
        .post("/eto-requests/42/transitions")
        .send({ decision: "mark-abandoned", reason: "No longer needed" });

      expect(response.status).toBe(200);
      expect(currentRequest.stage).toBe("abandoned");
      expect(auditRows).toHaveLength(1);
    },
  );

  it.each([
    ["sales", "mark-abandoned"],
    ["engineering", "mark-abandoned"],
    ["sales", "reopen"],
    ["engineering", "reopen"],
  ])("rejects %s users from %s", async (role, decision) => {
    activeRole = role;
    if (decision === "reopen") seedAbandonedRequest("art-review");

    const response = await request(app)
      .post("/eto-requests/42/transitions")
      .send(
        decision === "mark-abandoned"
          ? { decision, reason: "Not authorized" }
          : { decision },
      );

    expect(response.status).toBe(403);
    expect(currentRequest.stage).toBe(
      decision === "reopen" ? "abandoned" : "art-review",
    );
    expect(auditRows).toHaveLength(decision === "reopen" ? 1 : 0);
  });

  it("rejects returning ART Final Review to Engineering when Engineering was never completed", async () => {
    currentRequest = {
      ...BASE_REQUEST,
      stage: "art-final-review",
      includeEngineeringReview: false,
      includeProductionReview: true,
      stickyEngineerUserId: 19,
    };

    const response = await request(app)
      .post("/eto-requests/42/transitions")
      .send({
        decision: "art-final-return-engineering",
        reason: "Engineering needs to review the final details",
      });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "Engineering Review must be completed before returning to Engineering",
    });
    expect(currentRequest.stage).toBe("art-final-review");
    expect(auditRows).toHaveLength(0);
  });

  it("returns ART Final Review to the sticky engineer after a committed Engineering completion", async () => {
    currentRequest = {
      ...BASE_REQUEST,
      stage: "art-final-review",
      includeEngineeringReview: false,
      includeProductionReview: true,
      stickyEngineerUserId: 19,
    };
    auditRows = [{
      id: 1,
      etoRequestId: 42,
      actorId: 19,
      fromStage: "engineering-review",
      toStage: "production-review",
      decision: "engineering-quote-ready",
      reason: null,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    }];
    nextAuditId = 2;

    const response = await request(app)
      .post("/eto-requests/42/transitions")
      .send({
        decision: "art-final-return-engineering",
        reason: "Engineering needs to review the final details",
      });

    expect(response.status).toBe(200);
    expect(currentRequest).toMatchObject({
      stage: "engineering-review",
      includeEngineeringReview: true,
      assigneeId: 19,
      stickyEngineerUserId: 19,
    });
    expect(auditRows.at(-1)).toMatchObject({
      fromStage: "art-final-review",
      toStage: "engineering-review",
      decision: "art-final-return-engineering",
      reason: "Engineering needs to review the final details",
    });
  });
});