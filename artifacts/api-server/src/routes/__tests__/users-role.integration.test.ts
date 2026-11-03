import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { User } from "@workspace/db";

let actor: User;

vi.mock("../../middlewares/requireAuth", () => {
  const mockRequireAuth = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.locals.dbUser = actor;
    res.locals.actualDbUser = actor;
    next();
  };
  return {
    requireAuth: mockRequireAuth,
    requireAuthAllowNone: mockRequireAuth,
  };
});

import { db, usersTable } from "@workspace/db";
import usersRouter from "../users";

const createdIds: number[] = [];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/users", usersRouter);
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: error.message });
    },
  );
  return app;
}

beforeEach(async () => {
  const suffix = crypto.randomUUID();
  const [createdActor, target] = await db
    .insert(usersTable)
    .values([
      {
        authId: `role-actor-${suffix}`,
        name: "Role Actor",
        email: `role-actor-${suffix}@example.test`,
        role: "superuser",
      },
      {
        authId: `role-target-${suffix}`,
        name: "Role Target",
        email: `role-target-${suffix}@example.test`,
        role: "sales",
      },
    ])
    .returning();
  actor = createdActor;
  createdIds.push(createdActor.id, target.id);
});

afterEach(async () => {
  if (createdIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdIds.splice(0)));
  }
});

describe("PATCH /api/users/:id/role", () => {
  it("lets a SuperUser persist a role sent in the JSON body", async () => {
    const [target] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.name, "Role Target"))
      .limit(1);

    const response = await request(buildApp())
      .patch(`/api/users/${target.id}/role`)
      .send({ role: "engineering" });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      id: target.id,
      authId: target.authId,
      role: "engineering",
    });

    const [stored] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, target.id));
    expect(stored.role).toBe("engineering");
  });
});