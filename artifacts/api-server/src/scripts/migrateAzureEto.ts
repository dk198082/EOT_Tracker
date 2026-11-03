/**
 * Explicit, one-time development-to-Azure cutover.
 * Stop the old API workflow first. Never run from startup or a publish hook.
 * Source rows stay untouched. Destination DDL/data/constraints are atomic.
 */
import { createMigrationSourcePool } from "@workspace/db/migration-source";
import { writeFile, mkdir } from "node:fs/promises";
import { getAzureEtoPool } from "@workspace/db/azure-crm";
import { ETO_DATABASE, ETO_SCHEMA, ETO_TABLE_NAMES } from "../../../../lib/db/src/schema/namespace";
import { logger } from "../lib/logger";

type SourceName = keyof typeof ETO_TABLE_NAMES;
type Column = {
  name: string;
  sql_type: string;
  not_null: boolean;
  default_value: string | null;
  sequence_name: string | null;
};
type Constraint = {
  name: string;
  kind: string;
  definition: string;
  columns: string[];
  referenced_table: string | null;
  referenced_columns: string[];
};

function quote(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Unsafe migration identifier");
  return `"${name}"`;
}
const destination = (name: string) => `${quote(ETO_SCHEMA)}.${quote(name)}`;
const fingerprintSql = (table: string) => `
  SELECT count(*)::int AS count,
         md5(coalesce(string_agg(to_jsonb(row)::text, E'\\n'
             ORDER BY to_jsonb(row)::text COLLATE "C"), '')) AS fingerprint
    FROM ${table} row`;

async function migrate(): Promise<void> {
  if (!process.argv.includes("--execute") || process.env.NODE_ENV === "production") {
    throw new Error("Explicit --execute is required, outside production, with the source API stopped");
  }
  if (!process.env.DATABASE_URL) throw new Error("Development source connection is required");
  const sourcePool = createMigrationSourcePool();
  const targetPool = getAzureEtoPool();
  const source = await sourcePool.connect();
  const target = await targetPool.connect();
  const summary: Array<{ source: string; destination: string; rows: number; verified: boolean }> = [];
  let step = "preflight";
  try {
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await target.query("BEGIN");
    await target.query("SELECT pg_advisory_xact_lock($1)", [681208]);
    const sourceCheck = await source.query("SELECT current_database() = $1 AS is_azure", [ETO_DATABASE]);
    const targetCheck = await target.query("SELECT current_database() = $1 AS correct", [ETO_DATABASE]);
    if (sourceCheck.rows[0].is_azure || !targetCheck.rows[0].correct) {
      throw new Error("Unexpected source or destination database");
    }
    const existing = await target.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=ANY($2::text[])",
      [ETO_SCHEMA, Object.values(ETO_TABLE_NAMES)],
    );
    if (existing.rowCount) throw new Error("Destination tables already exist; never overwrite or merge implicitly");
    const definitions = new Map<SourceName, { columns: Column[]; constraints: Constraint[] }>();
    const sequences: Array<{ table: string; column: string; name: string; sourceLast: string; called: boolean }> = [];

    // Define all tables first, so foreign keys and split self-links can be added
    // after every source row has arrived.
    for (const sourceName of Object.keys(ETO_TABLE_NAMES) as SourceName[]) {
      step = `create:${sourceName}`;
      const targetName = ETO_TABLE_NAMES[sourceName];
      const columns = await source.query<Column>(
        `SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS sql_type,
                a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_value,
                pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) AS sequence_name
           FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
           JOIN pg_namespace n ON n.oid=c.relnamespace
           LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
          WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped
          ORDER BY a.attnum`, [sourceName],
      );
      if (!columns.rows.length) throw new Error("A required source table is missing");
      const constraints = await source.query<Constraint>(
        `SELECT p.conname AS name, p.contype::text AS kind, pg_get_constraintdef(p.oid) AS definition,
                ARRAY(SELECT a.attname::text FROM unnest(p.conkey) WITH ORDINALITY k(num,pos)
                      JOIN pg_attribute a ON a.attrelid=p.conrelid AND a.attnum=k.num ORDER BY k.pos) AS columns,
                f.relname AS referenced_table,
                ARRAY(SELECT a.attname::text FROM unnest(p.confkey) WITH ORDINALITY k(num,pos)
                      JOIN pg_attribute a ON a.attrelid=p.confrelid AND a.attnum=k.num ORDER BY k.pos) AS referenced_columns
           FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid
           JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class f ON f.oid=p.confrelid
          WHERE n.nspname='public' AND c.relname=$1 ORDER BY p.contype,p.conname`, [sourceName],
      );
      definitions.set(sourceName, { columns: columns.rows, constraints: constraints.rows });
      const columnSql: string[] = [];
      for (const col of columns.rows) {
        let defaultValue = col.default_value;
        if (col.sequence_name) {
          if (col.sql_type !== "integer") throw new Error("Unsupported sequence column type");
          const parts = col.sequence_name.split(".");
          if (parts.length !== 2 || parts[0] !== "public") throw new Error("Unexpected source sequence");
          const sourceSequence = await source.query<{ last_value: string; is_called: boolean }>(
            `SELECT last_value::text, is_called FROM ${quote(parts[0])}.${quote(parts[1])}`,
          );
          const sequenceName = `${targetName}_${col.name}_seq`;
          await target.query(`CREATE SEQUENCE ${destination(sequenceName)} AS integer`);
          defaultValue = `nextval('${destination(sequenceName)}'::regclass)`;
          sequences.push({
            table: targetName, column: col.name, name: sequenceName,
            sourceLast: sourceSequence.rows[0].last_value, called: sourceSequence.rows[0].is_called,
          });
        }
        columnSql.push(`${quote(col.name)} ${col.sql_type}${col.not_null ? " NOT NULL" : ""}${defaultValue ? ` DEFAULT ${defaultValue}` : ""}`);
      }
      await target.query(`CREATE TABLE ${destination(targetName)} (${columnSql.join(", ")})`);
    }

    for (const sourceName of Object.keys(ETO_TABLE_NAMES) as SourceName[]) {
      step = `copy:${sourceName}`;
      const targetName = ETO_TABLE_NAMES[sourceName];
      // JSON is transferred only in memory, never written to logs/files.
      // PostgreSQL supplies timestamp strings, preserving sub-millisecond precision.
      const payload = await source.query<{ payload: unknown[] }>(
        `SELECT coalesce(jsonb_agg(to_jsonb(row)), '[]'::jsonb) AS payload FROM public.${quote(sourceName)} row`,
      );
      const columns = definitions.get(sourceName)!.columns.map((c) => quote(c.name)).join(", ");
      await target.query(
        `INSERT INTO ${destination(targetName)} (${columns})
         SELECT ${columns} FROM jsonb_populate_recordset(NULL::${destination(targetName)}, $1::jsonb)`,
        [JSON.stringify(payload.rows[0].payload)],
      );
      const before = (await source.query(fingerprintSql(`public.${quote(sourceName)}`))).rows[0];
      const after = (await target.query(fingerprintSql(destination(targetName)))).rows[0];
      if (before.count !== after.count || before.fingerprint !== after.fingerprint) {
        throw new Error("Source and destination rows differ");
      }
      summary.push({ source: `public.${sourceName}`, destination: `${ETO_SCHEMA}.${targetName}`, rows: after.count, verified: true });
    }

    // Every referenced primary/unique key must exist before any foreign key,
    // including eto_requests' self-reference for split requests.
    for (const foreignKeysOnly of [false, true]) {
    for (const sourceName of Object.keys(ETO_TABLE_NAMES) as SourceName[]) {
      step = `${foreignKeysOnly ? "foreign-keys" : "keys"}:${sourceName}`;
      const targetName = ETO_TABLE_NAMES[sourceName];
      for (const constraint of definitions.get(sourceName)!.constraints) {
        if ((constraint.kind === "f") !== foreignKeysOnly) continue;
        let definition = constraint.definition;
        let name: string;
        if (constraint.kind === "f") {
          const referenced = ETO_TABLE_NAMES[constraint.referenced_table as SourceName];
          if (!referenced) throw new Error("Unexpected foreign-key destination");
          definition = definition.replace(/REFERENCES\s+[^\s(]+/, `REFERENCES ${destination(referenced)}`);
          name = `${targetName}_${constraint.columns.join("_")}_${referenced}_${constraint.referenced_columns.join("_")}_fk`;
        } else if (constraint.kind === "p") {
          name = `${targetName}_pkey`;
        } else if (constraint.kind === "u") {
          name = `${targetName}_${constraint.columns.join("_")}_unique`;
        } else {
          throw new Error("Unexpected source constraint type");
        }
        await target.query(`ALTER TABLE ${destination(targetName)} ADD CONSTRAINT ${quote(name.slice(0, 63))} ${definition}`);
      }
      if (foreignKeysOnly) continue;
      const indexes = await source.query<{ name: string; definition: string; unique: boolean }>(
        `SELECT i.relname AS name, pg_get_indexdef(x.indexrelid) AS definition, x.indisunique AS unique
           FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid
           JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
           LEFT JOIN pg_constraint p ON p.conindid=x.indexrelid
          WHERE n.nspname='public' AND t.relname=$1 AND p.oid IS NULL`, [sourceName],
      );
      for (const index of indexes.rows) {
        const indexName = index.name.startsWith("eto_") ? index.name : `eto_${index.name}`;
        const using = index.definition.indexOf(" USING ");
        if (using < 0) throw new Error("Unsupported index definition");
        await target.query(`CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quote(indexName)} ON ${destination(targetName)}${index.definition.slice(using)}`);
      }
    }
    }
    for (const seq of sequences) {
      step = `sequence:${seq.table}`;
      await target.query(`ALTER SEQUENCE ${destination(seq.name)} OWNED BY ${destination(seq.table)}.${quote(seq.column)}`);
      const maximum = (await target.query(`SELECT max(${quote(seq.column)})::text AS maximum FROM ${destination(seq.table)}`)).rows[0].maximum;
      const last = Math.max(Number(seq.sourceLast), maximum === null ? 1 : Number(maximum));
      const called = seq.called || (maximum !== null && Number(maximum) >= Number(seq.sourceLast));
      await target.query("SELECT setval($1::regclass, $2::bigint, $3::boolean)", [destination(seq.name), last, called]);
    }
    step = "commit";
    await source.query("COMMIT");
    await target.query("COMMIT");
    logger.info({ tables: summary.length, rows: summary.reduce((sum, table) => sum + table.rows, 0) }, "Azure ETO migration committed; all source/destination row fingerprints match");
    // Metadata only: no identities, record contents, or session tokens.
    await mkdir("reports", { recursive: true });
    await writeFile("reports/azure-eto-migration.json", JSON.stringify({ database: ETO_DATABASE, schema: ETO_SCHEMA, tables: summary }, null, 2));
  } catch (error) {
    await target.query("ROLLBACK").catch(() => {});
    await source.query("ROLLBACK").catch(() => {});
    const code = (error as { code?: string }).code;
    logger.error({
      step,
      code: code ?? "VALIDATION_FAILED",
      // PostgreSQL error details can contain row values; never log those.
      reason: !code && error instanceof Error ? error.message : undefined,
    }, "Azure ETO migration failed; destination transaction rolled back");
    throw new Error("Azure ETO migration did not complete; inspect the sanitized migration step");
  } finally {
    source.release();
    target.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

void migrate().catch(() => { process.exitCode = 1; });
