import { describe, expect, it, vi } from "vitest";
import { allocateEtoNumber } from "../eto-number";

describe("Submission-time ETO allocation", () => {
  it.each([
    ["0", "ETO-2026-0001"],
    ["15", "ETO-2026-0016"],
    ["9999", "ETO-2026-10000"],
    ["10000", "ETO-2026-10001"],
    ["9007199254740992", "ETO-2026-9007199254740993"],
  ])("increments %s without truncation or numeric precision loss", async (maximum, expected) => {
    const calls: string[] = [];
    const tx = {
      execute: vi.fn(async () => { calls.push("lock"); }),
      select: vi.fn(() => {
        calls.push("sequence");
        return { from: () => ({ where: async () => [{ maxSequence: maximum }] }) };
      }),
    };
    const number = await allocateEtoNumber(
      tx as unknown as Parameters<typeof allocateEtoNumber>[0], new Date("2026-06-01T12:00:00Z"),
    );
    expect(number).toBe(expected);
    expect(calls).toEqual(["lock", "sequence"]);
  });
});