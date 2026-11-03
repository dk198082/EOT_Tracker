import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route writes use real PostgreSQL transactions, but only in disposable tables.
// Each transaction gets its own connection so the advisory lock can serialize requests.
const isolated = vi.hoisted(() => ({ schema: "" }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@workspace/db/schema");
  const { pgSchema, integer, serial, text, timestamp } = await import("drizzle-orm/pg-core");
  const { randomUUID } = await import("node:crypto");
  isolated.schema = `formula_test_${randomUUID().replaceAll("-", "")}`;
  const testSchema = pgSchema(isolated.schema);
  // search_path cannot isolate explicitly schema-qualified production models.
  // Override the actual models as well as the transaction connection.
  const designFormulaSettingsTable = testSchema.table("design_formula_settings", {
    id: integer("id").primaryKey(),
    hourlyRate: text("hourly_rate").notNull(),
    hoursPerWeek: text("hours_per_week").notNull(),
    capacityFactor: text("capacity_factor").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });
  const designFormulaChangesTable = testSchema.table("design_formula_changes", {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    previousHourlyRate: text("previous_hourly_rate").notNull(),
    previousHoursPerWeek: text("previous_hours_per_week").notNull(),
    previousCapacityFactor: text("previous_capacity_factor").notNull(),
    newHourlyRate: text("new_hourly_rate").notNull(),
    newHoursPerWeek: text("new_hours_per_week").notNull(),
    newCapacityFactor: text("new_capacity_factor").notNull(),
  });
  return {
    ...actual,
    designFormulaSettingsTable,
    designFormulaChangesTable,
    db: {
      transaction: async (callback: Parameters<typeof actual.db.transaction>[0]) => {
        const client = await actual.pool.connect();
        try {
          await client.query("SELECT set_config('search_path', $1, false)", [isolated.schema]);
          return await drizzle(client, { schema }).transaction(callback);
        } finally {
          await client.query("RESET search_path").finally(() => client.release());
        }
      },
    },
  };
});
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.locals.dbUser = { id: 7, role: "admin", name: "Test Admin", email: "test@example.com" };
    next();
  },
}));
vi.mock("../../lib/email", () => ({ send: vi.fn() }));

import { pool } from "@workspace/db";
import adminRouter from "../admin";

const app = express();
app.use(express.json());
app.use("/admin", adminRouter);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});

const first = { hourlyRate: "120", hoursPerWeek: "32", capacityFactor: "0.5" };
const second = { hourlyRate: "150", hoursPerWeek: "36", capacityFactor: "0.6" };

beforeAll(async () => {
  expect(isolated.schema).toMatch(/^formula_test_[a-f0-9]+$/);
  // The identifier is generated here (hex and underscores only), not supplied by a caller.
  await pool.query(`CREATE SCHEMA "${isolated.schema}"`);
  await pool.query(`
    CREATE TABLE "${isolated.schema}".design_formula_settings (
      id integer PRIMARY KEY,
      hourly_rate text NOT NULL,
      hours_per_week text NOT NULL,
      capacity_factor text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${isolated.schema}".design_formula_changes (
      id serial PRIMARY KEY,
      actor_user_id integer NOT NULL,
      actor_name text NOT NULL,
      actor_email text NOT NULL,
      changed_at timestamptz NOT NULL DEFAULT now(),
      previous_hourly_rate text NOT NULL,
      previous_hours_per_week text NOT NULL,
      previous_capacity_factor text NOT NULL,
      new_hourly_rate text NOT NULL CHECK (new_hourly_rate <> '999'),
      new_hours_per_week text NOT NULL,
      new_capacity_factor text NOT NULL
    );
  `);
});

afterAll(async () => {
  if (isolated.schema) await pool.query(`DROP SCHEMA "${isolated.schema}" CASCADE`);
});

describe("admin formula updates against PostgreSQL", () => {
  it("serializes two waiting saves and rolls back a rejected history insert", async () => {
    const blocker = await pool.connect();
    let lockHeld = false;
    try {
      await blocker.query("SELECT pg_advisory_lock(681204)");
      lockHeld = true;
      // Calling .then starts both HTTP requests while the lock is still held.
      const saveFirst = request(app).put("/admin/design-formula").send(first).then((response) => response);
      const saveSecond = request(app).put("/admin/design-formula").send(second).then((response) => response);

      // Require both transactions to be queued, rather than merely scheduling two promises.
      const deadline = Date.now() + 10_000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const result = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND objid = 681204 AND NOT granted",
        );
        waiting = Number(result.rows[0].count);
        if (waiting >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await blocker.query("SELECT pg_advisory_unlock(681204)");
      lockHeld = false;
      expect(waiting).toBeGreaterThanOrEqual(2);

      const [a, b] = await Promise.all([saveFirst, saveSecond]);
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      expect(b.status, JSON.stringify(b.body)).toBe(200);

      const entries = await pool.query(`
        SELECT previous_hourly_rate, previous_hours_per_week, previous_capacity_factor,
               new_hourly_rate, new_hours_per_week, new_capacity_factor
        FROM "${isolated.schema}".design_formula_changes ORDER BY id
      `);
      const earlier = entries.rows[0]?.new_hourly_rate === first.hourlyRate ? first : second;
      const later = earlier === first ? second : first;
      expect(entries.rows).toEqual([
        {
          previous_hourly_rate: "100", previous_hours_per_week: "40", previous_capacity_factor: "0.35",
          new_hourly_rate: earlier.hourlyRate, new_hours_per_week: earlier.hoursPerWeek, new_capacity_factor: earlier.capacityFactor,
        },
        {
          previous_hourly_rate: earlier.hourlyRate, previous_hours_per_week: earlier.hoursPerWeek, previous_capacity_factor: earlier.capacityFactor,
          new_hourly_rate: later.hourlyRate, new_hours_per_week: later.hoursPerWeek, new_capacity_factor: later.capacityFactor,
        },
      ]);
      expect([a.body.hourlyRate, b.body.hourlyRate].sort()).toEqual(["120", "150"]);

      const rejected = await request(app).put("/admin/design-formula")
        .send({ ...second, hourlyRate: "999" });
      expect(rejected.status).toBe(500);
      const settings = await pool.query(`
        SELECT hourly_rate, hours_per_week, capacity_factor FROM "${isolated.schema}".design_formula_settings
      `);
      expect(settings.rows).toEqual([{
        hourly_rate: later.hourlyRate, hours_per_week: later.hoursPerWeek, capacity_factor: later.capacityFactor,
      }]);
      const count = await pool.query(`SELECT count(*)::integer AS count FROM "${isolated.schema}".design_formula_changes`);
      expect(count.rows[0].count).toBe(2);
    } finally {
      if (lockHeld) await blocker.query("SELECT pg_advisory_unlock(681204)");
      blocker.release();
    }
  }, 20_000);
});