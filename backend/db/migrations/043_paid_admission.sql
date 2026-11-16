CREATE TABLE IF NOT EXISTS paid_credentials (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  attendee_id TEXT NOT NULL REFERENCES paid_attendees(id) ON DELETE RESTRICT,
  issued_ms BIGINT NOT NULL,
  revoked_ms BIGINT,
  FOREIGN KEY (event_id,booking_id) REFERENCES paid_bookings(event_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_paid_live_credential
  ON paid_credentials (attendee_id) WHERE revoked_ms IS NULL;

CREATE TABLE IF NOT EXISTS paid_verified_proof_checksums (
  checksum TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES paid_payment_attempts(id) ON DELETE RESTRICT
);
