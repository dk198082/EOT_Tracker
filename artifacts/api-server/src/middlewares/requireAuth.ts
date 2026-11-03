import type { RequestHandler } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  isSimulatableRole,
  isSuperUser,
  ROLE_SIMULATION_HEADER,
  UNASSIGNED_ROLE,
} from "../lib/roles";

function createRequireAuth(allowUnassignedRole: boolean): RequestHandler {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }

    try {
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.authId, req.user.id))
        .limit(1);

      if (!user) {
        res.status(403).json({ error: "User not provisioned — complete account setup first" });
        return;
      }

      if (user.role === UNASSIGNED_ROLE && !allowUnassignedRole) {
        res.status(403).json({ error: "An ETO app role must be assigned before accessing app data" });
        return;
      }

      const requestedRole = req.get(ROLE_SIMULATION_HEADER);
      res.locals.actualDbUser = user;
      res.locals.simulatedRole = null;

      if (requestedRole !== undefined) {
        if (!isSuperUser(user.role)) {
          res.status(403).json({ error: "Role simulation is available only to SuperUsers" });
          return;
        }

        const normalizedRole = requestedRole.trim().toLowerCase();
        if (!isSimulatableRole(normalizedRole)) {
          res.status(400).json({ error: "Invalid simulated role" });
          return;
        }

        res.locals.simulatedRole = normalizedRole;
        res.locals.dbUser = { ...user, role: normalizedRole };
      } else {
        res.locals.dbUser = user;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Requires a valid authenticated session. Attaches `res.locals.dbUser` (the local DB
 * user row) so downstream handlers don't need to re-query.
 *
 * Returns 401 if there is no session.
 * Returns 403 if the authenticated user has not been provisioned in the local DB.
 */
export const requireAuth = createRequireAuth(false);

/** Allows an authenticated user with no ETO role to read only their own account profile. */
export const requireAuthAllowNone = createRequireAuth(true);
