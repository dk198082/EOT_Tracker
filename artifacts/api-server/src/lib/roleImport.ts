import { db, dataImportsTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

type RoleAssignment = {
  email: string;
  role: string;
};

const IMPORT_ID = "development-role-snapshot-2026-09-15";
const ENTRA_ID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const DEVELOPMENT_ROLE_SNAPSHOT: readonly RoleAssignment[] = [
  { email: "art.workflow.1788974348559@example.test", role: "sales" },
  { email: "btait@tiniusolsen.com", role: "superuser" },
  { email: "eschmidt-staubach@tiniusolsen.com", role: "superuser" },
  { email: "jseidler@tiniusolsen.com", role: "superuser" },
  { email: "michael.millane@tiniusolsen.com", role: "superuser" },
  { email: "spathak@tiniusolsen.com", role: "sales" },
  { email: "testengineering@tiniusolsen.com", role: "engineering" },
  { email: "DKumar@tiniusolsen.com", role: "sales" },
];

export async function importRoleAssignmentsOnce({
  importId = IMPORT_ID,
  assignments = DEVELOPMENT_ROLE_SNAPSHOT,
  onlyCurrentRole,
  onlyEntraIdentity = false,
}: {
  importId?: string;
  assignments?: readonly RoleAssignment[];
  onlyCurrentRole?: string;
  onlyEntraIdentity?: boolean;
} = {}): Promise<{ applied: boolean; matchedUsers: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`data-import:${importId}`}, 0))`,
    );

    const [existing] = await tx
      .select({ matchedUsers: dataImportsTable.matchedUsers })
      .from(dataImportsTable)
      .where(eq(dataImportsTable.id, importId))
      .limit(1);

    if (existing) {
      return { applied: false, matchedUsers: existing.matchedUsers };
    }

    let matchedUsers = 0;
    for (const assignment of assignments) {
      const normalizedEmail = assignment.email.trim().toLowerCase();
      const updated = await tx
        .update(usersTable)
        .set({ role: assignment.role, updatedAt: new Date() })
        .where(
          and(
            isNotNull(usersTable.authId),
            sql`lower(${usersTable.email}) = ${normalizedEmail}`,
            onlyCurrentRole ? eq(usersTable.role, onlyCurrentRole) : undefined,
            // Entra object IDs are UUIDs; do not touch linked legacy identities.
            onlyEntraIdentity
              ? sql`${usersTable.authId} ~* ${ENTRA_ID_PATTERN}`
              : undefined,
          ),
        )
        .returning({ id: usersTable.id });
      matchedUsers += updated.length;
    }

    await tx.insert(dataImportsTable).values({ id: importId, matchedUsers });
    return { applied: true, matchedUsers };
  });
}

/**
 * The original snapshot ran before some people first signed in with Entra,
 * so their later Entra-linked rows received the default Sales role.
 * Repair only those rows once, without changing legacy users or future
 * explicitly assigned roles. Do not use email matching as ongoing sign-in
 * authorization.
 */
export function restoreEntraSuperUsersOnce() {
  return importRoleAssignmentsOnce({
    // New ID: the narrower two-person repair may have already completed.
    importId: "entra-superuser-role-repair-four-2026-09-25",
    assignments: DEVELOPMENT_ROLE_SNAPSHOT.filter(
      ({ email }) =>
        email === "michael.millane@tiniusolsen.com" ||
        email === "jseidler@tiniusolsen.com" ||
        email === "btait@tiniusolsen.com" ||
        email === "eschmidt-staubach@tiniusolsen.com",
    ),
    onlyCurrentRole: "sales",
    onlyEntraIdentity: true,
  });
}

/**
 * Provision a specifically approved SuperUser before the first Entra sign-in.
 * A nullable-auth row is claimed by the usual first-login flow. Never transfer
 * an existing linked identity based only on email.
 */
export async function ensurePendingEntraSuperUser(email: string, name: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    // Use the same lock as upsertLocalUser so a callback cannot race provisioning.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`local-user-email:${normalizedEmail}`}, 0))`);
    const [current] = await tx.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        sql`lower(${usersTable.email}) = ${normalizedEmail}`,
        or(isNull(usersTable.authId), sql`${usersTable.authId} ~* ${ENTRA_ID_PATTERN}`),
      ))
      .limit(1);
    if (current) return false;

    await tx.insert(usersTable).values({ name, email: normalizedEmail, role: "superuser" });
    return true;
  });
}

export async function prepareEntraSuperUsers() {
  // Bobby has no Entra identity row yet. This is an explicit, one-person
  // pre-provisioning decision, not a perpetual email-based privilege rule.
  await ensurePendingEntraSuperUser("btait@tiniusolsen.com", "Bobby Tait");
  return restoreEntraSuperUsersOnce();
}