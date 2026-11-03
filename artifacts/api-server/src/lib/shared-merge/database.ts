import { pool } from "@workspace/db";
import type { ArchiveMetadata, ArchiveStore } from "./runtime";

/** Raw optional columns intentionally do not enter the live Drizzle models. */
export const archiveStore: ArchiveStore = {
  async epoch() {
    const { rows: [presence] } = await pool.query(`
      SELECT to_regclass('crm.eto_merge_state') IS NOT NULL AS marker,
        EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='crm' AND table_name='eto_requests'
            AND column_name IN ('record_key','migration_epoch','is_archived','archive_source','archive_source_id','archive_reason')) AS partial`);
    if (!presence.marker && !presence.partial) return null;
    if (!presence.marker) throw new Error("Partial archive schema");
    const { rows } = await pool.query(`
      SELECT epoch FROM crm.eto_merge_state WHERE singleton=true AND schema_version=1
        AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='crm'
          AND table_name='eto_requests' AND column_name IN
          ('record_key','migration_epoch','is_archived','archive_source','archive_source_id','archive_reason'))=6
        AND to_regclass('crm.eto_number_registry') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('crm.eto_active_number_unique') AND indisunique AND indisvalid)
        AND (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crm'
          AND t.tgname='eto_archive_write_guard' AND t.tgenabled='O'
          AND c.relname IN ('eto_requests','eto_comments','eto_attachments','eto_stage_transitions',
            'eto_detail_changes','eto_engineering_outputs','eto_production_outputs','eto_art_final_outputs','eto_price_calculator'))=9
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='crm.eto_requests'::regclass
          AND tgname='eto_number_guard' AND tgenabled='O')`);
    if (rows.length !== 1 || !rows[0].epoch) throw new Error("Incompatible archive schema");
    return rows[0].epoch as string;
  },
  async metadata(ids) {
    if (!ids.length) return new Map();
    const { rows } = await pool.query(`
      SELECT id, record_key AS "recordKey", migration_epoch AS "migrationEpoch",
        is_archived AS archived, archive_source AS source, archive_source_id AS "sourceId",
        archive_reason AS "archiveReason" FROM crm.eto_requests WHERE id=ANY($1::int[])`, [ids]);
    if (rows.some(row => !row.recordKey || !row.migrationEpoch)) throw new Error("Missing record identity");
    return new Map(rows.map(row => [row.id, row as ArchiveMetadata]));
  },
};

export async function withArchiveMetadata<T extends { id: number }>(rows: T[], epoch: string | null): Promise<(T & Partial<ArchiveMetadata>)[]> {
  if (!epoch) return rows;
  const metadata = await archiveStore.metadata(rows.map(row => row.id));
  return rows.map(row => {
    const state = metadata.get(row.id);
    if (!state || state.migrationEpoch !== epoch) throw new Error("Missing current archive metadata");
    return { ...row, ...state };
  });
}
