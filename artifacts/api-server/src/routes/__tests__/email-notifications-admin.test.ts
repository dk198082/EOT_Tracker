import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { getSettings, updateSetting, updateAll } = vi.hoisted(() => ({
  getSettings: vi.fn(), updateSetting: vi.fn(), updateAll: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: {}, designFormulaSettingsTable: {}, designFormulaChangesTable: {},
  assemblyFormulaSettingsTable: {}, assemblyFormulaChangesTable: {}, emailNotificationSettingsTable: {},
}));
vi.mock("../../lib/notification-settings", async (original) => ({
  ...await original<typeof import("../../lib/notification-settings")>(),
  getEmailNotificationSettings: getSettings, updateEmailNotificationSetting: updateSetting,
  updateAllEmailNotificationSettings: updateAll,
}));
vi.mock("../../lib/email", () => ({ send: vi.fn() }));
let role = "admin";
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, res: any, next: () => void) => {
    res.locals.dbUser = { id: 1, role }; next();
  },
}));
import router from "../admin";
import { EMAIL_NOTIFICATIONS } from "../../lib/notification-settings";
const app = express();
app.use(express.json());
app.use("/admin", router);
app.use((error: Error, _req: unknown, res: any, _next: unknown) => res.status(500).json({ error: error.message }));
let enabled: Record<string, boolean>;
beforeEach(() => {
  vi.clearAllMocks(); role = "admin"; enabled = {};
  getSettings.mockImplementation(async () => EMAIL_NOTIFICATIONS.map((item) => ({ ...item, enabled: enabled[item.type] === true })));
  updateSetting.mockImplementation(async (type, value) => { enabled[type] = value; });
  updateAll.mockImplementation(async (value) => {
    for (const item of EMAIL_NOTIFICATIONS) enabled[item.type] = value;
  });
});
describe("Admin email notification switches", () => {
  it("starts all switches off and persists each choice independently", async () => {
    const initial = await request(app).get("/admin/email-notifications").expect(200);
    expect(initial.body.notifications).toHaveLength(10);
    expect(initial.body.notifications.every((item: any) => item.enabled === false)).toBe(true);
    await request(app).put("/admin/email-notifications/art_submission").send({ enabled: true }).expect(200);
    const refreshed = await request(app).get("/admin/email-notifications").expect(200);
    expect(refreshed.body.notifications.filter((item: any) => item.enabled).map((item: any) => item.type)).toEqual(["art_submission"]);
    await request(app).put("/admin/email-notifications/art_submission").send({ enabled: false }).expect(200);
    expect(enabled.art_submission).toBe(false);
  });
  it("rejects invalid notification types and non-boolean toggles", async () => {
    await request(app).put("/admin/email-notifications/unknown").send({ enabled: true }).expect(400);
    for (const enabled of [null, 1, "false", undefined])
      await request(app).put("/admin/email-notifications/art_submission").send({ enabled }).expect(400);
    for (const enabled of [null, 1, "false", undefined])
      await request(app).put("/admin/email-notifications").send({ enabled }).expect(400);
    expect(updateSetting).not.toHaveBeenCalled();
    expect(updateAll).not.toHaveBeenCalled();
  });
  it.each(["sales", "engineering", "production", "art"])("blocks %s from reading or changing Admin settings", async (actorRole) => {
    role = actorRole;
    await request(app).get("/admin/email-notifications").expect(403);
    await request(app).put("/admin/email-notifications/art_submission").send({ enabled: true }).expect(403);
    await request(app).put("/admin/email-notifications").send({ enabled: true }).expect(403);
    expect(updateSetting).not.toHaveBeenCalled();
    expect(updateAll).not.toHaveBeenCalled();
  });
  it.each(["admin", "superuser"])("lets %s set all to Yes and No, retaining individual overrides", async (actorRole) => {
    role = actorRole;
    await request(app).put("/admin/email-notifications").send({ enabled: true }).expect(200, { enabled: true });
    const allYes = await request(app).get("/admin/email-notifications").expect(200);
    expect(allYes.body.notifications.every((item: any) => item.enabled)).toBe(true);
    await request(app).put("/admin/email-notifications/art_submission").send({ enabled: false }).expect(200);
    expect(enabled.art_submission).toBe(false);
    expect(enabled.quote_generated).toBe(true);
    await request(app).put("/admin/email-notifications").send({ enabled: false }).expect(200, { enabled: false });
    const allNo = await request(app).get("/admin/email-notifications").expect(200);
    expect(allNo.body.notifications.every((item: any) => !item.enabled)).toBe(true);
  });
  it("reports bulk persistence failures without claiming success", async () => {
    updateAll.mockRejectedValueOnce(new Error("Storage unavailable"));
    await request(app).put("/admin/email-notifications").send({ enabled: true }).expect(500);
    expect(enabled).toEqual({});
  });
  it("allows SuperUsers and surfaces persistence errors rather than pretending to save", async () => {
    role = "superuser";
    await request(app).get("/admin/email-notifications").expect(200);
    updateSetting.mockRejectedValueOnce(new Error("Storage unavailable"));
    await request(app).put("/admin/email-notifications/art_submission").send({ enabled: true }).expect(500);
    expect(enabled).toEqual({});
  });
});
