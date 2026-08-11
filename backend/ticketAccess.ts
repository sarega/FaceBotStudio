import { createHmac, timingSafeEqual } from "node:crypto";

export type TicketImageFormat = "png" | "svg";

const DEFAULT_TICKET_ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60;

type TicketAccessPayload = {
  version: 1;
  registrationId: string;
  format: TicketImageFormat;
  expiresAt: number;
};

function canonicalRegistrationId(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function encodePayload(payload: TicketAccessPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signPayload(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createTicketAccessToken(
  secret: string,
  registrationId: string,
  format: TicketImageFormat,
  nowMs = Date.now(),
  ttlSeconds = DEFAULT_TICKET_ACCESS_TTL_SECONDS,
) {
  const normalizedSecret = String(secret || "").trim();
  const normalizedRegistrationId = canonicalRegistrationId(registrationId);
  const normalizedTtlSeconds = Number.isInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TICKET_ACCESS_TTL_SECONDS;
  if (!normalizedSecret || !normalizedRegistrationId) return "";

  const payload = encodePayload({
    version: 1,
    registrationId: normalizedRegistrationId,
    format,
    expiresAt: Math.floor(nowMs / 1000) + normalizedTtlSeconds,
  });
  return `${payload}.${signPayload(normalizedSecret, payload)}`;
}

export function verifyTicketAccessToken(
  secret: string,
  registrationId: string,
  format: TicketImageFormat,
  rawToken: unknown,
  nowMs = Date.now(),
) {
  const normalizedSecret = String(secret || "").trim();
  const normalizedRegistrationId = canonicalRegistrationId(registrationId);
  if (!normalizedSecret || !normalizedRegistrationId || typeof rawToken !== "string") return false;

  const token = rawToken.trim();
  if (!token || token.length > 1024) return false;

  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) return false;

  const payloadPart = token.slice(0, separatorIndex);
  const signaturePart = token.slice(separatorIndex + 1);
  let payload: TicketAccessPayload;
  try {
    const parsed = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Partial<TicketAccessPayload>;
    if (
      parsed.version !== 1
      || parsed.registrationId !== normalizedRegistrationId
      || parsed.format !== format
      || !Number.isInteger(parsed.expiresAt)
    ) {
      return false;
    }
    payload = parsed as TicketAccessPayload;
  } catch {
    return false;
  }

  if (payload.expiresAt <= Math.floor(nowMs / 1000)) return false;

  const expected = Buffer.from(signPayload(normalizedSecret, payloadPart), "utf8");
  const provided = Buffer.from(signaturePart, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
