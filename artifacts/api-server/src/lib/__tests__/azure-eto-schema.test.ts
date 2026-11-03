import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as schema from "@workspace/db/schema";
import { db, pool, ETO_TABLE_NAMES } from "@workspace/db";

describe("Azure ETO application database routing", () => {
  it("places every application table in crm with exactly the agreed prefix", () => {
    const configs = [];
    for (const value of Object.values(schema)) {
      if (is(value, PgTable)) configs.push(getTableConfig(value));
    }
    expect(configs).toHaveLength(Object.keys(ETO_TABLE_NAMES).length);
    expect(new Set(configs.map((table) => table.name))).toEqual(new Set(Object.values(ETO_TABLE_NAMES)));
    for (const table of configs) {
      expect(table.schema).toBe("crm");
      expect(table.name).toMatch(/^eto_(?!eto_)/);
      for (const foreignKey of table.foreignKeys) {
        const referenced = getTableConfig(foreignKey.reference().foreignTable);
        expect(referenced.schema).toBe("crm");
        expect(referenced.name).toMatch(/^eto_/);
      }
    }
  });

  it("generates schema-qualified SELECT, INSERT, UPDATE and DELETE", () => {
    const select = db.select().from(schema.usersTable).toSQL();
    const insert = db.insert(schema.usersTable).values({ name: "Test", email: "test@example.test" }).toSQL();
    const update = db.update(schema.usersTable).set({ name: "Updated" }).toSQL();
    const remove = db.delete(schema.usersTable).toSQL();
    for (const query of [select, insert, update, remove]) {
      expect(query.sql).toContain('"crm"."eto_users"');
      expect(query.sql).not.toContain('"public".');
    }
  });

  it("uses the mandatory writable Azure pool, not a local fallback", () => {
    expect(pool.options.database).toBe("d365crm");
    expect(pool.options.options).toContain("default_transaction_read_only=off");
    expect(pool.options.options).toContain("search_path=pg_catalog,crm");
    expect(pool.options.connectionString).toBeUndefined();
  });

  it("does not leave legacy table literals in raw route or worker SQL", () => {
    const files = [
      "routes/eto-requests.ts", "routes/transitions.ts", "routes/dashboard.ts",
      "routes/users.ts", "scripts/remind.ts", "scripts/indexAttachments.ts",
    ];
    const legacyLiteral = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:users|sessions|eto_requests|stage_transitions|attachments)\b/;
    for (const file of files) {
      const contents = readFileSync(resolve(__dirname, "../../", file), "utf8");
      expect(contents, file).not.toMatch(legacyLiteral);
      expect(contents, file).not.toContain("sql`users ");
    }
  });
});
