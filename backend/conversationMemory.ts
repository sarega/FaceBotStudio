function parseStoredTimestamp(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return Number.NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)
    ? `${normalized.replace(" ", "T")}Z`
    : normalized);
}

export function filterRowsAfterContextUpdate<T extends { timestamp: string }>(rows: T[], contextUpdatedAt?: string | null) {
  const cutoff = parseStoredTimestamp(contextUpdatedAt || "");
  if (!Number.isFinite(cutoff)) return rows;
  return rows.filter((row) => {
    const timestamp = parseStoredTimestamp(row.timestamp);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}
