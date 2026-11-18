ALTER TABLE paid_event_settings ADD COLUMN deadline_mode TEXT NOT NULL DEFAULT 'relative'
  CHECK (deadline_mode IN ('relative', 'fixed') AND (deadline_mode <> 'fixed' OR cutoff_ms IS NOT NULL));
