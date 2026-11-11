import { serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { etoRequestsTable } from "./eto_requests";

export interface EmailDeliveryMessage {
  name: string;
  subject: string;
  recipients: string[];
  status: "pending" | "accepted" | "failed" | "skipped";
}

export const emailDeliveryEventsTable = crmSchema.table(ETO_TABLE_NAMES.email_delivery_events, {
  id: serial("id").primaryKey(),
  etoRequestId: integer("eto_request_id").notNull().references(() => etoRequestsTable.id, { onDelete: "cascade" }),
  eventName: text("event_name").notNull(),
  recipients: text("recipients").array().notNull(),
  messages: jsonb("messages").$type<EmailDeliveryMessage[]>().notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("eto_email_delivery_events_request_created_idx").on(table.etoRequestId, table.createdAt, table.id),
]);

export type EmailDeliveryEvent = typeof emailDeliveryEventsTable.$inferSelect;
export type InsertEmailDeliveryEvent = typeof emailDeliveryEventsTable.$inferInsert;
