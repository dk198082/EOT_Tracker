import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { requestRows, historyRows } = vi.hoisted(() => ({
  requestRows: vi.fn(), historyRows: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: { kind: string }) => ({
        where: () => table.kind === "requests" ? requestRows() : { orderBy: historyRows },
      }),
    }),
  },
  etoRequestsTable: { kind: "requests", id: "request-id" },
  emailDeliveryEventsTable: { kind: "history", etoRequestId: "request-id", createdAt: "created", id: "id" },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import router from "../email-history";
const app = express();
app.use("/eto-requests/:id/email-history", router);
app.use((error: Error, _req: unknown, res: any, _next: unknown) => res.status(500).json({ error: error.message }));

beforeEach(() => {
  vi.clearAllMocks();
  requestRows.mockResolvedValue([{ id: 10 }]);
  historyRows.mockResolvedValue([]);
});
describe("Request email audit endpoint", () => {
  it.each(["bad", "0", "-1", "10abc", "1.2"])("rejects invalid ID %s", async (id) => {
    await request(app).get(`/eto-requests/${id}/email-history`).expect(400);
    expect(historyRows).not.toHaveBeenCalled();
  });
  it("returns 404 for a missing request", async () => {
    requestRows.mockResolvedValue([]);
    await request(app).get("/eto-requests/10/email-history").expect(404);
    expect(historyRows).not.toHaveBeenCalled();
  });
  it("returns one event containing all recipients", async () => {
    historyRows.mockResolvedValue([{ id: 4, etoRequestId: 10, eventName: "Submitted", recipients: ["one@example.test", "two@example.test"], messages: [], status: "accepted" }]);
    const result = await request(app).get("/eto-requests/10/email-history").expect(200);
    expect(result.body).toHaveLength(1);
    expect(result.body[0].recipients).toHaveLength(2);
  });
  it("returns an empty history for requests without events", async () => {
    const result = await request(app).get("/eto-requests/10/email-history").expect(200);
    expect(result.body).toEqual([]);
  });
  it("surfaces history lookup errors instead of showing an empty history", async () => {
    historyRows.mockRejectedValue(new Error("history unavailable"));
    await request(app).get("/eto-requests/10/email-history").expect(500);
  });
});
