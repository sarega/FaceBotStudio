DROP INDEX IF EXISTS idx_paid_one_verified_attempt;
CREATE INDEX IF NOT EXISTS idx_paid_verified_booking
  ON paid_payment_attempts (booking_id) WHERE status='verified';
