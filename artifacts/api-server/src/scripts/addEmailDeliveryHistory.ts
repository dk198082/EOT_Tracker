import { readFile } from "node:fs/promises";
import { pool, ETO_DATABASE } from "@workspace/db";
import { logger } from "../lib/logger";

async function main() {
  const target = await pool.query("SELECT current_database() = $1 AS correct_database", [ETO_DATABASE]);
  if (!target.rows[0]?.correct_database) throw new Error("Unexpected database target; migration refused");
  if (process.argv.includes("--apply")) {
    const sql = await readFile(new URL("../../../../lib/db/migrations/20261105_email_delivery_events.sql", import.meta.url), "utf8");
    const client = await pool.connect();
    try {
      await client.query(sql);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const result = await pool.query("SELECT to_regclass('crm.eto_email_delivery_events') IS NOT NULL AS exists");
  if (!result.rows[0]?.exists) throw new Error("Email delivery history table is missing");
  logger.info("Email delivery history table verified in crm");
}

main().catch((error) => {
  logger.error({ err: error }, "Email delivery history migration failed");
  process.exitCode = 1;
}).finally(() => pool.end());
