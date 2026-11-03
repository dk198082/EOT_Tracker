import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const authState = vi.hoisted(() => ({
  authorizationCodeGrant: vi.fn(),
  getOidcConfig: vi.fn(),
  sessionCreateData: [] as any[],
  localUserAtSessionCreation: [] as any[],
  onSessionCreate: undefined as ((data: any) => Promise<void>) | undefined,
}));

vi.mock("openid-client", () => ({
  authorizationCodeGrant: authState.authorizationCodeGrant,
}));

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>(
    "../../lib/auth",
  );

  return {
    ...actual,
    getOidcConfig: authState.getOidcConfig,
    createSession: async (data: any) => {
      authState.sessionCreateData.push(data);
      await authState.onSessionCreate?.(data);
      return actual.createSession(data);
    },
  };
});

import { db, sessionsTable, usersTable } from "@workspace/db";
import { authMiddleware } from "../../middlewares/authMiddleware";
import authRouter from "../auth";

const callbackCookies = [
  "code_verifier=test-code-verifier",
  "nonce=test-nonce",
  "state=test-state",
  "return_to=%2Fdashboard",
];

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  // routes/auth.ts logs via req.log (pino-http normally provides it in
  // production); without a stub here, the admin-console-unavailable branch's
  // own req.log.error() call throws, which masked its intended 503 response
  // behind a generic 500 from the error handler below.
  app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { log: { error: () => void; warn: () => void } }).log = {
      error() {},
      warn() {},
    };
    next();
  });
  app.use(authMiddleware);
  app.use("/api", authRouter);
  // Express only dispatches a 4-arg handler as an error handler; the
  // previous 3-arg signature here was silently skipped on every error, so
  // whatever Express's own default handler does ran instead.
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

function sessionIdFromResponse(response: request.Response) {
  const setCookies = response.headers["set-cookie"] as unknown as
    | string[]
    | undefined;
  const sessionCookie = setCookies?.find((cookie) =>
    cookie.startsWith("sid="),
  );
  return sessionCookie?.split(";", 1)[0]?.slice("sid=".length);
}

describe("GET /api/auth/callback first-sign-in linking", () => {
  const testEmails: string[] = [];
  const testSessionIds: string[] = [];
  const app = buildApp();

  beforeEach(() => {
    authState.authorizationCodeGrant.mockReset();
    authState.getOidcConfig.mockReset().mockResolvedValue({});
    authState.sessionCreateData.length = 0;
    authState.localUserAtSessionCreation.length = 0;
    authState.onSessionCreate = async (data) => {
      const [localUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.authId, data.user.id));
      authState.localUserAtSessionCreation.push(localUser);
    };
  });

  afterEach(async () => {
    authState.onSessionCreate = undefined;
    if (testSessionIds.length > 0) {
      await db
        .delete(sessionsTable)
        .where(inArray(sessionsTable.sid, testSessionIds.splice(0)));
    }
    if (testEmails.length > 0) {
      await db
        .delete(usersTable)
        .where(inArray(usersTable.email, testEmails.splice(0)));
    }
  });

  it("links the pre-created user, preserves the role, and reuses it on a second callback", async () => {
    const email = `callback-${crypto.randomUUID()}@example.com`;
    const claimedEmail = email.toUpperCase();
    const authId = `oidc-callback-${crypto.randomUUID()}`;
    testEmails.push(email);

    const [preCreated] = await db
      .insert(usersTable)
      .values({
        name: "Pre-created Engineer",
        email,
        role: "engineering",
      })
      .returning();

    authState.authorizationCodeGrant.mockResolvedValue({
      access_token: "callback-access-token",
      refresh_token: "callback-refresh-token",
      expiresIn: () => 3600,
      claims: () => ({
        oid: authId,
        sub: "entra-subject",
        preferred_username: claimedEmail,
        given_name: "Ada",
        family_name: "Lovelace",
        iss: "https://issuer.example.com",
        aud: "eto-tracker",
      }),
    });

    const firstResponse = await request(app)
      .get("/api/auth/callback?code=first-code&state=test-state")
      .set("Cookie", callbackCookies);

    expect(firstResponse.status).toBe(302);
    expect(firstResponse.headers.location).toBe("/dashboard");
    const firstSessionId = sessionIdFromResponse(firstResponse);
    expect(firstSessionId).toBeTruthy();
    testSessionIds.push(firstSessionId!);

    expect(authState.sessionCreateData).toHaveLength(1);
    expect(authState.sessionCreateData[0].user).toEqual({
      id: authId,
      email: claimedEmail,
      firstName: "Ada",
      lastName: "Lovelace",
      profileImageUrl: null,
    });
    expect(authState.localUserAtSessionCreation[0]).toMatchObject({
      id: preCreated.id,
      authId,
      role: "engineering",
    });

    const secondResponse = await request(app)
      .get("/api/auth/callback?code=second-code&state=test-state")
      .set("Cookie", callbackCookies);

    expect(secondResponse.status).toBe(302);
    expect(secondResponse.headers.location).toBe("/dashboard");
    const secondSessionId = sessionIdFromResponse(secondResponse);
    expect(secondSessionId).toBeTruthy();
    testSessionIds.push(secondSessionId!);

    const matchingUsers = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));
    expect(matchingUsers).toHaveLength(1);
    expect(matchingUsers[0]).toMatchObject({
      id: preCreated.id,
      authId,
      email,
      role: "engineering",
    });
    expect(authState.sessionCreateData).toHaveLength(2);
    expect(authState.localUserAtSessionCreation).toHaveLength(2);
    expect(
      authState.localUserAtSessionCreation.every(
        (localUser) => localUser.id === preCreated.id && localUser.role === "engineering",
      ),
    ).toBe(true);
  });
});