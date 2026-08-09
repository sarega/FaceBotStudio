CREATE TABLE IF NOT EXISTS direct_orders (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  performance_id TEXT NOT NULL REFERENCES event_performances(id) ON DELETE RESTRICT,
  customer_account_id TEXT REFERENCES customer_accounts(id) ON DELETE SET NULL,
  buyer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'THB',
  subtotal_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  platform_fee_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payment_fee_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  fee_rule_version TEXT NOT NULL DEFAULT 'v1',
  tax_snapshot_json TEXT NOT NULL DEFAULT '{}',
  billing_profile_json TEXT NOT NULL DEFAULT '{}',
  seller_snapshot_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'payment_submitted', 'paid', 'rejected', 'expired', 'refunded', 'cancelled')),
  payment_reference TEXT,
  payment_proof_mime TEXT,
  payment_proof_base64 TEXT,
  payment_proof_submitted_at TIMESTAMPTZ,
  rejection_reason TEXT,
  hold_expires_at TIMESTAMPTZ,
  billing_document_status TEXT NOT NULL DEFAULT 'not_required' CHECK (billing_document_status IN ('not_required', 'pending', 'issued')),
  billing_document_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES direct_orders(id) ON DELETE SET NULL;
ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS customer_account_id TEXT REFERENCES customer_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES direct_orders(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  method TEXT NOT NULL DEFAULT 'promptpay' CHECK (method IN ('promptpay', 'scb_qr', 'manual')),
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'proof_submitted', 'verified', 'rejected', 'refunded')),
  transaction_reference TEXT,
  proof_mime TEXT,
  proof_base64 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_id, attempt_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_reference
  ON payment_attempts (transaction_reference)
  WHERE transaction_reference IS NOT NULL AND status = 'verified';
CREATE INDEX IF NOT EXISTS idx_direct_orders_customer
  ON direct_orders (customer_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_orders_event_status
  ON direct_orders (event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_tickets_order
  ON direct_tickets (order_id);
CREATE INDEX IF NOT EXISTS idx_direct_orders_expiring
  ON direct_orders (hold_expires_at)
  WHERE status IN ('pending_payment', 'payment_submitted');
