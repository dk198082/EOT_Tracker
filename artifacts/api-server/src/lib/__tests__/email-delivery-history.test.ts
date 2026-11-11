import { beforeEach, describe, expect, it, vi } from "vitest";
const { insertValues, returning, updateValues, where } = vi.hoisted(() => ({
  insertValues: vi.fn(), returning: vi.fn(), updateValues: vi.fn(), where: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateValues }),
  },
  emailDeliveryEventsTable: { id: "id" },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { deliverLoggedEmails } from "../email-delivery-history";

const email = { name: "ART submitted", to: ["art@example.test", "ART@example.test", " other@example.test "], subject: "ETO test", html: "<p>test</p>" };
beforeEach(() => {
  vi.clearAllMocks();
  insertValues.mockImplementation(() => ({ returning }));
  returning.mockResolvedValue([{ id: 1 }]);
  updateValues.mockImplementation(() => ({ where }));
  where.mockResolvedValue(undefined);
});

describe("Grouped notification event history", () => {
  it("creates one event for multiple messages and recipients, deduplicating recipients", async () => {
    const sender = vi.fn().mockResolvedValue(true);
    expect(await deliverLoggedEmails(10, "ART confirmed", [
      email, { ...email, name: "Next reviewer", to: ["other@example.test", "engineer@example.test"] },
    ], sender)).toBe(true);
    expect(insertValues).toHaveBeenCalledOnce();
    expect(insertValues.mock.calls[0][0].recipients).toEqual([
      "art@example.test", "other@example.test", "engineer@example.test",
    ]);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0][0].to).toEqual(["art@example.test", "other@example.test"]);
    expect(updateValues.mock.calls[0][0]).toMatchObject({ status: "accepted" });
    expect(updateValues.mock.calls[0][0].messages).toHaveLength(2);
  });
  it("records partial acceptance in the same event, with each message outcome", async () => {
    const sender = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await deliverLoggedEmails(10, "ART confirmed", [email, email], sender)).toBe(false);
    const outcome = updateValues.mock.calls[0][0];
    expect(outcome.status).toBe("partial");
    expect(outcome.messages.map((message: { status: string }) => message.status)).toEqual(["accepted", "failed"]);
    expect(insertValues).toHaveBeenCalledOnce();
  });
  it("records sender exceptions as failures without breaking the workflow", async () => {
    const sender = vi.fn().mockRejectedValue(new Error("unavailable"));
    expect(await deliverLoggedEmails(10, "Reassigned", [email], sender)).toBe(false);
    expect(updateValues.mock.calls[0][0].status).toBe("failed");
  });
  it("records missing recipients as skipped without calling Graph", async () => {
    const sender = vi.fn();
    expect(await deliverLoggedEmails(10, "Submitted", [{ ...email, to: [] }], sender)).toBe(false);
    expect(sender).not.toHaveBeenCalled();
    expect(updateValues.mock.calls[0][0].status).toBe("skipped");
  });
  it("does not send if the event cannot be persisted", async () => {
    returning.mockRejectedValueOnce(new Error("database unavailable"));
    const sender = vi.fn();
    expect(await deliverLoggedEmails(10, "Submitted", [email], sender)).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });
  it("does not create history for an event without enabled notifications", async () => {
    expect(await deliverLoggedEmails(10, "Submitted", [], vi.fn())).toBe(false);
    expect(insertValues).not.toHaveBeenCalled();
  });
  it("does not retry a send if the completion update fails", async () => {
    where.mockRejectedValueOnce(new Error("database unavailable"));
    const sender = vi.fn().mockResolvedValue(true);
    expect(await deliverLoggedEmails(10, "Submitted", [email], sender)).toBe(true);
    expect(sender).toHaveBeenCalledOnce();
  });
});
