ALTER TABLE event_document_chunks
  ADD COLUMN IF NOT EXISTS embedding_vector TEXT,
  ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER;

UPDATE event_document_chunks
SET embedding_status = 'pending',
    embedded_at = NULL
WHERE embedding_status = 'ready'
  AND (embedding_vector IS NULL OR COALESCE(embedding_dimensions, 0) = 0);

UPDATE event_documents d
SET embedding_status = 'pending',
    last_embedded_at = NULL
WHERE d.embedding_status = 'ready'
  AND EXISTS (
    SELECT 1
    FROM event_document_chunks c
    WHERE c.document_id = d.id
      AND (c.embedding_vector IS NULL OR COALESCE(c.embedding_dimensions, 0) = 0)
  );
