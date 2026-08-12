ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'unsent';

ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS delivery_method TEXT;

ALTER TABLE direct_tickets
  ADD COLUMN IF NOT EXISTS delivery_sent_at TIMESTAMPTZ;
