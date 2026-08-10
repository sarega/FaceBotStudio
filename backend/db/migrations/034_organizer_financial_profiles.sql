CREATE TABLE IF NOT EXISTS organization_financial_profiles (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL DEFAULT 'promptpay' CHECK (payment_method IN ('promptpay')),
  promptpay_id TEXT,
  promptpay_receiver_name TEXT,
  payment_status TEXT NOT NULL DEFAULT 'draft' CHECK (payment_status IN ('draft', 'active', 'suspended')),
  legal_entity_type TEXT NOT NULL DEFAULT 'individual' CHECK (legal_entity_type IN ('individual', 'company', 'partnership', 'other')),
  tax_id TEXT,
  vat_status TEXT NOT NULL DEFAULT 'unknown' CHECK (vat_status IN ('not_registered', 'registered', 'exempt', 'unknown')),
  vat_rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  registered_address TEXT,
  branch_number TEXT,
  billing_document_mode TEXT NOT NULL DEFAULT 'not_required' CHECK (billing_document_mode IN ('not_required', 'receipt', 'tax_invoice', 'e_tax')),
  platform_fee_type TEXT NOT NULL DEFAULT 'percent' CHECK (platform_fee_type IN ('percent', 'fixed')),
  platform_fee_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  platform_fee_payer TEXT NOT NULL DEFAULT 'customer' CHECK (platform_fee_payer IN ('customer', 'organizer')),
  payment_fee_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payout_mode TEXT NOT NULL DEFAULT 'direct_to_organizer' CHECK (payout_mode IN ('direct_to_organizer', 'platform_settlement')),
  payout_schedule TEXT NOT NULL DEFAULT 'manual' CHECK (payout_schedule IN ('manual', 'daily', 'weekly', 'monthly')),
  payout_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (payout_status IN ('not_applicable', 'ready', 'blocked')),
  pricing_policy_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE direct_orders ADD COLUMN IF NOT EXISTS seller_organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE direct_orders ADD COLUMN IF NOT EXISTS payment_profile_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE direct_orders ADD COLUMN IF NOT EXISTS payment_receiver_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE direct_orders ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK (payout_status IN ('not_applicable', 'pending', 'ready', 'paid', 'blocked'));
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS receiver_snapshot_json TEXT NOT NULL DEFAULT '{}';

UPDATE direct_orders o
SET seller_organization_id = e.organizer_id
FROM events e
WHERE e.id = o.event_id
  AND (o.seller_organization_id IS NULL OR BTRIM(o.seller_organization_id) = '');

CREATE INDEX IF NOT EXISTS idx_direct_orders_seller_organization
  ON direct_orders (seller_organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_organization_financial_profiles_payment_status
  ON organization_financial_profiles (payment_status);
