import pg from "pg";

/** Only for explicit migration tooling; never imported by application runtime. */
export function createMigrationSourcePool(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error("Development source connection is required");
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: "-c timezone=UTC -c default_transaction_read_only=on",
    connectionTimeoutMillis: 10_000,
  });
}
