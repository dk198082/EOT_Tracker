import { serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { etoRequestsTable } from "./eto_requests";
import { usersTable } from "./users";

export const commentsTable = crmSchema.table(ETO_TABLE_NAMES.comments, {
  id: serial("id").primaryKey(),
  etoRequestId: integer("eto_request_id").notNull().references(() => etoRequestsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  simulatedRole: text("simulated_role"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertComment = typeof commentsTable.$inferInsert;
export type Comment = typeof commentsTable.$inferSelect;
