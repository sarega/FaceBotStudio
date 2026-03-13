ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_display_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_description TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_logo_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_website_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_facebook_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_line_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_contact_text TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS verification_notes TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;

UPDATE events
SET organizer_id = 'org_default'
WHERE organizer_id IS NULL OR BTRIM(organizer_id) = '';

ALTER TABLE events ALTER COLUMN organizer_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_organizer_id ON events (organizer_id);
