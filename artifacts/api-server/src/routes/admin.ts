import { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { send as sendTestEmail } from "../lib/email";
import { db, designFormulaChangesTable, designFormulaSettingsTable, assemblyFormulaChangesTable, assemblyFormulaSettingsTable, type User } from "@workspace/db";
import { isAdminLike } from "../lib/roles";
import { DEFAULT_DESIGN_FORMULA, getDesignFormula, parseDesignFormula } from "../lib/design-formula";
import { DEFAULT_ASSEMBLY_FORMULA, getAssemblyFormula, parseAssemblyFormula } from "../lib/assembly-formula";
import { EMAIL_NOTIFICATIONS, getEmailNotificationSettings, updateEmailNotificationSetting, updateAllEmailNotificationSettings } from "../lib/notification-settings";

const router = Router();

router.get("/email-notifications", requireAuth, async (_req, res, next) => {
  if (!isAdminLike((res.locals.dbUser as User).role)) {
    res.status(403).json({ error: "Admin access required" }); return;
  }
  try {
    res.json({
      notifications: await getEmailNotificationSettings(),
      deliveryConfigured: Boolean(
        process.env.CLIENT_ID &&
        process.env.CLIENT_SECRET &&
        (process.env.ENTRA_TENANT_ID || process.env.TENANT_ID || process.env.AZURE_TENANT_ID) &&
        process.env.GRAPH_SENDER_EMAIL,
      ),
      linksConfigured: Boolean(process.env.APP_BASE_URL),
    });
  } catch (err) { next(err); }
});

router.put("/email-notifications", requireAuth, async (req, res, next) => {
  if (!isAdminLike((res.locals.dbUser as User).role)) {
    res.status(403).json({ error: "Admin access required" }); return;
  }
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "Provide an enabled boolean" }); return;
  }
  try {
    await updateAllEmailNotificationSettings(req.body.enabled);
    res.json({ enabled: req.body.enabled });
  } catch (err) { next(err); }
});

router.put("/email-notifications/:notificationType", requireAuth, async (req, res, next) => {
  if (!isAdminLike((res.locals.dbUser as User).role)) {
    res.status(403).json({ error: "Admin access required" }); return;
  }
  const item = EMAIL_NOTIFICATIONS.find((item) => item.type === req.params.notificationType);
  if (!item || typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "Choose a valid notification and an enabled boolean" }); return;
  }
  try {
    await updateEmailNotificationSetting(item.type, req.body.enabled);
    res.json({ enabled: req.body.enabled });
  } catch (err) { next(err); }
});

router.get("/design-formula", requireAuth, async (_req, res, next) => {
  const actor = res.locals.dbUser as User;
  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  try {
    res.json(await getDesignFormula());
  } catch (err) {
    next(err);
  }
});

router.get("/design-formula/history", requireAuth, async (req, res, next) => {
  const actor = res.locals.dbUser as User;
  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const rawCursor = req.query.cursor;
  if (rawCursor !== undefined && (typeof rawCursor !== "string" ||
      !/^[1-9]\d*$/.test(rawCursor) || !Number.isSafeInteger(Number(rawCursor)))) {
    res.status(400).json({ error: "Invalid history cursor" });
    return;
  }
  try {
    // Compare with the stored timestamp, not a JS Date reconstructed from the response:
    // PostgreSQL timestamps can have finer precision than JavaScript milliseconds.
    const cursor = rawCursor === undefined ? undefined : Number(rawCursor);
    const query = db.select().from(designFormulaChangesTable);
    const page = await (cursor === undefined
      ? query.orderBy(desc(designFormulaChangesTable.changedAt), desc(designFormulaChangesTable.id)).limit(21)
      : query.where(sql`(${designFormulaChangesTable.changedAt}, ${designFormulaChangesTable.id}) <
          (select ${designFormulaChangesTable.changedAt}, ${designFormulaChangesTable.id}
           from ${designFormulaChangesTable} where ${designFormulaChangesTable.id} = ${cursor})`)
        .orderBy(desc(designFormulaChangesTable.changedAt), desc(designFormulaChangesTable.id)).limit(21));
    const rows = page.slice(0, 20);
    res.json({ items: rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      changedAt: row.changedAt,
      previousValues: {
        hourlyRate: row.previousHourlyRate,
        hoursPerWeek: row.previousHoursPerWeek,
        capacityFactor: row.previousCapacityFactor,
      },
      newValues: {
        hourlyRate: row.newHourlyRate,
        hoursPerWeek: row.newHoursPerWeek,
        capacityFactor: row.newCapacityFactor,
      },
    })), nextCursor: page.length > 20 ? rows[rows.length - 1].id : null });
  } catch (err) {
    next(err);
  }
});

router.put("/design-formula", requireAuth, async (req, res, next) => {
  const actor = res.locals.dbUser as User;
  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const formula = parseDesignFormula(req.body);
  if (!formula) {
    res.status(400).json({ error: "Enter a whole-number hourly rate greater than 0 (up to 1 billion), 1–168 hours per week, and a capacity factor from 0.01 to 1." });
    return;
  }
  try {
    const row = await db.transaction(async (tx) => {
      // Serialize updates even when the singleton settings row has not yet been created.
      await tx.execute(sql`select pg_advisory_xact_lock(681204)`);
      const [current] = await tx.select().from(designFormulaSettingsTable)
        .where(eq(designFormulaSettingsTable.id, 1)).limit(1);
      const previous = current ?? DEFAULT_DESIGN_FORMULA;
      if (previous.hourlyRate === formula.hourlyRate &&
          previous.hoursPerWeek === formula.hoursPerWeek &&
          previous.capacityFactor === formula.capacityFactor) {
        return current ?? { ...DEFAULT_DESIGN_FORMULA, updatedAt: null };
      }
      const [updated] = await tx.insert(designFormulaSettingsTable)
        .values({ id: 1, ...formula })
        .onConflictDoUpdate({
          target: designFormulaSettingsTable.id,
          set: { ...formula, updatedAt: new Date() },
        }).returning();
      await tx.insert(designFormulaChangesTable).values({
        actorUserId: actor.id,
        actorName: actor.name,
        actorEmail: actor.email,
        previousHourlyRate: previous.hourlyRate,
        previousHoursPerWeek: previous.hoursPerWeek,
        previousCapacityFactor: previous.capacityFactor,
        newHourlyRate: formula.hourlyRate,
        newHoursPerWeek: formula.hoursPerWeek,
        newCapacityFactor: formula.capacityFactor,
      });
      return updated;
    });
    res.json({
      hourlyRate: row.hourlyRate,
      hoursPerWeek: row.hoursPerWeek,
      capacityFactor: row.capacityFactor,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/assembly-formula", requireAuth, async (_req, res, next) => {
  const actor = res.locals.dbUser as User;
  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  try {
    res.json(await getAssemblyFormula());
  } catch (err) {
    next(err);
  }
});

router.get("/assembly-formula/history", requireAuth, async (_req, res, next) => {
  const actor = res.locals.dbUser as User;
  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  try {
    const rows = await db.select().from(assemblyFormulaChangesTable)
      .orderBy(desc(assemblyFormulaChangesTable.changedAt), desc(assemblyFormulaChangesTable.id));
    res.json(rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      changedAt: row.changedAt,
      previousValues: {
        hourlyRate: row.previousHourlyRate,
        hoursPerWeek: row.previousHoursPerWeek,
        capacityFactor: row.previousCapacityFactor,
      },
      newValues: {
        hourlyRate: row.newHourlyRate,
        hoursPerWeek: row.newHoursPerWeek,
        capacityFactor: row.newCapacityFactor,
      },
    })));
  } catch (err) {
    next(err);
  }
});

router.put("/assembly-formula", requireAuth, async (req, res, next) => {
  const actor = res.locals.dbUser as User;
  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const formula = parseAssemblyFormula(req.body);
  if (!formula) {
    res.status(400).json({ error: "Enter a whole-number hourly rate greater than 0 (up to 1 billion), 1–168 hours per week, and a capacity factor from 0.01 to 1." });
    return;
  }
  try {
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(681205)`);
      const [current] = await tx.select().from(assemblyFormulaSettingsTable)
        .where(eq(assemblyFormulaSettingsTable.id, 1)).limit(1);
      const previous = current ?? DEFAULT_ASSEMBLY_FORMULA;
      if (previous.hourlyRate === formula.hourlyRate &&
          previous.hoursPerWeek === formula.hoursPerWeek &&
          previous.capacityFactor === formula.capacityFactor) {
        return current ?? { ...DEFAULT_ASSEMBLY_FORMULA, updatedAt: null };
      }
      const [updated] = await tx.insert(assemblyFormulaSettingsTable)
        .values({ id: 1, ...formula })
        .onConflictDoUpdate({
          target: assemblyFormulaSettingsTable.id,
          set: { ...formula, updatedAt: new Date() },
        }).returning();
      await tx.insert(assemblyFormulaChangesTable).values({
        actorUserId: actor.id,
        actorName: actor.name,
        actorEmail: actor.email,
        previousHourlyRate: previous.hourlyRate,
        previousHoursPerWeek: previous.hoursPerWeek,
        previousCapacityFactor: previous.capacityFactor,
        newHourlyRate: formula.hourlyRate,
        newHoursPerWeek: formula.hoursPerWeek,
        newCapacityFactor: formula.capacityFactor,
      });
      return updated;
    });
    res.json({
      hourlyRate: row.hourlyRate,
      hoursPerWeek: row.hoursPerWeek,
      capacityFactor: row.capacityFactor,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/email/test
 *
 * Sends a test email to the authenticated admin's own address.
 * Returns { ok: true, messageId } on success, { ok: false, error } on failure.
 * Requires admin role.
 */
router.post("/email/test", requireAuth, async (_req, res, next) => {
  const actor = res.locals.dbUser as User;

  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  if (!actor.email) {
    res.status(422).json({ error: "Your account has no email address on file" });
    return;
  }

  try {
    const accepted = await sendTestEmail({
      to: [actor.email],
      subject: "[ETO Tracker] Email delivery test",
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Email delivery test</title>
<style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
  .wrapper { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 6px; overflow: hidden; }
  .header { background: #1a3a5c; padding: 24px 32px; }
  .header h1 { color: #fff; font-size: 20px; margin: 0; }
  .body { padding: 28px 32px; color: #333; font-size: 15px; line-height: 1.6; }
  .footer { background: #f0f0f0; padding: 16px 32px; font-size: 12px; color: #888; }
</style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>ETO Tracker</h1></div>
    <div class="body">
      <p>This is a test message sent via <strong>POST /api/admin/email/test</strong>.</p>
      <p>If you received this, Microsoft Graph is configured correctly and email delivery is working.</p>
    </div>
    <div class="footer">Sent by ETO Tracker admin email health check.</div>
  </div>
</body>
</html>`,
    });

    if (accepted) {
      res.json({ ok: true });
    } else {
      res.status(502).json({
        ok: false,
        error: "Microsoft Graph rejected the message or email is not configured — check server logs for details",
      });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
