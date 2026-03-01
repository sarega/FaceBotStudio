CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE event_documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS last_embedded_at TIMESTAMPTZ;

ALTER TABLE event_document_chunks
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS char_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_estimate INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_event_documents_embedding_status
  ON event_documents (event_id, embedding_status);

CREATE INDEX IF NOT EXISTS idx_event_document_chunks_embedding_status
  ON event_document_chunks (event_id, embedding_status);

UPDATE event_documents
SET
  content_hash = encode(digest(COALESCE(content, ''), 'sha256'), 'hex'),
  embedding_status = CASE WHEN is_active THEN 'pending' ELSE 'skipped' END,
  embedding_model = COALESCE(embedding_model, 'text-embedding-3-small')
WHERE
  content_hash IS NULL
  OR embedding_model IS NULL;

UPDATE event_document_chunks
SET
  content_hash = encode(digest(COALESCE(content, ''), 'sha256'), 'hex'),
  char_count = LENGTH(COALESCE(content, '')),
  token_estimate = GREATEST(1, CEIL(LENGTH(COALESCE(content, '')) / 4.0)::int),
  embedding_status = COALESCE(NULLIF(embedding_status, ''), 'pending'),
  embedding_model = COALESCE(embedding_model, 'text-embedding-3-small')
WHERE
  content_hash IS NULL
  OR char_count = 0
  OR token_estimate = 0
  OR embedding_model IS NULL;
