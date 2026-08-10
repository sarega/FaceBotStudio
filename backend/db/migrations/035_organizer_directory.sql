CREATE TABLE IF NOT EXISTS organizer_profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  legal_name TEXT,
  public_display_name TEXT,
  public_description TEXT,
  public_logo_url TEXT,
  public_website_url TEXT,
  public_facebook_url TEXT,
  public_line_url TEXT,
  public_contact_text TEXT,
  verification_status TEXT NOT NULL DEFAULT 'draft' CHECK (verification_status IN ('draft', 'pending_review', 'verified', 'rejected', 'needs_update')),
  verification_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_organizer_profiles_organization
  ON organizer_profiles (organization_id, name);

CREATE TABLE IF NOT EXISTS organizer_financial_profiles (
  organizer_id TEXT PRIMARY KEY REFERENCES organizer_profiles(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_organizer_financial_profiles_payment_status
  ON organizer_financial_profiles (payment_status);

INSERT INTO organizer_profiles (
  id,
  organization_id,
  name,
  slug,
  legal_name,
  public_display_name,
  public_description,
  public_logo_url,
  public_website_url,
  public_facebook_url,
  public_line_url,
  public_contact_text,
  verification_status,
  verification_notes
)
SELECT
  'orgprof_' || o.id,
  o.id,
  o.name,
  o.slug,
  o.legal_name,
  o.public_display_name,
  o.public_description,
  o.public_logo_url,
  o.public_website_url,
  o.public_facebook_url,
  o.public_line_url,
  o.public_contact_text,
  COALESCE(NULLIF(BTRIM(o.verification_status), ''), 'draft'),
  o.verification_notes
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM organizer_profiles p WHERE p.organization_id = o.id AND p.slug = o.slug
);

INSERT INTO organizer_financial_profiles (
  organizer_id,
  payment_method,
  promptpay_id,
  promptpay_receiver_name,
  payment_status,
  legal_entity_type,
  tax_id,
  vat_status,
  vat_rate_percent,
  registered_address,
  branch_number,
  billing_document_mode,
  platform_fee_type,
  platform_fee_value,
  platform_fee_payer,
  payment_fee_value,
  payout_mode,
  payout_schedule,
  payout_status,
  pricing_policy_enabled,
  version
)
SELECT
  p.id,
  COALESCE(f.payment_method, 'promptpay'),
  f.promptpay_id,
  f.promptpay_receiver_name,
  COALESCE(f.payment_status, 'draft'),
  COALESCE(f.legal_entity_type, 'individual'),
  f.tax_id,
  COALESCE(f.vat_status, 'unknown'),
  COALESCE(f.vat_rate_percent, 0),
  f.registered_address,
  f.branch_number,
  COALESCE(f.billing_document_mode, 'not_required'),
  COALESCE(f.platform_fee_type, 'percent'),
  COALESCE(f.platform_fee_value, 0),
  COALESCE(f.platform_fee_payer, 'customer'),
  COALESCE(f.payment_fee_value, 0),
  COALESCE(f.payout_mode, 'direct_to_organizer'),
  COALESCE(f.payout_schedule, 'manual'),
  COALESCE(f.payout_status, 'not_applicable'),
  COALESCE(f.pricing_policy_enabled, FALSE),
  COALESCE(f.version, 1)
FROM organizer_profiles p
LEFT JOIN organization_financial_profiles f ON f.organization_id = p.organization_id
WHERE NOT EXISTS (
  SELECT 1 FROM organizer_financial_profiles nf WHERE nf.organizer_id = p.id
);
