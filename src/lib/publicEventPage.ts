export const PUBLIC_SUMMARY_MAX_CHARS = 60;
export const PUBLIC_SLUG_MAX_LENGTH = 48;

function normalizeWhitespace(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateSlug(value: string, maxLength = PUBLIC_SLUG_MAX_LENGTH) {
  return value.slice(0, maxLength).replace(/-+$/g, "");
}

function sanitizeSlugSegment(value: string) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return truncateSlug(normalized);
}

export function sanitizeEnglishSlugInput(value: string | null | undefined) {
  return sanitizeSlugSegment(String(value || ""));
}

function buildEnglishFallbackSeed(eventId?: string | null) {
  const compactId = String(eventId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return compactId ? compactId.slice(0, 8) : "page";
}

export function countPublicSummaryChars(text: string) {
  return Array.from(normalizeWhitespace(text)).length;
}

function truncateTextByCharacters(value: string, maxChars: number) {
  if (!value) return "";
  return Array.from(value).slice(0, maxChars).join("");
}

export function truncatePublicSummary(value: string, maxChars = PUBLIC_SUMMARY_MAX_CHARS) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  return truncateTextByCharacters(normalized, maxChars);
}

export function buildPublicAutoSummary(description: string, maxChars = PUBLIC_SUMMARY_MAX_CHARS) {
  const normalized = normalizeWhitespace(description);
  if (!normalized) return "";
  const length = countPublicSummaryChars(normalized);
  if (length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 3) {
    return truncateTextByCharacters(normalized, maxChars);
  }
  return `${truncateTextByCharacters(normalized, maxChars - 3).trimEnd()}...`;
}

export function resolvePublicSummary(overrideSummary: string | null | undefined, description: string | null | undefined) {
  const manual = truncatePublicSummary(String(overrideSummary || ""));
  if (manual) return manual;
  return buildPublicAutoSummary(String(description || ""));
}

export function buildEnglishPublicSlug(value: string | null | undefined, eventId?: string | null) {
  const sanitized = sanitizeEnglishSlugInput(String(value || ""));
  if (sanitized) return sanitized;
  return `event-${buildEnglishFallbackSeed(eventId)}`;
}

export function resolveEnglishPublicSlug(options: {
  customSlug?: string | null | undefined;
  eventName?: string | null | undefined;
  eventSlug?: string | null | undefined;
  eventId?: string | null | undefined;
}) {
  const direct = sanitizeSlugSegment(String(options.customSlug || ""));
  if (direct) return direct;

  const fromName = sanitizeSlugSegment(String(options.eventName || ""));
  if (fromName) return fromName;

  const fromEventSlug = sanitizeSlugSegment(String(options.eventSlug || ""));
  if (fromEventSlug) return fromEventSlug;

  return `event-${buildEnglishFallbackSeed(options.eventId)}`;
}
