import { createHash } from "crypto";
import type { EmbeddingStatus } from "./db/types";

export interface PreparedDocumentChunk {
  chunk_index: number;
  content: string;
  content_hash: string;
  char_count: number;
  token_estimate: number;
}

const DEFAULT_MAX_CHARS = 900;
const DEFAULT_OVERLAP_CHARS = 160;
const LOOKBACK_WINDOW = 180;

export function normalizeDocumentContent(value: unknown) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hashDocumentContent(value: unknown) {
  const normalized = normalizeDocumentContent(value);
  return createHash("sha256").update(normalized).digest("hex");
}

export function estimateTokenCount(value: unknown) {
  const normalized = normalizeDocumentContent(value);
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function getEmbeddingModelName() {
  return String(
    process.env.OPENROUTER_EMBEDDING_MODEL ||
      process.env.EMBEDDING_MODEL ||
      "text-embedding-3-small",
  ).trim();
}

export function getDefaultEmbeddingStatus(isActive: boolean): EmbeddingStatus {
  return isActive ? "pending" : "skipped";
}

function chooseChunkBoundary(text: string, start: number, desiredEnd: number) {
  if (desiredEnd >= text.length) return text.length;

  const sliceStart = Math.max(start, desiredEnd - LOOKBACK_WINDOW);
  const slice = text.slice(sliceStart, desiredEnd);
  const newlineBoundary = slice.lastIndexOf("\n");
  if (newlineBoundary >= 0) {
    return sliceStart + newlineBoundary;
  }

  const sentenceBoundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (sentenceBoundary >= 0) {
    return sliceStart + sentenceBoundary + 1;
  }

  const wordBoundary = slice.lastIndexOf(" ");
  if (wordBoundary >= 0) {
    return sliceStart + wordBoundary;
  }

  return desiredEnd;
}

export function chunkDocumentContent(
  value: unknown,
  options?: { maxChars?: number; overlapChars?: number },
) {
  const text = normalizeDocumentContent(value);
  if (!text) return [] as PreparedDocumentChunk[];

  const maxChars = Math.max(300, options?.maxChars || DEFAULT_MAX_CHARS);
  const overlapChars = Math.max(0, Math.min(Math.floor(maxChars / 2), options?.overlapChars || DEFAULT_OVERLAP_CHARS));
  const chunks: PreparedDocumentChunk[] = [];

  let start = 0;
  let index = 0;

  while (start < text.length) {
    const desiredEnd = Math.min(text.length, start + maxChars);
    let end = chooseChunkBoundary(text, start, desiredEnd);
    if (end <= start) {
      end = desiredEnd;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push({
        chunk_index: index,
        content: chunk,
        content_hash: hashDocumentContent(chunk),
        char_count: chunk.length,
        token_estimate: estimateTokenCount(chunk),
      });
      index += 1;
    }

    if (end >= text.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }

  return chunks;
}

export function buildEmbeddingHookPayload(
  document: {
    id: string;
    event_id: string;
    title: string;
    source_type: string;
    source_url?: string | null;
    content_hash?: string | null;
    embedding_status?: EmbeddingStatus;
  },
  chunks: Array<{
    id: string;
    chunk_index: number;
    content: string;
    content_hash?: string | null;
    char_count?: number;
    token_estimate?: number;
    embedding_status?: EmbeddingStatus;
  }>,
) {
  const embeddingModel = getEmbeddingModelName();
  return {
    event_id: document.event_id,
    document_id: document.id,
    document_title: document.title,
    source_type: document.source_type,
    source_url: document.source_url || null,
    document_content_hash: document.content_hash || null,
    embedding_model: embeddingModel,
    items: chunks.map((chunk) => ({
      chunk_id: chunk.id,
      chunk_index: chunk.chunk_index,
      text: chunk.content,
      metadata: {
        event_id: document.event_id,
        document_id: document.id,
        document_title: document.title,
        source_type: document.source_type,
        source_url: document.source_url || null,
        content_hash: chunk.content_hash || null,
        char_count: chunk.char_count ?? chunk.content.length,
        token_estimate: chunk.token_estimate ?? estimateTokenCount(chunk.content),
        embedding_status: chunk.embedding_status || "pending",
      },
    })),
  };
}
