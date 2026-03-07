CREATE TABLE IF NOT EXISTS user_event_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_user_event_assignments_user_id
  ON user_event_assignments (user_id);

CREATE INDEX IF NOT EXISTS idx_user_event_assignments_event_id
  ON user_event_assignments (event_id);
