CREATE TABLE IF NOT EXISTS paid_carpool_plans (
  event_id TEXT PRIMARY KEY REFERENCES paid_event_settings(event_id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  layout_json TEXT NOT NULL
);
