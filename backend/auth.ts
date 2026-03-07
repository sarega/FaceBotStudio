import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "fbs_session";
export const CHECKIN_ACCESS_COOKIE_NAME = "fbs_checkin_access";
export const CSRF_COOKIE_NAME = "fbs_csrf";
export const ALL_USER_ROLES = ["owner", "admin", "operator", "checker", "viewer"] as const;
const SESSION_COOKIE_PATH = "/";
const CHECKIN_ACCESS_COOKIE_PATH = "/api/checkin-access";
const CSRF_COOKIE_PATH = "/";
const ADMIN_SESSION_SAME_SITE: "Strict" = "Strict";
const CHECKIN_ACCESS_SESSION_SAME_SITE: "Strict" = "Strict";
const CSRF_TOKEN_SAME_SITE: "Strict" = "Strict";
const EXPIRED_COOKIE_DATE = new Date(0);
const PASSWORD_HASH_SCHEME = "scrypt";
const PASSWORD_HASH_KEY_LENGTH = 64;
const PASSWORD_HASH_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
} as const;
const PASSWORD_HASH_PARAM_STRING = `n=${PASSWORD_HASH_PARAMS.N},r=${PASSWORD_HASH_PARAMS.r},p=${PASSWORD_HASH_PARAMS.p}`;

type CookieRequestLike = {
  secure?: boolean;
  headers?: Record<string, unknown>;
};

export type UserRole = (typeof ALL_USER_ROLES)[number];
type ScryptHashParameters = { N: number; r: number; p: number };

export type PasswordVerificationResult = {
  valid: boolean;
  needsRehash: boolean;
};

export function normalizeUsername(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidUsername(value: string) {
  return /^[a-z0-9._-]{3,32}$/.test(value);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, PASSWORD_HASH_KEY_LENGTH, PASSWORD_HASH_PARAMS).toString("hex");
  return `${PASSWORD_HASH_SCHEME}$${PASSWORD_HASH_PARAM_STRING}$${salt}$${derivedKey}`;
}

function parseScryptParameters(rawValue: string): ScryptHashParameters | null {
  const normalized = String(rawValue || "").trim();
  if (!normalized) return null;
  const pairs = normalized
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const parsed = new Map<string, number>();
  for (const pair of pairs) {
    const [rawKey, rawNumber] = pair.split("=");
    const key = String(rawKey || "").trim().toLowerCase();
    const value = Number.parseInt(String(rawNumber || "").trim(), 10);
    if (!key || !Number.isFinite(value) || value <= 0) {
      return null;
    }
    parsed.set(key, value);
  }

  const N = parsed.get("n");
  const r = parsed.get("r");
  const p = parsed.get("p");
  if (!N || !r || !p) {
    return null;
  }
  return { N, r, p };
}

function parseStoredScryptHash(storedHash: string): {
  salt: string;
  expectedHex: string;
  params: ScryptHashParameters;
  isLegacy: boolean;
} | null {
  const parts = String(storedHash || "").split("$");
  if (parts.length === 3) {
    const [scheme, salt, expectedHex] = parts;
    if (scheme !== PASSWORD_HASH_SCHEME || !salt || !expectedHex) return null;
    return {
      salt,
      expectedHex,
      params: { ...PASSWORD_HASH_PARAMS },
      isLegacy: true,
    };
  }

  if (parts.length === 4) {
    const [scheme, paramString, salt, expectedHex] = parts;
    if (scheme !== PASSWORD_HASH_SCHEME || !paramString || !salt || !expectedHex) return null;
    const params = parseScryptParameters(paramString);
    if (!params) return null;
    return {
      salt,
      expectedHex,
      params,
      isLegacy: false,
    };
  }

  return null;
}

function areCurrentHashParameters(params: ScryptHashParameters) {
  return params.N === PASSWORD_HASH_PARAMS.N && params.r === PASSWORD_HASH_PARAMS.r && params.p === PASSWORD_HASH_PARAMS.p;
}

export function verifyPasswordWithMetadata(password: string, storedHash: string): PasswordVerificationResult {
  const parsedHash = parseStoredScryptHash(storedHash);
  if (!parsedHash) {
    return {
      valid: false,
      needsRehash: false,
    };
  }

  const derivedKey = scryptSync(password, parsedHash.salt, PASSWORD_HASH_KEY_LENGTH, parsedHash.params);
  const expectedBuffer = Buffer.from(parsedHash.expectedHex, "hex");
  if (expectedBuffer.length !== derivedKey.length) {
    return {
      valid: false,
      needsRehash: false,
    };
  }

  const valid = timingSafeEqual(derivedKey, expectedBuffer);
  return {
    valid,
    needsRehash: valid && (parsedHash.isLegacy || !areCurrentHashParameters(parsedHash.params)),
  };
}

export function passwordHashNeedsRehash(storedHash: string) {
  const parsedHash = parseStoredScryptHash(storedHash);
  if (!parsedHash) return false;
  return parsedHash.isLegacy || !areCurrentHashParameters(parsedHash.params);
}

export function verifyPassword(password: string, storedHash: string) {
  return verifyPasswordWithMetadata(password, storedHash).valid;
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

export function serializeCsrfTokenCookie(token: string, request?: CookieRequestLike) {
  return cookieSerialize(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: shouldUseSecureSessionCookie(request),
    sameSite: CSRF_TOKEN_SAME_SITE,
    path: CSRF_COOKIE_PATH,
    maxAgeSeconds: Math.floor(getSessionTtlMs() / 1000),
  });
}

export function serializeClearedCsrfTokenCookie(request?: CookieRequestLike) {
  return cookieSerialize(CSRF_COOKIE_NAME, "", {
    httpOnly: false,
    secure: shouldUseSecureSessionCookie(request),
    sameSite: CSRF_TOKEN_SAME_SITE,
    path: CSRF_COOKIE_PATH,
    maxAgeSeconds: 0,
    expiresAt: EXPIRED_COOKIE_DATE,
  });
}
