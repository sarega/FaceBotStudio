-- Event-scoped coupon rules and immutable booking redemption snapshots.
CREATE TABLE IF NOT EXISTS paid_coupons (
  event_id TEXT NOT NULL REFERENCES paid_event_settings(event_id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed','free')),
  value_minor INTEGER NOT NULL CHECK (value_minor >= 0),
  max_uses INTEGER CHECK (max_uses > 0),
  per_customer_limit INTEGER CHECK (per_customer_limit > 0),
  starts_ms BIGINT,
  ends_ms BIGINT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_ms BIGINT NOT NULL,
  updated_ms BIGINT NOT NULL,
  PRIMARY KEY (event_id,code),
  CHECK (starts_ms IS NULL OR ends_ms IS NULL OR starts_ms < ends_ms)
);
CREATE TABLE IF NOT EXISTS paid_coupon_redemptions (
  event_id TEXT NOT NULL,
  code TEXT NOT NULL,
  booking_id TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  discount_minor BIGINT NOT NULL CHECK (discount_minor >= 0),
  subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= discount_minor),
  created_ms BIGINT NOT NULL,
  PRIMARY KEY (event_id,booking_id),
  FOREIGN KEY (event_id,code) REFERENCES paid_coupons(event_id,code) ON DELETE RESTRICT,
  FOREIGN KEY (event_id,booking_id) REFERENCES paid_bookings(event_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_paid_coupon_lookup ON paid_coupon_redemptions(event_id,code,customer_id);

-- Complimentary bookings (100% discount) must store an actual zero total.
ALTER TABLE paid_bookings DROP CONSTRAINT IF EXISTS paid_bookings_total_minor_check;
ALTER TABLE paid_bookings ADD CONSTRAINT paid_bookings_total_minor_check
  CHECK (total_minor BETWEEN 0 AND 9007199254740991);
