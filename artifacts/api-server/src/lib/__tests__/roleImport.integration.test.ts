import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { dataImportsTable, db, usersTable } from "@workspace/db";
import { ensurePendingEntraSuperUser, importRoleAssignmentsOnce } from "../roleImport";
import { upsertLocalUser } from "../localUser";

const testEmails: string[] = [];
const importIds: string[] = [];

afterEach(async () => {
  if (testEmails.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.email, testEmails.splice(0)));
  }
  if (importIds.length > 0) {
    await db.delete(dataImportsTable).where(inArray(dataImportsTable.id, importIds.splice(0)));
  }
});

describe("importRoleAssignmentsOnce", () => {
  it("updates matching linked users once without creating missing users", async () => {
    const suffix = randomUUID();
    const linkedEmail = `linked-${suffix}@example.test`;
    const unlinkedEmail = `unlinked-${suffix}@example.test`;
    const missingEmail = `missing-${suffix}@example.test`;
    const importId = `role-import-${suffix}`;
    testEmails.push(linkedEmail, unlinkedEmail);
    importIds.push(importId);

    const [linked] = await db
      .insert(usersTable)
      .values([
        { authId: `auth-${suffix}`, name: "Linked", email: linkedEmail, role: "sales" },
        { name: "Unlinked", email: unlinkedEmail, role: "sales" },
      ])
      .returning();

    const assignments = [
      { email: linkedEmail.toUpperCase(), role: "superuser" },
      { email: unlinkedEmail, role: "engineering" },
      { email: missingEmail, role: "art" },
    ];

    await expect(
      importRoleAssignmentsOnce({ importId, assignments }),
    ).resolves.toEqual({ applied: true, matchedUsers: 1 });

    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, linked.id));
    expect(updated.role).toBe("superuser");

    await db.update(usersTable).set({ role: "production" }).where(eq(usersTable.id, linked.id));

    await expect(
      importRoleAssignmentsOnce({ importId, assignments }),
    ).resolves.toEqual({ applied: false, matchedUsers: 1 });

    const [notOverwritten] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, linked.id));
    expect(notOverwritten.role).toBe("production");
  });

  it("can repair only Sales rows linked to Entra identities", async () => {
    const suffix = randomUUID();
    const email = `entra-${suffix}@example.test`;
    const importId = `entra-role-repair-${suffix}`;
    testEmails.push(email);
    importIds.push(importId);
    const [legacy, entra, alreadyAssigned] = await db.insert(usersTable).values([
      { authId: `legacy-${suffix}`, name: "Legacy", email, role: "sales" },
      { authId: randomUUID(), name: "Entra", email, role: "sales" },
      { authId: randomUUID(), name: "Assigned", email, role: "engineering" },
    ]).returning();

    await expect(importRoleAssignmentsOnce({
      importId,
      assignments: [{ email, role: "superuser" }],
      onlyCurrentRole: "sales",
      onlyEntraIdentity: true,
    })).resolves.toEqual({ applied: true, matchedUsers: 1 });

    const rows = await db.select().from(usersTable).where(inArray(usersTable.id, [legacy.id, entra.id, alreadyAssigned.id]));
    expect(rows.find((row) => row.id === legacy.id)?.role).toBe("sales");
    expect(rows.find((row) => row.id === entra.id)?.role).toBe("superuser");
    expect(rows.find((row) => row.id === alreadyAssigned.id)?.role).toBe("engineering");

    await expect(importRoleAssignmentsOnce({
      importId,
      assignments: [{ email, role: "superuser" }],
      onlyCurrentRole: "sales",
      onlyEntraIdentity: true,
    })).resolves.toEqual({ applied: false, matchedUsers: 1 });
  });

  it("prepares one pending role when only a legacy identity exists and remains idempotent", async () => {
    const suffix = randomUUID();
    const email = `pending-${suffix}@example.test`;
    testEmails.push(email);
    await db.insert(usersTable).values({
      authId: `legacy-${suffix}`, name: "Legacy", email, role: "superuser",
    });

    await expect(ensurePendingEntraSuperUser(email, "Pending")).resolves.toBe(true);
    await expect(ensurePendingEntraSuperUser(email, "Pending")).resolves.toBe(false);
    const rows = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.authId === null)?.role).toBe("superuser");

    const signedIn = await upsertLocalUser({ id: randomUUID(), email, name: "Pending" });
    expect(signedIn.role).toBe("superuser");
    expect(signedIn.id).toBe(rows.find((row) => row.authId === null)?.id);
    expect(signedIn.id).not.toBe(rows.find((row) => row.authId?.startsWith("legacy-"))?.id);
  });
});