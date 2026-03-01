CREATE TABLE IF NOT EXISTS channel_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  access_token TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_event_id ON channel_accounts (event_id);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_platform ON channel_accounts (platform);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_external_id ON channel_accounts (external_id);

INSERT INTO channel_accounts (id, platform, external_id, display_name, event_id, access_token, is_active, created_at, updated_at)
SELECT
  id,
  'facebook',
  page_id,
  page_name,
  event_id,
  page_access_token,
  is_active,
  created_at,
  updated_at
FROM facebook_pages
ON CONFLICT (platform, external_id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  event_id = EXCLUDED.event_id,
  access_token = COALESCE(NULLIF(EXCLUDED.access_token, ''), channel_accounts.access_token),
  is_active = EXCLUDED.is_active,
  updated_at = CURRENT_TIMESTAMP;
