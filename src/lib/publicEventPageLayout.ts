export type PublicEventSectionId =
  | "about"
  | "countdown"
  | "organizer"
  | "speakers"
  | "sponsors"
  | "location";

export type PublicEventSectionConfig = {
  id: PublicEventSectionId;
  enabled: boolean;
  order: number;
};

export type PublicSpeakerEntry = {
  name: string;
  title: string;
  company: string;
  photoUrl: string;
  bio: string;
};

export const PUBLIC_EVENT_SECTION_CATALOG: Array<{
  id: PublicEventSectionId;
  label: string;
  description: string;
  defaultEnabled: boolean;
  defaultOrder: number;
}> = [
  {
    id: "about",
    label: "About",
    description: "Uses the main event description.",
    defaultEnabled: true,
    defaultOrder: 10,
  },
  {
    id: "countdown",
    label: "Countdown",
    description: "Counts down to the event start time.",
    defaultEnabled: false,
    defaultOrder: 20,
  },
  {
    id: "organizer",
    label: "Organizer",
    description: "Shows organizer profile data when present.",
    defaultEnabled: true,
    defaultOrder: 30,
  },
  {
    id: "speakers",
    label: "Speakers",
    description: "Shows speaker cards from structured rows.",
    defaultEnabled: false,
    defaultOrder: 40,
  },
  {
    id: "sponsors",
    label: "Sponsors",
    description: "Shows sponsor and partner logos when present.",
    defaultEnabled: true,
    defaultOrder: 50,
  },
  {
    id: "location",
    label: "Location",
    description: "Shows map, venue, and travel details.",
    defaultEnabled: true,
    defaultOrder: 60,
  },
];

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type PublicEntryParseOptions = {
  preserveEmpty?: boolean;
};

function isKnownSectionId(value: string): value is PublicEventSectionId {
  return PUBLIC_EVENT_SECTION_CATALOG.some((section) => section.id === value);
}

export function getDefaultPublicEventSections(): PublicEventSectionConfig[] {
  return PUBLIC_EVENT_SECTION_CATALOG.map((section) => ({
    id: section.id,
    enabled: section.defaultEnabled,
    order: section.defaultOrder,
  }));
}

export function parsePublicEventSections(value: unknown): PublicEventSectionConfig[] {
  const defaults = getDefaultPublicEventSections();
  if (typeof value !== "string" || !value.trim()) return defaults;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return defaults;

    const normalizedMap = new Map<PublicEventSectionId, PublicEventSectionConfig>();
    for (const rawEntry of parsed) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const record = rawEntry as Record<string, unknown>;
      const id = normalizeText(record.id);
      if (!isKnownSectionId(id)) continue;

      normalizedMap.set(id, {
        id,
        enabled: typeof record.enabled === "boolean" ? record.enabled : defaults.find((section) => section.id === id)?.enabled ?? true,
        order: Number.isFinite(Number(record.order))
          ? Number(record.order)
          : defaults.find((section) => section.id === id)?.order ?? 999,
      });
    }

    return defaults
      .map((section) => normalizedMap.get(section.id) || section)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  } catch {
    return defaults;
  }
}

export function serializePublicEventSections(entries: PublicEventSectionConfig[]) {
  const normalized = entries
    .filter((entry) => isKnownSectionId(entry.id))
    .map((entry, index) => ({
      id: entry.id,
      enabled: Boolean(entry.enabled),
      order: Number.isFinite(entry.order) ? entry.order : (index + 1) * 10,
    }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  return normalized.length > 0 ? JSON.stringify(normalized, null, 2) : "";
}

function normalizeSpeakerEntry(value: unknown, options?: PublicEntryParseOptions): PublicSpeakerEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const entry = {
    name: normalizeText(record.name),
    title: normalizeText(record.title),
    company: normalizeText(record.company),
    photoUrl: normalizeText(record.photoUrl),
    bio: normalizeText(record.bio),
  };

  const hasAnyContent = Boolean(entry.name || entry.title || entry.company || entry.photoUrl || entry.bio);
  if (hasAnyContent || options?.preserveEmpty) {
    return entry;
  }
  return null;
}

export function parsePublicSpeakerEntries(value: unknown, options?: PublicEntryParseOptions): PublicSpeakerEntry[] {
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeSpeakerEntry(entry, options))
      .filter((entry): entry is PublicSpeakerEntry => Boolean(entry));
  } catch {
    return [];
  }
}

export function serializePublicSpeakerEntries(entries: PublicSpeakerEntry[], options?: PublicEntryParseOptions) {
  const normalized = entries
    .map((entry) => normalizeSpeakerEntry(entry, options))
    .filter((entry): entry is PublicSpeakerEntry => Boolean(entry));

  return normalized.length > 0 ? JSON.stringify(normalized, null, 2) : "";
}
