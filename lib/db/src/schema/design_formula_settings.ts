import { integer, serial, text, timestamp } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";

export const designFormulaSettingsTable = crmSchema.table(ETO_TABLE_NAMES.design_formula_settings, {
  id: integer("id").primaryKey(),
  hourlyRate: text("hourly_rate").notNull(),
  hoursPerWeek: text("hours_per_week").notNull(),
  capacityFactor: text("capacity_factor").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const designFormulaChangesTable = crmSchema.table(ETO_TABLE_NAMES.design_formula_changes, {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").notNull(),
  actorName: text("actor_name").notNull(),
  actorEmail: text("actor_email").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  previousHourlyRate: text("previous_hourly_rate").notNull(),
  previousHoursPerWeek: text("previous_hours_per_week").notNull(),
  previousCapacityFactor: text("previous_capacity_factor").notNull(),
  newHourlyRate: text("new_hourly_rate").notNull(),
  newHoursPerWeek: text("new_hours_per_week").notNull(),
  newCapacityFactor: text("new_capacity_factor").notNull(),
});
