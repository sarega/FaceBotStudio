CREATE TABLE IF NOT EXISTS channel_event_assignments (
  channel_id TEXT PRIMARY KEY REFERENCES channel_accounts(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_channel_event_assignments_event_id
  ON channel_event_assignments (event_id);

INSERT INTO channel_event_assignments (channel_id, event_id)
SELECT ca.id, ca.event_id
FROM channel_accounts ca
WHERE ca.event_id IS NOT NULL
  AND BTRIM(ca.event_id) <> ''
ON CONFLICT (channel_id) DO NOTHING;
