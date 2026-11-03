import { db, usersTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { UNASSIGNED_ROLE } from "./roles";

export interface LocalAuthIdentity {
  id: string;
  email?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

function getDisplayName(identity: LocalAuthIdentity, normalizedEmail: string) {
  const name = identity.name?.trim();
  if (name) return name;

  const claimedName = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim();
  return claimedName || normalizedEmail || "User";
}

/**
 * Resolve an authentication identity to the existing role-bearing local user.
 *
 * Email is only allowed to claim a row that has never been linked to an
 * authentication identity. Once linked, authId is authoritative.
 *
 * The transaction-level advisory lock serializes first sign-ins for the same
 * normalized email. The authId unique constraint remains the final guard for
 * concurrent callbacks that arrive without an email or with different claims.
 */
export async function upsertLocalUser(identity: LocalAuthIdentity) {
  const normalizedEmail = identity.email?.trim().toLowerCase() ?? "";
  const name = getDisplayName(identity, normalizedEmail);
  const lockKey = normalizedEmail ? `local-user-email:${normalizedEmail}` : `local-user-auth:${identity.id}`;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [linkedByAuthId] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.authId, identity.id))
      .limit(1);

    if (linkedByAuthId) {
      const [updated] = await tx
        .update(usersTable)
        .set({
          name,
          ...(normalizedEmail ? { email: normalizedEmail } : {}),
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, linkedByAuthId.id))
        .returning();
      return updated;
    }

    if (normalizedEmail) {
      const [preCreated] = await tx
        .select()
        .from(usersTable)
        .where(
          and(
            isNull(usersTable.authId),
            sql`lower(${usersTable.email}) = ${normalizedEmail}`,
          ),
        )
        .limit(1);

      if (preCreated) {
        const [linked] = await tx
          .update(usersTable)
          .set({ authId: identity.id, name, email: normalizedEmail, updatedAt: new Date() })
          .where(and(eq(usersTable.id, preCreated.id), isNull(usersTable.authId)))
          .returning();

        if (linked) return linked;
      }
    }

    const [createdOrUpdated] = await tx
      .insert(usersTable)
      .values({ authId: identity.id, name, email: normalizedEmail, role: UNASSIGNED_ROLE })
      .onConflictDoUpdate({
        target: usersTable.authId,
        set: {
          name,
          ...(normalizedEmail ? { email: normalizedEmail } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    return createdOrUpdated;
  });
}