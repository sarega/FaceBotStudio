ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS customer_account_id TEXT REFERENCES customer_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_customer_account
  ON registrations (customer_account_id, timestamp DESC)
  WHERE customer_account_id IS NOT NULL;
