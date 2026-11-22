ALTER TABLE users ADD COLUMN staff_customer_account_id TEXT REFERENCES customer_accounts(id);
CREATE UNIQUE INDEX IF NOT EXISTS users_staff_customer_account_unique ON users (staff_customer_account_id);
UPDATE users
SET staff_customer_account_id = (
  SELECT id FROM customer_accounts
  WHERE normalized_email = users.staff_email AND status = 'active' AND email_verified_at IS NOT NULL
)
WHERE staff_email IS NOT NULL AND staff_email_purpose IS NULL AND staff_customer_account_id IS NULL
  AND EXISTS (SELECT 1 FROM audit_logs a
    WHERE a.target_type = 'user' AND a.target_id = users.id AND a.action = 'auth.staff_invite_accepted');
