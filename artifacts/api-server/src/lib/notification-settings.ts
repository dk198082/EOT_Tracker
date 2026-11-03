import { db, emailNotificationSettingsTable } from "@workspace/db";

export const EMAIL_NOTIFICATIONS = [
  { type: "art_submission", name: "Request submitted to ART Review", description: "Notify all ART users with the ETO number and request link." },
  { type: "sales_art_complete", name: "ART Review completed — Sales update", description: "Notify the Submitted by user with the expected due date and request link." },
  { type: "art_assignment", name: "ART Review confirmed — next assignment", description: "Notify the next assigned reviewer, or the ART team when entering its shared queue." },
  { type: "engineering_assignment", name: "Engineering Review confirmed — next assignment", description: "Notify the next assigned reviewer, or the ART team when entering its shared queue." },
  { type: "production_assignment", name: "Production Review confirmed — next assignment", description: "Notify the next assigned reviewer, or the ART team when entering its shared queue." },
  { type: "engineering_reassignment", name: "Engineering Review re-assigned", description: "Notify the newly assigned Engineering reviewer." },
  { type: "production_reassignment", name: "Production Review re-assigned", description: "Notify the newly assigned Production reviewer." },
  { type: "quote_generated", name: "Quote generated — final review outputs", description: "Notify the Submitted by user with Price, Lead Time, Description and Notes. Subject includes ETO and Quote numbers." },
  { type: "inactivity_reminder", name: "Inactivity reminders", description: "Existing reminder emails to the current owner of overdue inactive requests." },
  { type: "other_workflow_updates", name: "Other workflow updates", description: "Existing emails for other stage changes, including Won and returned reviews, to the submitter and relevant owner." },
] as const;
export type NotificationType = typeof EMAIL_NOTIFICATIONS[number]["type"];

export async function getEmailNotificationSettings() {
  const rows = await db.select().from(emailNotificationSettingsTable);
  return EMAIL_NOTIFICATIONS.map((item) => ({
    ...item,
    enabled: rows.find((row) => row.notificationType === item.type)?.enabled === true,
  }));
}

export async function updateEmailNotificationSetting(type: NotificationType, enabled: boolean) {
  await db.insert(emailNotificationSettingsTable)
    .values({ notificationType: type, enabled })
    .onConflictDoUpdate({
      target: emailNotificationSettingsTable.notificationType,
      set: { enabled, updatedAt: new Date() },
    });
}

/** One atomic statement: never leave a partially applied bulk change. */
export async function updateAllEmailNotificationSettings(enabled: boolean) {
  await db.insert(emailNotificationSettingsTable)
    .values(EMAIL_NOTIFICATIONS.map((item) => ({ notificationType: item.type, enabled })))
    .onConflictDoUpdate({
      target: emailNotificationSettingsTable.notificationType,
      set: { enabled, updatedAt: new Date() },
    });
}
