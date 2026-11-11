import { Router } from "express";
import { db, emailDeliveryEventsTable, etoRequestsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router({ mergeParams: true });
router.get("/", requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid request ID" }); return; }
  try {
    const [request] = await db.select({ id: etoRequestsTable.id }).from(etoRequestsTable).where(eq(etoRequestsTable.id, id));
    if (!request) { res.status(404).json({ error: "Request not found" }); return; }
    const events = await db.select().from(emailDeliveryEventsTable)
      .where(eq(emailDeliveryEventsTable.etoRequestId, id))
      .orderBy(desc(emailDeliveryEventsTable.createdAt), desc(emailDeliveryEventsTable.id));
    res.json(events);
  } catch (error) { next(error); }
});
export default router;
