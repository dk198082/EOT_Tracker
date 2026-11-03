import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selectResults: [] as Array<Array<Record<string, unknown>>>,
  insertedValues: null as Record<string, unknown> | null,
}));

vi.mock("@workspace/db", () => {
  const tx = {
    execute: vi.fn(async () => undefined),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.selectResults.shift() ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.insertedValues = values;
        return {
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => ({
            returning: async () => [{ id: 1, ...values, ...set }],
          }),
        };
      },
    }),
  };

  return {
    db: {
      transaction: (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    },
    usersTable: {
      authId: "authId",
      email: "email",
      id: "id",
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ column, isNull: true }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

import { upsertLocalUser } from "../localUser";

describe("upsertLocalUser provisioning", () => {
  beforeEach(() => {
    state.selectResults = [[], []];
    state.insertedValues = null;
  });

  it("creates a newly authorized local user with no ETO role assigned", async () => {
    const created = await upsertLocalUser({
      id: "entra-user-id",
      email: "new.user@example.test",
      name: "New User",
    });

    expect(state.insertedValues).toMatchObject({ role: "none" });
    expect(created).toMatchObject({ role: "none", authId: "entra-user-id" });
  });
});
