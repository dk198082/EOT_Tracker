import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@workspace/db/schema";
import type { pool as PoolType } from "@workspace/db";
import { sharedMergeFixture } from "../shared-merge/fixture";
import { prepareSharedMerge } from "../shared-merge/planner";
import type { ArchiveStore } from "../shared-merge/runtime";

const local = vi.hoisted(() => ({ pool: null as typeof PoolType | null }));
vi.mock("@workspace/db", async () => {
  const tables = await import("@workspace/db/schema");
  const namespace = await import("../../../../../lib/db/src/schema/namespace");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { ...tables, ...namespace, pool: local.pool, db: drizzle(local.pool!, { schema: tables }) };
});
const storage = vi.hoisted(() => ({
  getObjectEntityUploadURL: vi.fn(async () => "https://example.test/upload"),
  deleteObjectEntity: vi.fn(async () => {}),
  getObjectEntityDownloadURL: vi.fn(async () => "https://example.test/synthetic-download"),
}));
vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityUploadURL = storage.getObjectEntityUploadURL;
    deleteObjectEntity = storage.deleteObjectEntity;
    getObjectEntityDownloadURL = storage.getObjectEntityDownloadURL;
    normalizeObjectEntityPath = () => "/objects/synthetic-upload";
  },
  ObjectNotFoundError: class extends Error {},
}));

// Uses only an owned local Unix socket. It never imports an Azure pool, reads
// credentials, starts the app's role/import jobs, or connects to a live database.
const requireDb = createRequire(new URL("../../../../../lib/db/package.json", import.meta.url));
const { Pool } = requireDb("pg") as { Pool: new (config: object) => typeof PoolType };
const drizzleKit = requireDb("drizzle-kit/api") as {
  generateDrizzleJson: (schema: Record<string, unknown>) => unknown;
  generateMigration: (before: unknown, after: unknown) => Promise<string[]>;
};
let dir: string;
let started = false;
let store: ArchiveStore;
let app: Express;
let epoch: string;
let archivedId: number;
let archivedKey: string;
let activeKey: string;
let initialChecksums: Record<string, string>;
const fixture = sharedMergeFixture();
const prepared = prepareSharedMerge(fixture.production, fixture.workspace, fixture.contracts, fixture.decisions);
const contracts = fixture.contracts;
const tableName = (logical: string) => logical === "eto_requests" || logical === "eto_price_calculator" ? logical : `eto_${logical}`;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function checksums() {
  const result: Record<string, string> = {};
  for (const contract of contracts) {
    const { rows } = await local.pool!.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY ${quote(contract.primaryKey)})::text,'[]')) AS checksum
      FROM (SELECT ${contract.columns.map(quote).join(",")} FROM crm.${quote(tableName(contract.name))}) r`);
    result[contract.name] = rows[0].checksum;
  }
  return result;
}

beforeAll(async () => {
  expect(prepared.report.preparationValid).toBe(true);
  dir = mkdtempSync(join(tmpdir(), "eto-archive-validation-"));
  mkdirSync(join(dir, "socket"));
  execFileSync("initdb", ["-D", join(dir, "data"), "-A", "trust", "--no-locale"], { stdio: "pipe" });
  execFileSync("pg_ctl", ["-D", join(dir, "data"), "-l", join(dir, "postgres.log"), "-o", `-h '' -k ${join(dir, "socket")} -p 55441`, "-w", "start"], { stdio: "pipe" });
  started = true;
  const admin = new Pool({ host: join(dir, "socket"), port: 55441, database: "postgres", user: "runner" });
  await admin.query("CREATE DATABASE eto_archive_validation");
  await admin.end();
  local.pool = new Pool({ host: join(dir, "socket"), port: 55441, database: "eto_archive_validation", user: "runner" });
  await local.pool.query("CREATE SCHEMA crm");
  const ddl = await drizzleKit.generateMigration(drizzleKit.generateDrizzleJson({}), drizzleKit.generateDrizzleJson(schema));
  await local.pool.query(ddl.join("\n"));
  // The staged loader permits the three approved historical conflicts before
  // reestablishing active-only uniqueness. No other split protections change.
  await local.pool.query(`ALTER TABLE crm.eto_requests DROP CONSTRAINT eto_requests_eto_number_unique`);
  for (const contract of contracts) {
    for (const row of prepared.rows[contract.name] ?? []) {
      const columns = Object.keys(row);
      await local.pool.query(`INSERT INTO crm.${quote(tableName(contract.name))} (${columns.map(quote).join(",")})
        VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`, columns.map(key => {
          const value = row[key];
          return contract.columnTypes[key] === "jsonb" && value !== null ? JSON.stringify(value) : value;
        }));
    }
  }
  // Sequence resets use only synthetic fixture values.
  for (const contract of contracts.filter(c => c.serialKey)) {
    await local.pool.query(`SELECT setval(pg_get_serial_sequence($1,$2),$3,true)`,
      [`crm.${tableName(contract.name)}`, contract.primaryKey, 1000]);
  }
  initialChecksums = await checksums();
  const database = await import("../shared-merge/database");
  store = database.archiveStore;
  expect(await store.epoch()).toBeNull();
  const sql = readFileSync(new URL("../shared-merge/staged-archive.sql", import.meta.url), "utf8");
  const [prefix, suffix] = sql.split("-- FIXTURE_PROVENANCE");
  await local.pool.query(prefix);
  await local.pool.query("UPDATE crm.eto_merge_state SET epoch=$1", [fixture.decisions.epoch]);
  for (const state of prepared.requestStates) {
    await local.pool.query(`UPDATE crm.eto_requests SET record_key=$2, migration_epoch=$3,
      is_archived=$4, archive_source=$5, archive_source_id=$6, archive_reason=$7 WHERE id=$1`,
      [state.id, state.recordKey, fixture.decisions.epoch, state.archived, state.origin, state.sourceId,
        state.archived ? "Workspace number conflicts with the active production version" : null]);
  }
  await local.pool.query(suffix);
  epoch = (await store.epoch())!;
  const archive = prepared.requestStates.find(r => r.archived)!;
  archivedId = archive.id;
  archivedKey = archive.recordKey;
  activeKey = prepared.requestStates.find(r => r.id === 16)!.recordKey;
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
    req.user = { id: "verified-synthetic-identity", email: "one@example.test",
      firstName: "Synthetic", lastName: "Tester", profileImageUrl: null };
    next();
  });
  const { default: router } = await import("../../routes/index");
  app.use("/api", router);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });
}, 60000);

afterAll(async () => {
  await local.pool?.end();
  if (started) execFileSync("pg_ctl", ["-D", join(dir, "data"), "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function write(method: "post" | "patch" | "put" | "delete", path: string, id = archivedId, key = archivedKey) {
  return request(app)[method](path).set("x-eto-migration-epoch", epoch).set("x-eto-record-key", key);
}

describe("Shared archive against disposable PostgreSQL and the real API routers", () => {
  it("preserves every original business column, original number, history, file mapping and exact archive scope", async () => {
    expect(await checksums()).toEqual(initialChecksums);
    const { rows } = await local.pool!.query("SELECT id,eto_number FROM crm.eto_requests WHERE is_archived ORDER BY id");
    expect(rows.map(r => r.id)).toEqual(prepared.requestStates.filter(r => r.archived).map(r => r.id).sort((a,b) => a-b));
    expect(rows).toHaveLength(3);
  });

  it("discovers three archives and distinct active production versions by number/search, with source and stable identity", async () => {
    const active = await request(app).get("/api/eto-requests?archive=active");
    expect(active.status).toBe(200);
    expect(active.body.items.every((r: { archived: boolean }) => !r.archived)).toBe(true);
    const archives = await request(app).get("/api/eto-requests?archive=archived");
    expect(archives.status).toBe(200);
    expect(archives.body.items).toHaveLength(3);
    expect(archives.body.items[0]).toMatchObject({ archived: true, source: "workspace", migrationEpoch: epoch });
    const both = await request(app).get("/api/eto-requests?archive=all&search=ETO-2026-0006");
    expect(both.status).toBe(200);
    expect(both.body.items).toHaveLength(2);
    expect(new Set(both.body.items.map((r: { recordKey: string }) => r.recordKey)).size).toBe(2);
    expect((await request(app).get(`/api/eto-requests/${archivedId}?recordKey=${encodeURIComponent(archivedKey)}`)).body)
      .toMatchObject({ archived: true, sourceId: 16, recordKey: archivedKey });
  });

  it("creates a synthetic browser response bank without any live data or authentication bypass in the application", async () => {
    const paths = ["/api/eto-requests?archive=all", `/api/eto-requests/${archivedId}`, "/api/eto-requests/16",
      "/api/users/me", "/api/users", "/api/admin/review-assignment-defaults",
      ...[archivedId, 16].flatMap(id => ["/comments", "/transitions", "/attachments", "/engineering-output",
        "/production-output", "/art-final-output", "/price-calculator", "/detail-changes"].map(suffix => `/api/eto-requests/${id}${suffix}`))];
    const responses: Record<string, unknown> = {};
    for (const path of paths) {
      const response = await request(app).get(path);
      responses[path] = { status: response.status, body: response.body };
    }
    writeFileSync("/tmp/eto-archive-browser-fixture.json", JSON.stringify({ epoch, archivedId, archivedKey, activeKey, responses }, null, 2));
  });

  it.each([
    ["patch", ""], ["post", "/transitions"], ["post", "/comments"],
    ["put", "/engineering-output"], ["put", "/production-output"], ["put", "/art-final-output"],
    ["put", "/price-calculator"], ["post", "/split"], ["post", "/attachments"], ["delete", "/attachments/1"],
  ] as const)("rejects archive %s %s before validators or side effects, even for SuperUser", async (method, suffix) => {
    const response = await write(method, `/api/eto-requests/${archivedId}${suffix}`).send({});
    expect(response.status).toBe(423);
    expect(response.body.code).toBe("ARCHIVED_READ_ONLY");
    expect(storage.deleteObjectEntity).not.toHaveBeenCalled();
  });

  it("rejects archive upload URL issuance before creating an object", async () => {
    const response = await write("post", "/api/storage/uploads/request-url").send({ etoRequestId: archivedId });
    expect(response.status).toBe(423);
    expect(storage.getObjectEntityUploadURL).not.toHaveBeenCalled();
    expect((await write("post", "/api/STORAGE/uploads/REQUEST-URL/").send({etoRequestId:archivedId})).status).toBe(423);
    expect((await write("post", `/api/ETO-REQUESTS/${archivedId}/COMMENTS/`).send({body:"no"})).status).toBe(423);
  });

  it("requires database-trusted epoch and record key, blocking missing, forged and old clients after numeric ID reuse", async () => {
    for (const headers of [
      {}, { "x-eto-migration-epoch": epoch }, { "x-eto-migration-epoch": "old", "x-eto-record-key": activeKey },
      { "x-eto-migration-epoch": epoch, "x-eto-record-key": archivedKey },
    ]) {
      const response = await request(app).post("/api/eto-requests/16/comments").set(headers).send({ body: "must not save" });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("RELOAD_REQUIRED");
    }
    expect((await request(app).get(`/api/eto-requests/16?recordKey=${encodeURIComponent(archivedKey)}`)).status).toBe(409);
    expect((await request(app).post("/api/eto-requests").send({})).status).toBe(409);
    for (const invalid of [`${archivedId}junk`, `0${archivedId}`, `+${archivedId}`]) {
      expect((await write("post", `/api/eto-requests/${invalid}/comments`).send({body:"no"})).status).toBe(400);
    }
  });

  it("keeps active mutations functional and archive history readable", async () => {
    const comment = await write("post", "/api/eto-requests/16/comments", 16, activeKey).send({ body: "synthetic active comment" });
    expect(comment.status).toBe(201);
    await local.pool!.query("UPDATE crm.eto_requests SET stage='art-final-review' WHERE id=16");
    const saved = await write("put", "/api/eto-requests/16/price-calculator", 16, activeKey)
      .send({ contingencyPercent: "5", marginPercent: "10" });
    expect(saved.status).toBe(200);
    for (const suffix of ["/comments", "/transitions", "/attachments", "/engineering-output", "/production-output", "/art-final-output", "/price-calculator", "/detail-changes"]) {
      expect((await request(app).get(`/api/eto-requests/${archivedId}${suffix}`)).status).toBe(200);
    }
  });

  it("creates an unnumbered draft with server-owned provenance and permits its correctly bound file upload", async () => {
    const draft = await request(app).post("/api/eto-requests").set("x-eto-migration-epoch", epoch).send({
      customerName:"Synthetic New Customer", quoteNumber:"synthetic-quote", distributor:"No", requestType:"Machine", machineType:"ST",
      expectedForceRange:"10", expectedForceUnit:"kN", expectedDisplacement:"25", expectedDisplacementUnit:"mm",
      materials:"Synthetic material", specimenDimensions:"10 mm", resultsRequired:"Report", customDetails:"Synthetic create verification",
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect(draft.body).toMatchObject({ etoNumber:null, archived:false, source:"shared", migrationEpoch:epoch, sourceId:draft.body.id });
    expect(draft.body.recordKey).toBeTruthy();
    const upload = await write("post", "/api/storage/uploads/request-url", draft.body.id, draft.body.recordKey).send({
      etoRequestId:draft.body.id, name:"synthetic.txt", size:12, contentType:"text/plain",
    });
    expect(upload.status, JSON.stringify(upload.body)).toBe(200);
  });

  it("keeps archived files downloadable and never deletes a shared blob when an active attachment is removed", async () => {
    const archiveFiles = await request(app).get(`/api/eto-requests/${archivedId}/attachments`);
    const file = archiveFiles.body[0];
    expect((await request(app).get(`/api/eto-requests/${archivedId}/attachments/${file.id}/download`)).status).toBe(200);
    const activeFiles = await request(app).get("/api/eto-requests/16/attachments");
    const deleted = await write("delete", `/api/eto-requests/16/attachments/${activeFiles.body[0].id}`, 16, activeKey);
    expect(deleted.status).toBe(204);
    expect(storage.deleteObjectEntity).not.toHaveBeenCalled();
    expect((await request(app).get(`/api/eto-requests/${archivedId}/attachments/${file.id}/download`)).status).toBe(200);
  });

  it.each(["sales","art","engineering","production"])("does not grant a %s role simulation an archive-write exception", async role => {
    const response = await write("post", `/api/eto-requests/${archivedId}/comments`)
      .set("x-eto-simulated-role", role).send({ body: "no" });
    expect(response.status).toBe(423);
  });

  it("requires the epoch for changes targeting remapped user IDs and global settings", async () => {
    expect((await request(app).put("/api/admin/price-calculator").send({ contingencyPercent:"5",marginPercent:"10" })).status).toBe(409);
    expect((await request(app).patch("/api/users/1/role").send({ role:"sales" })).status).toBe(409);
  });

  it("enforces archives at the database boundary for records and every dependent table", async () => {
    await expect(local.pool!.query("UPDATE crm.eto_requests SET customer_name='forbidden' WHERE id=$1", [archivedId]))
      .rejects.toThrow("ARCHIVED_READ_ONLY");
    for (const table of ["eto_comments", "eto_attachments", "eto_stage_transitions", "eto_detail_changes",
      "eto_engineering_outputs", "eto_production_outputs", "eto_art_final_outputs", "eto_price_calculator"]) {
      await expect(local.pool!.query(`UPDATE crm.${table} SET eto_request_id=16 WHERE eto_request_id=$1`, [archivedId]))
        .rejects.toThrow("ARCHIVED_READ_ONLY");
      await expect(local.pool!.query(`DELETE FROM crm.${table} WHERE eto_request_id=$1`, [archivedId]))
        .rejects.toThrow("ARCHIVED_READ_ONLY");
    }
    await expect(local.pool!.query("UPDATE crm.eto_requests SET is_archived=true,archive_source='workspace',archive_reason='no' WHERE id=16"))
      .rejects.toThrow("RECORD_PROVENANCE_IMMUTABLE");
  });

  it("prevents active duplicate numbers, all historical number reuse, and clearing assigned numbers", async () => {
    await expect(local.pool!.query("UPDATE crm.eto_requests SET eto_number=NULL WHERE id=16"))
      .rejects.toThrow("ASSIGNED_NUMBER_IMMUTABLE");
    const draft = prepared.requestStates.find(r => r.sourceId === 20)!;
    await expect(local.pool!.query("UPDATE crm.eto_requests SET eto_number='ETO-2026-0006' WHERE id=$1", [draft.id]))
      .rejects.toThrow("HISTORICAL_NUMBER_ALREADY_USED");
    await local.pool!.query("INSERT INTO crm.eto_number_registry VALUES ('ETO-2026-0099'),('ETO-2026-0006-01')");
    await expect(local.pool!.query("UPDATE crm.eto_requests SET eto_number='ETO-2026-0006-01' WHERE id=$1", [draft.id]))
      .rejects.toThrow("HISTORICAL_NUMBER_ALREADY_USED");
    const { db } = await import("@workspace/db");
    const { allocateEtoNumber } = await import("../eto-number");
    expect(await db.transaction(tx => allocateEtoNumber(tx, new Date("2026-10-08"), true))).toBe("ETO-2026-0100");
    const index = await local.pool!.query("SELECT pg_get_indexdef('crm.eto_active_number_unique'::regclass) AS definition");
    expect(index.rows[0].definition).toContain("NOT is_archived");
  });

  it("fails closed if a partial schema, wrong version or disabled guard is installed", async () => {
    await local.pool!.query("ALTER TABLE crm.eto_comments DISABLE TRIGGER eto_archive_write_guard");
    expect((await request(app).get("/api/eto-requests")).status).toBe(503);
    await local.pool!.query("ALTER TABLE crm.eto_comments ENABLE TRIGGER eto_archive_write_guard");
    expect(await store.epoch()).toBe(epoch);
  });
});
