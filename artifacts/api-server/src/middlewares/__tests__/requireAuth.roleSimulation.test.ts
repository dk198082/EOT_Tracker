import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockLimit } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockLimit,
        }),
      }),
    }),
  },
}));

vi.mock("@workspace/db/schema", () => ({
  usersTable: { authId: "authId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({ type: "eq" })),
}));

import { requireAuth, requireAuthAllowNone } from "../requireAuth";

const superUser = {
  id: 10,
  authId: "auth-super",
  name: "Pilot SuperUser",
  email: "pilot@example.com",
  role: "superuser",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).isAuthenticated = () => true;
    (req as any).user = { id: "auth-super" };
    next();
  });
  app.get("/test", requireAuth, (_req, res) => {
    res.json({
      effectiveRole: res.locals.dbUser.role,
      actualRole: res.locals.actualDbUser.role,
      simulatedRole: res.locals.simulatedRole,
    });
  });
  app.get("/me", requireAuthAllowNone, (_req, res) => {
    res.json({ role: res.locals.dbUser.role });
  });
  return app;
}

describe("requireAuth role simulation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue([superUser]);
  });

  it("keeps the stored role when no simulation header is present", async () => {
    const response = await request(createApp()).get("/test");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      effectiveRole: "superuser",
      actualRole: "superuser",
      simulatedRole: null,
    });
  });

  it("applies a valid simulated role while retaining the real SuperUser", async () => {
    const response = await request(createApp())
      .get("/test")
      .set("x-eto-simulated-role", "ART");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      effectiveRole: "art",
      actualRole: "superuser",
      simulatedRole: "art",
    });
  });

  it.each(["superuser", "admin"])("rejects an unsupported simulated role: %s", async (role) => {
    const response = await request(createApp())
      .get("/test")
      .set("x-eto-simulated-role", role);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid simulated role");
  });

  it("rejects role simulation for a non-SuperUser", async () => {
    mockLimit.mockResolvedValue([{ ...superUser, role: "admin" }]);

    const response = await request(createApp())
      .get("/test")
      .set("x-eto-simulated-role", "sales");

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Role simulation is available only to SuperUsers");
  });

  it("blocks app data for users whose ETO role is not assigned", async () => {
    mockLimit.mockResolvedValue([{ ...superUser, role: "none" }]);

    const response = await request(createApp()).get("/test");

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("ETO app role must be assigned");
  });

  it("allows users without an ETO role to read their own profile", async () => {
    mockLimit.mockResolvedValue([{ ...superUser, role: "none" }]);

    const response = await request(createApp()).get("/me");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ role: "none" });
  });

  it.each(["sales", "art", "engineering", "production"])(
    "accepts the supported %s pilot role",
    async (role) => {
      const response = await request(createApp())
        .get("/test")
        .set("x-eto-simulated-role", role);

      expect(response.status).toBe(200);
      expect(response.body.effectiveRole).toBe(role);
      expect(response.body.actualRole).toBe("superuser");
    },
  );
});