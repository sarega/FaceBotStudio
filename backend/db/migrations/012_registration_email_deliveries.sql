CREATE TABLE IF NOT EXISTS registration_email_deliveries (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  subject TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (registration_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_registration_email_deliveries_event_status
  ON registration_email_deliveries (event_id, status, queued_at DESC);
