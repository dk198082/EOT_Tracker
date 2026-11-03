/**
 * Real PostgreSQL INSERT/SELECT/UPDATE/DELETE checks for every app table.
 * All test rows are uncommitted and rolled back. Existing records/settings
 * are never modified. As with normal rolled-back inserts, sequences advance.
 */
import { randomUUID } from "node:crypto";
import { db, pool, verifyEtoDatabase, ETO_SCHEMA, ETO_TABLE_NAMES } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";

type TestCase = {
  source: keyof typeof ETO_TABLE_NAMES;
  values: Record<string, unknown>;
  key: string;
  change: [string, unknown];
};
const quote = (name: string) => {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Unsafe verification identifier");
  return `"${name}"`;
};

async function verify(): Promise<void> {
  await verifyEtoDatabase();
  const client = await pool.connect();
  const nonce = randomUUID();
  const temporaryId = -Math.floor(Math.random() * 1_000_000_000 + 1);
  try {
    await client.query("BEGIN");
    // Exercise the production ORM connection as well as raw transactions.
    const ormCount = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
    if (!Array.isArray(ormCount)) throw new Error("ORM read failed");
    const inserted = await client.query(
      `INSERT INTO crm.eto_users (name,email,clerk_id,role) VALUES ($1,$2,$3,$4) RETURNING id`,
      [`Verification ${nonce}`, `${nonce}@example.test`, `verify-${nonce}`, "superuser"],
    );
    const userId = inserted.rows[0].id;
    const request = await client.query(
      `INSERT INTO crm.eto_requests (customer_name,quote_number,materials,specimen_dimensions,submitted_by_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`Verification ${nonce}`, `VERIFY-${nonce}`, "Test", "Test", userId],
    );
    const requestId = request.rows[0].id;
    const formulaHistory = {
      actor_user_id: userId, actor_name: "Verification", actor_email: `${nonce}@example.test`,
      previous_hourly_rate: "100", previous_hours_per_week: "40", previous_capacity_factor: "1",
      new_hourly_rate: "110", new_hours_per_week: "35", new_capacity_factor: "0.9",
    };
    const tests: TestCase[] = [
      { source: "users", values: { id: userId }, key: "id", change: ["name", "Verified update"] },
      { source: "eto_requests", values: { id: requestId }, key: "id", change: ["custom_details", "Verified update"] },
      { source: "sessions", values: { sid: `verify-${nonce}`, sess: "{}", expire: new Date(Date.now() + 60_000) }, key: "sid", change: ["sess", '{"verified":true}'] },
      { source: "stage_transitions", values: { eto_request_id: requestId, actor_id: userId, from_stage: "draft", to_stage: "draft", decision: "verification" }, key: "id", change: ["reason", "Verified update"] },
      { source: "comments", values: { eto_request_id: requestId, author_id: userId, body: "Verification" }, key: "id", change: ["body", "Verified update"] },
      { source: "attachments", values: { eto_request_id: requestId, uploader_id: userId, filename: "verification.txt", storage_key: `verification/${nonce}`, search_status: "unsupported" }, key: "id", change: ["search_text", "Verified update"] },
      { source: "engineering_outputs", values: { eto_request_id: requestId }, key: "id", change: ["notes", "Verified update"] },
      { source: "production_outputs", values: { eto_request_id: requestId }, key: "id", change: ["notes", "Verified update"] },
      { source: "art_final_outputs", values: { eto_request_id: requestId }, key: "id", change: ["notes", "Verified update"] },
      { source: "detail_changes", values: { eto_request_id: requestId, changed_by_id: userId, section: "request", changes: "[]" }, key: "id", change: ["changes", '[{"field":"verification","oldValue":null,"newValue":"verified"}]'] },
      { source: "data_imports", values: { id: `verify-${nonce}` }, key: "id", change: ["matched_users", 1] },
      { source: "review_assignment_defaults", values: { id: temporaryId, engineering_user_id: userId, production_user_id: userId }, key: "id", change: ["updated_at", new Date("2030-01-01T00:00:00Z")] },
      { source: "price_calculator_settings", values: { id: temporaryId, contingency_percent: "5", margin_percent: "10" }, key: "id", change: ["margin_percent", "12"] },
      { source: "eto_price_calculator", values: { eto_request_id: requestId, contingency_percent: "5", margin_percent: "10" }, key: "eto_request_id", change: ["margin_percent", "12"] },
      { source: "design_formula_settings", values: { id: temporaryId, hourly_rate: "100", hours_per_week: "40", capacity_factor: "1" }, key: "id", change: ["hourly_rate", "110"] },
      { source: "assembly_formula_settings", values: { id: temporaryId, hourly_rate: "100", hours_per_week: "40", capacity_factor: "1" }, key: "id", change: ["hourly_rate", "110"] },
      { source: "design_formula_changes", values: formulaHistory, key: "id", change: ["new_hourly_rate", "120"] },
      { source: "assembly_formula_changes", values: formulaHistory, key: "id", change: ["new_hourly_rate", "120"] },
    ];
    const keys = new Map<string, unknown>();
    for (const test of tests) {
      const table = `${quote(ETO_SCHEMA)}.${quote(ETO_TABLE_NAMES[test.source])}`;
      let key: unknown;
      if (test.source === "users" || test.source === "eto_requests") {
        key = test.values.id;
      } else {
        const names = Object.keys(test.values);
        const insert = await client.query(
          `INSERT INTO ${table} (${names.map(quote).join(",")})
           VALUES (${names.map((_, i) => `$${i + 1}`).join(",")}) RETURNING ${quote(test.key)}`,
          Object.values(test.values),
        );
        key = insert.rows[0][test.key];
      }
      keys.set(test.source, key);
      const read = await client.query(`SELECT ${quote(test.key)} FROM ${table} WHERE ${quote(test.key)}=$1`, [key]);
      if (read.rowCount !== 1) throw new Error(`Read verification failed: ${test.source}`);
      const update = await client.query(
        `UPDATE ${table} SET ${quote(test.change[0])}=$1 WHERE ${quote(test.key)}=$2 RETURNING ${quote(test.change[0])}::text AS updated`,
        [test.change[1], key],
      );
      const reread = await client.query(
        `SELECT ${quote(test.change[0])}::text AS updated FROM ${table} WHERE ${quote(test.key)}=$1`, [key],
      );
      if (update.rowCount !== 1 || update.rows[0].updated !== reread.rows[0]?.updated) {
        throw new Error(`Update verification failed: ${test.source}`);
      }
    }
    // Child rows and settings first, then their ETO/user parents.
    for (const test of [...tests.filter((t) => !["users", "eto_requests"].includes(t.source)),
      tests.find((t) => t.source === "eto_requests")!, tests.find((t) => t.source === "users")!]) {
      const table = `${quote(ETO_SCHEMA)}.${quote(ETO_TABLE_NAMES[test.source])}`;
      const removed = await client.query(`DELETE FROM ${table} WHERE ${quote(test.key)}=$1`, [keys.get(test.source)]);
      const absent = await client.query(`SELECT ${quote(test.key)} FROM ${table} WHERE ${quote(test.key)}=$1`, [keys.get(test.source)]);
      if (removed.rowCount !== 1 || absent.rowCount !== 0) throw new Error(`Delete verification failed: ${test.source}`);
    }
    logger.info({ tables: tests.length, operations: tests.length * 4, transaction: "rolled_back" }, "Azure ETO table CRUD verification passed");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
}

void verify().catch((error) => {
  logger.error({ code: (error as { code?: string }).code ?? "VERIFICATION_FAILED" }, "Azure ETO CRUD verification failed");
  process.exitCode = 1;
});
