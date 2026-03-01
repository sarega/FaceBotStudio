import express, { type NextFunction, type Request, type Response } from "express";
import { createServer as createViteServer } from "vite";
import { Parser } from "json2csv";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import dotenv from "dotenv";
import {
  ALL_USER_ROLES,
  SESSION_COOKIE_NAME,
  cookieSerialize,
  createSessionToken,
  getSessionTtlMs,
  hashPassword,
  hashSessionToken,
  isValidUsername,
  normalizeUsername,
  parseCookies,
  verifyPassword,
  type UserRole,
} from "./backend/auth";
import { formatStoredDateForDisplay, getEventState, normalizeTimeZone } from "./backend/datetime";
import {
  createAppDatabase,
  type AuthUserRow,
  type RegistrationInput,
  type RegistrationRow,
  type RegistrationStatus,
} from "./backend/db/index";
import { DEFAULT_EVENT_ID } from "./backend/db/defaultSettings";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_DEFAULT_MODEL || "google/gemini-3-flash-preview";
const appDb = createAppDatabase();

type ChatPart = {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: {
    name?: string;
    response?: { content?: unknown };
  };
};

type ChatHistoryMessage = {
  role: "user" | "model";
  parts: ChatPart[];
};

type NormalizedChatResponse = {
  candidates: Array<{
    content: {
      parts: ChatPart[];
    };
  }>;
  functionCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
  meta?: {
    model?: string;
  };
};

type ToolExecutionBundle = {
  messages: ChatHistoryMessage[];
  ticketRegistrationIds: string[];
};

type BotReplyResult = {
  text: string;
  ticketRegistrationIds: string[];
};

type AuthContext = {
  sessionId: string;
  tokenHash: string;
  user: AuthUserRow;
};

type AuthenticatedRequest = Request & {
  auth?: AuthContext;
};

function buildEventInfo(settings: Record<string, any>, eventStatus = "active") {
  const eventState = getEventState(settings);
  return `
Current Event Details:
- Name: ${settings.event_name || ""}
- Location: ${settings.event_location || ""}
- Map: ${settings.event_map_url || ""}
- Event Status Right Now: ${eventStatus}
- Time Zone: ${eventState.timeZone}
- Current System Time: ${eventState.nowLabel}
- Date: ${formatStoredDateForDisplay(settings.event_date || "", eventState.timeZone)}
- Description: ${settings.event_description || ""}
- Travel: ${settings.event_travel || ""}
- Registration Limit: ${settings.reg_limit || ""}
- Registration Period: ${eventState.startLabel} to ${eventState.endLabel}
- Registration Status Right Now: ${eventState.registrationStatus}
- Event Lifecycle Right Now: ${eventState.eventLifecycle}
`;
}

function getSystemInstruction(settings: Record<string, any>, eventStatus = "active") {
  return [
    settings.context || "",
    buildEventInfo(settings, eventStatus),
    "Never guess the current date or time. Use the Current System Time above as the source of truth.",
    "Respect the Event Status Right Now field.",
    "If event status is pending, explain that the event is still being prepared and registration has not launched yet.",
    "If event status is cancelled, clearly explain that the event has been cancelled.",
    "If event status is closed, clearly explain that the event has already ended.",
    "Respect the Registration Status Right Now field. If it is not_started or closed, clearly tell the user registration is unavailable and do not imply it is open.",
    "If the event lifecycle is past, explain that the event date has already passed.",
    "When you have collected the user's first name, last name, and phone number (and optionally email), use the registerUser tool to complete the registration.",
    "Politely ask for any missing information one by one.",
    "If registration fails (e.g. limit reached or period closed), explain why to the user.",
    "If a user wants to cancel, use the cancelRegistration tool with their ID.",
  ].join("\n\n");
}

function normalizeHistoryForOpenRouter(history: ChatHistoryMessage[] = []) {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const item of history) {
    if (!item?.parts?.length) continue;

    const textParts = item.parts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean);

    if (textParts.length > 0) {
      messages.push({
        role: item.role === "user" ? "user" : "assistant",
        content: textParts.join("\n"),
      });
    }

    for (const part of item.parts) {
      if (!part.functionResponse?.name) continue;
      const result = part.functionResponse.response?.content;
      messages.push({
        role: "assistant",
        content: `Tool ${part.functionResponse.name} result: ${JSON.stringify(result ?? {})}`,
      });
    }
  }

  return messages;
}

function openRouterHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY || ""}`,
    "X-Title": "Facebook Bot Studio",
  };

  if (process.env.APP_URL) {
    headers["HTTP-Referer"] = process.env.APP_URL;
  }

  return headers;
}

function parseToolArgs(rawArgs: unknown) {
  if (typeof rawArgs !== "string") {
    return typeof rawArgs === "object" && rawArgs !== null ? rawArgs as Record<string, unknown> : {};
  }

  try {
    const parsed = JSON.parse(rawArgs);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function extractAssistantText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((chunk) => {
        if (typeof chunk === "string") return chunk;
        if (chunk && typeof chunk === "object" && "text" in chunk) {
          const text = (chunk as any).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }

  return "";
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateText(value: unknown, maxLength: number) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)) + "…";
}

function wrapTextLines(value: unknown, maxCharsPerLine: number, maxLines: number) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return ["-"];

  let remaining = normalized;
  const lines: string[] = [];

  while (remaining && lines.length < maxLines) {
    if (remaining.length <= maxCharsPerLine) {
      lines.push(remaining);
      remaining = "";
      break;
    }

    let slice = remaining.slice(0, maxCharsPerLine);
    const lastSpace = slice.lastIndexOf(" ");
    if (lastSpace >= Math.floor(maxCharsPerLine * 0.55)) {
      slice = slice.slice(0, lastSpace);
    }

    slice = slice.trim();
    if (!slice) {
      slice = remaining.slice(0, maxCharsPerLine);
    }

    lines.push(slice);
    remaining = remaining.slice(slice.length).trimStart();
  }

  if (remaining && lines.length > 0) {
    lines[lines.length - 1] = truncateText(`${lines[lines.length - 1]} ${remaining}`.trim(), maxCharsPerLine);
  }

  return lines.slice(0, maxLines);
}

function userHasRole(role: UserRole, allowedRoles: UserRole[]) {
  return allowedRoles.includes(role);
}

function getRequestIp(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "";
}

function getCookieSecurity(req: Request) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "");
  return process.env.NODE_ENV === "production" || forwardedProto.includes("https");
}

function setSessionCookie(res: Response, token: string, req: Request) {
  res.setHeader(
    "Set-Cookie",
    cookieSerialize(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: getCookieSecurity(req),
      sameSite: "Lax",
      path: "/",
      maxAgeSeconds: Math.floor(getSessionTtlMs() / 1000),
    }),
  );
}

function clearSessionCookie(res: Response, req: Request) {
  res.setHeader(
    "Set-Cookie",
    cookieSerialize(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: getCookieSecurity(req),
      sameSite: "Lax",
      path: "/",
      maxAgeSeconds: 0,
    }),
  );
}

function toPublicAuthUser(user: AuthUserRow) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    organization_id: user.organization_id,
    organization_name: user.organization_name,
    is_active: user.is_active,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

async function attachSession(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies.get(SESSION_COOKIE_NAME);
    if (!sessionToken) {
      return next();
    }

    const tokenHash = hashSessionToken(sessionToken);
    const session = await appDb.getSessionWithUser(tokenHash);
    if (!session || !session.user.is_active) {
      clearSessionCookie(res, req);
      return next();
    }

    req.auth = {
      sessionId: session.session_id,
      tokenHash,
      user: session.user,
    };
    await appDb.touchSession(session.session_id);
    return next();
  } catch (error) {
    console.error("Failed to attach session:", error);
    return res.status(500).json({ error: "Failed to validate session" });
  }
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.auth?.user) {
    return next();
  }
  return res.status(401).json({ error: "Authentication required" });
}

function requireRoles(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth?.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!userHasRole(req.auth.user.role, allowedRoles)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    return next();
  };
}

function canManageTargetUser(actor: AuthUserRow, target: AuthUserRow, action: "status" | "role") {
  if (actor.id === target.id) {
    return false;
  }

  if (actor.role === "owner") {
    return target.role !== "owner";
  }

  if (actor.role === "admin") {
    return target.role === "operator" || target.role === "checker" || target.role === "viewer";
  }

  return false;
}

function getRequestedEventId(req: Request) {
  const raw = typeof req.query.event_id === "string" ? req.query.event_id : "";
  return raw.trim() || DEFAULT_EVENT_ID;
}

async function getSettingsMap(eventId?: string) {
  return appDb.getSettingsMap(eventId);
}

async function getRegistrationById(id: string) {
  return appDb.getRegistrationById(id);
}

async function saveMessage(senderId: string, text: string, type: "incoming" | "outgoing", eventId?: string, pageId?: string) {
  await appDb.saveMessage(senderId, text, type, eventId, pageId);
}

async function getFacebookAccessToken(pageId?: string) {
  if (pageId) {
    const page = await appDb.getFacebookPageByPageId(pageId);
    if (page?.page_access_token) {
      return page.page_access_token;
    }
  }
  return process.env.PAGE_ACCESS_TOKEN || "";
}

async function recordAudit(
  req: AuthenticatedRequest,
  action: string,
  targetType?: string | null,
  targetId?: string | null,
  metadata?: Record<string, unknown>,
) {
  await appDb.recordAuditLog({
    actor_user_id: req.auth?.user.id || null,
    action,
    target_type: targetType || null,
    target_id: targetId || null,
    metadata: {
      ...metadata,
      ip: getRequestIp(req),
    },
  });
}

function formatTicketDate(value: string, timeZone?: string) {
  return formatStoredDateForDisplay(value, normalizeTimeZone(timeZone));
}

function buildTicketImageUrl(registrationId: string, format: "svg" | "png" = "png") {
  if (!process.env.APP_URL) return null;
  const url = new URL(process.env.APP_URL);
  url.pathname = `/api/tickets/${encodeURIComponent(registrationId)}.${format}`;
  url.search = "";
  return url.toString();
}

let cachedTicketFontPaths: string[] | null = null;

function resolveTicketFontPaths() {
  if (cachedTicketFontPaths) return cachedTicketFontPaths;

  const explicit = String(process.env.TICKET_FONT_FILES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (path.isAbsolute(v) ? v : path.join(__dirname, v)));

  const defaults = [
    "@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff",
    "@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff",
    "@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff",
    "@fontsource/noto-sans-thai/files/noto-sans-thai-latin-700-normal.woff",
  ]
    .map((pkgPath) => {
      try {
        return require.resolve(pkgPath);
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  cachedTicketFontPaths = [...explicit, ...defaults];
  return cachedTicketFontPaths;
}

function renderTicketPngBuffer(svg: string) {
  const fontFiles = resolveTicketFontPaths();
  const resvg = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    font: {
      fontFiles,
      loadSystemFonts: true,
      defaultFontFamily: "Noto Sans Thai",
    },
  });

  return resvg.render().asPng();
}

let cachedTicketFontCssForHtml: string | null = null;

function buildEmbeddedTicketFontCss() {
  if (cachedTicketFontCssForHtml) return cachedTicketFontCssForHtml;

  const css = resolveTicketFontPaths()
    .map((fontPath) => {
      const ext = path.extname(fontPath).replace(".", "").toLowerCase();
      const format = ext === "woff2" ? "woff2" : "woff";
      const weight = /-700-/.test(fontPath) ? 700 : /-400-/.test(fontPath) ? 400 : 400;
      const bytes = readFileSync(fontPath);
      const base64 = bytes.toString("base64");
      return `@font-face { font-family: "TicketNoto"; src: url(data:font/${format};base64,${base64}) format("${format}"); font-weight: ${weight}; font-style: normal; font-display: block; }`;
    })
    .join("\n");

  cachedTicketFontCssForHtml = css;
  return cachedTicketFontCssForHtml;
}

function renderTicketHtmlForScreenshot(reg: RegistrationRow, settings: Record<string, string>, qrDataUrl: string) {
  const fontCss = buildEmbeddedTicketFontCss();
  const timeZone = normalizeTimeZone(settings.event_timezone);
  const eventName = escapeXml(String(settings.event_name || "Event Ticket").trim() || "Event Ticket");
  const attendeeName = escapeXml(`${reg.first_name || ""} ${reg.last_name || ""}`.trim() || "-");
  const registrationId = escapeXml(reg.id);
  const location = escapeXml(String(settings.event_location || "-").trim() || "-");
  const eventDate = escapeXml(formatTicketDate(settings.event_date || "", timeZone));
  const qrSrc = escapeXml(qrDataUrl);

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    ${fontCss}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; }
    body {
      width: 420px;
      padding: 8px;
      background: #e7edf5;
      font-family: "TicketNoto", system-ui, sans-serif;
      color: #0f172a;
    }
    .ticket {
      width: 404px;
      border-radius: 26px;
      overflow: hidden;
      background: #ffffff;
      border: 1px dashed #d7e0eb;
      box-shadow: 0 10px 26px rgba(15,23,42,.14);
      position: relative;
    }
    .header {
      background: linear-gradient(135deg, #2a58f2 0%, #2f62f6 100%);
      color: #fff;
      padding: 18px 18px 16px;
      text-align: center;
      position: relative;
      min-height: 150px;
    }
    .cut {
      position: absolute;
      top: 95px;
      width: 20px;
      height: 20px;
      background: #e7edf5;
      border-radius: 999px;
    }
    .cut.left { left: -10px; }
    .cut.right { right: -10px; }
    .event-name {
      margin: 10px auto 6px;
      line-height: 1.25;
      font-size: 19px;
      font-weight: 700;
      max-width: 320px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-wrap: balance;
    }
    .subtitle {
      margin: 0;
      color: #dbeafe;
      text-transform: uppercase;
      letter-spacing: .12em;
      font-size: 11px;
      font-weight: 700;
    }
    .body { padding: 18px 20px 16px; background: #ffffff; }
    .qr-wrap {
      width: 184px;
      height: 184px;
      margin: 0 auto 16px;
      border-radius: 14px;
      border: 1px solid #dbe3ef;
      background: #edf2f7;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 14px;
    }
    .qr-wrap img {
      width: 156px;
      height: 156px;
      display: block;
      background: #fff;
      border-radius: 6px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #dbe3ef;
      margin-bottom: 12px;
    }
    .label {
      margin: 0 0 4px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .12em;
      color: #94a3b8;
    }
    .value {
      margin: 0;
      font-size: 17px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.2;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      color: #2563eb;
      font-size: 14px;
      font-weight: 700;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 14px;
    }
    .grid .value-sm {
      margin: 0;
      font-size: 13px;
      color: #334155;
      line-height: 1.35;
      min-height: 36px;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .map-note {
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 11px 12px;
      background: #e8eef6;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      color: #334155;
    }
    .footer {
      background: #f1f5f9;
      color: #16a34a;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .12em;
      text-transform: uppercase;
      padding: 14px;
      border-top: 1px solid #e2e8f0;
    }
  </style>
</head>
<body>
  <div id="ticket-capture" class="ticket">
    <div class="header">
      <div class="cut left"></div>
      <div class="cut right"></div>
      <div class="event-name">${eventName}</div>
      <p class="subtitle">Official Registration Pass</p>
    </div>
    <div class="body">
      <div class="qr-wrap"><img src="${qrSrc}" alt="QR Code" /></div>

      <div class="row">
        <div>
          <p class="label">Attendee</p>
          <p class="value">${attendeeName}</p>
        </div>
        <div style="text-align:right; max-width: 46%;">
          <p class="label">ID Number</p>
          <p class="value mono">${registrationId}</p>
        </div>
      </div>

      <div class="grid">
        <div>
          <p class="label">Location</p>
          <p class="value-sm">${location}</p>
        </div>
        <div>
          <p class="label">Event Date</p>
          <p class="value-sm">${eventDate}</p>
        </div>
      </div>

      <div class="map-note">Map link will be sent in chat</div>
    </div>
    <div class="footer">Verified Registration</div>
  </div>
</body>
</html>`;
}

async function renderTicketPngScreenshotBuffer(reg: RegistrationRow, settings: Record<string, string>, qrDataUrl: string) {
  const html = renderTicketHtmlForScreenshot(reg, settings, qrDataUrl);
  const puppeteerModule = await import("puppeteer");
  const puppeteer = (puppeteerModule as any).default || puppeteerModule;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 420, height: 680, deviceScaleFactor: 1.5 });
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.evaluate(async () => {
        const fonts = (document as any).fonts;
        if (fonts?.ready) await fonts.ready;
      });
      const element = await page.$("#ticket-capture");
      if (!element) {
        throw new Error("Ticket capture element not found");
      }
      const screenshot = await element.screenshot({ type: "png" });
      return Buffer.isBuffer(screenshot) ? screenshot : Buffer.from(screenshot);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

function buildTicketSummaryText(reg: RegistrationRow, settings: Record<string, string>) {
  const timeZone = normalizeTimeZone(settings.event_timezone);
  const fullName = `${reg.first_name || ""} ${reg.last_name || ""}`.trim() || "-";
  const eventDate = formatTicketDate(settings.event_date || "", timeZone);
  const location = String(settings.event_location || "-").trim() || "-";

  return [
    "ลงทะเบียนสำเร็จแล้ว ✅",
    `ชื่อ: ${fullName}`,
    `รหัสตั๋ว: ${reg.id}`,
    `วันเวลา: ${eventDate}`,
    `สถานที่: ${location}`,
    "กรุณาเก็บข้อความนี้และรูปตั๋วไว้สำหรับเช็กอิน",
  ].join("\n");
}

function renderTicketSvg(reg: RegistrationRow, settings: Record<string, string>, qrDataUrl: string) {
  const timeZone = normalizeTimeZone(settings.event_timezone);
  const eventNameLines = wrapTextLines(settings.event_name || "Event Ticket", 18, 2).map(escapeXml);
  const locationLines = wrapTextLines(settings.event_location || "-", 18, 2).map(escapeXml);
  const eventDateLines = wrapTextLines(formatTicketDate(settings.event_date || "", timeZone), 18, 2).map(escapeXml);
  const attendeeName = escapeXml(truncateText(`${reg.first_name} ${reg.last_name}`.trim(), 16));
  const registrationId = escapeXml(reg.id);

  const eventNameSvg = eventNameLines
    .map(
      (line, index) =>
        `<text x="210" y="${index === 0 ? 72 : 110}" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="${index === 0 ? 24 : 22}" font-weight="700" fill="#ffffff">${line}</text>`,
    )
    .join("\n  ");

  const locationSvg = locationLines
    .map(
      (line, index) =>
        `<text x="34" y="${index === 0 ? 517 : 543}" font-family="Tahoma, Arial, sans-serif" font-size="13" font-weight="500" fill="#334155">${line}</text>`,
    )
    .join("\n  ");

  const eventDateSvg = eventDateLines
    .map(
      (line, index) =>
        `<text x="214" y="${index === 0 ? 517 : 543}" font-family="Tahoma, Arial, sans-serif" font-size="13" font-weight="500" fill="#334155">${line}</text>`,
    )
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="660" viewBox="0 0 420 660" role="img" aria-label="Event ticket ${registrationId}">
  <defs>
    <linearGradient id="header" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2a58f2"/>
      <stop offset="100%" stop-color="#2f62f6"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#0f172a" flood-opacity="0.16"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="420" height="660" fill="#e7edf5"/>
  <g filter="url(#shadow)">
    <rect x="5" y="7" width="410" height="646" rx="26" fill="#f8fafc"/>
    <rect x="5" y="7" width="410" height="646" rx="26" fill="none" stroke="#d7e0eb" stroke-width="1.2" stroke-dasharray="4 5"/>
    <path d="M31 7h358a26 26 0 0 1 26 26v129H5V33A26 26 0 0 1 31 7z" fill="url(#header)"/>
    <circle cx="5" cy="93" r="10" fill="#dfe6ef"/>
    <circle cx="415" cy="93" r="10" fill="#dfe6ef"/>
  </g>

  ${eventNameSvg}
  <text x="210" y="140" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="12" font-weight="700" fill="#dbeafe" letter-spacing="1">OFFICIAL REGISTRATION PASS</text>

  <rect x="109" y="206" width="202" height="202" rx="12" fill="#edf2f7" stroke="#dbe3ef"/>
  <image href="${qrDataUrl}" x="126" y="223" width="168" height="168" preserveAspectRatio="xMidYMid meet"/>

  <text x="30" y="453" font-family="Tahoma, Arial, sans-serif" font-size="9" font-weight="700" fill="#94a3b8" letter-spacing="1.1">ATTENDEE</text>
  <text x="30" y="479" font-family="Tahoma, Arial, sans-serif" font-size="17" font-weight="700" fill="#0f172a">${attendeeName}</text>

  <text x="390" y="453" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="9" font-weight="700" fill="#94a3b8" letter-spacing="1.1">ID NUMBER</text>
  <text x="390" y="479" text-anchor="end" font-family="Courier New, monospace" font-size="14" font-weight="700" fill="#2563eb">${registrationId}</text>

  <line x1="30" y1="494" x2="390" y2="494" stroke="#dbe3ef" stroke-width="1.2"/>

  <text x="34" y="534" font-family="Tahoma, Arial, sans-serif" font-size="9" font-weight="700" fill="#94a3b8" letter-spacing="1.1">LOCATION</text>
  ${locationSvg}

  <text x="214" y="534" font-family="Tahoma, Arial, sans-serif" font-size="9" font-weight="700" fill="#94a3b8" letter-spacing="1.1">EVENT DATE</text>
  ${eventDateSvg}

  <rect x="30" y="560" width="360" height="34" rx="12" fill="#e8eef6"/>
  <text x="210" y="582" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="11" font-weight="700" fill="#334155">Map link will be sent in chat</text>

  <rect x="5" y="608" width="410" height="45" fill="#f1f5f9"/>
  <text x="210" y="636" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="11" font-weight="700" fill="#16a34a" letter-spacing="1.2">VERIFIED REGISTRATION</text>
</svg>`;
}

async function getMessageHistoryForSender(senderId: string, limit = 12, eventId?: string): Promise<ChatHistoryMessage[]> {
  const rows = await appDb.getMessageHistoryRows(senderId, limit, eventId);

  return rows
    .reverse()
    .map((row) => ({
      role: row.type === "incoming" ? "user" : "model",
      parts: [{ text: row.text || "" }],
    }));
}

async function createRegistration(input: RegistrationInput) {
  return appDb.createRegistration(input);
}

async function cancelRegistration(id: unknown) {
  return appDb.cancelRegistration(id);
}

async function requestOpenRouterChat(
  message: string,
  history: ChatHistoryMessage[],
  settings: Record<string, any>,
  eventStatus = "active",
): Promise<NormalizedChatResponse> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured in .env");
  }

  const model = (typeof settings.llm_model === "string" && settings.llm_model.trim())
    ? settings.llm_model.trim()
    : DEFAULT_OPENROUTER_MODEL;

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: getSystemInstruction(settings, eventStatus),
        },
        ...normalizeHistoryForOpenRouter(history),
        {
          role: "user",
          content: message,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "registerUser",
            description: "Register a user for the event after collecting their details.",
            parameters: {
              type: "object",
              properties: {
                first_name: { type: "string", description: "User's first name" },
                last_name: { type: "string", description: "User's last name" },
                phone: { type: "string", description: "User's phone number" },
                email: { type: "string", description: "User's email address (optional)" },
              },
              required: ["first_name", "last_name", "phone"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "cancelRegistration",
            description: "Cancel an existing registration using the Registration ID.",
            parameters: {
              type: "object",
              properties: {
                registration_id: {
                  type: "string",
                  description: "The Registration ID (e.g. REG-XXXXXX)",
                },
              },
              required: ["registration_id"],
            },
          },
        },
      ],
      tool_choice: "auto",
    }),
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new Error(payload?.error?.message || "OpenRouter chat request failed");
  }

  const assistantMessage = payload?.choices?.[0]?.message || {};
  const assistantText = extractAssistantText(assistantMessage.content);
  const functionCalls = Array.isArray(assistantMessage.tool_calls)
    ? assistantMessage.tool_calls
        .map((call: any) => ({
          name: call?.function?.name,
          args: parseToolArgs(call?.function?.arguments),
        }))
        .filter((call: any) => typeof call.name === "string" && call.name.length > 0)
    : [];

  const parts: ChatPart[] = [];
  if (assistantText) {
    parts.push({ text: assistantText });
  }
  for (const call of functionCalls) {
    parts.push({
      functionCall: {
        name: call.name,
        args: call.args,
      },
    });
  }
  if (parts.length === 0) {
    parts.push({ text: "" });
  }

  return {
    candidates: [
      {
        content: { parts },
      },
    ],
    functionCalls,
    meta: {
      model: payload?.model || model,
    },
  };
}

function getTextFromNormalizedResponse(response: NormalizedChatResponse) {
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function buildToolResponseMessages(
  senderId: string,
  eventId: string,
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): Promise<ToolExecutionBundle> {
  const messages: ChatHistoryMessage[] = [];
  const ticketRegistrationIds: string[] = [];

  for (const call of calls) {
    let content: Record<string, unknown>;

    if (call.name === "registerUser") {
      const result = await createRegistration({
        sender_id: senderId,
        event_id: eventId,
        first_name: call.args.first_name,
        last_name: call.args.last_name,
        phone: call.args.phone,
        email: call.args.email,
      });
      content = result.content;
      if (result.statusCode === 200 && typeof result.content.id === "string") {
        ticketRegistrationIds.push(result.content.id);
      }
    } else if (call.name === "cancelRegistration") {
      const result = await cancelRegistration(call.args.registration_id);
      content = result.content;
    } else {
      content = { error: `Unknown tool: ${call.name}` };
    }

    messages.push({
      role: "model",
      parts: [
        {
          functionResponse: {
            name: call.name,
            response: { content },
          },
        },
      ],
    });
  }

  return { messages, ticketRegistrationIds };
}

async function generateBotReplyForSender(
  senderId: string,
  eventId: string,
  incomingText: string,
  historyOverride?: ChatHistoryMessage[],
): Promise<BotReplyResult> {
  const settings = await getSettingsMap(eventId);
  const event = await appDb.getEventById(eventId);
  const history = historyOverride || await getMessageHistoryForSender(senderId, 12, eventId);

  const firstResponse = await requestOpenRouterChat(incomingText, history, settings, event?.effective_status || "active");
  let finalResponse = firstResponse;
  let ticketRegistrationIds: string[] = [];

  if (firstResponse.functionCalls && firstResponse.functionCalls.length > 0) {
    const toolResult = await buildToolResponseMessages(senderId, eventId, firstResponse.functionCalls);
    const toolMessages = toolResult.messages;
    ticketRegistrationIds = toolResult.ticketRegistrationIds;
    const assistantMessage: ChatHistoryMessage = {
      role: "model",
      parts: firstResponse.candidates?.[0]?.content?.parts || [{ text: "" }],
    };

    finalResponse = await requestOpenRouterChat(
      "Continue based on the tool results. Reply to the user in plain text only.",
      [
        ...history,
        { role: "user", parts: [{ text: incomingText }] },
        assistantMessage,
        ...toolMessages,
      ],
      settings,
      event?.effective_status || "active",
    );
  }

  return {
    text: getTextFromNormalizedResponse(finalResponse),
    ticketRegistrationIds,
  };
}

async function sendFacebookTextMessage(recipientId: string, text: string, pageId?: string) {
  const pageAccessToken = await getFacebookAccessToken(pageId);
  if (!pageAccessToken) {
    throw new Error("PAGE_ACCESS_TOKEN is not configured");
  }

  const apiVersion = process.env.FACEBOOK_GRAPH_API_VERSION || "v22.0";
  const url = new URL(`https://graph.facebook.com/${apiVersion}/me/messages`);
  url.searchParams.set("access_token", pageAccessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Failed to send message to Facebook");
  }

  return payload;
}

async function sendFacebookImageMessage(recipientId: string, imageUrl: string, pageId?: string) {
  const pageAccessToken = await getFacebookAccessToken(pageId);
  if (!pageAccessToken) {
    throw new Error("PAGE_ACCESS_TOKEN is not configured");
  }

  const apiVersion = process.env.FACEBOOK_GRAPH_API_VERSION || "v22.0";
  const url = new URL(`https://graph.facebook.com/${apiVersion}/me/messages`);
  url.searchParams.set("access_token", pageAccessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "image",
          payload: {
            url: imageUrl,
            is_reusable: false,
          },
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Failed to send image to Facebook");
  }

  return payload;
}

async function handleIncomingFacebookText(senderId: string, text: string, pageId?: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  const eventId = pageId ? await appDb.resolveEventIdForPage(pageId) : DEFAULT_EVENT_ID;
  const priorHistory = await getMessageHistoryForSender(senderId, 12, eventId);
  await saveMessage(senderId, trimmed, "incoming", eventId, pageId);

  if (!(await getFacebookAccessToken(pageId))) {
    console.warn("PAGE_ACCESS_TOKEN is not set; skipping outbound Facebook reply");
    return;
  }

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateBotReplyForSender(senderId, eventId, trimmed, priorHistory);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
  } catch (error) {
    console.error("Failed to generate bot reply:", error);
    replyText = "ขออภัย ระบบตอบกลับอัตโนมัติขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง";
  }

  if (replyText) {
    await sendFacebookTextMessage(senderId, replyText, pageId);
    await saveMessage(senderId, replyText, "outgoing", eventId, pageId);
  }

  const uniqueTicketIds = [...new Set(ticketRegistrationIds)];
  let sentTicketArtifact = false;
  const settings = uniqueTicketIds.length > 0 ? await getSettingsMap(eventId) : null;
  for (const registrationId of uniqueTicketIds) {
    const reg = await getRegistrationById(registrationId);
    if (reg && settings) {
      const ticketSummaryText = buildTicketSummaryText(reg, settings);
      try {
        await sendFacebookTextMessage(senderId, ticketSummaryText, pageId);
        await saveMessage(senderId, `[ticket-summary] ${registrationId}`, "outgoing", eventId, pageId);
      } catch (error) {
        console.error("Failed to send ticket summary text:", error);
      }
    }

    const ticketPngUrl = buildTicketImageUrl(registrationId, "png");
    const ticketSvgUrl = buildTicketImageUrl(registrationId, "svg");
    if (!ticketPngUrl && !ticketSvgUrl) {
      console.warn("APP_URL is not set; skipping ticket image send");
      continue;
    }

    try {
      if (!ticketPngUrl) throw new Error("PNG ticket URL is not available");
      await sendFacebookImageMessage(senderId, ticketPngUrl, pageId);
      await saveMessage(senderId, `[ticket-image-png] ${registrationId}`, "outgoing", eventId, pageId);
      sentTicketArtifact = true;
    } catch (error) {
      console.error("Failed to send PNG ticket image:", error);
      try {
        if (!ticketSvgUrl) throw new Error("SVG ticket URL is not available");
        await sendFacebookImageMessage(senderId, ticketSvgUrl, pageId);
        await saveMessage(senderId, `[ticket-image-svg] ${registrationId}`, "outgoing", eventId, pageId);
        sentTicketArtifact = true;
      } catch (svgError) {
        console.error("Failed to send SVG ticket image fallback:", svgError);
        try {
          const textUrl = ticketPngUrl || ticketSvgUrl;
          if (!textUrl) throw new Error("No ticket URL available");
          await sendFacebookTextMessage(senderId, `ตั๋วของคุณ: ${textUrl}`, pageId);
          await saveMessage(senderId, `[ticket-link] ${registrationId}`, "outgoing", eventId, pageId);
          sentTicketArtifact = true;
        } catch (fallbackError) {
          console.error("Failed to send ticket link fallback:", fallbackError);
        }
      }
    }
  }

  if (uniqueTicketIds.length > 0 && sentTicketArtifact) {
    const mapUrl = String(settings?.event_map_url || "").trim();
    if (mapUrl) {
      try {
        await sendFacebookTextMessage(senderId, `แผนที่สถานที่: ${mapUrl}`, pageId);
        await saveMessage(senderId, `[map-link] ${mapUrl}`, "outgoing", eventId, pageId);
      } catch (error) {
        console.error("Failed to send map link:", error);
      }
    }
  }
}

async function startServer() {
  await appDb.initialize();

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));
  app.use(attachSession);

  const PORT = Number(process.env.PORT || 3000);

  // API Routes
  app.get("/api/health", async (_req, res) => {
    try {
      await appDb.ping();
      res.json({ status: "ok", time: new Date().toISOString(), database: appDb.driver });
    } catch (error) {
      console.error("Health check failed:", error);
      res.status(500).json({ status: "error", time: new Date().toISOString(), database: appDb.driver });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const password = String(req.body?.password || "");

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const user = await appDb.getUserByUsername(username);
      if (!user || !user.is_active) {
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const passwordHash = await appDb.getUserPasswordHash(username);
      const valid = typeof passwordHash === "string" && verifyPassword(password, passwordHash);

      if (!valid) {
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const sessionToken = createSessionToken();
      const tokenHash = hashSessionToken(sessionToken);
      const expiresAt = new Date(Date.now() + getSessionTtlMs());
      await appDb.createSession(user.id, tokenHash, expiresAt);
      await appDb.updateUserLastLogin(user.id);
      setSessionCookie(res, sessionToken, req);
      await appDb.recordAuditLog({
        actor_user_id: user.id,
        action: "auth.login",
        target_type: "user",
        target_id: user.id,
        metadata: {
          ip: getRequestIp(req),
          username: user.username,
        },
      });

      const refreshedUser = await appDb.getUserById(user.id);
      return res.json({ user: toPublicAuthUser(refreshedUser || user) });
    } catch (error) {
      console.error("Login failed:", error);
      return res.status(500).json({ error: "Failed to login" });
    }
  });

  app.post("/api/auth/logout", async (req: AuthenticatedRequest, res) => {
    try {
      if (req.auth?.tokenHash) {
        await appDb.deleteSession(req.auth.tokenHash);
        await appDb.recordAuditLog({
          actor_user_id: req.auth.user.id,
          action: "auth.logout",
          target_type: "user",
          target_id: req.auth.user.id,
          metadata: {
            ip: getRequestIp(req),
          },
        });
      }
      clearSessionCookie(res, req);
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Logout failed:", error);
      return res.status(500).json({ error: "Failed to logout" });
    }
  });

  app.get("/api/auth/me", async (req: AuthenticatedRequest, res) => {
    if (!req.auth?.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    return res.json({ user: toPublicAuthUser(req.auth.user) });
  });

  app.get("/api/auth/users", requireRoles(["owner", "admin"]), async (_req: AuthenticatedRequest, res) => {
    try {
      const users = await appDb.listUsers();
      return res.json(users.map(toPublicAuthUser));
    } catch (error) {
      console.error("Failed to list users:", error);
      return res.status(500).json({ error: "Failed to list users" });
    }
  });

  app.post("/api/auth/users", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const password = String(req.body?.password || "");
      const displayName = String(req.body?.display_name || username).trim();
      const role = String(req.body?.role || "").trim() as UserRole;

      if (!username || !isValidUsername(username)) {
        return res.status(400).json({ error: "Username must be 3-32 chars and use only a-z, 0-9, dot, dash, or underscore" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      if (!ALL_USER_ROLES.includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      if (role === "owner") {
        return res.status(400).json({ error: "Create owners manually in the database only" });
      }
      if (req.auth?.user.role === "admin" && role === "admin") {
        return res.status(403).json({ error: "Admins can only create operator, checker, or viewer accounts" });
      }

      const user = await appDb.createUser({
        username,
        display_name: displayName,
        password_hash: hashPassword(password),
        role,
      });
      await recordAudit(req, "auth.user_created", "user", user.id, {
        username: user.username,
        role: user.role,
      });
      return res.status(201).json({ user: toPublicAuthUser(user) });
    } catch (error: any) {
      console.error("Failed to create user:", error);
      const conflict = error?.code === "23505" || String(error?.message || "").includes("UNIQUE");
      return res.status(conflict ? 409 : 500).json({ error: conflict ? "Username already exists" : "Failed to create user" });
    }
  });

  app.post("/api/auth/users/:id/role", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.params.id || "").trim();
      const role = String(req.body?.role || "").trim() as UserRole;
      if (!userId || !ALL_USER_ROLES.includes(role)) {
        return res.status(400).json({ error: "Invalid user or role" });
      }

      const targetUser = await appDb.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!req.auth?.user || !canManageTargetUser(req.auth.user, targetUser, "role")) {
        return res.status(403).json({ error: "You cannot change this user's role" });
      }
      if (req.auth.user.role === "admin" && (role === "owner" || role === "admin")) {
        return res.status(403).json({ error: "Admins can only assign operator, checker, or viewer roles" });
      }

      const updated = await appDb.updateUserRole(userId, role);
      if (!updated) return res.status(404).json({ error: "User not found" });

      await recordAudit(req, "auth.role_updated", "user", userId, { role });
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Failed to update user role:", error);
      return res.status(500).json({ error: "Failed to update user role" });
    }
  });

  app.post("/api/auth/users/:id/status", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.params.id || "").trim();
      const isActive = Boolean(req.body?.is_active);
      const targetUser = await appDb.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!req.auth?.user || !canManageTargetUser(req.auth.user, targetUser, "status")) {
        return res.status(403).json({ error: "You cannot change this user's access" });
      }

      const updated = await appDb.setUserActive(userId, isActive);
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!isActive) {
        await appDb.deleteSessionsForUser(userId);
      }

      await recordAudit(req, isActive ? "auth.user_enabled" : "auth.user_disabled", "user", userId, {
        is_active: isActive,
        username: targetUser.username,
      });
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Failed to update user status:", error);
      return res.status(500).json({ error: "Failed to update user status" });
    }
  });

  app.get("/api/audit-logs", requireRoles(["owner", "admin"]), async (_req: AuthenticatedRequest, res) => {
    try {
      const logs = await appDb.listAuditLogs(100);
      return res.json(logs);
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
      return res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  app.get("/api/events", requireAuth, async (_req, res) => {
    try {
      const events = await appDb.listEvents();
      return res.json(events);
    } catch (error) {
      console.error("Failed to fetch events:", error);
      return res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  app.post("/api/events", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      if (!name) {
        return res.status(400).json({ error: "Event name is required" });
      }
      const event = await appDb.createEvent({ name });
      await recordAudit(req, "event.created", "event", event.id, { name: event.name });
      return res.status(201).json(event);
    } catch (error) {
      console.error("Failed to create event:", error);
      return res.status(500).json({ error: "Failed to create event" });
    }
  });

  app.post("/api/events/:id", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = String(req.params.id || "").trim();
      const name = typeof req.body?.name === "string" ? req.body.name : undefined;
      const status = typeof req.body?.status === "string" ? req.body.status : undefined;
      const allowedStatuses = new Set(["pending", "active", "cancelled"]);
      if (!eventId) {
        return res.status(400).json({ error: "Event ID is required" });
      }
      if (status && !allowedStatuses.has(status)) {
        return res.status(400).json({ error: "Invalid event status" });
      }
      const updated = await appDb.updateEvent(eventId, { name, status: status as any });
      if (!updated) {
        return res.status(404).json({ error: "Event not found" });
      }
      await recordAudit(req, "event.updated", "event", eventId, { name, status });
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Failed to update event:", error);
      return res.status(500).json({ error: "Failed to update event" });
    }
  });

  app.get("/api/facebook-pages", requireAuth, async (_req, res) => {
    try {
      const pages = await appDb.listFacebookPages();
      return res.json(
        pages.map((page) => ({
          id: page.id,
          page_id: page.page_id,
          page_name: page.page_name,
          event_id: page.event_id,
          is_active: page.is_active,
          has_page_access_token: Boolean(page.page_access_token),
          created_at: page.created_at,
          updated_at: page.updated_at,
        })),
      );
    } catch (error) {
      console.error("Failed to fetch Facebook pages:", error);
      return res.status(500).json({ error: "Failed to fetch Facebook pages" });
    }
  });

  app.post("/api/facebook-pages", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const pageId = String(req.body?.page_id || "").trim();
      const pageName = String(req.body?.page_name || "").trim();
      const eventId = String(req.body?.event_id || "").trim();
      const pageAccessToken = String(req.body?.page_access_token || "").trim();
      const isActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : true;

      if (!pageId || !eventId) {
        return res.status(400).json({ error: "page_id and event_id are required" });
      }

      const page = await appDb.upsertFacebookPage({
        page_id: pageId,
        page_name: pageName || pageId,
        event_id: eventId,
        page_access_token: pageAccessToken,
        is_active: isActive,
      });
      await recordAudit(req, "facebook_page.upserted", "facebook_page", page.id, {
        page_id: page.page_id,
        event_id: page.event_id,
        is_active: page.is_active,
      });
      return res.json({
        id: page.id,
        page_id: page.page_id,
        page_name: page.page_name,
        event_id: page.event_id,
        is_active: page.is_active,
        has_page_access_token: Boolean(page.page_access_token),
        created_at: page.created_at,
        updated_at: page.updated_at,
      });
    } catch (error) {
      console.error("Failed to upsert Facebook page:", error);
      return res.status(500).json({ error: "Failed to save Facebook page" });
    }
  });

  app.get("/api/registrations", requireAuth, async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const rows = await appDb.listRegistrations(undefined, eventId);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch registrations" });
    }
  });

  app.post("/api/registrations", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = String(req.body?.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
      const result = await createRegistration({ ...(req.body || {}), event_id: eventId });
      if (result.statusCode === 200 && typeof result.content.id === "string") {
        await recordAudit(req, "registration.created", "registration", String(result.content.id), {
          sender_id: req.body?.sender_id || null,
          event_id: eventId,
        });
      }
      res.status(result.statusCode).json(result.content);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to register user" });
    }
  });

  app.post("/api/registrations/checkin", requireRoles(["owner", "admin", "operator", "checker"]), async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.body;
      const updated = await appDb.checkInRegistration(id);
      if (updated) {
        await recordAudit(req, "registration.checked_in", "registration", String(id || "").trim().toUpperCase());
        res.json({ status: "success" });
      } else {
        res.status(404).json({ error: "Registration not found or already cancelled" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to check in" });
    }
  });

  app.post("/api/registrations/cancel", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const result = await cancelRegistration(req.body?.id);
      if (result.statusCode === 200) {
        await recordAudit(req, "registration.cancelled", "registration", String(req.body?.id || "").trim().toUpperCase());
      }
      res.status(result.statusCode).json(result.content);
    } catch (error) {
      res.status(500).json({ error: "Failed to cancel registration" });
    }
  });

  app.post("/api/registrations/status", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.body?.id || "").trim().toUpperCase();
      const status = String(req.body?.status || "").trim();
      const allowedStatuses = new Set(["registered", "cancelled", "checked-in"]);

      if (!id || !allowedStatuses.has(status)) {
        return res.status(400).json({ error: "Invalid registration ID or status" });
      }

      const updated = await appDb.updateRegistrationStatus(id, status as RegistrationStatus);
      if (updated) {
        await recordAudit(req, "registration.status_updated", "registration", id, {
          status,
        });
        return res.json({ status: "success", id, registration_status: status });
      }

      return res.status(404).json({ error: "Registration not found" });
    } catch (error) {
      console.error("Failed to update registration status:", error);
      res.status(500).json({ error: "Failed to update registration status" });
    }
  });

  app.get("/api/registrations/export", requireAuth, async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const rows = await appDb.exportRegistrations(eventId);
      const eventName = (await appDb.getSettingValue("event_name", eventId)) || "event";
      
      // Create a short slug for the filename
      const slug = eventName
        .toLowerCase()
        .replace(/[^a-z0-9ก-๙]/g, "-") // Keep Thai characters and alphanumeric
        .split("-")
        .filter(Boolean)
        .slice(0, 3) // Take first 3 words
        .join("-");
      
      const filename = `registrations-${slug || "data"}.csv`;
      
      const json2csvParser = new Parser();
      const csv = json2csvParser.parse(rows);
      
      // Add UTF-8 BOM for Excel compatibility with Thai characters
      const csvWithBOM = "\uFEFF" + csv;
      
      res.header("Content-Type", "text/csv; charset=utf-8");
      res.attachment(filename);
      res.send(csvWithBOM);
    } catch (error) {
      res.status(500).json({ error: "Failed to export CSV" });
    }
  });

  app.get("/api/tickets/:id.png", async (req, res) => {
    try {
      const registrationId = String(req.params.id || "").trim().toUpperCase();
      if (!registrationId) {
        return res.status(400).send("Missing registration ID");
      }

      const reg = await getRegistrationById(registrationId);
      if (!reg) {
        return res.status(404).send("Ticket not found");
      }

      const settings = await getSettingsMap(reg.event_id || DEFAULT_EVENT_ID);
      const qrDataUrl = await QRCode.toDataURL(reg.id, { width: 220, margin: 1 });
      let png: Buffer;

      try {
        png = await renderTicketPngScreenshotBuffer(reg, settings, qrDataUrl);
      } catch (screenshotError) {
        console.error("Failed to render ticket PNG via screenshot, falling back to resvg:", screenshotError);
        const svg = renderTicketSvg(reg, settings, qrDataUrl);
        png = Buffer.from(renderTicketPngBuffer(svg));
      }

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(png);
    } catch (error) {
      console.error("Failed to render ticket PNG:", error);
      res.status(500).send("Failed to render ticket PNG");
    }
  });

  app.get("/api/tickets/:id.svg", async (req, res) => {
    try {
      const registrationId = String(req.params.id || "").trim().toUpperCase();
      if (!registrationId) {
        return res.status(400).send("Missing registration ID");
      }

      const reg = await getRegistrationById(registrationId);
      if (!reg) {
        return res.status(404).send("Ticket not found");
      }

      const settings = await getSettingsMap(reg.event_id || DEFAULT_EVENT_ID);
      const qrDataUrl = await QRCode.toDataURL(reg.id, { width: 220, margin: 1 });
      const svg = renderTicketSvg(reg, settings, qrDataUrl);

      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(svg);
    } catch (error) {
      console.error("Failed to render ticket image:", error);
      res.status(500).send("Failed to render ticket");
    }
  });

  app.get("/api/settings", requireAuth, async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      res.json(await getSettingsMap(eventId));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = String(req.body?.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
      const body = Object.fromEntries(
        Object.entries(req.body || {})
          .filter(([key]) => key !== "event_id")
          .map(([key, value]) => [key, String(value)]),
      ) as Record<string, string>;
      await appDb.upsertSettings(body, eventId);
      await recordAudit(req, "settings.updated", "settings", eventId, {
        keys: Object.keys(body),
        event_id: eventId,
      });
      res.json({ status: "ok" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  app.get("/api/messages", requireRoles(["owner", "admin", "operator", "viewer"]), async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const messages = await appDb.listMessages(100, eventId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.get("/api/llm/models", requireRoles(["owner", "admin", "operator"]), async (req, res) => {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(400).json({ error: "OPENROUTER_API_KEY is not configured in .env" });
    }

    try {
      const upstream = await fetch("https://openrouter.ai/api/v1/models", {
        headers: openRouterHeaders(),
      });

      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: payload?.error?.message || "Failed to fetch OpenRouter models",
        });
      }

      const models = Array.isArray(payload?.data)
        ? payload.data
            .map((model: any) => ({
              id: model.id,
              name: model.name || model.id,
              context_length: model.context_length,
              pricing: model.pricing || null,
            }))
            .filter((model: any) => Boolean(model.id))
            .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))
        : [];

      res.json(models);
    } catch (error) {
      console.error("OpenRouter models error:", error);
      res.status(500).json({ error: "Failed to fetch OpenRouter models" });
    }
  });

  app.post("/api/llm/chat", requireRoles(["owner", "admin", "operator"]), async (req, res) => {
    try {
      const body = req.body || {};
      const message = typeof body.message === "string" ? body.message : "";
      const history = Array.isArray(body.history) ? (body.history as ChatHistoryMessage[]) : [];
      const eventId = typeof body.event_id === "string" && body.event_id.trim() ? body.event_id.trim() : DEFAULT_EVENT_ID;
      const settings = (body.settings && typeof body.settings === "object")
        ? body.settings as Record<string, any>
        : await getSettingsMap(eventId);
      const event = await appDb.getEventById(eventId);
      const response = await requestOpenRouterChat(message, history, settings, event?.effective_status || "active");
      res.json(response);
    } catch (error) {
      console.error("OpenRouter chat error:", error);
      const message = error instanceof Error ? error.message : "Failed to get response from OpenRouter";
      const status = /OPENROUTER_API_KEY/.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  // Facebook Webhook Verification
  app.get("/api/webhook", (req, res) => {
    void (async () => {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      const verifyToken = await appDb.getSettingValue("verify_token");

      if (mode && token) {
        if (mode === "subscribe" && token === verifyToken) {
          console.log("WEBHOOK_VERIFIED");
          res.status(200).send(challenge);
        } else {
          res.sendStatus(403);
        }
      } else {
        res.sendStatus(400);
      }
    })().catch((error) => {
      console.error("Webhook verification lookup failed:", error);
      res.sendStatus(500);
    });
  });

  // Facebook Webhook Event Handling
  app.post("/api/webhook", (req, res) => {
    const body = req.body;

    if (!body || body.object !== "page") {
      res.sendStatus(404);
      return;
    }

    res.status(200).send("EVENT_RECEIVED");

    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
      const messagingEvents = Array.isArray(entry?.messaging) ? entry.messaging : [];
      for (const webhookEvent of messagingEvents) {
        console.log("Received webhook event:", webhookEvent);

        const senderId = webhookEvent?.sender?.id;
        const pageId = webhookEvent?.recipient?.id;
        const text = webhookEvent?.message?.text;
        const isEcho = webhookEvent?.message?.is_echo;
        if (!senderId || !text || isEcho) continue;

        void handleIncomingFacebookText(senderId, text, pageId).catch((error) => {
          console.error("Failed to handle incoming Facebook message:", error);
        });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
