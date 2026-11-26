ALTER TABLE memberships ADD COLUMN IF NOT EXISTS event_scope TEXT NOT NULL DEFAULT 'all' CHECK (event_scope IN ('all','selected'));
