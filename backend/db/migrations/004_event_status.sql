ALTER TABLE events ADD COLUMN IF NOT EXISTS status TEXT;

UPDATE events
SET status = CASE
  WHEN status IS NOT NULL AND BTRIM(status) <> '' THEN status
  WHEN is_active = FALSE THEN 'closed'
  ELSE 'active'
END;

ALTER TABLE events ALTER COLUMN status SET DEFAULT 'active';

UPDATE events
SET status = 'active'
WHERE status IS NULL OR BTRIM(status) = '';
