ALTER TABLE registrations ADD COLUMN IF NOT EXISTS sms_opt_in_at TIMESTAMPTZ;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS sms_opt_out_at TIMESTAMPTZ;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS sms_consent_source TEXT;

CREATE INDEX IF NOT EXISTS idx_registrations_sms_opt_in
  ON registrations (event_id, sms_opt_in_at)
  WHERE sms_opt_in_at IS NOT NULL AND sms_opt_out_at IS NULL;
