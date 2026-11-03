import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorizationCodeGrant: vi.fn(),
  getOidcConfig: vi.fn(),
  upsertLocalUser: vi.fn(),
  createSession: vi.fn(),
  checkAccess: vi.fn(),
  callOrder: [] as string[],
  AdminConsoleUnavailableError: class extends Error {
    constructor(readonly kind: "not_configured" | "request_failed" | "invalid_response") {
      super("Admin Console access could not be verified");
    }
  },
}));

vi.mock("openid-client", () => ({
  authorizationCodeGrant: state.authorizationCodeGrant,
}));
vi.mock("../../lib/auth", () => ({
  createSession: state.createSession,
  clearSession: vi.fn(),
  deleteSession: vi.fn(),
  getEntraTenantId: vi.fn(() => "tenant"),
  getOidcConfig: state.getOidcConfig,
  getSessionId: vi.fn(),
  SESSION_COOKIE: "sid",
  SESSION_TTL: 60_000,
}));
vi.mock("../../lib/localUser", () => ({
  upsertLocalUser: state.upsertLocalUser,
}));
vi.mock("../../lib/admin-console-access", () => ({
  AdminConsoleUnavailableError: state.AdminConsoleUnavailableError,
  checkAdminConsoleAccess: state.checkAccess,
}));

import authRouter from "../auth";

const app = express();
app.use(cookieParser());
app.use((req: any, _res: unknown, next: () => void) => {
  req.log = { error: vi.fn() };
  next();
});
app.use("/api", authRouter);

beforeEach(() => {
  vi.clearAllMocks();
  state.callOrder = [];
  state.getOidcConfig.mockResolvedValue({});
  state.authorizationCodeGrant.mockResolvedValue({
    claims: () => ({
      oid: "entra-object-id",
      email: "authorized@example.test",
      name: "Authorized User",
    }),
  });
  state.checkAccess.mockImplementation(async () => {
    state.callOrder.push("access");
    return { allowed: true, reason: null, roles: ["ETO - Read / Write"] };
  });
  state.upsertLocalUser.mockImplementation(async () => {
    state.callOrder.push("user");
    return { id: 1, role: "engineering" };
  });
  state.createSession.mockImplementation(async () => {
    state.callOrder.push("session");
    return "test-session";
  });
});

const callback = () => request(app)
  .get("/api/auth/callback?code=test-code&state=test-state")
  .set("Cookie", [
    "code_verifier=test-verifier",
    "nonce=test-nonce",
    "state=test-state",
    "return_to=%2Fdashboard",
  ].join("; "));

describe("Entra callback Admin Console authorization", () => {
  it("checks access before provisioning the user or creating a session", async () => {
    const response = await callback().expect(302).expect("Location", "/dashboard");
    expect(state.checkAccess).toHaveBeenCalledWith("entra-object-id");
    expect(state.callOrder).toEqual(["access", "user", "session"]);
    expect(String(response.headers["set-cookie"] ?? "").includes("sid=")).toBe(true);
  });

  it("denies console-rejected users without provisioning them or creating a session", async () => {
    state.checkAccess.mockResolvedValueOnce({
      allowed: false,
      reason: "Not assigned",
      roles: [],
    });

    await callback()
      .expect(403)
      .expect(/do not have access to this application/);
    expect(state.checkAccess).toHaveBeenCalledWith("entra-object-id");
    expect(state.callOrder).toEqual([]);
    expect(state.upsertLocalUser).not.toHaveBeenCalled();
    expect(state.createSession).not.toHaveBeenCalled();
  });

  it("fails closed when the console cannot verify access", async () => {
    state.checkAccess.mockRejectedValueOnce(
      new state.AdminConsoleUnavailableError("request_failed"),
    );
    await callback()
      .expect(503)
      .expect(/access could not be verified/);
    expect(state.callOrder).toEqual([]);
    expect(state.upsertLocalUser).not.toHaveBeenCalled();
    expect(state.createSession).not.toHaveBeenCalled();
  });
});
