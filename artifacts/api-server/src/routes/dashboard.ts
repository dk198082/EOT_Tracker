import { Router } from "express";
import { db } from "@workspace/db";
import {
  etoRequestsTable,
  stageTransitionsTable,
  usersTable,
} from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth";
import { eq, sql, and, desc } from "drizzle-orm";
import type { User } from "@workspace/db";
import { getSplitFamilyMetadata } from "../lib/splitFamily";
import { archiveStore, withArchiveMetadata } from "../lib/shared-merge/database";

const router = Router();

const effectiveStageSql = sql<string>`CASE
  WHEN ${etoRequestsTable.stage} = 'closed' THEN 'lost'
  WHEN ${etoRequestsTable.stage} = 'declined' AND EXISTS (
    SELECT 1
    FROM ${stageTransitionsTable} legacy_loss
    WHERE legacy_loss.eto_request_id = ${etoRequestsTable.id}
      AND legacy_loss.decision = 'mark-lost'
  ) THEN 'lost'
  ELSE ${etoRequestsTable.stage}
END`;

const TERMINAL_STAGES = ["won", "declined", "lost", "closed", "abandoned"];
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isOverdue(stage: string, updatedAt: string | Date): boolean {
  if (TERMINAL_STAGES.includes(stage)) return false;
  const thresholdDays = stage === "engineering-review" ? 5 : 3;
  return Date.now() - new Date(updatedAt).getTime() >= thresholdDays * MS_PER_DAY;
}

/** GET /api/dashboard/metrics */
router.get("/metrics", requireAuth, async (_req, res, next) => {
  try {
    const epoch = await archiveStore.epoch();
    const active = epoch ? sql`${etoRequestsTable}.is_archived = false` : sql`true`;
    const activeTransition = epoch ? sql`EXISTS (SELECT 1 FROM crm.eto_requests r
      WHERE r.id=${stageTransitionsTable.etoRequestId} AND NOT r.is_archived)` : sql`true`;
    // Stage counts
    const stageCountRows = await db
      .select({ stage: etoRequestsTable.stage, count: sql<number>`count(*)::int` })
      .from(etoRequestsTable)
      .where(active)
      .groupBy(etoRequestsTable.stage);

    const stageCounts: Record<string, number> = {};
    for (const row of stageCountRows) {
      stageCounts[row.stage] = row.count;
    }

    // Fold legacy terminal representations into Lost while leaving stored
    // rows and their audit history unchanged.
    const [legacyLostRow] = await db
      .select({ count: sql<number>`count(distinct ${etoRequestsTable.id})::int` })
      .from(etoRequestsTable)
      .innerJoin(
        stageTransitionsTable,
        and(
          eq(stageTransitionsTable.etoRequestId, etoRequestsTable.id),
          eq(stageTransitionsTable.decision, "mark-lost"),
        ),
      )
      .where(and(eq(etoRequestsTable.stage, "declined"), active));

    const legacyLostCount = legacyLostRow?.count ?? 0;
    stageCounts["lost"] =
      (stageCounts["lost"] ?? 0) +
      (stageCounts["closed"] ?? 0) +
      legacyLostCount;
    stageCounts["declined"] = Math.max(
      0,
      (stageCounts["declined"] ?? 0) - legacyLostCount,
    );
    delete stageCounts["closed"];

    // Totals
    const totalOpen = Object.entries(stageCounts)
      .filter(([stage]) => !["won", "declined", "lost", "abandoned"].includes(stage))
      .reduce((sum, [, count]) => sum + count, 0);
    const totalWon = stageCounts["won"] ?? 0;
    const totalDeclined = stageCounts["declined"] ?? 0;
    const totalLost = stageCounts["lost"] ?? 0;

    // Declines are internal ART rejections only. Historical mark-lost and
    // removed production-decline transitions must not inflate this metric.
    const declineRows = await db
      .select({
        fromStage: stageTransitionsTable.fromStage,
        count: sql<number>`count(*)::int`,
      })
      .from(stageTransitionsTable)
      .where(
        and(
          activeTransition,
          eq(stageTransitionsTable.decision, "decline"),
          eq(stageTransitionsTable.toStage, "declined"),
          sql`${stageTransitionsTable.fromStage} IN ('art-review', 'art-final-review')`,
        ),
      )
      .groupBy(stageTransitionsTable.fromStage);

    const declinesByStage: Record<string, number> = {};
    for (const row of declineRows) {
      declinesByStage[row.fromStage] = row.count;
    }

    // More-info loop count
    const moreInfoDecisions = ["more-info-sales", "engineering-more-info", "production-more-info"];
    const moreInfoRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(stageTransitionsTable)
      .where(and(activeTransition, sql`${stageTransitionsTable.decision} = ANY(${sql.raw(`ARRAY['${moreInfoDecisions.join("','")}']`)})`));
    const moreInfoLoopCount = moreInfoRows[0]?.count ?? 0;

    // Avg time per stage (hours)
    const avgTimeRows = await db
      .select({
        toStage: stageTransitionsTable.toStage,
        fromStage: stageTransitionsTable.fromStage,
      })
      .from(stageTransitionsTable);

    // Simple approximation: avg time = not computed in MVP (no start timestamp per stage)
    // Return empty for now — time-in-stage requires tracking entry time per stage
    const avgTimePerStageHours: Record<string, number> = {};

    // Overdue count — mirrors the SQL clause in eto-requests.ts (and the
    // thresholds in src/scripts/remind.ts): engineering-review = 5 days,
    // all other non-terminal stages = 3 days of inactivity.
    const overdueRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(etoRequestsTable)
      .where(and(active, sql`(
        ${etoRequestsTable.stage} NOT IN ('won', 'declined', 'lost', 'closed', 'abandoned')
        AND (
          CASE
            WHEN ${etoRequestsTable.stage} = 'engineering-review'
            THEN ${etoRequestsTable.updatedAt} <= now() - interval '5 days'
            ELSE ${etoRequestsTable.updatedAt} <= now() - interval '3 days'
          END
        )
      )`));
    const overdueCount = overdueRows[0]?.count ?? 0;

    res.json({
      stageCounts,
      totalOpen,
      totalWon,
      totalDeclined,
      totalLost,
      declinesByStage,
      moreInfoLoopCount,
      avgTimePerStageHours,
      overdueCount,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/dashboard/my-queue */
router.get("/my-queue", requireAuth, async (_req, res, next) => {
  const user = res.locals.dbUser as User;
  try {
    const epoch = await archiveStore.epoch();
    const active = epoch ? sql`${etoRequestsTable}.is_archived = false` : sql`true`;
    const familyCreatedAt = sql<Date>`COALESCE(
      (
        SELECT parent.created_at
        FROM ${etoRequestsTable} parent
        WHERE parent.id = ${etoRequestsTable.parentEtoRequestId}
      ),
      ${etoRequestsTable.createdAt}
    )`;
    const rows = await db
      .select({
        r: etoRequestsTable,
        effectiveStage: effectiveStageSql,
        assignee: {
          id: sql<number | null>`a.id`,
          name: sql<string | null>`a.name`,
          role: sql<string | null>`a.role`,
        },
        stickyEngineer: {
          name: sql<string | null>`se.name`,
        },
        submittedBy: {
          name: sql<string>`sb.name`,
        },
        parentEtoNumber: sql<string | null>`(
          SELECT parent.eto_number
          FROM ${etoRequestsTable} parent
          WHERE parent.id = ${etoRequestsTable.parentEtoRequestId}
        )`,
      })
      .from(etoRequestsTable)
      .leftJoin(sql`${usersTable} a`, sql`a.id = ${etoRequestsTable.assigneeId}`)
      .leftJoin(sql`${usersTable} se`, sql`se.id = ${etoRequestsTable.stickyEngineerUserId}`)
      .innerJoin(sql`${usersTable} sb`, sql`sb.id = ${etoRequestsTable.submittedById}`)
      .where(and(eq(etoRequestsTable.assigneeId, user.id), active))
      .orderBy(
        desc(familyCreatedAt),
        desc(sql<number>`COALESCE(${etoRequestsTable.parentEtoRequestId}, ${etoRequestsTable.id})`),
        sql`CASE WHEN ${etoRequestsTable.parentEtoRequestId} IS NULL THEN 0 ELSE ${etoRequestsTable.splitSequence} END`,
        desc(etoRequestsTable.id),
      );

    res.json(await withArchiveMetadata(rows.map(({ r, effectiveStage, assignee, stickyEngineer, submittedBy, parentEtoNumber }) => ({
      ...getSplitFamilyMetadata(r, parentEtoNumber),
      id: r.id,
      etoNumber: r.etoNumber,
      customerName: r.customerName,
      quoteNumber: r.quoteNumber,
      quoteRevision: r.quoteRevision,
      testType: r.testType,
      distributor: r.distributor,
      requestType: r.requestType,
      machineType: r.machineType,
      expectedForceRange: r.expectedForceRange,
      expectedForceUnit: r.expectedForceUnit,
      expectedDisplacement: r.expectedDisplacement,
      expectedDisplacementUnit: r.expectedDisplacementUnit,
      resultsRequired: r.resultsRequired,
      budgetRange: r.budgetRange,
      budgetCurrency: r.budgetCurrency,
      acceptableLeadTime: r.acceptableLeadTime,
      similarParts: r.similarParts,
      materials: r.materials,
      specimenDimensions: r.specimenDimensions,
      relevantStandards: r.relevantStandards,
      customerComponents: r.customerComponents,
      customDetails: r.customDetails,
      stage: effectiveStage,
      includeEngineeringReview: r.includeEngineeringReview,
      includeProductionReview: r.includeProductionReview,
      engineeringReviewDurationWeeks: r.engineeringReviewDurationWeeks,
      productionReviewDurationWeeks: r.productionReviewDurationWeeks,
      artFinalReviewDurationWeeks: r.artFinalReviewDurationWeeks,
      artReviewAcceptedDate: r.artReviewAcceptedDate,
      dueDate: r.dueDate,
      productionAssigneeId: r.productionAssigneeId,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      assigneeRole: assignee.role,
      stickyEngineerUserId: r.stickyEngineerUserId,
      stickyEngineerName: stickyEngineer.name,
      submittedById: r.submittedById,
      submittedByName: submittedBy.name,
      parentEtoRequestId: r.parentEtoRequestId,
      parentEtoNumber,
      splitSequence: r.splitSequence,
      declineReason: r.declineReason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      overdue: isOverdue(effectiveStage, r.updatedAt),
    })), epoch));
  } catch (err) {
    next(err);
  }
});

export default router;
