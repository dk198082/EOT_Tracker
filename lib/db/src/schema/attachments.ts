import { serial, integer, text, timestamp, bigint } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { etoRequestsTable } from "./eto_requests";
import { usersTable } from "./users";

export const attachmentsTable = crmSchema.table(ETO_TABLE_NAMES.attachments, {
  id: serial("id").primaryKey(),
  etoRequestId: integer("eto_request_id").notNull().references(() => etoRequestsTable.id, { onDelete: "cascade" }),
  uploaderId: integer("uploader_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type"),
  fileSize: bigint("file_size", { mode: "number" }),
  searchText: text("search_text"),
  searchStatus: text("search_status").notNull().default("pending"),
  searchError: text("search_error"),
  searchAttempts: integer("search_attempts").notNull().default(0),
  searchLeaseToken: text("search_lease_token"),
  searchProcessedAt: timestamp("search_processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertAttachment = typeof attachmentsTable.$inferInsert;
export type Attachment = typeof attachmentsTable.$inferSelect;
