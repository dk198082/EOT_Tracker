-- Additive migration for the shared external Azure database, not Replit-managed PG.
-- Missing rows are also treated as disabled by the application.
BEGIN;
CREATE TABLE IF NOT EXISTS crm.eto_email_notification_settings (
  notification_type text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO crm.eto_email_notification_settings(notification_type) VALUES
  ('art_submission'), ('sales_art_complete'), ('art_assignment'),
  ('engineering_assignment'), ('production_assignment'),
  ('engineering_reassignment'), ('production_reassignment'),
  ('quote_generated'), ('inactivity_reminder'), ('other_workflow_updates')
ON CONFLICT (notification_type) DO NOTHING;
COMMIT;
