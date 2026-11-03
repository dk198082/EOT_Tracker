import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db, priceCalculatorSettingsTable, etoPriceCalculatorTable,
  etoRequestsTable, detailChangesTable, type User,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { hasRole, isAdminLike } from "../lib/roles";
import { getPriceDefaults, parsePricePercentages } from "../lib/price-calculator";

const router = Router();
const invalidPercentages = "Contingency % and Margin % are required and must be numbers from 0 to 100";

router.get("/admin/price-calculator", requireAuth, async (_req, res, next) => {
  if (!isAdminLike((res.locals.dbUser as User).role)) {
    res.status(403).json({ error: "Admin access required" }); return;
  }
  try {
    res.json(await getPriceDefaults());
  } catch (err) { next(err); }
});

router.put("/admin/price-calculator", requireAuth, async (req, res, next) => {
  if (!isAdminLike((res.locals.dbUser as User).role)) {
    res.status(403).json({ error: "Admin access required" }); return;
  }
  const values = parsePricePercentages(req.body);
  if (!values) { res.status(422).json({ error: invalidPercentages }); return; }
  try {
    const [row] = await db.insert(priceCalculatorSettingsTable)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({
        target: priceCalculatorSettingsTable.id,
        set: { ...values, updatedAt: new Date() },
      }).returning();
    res.json({ ...values, updatedAt: row.updatedAt });
  } catch (err) { next(err); }
});

router.get("/eto-requests/:id/price-calculator", requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  try {
    const [eto] = await db.select({ id: etoRequestsTable.id }).from(etoRequestsTable)
      .where(eq(etoRequestsTable.id, id)).limit(1);
    if (!eto) { res.status(404).json({ error: "ETO request not found" }); return; }
    const [saved] = await db.select().from(etoPriceCalculatorTable)
      .where(eq(etoPriceCalculatorTable.etoRequestId, id)).limit(1);
    res.json(saved ? {
      contingencyPercent: saved.contingencyPercent,
      marginPercent: saved.marginPercent,
      updatedAt: saved.updatedAt,
      saved: true,
    } : { ...await getPriceDefaults(), saved: false });
  } catch (err) { next(err); }
});

router.put("/eto-requests/:id/price-calculator", requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const user = res.locals.dbUser as User;
  if (!hasRole(user, "art")) {
    res.status(403).json({ error: "Only ART or SuperUser may edit the Price Calculator" }); return;
  }
  const values = parsePricePercentages(req.body);
  if (!values) { res.status(422).json({ error: invalidPercentages }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const [eto] = await tx.select().from(etoRequestsTable)
        .where(eq(etoRequestsTable.id, id)).limit(1).for("update");
      if (!eto) return { status: 404, body: { error: "ETO request not found" } };
      if (eto.stage !== "art-final-review") {
        return { status: 409, body: { error: "Price Calculator can only be edited during ART Final Review" } };
      }
      const [existing] = await tx.select().from(etoPriceCalculatorTable)
        .where(eq(etoPriceCalculatorTable.etoRequestId, id)).limit(1);
      const previous = existing ?? await getPriceDefaults(tx);
      const [row] = await tx.insert(etoPriceCalculatorTable)
        .values({ etoRequestId: id, ...values })
        .onConflictDoUpdate({
          target: etoPriceCalculatorTable.etoRequestId,
          set: { ...values, updatedAt: new Date() },
        }).returning();
      const labels = { contingencyPercent: "Contingency %", marginPercent: "Margin %" } as const;
      const changes = (Object.keys(labels) as (keyof typeof labels)[])
        .filter((field) => previous[field] !== values[field])
        .map((field) => ({ field: labels[field], oldValue: previous[field], newValue: values[field] }));
      if (changes.length) await tx.insert(detailChangesTable).values({
        etoRequestId: id,
        section: "art-final",
        changedById: user.id,
        simulatedRole: res.locals.simulatedRole ?? null,
        changes,
      });
      return { status: 200, body: { ...values, updatedAt: row.updatedAt, saved: true } };
    });
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

export default router;