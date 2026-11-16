CREATE TABLE IF NOT EXISTS paid_messenger_link_tokens (
  token_hash TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES paid_event_settings(event_id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  expires_ms BIGINT NOT NULL,
  consumed_ms BIGINT,
  consumed_page_id TEXT,
  consumed_sender_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_paid_messenger_link_expiry ON paid_messenger_link_tokens (expires_ms);

CREATE TABLE IF NOT EXISTS paid_messenger_links (
  event_id TEXT NOT NULL REFERENCES paid_event_settings(event_id) ON DELETE RESTRICT,
  page_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  linked_ms BIGINT NOT NULL,
  PRIMARY KEY (event_id,page_id,sender_id),
  UNIQUE (event_id,page_id,customer_id)
);
