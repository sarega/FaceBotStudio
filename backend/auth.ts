import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "fbs_session";
export const CHECKIN_ACCESS_COOKIE_NAME = "fbs_checkin_access";
export const ALL_USER_ROLES = ["owner", "admin", "operator", "checker", "viewer"] as const;
const SESSION_COOKIE_PATH = "/";
const CHECKIN_ACCESS_COOKIE_PATH = "/api/checkin-access";
const ADMIN_SESSION_SAME_SITE: "Strict" = "Strict";
const CHECKIN_ACCESS_SESSION_SAME_SITE: "Strict" = "Strict";
const EXPIRED_COOKIE_DATE = new Date(0);

type CookieRequestLike = {
  secure?: boolean;
  headers?: Record<string, unknown>;
};

export type UserRole = (typeof ALL_USER_ROLES)[number];

export function normalizeUsername(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidUsername(value: string) {
  return /^[a-z0-9._-]{3,32}$/.test(value);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, expected] = String(storedHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  const derivedKey = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  if (expectedBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(derivedKey, expectedBuffer);
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>();
  for (const segment of String(header || "").split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      cookies.set(key, value);
    }
  }
  return cookies;
}

export function getSessionTtlMs() {
  const ttlDays = Number.parseInt(String(process.env.SESSION_TTL_DAYS || "14"), 10);
  const safeDays = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 14;
  return safeDays * 24 * 60 * 60 * 1000;
}

export function getCheckinAccessSessionTtlMs() {
  const ttlMinutes = Number.parseInt(String(process.env.CHECKIN_ACCESS_SESSION_TTL_MINUTES || "120"), 10);
  const safeMinutes = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 120;
  const clampedMinutes = Math.min(24 * 60, Math.max(5, safeMinutes));
  return clampedMinutes * 60 * 1000;
}

function hasSecureForwardedProto(headers: Record<string, unknown> | undefined) {
  const rawValue = headers?.["x-forwarded-proto"];
  const value = Array.isArray(rawValue) ? rawValue.join(",") : String(rawValue || "");
  return value
    .split(",")
    .map((segment) => segment.trim().toLowerCase())
    .includes("https");
}

export function shouldUseSecureSessionCookie(request?: CookieRequestLike) {
  if (String(process.env.NODE_ENV || "").trim().toLowerCase() === "production") {
    return true;
  }
  if (request?.secure) {
    return true;
  }
  return hasSecureForwardedProto(request?.headers);
}

export function cookieSerialize(name: string, value: string, options?: {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
  expiresAt?: Date;
}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options?.path || "/"}`);
  if (typeof options?.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }
  if (options?.expiresAt instanceof Date && Number.isFinite(options.expiresAt.getTime())) {
    parts.push(`Expires=${options.expiresAt.toUTCString()}`);
  }
  if (options?.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  if (options?.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  } else {
    parts.push("SameSite=Lax");
  }
  if (options?.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function serializeAdminSessionCookie(token: string, request?: CookieRequestLike) {
  return cookieSerialize(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(request),
    sameSite: ADMIN_SESSION_SAME_SITE,
    path: SESSION_COOKIE_PATH,
    maxAgeSeconds: Math.floor(getSessionTtlMs() / 1000),
  });
}

export function serializeClearedAdminSessionCookie(request?: CookieRequestLike) {
  return cookieSerialize(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(request),
    sameSite: ADMIN_SESSION_SAME_SITE,
    path: SESSION_COOKIE_PATH,
    maxAgeSeconds: 0,
    expiresAt: EXPIRED_COOKIE_DATE,
  });
}

export function serializeCheckinAccessSessionCookie(
  token: string,
  request?: CookieRequestLike,
  options?: { maxAgeSeconds?: number },
) {
  const maxAgeSeconds =
    typeof options?.maxAgeSeconds === "number"
      ? options.maxAgeSeconds
      : Math.floor(getCheckinAccessSessionTtlMs() / 1000);

  return cookieSerialize(CHECKIN_ACCESS_COOKIE_NAME, token, {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(request),
    sameSite: CHECKIN_ACCESS_SESSION_SAME_SITE,
    path: CHECKIN_ACCESS_COOKIE_PATH,
    maxAgeSeconds,
  });
}

export function serializeClearedCheckinAccessSessionCookie(request?: CookieRequestLike) {
  return cookieSerialize(CHECKIN_ACCESS_COOKIE_NAME, "", {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(request),
    sameSite: CHECKIN_ACCESS_SESSION_SAME_SITE,
    path: CHECKIN_ACCESS_COOKIE_PATH,
    maxAgeSeconds: 0,
    expiresAt: EXPIRED_COOKIE_DATE,
  });
}
