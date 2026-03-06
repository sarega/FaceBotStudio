ALTER TABLE checkin_sessions
  ADD COLUMN IF NOT EXISTS exchanged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_checkin_sessions_exchange_state
  ON checkin_sessions (token_hash, revoked_at, exchanged_at, expires_at);

CREATE TABLE IF NOT EXISTS checkin_access_sessions (
  id TEXT PRIMARY KEY,
  checkin_session_id TEXT NOT NULL REFERENCES checkin_sessions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_checkin_access_sessions_token_hash
  ON checkin_access_sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_checkin_access_sessions_session_id
  ON checkin_access_sessions (checkin_session_id);

CREATE INDEX IF NOT EXISTS idx_checkin_access_sessions_expires_at
  ON checkin_access_sessions (expires_at);
