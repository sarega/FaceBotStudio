CREATE TABLE IF NOT EXISTS paid_booking_credits (
  booking_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customer_accounts(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  FOREIGN KEY(event_id,booking_id) REFERENCES paid_bookings(event_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_paid_booking_credits_owner ON paid_booking_credits(event_id,customer_id);

CREATE TABLE IF NOT EXISTS paid_booking_credit_uses (
  booking_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customer_accounts(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  FOREIGN KEY(event_id,booking_id) REFERENCES paid_bookings(event_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_paid_booking_credit_uses_owner ON paid_booking_credit_uses(event_id,customer_id);
