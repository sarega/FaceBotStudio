ALTER TABLE users ADD COLUMN staff_reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN staff_reset_expires_at TEXT;
ALTER TABLE users ADD COLUMN staff_reset_email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_staff_reset_token_unique ON users (staff_reset_token_hash);
