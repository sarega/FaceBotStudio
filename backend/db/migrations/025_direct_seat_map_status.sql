ALTER TABLE direct_seats
  ADD COLUMN IF NOT EXISTS allocation_status TEXT NOT NULL DEFAULT 'allocated',
  ADD COLUMN IF NOT EXISTS source_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS section_label TEXT;

ALTER TABLE direct_seats
  DROP CONSTRAINT IF EXISTS direct_seats_allocation_status_check;

ALTER TABLE direct_seats
  ADD CONSTRAINT direct_seats_allocation_status_check
  CHECK (allocation_status IN ('allocated', 'not_allocated'));

ALTER TABLE direct_seats
  DROP CONSTRAINT IF EXISTS direct_seats_source_status_check;

ALTER TABLE direct_seats
  ADD CONSTRAINT direct_seats_source_status_check
  CHECK (source_status IN ('available', 'sold', 'generated', 'blocked', 'unknown'));
