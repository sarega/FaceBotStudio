CREATE TABLE IF NOT EXISTS event_document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES event_documents(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_document_chunks_event_id
  ON event_document_chunks (event_id);

CREATE INDEX IF NOT EXISTS idx_event_document_chunks_document_id
  ON event_document_chunks (document_id);

CREATE INDEX IF NOT EXISTS idx_event_document_chunks_order
  ON event_document_chunks (document_id, chunk_index);
