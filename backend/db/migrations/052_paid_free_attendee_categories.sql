-- Permit no-charge attendee categories inside paid bookings (e.g. infants).
-- The booking itself still needs a positive total, to use the payment/approval workflow.
ALTER TABLE paid_categories DROP CONSTRAINT IF EXISTS paid_categories_unit_minor_check;
ALTER TABLE paid_categories ADD CONSTRAINT paid_categories_unit_minor_check CHECK (unit_minor >= 0);
ALTER TABLE paid_attendees DROP CONSTRAINT IF EXISTS paid_attendees_unit_minor_check;
ALTER TABLE paid_attendees ADD CONSTRAINT paid_attendees_unit_minor_check CHECK (unit_minor >= 0);
