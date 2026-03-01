CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type TEXT NOT NULL CHECK (type IN ('incoming', 'outgoing'))
);

CREATE INDEX IF NOT EXISTS idx_messages_sender_timestamp ON messages (sender_id, timestamp DESC, id DESC);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled', 'checked-in'))
);

CREATE INDEX IF NOT EXISTS idx_registrations_timestamp ON registrations (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations (status);
