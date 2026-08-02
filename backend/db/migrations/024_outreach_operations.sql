ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS last_replied_at TIMESTAMPTZ;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS source_message_id BIGINT;

CREATE TABLE IF NOT EXISTS outreach_deliveries (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES outreach_targets(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  draft_id TEXT REFERENCES outreach_drafts(id) ON DELETE SET NULL,
  asset_id TEXT REFERENCES outreach_assets(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'asset')),
  channel_platform TEXT NOT NULL,
  channel_external_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  external_message_id TEXT,
  error_message TEXT,
  sent_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_outreach_targets_replied ON outreach_targets (event_id, last_replied_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_targets_assignee ON outreach_targets (event_id, assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_deliveries_target ON outreach_deliveries (event_id, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_deliveries_idempotency ON outreach_deliveries (event_id, idempotency_key);
