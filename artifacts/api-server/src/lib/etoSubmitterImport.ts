import { db, dataImportsTable, etoRequestsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const DEFAULT_IMPORT_ID = "reassign-demo-eto-submitters-to-justin-2026-09-17";
const DEFAULT_SOURCE_EMAIL = "alex@demo.test";
const DEFAULT_TARGET_EMAIL = "jseidler@tiniusolsen.com";

/**
 * One-time production data repair for the legacy demo requests.
 *
 * Only the request submitter relationship moves. Stage audit actors and
 * comments remain unchanged so the historical trail is not rewritten.
 */
export async function reassignEtoSubmittersOnce({
  importId = DEFAULT_IMPORT_ID,
  sourceEmail = DEFAULT_SOURCE_EMAIL,
  targetEmail = DEFAULT_TARGET_EMAIL,
}: {
  importId?: string;
  sourceEmail?: string;
  targetEmail?: string;
} = {}): Promise<{ applied: boolean; reassignedRequests: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`data-import:${importId}`}, 0))`,
    );

    const [existing] = await tx
      .select({ matchedUsers: dataImportsTable.matchedUsers })
      .from(dataImportsTable)
      .where(eq(dataImportsTable.id, importId))
      .limit(1);

    if (existing) {
      return { applied: false, reassignedRequests: existing.matchedUsers };
    }

    const [target] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        sql`lower(${usersTable.email}) = ${targetEmail.toLowerCase()} AND ${usersTable.authId} IS NOT NULL`,
      )
      .limit(1);

    if (!target) {
      throw new Error(`Cannot reassign ETO requests: target user ${targetEmail} is not linked`);
    }

    const [source] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${sourceEmail.toLowerCase()}`)
      .limit(1);

    const reassigned = source
      ? await tx
          .update(etoRequestsTable)
          .set({ submittedById: target.id })
          .where(eq(etoRequestsTable.submittedById, source.id))
          .returning({ id: etoRequestsTable.id })
      : [];

    await tx.insert(dataImportsTable).values({
      id: importId,
      matchedUsers: reassigned.length,
    });

    return { applied: true, reassignedRequests: reassigned.length };
  });
}