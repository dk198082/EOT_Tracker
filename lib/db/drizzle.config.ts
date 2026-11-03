import { defineConfig } from "drizzle-kit";
import path from "path";
import { readAzureCrmConfig } from "./src/azure-crm";
import { ETO_DATABASE, ETO_SCHEMA, ETO_TABLE_NAMES } from "./src/schema/namespace";

const config = readAzureCrmConfig();
if (!config || config.database !== ETO_DATABASE || config.schema !== ETO_SCHEMA) {
  throw new Error("Azure ETO PostgreSQL configuration must target d365crm schema crm");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  schemaFilter: [ETO_SCHEMA],
  tablesFilter: Object.values(ETO_TABLE_NAMES),
  dbCredentials: {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
  },
});
