CREATE TABLE IF NOT EXISTS customer_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  normalized_phone TEXT NOT NULL DEFAULT '',
  address_line1 TEXT,
  address_line2 TEXT,
  district TEXT,
  subdistrict TEXT,
  province TEXT,
  postal_code TEXT,
  country TEXT,
  accepted_terms_at TIMESTAMPTZ NOT NULL,
  accepted_privacy_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,
  customer_account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_account_tokens (
  id TEXT PRIMARY KEY,
  customer_account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('email_verification', 'password_reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_token_hash
  ON customer_sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires_at
  ON customer_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_customer_account_tokens_token_hash
  ON customer_account_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_customer_account_tokens_account_kind
  ON customer_account_tokens (customer_account_id, kind, created_at DESC);
