import { Router } from "express";
import { isWholeMoney } from "../lib/money";
import { db } from "@workspace/db";
import {
  engineeringOutputsTable,
  productionOutputsTable,
  artFinalOutputsTable,
  detailChangesTable,
  usersTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { parseIntParam } from "../lib/params";
import { normalizeRequiredQuoteDescription } from "../lib/quote-description";
import { hasRole } from "../lib/roles";
import { calculateDesignEstimate, DEFAULT_DESIGN_FORMULA, getDesignFormula } from "../lib/design-formula";
import { calculateAssemblyEstimate, DEFAULT_ASSEMBLY_FORMULA, getAssemblyFormula } from "../lib/assembly-formula";
import type { User } from "@workspace/db";
import { validateReviewRisk, reviewRiskValues } from "../lib/review-risk";

const router = Router({ mergeParams: true });

// ─── Helpers ────────────────────────────────────────────────────────────────

function nullify(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  return String(v);
}

function isNonNegativeNumber(value: string | null): boolean {
  return value === null || (!!value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0);
}

// ─── Engineering Output ──────────────────────────────────────────────────────

/** GET /api/eto-requests/:id/engineering-output */
router.get("/engineering-output", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [row] = await db
      .select()
      .from(engineeringOutputsTable)
      .where(eq(engineeringOutputsTable.etoRequestId, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "No engineering output found" }); return; }

    res.json({
      id: row.id,
      etoRequestId: row.etoRequestId,
      costEstimate: row.costEstimate,
      costEstimateCurrency: row.costEstimateCurrency,
      docLeadtime: row.docLeadtime,
      estimatedDesignHours: row.estimatedDesignHours,
      designCost: row.designCost,
      designLeadTimeWeeks: row.designLeadTimeWeeks,
      pnGuidance: row.pnGuidance,
      riskScore: row.riskScore,
      riskNotes: row.riskNotes,
      notes: row.notes,
      createdAt: row.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/eto-requests/:id/engineering-output — Engineering, ART, SuperUser */
router.put("/engineering-output", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = res.locals.dbUser as User;
  const simulatedRole = (res.locals.simulatedRole as string | null | undefined) ?? null;
  if (!hasRole(user, "engineering") && !hasRole(user, "art")) {
    res.status(403).json({ error: "Only Engineering, ART, or SuperUser may update engineering output" });
    return;
  }

  const estimatedDesignHours = nullify(req.body.estimatedDesignHours);
  if (estimatedDesignHours !== null &&
      (!Number.isFinite(Number(estimatedDesignHours)) || Number(estimatedDesignHours) <= 0 || Number(estimatedDesignHours) > 1_000_000)) {
    res.status(400).json({ error: "Estimated Design hours must be greater than 0 and at most 1,000,000" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(engineeringOutputsTable)
      .where(eq(engineeringOutputsTable.etoRequestId, id))
      .limit(1);

    if (existing?.estimatedDesignHours && estimatedDesignHours === null) {
      res.status(400).json({ error: "Estimated Design hours cannot be cleared once recorded" });
      return;
    }
    const riskScore = req.body.riskScore === undefined ? existing?.riskScore ?? null : req.body.riskScore;
    const riskNotes = req.body.riskNotes === undefined ? existing?.riskNotes ?? null : req.body.riskNotes;
    const riskError = validateReviewRisk(riskScore, riskNotes);
    if (riskError) { res.status(400).json({ error: riskError }); return; }

    const hoursChanged = existing?.estimatedDesignHours !== estimatedDesignHours;
    const formula = hoursChanged && estimatedDesignHours !== null
      ? existing?.designHourlyRate && existing.designHoursPerWeek && existing.designCapacityFactor
        ? {
            hourlyRate: existing.designHourlyRate,
            hoursPerWeek: existing.designHoursPerWeek,
            capacityFactor: existing.designCapacityFactor,
          }
        : existing?.estimatedDesignHours
          ? DEFAULT_DESIGN_FORMULA
          : await getDesignFormula()
      : null;
    const calculated = formula && estimatedDesignHours !== null
      ? calculateDesignEstimate(estimatedDesignHours, formula)
      : {};
    if (!isWholeMoney(req.body.costEstimate, true)) {
      res.status(400).json({ error: "Cost Estimate must be a non-negative whole-number amount" });
      return;
    }
    const incoming = {
      costEstimate: nullify(req.body.costEstimate),
      costEstimateCurrency: req.body.costEstimateCurrency ?? "USD",
      docLeadtime: nullify(req.body.docLeadtime),
      estimatedDesignHours,
      ...reviewRiskValues(riskScore, riskNotes),
      ...calculated,
      pnGuidance: nullify(req.body.pnGuidance),
      notes: nullify(req.body.notes),
    };

    const fieldLabels: Record<string, string> = {
      costEstimate: "Cost Estimate",
      costEstimateCurrency: "Cost Estimate Currency",
      docLeadtime: "Doc Lead Time",
      estimatedDesignHours: "Estimated Design hours",
      ...(formula ? { designCost: "Design Cost", designLeadTimeWeeks: "Design Lead Time (weeks)" } : {}),
      pnGuidance: "P/N Guidance",
      riskScore: "Risk Score",
      riskNotes: "Risk Notes",
      notes: "Notes",
    };

    let changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    if (existing) {
      for (const [k, label] of Object.entries(fieldLabels)) {
        const oldVal = (existing as unknown as Record<string, string | null>)[k] ?? null;
        const newVal = (incoming as unknown as Record<string, string | null>)[k] ?? null;
        if (oldVal !== newVal) changes.push({ field: label, oldValue: oldVal, newValue: newVal });
      }
    }

    const [row] = await db
      .insert(engineeringOutputsTable)
      .values({ etoRequestId: id, ...incoming })
      .onConflictDoUpdate({
        target: engineeringOutputsTable.etoRequestId,
        set: { ...incoming, updatedAt: new Date() },
      })
      .returning();

    if (changes.length > 0) {
      await db.insert(detailChangesTable).values({
        etoRequestId: id,
        section: "engineering",
        changedById: user.id,
        simulatedRole,
        changes,
      });
    }

    res.json({
      id: row.id,
      etoRequestId: row.etoRequestId,
      costEstimate: row.costEstimate,
      costEstimateCurrency: row.costEstimateCurrency,
      docLeadtime: row.docLeadtime,
      estimatedDesignHours: row.estimatedDesignHours,
      designCost: row.designCost,
      designLeadTimeWeeks: row.designLeadTimeWeeks,
      pnGuidance: row.pnGuidance,
      riskScore: row.riskScore,
      riskNotes: row.riskNotes,
      notes: row.notes,
      createdAt: row.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Production Output ───────────────────────────────────────────────────────

/** GET /api/eto-requests/:id/production-output */
router.get("/production-output", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [row] = await db
      .select()
      .from(productionOutputsTable)
      .where(eq(productionOutputsTable.etoRequestId, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "No production output found" }); return; }

    res.json({
      id: row.id,
      etoRequestId: row.etoRequestId,
      mfgLeadtime: row.mfgLeadtime,
      prodLeadtime: row.prodLeadtime,
      procurementCost: row.procurementCost,
      procurementCostCurrency: row.procurementCostCurrency,
      procurementLeadTime: row.procurementLeadTime,
      assemblyTimeHours: row.assemblyTimeHours,
      assemblyCost: row.assemblyCost,
      assemblyCostCurrency: row.assemblyCostCurrency,
      assemblyLeadTimeWeeks: row.assemblyLeadTimeWeeks,
      riskScore: row.riskScore,
      riskNotes: row.riskNotes,
      notes: row.notes,
      createdAt: row.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/eto-requests/:id/production-output — Production, ART, SuperUser */
router.put("/production-output", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = res.locals.dbUser as User;
  const simulatedRole = (res.locals.simulatedRole as string | null | undefined) ?? null;
  if (!hasRole(user, "production") && !hasRole(user, "art")) {
    res.status(403).json({ error: "Only Production, ART, or SuperUser may update production output" });
    return;
  }

  if (!isWholeMoney(req.body.procurementCost, true)) {
    res.status(400).json({ error: "Procurement Cost must be a non-negative whole-number amount" });
    return;
  }
  const procurementCost = nullify(req.body.procurementCost);
  const procurementLeadTime = nullify(req.body.procurementLeadTime);
  const assemblyTimeHours = nullify(req.body.assemblyTimeHours);
  if (![procurementCost, procurementLeadTime, assemblyTimeHours].every(isNonNegativeNumber)) {
    res.status(400).json({ error: "Procurement Cost, Procurement Lead Time, and Assembly Time must be non-negative numbers" });
    return;
  }
  if (assemblyTimeHours !== null && Number(assemblyTimeHours) > 1_000_000) {
    res.status(400).json({ error: "Assembly Time must be at most 1,000,000 hours" });
    return;
  }
  const procurementCostCurrency = req.body.procurementCostCurrency ?? "USD";
  if (!["USD", "GBP", "EUR", "CNY"].includes(procurementCostCurrency)) {
    res.status(400).json({ error: "Invalid procurement cost currency" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(productionOutputsTable)
      .where(eq(productionOutputsTable.etoRequestId, id))
      .limit(1);

    if (existing?.assemblyTimeHours && assemblyTimeHours === null) {
      res.status(400).json({ error: "Assembly Time cannot be cleared once recorded" });
      return;
    }
    const riskScore = req.body.riskScore === undefined ? existing?.riskScore ?? null : req.body.riskScore;
    const riskNotes = req.body.riskNotes === undefined ? existing?.riskNotes ?? null : req.body.riskNotes;
    const riskError = validateReviewRisk(riskScore, riskNotes);
    if (riskError) { res.status(400).json({ error: riskError }); return; }

    const hoursChanged = existing?.assemblyTimeHours !== assemblyTimeHours;
    const formula = hoursChanged && assemblyTimeHours !== null
      ? existing?.assemblyHourlyRate && existing.assemblyHoursPerWeek && existing.assemblyCapacityFactor
        ? {
            hourlyRate: existing.assemblyHourlyRate,
            hoursPerWeek: existing.assemblyHoursPerWeek,
            capacityFactor: existing.assemblyCapacityFactor,
          }
        : existing?.assemblyTimeHours
          ? DEFAULT_ASSEMBLY_FORMULA
          : await getAssemblyFormula()
      : null;
    const calculated = formula && assemblyTimeHours !== null
      ? calculateAssemblyEstimate(assemblyTimeHours, formula)
      : {};
    const incoming = {
      mfgLeadtime: nullify(req.body.mfgLeadtime),
      prodLeadtime: nullify(req.body.prodLeadtime),
      procurementCost,
      procurementCostCurrency,
      procurementLeadTime,
      assemblyTimeHours,
      ...reviewRiskValues(riskScore, riskNotes),
      ...calculated,
      notes: nullify(req.body.notes),
    };

    const fieldLabels: Record<string, string> = {
      mfgLeadtime: "Mfg Lead Time",
      prodLeadtime: "Prod Lead Time",
      procurementCost: "Procurement Cost",
      procurementCostCurrency: "Procurement Cost Currency",
      procurementLeadTime: "Procurement Lead Time (weeks)",
      assemblyTimeHours: "Assembly Time (hours)",
      riskScore: "Risk Score",
      riskNotes: "Risk Notes",
      ...(formula ? { assemblyCost: "Assembly Cost", assemblyLeadTimeWeeks: "Assembly Lead Time (weeks)" } : {}),
      notes: "Notes",
    };

    let changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    if (existing) {
      for (const [k, label] of Object.entries(fieldLabels)) {
        const oldVal = (existing as unknown as Record<string, string | null>)[k] ?? null;
        const newVal = (incoming as unknown as Record<string, string | null>)[k] ?? null;
        if (oldVal !== newVal) changes.push({ field: label, oldValue: oldVal, newValue: newVal });
      }
    }

    const [row] = await db
      .insert(productionOutputsTable)
      .values({ etoRequestId: id, ...incoming })
      .onConflictDoUpdate({
        target: productionOutputsTable.etoRequestId,
        set: { ...incoming, updatedAt: new Date() },
      })
      .returning();

    if (changes.length > 0) {
      await db.insert(detailChangesTable).values({
        etoRequestId: id,
        section: "production",
        changedById: user.id,
        simulatedRole,
        changes,
      });
    }

    res.json({
      id: row.id,
      etoRequestId: row.etoRequestId,
      mfgLeadtime: row.mfgLeadtime,
      prodLeadtime: row.prodLeadtime,
      procurementCost: row.procurementCost,
      procurementCostCurrency: row.procurementCostCurrency,
      procurementLeadTime: row.procurementLeadTime,
      assemblyTimeHours: row.assemblyTimeHours,
      assemblyCost: row.assemblyCost,
      assemblyCostCurrency: row.assemblyCostCurrency,
      assemblyLeadTimeWeeks: row.assemblyLeadTimeWeeks,
      riskScore: row.riskScore,
      riskNotes: row.riskNotes,
      notes: row.notes,
      createdAt: row.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// ─── ART Final Output ────────────────────────────────────────────────────────

/** GET /api/eto-requests/:id/art-final-output */
router.get("/art-final-output", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [row] = await db
      .select()
      .from(artFinalOutputsTable)
      .where(eq(artFinalOutputsTable.etoRequestId, id))
      .limit(1);

    if (!row) { res.status(404).json({ error: "No art-final output found" }); return; }

    res.json({
      id: row.id,
      etoRequestId: row.etoRequestId,
      marketPrice: row.marketPrice,
      marketPriceCurrency: row.marketPriceCurrency,
      marketLeadtime: row.marketLeadtime,
      quoteDescription: row.quoteDescription,
      notes: row.notes,
      createdAt: row.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/eto-requests/:id/art-final-output — ART, SuperUser */
router.put("/art-final-output", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = res.locals.dbUser as User;
  const simulatedRole = (res.locals.simulatedRole as string | null | undefined) ?? null;
  if (!hasRole(user, "art")) {
    res.status(403).json({ error: "Only ART or SuperUser may update ART final output" });
    return;
  }

  if (!isWholeMoney(req.body.marketPrice, true)) {
    res.status(400).json({ error: "Market Price must be a non-negative whole-number amount" });
    return;
  }
  if (req.body.quoteDescription !== undefined && req.body.quoteDescription !== null
    && typeof req.body.quoteDescription !== "string") {
    res.status(400).json({ error: "Quote Description must be text" });
    return;
  }
  try {
    const [existing] = await db
      .select()
      .from(artFinalOutputsTable)
      .where(eq(artFinalOutputsTable.etoRequestId, id))
      .limit(1);

    const quoteDescription = normalizeRequiredQuoteDescription(
      req.body.quoteDescription === undefined ? existing?.quoteDescription : req.body.quoteDescription,
    );
    if (!quoteDescription) {
      res.status(422).json({ error: "Description is required for an ART Final output" });
      return;
    }
    const incoming = {
      marketPrice: nullify(req.body.marketPrice),
      marketPriceCurrency: req.body.marketPriceCurrency ?? "USD",
      marketLeadtime: nullify(req.body.marketLeadtime),
      quoteDescription,
      notes: nullify(req.body.notes),
    };

    const fieldLabels: Record<string, string> = {
      marketPrice: "Market Price",
      marketPriceCurrency: "Market Price Currency",
      marketLeadtime: "Market Lead Time",
      quoteDescription: "Quote Description",
      notes: "Notes",
    };

    let changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    if (existing) {
      for (const [k, label] of Object.entries(fieldLabels)) {
        const oldVal = (existing as unknown as Record<string, string | null>)[k] ?? null;
        const newVal = (incoming as unknown as Record<string, string | null>)[k] ?? null;
        if (oldVal !== newVal) changes.push({ field: label, oldValue: oldVal, newValue: newVal });
      }
    }

    const [row] = await db
      .insert(artFinalOutputsTable)
      .values({ etoRequestId: id, ...incoming })
      .onConflictDoUpdate({
        target: artFinalOutputsTable.etoRequestId,
        set: { ...incoming, updatedAt: new Date() },
      })
      .returning();

    if (changes.length > 0) {
      await db.insert(detailChangesTable).values({
        etoRequestId: id,
        section: "art-final",
        changedById: user.id,
        simulatedRole,
        changes,
      });
    }

    res.json({
      id: row.id,
      etoRequestId: row.etoRequestId,
      marketPrice: row.marketPrice,
      marketPriceCurrency: row.marketPriceCurrency,
      marketLeadtime: row.marketLeadtime,
      quoteDescription: row.quoteDescription,
      notes: row.notes,
      createdAt: row.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Detail Changes ──────────────────────────────────────────────────────────

/** GET /api/eto-requests/:id/detail-changes */
router.get("/detail-changes", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const rows = await db
      .select({
        id: detailChangesTable.id,
        etoRequestId: detailChangesTable.etoRequestId,
        section: detailChangesTable.section,
        changedById: detailChangesTable.changedById,
        changedByName: usersTable.name,
        changedByRole: usersTable.role,
        simulatedRole: detailChangesTable.simulatedRole,
        changedAt: detailChangesTable.changedAt,
        changes: detailChangesTable.changes,
      })
      .from(detailChangesTable)
      .innerJoin(usersTable, eq(detailChangesTable.changedById, usersTable.id))
      .where(eq(detailChangesTable.etoRequestId, id))
      .orderBy(desc(detailChangesTable.changedAt));

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
