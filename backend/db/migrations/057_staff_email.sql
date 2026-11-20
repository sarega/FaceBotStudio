ALTER TABLE users ADD COLUMN staff_email TEXT;
ALTER TABLE users ADD COLUMN pending_staff_email TEXT;
ALTER TABLE users ADD COLUMN staff_email_token_hash TEXT;
ALTER TABLE users ADD COLUMN staff_email_expires_at TEXT;
ALTER TABLE users ADD COLUMN staff_email_purpose TEXT;
CREATE UNIQUE INDEX users_staff_email_unique ON users (staff_email);
CREATE UNIQUE INDEX users_staff_email_token_unique ON users (staff_email_token_hash);
