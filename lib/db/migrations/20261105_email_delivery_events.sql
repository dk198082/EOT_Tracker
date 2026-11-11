BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS crm.eto_email_delivery_events (
  id serial PRIMARY KEY,
  eto_request_id integer NOT NULL REFERENCES crm.eto_requests(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  recipients text[] NOT NULL,
  messages jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS eto_email_delivery_events_request_created_idx
  ON crm.eto_email_delivery_events (eto_request_id, created_at, id);
COMMIT;
