import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { getAzureEtoPool } from "./azure-crm";
import { ETO_DATABASE, ETO_SCHEMA, ETO_TABLE_NAMES } from "./schema/namespace";

export const pool = getAzureEtoPool();
export const db = drizzle(pool, { schema });

export * from "./schema";
export { ETO_DATABASE, ETO_SCHEMA, ETO_TABLE_NAMES };

/** Fail before accepting requests if the cutover schema/permissions are absent. */
export async function verifyEtoDatabase(): Promise<void> {
  const target = await pool.query<{ correct_database: boolean; writable: boolean }>(
    "SELECT current_database() = $1 AS correct_database, current_setting('transaction_read_only') = 'off' AS writable",
    [ETO_DATABASE],
  );
  if (!target.rows[0]?.correct_database || !target.rows[0]?.writable) {
    throw new Error("Azure ETO database target is incorrect or read-only");
  }
  const tables = await pool.query<{ table_name: string; allowed: boolean }>(
    `SELECT c.relname AS table_name,
            has_table_privilege(current_user, c.oid, 'SELECT')
            AND has_table_privilege(current_user, c.oid, 'INSERT')
            AND has_table_privilege(current_user, c.oid, 'UPDATE')
            AND has_table_privilege(current_user, c.oid, 'DELETE') AS allowed
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) AND c.relkind = 'r'`,
    [ETO_SCHEMA, Object.values(ETO_TABLE_NAMES)],
  );
  if (tables.rows.length !== Object.keys(ETO_TABLE_NAMES).length || tables.rows.some((row) => !row.allowed)) {
    throw new Error("Azure ETO tables are missing or application CRUD permissions are unavailable");
  }
  const quoteColumns = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM information_schema.columns
      WHERE table_schema = $1
        AND ((table_name = 'eto_requests' AND column_name = 'entity')
          OR (table_name = 'eto_art_final_outputs' AND column_name = 'quote_description'))
        AND data_type = 'text'`,
    [ETO_SCHEMA],
  );
  if (quoteColumns.rows[0]?.count !== 2) {
    throw new Error("Azure ART entity / quote description columns are missing; apply the additive ART quote migration");
  }
}
