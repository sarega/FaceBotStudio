ALTER TABLE registrations ADD COLUMN IF NOT EXISTS channel_platform TEXT;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS channel_external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_registrations_reply_route
  ON registrations (event_id, channel_platform, channel_external_id);
