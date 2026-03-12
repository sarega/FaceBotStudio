CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'image',
  url TEXT NOT NULL,
  absolute_url TEXT,
  mime_type TEXT,
  name TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id
  ON message_attachments (message_id, created_at ASC);
