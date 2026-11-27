CREATE TABLE IF NOT EXISTS paid_surplus_settlements (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL,
 booking_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('external','refund')),
 amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
 reference TEXT NOT NULL UNIQUE,
 recorded_by TEXT NOT NULL,
 reason TEXT NOT NULL,
 recorded_ms BIGINT NOT NULL,
 FOREIGN KEY(event_id,booking_id) REFERENCES paid_bookings(event_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_paid_surplus_booking ON paid_surplus_settlements(booking_id);
