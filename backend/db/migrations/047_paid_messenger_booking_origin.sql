CREATE TABLE IF NOT EXISTS paid_messenger_booking_origins (
  booking_id TEXT PRIMARY KEY REFERENCES paid_bookings(id) ON DELETE RESTRICT,
  page_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('th','en')),
  inbound_ms BIGINT NOT NULL
);
