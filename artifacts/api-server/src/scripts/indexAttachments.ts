import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { attachmentsTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { extractAttachmentText } from "../lib/attachmentTextExtractor";
import { archiveStore } from "../lib/shared-merge/database";

const MAX_ATTEMPTS = 3;
const DEFAULT_BATCH_SIZE = 3;
let indexingRunActive = false;

async function claimNextAttachment() {
  const epoch = await archiveStore.epoch();
  const writable = epoch ? sql`EXISTS (SELECT 1 FROM crm.eto_requests r
    WHERE r.id=eto_request_id AND NOT r.is_archived)` : sql`true`;
  await db.execute(sql`
    UPDATE ${attachmentsTable}
    SET
      search_status = 'failed',
      search_error = 'Text extraction lease expired after the maximum retry count',
      search_lease_token = NULL,
      search_processed_at = now()
    WHERE
      ${writable} AND
      search_status = 'processing'
      AND search_attempts >= ${MAX_ATTEMPTS}
      AND search_processed_at <= now() - interval '10 minutes'
  `);

  const leaseToken = randomUUID();
  const claimed = await db.execute<{ id: number }>(sql`
    WITH candidate AS (
      SELECT id
      FROM ${attachmentsTable}
      WHERE
        ${writable} AND (search_status = 'pending'
        OR (
          search_status = 'failed'
          AND search_attempts < ${MAX_ATTEMPTS}
          AND search_processed_at <= now() - (interval '2 minutes' * greatest(search_attempts, 1))
        )
        OR (
          search_status = 'processing'
          AND search_attempts < ${MAX_ATTEMPTS}
          AND search_processed_at <= now() - interval '10 minutes'
        ))
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE ${attachmentsTable} AS attachment
    SET
      search_status = 'processing',
      search_error = NULL,
      search_attempts = attachment.search_attempts + 1,
      search_lease_token = ${leaseToken},
      search_processed_at = now()
    FROM candidate
    WHERE attachment.id = candidate.id
    RETURNING attachment.id
  `);

  const id = claimed.rows[0]?.id;
  if (!id) return null;

  const [attachment] = await db
    .select()
    .from(attachmentsTable)
    .where(eq(attachmentsTable.id, id))
    .limit(1);
  return attachment ? { attachment, leaseToken } : null;
}

export async function runAttachmentIndexing(batchSize = DEFAULT_BATCH_SIZE): Promise<void> {
  if (indexingRunActive) return;
  indexingRunActive = true;

  try {
    const maxBatchSize = Math.max(1, Math.min(batchSize, 10));
    let processed = 0;
    for (let index = 0; index < maxBatchSize; index += 1) {
      const claim = await claimNextAttachment();
      if (!claim) break;
      const { attachment, leaseToken } = claim;

      const result = await extractAttachmentText(attachment);
      await db
        .update(attachmentsTable)
        .set({
          searchText: result.status === "complete" ? result.text : null,
          searchStatus: result.status,
          searchError: result.status === "complete" ? null : result.error,
          searchLeaseToken: null,
          searchProcessedAt: new Date(),
        })
        .where(
          and(
            eq(attachmentsTable.id, attachment.id),
            eq(attachmentsTable.searchStatus, "processing"),
            eq(attachmentsTable.searchLeaseToken, leaseToken),
          ),
        );
      processed += 1;

      if (result.status !== "complete") {
        logger.warn(
          { attachmentId: attachment.id, status: result.status, reason: result.error },
          "Attachment text indexing did not produce searchable text",
        );
      }
    }

    if (processed > 0) {
      logger.info({ processed }, "Attachment text indexing batch completed");
    }
  } catch (error) {
    logger.error({ err: error }, "Attachment text indexing batch failed");
  } finally {
    indexingRunActive = false;
  }
}