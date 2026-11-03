import { Router } from "express";
import { db, pool, ETO_SCHEMA } from "@workspace/db";
import { usersTable, reviewAssignmentDefaultsTable, reviewDefaultsId } from "@workspace/db/schema";
import { eq, or, asc, count, getTableName, sql } from "drizzle-orm";
import { requireAuth, requireAuthAllowNone } from "../middlewares/requireAuth";
import { SyncUserBody } from "@workspace/api-zod";
import type { User } from "@workspace/db";
import { isAdminLike, SUPERUSER_ROLE, UNASSIGNED_ROLE } from "../lib/roles";
import { upsertLocalUser } from "../lib/localUser";

const router = Router();
// getTableName alone drops the schema. Raw transactional SQL must qualify it.
const usersTableName = `"${ETO_SCHEMA}"."${getTableName(usersTable)}"`;
const reviewDefaultsTableName = `"${ETO_SCHEMA}"."${getTableName(reviewAssignmentDefaultsTable)}"`;

/** GET /api/users/me — returns the current authenticated user */
router.get("/me", requireAuthAllowNone, (_req, res) => {
  const user = res.locals.dbUser as User;
  const actualUser = (res.locals.actualDbUser as User | undefined) ?? user;
  const simulatedRole = (res.locals.simulatedRole as string | null | undefined) ?? null;
  res.json({
    id: user.id,
    authId: user.authId,
    name: user.name,
    email: user.email,
    role: user.role,
    actualRole: actualUser.role,
    simulatedRole,
    canSimulateRoles: actualUser.role === SUPERUSER_ROLE,
    createdAt: user.createdAt,
  });
});

/** GET /api/users/review-defaults — visible to reviewers choosing an assignee */
router.get("/review-defaults", requireAuth, async (req, res, next) => {
  const entity = req.query.entity ?? "TOUS";
  if (entity !== "TOUS" && entity !== "TOUK") {
    res.status(400).json({ error: "Entity must be TOUS or TOUK" });
    return;
  }
  try {
    const [row] = await db.select().from(reviewAssignmentDefaultsTable)
      .where(eq(reviewAssignmentDefaultsTable.id, reviewDefaultsId(entity))).limit(1);
    res.json({
      entity,
      engineeringUserId: row?.engineeringUserId ?? null,
      productionUserId: row?.productionUserId ?? null,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/users/review-defaults — Admin and SuperUser only */
router.put("/review-defaults", requireAuth, async (req, res, next) => {
  const actor = res.locals.dbUser as User;
  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const engineeringUserId = req.body?.engineeringUserId;
  const productionUserId = req.body?.productionUserId;
  const entity = req.body?.entity === undefined ? "TOUS" : req.body.entity;
  if (entity !== "TOUS" && entity !== "TOUK") {
    res.status(400).json({ error: "Entity must be TOUS or TOUK" });
    return;
  }
  if (!Number.isSafeInteger(engineeringUserId) || engineeringUserId <= 0 ||
      !Number.isSafeInteger(productionUserId) || productionUserId <= 0) {
    res.status(400).json({ error: "Select one Engineering user and one Production user" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Also used by role updates so a reviewer cannot lose their required role mid-save.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(681207)`);
      const [engineer] = await tx.select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable).where(eq(usersTable.id, engineeringUserId)).limit(1);
      const [production] = await tx.select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable).where(eq(usersTable.id, productionUserId)).limit(1);
      if (!engineer || engineer.role !== "engineering") {
        return { error: "Engineering default must have the Engineering role" } as const;
      }
      if (!production || production.role !== "production") {
        return { error: "Production default must have the Production role" } as const;
      }
      const [row] = await tx.insert(reviewAssignmentDefaultsTable)
        .values({ id: reviewDefaultsId(entity), engineeringUserId, productionUserId })
        .onConflictDoUpdate({
          target: reviewAssignmentDefaultsTable.id,
          set: { engineeringUserId, productionUserId, updatedAt: new Date() },
        }).returning();
      return { row };
    });
    if ("error" in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      entity,
      engineeringUserId: result.row.engineeringUserId,
      productionUserId: result.row.productionUserId,
      updatedAt: result.row.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/users/sync — create or update the DB record from the authenticated session */
router.post("/sync", async (req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const parsed = SyncUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { name, email } = parsed.data;

  try {
    const user = await upsertLocalUser({
      id: req.user.id,
      name,
      email,
    });
    let finalUser = user;
    if (user.role !== UNASSIGNED_ROLE && !isAdminLike(user.role)) {
      const [{ value: totalUsers }] = await db.select({ value: count() }).from(usersTable);
      if (totalUsers === 1) {
        const [promoted] = await db
          .update(usersTable)
          .set({ role: "admin", updatedAt: new Date() })
          .where(eq(usersTable.id, user.id))
          .returning();
        finalUser = promoted;
      }
    }

    res.json({
      id: finalUser.id,
      authId: finalUser.authId,
      name: finalUser.name,
      email: finalUser.email,
      role: finalUser.role,
      createdAt: finalUser.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/users/bootstrap-admin — promote caller to admin if no admins exist yet */
router.post("/bootstrap-admin", requireAuth, async (req, res, next) => {
  const actor = res.locals.dbUser as User;

  try {
    // Check whether any admin already exists
      const [{ value: adminCount }] = await db
        .select({ value: count() })
        .from(usersTable)
        .where(sql`${usersTable.role} IN ('admin', ${SUPERUSER_ROLE})`);

    if (adminCount > 0) {
      res.status(409).json({
        error: "Bootstrap unavailable: an admin already exists in the system.",
      });
      return;
    }

    // No admins — promote the caller
    const [promoted] = await db
      .update(usersTable)
      .set({ role: "admin", updatedAt: new Date() })
      .where(eq(usersTable.id, actor.id))
      .returning();

    res.json({
      id: promoted.id,
      authId: promoted.authId,
      name: promoted.name,
      email: promoted.email,
      role: promoted.role,
      createdAt: promoted.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

const VALID_ROLES = [UNASSIGNED_ROLE, "sales", "art", "engineering", "production", "admin", SUPERUSER_ROLE] as const;
type ValidRole = (typeof VALID_ROLES)[number];

/** PATCH /api/users/:id/role — update a user's role (admin only, or first user bootstrap) */
router.patch("/:id/role", requireAuth, async (req, res, next) => {
  const actor = res.locals.dbUser as User;

  try {
    // Allow if actor is admin, or if there's only one user (bootstrap scenario)
    const allUsers = await db.select({ id: usersTable.id }).from(usersTable).orderBy(asc(usersTable.id));
    const isFirstUser = allUsers.length === 1 && allUsers[0].id === actor.id;
    if (!isAdminLike(actor.role) && !isFirstUser) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const role =
      typeof req.body === "object" && req.body !== null && "role" in req.body
        ? req.body.role
        : undefined;
    if (
      typeof role !== "string" ||
      !(VALID_ROLES as readonly string[]).includes(role)
    ) {
      res.status(400).json({
        error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`,
      });
      return;
    }

    const targetId = Number(req.params.id);
    if (isNaN(targetId)) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    // Prevent self-demotion: an admin cannot change their own role away from admin
    if (actor.id === targetId && !isAdminLike(role) && isAdminLike(actor.role)) {
      res.status(400).json({ error: "You cannot change your own admin-level role. Ask another admin to do this." });
      return;
    }

    // Atomic last-admin guard using a transaction with consistent lock ordering.
    //
    // We lock all admin rows AND the target row in a single query ordered by id
    // (ascending). This guarantees:
    //   1. No aggregate+FOR UPDATE (PostgreSQL rejects that combination).
    //   2. All concurrent demotions acquire locks in the same id order, so
    //      there is no deadlock even when two requests race.
    //   3. The count and the update happen inside the same serialised critical
    //      section, so two concurrent demotions of the last admin cannot both
    //      succeed.
    type RawUserRow = {
      id: number;
      auth_id: string | null;
      name: string;
      email: string;
      role: string;
      created_at: Date;
    };

    const client = await pool.connect();
    let updatedRaw: RawUserRow | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [681207]);

      // Lock every admin row plus the target row in ascending id order.
      // Using UNION ensures the target is included even if it is not an admin.
      const lockedRes = await client.query<{ id: number; role: string }>(
        `SELECT id, role
           FROM ${usersTableName}
          WHERE role IN ('admin', 'superuser') OR id = $1
          ORDER BY id
          FOR UPDATE`,
        [targetId],
      );

      const lockedRows = lockedRes.rows;
      const targetRow = lockedRows.find((r) => r.id === targetId);

      if (!targetRow) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "User not found" });
        return;
      }

      // If demoting an admin, ensure at least one other admin will remain.
      if (!isAdminLike(role) && isAdminLike(targetRow.role)) {
        const adminCount = lockedRows.filter((r) => isAdminLike(r.role)).length;
        if (adminCount <= 1) {
          await client.query("ROLLBACK");
          res.status(400).json({ error: "Cannot demote the last admin. Promote another user to admin first." });
          return;
        }
      }

      const defaultsRes = await client.query<{ engineering_user_id: number; production_user_id: number }>(
        `SELECT engineering_user_id, production_user_id FROM ${reviewDefaultsTableName}`,
      );
      if (defaultsRes.rows.some((defaults) =>
          (defaults.engineering_user_id === targetId && role !== "engineering") ||
          (defaults.production_user_id === targetId && role !== "production"))) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Change the default reviewer in Admin > Assignment Defaults before changing this user's role." });
        return;
      }

      const updateRes = await client.query<RawUserRow>(
        `UPDATE ${usersTableName}
            SET role = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING id, clerk_id AS auth_id, name, email, role, created_at`,
        [role, targetId],
      );
      updatedRaw = updateRes.rows[0];
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    if (!updatedRaw) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      id: updatedRaw.id,
      authId: updatedRaw.auth_id,
      name: updatedRaw.name,
      email: updatedRaw.email,
      role: updatedRaw.role,
      createdAt: updatedRaw.created_at,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/users — admin pre-creates a user record before they first sign in */
router.post("/", requireAuth, async (req, res, next) => {
  const actor = res.locals.dbUser as User;
  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const { name, email, role } = req.body as { name?: unknown; email?: unknown; role?: unknown };
  if (typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "A valid email is required" });
    return;
  }
  if (typeof role !== "string" || !(VALID_ROLES as readonly string[]).includes(role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` });
    return;
  }

  try {
    // Check for duplicate email
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
    if (existing.length > 0) {
      res.status(409).json({ error: "A user with that email already exists." });
      return;
    }

    const [user] = await db
      .insert(usersTable)
      .values({ name: name.trim(), email: email.toLowerCase(), role: role as typeof VALID_ROLES[number] })
      .returning();

    res.status(201).json({
      id: user.id,
      authId: user.authId ?? null,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/users/:id — admin removes a user record */
router.delete("/:id", requireAuth, async (req, res, next) => {
  const actor = res.locals.dbUser as User;
  if (!isAdminLike(actor.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const targetId = Number(req.params.id);
  if (isNaN(targetId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  if (actor.id === targetId) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }

  try {
    // Prevent deleting the last admin
    const target = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
    if (target.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (isAdminLike(target[0].role)) {
      const [{ value: adminCount }] = await db
        .select({ value: count() })
        .from(usersTable)
        .where(sql`${usersTable.role} IN ('admin', ${SUPERUSER_ROLE})`);
      if (adminCount <= 1) {
        res.status(400).json({ error: "Cannot delete the last admin." });
        return;
      }
    }

    const [defaults] = await db.select().from(reviewAssignmentDefaultsTable)
      .where(or(eq(reviewAssignmentDefaultsTable.engineeringUserId, targetId),
        eq(reviewAssignmentDefaultsTable.productionUserId, targetId))).limit(1);
    if (defaults) {
      res.status(400).json({ error: "Change the default reviewer in Admin > Assignment Defaults before deleting this user." });
      return;
    }

    await db.delete(usersTable).where(eq(usersTable.id, targetId));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/** GET /api/users — list all users (authenticated) */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { role } = req.query;
    const users = role && typeof role === "string"
      ? await db.select().from(usersTable).where(eq(usersTable.role, role))
      : await db.select().from(usersTable);
    res.json(users.map(u => ({ id: u.id, authId: u.authId, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt })));
  } catch (err) {
    next(err);
  }
});

export default router;
