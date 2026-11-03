import { serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";
import { etoRequestsTable } from "./eto_requests";
import { usersTable } from "./users";

export const stageTransitionsTable = crmSchema.table(ETO_TABLE_NAMES.stage_transitions, {
  id: serial("id").primaryKey(),
  etoRequestId: integer("eto_request_id").notNull().references(() => etoRequestsTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  simulatedRole: text("simulated_role"),
  fromStage: text("from_stage").notNull(),
  toStage: text("to_stage").notNull(),
  decision: text("decision").notNull(), // e.g. approve-engineering, engineering-quote-ready, etc.
  reason: text("reason"), // required for decline/more-info decisions
  includeEngineeringReview: boolean("include_engineering_review"),
  includeProductionReview: boolean("include_production_review"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InsertStageTransition = typeof stageTransitionsTable.$inferInsert;
export type StageTransition = typeof stageTransitionsTable.$inferSelect;
