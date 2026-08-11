import { createHmac, timingSafeEqual } from "node:crypto";

export type PublicChatSession = {
  version: 1;
  eventId: string;
  senderId: string;
  routeId: string;
  expiresAt: number;
};

const DEFAULT_PUBLIC_CHAT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function canonicalText(value: unknown, maxLength = 512) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) return "";
  return normalized;
}

function encodePayload(payload: PublicChatSession) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signPayload(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createPublicChatSessionToken(
  secret: string,
  eventId: string,
  senderId: string,
  routeId: string,
  nowMs = Date.now(),
  ttlSeconds = DEFAULT_PUBLIC_CHAT_SESSION_TTL_SECONDS,
) {
  const normalizedSecret = String(secret || "").trim();
  const normalizedEventId = canonicalText(eventId);
  const normalizedSenderId = canonicalText(senderId);
  const normalizedRouteId = canonicalText(routeId);
  const normalizedTtlSeconds = Number.isInteger(ttlSeconds) && ttlSeconds > 0
    ? ttlSeconds
    : DEFAULT_PUBLIC_CHAT_SESSION_TTL_SECONDS;
  if (!normalizedSecret || !normalizedEventId || !normalizedSenderId || !normalizedRouteId) return "";

  const payload = encodePayload({
    version: 1,
    eventId: normalizedEventId,
    senderId: normalizedSenderId,
    routeId: normalizedRouteId,
    expiresAt: Math.floor(nowMs / 1000) + normalizedTtlSeconds,
  });
  return `${payload}.${signPayload(normalizedSecret, payload)}`;
}

export function verifyPublicChatSessionToken(
  secret: string,
  eventId: string,
  routeId: string,
  rawToken: unknown,
  nowMs = Date.now(),
): PublicChatSession | null {
  const normalizedSecret = String(secret || "").trim();
  const normalizedEventId = canonicalText(eventId);
  const normalizedRouteId = canonicalText(routeId);
  if (!normalizedSecret || !normalizedEventId || !normalizedRouteId || typeof rawToken !== "string") return null;

  const token = rawToken.trim();
  if (!token || token.length > 2048) return null;
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) return null;

  const payloadPart = token.slice(0, separatorIndex);
  const signaturePart = token.slice(separatorIndex + 1);
  let payload: PublicChatSession;
  try {
    const parsed = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Partial<PublicChatSession>;
    const parsedEventId = canonicalText(parsed.eventId);
    const parsedSenderId = canonicalText(parsed.senderId);
    const parsedRouteId = canonicalText(parsed.routeId);
    if (
      parsed.version !== 1
      || parsedEventId !== normalizedEventId
      || !parsedSenderId
      || parsedRouteId !== normalizedRouteId
      || !Number.isInteger(parsed.expiresAt)
    ) {
      return null;
    }
    payload = {
      version: 1,
      eventId: parsedEventId,
      senderId: parsedSenderId,
      routeId: parsedRouteId,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }

  if (payload.expiresAt <= Math.floor(nowMs / 1000)) return null;

  const expected = Buffer.from(signPayload(normalizedSecret, payloadPart), "utf8");
  const provided = Buffer.from(signaturePart, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return payload;
}
