import { Router } from "express";
import { db } from "@workspace/db";
import { commentsTable, usersTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { CreateCommentBody } from "@workspace/api-zod";
import type { User } from "@workspace/db";
import { parseIntParam } from "../lib/params";

const router = Router({ mergeParams: true });

/** GET /api/eto-requests/:id/comments */
router.get("/", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const rows = await db
      .select({
        c: commentsTable,
        authorName: usersTable.name,
        authorRole: usersTable.role,
      })
      .from(commentsTable)
      .innerJoin(usersTable, eq(commentsTable.authorId, usersTable.id))
      .where(eq(commentsTable.etoRequestId, id))
      .orderBy(asc(commentsTable.createdAt));

    res.json(rows.map(({ c, authorName, authorRole }) => ({
      id: c.id,
      etoRequestId: c.etoRequestId,
      authorId: c.authorId,
      authorName,
      authorRole,
      simulatedRole: c.simulatedRole,
      body: c.body,
      createdAt: c.createdAt,
    })));
  } catch (err) {
    next(err);
  }
});

/** POST /api/eto-requests/:id/comments */
router.post("/", requireAuth, async (req, res, next) => {
  const id = parseIntParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const user = res.locals.dbUser as User;
  const simulatedRole = (res.locals.simulatedRole as string | null | undefined) ?? null;
  const parsed = CreateCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  try {
    const [comment] = await db
      .insert(commentsTable)
      .values({
        etoRequestId: id,
        authorId: user.id,
        simulatedRole,
        body: parsed.data.body,
      })
      .returning();

    res.status(201).json({
      id: comment.id,
      etoRequestId: comment.etoRequestId,
      authorId: comment.authorId,
      authorName: user.name,
      authorRole: ((res.locals.actualDbUser as User | undefined) ?? user).role,
      simulatedRole: comment.simulatedRole,
      body: comment.body,
      createdAt: comment.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
