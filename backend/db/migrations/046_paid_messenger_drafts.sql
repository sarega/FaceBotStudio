CREATE TABLE IF NOT EXISTS paid_messenger_drafts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES paid_event_settings(event_id) ON DELETE RESTRICT,
  page_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  message_key TEXT NOT NULL,
  attendees_json TEXT NOT NULL,
  pricing_version INTEGER NOT NULL,
  total_minor BIGINT NOT NULL,
  expires_ms BIGINT NOT NULL,
  receipt_json TEXT,
  UNIQUE(event_id,page_id,sender_id,message_key)
);
CREATE INDEX IF NOT EXISTS idx_paid_messenger_drafts_expiry ON paid_messenger_drafts (event_id,expires_ms);
