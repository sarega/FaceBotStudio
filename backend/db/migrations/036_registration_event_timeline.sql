CREATE INDEX IF NOT EXISTS idx_registrations_event_timestamp
  ON registrations (event_id, timestamp DESC, id DESC);
