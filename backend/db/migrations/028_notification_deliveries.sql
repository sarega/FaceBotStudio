CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'facebook')),
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  recipient_snapshot TEXT,
  related_type TEXT,
  related_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  provider TEXT,
  provider_message_id TEXT,
  last_error TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_claim
  ON notification_deliveries (status, available_at, queued_at);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_related
  ON notification_deliveries (related_type, related_id, queued_at DESC);
