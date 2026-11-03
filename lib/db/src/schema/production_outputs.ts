import { serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { etoRequestsTable } from "./eto_requests";

export const productionOutputsTable = crmSchema.table(ETO_TABLE_NAMES.production_outputs, {
  id: serial("id").primaryKey(),
  etoRequestId: integer("eto_request_id").notNull().unique().references(() => etoRequestsTable.id, { onDelete: "cascade" }),
  mfgLeadtime: text("mfg_leadtime"),
  prodLeadtime: text("prod_leadtime"),
  procurementCost: text("procurement_cost"),
  procurementCostCurrency: text("procurement_cost_currency").notNull().default("USD"),
  procurementLeadTime: text("procurement_lead_time"),
  assemblyTimeHours: text("assembly_time_hours"),
  assemblyCost: text("assembly_cost"),
  assemblyCostCurrency: text("assembly_cost_currency").notNull().default("USD"),
  assemblyLeadTimeWeeks: text("assembly_lead_time_weeks"),
  assemblyHourlyRate: text("assembly_hourly_rate"),
  assemblyHoursPerWeek: text("assembly_hours_per_week"),
  assemblyCapacityFactor: text("assembly_capacity_factor"),
  riskScore: text("risk_score"),
  riskNotes: text("risk_notes"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertProductionOutput = typeof productionOutputsTable.$inferInsert;
export type ProductionOutput = typeof productionOutputsTable.$inferSelect;
