CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  default_instruction TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outreach_targets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  facebook_page_url TEXT NOT NULL DEFAULT '',
  facebook_page_id TEXT,
  organization_type TEXT NOT NULL DEFAULT 'other',
  contact_person TEXT,
  email TEXT,
  website TEXT,
  notes TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'drafted', 'approved', 'contacted', 'waiting_reply', 'replied', 'press_kit_sent', 'follow_up', 'published', 'declined', 'no_response')),
  delivery_mode TEXT NOT NULL DEFAULT 'manual_first_contact' CHECK (delivery_mode IN ('manual_first_contact', 'api_reply_eligible', 'manual_only', 'unavailable')),
  bound_sender_id TEXT,
  bound_page_id TEXT,
  last_contacted_at TIMESTAMPTZ,
  last_replied_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,
  outcome_note TEXT,
  assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outreach_drafts (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES outreach_targets(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial', 'suggested_reply')),
  source_message_id BIGINT,
  approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'approved')),
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (target_id, revision)
);

CREATE TABLE IF NOT EXISTS outreach_assets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS last_replied_at TIMESTAMPTZ;
ALTER TABLE outreach_targets ADD COLUMN IF NOT EXISTS assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS source_message_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_event_updated ON outreach_campaigns (event_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_targets_campaign_status ON outreach_targets (campaign_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_targets_identity ON outreach_targets (event_id, bound_page_id, bound_sender_id);
CREATE INDEX IF NOT EXISTS idx_outreach_targets_follow_up ON outreach_targets (event_id, next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_outreach_targets_replied ON outreach_targets (event_id, last_replied_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_targets_assignee ON outreach_targets (event_id, assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_target_revision ON outreach_drafts (target_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_assets_campaign ON outreach_assets (campaign_id, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_deliveries_target ON outreach_deliveries (event_id, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_deliveries_idempotency ON outreach_deliveries (event_id, idempotency_key);
