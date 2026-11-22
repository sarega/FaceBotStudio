export type PaidSlipFields = {
  amountMinor: number | null;
  transferAt: string | null;
  payerName: string | null;
};

export function thaiTransferTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return NaN;
  const timestamp = Date.parse(value + "+07:00");
  return Number.isFinite(timestamp) && thaiTransferInput(timestamp).startsWith(value) ? timestamp : NaN;
}

export function thaiTransferInput(timestamp: number) {
  return new Date(timestamp + 7 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

export function normalizeSlipPayer(value: unknown): string | null {
  return typeof value === "string" && !/[\p{Cc}\p{Cf}]/u.test(value) ? value.trim().slice(0, 160) || null : null;
}

export function parsePaidSlipVision(payload: unknown): PaidSlipFields | null {
  if (typeof payload !== "string") return null;
  try {
    const value = JSON.parse(payload.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const amountMinor = Number.isSafeInteger(value.amount_minor) && value.amount_minor > 0 ? value.amount_minor : null;
    const transferAt = typeof value.transfer_at === "string" && Number.isFinite(thaiTransferTime(value.transfer_at)) ? value.transfer_at : null;
    return { amountMinor, transferAt, payerName: normalizeSlipPayer(value.payer_name) };
  } catch {
    return null;
  }
}
