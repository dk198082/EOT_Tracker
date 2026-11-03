import { serial, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { etoRequestsTable } from "./eto_requests";
import { usersTable } from "./users";

export const detailChangesTable = crmSchema.table(ETO_TABLE_NAMES.detail_changes, {
  id: serial("id").primaryKey(),
  etoRequestId: integer("eto_request_id")
    .notNull()
    .references(() => etoRequestsTable.id, { onDelete: "cascade" }),
  /** Which section was edited: 'request' | 'engineering' | 'production' | 'art-final' */
  section: text("section").notNull(),
  changedById: integer("changed_by_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  simulatedRole: text("simulated_role"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  /** JSON array of { field, oldValue, newValue } */
  changes: jsonb("changes").notNull().$type<Array<{ field: string; oldValue: string | null; newValue: string | null }>>(),
});

export type InsertDetailChange = typeof detailChangesTable.$inferInsert;
export type DetailChange = typeof detailChangesTable.$inferSelect;
