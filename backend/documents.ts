export interface PreparedDocumentChunk {
  chunk_index: number;
  content: string;
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
      });
      index += 1;
    }

    if (end >= text.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }

  return chunks;
}
