import { boolean, text, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";

export const emailNotificationSettingsTable = crmSchema.table(ETO_TABLE_NAMES.email_notification_settings, {
  notificationType: text("notification_type").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
