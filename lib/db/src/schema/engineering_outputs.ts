import { serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { etoRequestsTable } from "./eto_requests";

export const engineeringOutputsTable = crmSchema.table(ETO_TABLE_NAMES.engineering_outputs, {
  id: serial("id").primaryKey(),
  etoRequestId: integer("eto_request_id").notNull().unique().references(() => etoRequestsTable.id, { onDelete: "cascade" }),
  costEstimate: text("cost_estimate"),
  costEstimateCurrency: text("cost_estimate_currency").notNull().default("USD"),
  docLeadtime: text("doc_leadtime"),
  estimatedDesignHours: text("estimated_design_hours"),
  designCost: text("design_cost"),
  designLeadTimeWeeks: text("design_lead_time_weeks"),
  designHourlyRate: text("design_hourly_rate"),
  designHoursPerWeek: text("design_hours_per_week"),
  designCapacityFactor: text("design_capacity_factor"),
  pnGuidance: text("pn_guidance"),
  riskScore: text("risk_score"),
  riskNotes: text("risk_notes"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertEngineeringOutput = typeof engineeringOutputsTable.$inferInsert;
export type EngineeringOutput = typeof engineeringOutputsTable.$inferSelect;
