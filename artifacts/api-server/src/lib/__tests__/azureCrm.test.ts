import { afterEach, describe, expect, it } from "vitest";
import {
  checkAzureCrmConnection,
  readAzureCrmConfig,
} from "@workspace/db/azure-crm";

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("Azure CRM PostgreSQL configuration", () => {
  it("is optional when Azure credentials are absent", async () => {
    process.env = { ...ORIGINAL_ENV };
    for (const key of [
      "AZURE_PG_HOST",
      "AZURE_PG_DATABASE",
      "AZURE_PG_PORT",
      "AZURE_PG_SCHEMA",
      "AZURE_PG_SP_USER",
      "AZURE_PG_PASSWORD",
    ]) {
      delete process.env[key];
    }

    expect(readAzureCrmConfig()).toBeNull();
    await expect(checkAzureCrmConnection()).resolves.toEqual({
      status: "unavailable",
      reason: "not_configured",
    });
  });

  it("builds its settings independently from DATABASE_URL", () => {
    process.env = {
      ...ORIGINAL_ENV,
      DATABASE_URL: "postgresql://application-db.invalid/eto",
      AZURE_PG_HOST: "crm.example.test",
      AZURE_PG_DATABASE: "d365crm",
      AZURE_PG_PORT: "5432",
      AZURE_PG_SCHEMA: "crm",
      AZURE_PG_SP_USER: "crm-reader",
      AZURE_PG_PASSWORD: "test-only-password",
      AZURE_PG_SSLMODE: "verify-full",
    };

    expect(readAzureCrmConfig()).toMatchObject({
      host: "crm.example.test",
      database: "d365crm",
      port: 5432,
      schema: "crm",
      user: "crm-reader",
      ssl: { rejectUnauthorized: true },
    });
  });

  it("rejects an unsafe schema name before connecting", () => {
    process.env = {
      ...ORIGINAL_ENV,
      AZURE_PG_HOST: "crm.example.test",
      AZURE_PG_DATABASE: "d365crm",
      AZURE_PG_PORT: "5432",
      AZURE_PG_SCHEMA: "crm; drop schema public",
      AZURE_PG_SP_USER: "crm-reader",
      AZURE_PG_PASSWORD: "test-only-password",
    };

    expect(() => readAzureCrmConfig()).toThrow(
      "AZURE_PG_SCHEMA must be a valid PostgreSQL identifier",
    );
  });
});