CREATE TABLE IF NOT EXISTS customer_notification_preferences (
  customer_account_id TEXT PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
  email_transactional_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sms_transactional_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sms_marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sms_consent_at TIMESTAMPTZ,
  sms_opted_out_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_notification_preferences_sms
  ON customer_notification_preferences (sms_transactional_enabled, sms_marketing_enabled);
