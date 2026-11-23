CREATE TABLE IF NOT EXISTS paid_attendee_price_flags (
  attendee_id TEXT PRIMARY KEY REFERENCES paid_attendees(id) ON DELETE CASCADE,
  flagged_by TEXT NOT NULL,
  flagged_ms BIGINT NOT NULL
);
