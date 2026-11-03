import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authState, select } = vi.hoisted(() => ({
  authState: { role: "sales", simulatedRole: null as string | null },
  select: vi.fn(),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = { id: 1, role: authState.role };
    res.locals.simulatedRole = authState.simulatedRole;
    next();
  },
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {},
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  db: { select },
}));

import etoRequestsRouter from "../eto-requests";

const app = express();
app.use(express.json());
app.use("/eto-requests", etoRequestsRouter);

beforeEach(() => {
  vi.clearAllMocks();
  authState.simulatedRole = null;
  const query = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  select.mockReturnValue(query);
});

describe("Request Details edit permissions", () => {
  it.each(["sales", "engineering", "production", "admin", "unknown"])(
    "blocks %s before accessing request data",
    async (role) => {
      authState.role = role;
      const response = await request(app).patch("/eto-requests/1").send({ customerName: "Rejected change" });
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Only ART or SuperUser may edit request details");
      expect(select).not.toHaveBeenCalled();
    },
  );

  it.each(["art", "superuser"])("allows %s through the edit permission gate", async (role) => {
    authState.role = role;
    const response = await request(app).patch("/eto-requests/1").send({});
    // A deliberately missing mocked request proves authorization passed without writing data.
    expect(response.status).toBe(404);
    expect(select).toHaveBeenCalledOnce();
  });

  it("blocks SuperUser simulation of Sales using its effective permissions", async () => {
    authState.role = "sales";
    authState.simulatedRole = "sales";
    const response = await request(app).patch("/eto-requests/1").send({ customerName: "Rejected change" });
    expect(response.status).toBe(403);
    expect(select).not.toHaveBeenCalled();
  });
});