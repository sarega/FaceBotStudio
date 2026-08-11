import { createHmac, timingSafeEqual } from "node:crypto";

export type PrivateMediaScope = "channel" | "admin-agent";

const DEFAULT_PRIVATE_MEDIA_TTL_SECONDS = 15 * 60;

type PrivateMediaPayload = {
  version: 1;
  scope: PrivateMediaScope;
  fileName: string;
  expiresAt: number;
};

function canonicalFileName(value: unknown) {
  const fileName = String(value || "").trim();
  if (!fileName || fileName !== fileName.split(/[\\/]/).pop() || fileName === "." || fileName === "..") return "";
  return fileName;
}

function encodePayload(payload: PrivateMediaPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signPayload(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createPrivateMediaToken(
  secret: string,
  scope: PrivateMediaScope,
  fileName: string,
  nowMs = Date.now(),
  ttlSeconds = DEFAULT_PRIVATE_MEDIA_TTL_SECONDS,
) {
  const normalizedSecret = String(secret || "").trim();
  const normalizedFileName = canonicalFileName(fileName);
  const normalizedTtlSeconds = Number.isInteger(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_PRIVATE_MEDIA_TTL_SECONDS;
  if (!normalizedSecret || !normalizedFileName) return "";

  const payload = encodePayload({
    version: 1,
    scope,
    fileName: normalizedFileName,
    expiresAt: Math.floor(nowMs / 1000) + normalizedTtlSeconds,
  });
  return `${payload}.${signPayload(normalizedSecret, payload)}`;
}

export function verifyPrivateMediaToken(
  secret: string,
  scope: PrivateMediaScope,
  fileName: string,
  rawToken: unknown,
  nowMs = Date.now(),
) {
  const normalizedSecret = String(secret || "").trim();
  const normalizedFileName = canonicalFileName(fileName);
  if (!normalizedSecret || !normalizedFileName || typeof rawToken !== "string") return false;

  const token = rawToken.trim();
  if (!token || token.length > 1024) return false;
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) return false;

  const payloadPart = token.slice(0, separatorIndex);
  const signaturePart = token.slice(separatorIndex + 1);
  let payload: PrivateMediaPayload;
  try {
    const parsed = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Partial<PrivateMediaPayload>;
    if (
      parsed.version !== 1
      || parsed.scope !== scope
      || parsed.fileName !== normalizedFileName
      || !Number.isInteger(parsed.expiresAt)
    ) {
      return false;
    }
    payload = parsed as PrivateMediaPayload;
  } catch {
    return false;
  }

  if (payload.expiresAt <= Math.floor(nowMs / 1000)) return false;
  const expected = Buffer.from(signPayload(normalizedSecret, payloadPart), "utf8");
  const provided = Buffer.from(signaturePart, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
