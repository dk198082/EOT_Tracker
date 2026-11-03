import { integer, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { usersTable } from "./users";

// Keep the existing row as TOUS; TOUK is configured independently.
export function reviewDefaultsId(entity?: string | null): number {
  return entity === "TOUK" ? 2 : 1;
}

export const reviewAssignmentDefaultsTable = crmSchema.table(ETO_TABLE_NAMES.review_assignment_defaults, {
  id: integer("id").primaryKey(),
  engineeringUserId: integer("engineering_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  productionUserId: integer("production_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});