ALTER TABLE event_performances
  ADD COLUMN IF NOT EXISTS seat_plan_image_url TEXT;

ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;
ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS payment_proof_mime TEXT;
ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS payment_proof_base64 TEXT;
ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS payment_proof_submitted_at TIMESTAMPTZ;
ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin';

UPDATE direct_tickets
SET payment_status = 'awaiting_payment'
WHERE payment_status = 'pending';

ALTER TABLE direct_tickets DROP CONSTRAINT IF EXISTS direct_tickets_payment_status_check;
ALTER TABLE direct_tickets
  ADD CONSTRAINT direct_tickets_payment_status_check
  CHECK (payment_status IN (
    'awaiting_payment',
    'proof_submitted',
    'verified',
    'not_required',
    'rejected',
    'expired',
    'refunded'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_tickets_verified_payment_reference
  ON direct_tickets (payment_reference)
  WHERE payment_status = 'verified' AND payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_direct_tickets_review_queue
  ON direct_tickets (event_id, payment_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_direct_tickets_expiring_holds
  ON direct_tickets (hold_expires_at)
  WHERE status = 'held';
