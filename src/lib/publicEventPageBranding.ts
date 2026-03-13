export type PublicBrandMode = "hidden" | "subtle" | "full";

export type PublicSponsorEntry = {
  name: string;
  tier: string;
  logoUrl: string;
  linkUrl: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type PublicEntryParseOptions = {
  preserveEmpty?: boolean;
};

function normalizeSponsorEntry(value: unknown, options?: PublicEntryParseOptions): PublicSponsorEntry | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const entry = {
    name: normalizeText(record.name),
    tier: normalizeText(record.tier),
    logoUrl: normalizeText(record.logoUrl),
    linkUrl: normalizeText(record.linkUrl),
  };

  const hasAnyContent = Boolean(entry.name || entry.tier || entry.logoUrl || entry.linkUrl);
  if (hasAnyContent || options?.preserveEmpty) {
    return entry;
  }
  return null;
}

export function resolvePublicBrandMode(value: unknown): PublicBrandMode {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "hidden" || normalized === "full") {
    return normalized;
  }
  return "subtle";
}

export function parsePublicSponsorEntries(value: unknown, options?: PublicEntryParseOptions): PublicSponsorEntry[] {
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeSponsorEntry(entry, options))
      .filter((entry): entry is PublicSponsorEntry => Boolean(entry));
  } catch {
    return [];
  }
}

export function serializePublicSponsorEntries(entries: PublicSponsorEntry[], options?: PublicEntryParseOptions) {
  const normalized = entries
    .map((entry) => normalizeSponsorEntry(entry, options))
    .filter((entry): entry is PublicSponsorEntry => Boolean(entry));

  return normalized.length > 0 ? JSON.stringify(normalized, null, 2) : "";
}

function formatTierLabel(tier: string) {
  const normalized = normalizeText(tier)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return "";

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function groupPublicSponsorsByTier(entries: PublicSponsorEntry[]) {
  const normalized = entries.filter((entry) => entry.name || entry.logoUrl);
  const hasTierLabels = normalized.some((entry) => entry.tier);

  if (!hasTierLabels) {
    return [
      {
        key: "all",
        label: "",
        items: normalized,
      },
    ];
  }

  const groups = new Map<string, PublicSponsorEntry[]>();
  for (const entry of normalized) {
    const key = entry.tier || "other";
    const items = groups.get(key) || [];
    items.push(entry);
    groups.set(key, items);
  }

  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    label: key === "other" ? "Partners" : formatTierLabel(key),
    items,
  }));
}
