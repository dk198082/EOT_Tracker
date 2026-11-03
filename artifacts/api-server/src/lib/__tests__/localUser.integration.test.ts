import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { upsertLocalUser } from "../localUser";

const testEmails: string[] = [];

afterEach(async () => {
  if (testEmails.length === 0) return;
  await db.delete(usersTable).where(inArray(usersTable.email, testEmails.splice(0)));
});

describe("upsertLocalUser", () => {
  it("links one pre-created row when concurrent callbacks share an identity", async () => {
    const email = `local-user-${randomUUID()}@example.com`;
    testEmails.push(email, email.toUpperCase());

    const [preCreated] = await db
      .insert(usersTable)
      .values({
        name: "Pre-created Person",
        email: email.toUpperCase(),
        role: "engineering",
      })
      .returning();

    const identity = {
      id: `local-user-auth-${randomUUID()}`,
      name: "Signed In Person",
      email,
    };
    const [first, second] = await Promise.all([
      upsertLocalUser(identity),
      upsertLocalUser(identity),
    ]);

    const [stored] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, preCreated.id));
    expect(first.id).toBe(preCreated.id);
    expect(second.id).toBe(preCreated.id);
    expect(stored.authId).toBe(identity.id);
    expect(stored.role).toBe("engineering");
  });

  it("does not let an email claim an identity that is already linked", async () => {
    const email = `linked-user-${randomUUID()}@example.com`;
    testEmails.push(email);

    const [alreadyLinked] = await db
      .insert(usersTable)
      .values({
        authId: `linked-auth-${randomUUID()}`,
        name: "Already Linked",
        email,
        role: "art",
      })
      .returning();

    const resolved = await upsertLocalUser({
      id: `new-auth-${randomUUID()}`,
      name: "Different Person",
      email,
    });
    const rows = await db
      .select({ id: usersTable.id, authId: usersTable.authId })
      .from(usersTable)
      .where(and(eq(usersTable.email, email), inArray(usersTable.id, [alreadyLinked.id, resolved.id])));

    expect(resolved.id).not.toBe(alreadyLinked.id);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: alreadyLinked.id, authId: alreadyLinked.authId },
        { id: resolved.id, authId: resolved.authId },
      ]),
    );
  });
});