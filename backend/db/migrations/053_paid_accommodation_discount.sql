-- Category-specific discount for attendees who decline accommodation.
ALTER TABLE paid_categories ADD COLUMN accommodation_discount_minor INTEGER NOT NULL DEFAULT 0
  CHECK (accommodation_discount_minor >= 0 AND accommodation_discount_minor <= unit_minor);
