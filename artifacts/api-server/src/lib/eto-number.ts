import type { db } from "@workspace/db";
import { etoRequestsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Must run inside the transaction that submits the request. The year lock
 * serializes allocations; rollback leaves the next number available.
 * Split-child suffixes are deliberately excluded from the base sequence.
 */
export async function allocateEtoNumber(tx: Transaction, now = new Date(), sharedSchema = false): Promise<string> {
  const year = now.getFullYear();
  await tx.execute(sql`select pg_advisory_xact_lock(${0x45544f}::integer, ${year}::integer)`);
  const pattern = `^ETO-${year}-([0-9]{4,})$`;
  if (sharedSchema) {
    const result = await tx.execute<{ max_sequence: string }>(sql`
      SELECT coalesce(max(substring(eto_number from ${pattern})::numeric),0)::text AS max_sequence
      FROM crm.eto_number_registry WHERE eto_number ~ ${pattern}`);
    return `ETO-${year}-${String(BigInt(result.rows[0].max_sequence) + 1n).padStart(4, "0")}`;
  }
  const [row] = await tx.select({
    maxSequence: sql<string>`coalesce(max(substring(${etoRequestsTable.etoNumber} from ${pattern})::numeric), 0)::text`,
  }).from(etoRequestsTable).where(sql`${etoRequestsTable.etoNumber} ~ ${pattern}`);
  const next = BigInt(row.maxSequence) + 1n;
  return `ETO-${year}-${String(next).padStart(4, "0")}`;
}