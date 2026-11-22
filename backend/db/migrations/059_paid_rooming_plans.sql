CREATE TABLE IF NOT EXISTS paid_rooming_plans (
  event_id TEXT PRIMARY KEY REFERENCES paid_event_settings(event_id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  rooms_json TEXT NOT NULL
);
