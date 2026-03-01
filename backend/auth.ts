import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "fbs_session";
export const ALL_USER_ROLES = ["owner", "admin", "operator", "checker", "viewer"] as const;

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
    cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
}

export function getSessionTtlMs() {
  const ttlDays = Number.parseInt(String(process.env.SESSION_TTL_DAYS || "14"), 10);
  const safeDays = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 14;
  return safeDays * 24 * 60 * 60 * 1000;
}

export function cookieSerialize(name: string, value: string, options?: {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options?.path || "/"}`);
  if (typeof options?.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
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
