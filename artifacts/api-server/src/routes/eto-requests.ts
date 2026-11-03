import { Router } from "express";
import { sendReassignmentEmail } from "../lib/email";
import { isWholeBudget } from "../lib/money";
import { db } from "@workspace/db";
import {
  etoRequestsTable,
  usersTable,
  stageTransitionsTable,
  detailChangesTable,
  engineeringOutputsTable,
  productionOutputsTable,
  artFinalOutputsTable,
  commentsTable,
  attachmentsTable,
} from "@workspace/db/schema";
import { and, eq, desc, ilike, inArray, or, sql } from "drizzle-orm";

// ---- Overdue threshold constants (mirrors src/scripts/remind.ts) ----
const TERMINAL_STAGES = ["won", "declined", "lost", "closed", "abandoned"];
const ENGINEERING_STAGES = ["engineering-review"];
const THRESHOLD_DEFAULT_DAYS = 3;
const THRESHOLD_ENGINEERING_DAYS = 5;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isOverdue(stage: string, updatedAt: string | Date): boolean {
  if (TERMINAL_STAGES.includes(stage)) return false;
  const thresholdDays = ENGINEERING_STAGES.includes(stage)
    ? THRESHOLD_ENGINEERING_DAYS
    : THRESHOLD_DEFAULT_DAYS;
  const msInactive = Date.now() - new Date(updatedAt).getTime();
  return msInactive >= thresholdDays * MS_PER_DAY;
}
import { requireAuth } from "../middlewares/requireAuth";
import { CreateEtoRequestBody, SplitEtoRequestBody, ReassignEtoReviewBody } from "@workspace/api-zod";
import type { User } from "@workspace/db";
import { hasRole } from "../lib/roles";
import { parseIntParam } from "../lib/params";
import { ObjectStorageService } from "../lib/objectStorage";
import { getSplitFamilyMetadata } from "../lib/splitFamily";
import { withArchiveMetadata } from "../lib/shared-merge/database";

const router = Router();
const objectStorageService = new ObjectStorageService();

// ---------- helpers ----------

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

async function fetchEtoWithJoins(id: number, epoch: string | null = null) {
  const rows = await db
    .select({
      r: etoRequestsTable,
      effectiveStage: effectiveStageSql,
      assigneeName: sql<string | null>`a.name`,
      assigneeRole: sql<string | null>`a.role`,
      stickyEngineerName: sql<string | null>`se.name`,
      submittedByName: sql<string>`sb.name`,
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
  const { r, effectiveStage, assigneeName, assigneeRole, stickyEngineerName, submittedByName, parentEtoNumber } = rows[0];
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

  const [result] = await withArchiveMetadata([{
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
    assigneeId: r.assigneeId,
    assigneeName,
    assigneeRole,
    stickyEngineerUserId: r.stickyEngineerUserId,
    stickyEngineerName,
    submittedById: r.submittedById,
    submittedByName,
    parentEtoRequestId: r.parentEtoRequestId,
    parentEtoNumber,
    splitSequence: r.splitSequence,
    ...splitFamily,
    splitChildren: await withArchiveMetadata(splitChildren, epoch),
    declineReason: r.declineReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    overdue: isOverdue(effectiveStage, r.updatedAt),
  }], epoch);
  return result;
}

// ---------- routes ----------

/** GET /api/eto-requests — paginated + filterable */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const stage = typeof req.query.stage === "string" ? req.query.stage.trim() : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const rawAssigneeId = typeof req.query.assigneeId === "string" ? parseInt(req.query.assigneeId, 10) : undefined;
    const assigneeId = rawAssigneeId && !isNaN(rawAssigneeId) ? rawAssigneeId : undefined;
    const overdueOnly = req.query.overdue === "true";
    const rawSplitFamilyId = typeof req.query.splitFamilyId === "string"
      ? parseInt(req.query.splitFamilyId, 10)
      : undefined;
    const splitFamilyId = rawSplitFamilyId && !isNaN(rawSplitFamilyId)
      ? rawSplitFamilyId
      : undefined;
    const splitOnly = req.query.splitOnly === "true";
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const offset = (page - 1) * limit;
    const epoch = res.locals.sharedEpoch as string | null;
    const archive = req.query.archive ?? "active";
    if (!["active", "archived", "all"].includes(String(archive))) {
      res.status(400).json({ error: "Invalid archive filter" }); return;
    }
    const archiveClause = epoch && archive !== "all"
      ? sql`is_archived = ${archive === "archived"}`
      : !epoch && archive === "archived" ? sql`false` : null;

    // Build a single WHERE predicate applied identically to count + paginated query.
    // All filtering happens at the database level — no post-fetch JS filtering.
    //
    // Overdue SQL: excludes terminal stages AND requires inactivity past the
    // per-stage threshold (engineering-review = 5 days, all others = 3 days).
    // This mirrors the constants in src/scripts/remind.ts exactly.
    const overdueClause = overdueOnly
      ? sql`(
          ${etoRequestsTable.stage} NOT IN ('won', 'declined', 'lost', 'closed', 'abandoned')
          AND (
            CASE
              WHEN ${etoRequestsTable.stage} = 'engineering-review'
              THEN ${etoRequestsTable.updatedAt} <= now() - interval '5 days'
              ELSE ${etoRequestsTable.updatedAt} <= now() - interval '3 days'
            END
          )
        )`
      : null;

    const stageClause = stage === "lost"
      ? sql`${effectiveStageSql} = 'lost'`
      : stage === "declined"
        ? sql`${effectiveStageSql} = 'declined'`
        : stage
          ? eq(etoRequestsTable.stage, stage)
          : null;

    const splitFamilyClause = splitFamilyId
      ? sql`(
          ${etoRequestsTable.id} = ${splitFamilyId}
          OR ${etoRequestsTable.parentEtoRequestId} = ${splitFamilyId}
        )`
      : null;
    const splitOnlyClause = splitOnly
      ? sql`(
          ${etoRequestsTable.parentEtoRequestId} IS NOT NULL
          OR ${etoRequestsTable.hasSplitChildren} = true
        )`
      : null;

    const searchPattern = search ? `%${search}%` : null;
    const relatedSearchClause = searchPattern
      ? sql`(
          EXISTS (
            SELECT 1
            FROM ${usersTable} request_user
            WHERE request_user.id IN (
              ${etoRequestsTable.assigneeId},
              ${etoRequestsTable.stickyEngineerUserId},
              ${etoRequestsTable.submittedById}
            )
            AND (
              request_user.name ILIKE ${searchPattern}
              OR request_user.email ILIKE ${searchPattern}
              OR request_user.role ILIKE ${searchPattern}
            )
          )
          OR EXISTS (
            SELECT 1 FROM ${engineeringOutputsTable} eo
            WHERE eo.eto_request_id = ${etoRequestsTable.id}
              AND concat_ws(' ', eo.cost_estimate, eo.cost_estimate_currency, eo.doc_leadtime, eo.pn_guidance, eo.notes)
                  ILIKE ${searchPattern}
          )
          OR EXISTS (
            SELECT 1 FROM ${productionOutputsTable} po
            WHERE po.eto_request_id = ${etoRequestsTable.id}
              AND concat_ws(' ', po.mfg_leadtime, po.prod_leadtime, po.notes) ILIKE ${searchPattern}
          )
          OR EXISTS (
            SELECT 1 FROM ${artFinalOutputsTable} afo
            WHERE afo.eto_request_id = ${etoRequestsTable.id}
              AND concat_ws(' ', afo.market_price, afo.market_price_currency, afo.market_leadtime, afo.notes)
                  ILIKE ${searchPattern}
          )
          OR EXISTS (
            SELECT 1
            FROM ${commentsTable} c
            JOIN ${usersTable} comment_user ON comment_user.id = c.author_id
            WHERE c.eto_request_id = ${etoRequestsTable.id}
              AND concat_ws(' ', c.body, comment_user.name, comment_user.email, comment_user.role)
                  ILIKE ${searchPattern}
          )
          OR EXISTS (
            SELECT 1
            FROM ${attachmentsTable} att
            JOIN ${usersTable} attachment_user ON attachment_user.id = att.uploader_id
            WHERE att.eto_request_id = ${etoRequestsTable.id}
              AND concat_ws(
                ' ',
                att.filename,
                att.content_type,
                att.search_text,
                attachment_user.name,
                attachment_user.email,
                attachment_user.role
              ) ILIKE ${searchPattern}
          )
          OR EXISTS (
            SELECT 1
            FROM ${stageTransitionsTable} st
            JOIN ${usersTable} transition_user ON transition_user.id = st.actor_id
            WHERE st.eto_request_id = ${etoRequestsTable.id}
              AND concat_ws(
                ' ',
                st.from_stage,
                st.to_stage,
                st.decision,
                st.reason,
                transition_user.name,
                transition_user.email,
                transition_user.role
              ) ILIKE ${searchPattern}
          )
          OR EXISTS (
            SELECT 1
            FROM ${detailChangesTable} dc
            JOIN ${usersTable} change_user ON change_user.id = dc.changed_by_id
            WHERE dc.eto_request_id = ${etoRequestsTable.id}
              AND concat_ws(
                ' ',
                dc.section,
                dc.changes::text,
                change_user.name,
                change_user.email,
                change_user.role
              ) ILIKE ${searchPattern}
          )
        )`
      : null;

    const standardClauses = [
      archiveClause,
      stageClause,
      assigneeId ? eq(etoRequestsTable.assigneeId, assigneeId) : null,
      searchPattern
        ? or(
            ilike(etoRequestsTable.customerName, searchPattern),
            ilike(etoRequestsTable.etoNumber, searchPattern),
            ilike(etoRequestsTable.quoteNumber, searchPattern),
            ilike(etoRequestsTable.quoteRevision, searchPattern),
            ilike(etoRequestsTable.testType, searchPattern),
            ilike(etoRequestsTable.distributor, searchPattern),
            ilike(etoRequestsTable.requestType, searchPattern),
            ilike(etoRequestsTable.machineType, searchPattern),
            ilike(etoRequestsTable.expectedForceRange, searchPattern),
            ilike(etoRequestsTable.expectedDisplacement, searchPattern),
            ilike(etoRequestsTable.resultsRequired, searchPattern),
            ilike(etoRequestsTable.budgetRange, searchPattern),
            ilike(etoRequestsTable.budgetCurrency, searchPattern),
            ilike(etoRequestsTable.acceptableLeadTime, searchPattern),
            ilike(etoRequestsTable.similarParts, searchPattern),
            ilike(etoRequestsTable.materials, searchPattern),
            ilike(etoRequestsTable.specimenDimensions, searchPattern),
            ilike(etoRequestsTable.relevantStandards, searchPattern),
            ilike(etoRequestsTable.customerComponents, searchPattern),
            ilike(etoRequestsTable.customDetails, searchPattern),
            ilike(etoRequestsTable.stage, searchPattern),
            ilike(etoRequestsTable.declineReason, searchPattern),
            relatedSearchClause ?? undefined,
          )
        : null,
      overdueClause,
      splitFamilyClause,
      splitOnlyClause,
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    // A direct family view is authoritative: always return the complete family,
    // even if the URL also contains stale search, stage, assignee, or overdue filters.
    const clauses = splitFamilyId && splitFamilyClause
      ? [splitFamilyClause, ...(archiveClause ? [archiveClause] : [])]
      : standardClauses;

    const where = clauses.length > 0 ? and(...clauses) : undefined;
    const familyKey = sql<number>`COALESCE(
      ${etoRequestsTable.parentEtoRequestId},
      ${etoRequestsTable.id}
    )`;

    const familyCreatedAt = sql<Date>`COALESCE(
      (
        SELECT parent.created_at
        FROM ${etoRequestsTable} parent
        WHERE parent.id = ${etoRequestsTable.parentEtoRequestId}
      ),
      ${etoRequestsTable.createdAt}
    )`;
    const matchingFamilies = db
      .select({
        familyId: familyKey.as("family_id"),
        familyCreatedAt: sql<Date>`MAX(${familyCreatedAt})`.as("family_created_at"),
      })
      .from(etoRequestsTable)
      .where(where)
      .groupBy(familyKey)
      .as("matching_families");
    const matchingFamilyIds = db
      .select({ familyId: matchingFamilies.familyId })
      .from(matchingFamilies);

    // Filters select families, not individual rows. Counts and page contents
    // then expand every selected family so stage/search/queue filters cannot
    // strand a parent or sibling.
    const [[{ totalGroups }], [{ total }]] = await Promise.all([
      db
        .select({ totalGroups: sql<number>`count(*)::int` })
        .from(matchingFamilies),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(etoRequestsTable)
        .where(and(inArray(familyKey, matchingFamilyIds), archiveClause ?? undefined)),
    ]);

    // Page by family keys first so every member of a matching family stays on
    // the same page. "limit" is the number of list groups per page.
    const familyPage = await db
      .select()
      .from(matchingFamilies)
      .orderBy(
        desc(matchingFamilies.familyCreatedAt),
        desc(matchingFamilies.familyId),
      )
      .limit(limit)
      .offset(offset);
    const familyIds = familyPage.map((family) => family.familyId);

    const rows = familyIds.length === 0
      ? []
      : await db
        .select({
          r: etoRequestsTable,
          effectiveStage: effectiveStageSql,
          assigneeName: sql<string | null>`a.name`,
          assigneeRole: sql<string | null>`a.role`,
          stickyEngineerName: sql<string | null>`se.name`,
          submittedByName: sql<string>`sb.name`,
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
        .where(and(inArray(familyKey, familyIds), archiveClause ?? undefined))
        .orderBy(
          desc(familyCreatedAt),
          desc(familyKey),
          sql`CASE WHEN ${etoRequestsTable.parentEtoRequestId} IS NULL THEN 0 ELSE ${etoRequestsTable.splitSequence} END`,
          desc(etoRequestsTable.id),
        );

    const items = rows.map(({ r, effectiveStage, assigneeName, assigneeRole, stickyEngineerName, submittedByName, parentEtoNumber }) => ({
      ...getSplitFamilyMetadata(r, parentEtoNumber),
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
      assigneeId: r.assigneeId,
      assigneeName,
      assigneeRole,
      stickyEngineerUserId: r.stickyEngineerUserId,
      stickyEngineerName,
      submittedById: r.submittedById,
      submittedByName,
      parentEtoRequestId: r.parentEtoRequestId,
      parentEtoNumber,
      splitSequence: r.splitSequence,
      declineReason: r.declineReason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      overdue: isOverdue(effectiveStage, r.updatedAt),
    }));

    res.json({ items: await withArchiveMetadata(items, epoch), total, totalGroups, page, limit, migrationEpoch: epoch });
  } catch (err) {
    next(err);
  }
});

/** POST /api/eto-requests — Sales only */
router.post("/", requireAuth, async (req, res, next) => {
  const user = res.locals.dbUser as User;
  const simulatedRole = (res.locals.simulatedRole as string | null | undefined) ?? null;

  if (!hasRole(user, "sales")) {
    res.status(403).json({ error: "Only users with the 'sales' role may create ETO requests" });
    return;
  }

  const parsed = CreateEtoRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  if (!isWholeBudget(parsed.data.budgetRange)) {
    res.status(422).json({ error: "Budget Range must contain whole-number amounts (for example, 1000 - 2000)" });
    return;
  }

  try {
    const eto = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(etoRequestsTable)
        .values({
          ...parsed.data,
          quoteRevision: parsed.data.quoteRevision ?? "",
          testType: "",
          etoNumber: null,
          submittedById: user.id,
          stage: "draft",
        })
        .returning();

      await tx.insert(stageTransitionsTable).values({
        etoRequestId: created.id,
        actorId: user.id,
        simulatedRole,
        fromStage: "draft",
        toStage: "draft",
        decision: "submit",
        createdAt: created.createdAt,
      });

      return created;
    });

    const result = await fetchEtoWithJoins(eto.id, res.locals.sharedEpoch ?? null);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/eto-requests/:id/split — ART and SuperUser only */
router.post("/:id/split", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const user = res.locals.dbUser as User;
  const simulatedRole = (res.locals.simulatedRole as string | null | undefined) ?? null;
  if (!hasRole(user, "art")) {
    res.status(403).json({ error: "Only ART or SuperUser may split ETO requests" });
    return;
  }

  const parsed = SplitEtoRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const copiedStorageKeys: string[] = [];
  let splitCommitted = false;

  try {
    const outcome = await db.transaction(async (tx) => {
      // Serialize splits and block stage transitions while this split is being
      // assembled. The row lock is released automatically at transaction end.
      await tx.execute(sql`SELECT id FROM ${etoRequestsTable} WHERE id = ${id} FOR UPDATE`);

      const [source] = await tx
        .select()
        .from(etoRequestsTable)
        .where(eq(etoRequestsTable.id, id))
        .limit(1);

      if (!source) return { kind: "not-found" as const };
      if (source.stage !== "art-review") return { kind: "invalid-stage" as const };
      if (!source.etoNumber) return { kind: "unnumbered" as const };
      if (source.parentEtoRequestId !== null) return { kind: "child-request" as const };
      if (source.hasSplitChildren) return { kind: "already-split" as const };

      const existingChildren = await tx
        .select({ id: etoRequestsTable.id })
        .from(etoRequestsTable)
        .where(eq(etoRequestsTable.parentEtoRequestId, id))
        .limit(1);
      if (existingChildren.length > 0) return { kind: "already-split" as const };

      const markedParents = await tx
        .update(etoRequestsTable)
        .set({ hasSplitChildren: true })
        .where(and(
          eq(etoRequestsTable.id, id),
          eq(etoRequestsTable.stage, "art-review"),
          eq(etoRequestsTable.hasSplitChildren, false),
        ))
        .returning({ id: etoRequestsTable.id });
      if (markedParents.length === 0) return { kind: "already-split" as const };

      const sourceAttachments = await tx
        .select()
        .from(attachmentsTable)
        .where(eq(attachmentsTable.etoRequestId, id));

      const childRows: Array<typeof etoRequestsTable.$inferSelect> = [];

      for (let sequence = 1; sequence <= parsed.data.count; sequence++) {
        const etoNumber = `${source.etoNumber}-${String(sequence).padStart(2, "0")}`;
        const [child] = await tx
          .insert(etoRequestsTable)
          .values({
            etoNumber,
            customerName: source.customerName,
            quoteNumber: source.quoteNumber,
            quoteRevision: source.quoteRevision,
            testType: source.testType,
            distributor: source.distributor,
            requestType: source.requestType,
            machineType: source.machineType,
            expectedForceRange: source.expectedForceRange,
            expectedForceUnit: source.expectedForceUnit,
            expectedDisplacement: source.expectedDisplacement,
            expectedDisplacementUnit: source.expectedDisplacementUnit,
            resultsRequired: source.resultsRequired,
            budgetRange: source.budgetRange,
            budgetCurrency: source.budgetCurrency,
            entity: source.entity,
            acceptableLeadTime: source.acceptableLeadTime,
            similarParts: source.similarParts,
            materials: source.materials,
            specimenDimensions: source.specimenDimensions,
            relevantStandards: source.relevantStandards,
            customerComponents: source.customerComponents,
            customDetails: source.customDetails,
            stage: "art-review",
            includeEngineeringReview: source.includeEngineeringReview,
            includeProductionReview: source.includeProductionReview,
            assigneeId: null,
            stickyEngineerUserId: null,
            submittedById: source.submittedById,
            parentEtoRequestId: source.id,
            splitSequence: sequence,
          })
          .returning();

        childRows.push(child);

        for (const attachment of sourceAttachments) {
          const storageKey = await objectStorageService.copyObjectEntity(attachment.storageKey);
          copiedStorageKeys.push(storageKey);
          await tx.insert(attachmentsTable).values({
            etoRequestId: child.id,
            uploaderId: attachment.uploaderId,
            filename: attachment.filename,
            storageKey,
            contentType: attachment.contentType,
            fileSize: attachment.fileSize,
            searchText: attachment.searchText,
            searchStatus: attachment.searchStatus,
            searchError: attachment.searchError,
            searchAttempts: attachment.searchAttempts,
            searchProcessedAt: attachment.searchProcessedAt,
          });
        }

        await tx.insert(stageTransitionsTable).values({
          etoRequestId: child.id,
          actorId: user.id,
          simulatedRole,
          fromStage: "art-review",
          toStage: "art-review",
          decision: "split-request",
          reason: `Created from split of ${source.etoNumber}`,
        });
      }

      const childNumbers = childRows.map((child) => child.etoNumber);
      await tx.insert(stageTransitionsTable).values({
        etoRequestId: source.id,
        actorId: user.id,
        simulatedRole,
        fromStage: "art-review",
        toStage: "art-review",
        decision: "split-request",
        reason: `Split into ${childNumbers.join(", ")}`,
      });

      return {
        kind: "created" as const,
        childIds: childRows.map((child) => child.id),
      };
    });

    if (outcome.kind === "not-found") {
      res.status(404).json({ error: "ETO request not found" });
      return;
    }
    if (outcome.kind === "invalid-stage") {
      res.status(422).json({ error: "Only requests in ART Review can be split" });
      return;
    }
    if (outcome.kind === "unnumbered") {
      res.status(422).json({ error: "An ETO number must be assigned before splitting a request" });
      return;
    }
    if (outcome.kind === "child-request") {
      res.status(422).json({ error: "A split child cannot be split again" });
      return;
    }
    if (outcome.kind === "already-split") {
      res.status(409).json({ error: "This request has already been split" });
      return;
    }

    splitCommitted = true;
    const original = await fetchEtoWithJoins(id, res.locals.sharedEpoch ?? null);
    const children = await Promise.all(outcome.childIds.map(childId => fetchEtoWithJoins(childId, res.locals.sharedEpoch ?? null)));
    res.status(201).json({
      original,
      children: children.filter((child): child is NonNullable<typeof child> => child !== null),
    });
  } catch (err) {
    if (!splitCommitted) {
      await Promise.allSettled(
        copiedStorageKeys.map(async (storageKey) => {
          try {
            await objectStorageService.deleteObjectEntity(storageKey);
          } catch (cleanupError) {
            req.log.error({ err: cleanupError, storageKey }, "Failed to clean up copied split attachment");
          }
        }),
      );
    }

    const pgCode = typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
    if (pgCode === "23505") {
      res.status(409).json({ error: "A split was created concurrently. Refresh and try again." });
      return;
    }
    next(err);
  }
});

/** GET /api/eto-requests/:id */
router.get("/:id", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await fetchEtoWithJoins(id, res.locals.sharedEpoch ?? null);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/eto-requests/:id/reassign — assignment only; never a stage transition. */
router.post("/:id/reassign", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const parsed = ReassignEtoReviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Choose a department reviewer and reopen the form if the request has changed" }); return;
  }
  const body = parsed.data;
  const department = body.expectedStage === "engineering-review" ? "engineering" : "production";
  const user = res.locals.dbUser as User;
  if (!hasRole(user, department)) {
    res.status(403).json({ error: "Only the reviewing department or SuperUser may reassign this review" }); return;
  }
  try {
    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(etoRequestsTable)
        .where(eq(etoRequestsTable.id, id)).limit(1).for("update");
      if (!current) return { status: 404, error: "Request not found" } as const;
      if (current.stage !== body.expectedStage || current.assigneeId !== body.expectedAssigneeId) {
        return { status: 409, error: "The stage or assignee changed. Reopen Re-Assign and try again." } as const;
      }
      const [selected] = await tx.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable)
        .where(and(eq(usersTable.id, body.assigneeId), eq(usersTable.role, department)))
        .limit(1).for("share");
      if (!selected) {
        return { status: 422, error: `Select a user in the ${department} department` } as const;
      }
      let updatedAt = current.updatedAt;
      if (current.assigneeId !== selected.id) {
        const [oldUser] = current.assigneeId === null ? [] : await tx.select({ name: usersTable.name })
          .from(usersTable).where(eq(usersTable.id, current.assigneeId)).limit(1);
        updatedAt = new Date();
        await tx.update(etoRequestsTable).set({
          assigneeId: selected.id,
          ...(department === "engineering"
            ? { stickyEngineerUserId: selected.id }
            : { productionAssigneeId: selected.id }),
          updatedAt,
        }).where(eq(etoRequestsTable.id, id));
        await tx.insert(detailChangesTable).values({
          etoRequestId: id,
          section: "request",
          changedById: user.id,
          simulatedRole: res.locals.simulatedRole ?? null,
          changes: [{
            field: department === "engineering" ? "Assigned Engineer" : "Assigned Production",
            oldValue: oldUser?.name ?? null,
            newValue: selected.name,
          }],
        });
      }
      return { status: 200, notification: current.assigneeId !== selected.id ? {
        etoId: id, etoNumber: current.etoNumber ?? `Draft #${id}`, department,
        email: selected.email,
      } as const : null, assignment: {
        id, stage: body.expectedStage, assigneeId: selected.id,
        assigneeName: selected.name, department, updatedAt: updatedAt.toISOString(),
      } } as const;
    });
    if ("error" in outcome) {
      res.status(outcome.status).json({ error: outcome.error }); return;
    }
    res.json(outcome.assignment);
    if (outcome.notification) {
      sendReassignmentEmail(outcome.notification)
        .catch((err) => req.log.error({ err }, "Reassignment email notification failed"));
    }
  } catch (err) { next(err); }
});

/** PATCH /api/eto-requests/:id — update request details (ART, SuperUser) */
router.patch("/:id", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = res.locals.dbUser as User;
  const simulatedRole = (res.locals.simulatedRole as string | null | undefined) ?? null;
  if (!hasRole(user, "art")) {
    res.status(403).json({ error: "Only ART or SuperUser may edit request details" });
    return;
  }

  const { assigneeId } = req.body as { assigneeId?: unknown };
  const {
    customerName, quoteNumber, quoteRevision,
    distributor, requestType, machineType,
    expectedForceRange, expectedForceUnit,
    expectedDisplacement, expectedDisplacementUnit,
    materials, specimenDimensions, resultsRequired,
    customDetails, relevantStandards,
    budgetRange, budgetCurrency, acceptableLeadTime, similarParts,
  } = req.body as Record<string, string | null | undefined>;

  if (!isWholeBudget(budgetRange)) {
    res.status(422).json({ error: "Budget Range must contain whole-number amounts (for example, 1000 - 2000)" });
    return;
  }
  try {
    const existing = await fetchEtoWithJoins(id, res.locals.sharedEpoch ?? null);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    let assigneeUpdate:
      | { id: number | null; oldName: string | null; newName: string | null }
      | undefined;
    if (assigneeId !== undefined) {
      if (existing.stage !== "engineering-review") {
        res.status(422).json({
          error: "The Engineer assignment can only be changed during Engineering Review",
        });
        return;
      }
      if (assigneeId !== null && (typeof assigneeId !== "number" || !Number.isInteger(assigneeId) || assigneeId <= 0)) {
        res.status(422).json({ error: "assigneeId must be a valid user id or null" });
        return;
      }
      const normalizedAssigneeId = assigneeId as number | null;

      const selectedEngineer = normalizedAssigneeId === null
        ? null
        : (await db
            .select({ id: usersTable.id, name: usersTable.name })
            .from(usersTable)
            .where(and(
              eq(usersTable.id, normalizedAssigneeId),
              eq(usersTable.role, "engineering"),
            ))
            .limit(1))[0];

      if (normalizedAssigneeId !== null && !selectedEngineer) {
        res.status(422).json({ error: "The selected assignee must have the Engineering role" });
        return;
      }

      if (existing.assigneeId !== normalizedAssigneeId) {
        assigneeUpdate = {
          id: normalizedAssigneeId,
          oldName: existing.assigneeName ?? null,
          newName: selectedEngineer?.name ?? null,
        };
      }
    }

    const fieldDefs: Array<{ key: keyof typeof existing; col: string; value: string | null | undefined }> = [
      { key: "customerName", col: "Customer Name", value: customerName },
      { key: "quoteNumber", col: "Quote Number", value: quoteNumber },
      { key: "quoteRevision", col: "Quote Revision", value: quoteRevision },
      { key: "distributor", col: "Distributor", value: distributor },
      { key: "requestType", col: "Request Type", value: requestType },
      { key: "machineType", col: "Machine Type", value: machineType },
      { key: "expectedForceRange", col: "Expected Force Range", value: expectedForceRange },
      { key: "expectedForceUnit", col: "Expected Force Unit", value: expectedForceUnit },
      { key: "expectedDisplacement", col: "Expected Displacement", value: expectedDisplacement },
      { key: "expectedDisplacementUnit", col: "Expected Displacement Unit", value: expectedDisplacementUnit },
      { key: "materials", col: "Materials to be Tested", value: materials },
      { key: "specimenDimensions", col: "Specimen Dimensions", value: specimenDimensions },
      { key: "resultsRequired", col: "Results Required", value: resultsRequired },
      { key: "customDetails", col: "Custom Requests", value: customDetails },
      { key: "relevantStandards", col: "Relevant Standard", value: relevantStandards },
      { key: "budgetRange", col: "Budget Range", value: budgetRange },
      { key: "budgetCurrency", col: "Budget Currency", value: budgetCurrency },
      { key: "acceptableLeadTime", col: "Acceptable Lead Time", value: acceptableLeadTime },
      { key: "similarParts", col: "Similar Parts/Machines", value: similarParts },
    ];

    const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    const updates: Partial<typeof etoRequestsTable.$inferInsert> = {};

    if (assigneeUpdate) {
      updates.assigneeId = assigneeUpdate.id;
      // Production returns work to this Engineer, so an explicit reassignment
      // must update the sticky Engineer at the same time.
      updates.stickyEngineerUserId = assigneeUpdate.id;
      changes.push({
        field: "Assigned Engineer",
        oldValue: assigneeUpdate.oldName,
        newValue: assigneeUpdate.newName,
      });
    }

    for (const { key, col, value } of fieldDefs) {
      if (value === undefined) continue;
      const oldVal = existing[key] as string | null;
      const newVal = value ?? null;
      if (oldVal !== newVal) {
        changes.push({ field: col, oldValue: oldVal, newValue: newVal });
        (updates as Record<string, unknown>)[key] = newVal;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.transaction(async (tx) => {
        const updatedRows = await tx
          .update(etoRequestsTable)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(etoRequestsTable.id, id))
          .returning({ id: etoRequestsTable.id });

        if (updatedRows.length === 0) {
          throw new Error(`ETO request ${id} was not found while saving details`);
        }

        if (changes.length > 0) {
          await tx.insert(detailChangesTable).values({
            etoRequestId: id,
            section: "request",
            changedById: user.id,
            simulatedRole,
            changes,
          });
        }
      });
    }

    const result = await fetchEtoWithJoins(id, res.locals.sharedEpoch ?? null);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
