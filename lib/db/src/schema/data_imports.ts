import { integer, text, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const dataImportsTable = crmSchema.table(ETO_TABLE_NAMES.data_imports, {
  id: text("id").primaryKey(),
  matchedUsers: integer("matched_users").notNull().default(0),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDataImportSchema = createInsertSchema(dataImportsTable);
export const selectDataImportSchema = createSelectSchema(dataImportsTable);

export type DataImport = typeof dataImportsTable.$inferSelect;