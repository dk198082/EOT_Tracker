import { pgSchema } from "drizzle-orm/pg-core";

export const ETO_DATABASE = "d365crm";
export const ETO_SCHEMA = "crm";
export const crmSchema = pgSchema(ETO_SCHEMA);

/** Existing eto-prefixed names keep one prefix, not eto_eto_. */
export const ETO_TABLE_NAMES = {
  users: "eto_users",
  email_notification_settings: "eto_email_notification_settings",
  sessions: "eto_sessions",
  eto_requests: "eto_requests",
  stage_transitions: "eto_stage_transitions",
  comments: "eto_comments",
  attachments: "eto_attachments",
  engineering_outputs: "eto_engineering_outputs",
  production_outputs: "eto_production_outputs",
  art_final_outputs: "eto_art_final_outputs",
  detail_changes: "eto_detail_changes",
  data_imports: "eto_data_imports",
  review_assignment_defaults: "eto_review_assignment_defaults",
  price_calculator_settings: "eto_price_calculator_settings",
  eto_price_calculator: "eto_price_calculator",
  design_formula_settings: "eto_design_formula_settings",
  design_formula_changes: "eto_design_formula_changes",
  assembly_formula_settings: "eto_assembly_formula_settings",
  assembly_formula_changes: "eto_assembly_formula_changes",
} as const;
