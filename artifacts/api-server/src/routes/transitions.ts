import { Router } from "express";
import { isWholeMoney } from "../lib/money";
import { db } from "@workspace/db";
import {
  etoRequestsTable,
  stageTransitionsTable,
  usersTable,
  engineeringOutputsTable,
  productionOutputsTable,
  artFinalOutputsTable,
  reviewAssignmentDefaultsTable,
  reviewDefaultsId,
  detailChangesTable,
} from "@workspace/db/schema";
import { and, eq, asc, desc, sql, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { SubmitTransitionBody } from "@workspace/api-zod";
import { validateAndAdvance, type Decision } from "../lib/workflow";
import { ETO_STAGES } from "@workspace/db";
import type { User, EtoStage } from "@workspace/db";
import { parseIntParam } from "../lib/params";
import { sendTransitionEmails } from "../lib/email";
import { getSplitFamilyMetadata } from "../lib/splitFamily";
import { calculateDesignEstimate, getDesignFormula } from "../lib/design-formula";
import { calculateAssemblyEstimate, getAssemblyFormula } from "../lib/assembly-formula";
import { validateReviewRisk, reviewRiskValues } from "../lib/review-risk";
import { acceptanceCalendarDate, calculateReviewDueDate } from "../lib/review-schedule";
import { allocateEtoNumber } from "../lib/eto-number";
import { normalizeRequiredQuoteDescription } from "../lib/quote-description";

const router = Router({ mergeParams: true });

// ---------- helpers ----------

const TERMINAL_STAGES = ["won", "declined", "lost", "closed", "abandoned"];
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isOverdue(stage: string, updatedAt: string | Date): boolean {
  if (TERMINAL_STAGES.includes(stage)) return false;
  const thresholdDays = stage === "engineering-review" ? 5 : 3;
  return Date.now() - new Date(updatedAt).getTime() >= thresholdDays * MS_PER_DAY;
}

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

async function fetchEtoWithJoins(id: number) {
  const rows = await db
    .select({
      r: etoRequestsTable,
      effectiveStage: effectiveStageSql,
      assigneeName: sql<string | null>`a.name`,
      assigneeEmail: sql<string | null>`a.email`,
      assigneeRole: sql<string | null>`a.role`,
      stickyEngineerName: sql<string | null>`se.name`,
      submittedByName: sql<string>`sb.name`,
      submittedByEmail: sql<string>`sb.email`,
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
    .where(eq(etoRequestsTable.id, id))
    .limit(1);

  if (!rows.length) return null;
  const { r, effectiveStage, assigneeName, assigneeEmail, assigneeRole, stickyEngineerName, submittedByName, submittedByEmail, parentEtoNumber } = rows[0];
  const splitFamily = getSplitFamilyMetadata(r, parentEtoNumber);
  const splitChildren = await db
    .select({
      id: etoRequestsTable.id,
      etoNumber: etoRequestsTable.etoNumber,
      stage: etoRequestsTable.stage,
    })
    .from(etoRequestsTable)
    .where(eq(etoRequestsTable.parentEtoRequestId, id))
    .orderBy(etoRequestsTable.splitSequence);

  return {
    id: r.id,
    etoNumber: r.etoNumber,
    customerName: r.customerName,
    quoteNumber: r.quoteNumber,
    quoteRevision: r.quoteRevision,
    entity: r.entity,
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
    acceptableLeadTime: r.acceptableLeadTime,
    similarParts: r.similarParts,
    materials: r.materials,
    specimenDimensions: r.specimenDimensions,
    relevantStandards: r.relevantStandards,
    customerComponents: r.customerComponents,
    customDetails: r.customDetails,
    budgetCurrency: r.budgetCurrency,
    stage: effectiveStage,
    includeEngineeringReview: r.includeEngineeringReview,
    includeProductionReview: r.includeProductionReview,
    engineeringReviewDurationWeeks: r.engineeringReviewDurationWeeks,
    productionReviewDurationWeeks: r.productionReviewDurationWeeks,
    artFinalReviewDurationWeeks: r.artFinalReviewDurationWeeks,
    artReviewAcceptedDate: r.artReviewAcceptedDate,
    dueDate: r.dueDate,
    productionAssigneeId: r.productionAssigneeId,
    assigneeId: r.assigneeId,
    assigneeName,
    assigneeEmail,
    assigneeRole,
    stickyEngineerUserId: r.stickyEngineerUserId,
    stickyEngineerName,
    submittedById: r.submittedById,
    submittedByName,
    submittedByEmail,
    parentEtoRequestId: r.parentEtoRequestId,
    parentEtoNumber,
    splitSequence: r.splitSequence,
    ...splitFamily,
    splitChildren,
    declineReason: r.declineReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    overdue: isOverdue(effectiveStage, r.updatedAt),
  };
}

// ---------- server-side required-field validation ----------

function isNonNegativeNumber(value: string | null | undefined): boolean {
  return !!value?.trim() && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function validateDecisionFields(
  decision: string,
  body: ReturnType<typeof SubmitTransitionBody.parse>,
): string | null {
  switch (decision) {
    case "approve-engineering":
      break;
    case "engineering-quote-ready":
      if (!body.engineeringEstimatedDesignHours ||
          !Number.isFinite(Number(body.engineeringEstimatedDesignHours)) ||
          Number(body.engineeringEstimatedDesignHours) <= 0 ||
          Number(body.engineeringEstimatedDesignHours) > 1_000_000) {
        return "engineeringEstimatedDesignHours must be a positive number of hours (at most 1,000,000) for engineering-quote-ready";
      }
      if (!body.engineeringPnGuidance) return "engineeringPnGuidance is required for engineering-quote-ready";
      return validateReviewRisk(body.engineeringRiskScore, body.engineeringRiskNotes);
    case "production-approve":
      if (!isWholeMoney(body.productionProcurementCost)) return "productionProcurementCost must be a non-negative whole-number amount for production-approve";
      if (!isNonNegativeNumber(body.productionProcurementLeadTime)) return "productionProcurementLeadTime must be a non-negative number of weeks for production-approve";
      if (!isNonNegativeNumber(body.productionAssemblyTimeHours) || Number(body.productionAssemblyTimeHours) > 1_000_000) return "productionAssemblyTimeHours must be a non-negative number of hours (at most 1,000,000) for production-approve";
      return validateReviewRisk(body.productionRiskScore, body.productionRiskNotes);
    case "art-final-quote":
      if (!isWholeMoney(body.artMarketPrice)) return "artMarketPrice must be a non-negative whole-number amount for art-final-quote";
      if (!body.artMarketLeadtime) return "artMarketLeadtime is required for art-final-quote";
      if (!normalizeRequiredQuoteDescription(body.artQuoteDescription)) return "Quote Description is required for art-final-quote";
      break;
    case "return-draft":
    case "engineering-return-art":
    case "production-return-engineering":
    case "art-final-return-production":
    case "art-final-return-engineering":
    case "quoted-return-art-final":
    case "decline":
    case "mark-lost":
    case "mark-abandoned":
      if (!body.reason) return `reason is required for ${decision}`;
      break;
  }
  return null;
}

// ---------- routes ----------

/** GET /api/eto-requests/:id/transitions */
router.get("/", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const rows = await db
      .select({
        t: stageTransitionsTable,
        actorName: usersTable.name,
        actorRole: usersTable.role,
      })
      .from(stageTransitionsTable)
      .innerJoin(usersTable, eq(stageTransitionsTable.actorId, usersTable.id))
      .where(eq(stageTransitionsTable.etoRequestId, id))
      .orderBy(asc(stageTransitionsTable.createdAt));

    res.json(rows.map(({ t, actorName, actorRole }) => ({
      id: t.id,
      etoRequestId: t.etoRequestId,
      actorId: t.actorId,
      actorName,
      actorRole,
      simulatedRole: t.simulatedRole,
      fromStage: t.fromStage,
      toStage: t.toStage,
      decision: t.decision,
      reason: t.reason,
      includeEngineeringReview: t.includeEngineeringReview,
      includeProductionReview: t.includeProductionReview,
      createdAt: t.createdAt,
    })));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/eto-requests/:id/transitions
 *
 * Advances the ETO workflow and returns the updated EtoRequest so clients can
 * reflect the new stage immediately without a second round-trip.
 */
router.post("/", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = res.locals.dbUser as User;
  const simulatedRole = (res.locals.simulatedRole as string | null | undefined) ?? null;
  const parsed = SubmitTransitionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const body = parsed.data;

  // Server-side required-field validation per decision type
  const fieldError = validateDecisionFields(body.decision, body);
  if (fieldError) {
    res.status(422).json({ error: fieldError });
    return;
  }

  try {
    const [eto] = await db
      .select()
      .from(etoRequestsTable)
      .where(eq(etoRequestsTable.id, id))
      .limit(1);

    if (!eto) { res.status(404).json({ error: "ETO not found" }); return; }

    if (body.decision === "art-final-return-engineering") {
      const [engineeringCompletion] = await db
        .select({ id: stageTransitionsTable.id })
        .from(stageTransitionsTable)
        .where(and(
          eq(stageTransitionsTable.etoRequestId, id),
          eq(stageTransitionsTable.decision, "engineering-quote-ready"),
        ))
        .limit(1);

      if (!engineeringCompletion) {
        res.status(422).json({ error: "Engineering Review must be completed before returning to Engineering" });
        return;
      }
    }

    let restoreStage: EtoStage | undefined;
    if (body.decision === "reopen") {
      const [abandonment] = await db
        .select({ fromStage: stageTransitionsTable.fromStage })
        .from(stageTransitionsTable)
        .where(and(
          eq(stageTransitionsTable.etoRequestId, id),
          eq(stageTransitionsTable.toStage, "abandoned"),
          eq(stageTransitionsTable.decision, "mark-abandoned"),
        ))
        .orderBy(desc(stageTransitionsTable.createdAt))
        .limit(1);

      if (!abandonment || !ETO_STAGES.includes(abandonment.fromStage as EtoStage) || abandonment.fromStage === "abandoned") {
        res.status(422).json({ error: "Cannot re-open this request because its previous active stage could not be determined" });
        return;
      }
      restoreStage = abandonment.fromStage as EtoStage;
    }

    const { toStage, isMoreInfoLoop } = validateAndAdvance(
      eto.stage as EtoStage,
      body.decision as Decision,
      user.role,
      {
        restoreStage,
        includeEngineeringReview:
          body.decision === "approve-engineering"
            ? (body.includeEngineeringReview ?? true)
            : eto.includeEngineeringReview,
        includeProductionReview:
          body.decision === "approve-engineering"
            ? (body.includeProductionReview ?? true)
            : eto.includeProductionReview,
      },
    );

    // Capture pre-update assignee email now — used later for Won notifications
    // where assigneeId is cleared as part of the transition.
    let prevAssigneeEmail: string | null = null;
    if (eto.assigneeId) {
      const [prev] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, eto.assigneeId))
        .limit(1);
      prevAssigneeEmail = prev?.email ?? null;
    }

    // Determine new assignee
    let schedule: Partial<typeof etoRequestsTable.$inferInsert> = {};
    if (body.decision === "approve-engineering" && !eto.dueDate) {
      let acceptedDate: string;
      try {
        acceptedDate = acceptanceCalendarDate(body.reviewTimeZone ?? "UTC");
      } catch {
        res.status(422).json({ error: "Invalid review time zone" });
        return;
      }
      const engineering = body.engineeringReviewDurationWeeks ?? 1;
      const production = body.productionReviewDurationWeeks ?? 1;
      const artFinal = body.artFinalReviewDurationWeeks ?? 1;
      schedule = {
        engineeringReviewDurationWeeks: engineering,
        productionReviewDurationWeeks: production,
        artFinalReviewDurationWeeks: artFinal,
        artReviewAcceptedDate: acceptedDate,
        dueDate: calculateReviewDueDate(acceptedDate, [
          (body.includeEngineeringReview ?? true) ? engineering : 0,
          (body.includeProductionReview ?? true) ? production : 0,
          artFinal,
        ]),
      };
    }
    let newAssigneeId: number | null = eto.assigneeId;
    let newStickyEngineer: number | null = eto.stickyEngineerUserId;
    let newProductionAssignee: number | null = eto.productionAssigneeId ?? null;

    if (body.productionAssigneeId !== undefined && body.decision !== "approve-engineering") {
      res.status(422).json({ error: "Production assignee may only be selected during ART acceptance" });
      return;
    }
    if (body.decision === "approve-engineering") {
      newProductionAssignee = (body.includeProductionReview ?? true)
        ? body.productionAssigneeId ?? null
        : null;
      // Validate the future reviewer now, even when Engineering happens first.
      if (newProductionAssignee !== null) {
        const [productionReviewer] = await db.select({ id: usersTable.id, role: usersTable.role })
          .from(usersTable).where(eq(usersTable.id, newProductionAssignee)).limit(1);
        if (!productionReviewer || productionReviewer.role !== "production") {
          res.status(422).json({ error: "Assigned Production reviewer must have the 'production' role" });
          return;
        }
      }
    }

    const [reviewDefaults] = !isMoreInfoLoop && (toStage === "engineering-review" || toStage === "production-review")
      ? await db.select().from(reviewAssignmentDefaultsTable)
        .where(eq(reviewAssignmentDefaultsTable.id, reviewDefaultsId(
          body.decision === "approve-engineering" ? body.entity ?? eto.entity : eto.entity,
        ))).limit(1)
      : [undefined];

    if (isMoreInfoLoop) {
      // Assign back to the sales rep (submitter) for clarification
      newAssigneeId = eto.submittedById;
    } else {
      switch (body.decision) {
        case "submit":
          newAssigneeId = null; // ART picks up from queue
          break;
        case "approve-engineering": {
          if (!(body.includeEngineeringReview ?? true)) {
            newAssigneeId = null;
            break;
          }
          // ART may override the default; the chosen engineer remains sticky on returns.
          newAssigneeId = body.assigneeId ?? null;
          break;
        }
        case "engineering-quote-ready":
        case "production-approve":
        case "art-final-quote":
        case "return-draft":
        case "engineering-return-art":
        case "quoted-return-art-final":
        case "decline":
        case "mark-won":
        case "mark-lost":
          newAssigneeId = null;
          break;
        case "production-return-engineering":
        case "art-final-return-production":
        case "art-final-return-engineering":
          newAssigneeId =
            toStage === "engineering-review" ? eto.stickyEngineerUserId : null;
          break;
        case "reopen":
        case "mark-abandoned":
          // Keep the owner parked on the request so re-opening restores the
          // exact workflow assignment without introducing extra persistence.
          newAssigneeId = eto.assigneeId;
          break;
      }
    }

    if (!isMoreInfoLoop && (toStage === "engineering-review" || toStage === "production-review")) {
      const role = toStage === "engineering-review" ? "engineering" : "production";
      newAssigneeId ??= role === "engineering"
        ? reviewDefaults?.engineeringUserId ?? null
        : newProductionAssignee ?? reviewDefaults?.productionUserId ?? null;
      if (!newAssigneeId) {
        res.status(422).json({ error: `Configure a default ${role} reviewer in Admin > Assignment Defaults before entering ${toStage}` });
        return;
      }
      const [target] = await db.select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable).where(eq(usersTable.id, newAssigneeId)).limit(1);
      if (!target || target.role !== role) {
        res.status(422).json({ error: `Assigned reviewer must have the '${role}' role` });
        return;
      }
      if (role === "engineering" && (body.decision === "approve-engineering" || !newStickyEngineer)) {
        newStickyEngineer = newAssigneeId;
      }
      if (role === "production") {
        newProductionAssignee = newAssigneeId;
      }
    }

    // Commit the stage update, specialist output, and audit record atomically. The current-stage
    // predicate prevents a stale or duplicate action from overwriting a newer
    // transition that completed after this request read the ETO.
    const transitionApplied = await db.transaction(async (tx) => {
      const assignedNumber = body.decision === "submit" && eto.etoNumber === null
        ? await allocateEtoNumber(tx, new Date(), Boolean(res.locals.sharedEpoch)) : null;
      const updatedRows = await tx
        .update(etoRequestsTable)
        .set({
          ...(assignedNumber !== null ? { etoNumber: assignedNumber } : {}),
          ...schedule,
          entity: body.decision === "approve-engineering" && body.entity !== undefined
            ? body.entity : eto.entity,
          stage: toStage,
          includeEngineeringReview:
            body.decision === "approve-engineering"
              ? (body.includeEngineeringReview ?? true)
              : body.decision === "art-final-return-engineering"
                ? true
              : eto.includeEngineeringReview,
          includeProductionReview:
            body.decision === "approve-engineering"
              ? (body.includeProductionReview ?? true)
              : eto.includeProductionReview,
          assigneeId: newAssigneeId,
          productionAssigneeId: newProductionAssignee,
          stickyEngineerUserId: newStickyEngineer,
          declineReason: ["decline", "mark-lost"].includes(body.decision)
            ? (body.reason ?? null)
            : eto.declineReason,
          updatedAt: new Date(),
        })
        .where(and(
          eq(etoRequestsTable.id, id),
          eq(etoRequestsTable.stage, eto.stage),
          eq(etoRequestsTable.hasSplitChildren, false),
          // A stale submit must never replace a number already assigned,
          // even if the request has since been returned to Draft.
          ...(assignedNumber !== null ? [isNull(etoRequestsTable.etoNumber)] : []),
        ))
        .returning({ id: etoRequestsTable.id });

      if (updatedRows.length === 0) return false;

      if (body.decision === "approve-engineering" && body.entity !== undefined && body.entity !== eto.entity) {
        await tx.insert(detailChangesTable).values({
          etoRequestId: id,
          changedById: user.id,
          simulatedRole,
          section: "request",
          changes: [{ field: "Entity", oldValue: eto.entity, newValue: body.entity }],
        });
      }

      if (body.decision === "engineering-quote-ready") {
        const calculated = calculateDesignEstimate(body.engineeringEstimatedDesignHours!, await getDesignFormula());
        const risk = body.engineeringRiskScore === undefined ? {}
          : reviewRiskValues(body.engineeringRiskScore, body.engineeringRiskNotes);
        await tx
          .insert(engineeringOutputsTable)
          .values({
            etoRequestId: id,
            estimatedDesignHours: body.engineeringEstimatedDesignHours,
            ...risk,
            ...calculated,
            pnGuidance: body.engineeringPnGuidance ?? null,
            notes: body.engineeringNotes ?? null,
          })
          .onConflictDoUpdate({
            target: engineeringOutputsTable.etoRequestId,
            set: {
              estimatedDesignHours: body.engineeringEstimatedDesignHours,
              ...risk,
              ...calculated,
              pnGuidance: body.engineeringPnGuidance ?? null,
              notes: body.engineeringNotes ?? null,
              updatedAt: new Date(),
            },
          });
      }

      if (body.decision === "production-approve") {
        const calculated = calculateAssemblyEstimate(body.productionAssemblyTimeHours!, await getAssemblyFormula());
        const risk = body.productionRiskScore === undefined ? {}
          : reviewRiskValues(body.productionRiskScore, body.productionRiskNotes);
        await tx
          .insert(productionOutputsTable)
          .values({
            etoRequestId: id,
            procurementCost: body.productionProcurementCost,
            ...risk,
            procurementCostCurrency: body.productionProcurementCostCurrency ?? "USD",
            procurementLeadTime: body.productionProcurementLeadTime,
            assemblyTimeHours: body.productionAssemblyTimeHours,
            ...calculated,
            notes: body.productionNotes ?? null,
          })
          .onConflictDoUpdate({
            target: productionOutputsTable.etoRequestId,
            set: {
              procurementCost: body.productionProcurementCost,
              ...risk,
              procurementCostCurrency: body.productionProcurementCostCurrency ?? "USD",
              procurementLeadTime: body.productionProcurementLeadTime,
              assemblyTimeHours: body.productionAssemblyTimeHours,
              ...calculated,
              notes: body.productionNotes ?? null,
              updatedAt: new Date(),
            },
          });
      }

      if (body.decision === "art-final-quote") {
        const description = { quoteDescription: normalizeRequiredQuoteDescription(body.artQuoteDescription)! };
        await tx
          .insert(artFinalOutputsTable)
          .values({
            etoRequestId: id,
            marketPrice: body.artMarketPrice ?? null,
            marketPriceCurrency: body.artMarketPriceCurrency ?? "USD",
            marketLeadtime: body.artMarketLeadtime ?? null,
            ...description,
            notes: body.artNotes ?? null,
          })
          .onConflictDoUpdate({
            target: artFinalOutputsTable.etoRequestId,
            set: {
              marketPrice: body.artMarketPrice ?? null,
              marketPriceCurrency: body.artMarketPriceCurrency ?? "USD",
              marketLeadtime: body.artMarketLeadtime ?? null,
              ...description,
              notes: body.artNotes ?? null,
              updatedAt: new Date(),
            },
          });
      }

      await tx
        .insert(stageTransitionsTable)
        .values({
          etoRequestId: id,
          actorId: user.id,
          simulatedRole,
          fromStage: eto.stage,
          toStage,
          decision: body.decision,
          reason: body.reason ?? null,
          includeEngineeringReview:
            body.decision === "approve-engineering"
              ? (body.includeEngineeringReview ?? true)
              : null,
          includeProductionReview:
            body.decision === "approve-engineering"
              ? (body.includeProductionReview ?? true)
              : null,
        });

      return true;
    });

    if (!transitionApplied) {
      res.status(409).json({ error: "This request changed or has been split. Refresh and try again." });
      return;
    }

    // Return the updated EtoRequest so clients don't need a second round-trip
    const updated = await fetchEtoWithJoins(id);
    res.status(200).json(updated);

    // Fire-and-forget email notifications — errors must not affect the response
    if (updated) {
      void (async () => {
      // Fetch ART team emails for the "new submission" notification
      const artUsers = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.role, "art"));

      await sendTransitionEmails({
        etoId: updated.id,
        etoNumber: updated.etoNumber ?? `Draft #${updated.id}`,
        customerName: updated.customerName,
        fromStage: eto.stage,
        toStage,
        assigneeEmail: updated.assigneeEmail,
        assigneeName: updated.assigneeName,
        prevAssigneeEmail,
        artEmails: artUsers.map((u) => u.email),
        submitterEmail: updated.submittedByEmail,
        submitterName: updated.submittedByName,
        decision: body.decision,
        dueDate: updated.dueDate,
        quoteNumber: updated.quoteNumber,
        finalReview: body.decision === "art-final-quote" ? {
          price: body.artMarketPrice, currency: body.artMarketPriceCurrency ?? "USD",
          leadTime: body.artMarketLeadtime, description: body.artQuoteDescription?.trim(),
          notes: body.artNotes ?? null,
        } : undefined,
      });
      })().catch((err) => req.log.error({ err }, "Workflow email notification failed"));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("Role ") && msg.includes("not allowed")) {
      res.status(403).json({ error: msg });
      return;
    }
    if (msg.includes("not valid") || msg.includes("not allowed")) {
      res.status(422).json({ error: msg });
      return;
    }
    next(err);
  }
});

export default router;
