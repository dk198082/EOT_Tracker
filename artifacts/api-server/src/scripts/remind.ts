/**
 * Inactivity reminder script.
 *
 * Queries all active ETO requests and sends reminder emails when a request
 * has been sitting in a stage with no action, on a cadence of:
 *
 *   - Engineering-review steps  → every 5 days of inactivity
 *   - All other active stages   → every 3 days of inactivity
 *
 * Deduplication: `last_reminded_at` is written to `eto_requests` each time a
 * reminder fires.  A reminder is sent only when:
 *   (a) the request has been inactive for at least one full threshold period, AND
 *   (b) no reminder has been sent within the last threshold period
 *       (or no reminder has ever been sent).
 *
 * This prevents both startup-rerun spam and daily-sweep accumulation.
 *
 * This module exports `runReminders`, called:
 *   - Once on server startup (so a repl restart never misses a day)
 *   - Daily at 08:00 UTC via node-cron (see index.ts)
 *
 * It can also be invoked directly:
 *   pnpm --filter @workspace/api-server tsx src/scripts/remind.ts
 */

import { db } from "@workspace/db";
import { etoRequestsTable, usersTable } from "@workspace/db/schema";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { sendInactivityReminder } from "../lib/email";
import { logger } from "../lib/logger";
import { archiveStore } from "../lib/shared-merge/database";

const TERMINAL_STAGES = ["won", "declined", "lost", "closed", "abandoned"];

/** Stages that use the 5-day inactivity threshold. */
const ENGINEERING_STAGES = ["engineering-review"];

const THRESHOLD_DEFAULT_DAYS = 3;
const THRESHOLD_ENGINEERING_DAYS = 5;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export async function runReminders(): Promise<void> {
  logger.info("Running inactivity reminder sweep…");

  try {
    const epoch = await archiveStore.epoch();
    const active = epoch ? sql`${etoRequestsTable}.is_archived = false` : sql`true`;
    // Fetch all active ETOs along with their current assignee details.
    const rows = await db
      .select({
        id: etoRequestsTable.id,
        etoNumber: etoRequestsTable.etoNumber,
        customerName: etoRequestsTable.customerName,
        stage: etoRequestsTable.stage,
        updatedAt: etoRequestsTable.updatedAt,
        lastRemindedAt: etoRequestsTable.lastRemindedAt,
        assigneeId: etoRequestsTable.assigneeId,
        assigneeEmail: sql<string | null>`a.email`,
        assigneeName: sql<string | null>`a.name`,
      })
      .from(etoRequestsTable)
      .leftJoin(sql`${usersTable} a`, sql`a.id = ${etoRequestsTable.assigneeId}`)
      .where(and(active, notInArray(etoRequestsTable.stage, TERMINAL_STAGES)));

    const now = new Date();
    let reminded = 0;

    for (const row of rows) {
      if (!row.assigneeEmail) continue; // no one to remind

      const thresholdDays = ENGINEERING_STAGES.includes(row.stage)
        ? THRESHOLD_ENGINEERING_DAYS
        : THRESHOLD_DEFAULT_DAYS;
      const thresholdMs = thresholdDays * MS_PER_DAY;

      const msInactive = now.getTime() - new Date(row.updatedAt).getTime();

      // (a) Must be inactive for at least one full threshold period.
      if (msInactive < thresholdMs) continue;

      // (b) Must not have sent a reminder within the last threshold period.
      if (row.lastRemindedAt) {
        const msSinceReminder = now.getTime() - new Date(row.lastRemindedAt).getTime();
        if (msSinceReminder < thresholdMs) continue;
      }

      const daysInactive = Math.floor(msInactive / MS_PER_DAY);

      const accepted = await sendInactivityReminder({
        etoId: row.id,
        etoNumber: row.etoNumber ?? `Draft #${row.id}`,
        customerName: row.customerName,
        stage: row.stage,
        daysInactive,
        ownerEmail: row.assigneeEmail,
        ownerName: row.assigneeName ?? "Team",
      });

      if (accepted) {
        // Only stamp last_reminded_at when Microsoft Graph accepted the message.
        // Failed or skipped sends leave the field unchanged so the next
        // sweep can retry without waiting a full threshold period.
        await db
          .update(etoRequestsTable)
          .set({ lastRemindedAt: now })
          .where(eq(etoRequestsTable.id, row.id));

        reminded++;
        logger.info(
          { etoId: row.id, etoNumber: row.etoNumber, daysInactive, stage: row.stage },
          "Reminder email accepted by Microsoft Graph",
        );
      } else {
        logger.warn(
          { etoId: row.id, etoNumber: row.etoNumber, daysInactive, stage: row.stage },
          "Reminder email skipped or failed — will retry on next sweep",
        );
      }
    }

    logger.info({ reminded, total: rows.length }, "Inactivity reminder sweep complete");
  } catch (err) {
    logger.error({ err }, "Inactivity reminder sweep failed");
  }
}

// Direct invocation: `tsx src/scripts/remind.ts`
// NOTE: do NOT use import.meta.url here — when bundled into dist/index.mjs
// by esbuild the check evaluates to true and kills the server process.
// Run directly via tsx which executes this file as its own entry point.

