import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { settings, providerSend } = vi.hoisted(() => ({
  settings: vi.fn(), providerSend: vi.fn(),
}));
vi.mock("../notification-settings", () => ({ getEmailNotificationSettings: settings }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: providerSend }; } }));
import {
  buildTransitionEmails, sendTransitionEmails, sendReassignmentEmail, sendInactivityReminder,
  type EtoEmailContext,
} from "../email";

const base: EtoEmailContext = {
  etoId: 10, etoNumber: "ETO-2026-0010", customerName: "Sample",
  fromStage: "draft", toStage: "art-review",
  submitterEmail: "sales@example.test", submitterName: "Sales Example",
  artEmails: ["art@example.test", "art@example.test"],
  quoteNumber: "QUOTE-123", dueDate: "2026-11-20",
};
const events = [
  ["art_submission", { fromStage: "draft", toStage: "art-review", decision: "submit" }],
  ["sales_art_complete", { fromStage: "art-review", toStage: "engineering-review", decision: "approve-engineering" }],
  ["art_assignment", { fromStage: "art-review", toStage: "engineering-review", decision: "approve-engineering" }],
  ["engineering_assignment", { fromStage: "engineering-review", toStage: "production-review", decision: "engineering-quote-ready" }],
  ["production_assignment", { fromStage: "production-review", toStage: "art-final-review", decision: "production-approve" }],
  ["quote_generated", { fromStage: "art-final-review", toStage: "quoted", decision: "art-final-quote" }],
] as const;
let enabled: string[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_BASE_URL", "https://eto.example.test");
  vi.stubEnv("RESEND_API_KEY", "synthetic-test-only");
  vi.stubEnv("RESEND_FROM", "ETO <eto@example.test>");
  enabled = [];
  settings.mockImplementation(async () => enabled.map((type) => ({ type, enabled: true })));
  providerSend.mockResolvedValue({ data: { id: "sample-message" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("Workflow email notifications", () => {
  it.each(events)("does not send %s while its switch is off", async (_type, context) => {
    expect(await sendTransitionEmails({ ...base, ...context })).toBe(false);
    expect(providerSend).not.toHaveBeenCalled();
  });
  it("sends a single submission email with unique ART recipients and the published link", async () => {
    enabled = ["art_submission"];
    await sendTransitionEmails(base);
    expect(providerSend).toHaveBeenCalledOnce();
    const message = providerSend.mock.calls[0][0];
    expect(message.to).toEqual(["art@example.test"]);
    expect(message.subject).toContain("ETO-2026-0010");
    expect(message.html).toContain("https://eto.example.test/eto-requests/10");
  });
  it("sends Sales the due date independently of the assignment notification", async () => {
    enabled = ["sales_art_complete"];
    await sendTransitionEmails({ ...base, ...events[1][1], assigneeEmail: "engineer@example.test" });
    expect(providerSend).toHaveBeenCalledOnce();
    expect(providerSend.mock.calls[0][0]).toMatchObject({ to: ["sales@example.test"] });
    expect(providerSend.mock.calls[0][0].html).toContain("2026-11-20");
  });
  it.each(events.slice(2, 5))("routes enabled %s to the next reviewer, not Sales", async (type, context) => {
    enabled = [type];
    await sendTransitionEmails({ ...base, ...context, assigneeEmail: "reviewer@example.test" });
    expect(providerSend).toHaveBeenCalledOnce();
    expect(providerSend.mock.calls[0][0]).toMatchObject({
      to: ["reviewer@example.test"], subject: "[ETO Tracker] You have been assigned ETO-2026-0010",
    });
  });
  it("notifies ART when Production advances into the shared Final Review queue", async () => {
    enabled = ["production_assignment"];
    await sendTransitionEmails({ ...base, ...events[4][1], assigneeEmail: null });
    expect(providerSend.mock.calls[0][0].to).toEqual(["art@example.test"]);
  });
  it("includes all four final outputs, ETO and Quote numbers, with escaped user content", async () => {
    enabled = ["quote_generated"];
    await sendTransitionEmails({ ...base, ...events[5][1], finalReview: {
      price: "12345", currency: "GBP", leadTime: "6", description: "Fixture <script>bad()</script>", notes: "Line 1\nLine 2",
    } });
    const message = providerSend.mock.calls[0][0];
    expect(message.to).toEqual(["sales@example.test"]);
    expect(message.subject).toContain("ETO-2026-0010");
    expect(message.subject).toContain("QUOTE-123");
    for (const text of ["Price:", "GBP 12345", "Lead Time (weeks):", "6", "Description:", "Notes:", "Line 1<br>Line 2"])
      expect(message.html).toContain(text);
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>");
  });
  it.each(["engineering", "production"] as const)("gates %s reassignment and addresses only the new reviewer", async (department) => {
    const context = { etoId: 10, etoNumber: base.etoNumber, department, email: "new@example.test" };
    expect(await sendReassignmentEmail(context)).toBe(false);
    expect(providerSend).not.toHaveBeenCalled();
    enabled = [`${department}_reassignment`];
    expect(await sendReassignmentEmail(context)).toBe(true);
    expect(providerSend.mock.calls[0][0].to).toEqual(["new@example.test"]);
  });
  it("keeps existing inactivity emails off too, and reports delivery failure without throwing", async () => {
    expect(await sendInactivityReminder({
      etoId: 10, etoNumber: base.etoNumber, customerName: "Sample", stage: "engineering-review",
      daysInactive: 5, ownerEmail: "engineer@example.test", ownerName: "Sample",
    })).toBe(false);
    enabled = ["art_submission"];
    providerSend.mockResolvedValue({ data: null, error: { message: "Delivery rejected" } });
    expect(await sendTransitionEmails(base)).toBe(false);
  });
  it("keeps older workflow updates opt-in instead of bypassing the switches", async () => {
    const context = { ...base, toStage: "won", decision: "mark-won", prevAssigneeEmail: "owner@example.test" };
    expect(buildTransitionEmails(context)[0].type).toBe("other_workflow_updates");
    expect(await sendTransitionEmails(context)).toBe(false);
    expect(providerSend).not.toHaveBeenCalled();
  });
});
