CREATE TABLE IF NOT EXISTS paid_event_forms (
  event_id TEXT PRIMARY KEY REFERENCES paid_event_settings(event_id) ON DELETE RESTRICT,
  fields_json TEXT NOT NULL
);
