CREATE TABLE IF NOT EXISTS paid_booking_receivers (
  booking_id TEXT PRIMARY KEY REFERENCES paid_bookings(id) ON DELETE RESTRICT,
  receiver_id TEXT NOT NULL CHECK (length(receiver_id) BETWEEN 10 AND 15),
  receiver_name TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK (profile_version > 0)
);
