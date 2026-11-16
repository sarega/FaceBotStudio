CREATE TABLE IF NOT EXISTS paid_payment_attempts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  method TEXT NOT NULL CHECK (method IN ('promptpay','bank_transfer','manual')),
  status TEXT NOT NULL CHECK (status IN ('proof_submitted','verified','rejected','exception')),
  claimed_minor BIGINT CHECK (claimed_minor BETWEEN 1 AND 9007199254740991),
  claimed_transfer_ms BIGINT,
  claimed_reference TEXT,
  observed_minor BIGINT CHECK (observed_minor BETWEEN 1 AND 9007199254740991),
  observed_transfer_ms BIGINT,
  trusted_reference TEXT,
  receiver_namespace TEXT,
  reviewed_by TEXT,
  reviewed_ms BIGINT,
  reason TEXT,
  created_ms BIGINT NOT NULL,
  UNIQUE (booking_id,sequence),
  UNIQUE (event_id,booking_id,id),
  FOREIGN KEY (event_id,booking_id) REFERENCES paid_bookings(event_id,id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paid_one_verified_attempt
  ON paid_payment_attempts (booking_id) WHERE status='verified';
CREATE UNIQUE INDEX IF NOT EXISTS idx_paid_trusted_reference
  ON paid_payment_attempts (receiver_namespace,trusted_reference) WHERE trusted_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_paid_review_queue ON paid_payment_attempts (event_id,status,created_ms);

CREATE TABLE IF NOT EXISTS paid_proofs (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES paid_payment_attempts(id) ON DELETE RESTRICT,
  mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 4194304),
  content BYTEA,
  checksum TEXT NOT NULL CHECK (length(checksum)=64),
  uploader_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE RESTRICT,
  created_ms BIGINT NOT NULL,
  deleted_ms BIGINT,
  CHECK (content IS NOT NULL OR deleted_ms IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_paid_proof_checksum ON paid_proofs (checksum);
