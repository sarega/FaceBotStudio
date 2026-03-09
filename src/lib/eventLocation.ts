export type EventLocationFields = {
  event_venue_name?: string | null;
  event_room_detail?: string | null;
  event_location?: string | null;
  event_travel?: string | null;
  event_map_url?: string | null;
};

export type EventLocationSummary = {
  venueName: string;
  roomDetail: string;
  address: string;
  travelInfo: string;
  title: string;
  addressLine: string;
  compact: string;
  hasAny: boolean;
};

function normalizeLocationValue(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLocationKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function appendUniqueValue(parts: string[], seen: Set<string>, value: string) {
  const normalized = normalizeLocationValue(value);
  if (!normalized) return;
  const key = normalizeLocationKey(normalized);
  if (seen.has(key)) return;
  seen.add(key);
  parts.push(normalized);
}

export function buildEventLocationSummary(fields: EventLocationFields): EventLocationSummary {
  const venueName = normalizeLocationValue(fields.event_venue_name);
  const roomDetail = normalizeLocationValue(fields.event_room_detail);
  const address = normalizeLocationValue(fields.event_location);
  const travelInfo = normalizeLocationValue(fields.event_travel);

  const titleParts: string[] = [];
  const compactParts: string[] = [];
  const titleKeys = new Set<string>();
  const compactKeys = new Set<string>();

  appendUniqueValue(titleParts, titleKeys, venueName);
  appendUniqueValue(titleParts, titleKeys, roomDetail);

  appendUniqueValue(compactParts, compactKeys, venueName);
  appendUniqueValue(compactParts, compactKeys, roomDetail);
  appendUniqueValue(compactParts, compactKeys, address);

  const title = titleParts.join(", ");
  const addressLine = address && !titleKeys.has(normalizeLocationKey(address)) ? address : "";
  const compact = compactParts.join(", ");

  return {
    venueName,
    roomDetail,
    address,
    travelInfo,
    title,
    addressLine,
    compact,
    hasAny: Boolean(title || address || travelInfo),
  };
}

export function formatEventLocationCompact(fields: EventLocationFields, fallback = "-") {
  const compact = buildEventLocationSummary(fields).compact;
  return compact || fallback;
}

export function buildEventLocationSearchQuery(fields: EventLocationFields) {
  const summary = buildEventLocationSummary(fields);
  return [summary.venueName, summary.address].filter(Boolean).join(", ");
}

export function buildGoogleMapsSearchUrl(fields: EventLocationFields) {
  const query = buildEventLocationSearchQuery(fields);
  if (!query) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function buildGoogleMapsEmbedUrl(fields: EventLocationFields) {
  const query = buildEventLocationSearchQuery(fields);
  if (!query) return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

export function resolveEventMapUrl(fields: EventLocationFields) {
  const configured = normalizeLocationValue(fields.event_map_url);
  if (configured) return configured;
  return buildGoogleMapsSearchUrl(fields);
}
