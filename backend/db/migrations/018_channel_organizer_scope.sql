ALTER TABLE channel_accounts
  ADD COLUMN IF NOT EXISTS organizer_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE channel_accounts ca
SET organizer_id = COALESCE(NULLIF(ca.organizer_id, ''), e.organizer_id, 'org_default')
FROM events e
WHERE ca.event_id = e.id
  AND (ca.organizer_id IS NULL OR BTRIM(ca.organizer_id) = '');

UPDATE channel_accounts
SET organizer_id = 'org_default'
WHERE organizer_id IS NULL OR BTRIM(organizer_id) = '';

CREATE INDEX IF NOT EXISTS idx_channel_accounts_organizer_id
  ON channel_accounts (organizer_id);
