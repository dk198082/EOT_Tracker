import { integer, text, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { etoRequestsTable } from "./eto_requests";

export const priceCalculatorSettingsTable = crmSchema.table(ETO_TABLE_NAMES.price_calculator_settings, {
  id: integer("id").primaryKey(),
  contingencyPercent: text("contingency_percent").notNull(),
  marginPercent: text("margin_percent").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const etoPriceCalculatorTable = crmSchema.table(ETO_TABLE_NAMES.eto_price_calculator, {
  etoRequestId: integer("eto_request_id").primaryKey()
    .references(() => etoRequestsTable.id, { onDelete: "cascade" }),
  contingencyPercent: text("contingency_percent").notNull(),
  marginPercent: text("margin_percent").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});