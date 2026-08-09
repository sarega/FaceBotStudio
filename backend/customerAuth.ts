import { createSessionToken, hashSessionToken } from "./auth";
import type { CustomerAccountTokenKind } from "./db/types";

export function normalizeCustomerEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidCustomerEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeCustomerEmail(value));
}

export function normalizeCustomerPhone(value: unknown) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("66") && digits.length >= 10) return `0${digits.slice(2)}`;
  return digits;
}

export function isValidCustomerPhone(value: string) {
  const normalized = normalizeCustomerPhone(value);
  return normalized.length >= 8 && normalized.length <= 15;
}

export function getCustomerAccountTokenTtlMs(kind: CustomerAccountTokenKind) {
  if (kind === "password_reset") {
    const minutes = Number.parseInt(String(process.env.CUSTOMER_PASSWORD_RESET_TTL_MINUTES || "30"), 10);
    return Math.min(120, Math.max(10, Number.isFinite(minutes) && minutes > 0 ? minutes : 30)) * 60 * 1000;
  }

  const hours = Number.parseInt(String(process.env.CUSTOMER_EMAIL_VERIFICATION_TTL_HOURS || "24"), 10);
  return Math.min(72, Math.max(1, Number.isFinite(hours) && hours > 0 ? hours : 24)) * 60 * 60 * 1000;
}

export function createCustomerAccountToken() {
  const rawToken = createSessionToken();
  return { rawToken, tokenHash: hashSessionToken(rawToken) };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildAccountLink(appUrl: string, pathname: string, rawToken: string) {
  const base = String(appUrl || "").trim();
  if (!base) return "";
  try {
    const url = new URL(pathname, base);
    url.searchParams.set("token", rawToken);
    return url.toString();
  } catch {
    return "";
  }
}

export function renderCustomerAccountEmail(input: {
  kind: "email_verification" | "password_reset";
  appUrl: string;
  rawToken: string;
  firstName: string;
  supportEmail?: string | null;
}) {
  const isReset = input.kind === "password_reset";
  const link = buildAccountLink(input.appUrl, isReset ? "/account/reset-password" : "/account/verify-email", input.rawToken);
  const safeName = escapeHtml(input.firstName || "there");
  const safeLink = escapeHtml(link);
  const supportEmail = escapeHtml(input.supportEmail || "");
  const subject = isReset ? "Reset your Meetrix password" : "Verify your Meetrix account";
  const heading = isReset ? "Reset your password" : "Verify your account";
  const action = isReset ? "Reset password" : "Verify email";
  const description = isReset
    ? "Use the secure link below to choose a new password. This link expires soon."
    : "Use the secure link below to verify your email address and activate your account.";
  const text = [
    heading,
    "",
    `Hello ${input.firstName || "there"},`,
    description,
    link ? `Open link: ${link}` : "Open the account page in the application to continue.",
    supportEmail ? `Support: ${input.supportEmail}` : "",
  ].filter(Boolean).join("\n");
  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;padding:24px;">
      <h1 style="margin:0 0 16px;font-size:26px;">${heading}</h1>
      <p style="margin:0 0 16px;">Hello ${safeName}, ${description}</p>
      ${link ? `<p style="margin:0 0 16px;"><a href="${safeLink}" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#2857f0;color:#ffffff;text-decoration:none;font-weight:700;">${action}</a></p>` : ""}
      ${supportEmail ? `<p style="margin:0;font-size:13px;color:#64748b;">Support: ${supportEmail}</p>` : ""}
    </div>
  </body>
</html>`;

  return { subject, text, html };
}
