import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { settings, graphFetch } = vi.hoisted(() => ({
  settings: vi.fn(), graphFetch: vi.fn(),
}));
vi.mock("../notification-settings", () => ({ getEmailNotificationSettings: settings, EMAIL_NOTIFICATIONS: [] }));
vi.mock("../email-delivery-history", () => ({
  deliverLoggedEmails: vi.fn(async (
    _id: number, _name: string,
    emails: Array<{ to: string[]; subject: string; html: string }>,
    sender: (email: { to: string[]; subject: string; html: string }) => Promise<boolean>,
  ) => (await Promise.all(emails.map(sender))).every(Boolean)),
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import {
  buildTransitionEmails, send, sendTransitionEmails, sendReassignmentEmail, sendInactivityReminder,
  type EtoEmailContext,
} from "../email";
import { deliverLoggedEmails } from "../email-delivery-history";
import { logger } from "../logger";

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
  vi.stubEnv("AZURE_TENANT_ID", "synthetic-tenant");
  vi.stubEnv("CLIENT_ID", "synthetic-client");
  vi.stubEnv("CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("GRAPH_SENDER_EMAIL", "no-reply@example.test");
  enabled = [];
  settings.mockImplementation(async () => enabled.map((type) => ({ type, enabled: true })));
  graphFetch.mockImplementation(async (input: string | URL) => {
    if (String(input).includes("/oauth2/v2.0/token")) {
      return new Response(JSON.stringify({ access_token: "synthetic-access-token", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(null, { status: 202 });
  });
  vi.stubGlobal("fetch", graphFetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const sendMailRequests = () => graphFetch.mock.calls.filter(([url]) => String(url).includes("/sendMail"));

describe("Workflow email notifications", () => {
  it.each(events)("does not send %s while its switch is off", async (_type, context) => {
    expect(await sendTransitionEmails({ ...base, ...context })).toBe(false);
    expect(sendMailRequests()).toHaveLength(0);
  });
  it("sends a single submission email with unique ART recipients and the published link", async () => {
    enabled = ["art_submission"];
    await sendTransitionEmails(base);
    const requests = sendMailRequests();
    expect(requests).toHaveLength(1);
    const [url, init] = requests[0];
    expect(String(url)).toContain("/users/no-reply%40example.test/sendMail");
    const message = JSON.parse(String(init?.body)).message;
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "art@example.test" } }]);
    expect(message.subject).toContain("ETO-2026-0010");
    expect(message.body.content).toContain("https://eto.example.test/eto-requests/10");
  });
  it("sends Sales the due date independently of the assignment notification", async () => {
    enabled = ["sales_art_complete"];
    await sendTransitionEmails({ ...base, ...events[1][1], assigneeEmail: "engineer@example.test" });
    const message = JSON.parse(String(sendMailRequests()[0][1]?.body)).message;
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "sales@example.test" } }]);
    expect(message.body.content).toContain("2026-11-20");
  });
  it("groups both ART completion messages into one originating event", async () => {
    enabled = ["sales_art_complete", "art_assignment"];
    await sendTransitionEmails({ ...base, ...events[1][1], assigneeEmail: "engineer@example.test" });
    expect(deliverLoggedEmails).toHaveBeenCalledOnce();
    const [requestId, eventName, emails] = vi.mocked(deliverLoggedEmails).mock.calls[0];
    expect(requestId).toBe(base.etoId);
    expect(eventName).toBe("ART Review → Engineering Review");
    expect(emails).toHaveLength(2);
    expect(emails.flatMap((email) => email.to)).toEqual(["sales@example.test", "engineer@example.test"]);
  });
  it.each(events.slice(2, 5))("routes enabled %s to the next reviewer, not Sales", async (type, context) => {
    enabled = [type];
    await sendTransitionEmails({ ...base, ...context, assigneeEmail: "reviewer@example.test" });
    const message = JSON.parse(String(sendMailRequests()[0][1]?.body)).message;
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "reviewer@example.test" } }]);
    expect(message.subject).toBe("[ETO Tracker] You have been assigned ETO-2026-0010");
  });
  it("notifies ART when Production advances into the shared Final Review queue", async () => {
    enabled = ["production_assignment"];
    await sendTransitionEmails({ ...base, ...events[4][1], assigneeEmail: null });
    const message = JSON.parse(String(sendMailRequests()[0][1]?.body)).message;
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "art@example.test" } }]);
  });
  it("includes all four final outputs, ETO and Quote numbers, with escaped user content", async () => {
    enabled = ["quote_generated"];
    await sendTransitionEmails({ ...base, ...events[5][1], finalReview: {
      price: "12345", currency: "GBP", leadTime: "6", description: "Fixture <script>bad()</script>", notes: "Line 1\nLine 2",
    } });
    const message = JSON.parse(String(sendMailRequests()[0][1]?.body)).message;
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "sales@example.test" } }]);
    expect(message.subject).toContain("ETO-2026-0010");
    expect(message.subject).toContain("QUOTE-123");
    for (const text of ["Price:", "GBP 12345", "Lead Time (weeks):", "6", "Description:", "Notes:", "Line 1<br>Line 2"])
      expect(message.body.content).toContain(text);
    expect(message.body.content).toContain("&lt;script&gt;");
    expect(message.body.content).not.toContain("<script>");
  });
  it.each(["engineering", "production"] as const)("gates %s reassignment and addresses only the new reviewer", async (department) => {
    const context = { etoId: 10, etoNumber: base.etoNumber, department, email: "new@example.test" };
    expect(await sendReassignmentEmail(context)).toBe(false);
    expect(sendMailRequests()).toHaveLength(0);
    enabled = [`${department}_reassignment`];
    expect(await sendReassignmentEmail(context)).toBe(true);
    const message = JSON.parse(String(sendMailRequests()[0][1]?.body)).message;
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "new@example.test" } }]);
  });
  it("keeps existing inactivity emails off too, and reports delivery failure without throwing", async () => {
    expect(await sendInactivityReminder({
      etoId: 10, etoNumber: base.etoNumber, customerName: "Sample", stage: "engineering-review",
      daysInactive: 5, ownerEmail: "engineer@example.test", ownerName: "Sample",
    })).toBe(false);
    enabled = ["art_submission"];
    graphFetch.mockImplementation(async (input: string | URL) => {
      if (String(input).includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "synthetic-access-token", expires_in: 3600 }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 403 });
    });
    expect(await sendTransitionEmails(base)).toBe(false);
  });
  it("reports Graph as unavailable when required configuration is missing", async () => {
    vi.stubEnv("GRAPH_SENDER_EMAIL", "");
    expect(await send({ to: ["person@example.test"], subject: "test", html: "<p>test</p>" })).toBe(false);
    expect(sendMailRequests()).toHaveLength(0);
  });
  it("refreshes an old token once after an authorization rejection", async () => {
    vi.stubEnv("AZURE_TENANT_ID", "permission-refresh-test");
    let issued = 0;
    let attempted = 0;
    graphFetch.mockImplementation(async (input: string | URL) => {
      if (String(input).includes("/oauth2/v2.0/token")) {
        issued++;
        return new Response(JSON.stringify({ access_token: `synthetic-token-${issued}`, expires_in: 3600 }), { status: 200 });
      }
      attempted++;
      return attempted === 1
        ? new Response(JSON.stringify({ error: { code: "ErrorAccessDenied" } }), { status: 403 })
        : new Response(null, { status: 202 });
    });
    expect(await send({ to: ["person@example.test"], subject: "test", html: "<p>test</p>" })).toBe(true);
    expect(issued).toBe(2);
    expect(sendMailRequests()).toHaveLength(2);
    const authorization = sendMailRequests().map(([, init]) => new Headers(init?.headers).get("authorization"));
    expect(authorization).toEqual(["Bearer synthetic-token-1", "Bearer synthetic-token-2"]);
  });
  it("stops after one refresh and logs safe error identifiers for a persistent denial", async () => {
    graphFetch.mockImplementation(async (input: string | URL) => {
      if (String(input).includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "synthetic-denied-token", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: "ErrorAccessDenied", message: "sensitive details must not be logged" } }), {
        status: 403, headers: { "request-id": "test-request-id" },
      });
    });
    expect(await send({ to: ["person@example.test"], subject: "test", html: "<p>test</p>" })).toBe(false);
    expect(sendMailRequests()).toHaveLength(2);
    expect(logger.error).toHaveBeenCalledWith({
      status: 403, subject: "test", graphErrorCode: "ErrorAccessDenied", requestId: "test-request-id",
    }, "Microsoft Graph rejected the email");
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain("sensitive details");
  });
  it("does not retry an ambiguous network failure and risk sending twice", async () => {
    graphFetch.mockImplementation(async (input: string | URL) => {
      if (String(input).includes("/oauth2/v2.0/token")) {
        return new Response(JSON.stringify({ access_token: "synthetic-network-test-token", expires_in: 3600 }), { status: 200 });
      }
      throw new Error("Network disconnected");
    });
    expect(await send({ to: ["person@example.test"], subject: "test", html: "<p>test</p>" })).toBe(false);
    expect(sendMailRequests()).toHaveLength(1);
  });
  it("keeps older workflow updates opt-in instead of bypassing the switches", async () => {
    const context = { ...base, toStage: "won", decision: "mark-won", prevAssigneeEmail: "owner@example.test" };
    expect(buildTransitionEmails(context)[0].type).toBe("other_workflow_updates");
    expect(await sendTransitionEmails(context)).toBe(false);
    expect(sendMailRequests()).toHaveLength(0);
  });
});
