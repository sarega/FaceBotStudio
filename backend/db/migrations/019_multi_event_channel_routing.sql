ALTER TABLE channel_event_assignments
  DROP CONSTRAINT IF EXISTS channel_event_assignments_pkey;

ALTER TABLE channel_event_assignments
  ADD PRIMARY KEY (channel_id, event_id);

CREATE TABLE IF NOT EXISTS channel_sender_event_selections (
  channel_id TEXT NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, sender_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_sender_event_selections_event_id
  ON channel_sender_event_selections (event_id);
