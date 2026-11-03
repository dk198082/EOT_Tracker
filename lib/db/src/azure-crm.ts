import pg from "pg";
import { ETO_DATABASE, ETO_SCHEMA } from "./schema/namespace";

const { Pool } = pg;

const REQUIRED_ENV = [
  "AZURE_PG_HOST",
  "AZURE_PG_DATABASE",
  "AZURE_PG_PORT",
  "AZURE_PG_SCHEMA",
  "AZURE_PG_SP_USER",
  "AZURE_PG_PASSWORD",
] as const;

type AzureCrmConfig = {
  host: string;
  database: string;
  port: number;
  schema: string;
  user: string;
  password: string;
  ssl: false | { rejectUnauthorized: boolean };
};

export type AzureCrmHealth =
  | { status: "ok" }
  | { status: "unavailable"; reason: "not_configured" | "connection_failed" };

function sslConfig(mode: string | undefined): AzureCrmConfig["ssl"] {
  if (mode === "disable") return false;
  return { rejectUnauthorized: mode !== "require" };
}

export function readAzureCrmConfig(
  env: NodeJS.ProcessEnv = process.env,
): AzureCrmConfig | null {
  if (REQUIRED_ENV.some((name) => !env[name])) return null;

  const port = Number(env.AZURE_PG_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("AZURE_PG_PORT must be a valid TCP port");
  }

  const schema = env.AZURE_PG_SCHEMA!;
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(schema)) {
    throw new Error("AZURE_PG_SCHEMA must be a valid PostgreSQL identifier");
  }

  return {
    host: env.AZURE_PG_HOST!,
    database: env.AZURE_PG_DATABASE!,
    port,
    schema,
    user: env.AZURE_PG_SP_USER!,
    password: env.AZURE_PG_PASSWORD!,
    ssl: sslConfig(env.AZURE_PG_SSLMODE),
  };
}

let azureCrmPool: pg.Pool | undefined;
let azureEtoPool: pg.Pool | undefined;

/** Required, writable application connection. Never falls back to local data. */
export function getAzureEtoPool(): pg.Pool {
  const config = readAzureCrmConfig();
  if (!config) throw new Error("Azure ETO PostgreSQL configuration is required");
  if (config.database !== ETO_DATABASE || config.schema !== ETO_SCHEMA) {
    throw new Error("Azure ETO PostgreSQL must target d365crm schema crm");
  }
  azureEtoPool ??= new Pool({
    host: config.host,
    database: config.database,
    port: config.port,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    options: "-c search_path=pg_catalog,crm -c timezone=UTC -c default_transaction_read_only=off",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    allowExitOnIdle: true,
  });
  if (azureEtoPool.listenerCount("error") === 0) {
    azureEtoPool.on("error", () => {
      process.emitWarning("An idle Azure ETO database connection closed; subsequent requests will reconnect", {
        code: "ETO_DATABASE_POOL_ERROR",
      });
    });
  }
  return azureEtoPool;
}

export function getAzureCrmPool(): pg.Pool | null {
  const config = readAzureCrmConfig();
  if (!config) return null;

  azureCrmPool ??= new Pool({
    host: config.host,
    database: config.database,
    port: config.port,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    options: `-c search_path=${config.schema} -c default_transaction_read_only=on`,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  if (azureCrmPool.listenerCount("error") === 0) {
    azureCrmPool.on("error", () => {
      process.emitWarning("An idle Azure CRM health-check connection closed; the next check will reconnect", {
        code: "AZURE_CRM_POOL_ERROR",
      });
    });
  }

  return azureCrmPool;
}

export async function checkAzureCrmConnection(): Promise<AzureCrmHealth> {
  const config = readAzureCrmConfig();
  const pool = getAzureCrmPool();
  if (!config || !pool) {
    return { status: "unavailable", reason: "not_configured" };
  }

  try {
    const result = await pool.query<{
      database_name: string;
      schema_name: string;
    }>(
      "select current_database() as database_name, current_schema() as schema_name",
    );
    const row = result.rows[0];
    if (
      row?.database_name !== config.database ||
      row.schema_name !== config.schema
    ) {
      return { status: "unavailable", reason: "connection_failed" };
    }
    return { status: "ok" };
  } catch {
    return { status: "unavailable", reason: "connection_failed" };
  }
}