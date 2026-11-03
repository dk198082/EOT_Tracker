/**
 * Targeted additive Azure migration. Does not copy data or change existing rows.
 * Run with --apply to add the nullable ART entity and quote-description columns.
 */
import { pool, ETO_DATABASE } from "@workspace/db";

async function main() {
  const client = await pool.connect();
  try {
    const target = await client.query("SELECT current_database() = $1 AS correct_database", [ETO_DATABASE]);
    if (!target.rows[0]?.correct_database) throw new Error("Unexpected database target; migration refused");
    if (process.argv.includes("--apply")) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("ALTER TABLE crm.eto_requests ADD COLUMN IF NOT EXISTS entity text");
        await client.query("ALTER TABLE crm.eto_art_final_outputs ADD COLUMN IF NOT EXISTS quote_description text");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    const columns = await client.query(
      `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns WHERE table_schema = 'crm'
         AND ((table_name = 'eto_requests' AND column_name = 'entity')
           OR (table_name = 'eto_art_final_outputs' AND column_name = 'quote_description'))
         ORDER BY table_name`,
    );
    if (process.argv.includes("--apply") && (columns.rows.length !== 2
      || columns.rows.some((column) => column.data_type !== "text" || column.is_nullable !== "YES"))) {
      throw new Error("ART quote column verification failed");
    }
    console.log(JSON.stringify({ database: ETO_DATABASE, schema: "crm", columns: columns.rows }));
  } finally {
    client.release();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "ART quote migration failed");
  process.exitCode = 1;
}).finally(() => pool.end());
