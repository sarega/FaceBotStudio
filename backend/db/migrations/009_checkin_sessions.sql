CREATE TABLE IF NOT EXISTS checkin_sessions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_checkin_sessions_event_id
  ON checkin_sessions (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkin_sessions_token_hash
  ON checkin_sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_checkin_sessions_expires_at
  ON checkin_sessions (expires_at);
