import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  commentsTable,
  dataImportsTable,
  db,
  etoRequestsTable,
  stageTransitionsTable,
  usersTable,
} from "@workspace/db";
import { reassignEtoSubmittersOnce } from "../etoSubmitterImport";

const suffix = randomUUID();
const importId = `eto-submitter-test-${suffix}`;
const sourceEmail = `eto-source-${suffix}@example.test`;
const targetEmail = `eto-target-${suffix}@tiniusolsen.com`;

let sourceUserId: number;
let targetUserId: number;
let requestId: number;

beforeAll(async () => {
  const [source, target] = await db
    .insert(usersTable)
    .values([
      {
        authId: `eto-source-auth-${suffix}`,
        name: "Legacy Submitter",
        email: sourceEmail,
        role: "sales",
      },
      {
        authId: `eto-target-auth-${suffix}`,
        name: "Tinius Olsen Owner",
        email: targetEmail,
        role: "superuser",
      },
    ])
    .returning();

  sourceUserId = source.id;
  targetUserId = target.id;

  const [eto] = await db
    .insert(etoRequestsTable)
    .values({
      etoNumber: `ETO-REASSIGN-${suffix}`,
      customerName: "Legacy Customer",
      quoteNumber: "Q-LEGACY",
      quoteRevision: "",
      testType: "",
      materials: "Steel",
      specimenDimensions: "10 x 10 mm",
      submittedById: sourceUserId,
      stage: "draft",
    })
    .returning();
  requestId = eto.id;

  await db.insert(stageTransitionsTable).values({
    etoRequestId: requestId,
    actorId: sourceUserId,
    fromStage: "draft",
    toStage: "draft",
    decision: "submit",
  });
  await db.insert(commentsTable).values({
    etoRequestId: requestId,
    authorId: sourceUserId,
    body: "Historical comment",
  });
});

afterAll(async () => {
  await db.delete(etoRequestsTable).where(eq(etoRequestsTable.id, requestId));
  await db.delete(dataImportsTable).where(eq(dataImportsTable.id, importId));
  await db.delete(usersTable).where(eq(usersTable.id, sourceUserId));
  await db.delete(usersTable).where(eq(usersTable.id, targetUserId));
});

describe("reassignEtoSubmittersOnce", () => {
  it("reassigns request ownership once without rewriting audit or comment actors", async () => {
    const first = await reassignEtoSubmittersOnce({
      importId,
      sourceEmail,
      targetEmail,
    });
    const second = await reassignEtoSubmittersOnce({
      importId,
      sourceEmail,
      targetEmail,
    });

    expect(first).toEqual({ applied: true, reassignedRequests: 1 });
    expect(second).toEqual({ applied: false, reassignedRequests: 1 });

    const [eto] = await db
      .select()
      .from(etoRequestsTable)
      .where(eq(etoRequestsTable.id, requestId));
    const [audit] = await db
      .select()
      .from(stageTransitionsTable)
      .where(eq(stageTransitionsTable.etoRequestId, requestId));
    const [comment] = await db
      .select()
      .from(commentsTable)
      .where(eq(commentsTable.etoRequestId, requestId));

    expect(eto.submittedById).toBe(targetUserId);
    expect(audit.actorId).toBe(sourceUserId);
    expect(comment.authorId).toBe(sourceUserId);
  });
});