import {
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
  boolean,
  date,
  doublePrecision,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { crmSchema, ETO_TABLE_NAMES } from "./namespace";

export const ETO_STAGES = [
  "draft",
  "art-review",
  "engineering-review",
  "production-review",
  "art-final-review",
  "quoted",
  "won",
  "declined",
  "lost",
  "abandoned",
  "closed", // legacy-only value retained so older rows remain readable
] as const;

export type EtoStage = (typeof ETO_STAGES)[number];

export const etoRequestsTable = crmSchema.table(ETO_TABLE_NAMES.eto_requests, {
  id: serial("id").primaryKey(),
  etoNumber: text("eto_number").unique(), // null until submitted to ART; e.g. ETO-2026-0001
  customerName: text("customer_name").notNull(),
  quoteNumber: text("quote_number").notNull(),
  quoteRevision: text("quote_revision").notNull().default(""),
  entity: text("entity"), // ART selection: TOUS | TOUK; historical requests may be null
  // legacy field – no longer shown in the new form
  testType: text("test_type").notNull().default(""),
  // ── new fields (2026-08-07) ──────────────────────────────────────────────
  distributor: text("distributor"),          // "Yes" | "No"
  requestType: text("request_type"),         // dropdown
  machineType: text("machine_type"),         // dropdown
  expectedForceRange: text("expected_force_range"),
  expectedForceUnit: text("expected_force_unit").notNull().default("N"),
  expectedDisplacement: text("expected_displacement"),
  expectedDisplacementUnit: text("expected_displacement_unit").notNull().default("mm"),
  resultsRequired: text("results_required"),
  budgetRange: text("budget_range"),
  budgetCurrency: text("budget_currency").notNull().default("USD"),
  acceptableLeadTime: text("acceptable_lead_time"),
  similarParts: text("similar_parts"),
  // ─────────────────────────────────────────────────────────────────────────
  materials: text("materials").notNull(),
  specimenDimensions: text("specimen_dimensions").notNull(),
  relevantStandards: text("relevant_standards"),
  customerComponents: text("customer_components"),
  customDetails: text("custom_details"),
  stage: text("stage").notNull().default("draft"),
  includeEngineeringReview: boolean("include_engineering_review").notNull().default(true),
  includeProductionReview: boolean("include_production_review").notNull().default(true),
  engineeringReviewDurationWeeks: doublePrecision("engineering_review_duration_weeks"),
  productionReviewDurationWeeks: doublePrecision("production_review_duration_weeks"),
  artFinalReviewDurationWeeks: doublePrecision("art_final_review_duration_weeks"),
  artReviewAcceptedDate: date("art_review_accepted_date", { mode: "string" }),
  dueDate: date("due_date", { mode: "string" }),
  assigneeId: integer("assignee_id").references(() => usersTable.id, { onDelete: "set null" }),
  productionAssigneeId: integer("production_assignee_id").references(() => usersTable.id, { onDelete: "set null" }),
  stickyEngineerUserId: integer("sticky_engineer_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  submittedById: integer("submitted_by_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  parentEtoRequestId: integer("parent_eto_request_id").references(
    (): AnyPgColumn => etoRequestsTable.id,
    { onDelete: "restrict" },
  ),
  splitSequence: integer("split_sequence"),
  hasSplitChildren: boolean("has_split_children").notNull().default(false),
  declineReason: text("decline_reason"),
  lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("eto_requests_parent_split_sequence_unique").on(
    table.parentEtoRequestId,
    table.splitSequence,
  ),
]);

export type InsertEtoRequest = typeof etoRequestsTable.$inferInsert;
export type EtoRequest = typeof etoRequestsTable.$inferSelect;
