import express, { type NextFunction, type Request, type Response } from "express";
import { createServer as createViteServer } from "vite";
import { Parser } from "json2csv";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";
import { createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import dotenv from "dotenv";
import { enqueueEmbeddingJob, startEmbeddedEmbeddingWorker, canUseEmbeddingQueue, type EmbeddingJob } from "./backend/runtime/embeddingQueue";
import { enqueueFacebookInboundJob, startEmbeddedFacebookWorker, acquireFacebookWebhookDedup, buildFacebookWebhookDedupKey, canUseFacebookWebhookQueue, type FacebookInboundJob } from "./backend/runtime/facebookQueue";
import { enqueueInstagramInboundJob, startEmbeddedInstagramWorker, acquireInstagramWebhookDedup, buildInstagramWebhookDedupKey, canUseInstagramWebhookQueue, type InstagramInboundJob } from "./backend/runtime/instagramQueue";
import { enqueueLineInboundJob, startEmbeddedLineWorker, acquireLineWebhookDedup, buildLineWebhookDedupKey, canUseLineWebhookQueue, type LineInboundJob } from "./backend/runtime/lineQueue";
import { enqueueTelegramInboundJob, startEmbeddedTelegramWorker, acquireTelegramWebhookDedup, buildTelegramWebhookDedupKey, canUseTelegramWebhookQueue, type TelegramInboundJob } from "./backend/runtime/telegramQueue";
import { enqueueWhatsAppInboundJob, startEmbeddedWhatsAppWorker, acquireWhatsAppWebhookDedup, buildWhatsAppWebhookDedupKey, canUseWhatsAppWebhookQueue, type WhatsAppInboundJob } from "./backend/runtime/whatsappQueue";
import { createRateLimitMiddleware } from "./backend/runtime/rateLimit";
import { pingRedis } from "./backend/runtime/redis";
import { buildEmbeddingHookPayload, getEmbeddingModelName } from "./backend/documents";
import {
  ALLOWED_CHANNEL_PLATFORMS,
  CHANNEL_PLATFORM_DEFINITIONS,
  getChannelConfigSummary,
  getChannelConnectionStatus,
  getChannelMissingRequirements,
  getChannelPlatformDefinition,
  getPresentSecretConfigFields,
  safeParseChannelConfig,
  sanitizeChannelConfig,
} from "./backend/channelPlatforms";
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
  type ChannelPlatform,
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
const APP_RUNTIME = String(process.env.APP_RUNTIME || "all").trim().toLowerCase();
const RUN_WEB_SERVER = APP_RUNTIME !== "worker";
const RUN_EMBEDDED_WORKER = APP_RUNTIME === "all";

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

type RawBodyRequest = Request & {
  rawBody?: Buffer;
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

function getSystemInstruction(settings: Record<string, any>, eventStatus = "active", knowledgeContext = "") {
  const globalPrompt = String(settings.global_system_prompt || "").trim();
  const eventContext = String(settings.context || "").trim();
  return [
    globalPrompt,
    eventContext ? `Event Context:\n${eventContext}` : "",
    knowledgeContext,
    buildEventInfo(settings, eventStatus),
    "Never guess the current date or time. Use the Current System Time above as the source of truth.",
    "Respect the Event Status Right Now field.",
    "If event status is pending, explain that the event is still being prepared and registration has not launched yet.",
    "If event status is cancelled, clearly explain that the event has been cancelled.",
    "If event status is closed, clearly explain that the event has already ended.",
    "Respect the Registration Status Right Now field. If it is invalid, explain that the registration schedule is misconfigured. If it is not_started or closed, clearly tell the user registration is unavailable and do not imply it is open.",
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

function verifyFacebookWebhookSignature(req: RawBodyRequest) {
  const appSecret = String(process.env.FACEBOOK_APP_SECRET || "").trim();
  if (!appSecret) return true;

  const signatureHeader = req.headers["x-hub-signature-256"];
  if (typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  if (!req.rawBody?.length) {
    return false;
  }

  const expectedHex = createHmac("sha256", appSecret)
    .update(req.rawBody)
    .digest("hex");
  const providedHex = signatureHeader.slice("sha256=".length).trim().toLowerCase();

  try {
    const expected = Buffer.from(expectedHex, "hex");
    const provided = Buffer.from(providedHex, "hex");
    if (expected.length === 0 || provided.length === 0 || expected.length !== provided.length) {
      return false;
    }
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
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

async function getEventDocuments(eventId: string) {
  return appDb.listEventDocuments(eventId);
}

async function getEventDocumentChunks(eventId: string) {
  return appDb.listEventDocumentChunks(eventId);
}

async function getRegistrationById(id: string) {
  return appDb.getRegistrationById(id);
}

async function buildCheckinSessionAccessPayload(session: Awaited<ReturnType<typeof appDb.getCheckinSessionByTokenHash>>) {
  if (!session) return null;
  const event = await appDb.getEventById(session.event_id);
  if (!event) return null;
  const settings = await getSettingsMap(session.event_id);
  return {
    id: session.id,
    label: session.label,
    event_id: session.event_id,
    event_name: settings.event_name || event.name,
    event_location: settings.event_location || "",
    event_timezone: settings.event_timezone || "Asia/Bangkok",
    event_date: settings.event_date || "",
    event_status: event.effective_status,
    expires_at: session.expires_at,
    last_used_at: session.last_used_at,
  };
}

function serializeRegistrationForCheckin(registration: RegistrationRow) {
  return {
    id: registration.id,
    event_id: registration.event_id || null,
    first_name: registration.first_name,
    last_name: registration.last_name,
    phone: registration.phone,
    email: registration.email,
    timestamp: registration.timestamp,
    status: registration.status,
  };
}

async function performCheckinForRegistration(registrationId: unknown, eventId?: string) {
  const normalizedId = String(registrationId || "").trim().toUpperCase();
  if (!normalizedId) {
    return { statusCode: 400, body: { error: "Registration ID is required" } };
  }

  const existing = await getRegistrationById(normalizedId);
  if (!existing || (eventId && existing.event_id !== eventId)) {
    return { statusCode: 404, body: { error: "Registration not found" } };
  }

  if (existing.status === "cancelled") {
    return { statusCode: 400, body: { error: "Registration has been cancelled", registration: serializeRegistrationForCheckin(existing) } };
  }

  const alreadyCheckedIn = existing.status === "checked-in";
  if (!alreadyCheckedIn) {
    const updated = await appDb.checkInRegistration(normalizedId);
    if (!updated) {
      return { statusCode: 404, body: { error: "Registration not found or already cancelled" } };
    }
  }

  const fresh = await getRegistrationById(normalizedId);
  const registration = fresh || existing;
  return {
    statusCode: 200,
    body: {
      status: "success",
      already_checked_in: alreadyCheckedIn,
      registration: serializeRegistrationForCheckin(registration),
    },
  };
}

async function saveMessage(senderId: string, text: string, type: "incoming" | "outgoing", eventId?: string, pageId?: string) {
  await appDb.saveMessage(senderId, text, type, eventId, pageId);
}

async function saveLineDeliveryTrace(
  senderId: string,
  eventId: string,
  destination: string,
  status: string,
  detail: string,
) {
  const normalizedDetail = String(detail || "").trim();
  await saveMessage(
    senderId,
    `[line:${status}] ${normalizedDetail}`.trim(),
    "outgoing",
    eventId,
    destination,
  );
}

async function getFacebookAccessToken(pageId?: string) {
  if (pageId) {
    const channel = await appDb.getChannelAccount("facebook", pageId);
    if (channel?.is_active === false) {
      return "";
    }
    if (channel?.access_token) {
      return channel.access_token;
    }
  }
  return process.env.PAGE_ACCESS_TOKEN || "";
}

async function getLineChannel(destination?: string) {
  if (!destination) return null;
  const channel = await appDb.getChannelAccount("line_oa", destination);
  if (!channel || channel.is_active === false) {
    return null;
  }
  return channel;
}

async function getLineAccessToken(destination?: string) {
  const channel = await getLineChannel(destination);
  return channel?.access_token || "";
}

async function getLineChannelSecret(destination?: string) {
  const channel = await getLineChannel(destination);
  const config = safeParseChannelConfig(channel?.config_json);
  return String(config.channel_secret || "").trim();
}

async function getInstagramChannel(accountId?: string) {
  if (!accountId) return null;
  const channel = await appDb.getChannelAccount("instagram", accountId);
  if (!channel || channel.is_active === false) {
    return null;
  }
  return channel;
}

async function getInstagramAccessToken(accountId?: string) {
  const channel = await getInstagramChannel(accountId);
  return channel?.access_token || "";
}

async function getWhatsAppChannel(phoneNumberId?: string) {
  if (!phoneNumberId) return null;
  const channel = await appDb.getChannelAccount("whatsapp", phoneNumberId);
  if (!channel || channel.is_active === false) {
    return null;
  }
  return channel;
}

async function getWhatsAppAccessToken(phoneNumberId?: string) {
  const channel = await getWhatsAppChannel(phoneNumberId);
  return channel?.access_token || "";
}

async function getTelegramChannel(botKey?: string) {
  if (!botKey) return null;
  const channel = await appDb.getChannelAccount("telegram", botKey);
  if (!channel || channel.is_active === false) {
    return null;
  }
  return channel;
}

async function getTelegramAccessToken(botKey?: string) {
  const channel = await getTelegramChannel(botKey);
  return channel?.access_token || "";
}

async function getTelegramWebhookSecret(botKey?: string) {
  const channel = await getTelegramChannel(botKey);
  const config = safeParseChannelConfig(channel?.config_json);
  return String(config.webhook_secret || "").trim();
}

async function getWebChatChannel(widgetKey?: string) {
  if (!widgetKey) return null;
  const channel = await appDb.getChannelAccount("web_chat", widgetKey);
  if (!channel || channel.is_active === false) {
    return null;
  }
  return channel;
}

function isWebChatOriginAllowed(origin: string | undefined, config: Record<string, string>) {
  const allowList = String(config.allowed_origin || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowList.length === 0) {
    return true;
  }

  const requestOrigin = String(origin || "").trim();
  if (!requestOrigin) {
    return false;
  }

  return allowList.includes(requestOrigin);
}

function verifyLineWebhookSignature(rawBody: Buffer | undefined, providedSignature: string | undefined, channelSecret: string) {
  if (!rawBody || !providedSignature || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const provided = String(providedSignature || "").trim();
  if (!expected || !provided || expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function buildWebChatPublicConfig(widgetKey: string, settings: Record<string, string>, config: Record<string, string>) {
  return {
    widget_key: widgetKey,
    event_name: String(settings.event_name || "Event Assistant").trim() || "Event Assistant",
    welcome_text: String(config.welcome_text || "").trim() || "สวัสดีค่ะ มีอะไรให้ช่วยเกี่ยวกับงานนี้ได้บ้าง",
    theme_color: String(config.theme_color || "").trim() || "#2563eb",
  };
}

function applyWebChatCorsHeaders(res: Response, origin: string | undefined, config: Record<string, string>) {
  const requestOrigin = String(origin || "").trim();
  if (!requestOrigin) {
    return isWebChatOriginAllowed("", config);
  }

  if (!isWebChatOriginAllowed(requestOrigin, config)) {
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", requestOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return true;
}

async function buildWebChatArtifacts(eventId: string, registrationIds: string[]) {
  const uniqueTicketIds = [...new Set(registrationIds)];
  if (uniqueTicketIds.length === 0) {
    return {
      tickets: [] as Array<{
        registration_id: string;
        summary_text: string;
        png_url: string | null;
        svg_url: string | null;
      }>,
      map_url: null as string | null,
    };
  }

  const settings = await getSettingsMap(eventId);
  const tickets: Array<{
    registration_id: string;
    summary_text: string;
    png_url: string | null;
    svg_url: string | null;
  }> = [];

  for (const registrationId of uniqueTicketIds) {
    const reg = await getRegistrationById(registrationId);
    if (!reg) continue;
    tickets.push({
      registration_id: registrationId,
      summary_text: buildTicketSummaryText(reg, settings),
      png_url: buildTicketImageUrl(registrationId, "png"),
      svg_url: buildTicketImageUrl(registrationId, "svg"),
    });
  }

  const mapUrl = String(settings.event_map_url || "").trim();
  return {
    tickets,
    map_url: mapUrl || null,
  };
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

function tokenizeForDocumentMatch(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function rankKnowledgeMatches(
  documents: Array<{ id: string; title: string; content: string; source_type: string; source_url?: string | null; is_active: boolean }>,
  chunks: Array<{ document_id: string; chunk_index: number; content: string }>,
  message: string,
) {
  const activeDocuments = documents.filter((document) => document.is_active);
  if (!activeDocuments.length) return [] as Array<{
    document: { id: string; title: string; content: string; source_type: string; source_url?: string | null; is_active: boolean };
    chunk: { document_id: string; chunk_index: number; content: string };
    index: number;
    score: number;
  }>;

  const documentMap = new Map(activeDocuments.map((document) => [document.id, document]));
  const normalizedMessage = String(message || "").trim().toLowerCase();
  const tokens = tokenizeForDocumentMatch(message);

  return chunks
    .filter((chunk) => documentMap.has(chunk.document_id))
    .map((chunk, index) => {
      const document = documentMap.get(chunk.document_id)!;
      const haystack = `${document.title}\n${chunk.content}\n${document.source_url || ""}`.toLowerCase();
      let score = 0;

      if (normalizedMessage && normalizedMessage.length >= 4 && haystack.includes(normalizedMessage)) {
        score += 6;
      }

      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 1;
        }
      }

      return { document, chunk, index, score };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
}

function buildKnowledgeContext(
  documents: Array<{ id: string; title: string; content: string; source_type: string; source_url?: string | null; is_active: boolean }>,
  chunks: Array<{ document_id: string; chunk_index: number; content: string }>,
  message: string,
) {
  const rankedChunks = rankKnowledgeMatches(documents, chunks, message);

  const selected = rankedChunks
    .filter((entry, index) => entry.score > 0 || index < 2)
    .slice(0, 5);

  if (!selected.length) {
    return "";
  }

  const maxTotalLength = 6000;
  let used = 0;
  const sections: string[] = [];
  const chunksPerDocument = new Map<string, number>();

  for (const entry of selected) {
    const { document, chunk } = entry;
    const currentCount = chunksPerDocument.get(document.id) || 0;
    if (currentCount >= 2) continue;

    const block = [
      `Title: ${document.title}`,
      `Source Type: ${document.source_type}`,
      document.source_url ? `Source URL: ${document.source_url}` : "",
      `Chunk: ${chunk.chunk_index + 1}`,
      `Content:\n${chunk.content}`,
    ].filter(Boolean).join("\n");

    if (used >= maxTotalLength) break;
    const trimmed = block.length + used > maxTotalLength
      ? block.slice(0, Math.max(0, maxTotalLength - used - 1)) + "…"
      : block;
    used += trimmed.length;
    sections.push(trimmed);
    chunksPerDocument.set(document.id, currentCount + 1);
  }

  return sections.length
    ? `Event Knowledge Documents:\n${sections.map((section, index) => `Document ${index + 1}\n${section}`).join("\n\n")}`
    : "";
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
  knowledgeContext = "",
): Promise<NormalizedChatResponse> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured in .env");
  }

  const model = (typeof settings.llm_model === "string" && settings.llm_model.trim())
    ? settings.llm_model.trim()
    : (typeof settings.global_llm_model === "string" && settings.global_llm_model.trim())
    ? settings.global_llm_model.trim()
    : DEFAULT_OPENROUTER_MODEL;

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: getSystemInstruction(settings, eventStatus, knowledgeContext),
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
  const documents = await getEventDocuments(eventId);
  const chunks = await getEventDocumentChunks(eventId);
  const knowledgeContext = buildKnowledgeContext(documents, chunks, incomingText);
  const event = await appDb.getEventById(eventId);
  const history = historyOverride || await getMessageHistoryForSender(senderId, 12, eventId);

  const firstResponse = await requestOpenRouterChat(incomingText, history, settings, event?.effective_status || "active", knowledgeContext);
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
      knowledgeContext,
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

function normalizeLineText(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.length > 4000 ? `${trimmed.slice(0, 3997)}...` : trimmed;
}

async function sendLineReplyTextMessage(replyToken: string, text: string, destination?: string) {
  const accessToken = await getLineAccessToken(destination);
  if (!accessToken) {
    throw new Error("LINE channel access token is not configured");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: normalizeLineText(text),
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to send LINE reply");
  }
  return payload;
}

async function sendLinePushTextMessage(recipientId: string, text: string, destination?: string) {
  const accessToken = await getLineAccessToken(destination);
  if (!accessToken) {
    throw new Error("LINE channel access token is not configured");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: recipientId,
      messages: [
        {
          type: "text",
          text: normalizeLineText(text),
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to send LINE push");
  }
  return payload;
}

async function sendLinePushImageMessage(recipientId: string, imageUrl: string, destination?: string) {
  const accessToken = await getLineAccessToken(destination);
  if (!accessToken) {
    throw new Error("LINE channel access token is not configured");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: recipientId,
      messages: [
        {
          type: "image",
          originalContentUrl: imageUrl,
          previewImageUrl: imageUrl,
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to send LINE image");
  }
  return payload;
}

async function sendInstagramTextMessage(recipientId: string, text: string, accountId?: string) {
  const accessToken = await getInstagramAccessToken(accountId);
  if (!accessToken) {
    throw new Error("Instagram access token is not configured");
  }

  const apiVersion = process.env.FACEBOOK_GRAPH_API_VERSION || "v22.0";
  const url = new URL(`https://graph.facebook.com/${apiVersion}/me/messages`);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: {
        text,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Failed to send message to Instagram");
  }

  return payload;
}

async function sendInstagramImageMessage(recipientId: string, imageUrl: string, accountId?: string) {
  const accessToken = await getInstagramAccessToken(accountId);
  if (!accessToken) {
    throw new Error("Instagram access token is not configured");
  }

  const apiVersion = process.env.FACEBOOK_GRAPH_API_VERSION || "v22.0";
  const url = new URL(`https://graph.facebook.com/${apiVersion}/me/messages`);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
    throw new Error(payload?.error?.message || "Failed to send image to Instagram");
  }

  return payload;
}

async function sendWhatsAppTextMessage(recipientId: string, text: string, phoneNumberId?: string) {
  const accessToken = await getWhatsAppAccessToken(phoneNumberId);
  if (!accessToken) {
    throw new Error("WhatsApp access token is not configured");
  }

  const targetPhoneNumberId = String(phoneNumberId || "").trim();
  if (!targetPhoneNumberId) {
    throw new Error("WhatsApp phone number ID is required");
  }

  const apiVersion = process.env.FACEBOOK_GRAPH_API_VERSION || "v22.0";
  const url = new URL(`https://graph.facebook.com/${apiVersion}/${targetPhoneNumberId}/messages`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipientId,
      type: "text",
      text: {
        body: normalizeLineText(text),
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Failed to send message to WhatsApp");
  }

  return payload;
}

async function sendWhatsAppImageMessage(recipientId: string, imageUrl: string, phoneNumberId?: string) {
  const accessToken = await getWhatsAppAccessToken(phoneNumberId);
  if (!accessToken) {
    throw new Error("WhatsApp access token is not configured");
  }

  const targetPhoneNumberId = String(phoneNumberId || "").trim();
  if (!targetPhoneNumberId) {
    throw new Error("WhatsApp phone number ID is required");
  }

  const apiVersion = process.env.FACEBOOK_GRAPH_API_VERSION || "v22.0";
  const url = new URL(`https://graph.facebook.com/${apiVersion}/${targetPhoneNumberId}/messages`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: recipientId,
      type: "image",
      image: {
        link: imageUrl,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Failed to send image to WhatsApp");
  }

  return payload;
}

async function sendTelegramTextMessage(chatId: string, text: string, botKey?: string) {
  const accessToken = await getTelegramAccessToken(botKey);
  if (!accessToken) {
    throw new Error("Telegram bot token is not configured");
  }

  const response = await fetch(`https://api.telegram.org/bot${accessToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.description || "Failed to send message to Telegram");
  }

  return payload;
}

async function sendTelegramImageMessage(chatId: string, imageUrl: string, botKey?: string) {
  const accessToken = await getTelegramAccessToken(botKey);
  if (!accessToken) {
    throw new Error("Telegram bot token is not configured");
  }

  const response = await fetch(`https://api.telegram.org/bot${accessToken}/sendPhoto`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      photo: imageUrl,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.description || "Failed to send image to Telegram");
  }

  return payload;
}

async function handleIncomingFacebookText(senderId: string, text: string, pageId?: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  const resolvedEventId = pageId ? await appDb.resolveEventIdForPage(pageId) : DEFAULT_EVENT_ID;
  if (pageId && !resolvedEventId) {
    console.warn(`No active event mapping found for Facebook page ${pageId}; skipping automated reply`);
    return;
  }
  const eventId = resolvedEventId || DEFAULT_EVENT_ID;
  const priorHistory = await getMessageHistoryForSender(senderId, 12, eventId);
  await saveMessage(senderId, trimmed, "incoming", eventId, pageId);

  if (!(await getFacebookAccessToken(pageId))) {
    console.warn(`Facebook access token is unavailable for page ${pageId || "default"}; skipping outbound reply`);
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

async function handleIncomingLineText(senderId: string, text: string, destination: string, replyToken?: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  const resolvedEventId = await appDb.resolveEventIdForChannel("line_oa", destination);
  if (!resolvedEventId) {
    console.warn(`No active event mapping found for LINE destination ${destination}; skipping automated reply`);
    return;
  }
  const eventId = resolvedEventId;
  const priorHistory = await getMessageHistoryForSender(senderId, 12, eventId);
  await saveMessage(senderId, trimmed, "incoming", eventId, destination);

  if (!(await getLineAccessToken(destination))) {
    console.warn(`LINE access token is unavailable for destination ${destination}; skipping outbound reply`);
    await saveLineDeliveryTrace(senderId, eventId, destination, "channel-misconfigured", "Missing LINE access token");
    return;
  }

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateBotReplyForSender(senderId, eventId, trimmed, priorHistory);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
  } catch (error) {
    console.error("Failed to generate LINE bot reply:", error);
    replyText = "ขออภัย ระบบตอบกลับอัตโนมัติขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง";
  }

  if (replyText) {
    try {
      if (replyToken) {
        await sendLineReplyTextMessage(replyToken, replyText, destination);
        await saveLineDeliveryTrace(senderId, eventId, destination, "reply-sent", "Sent via reply token");
      } else {
        await sendLinePushTextMessage(senderId, replyText, destination);
        await saveLineDeliveryTrace(senderId, eventId, destination, "push-sent", "Sent via push fallback");
      }
      await saveMessage(senderId, replyText, "outgoing", eventId, destination);
    } catch (error) {
      console.error("Failed to send LINE reply text:", error);
      await saveLineDeliveryTrace(senderId, eventId, destination, "reply-failed", error instanceof Error ? error.message : String(error));
      if (replyToken) {
        try {
          await sendLinePushTextMessage(senderId, replyText, destination);
          await saveLineDeliveryTrace(senderId, eventId, destination, "push-fallback-sent", "Reply token failed; delivered via push");
          await saveMessage(senderId, replyText, "outgoing", eventId, destination);
        } catch (pushError) {
          console.error("Failed to send LINE push fallback text:", pushError);
          await saveLineDeliveryTrace(senderId, eventId, destination, "push-fallback-failed", pushError instanceof Error ? pushError.message : String(pushError));
        }
      }
    }
  }

  const uniqueTicketIds = [...new Set(ticketRegistrationIds)];
  let sentTicketArtifact = false;
  const settings = uniqueTicketIds.length > 0 ? await getSettingsMap(eventId) : null;
  for (const registrationId of uniqueTicketIds) {
    const reg = await getRegistrationById(registrationId);
    if (reg && settings) {
      const ticketSummaryText = buildTicketSummaryText(reg, settings);
      try {
        await sendLinePushTextMessage(senderId, ticketSummaryText, destination);
        await saveMessage(senderId, `[ticket-summary] ${registrationId}`, "outgoing", eventId, destination);
      } catch (error) {
        console.error("Failed to send LINE ticket summary:", error);
      }
    }

    const ticketPngUrl = buildTicketImageUrl(registrationId, "png");
    const ticketSvgUrl = buildTicketImageUrl(registrationId, "svg");
    if (!ticketPngUrl && !ticketSvgUrl) {
      console.warn("APP_URL is not set; skipping LINE ticket image send");
      continue;
    }

    try {
      if (!ticketPngUrl) throw new Error("PNG ticket URL is not available");
      await sendLinePushImageMessage(senderId, ticketPngUrl, destination);
      await saveMessage(senderId, `[ticket-image-png] ${registrationId}`, "outgoing", eventId, destination);
      sentTicketArtifact = true;
    } catch (error) {
      console.error("Failed to send LINE PNG ticket image:", error);
      try {
        const textUrl = ticketPngUrl || ticketSvgUrl;
        if (!textUrl) throw new Error("No ticket URL available");
        await sendLinePushTextMessage(senderId, `ตั๋วของคุณ: ${textUrl}`, destination);
        await saveMessage(senderId, `[ticket-link] ${registrationId}`, "outgoing", eventId, destination);
        sentTicketArtifact = true;
      } catch (fallbackError) {
        console.error("Failed to send LINE ticket link fallback:", fallbackError);
      }
    }
  }

  if (uniqueTicketIds.length > 0 && sentTicketArtifact) {
    const mapUrl = String(settings?.event_map_url || "").trim();
    if (mapUrl) {
      try {
        await sendLinePushTextMessage(senderId, `แผนที่สถานที่: ${mapUrl}`, destination);
        await saveMessage(senderId, `[map-link] ${mapUrl}`, "outgoing", eventId, destination);
      } catch (error) {
        console.error("Failed to send LINE map link:", error);
      }
    }
  }
}

async function handleIncomingInstagramText(senderId: string, text: string, accountId?: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  const resolvedEventId = accountId ? await appDb.resolveEventIdForChannel("instagram", accountId) : null;
  if (!resolvedEventId) {
    console.warn(`No active event mapping found for Instagram account ${accountId || "unknown"}; skipping automated reply`);
    return;
  }
  const eventId = resolvedEventId;
  const priorHistory = await getMessageHistoryForSender(senderId, 12, eventId);
  await saveMessage(senderId, trimmed, "incoming", eventId, accountId);

  if (!(await getInstagramAccessToken(accountId))) {
    console.warn(`Instagram access token is unavailable for account ${accountId || "unknown"}; skipping outbound reply`);
    return;
  }

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateBotReplyForSender(senderId, eventId, trimmed, priorHistory);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
  } catch (error) {
    console.error("Failed to generate Instagram bot reply:", error);
    replyText = "ขออภัย ระบบตอบกลับอัตโนมัติขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง";
  }

  if (replyText) {
    await sendInstagramTextMessage(senderId, replyText, accountId);
    await saveMessage(senderId, replyText, "outgoing", eventId, accountId);
  }

  const uniqueTicketIds = [...new Set(ticketRegistrationIds)];
  let sentTicketArtifact = false;
  const settings = uniqueTicketIds.length > 0 ? await getSettingsMap(eventId) : null;
  for (const registrationId of uniqueTicketIds) {
    const reg = await getRegistrationById(registrationId);
    if (reg && settings) {
      const ticketSummaryText = buildTicketSummaryText(reg, settings);
      try {
        await sendInstagramTextMessage(senderId, ticketSummaryText, accountId);
        await saveMessage(senderId, `[ticket-summary] ${registrationId}`, "outgoing", eventId, accountId);
      } catch (error) {
        console.error("Failed to send Instagram ticket summary:", error);
      }
    }

    const ticketPngUrl = buildTicketImageUrl(registrationId, "png");
    const ticketSvgUrl = buildTicketImageUrl(registrationId, "svg");
    if (!ticketPngUrl && !ticketSvgUrl) {
      console.warn("APP_URL is not set; skipping Instagram ticket image send");
      continue;
    }

    try {
      if (!ticketPngUrl) throw new Error("PNG ticket URL is not available");
      await sendInstagramImageMessage(senderId, ticketPngUrl, accountId);
      await saveMessage(senderId, `[ticket-image-png] ${registrationId}`, "outgoing", eventId, accountId);
      sentTicketArtifact = true;
    } catch (error) {
      console.error("Failed to send Instagram PNG ticket image:", error);
      try {
        const textUrl = ticketPngUrl || ticketSvgUrl;
        if (!textUrl) throw new Error("No ticket URL available");
        await sendInstagramTextMessage(senderId, `ตั๋วของคุณ: ${textUrl}`, accountId);
        await saveMessage(senderId, `[ticket-link] ${registrationId}`, "outgoing", eventId, accountId);
        sentTicketArtifact = true;
      } catch (fallbackError) {
        console.error("Failed to send Instagram ticket link fallback:", fallbackError);
      }
    }
  }

  if (uniqueTicketIds.length > 0 && sentTicketArtifact) {
    const mapUrl = String(settings?.event_map_url || "").trim();
    if (mapUrl) {
      try {
        await sendInstagramTextMessage(senderId, `แผนที่สถานที่: ${mapUrl}`, accountId);
        await saveMessage(senderId, `[map-link] ${mapUrl}`, "outgoing", eventId, accountId);
      } catch (error) {
        console.error("Failed to send Instagram map link:", error);
      }
    }
  }
}

async function handleIncomingWhatsAppText(senderId: string, text: string, phoneNumberId?: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  const resolvedEventId = phoneNumberId ? await appDb.resolveEventIdForChannel("whatsapp", phoneNumberId) : null;
  if (!resolvedEventId) {
    console.warn(`No active event mapping found for WhatsApp phone number ${phoneNumberId || "unknown"}; skipping automated reply`);
    return;
  }
  const eventId = resolvedEventId;
  const priorHistory = await getMessageHistoryForSender(senderId, 12, eventId);
  await saveMessage(senderId, trimmed, "incoming", eventId, phoneNumberId);

  if (!(await getWhatsAppAccessToken(phoneNumberId))) {
    console.warn(`WhatsApp access token is unavailable for phone number ${phoneNumberId || "unknown"}; skipping outbound reply`);
    return;
  }

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateBotReplyForSender(senderId, eventId, trimmed, priorHistory);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
  } catch (error) {
    console.error("Failed to generate WhatsApp bot reply:", error);
    replyText = "ขออภัย ระบบตอบกลับอัตโนมัติขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง";
  }

  if (replyText) {
    await sendWhatsAppTextMessage(senderId, replyText, phoneNumberId);
    await saveMessage(senderId, replyText, "outgoing", eventId, phoneNumberId);
  }

  const uniqueTicketIds = [...new Set(ticketRegistrationIds)];
  let sentTicketArtifact = false;
  const settings = uniqueTicketIds.length > 0 ? await getSettingsMap(eventId) : null;
  for (const registrationId of uniqueTicketIds) {
    const reg = await getRegistrationById(registrationId);
    if (reg && settings) {
      const ticketSummaryText = buildTicketSummaryText(reg, settings);
      try {
        await sendWhatsAppTextMessage(senderId, ticketSummaryText, phoneNumberId);
        await saveMessage(senderId, `[ticket-summary] ${registrationId}`, "outgoing", eventId, phoneNumberId);
      } catch (error) {
        console.error("Failed to send WhatsApp ticket summary:", error);
      }
    }

    const ticketPngUrl = buildTicketImageUrl(registrationId, "png");
    const ticketSvgUrl = buildTicketImageUrl(registrationId, "svg");
    if (!ticketPngUrl && !ticketSvgUrl) {
      console.warn("APP_URL is not set; skipping WhatsApp ticket image send");
      continue;
    }

    try {
      if (!ticketPngUrl) throw new Error("PNG ticket URL is not available");
      await sendWhatsAppImageMessage(senderId, ticketPngUrl, phoneNumberId);
      await saveMessage(senderId, `[ticket-image-png] ${registrationId}`, "outgoing", eventId, phoneNumberId);
      sentTicketArtifact = true;
    } catch (error) {
      console.error("Failed to send WhatsApp PNG ticket image:", error);
      try {
        const textUrl = ticketPngUrl || ticketSvgUrl;
        if (!textUrl) throw new Error("No ticket URL available");
        await sendWhatsAppTextMessage(senderId, `ตั๋วของคุณ: ${textUrl}`, phoneNumberId);
        await saveMessage(senderId, `[ticket-link] ${registrationId}`, "outgoing", eventId, phoneNumberId);
        sentTicketArtifact = true;
      } catch (fallbackError) {
        console.error("Failed to send WhatsApp ticket link fallback:", fallbackError);
      }
    }
  }

  if (uniqueTicketIds.length > 0 && sentTicketArtifact) {
    const mapUrl = String(settings?.event_map_url || "").trim();
    if (mapUrl) {
      try {
        await sendWhatsAppTextMessage(senderId, `แผนที่สถานที่: ${mapUrl}`, phoneNumberId);
        await saveMessage(senderId, `[map-link] ${mapUrl}`, "outgoing", eventId, phoneNumberId);
      } catch (error) {
        console.error("Failed to send WhatsApp map link:", error);
      }
    }
  }
}

async function handleIncomingTelegramText(senderId: string, text: string, botKey?: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  const resolvedEventId = botKey ? await appDb.resolveEventIdForChannel("telegram", botKey) : null;
  if (!resolvedEventId) {
    console.warn(`No active event mapping found for Telegram bot ${botKey || "unknown"}; skipping automated reply`);
    return;
  }
  const eventId = resolvedEventId;
  const priorHistory = await getMessageHistoryForSender(senderId, 12, eventId);
  await saveMessage(senderId, trimmed, "incoming", eventId, botKey);

  if (!(await getTelegramAccessToken(botKey))) {
    console.warn(`Telegram bot token is unavailable for bot ${botKey || "unknown"}; skipping outbound reply`);
    return;
  }

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateBotReplyForSender(senderId, eventId, trimmed, priorHistory);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
  } catch (error) {
    console.error("Failed to generate Telegram bot reply:", error);
    replyText = "ขออภัย ระบบตอบกลับอัตโนมัติขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง";
  }

  if (replyText) {
    await sendTelegramTextMessage(senderId, replyText, botKey);
    await saveMessage(senderId, replyText, "outgoing", eventId, botKey);
  }

  const uniqueTicketIds = [...new Set(ticketRegistrationIds)];
  let sentTicketArtifact = false;
  const settings = uniqueTicketIds.length > 0 ? await getSettingsMap(eventId) : null;
  for (const registrationId of uniqueTicketIds) {
    const reg = await getRegistrationById(registrationId);
    if (reg && settings) {
      const ticketSummaryText = buildTicketSummaryText(reg, settings);
      try {
        await sendTelegramTextMessage(senderId, ticketSummaryText, botKey);
        await saveMessage(senderId, `[ticket-summary] ${registrationId}`, "outgoing", eventId, botKey);
      } catch (error) {
        console.error("Failed to send Telegram ticket summary:", error);
      }
    }

    const ticketPngUrl = buildTicketImageUrl(registrationId, "png");
    const ticketSvgUrl = buildTicketImageUrl(registrationId, "svg");
    if (!ticketPngUrl && !ticketSvgUrl) {
      console.warn("APP_URL is not set; skipping Telegram ticket image send");
      continue;
    }

    try {
      if (!ticketPngUrl) throw new Error("PNG ticket URL is not available");
      await sendTelegramImageMessage(senderId, ticketPngUrl, botKey);
      await saveMessage(senderId, `[ticket-image-png] ${registrationId}`, "outgoing", eventId, botKey);
      sentTicketArtifact = true;
    } catch (error) {
      console.error("Failed to send Telegram PNG ticket image:", error);
      try {
        const textUrl = ticketPngUrl || ticketSvgUrl;
        if (!textUrl) throw new Error("No ticket URL available");
        await sendTelegramTextMessage(senderId, `ตั๋วของคุณ: ${textUrl}`, botKey);
        await saveMessage(senderId, `[ticket-link] ${registrationId}`, "outgoing", eventId, botKey);
        sentTicketArtifact = true;
      } catch (fallbackError) {
        console.error("Failed to send Telegram ticket link fallback:", fallbackError);
      }
    }
  }

  if (uniqueTicketIds.length > 0 && sentTicketArtifact) {
    const mapUrl = String(settings?.event_map_url || "").trim();
    if (mapUrl) {
      try {
        await sendTelegramTextMessage(senderId, `แผนที่สถานที่: ${mapUrl}`, botKey);
        await saveMessage(senderId, `[map-link] ${mapUrl}`, "outgoing", eventId, botKey);
      } catch (error) {
        console.error("Failed to send Telegram map link:", error);
      }
    }
  }
}

function normalizeFacebookInboundJob(webhookEvent: any): FacebookInboundJob | null {
  const senderId = String(webhookEvent?.sender?.id || "").trim();
  const pageId = String(webhookEvent?.recipient?.id || "").trim();
  const text = String(webhookEvent?.message?.text || "").trim();
  const isEcho = Boolean(webhookEvent?.message?.is_echo);

  if (!senderId || !text || isEcho) {
    return null;
  }

  return {
    dedupKey: buildFacebookWebhookDedupKey(webhookEvent),
    senderId,
    pageId: pageId || null,
    text,
    messageMid: typeof webhookEvent?.message?.mid === "string" ? webhookEvent.message.mid.trim() : null,
    eventTimestamp: Number(webhookEvent?.timestamp || Date.now()),
  };
}

function normalizeLineTextEvent(event: any, destination: string) {
  const senderId = String(event?.source?.userId || "").trim();
  const text = String(event?.message?.text || "").trim();
  const replyToken = String(event?.replyToken || "").trim();
  const messageType = String(event?.message?.type || "").trim();
  const eventType = String(event?.type || "").trim();

  if (!senderId || !destination || !text || eventType !== "message" || messageType !== "text") {
    return null;
  }

  return {
    dedupKey: buildLineWebhookDedupKey(event, destination),
    senderId,
    destination,
    replyToken: replyToken || null,
    text,
    eventTimestamp: Number(event?.timestamp || Date.now()),
    webhookEventId: String(event?.webhookEventId || event?.message?.id || "").trim() || null,
  } satisfies LineInboundJob;
}

function normalizeInstagramTextEvent(webhookEvent: any, fallbackAccountId?: string) {
  const senderId = String(webhookEvent?.sender?.id || "").trim();
  const accountId = String(webhookEvent?.recipient?.id || fallbackAccountId || "").trim();
  const text = String(webhookEvent?.message?.text || "").trim();
  const isEcho = Boolean(webhookEvent?.message?.is_echo);

  if (!senderId || !accountId || !text || isEcho) {
    return null;
  }

  return {
    dedupKey: buildInstagramWebhookDedupKey(webhookEvent, fallbackAccountId),
    senderId,
    accountId,
    text,
    messageMid: typeof webhookEvent?.message?.mid === "string" ? webhookEvent.message.mid.trim() : null,
    eventTimestamp: Number(webhookEvent?.timestamp || Date.now()),
  } satisfies InstagramInboundJob;
}

function normalizeWhatsAppTextEvent(message: any, phoneNumberId?: string) {
  const senderId = String(message?.from || "").trim();
  const text = String(message?.text?.body || "").trim();
  const messageType = String(message?.type || "").trim();
  const resolvedPhoneNumberId = String(phoneNumberId || "").trim();

  if (!senderId || !resolvedPhoneNumberId || !text || messageType !== "text") {
    return null;
  }

  return {
    dedupKey: buildWhatsAppWebhookDedupKey(message, phoneNumberId),
    senderId,
    phoneNumberId: resolvedPhoneNumberId,
    text,
    messageId: typeof message?.id === "string" ? message.id.trim() : null,
    eventTimestamp: Number(message?.timestamp || Date.now()),
  } satisfies WhatsAppInboundJob;
}

function normalizeTelegramTextUpdate(update: any, botKey: string) {
  const message = update?.message;
  const senderId = String(message?.chat?.id || message?.from?.id || "").trim();
  const text = String(message?.text || "").trim();
  if (!senderId || !text) {
    return null;
  }

  return {
    dedupKey: buildTelegramWebhookDedupKey(update, botKey),
    senderId,
    botKey,
    text,
    updateId: Number.isFinite(Number(update?.update_id)) ? String(update.update_id) : null,
    eventTimestamp: Number(message?.date || Date.now()),
  } satisfies TelegramInboundJob;
}

async function processFacebookInboundJob(job: FacebookInboundJob) {
  await handleIncomingFacebookText(job.senderId, job.text, job.pageId || undefined);
}

async function processInstagramInboundJob(job: InstagramInboundJob) {
  await handleIncomingInstagramText(job.senderId, job.text, job.accountId);
}

async function processLineInboundJob(job: LineInboundJob) {
  await handleIncomingLineText(job.senderId, job.text, job.destination, job.replyToken || undefined);
}

async function processWhatsAppInboundJob(job: WhatsAppInboundJob) {
  await handleIncomingWhatsAppText(job.senderId, job.text, job.phoneNumberId);
}

async function processTelegramInboundJob(job: TelegramInboundJob) {
  await handleIncomingTelegramText(job.senderId, job.text, job.botKey);
}

async function processEmbeddingJob(job: EmbeddingJob) {
  const documents = await getEventDocuments(job.eventId);
  const document = documents.find((row) => row.id === job.documentId);
  if (!document) {
    return;
  }

  if (!document.is_active) {
    await appDb.setEventDocumentEmbeddingStatus(job.documentId, "skipped", {
      embeddingModel: getEmbeddingModelName(),
      embeddedAt: null,
    });
    return;
  }

  if (document.content_hash && job.contentHash && document.content_hash !== job.contentHash) {
    return;
  }

  const chunks = (await getEventDocumentChunks(job.eventId)).filter((chunk) => chunk.document_id === job.documentId);
  const payload = buildEmbeddingHookPayload(document, chunks);
  const hookUrl = String(process.env.EMBEDDING_HOOK_URL || "").trim();

  if (!hookUrl) {
    console.warn("Embedding job skipped because EMBEDDING_HOOK_URL is not configured:", job.documentId);
    await appDb.setEventDocumentEmbeddingStatus(job.documentId, "failed", {
      embeddingModel: payload.embedding_model,
      embeddedAt: null,
    });
    return;
  }

  try {
    const response = await fetch(hookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Embedding hook responded with ${response.status}`);
    }

    await appDb.setEventDocumentEmbeddingStatus(job.documentId, "ready", {
      embeddingModel: payload.embedding_model,
      embeddedAt: new Date(),
    });
  } catch (error) {
    console.error("Failed to process embedding job:", job.documentId, error);
    await appDb.setEventDocumentEmbeddingStatus(job.documentId, "failed", {
      embeddingModel: payload.embedding_model,
      embeddedAt: null,
    });
  }
}

async function startServer() {
  await appDb.initialize();

  if (RUN_EMBEDDED_WORKER) {
    await startEmbeddedFacebookWorker(processFacebookInboundJob, { enabled: true });
    await startEmbeddedInstagramWorker(processInstagramInboundJob, { enabled: true });
    await startEmbeddedLineWorker(processLineInboundJob, { enabled: true });
    await startEmbeddedWhatsAppWorker(processWhatsAppInboundJob, { enabled: true });
    await startEmbeddedTelegramWorker(processTelegramInboundJob, { enabled: true });
    await startEmbeddedEmbeddingWorker(processEmbeddingJob, { enabled: true });
  }

  if (!RUN_WEB_SERVER) {
    console.log(`Worker runtime started (APP_RUNTIME=${APP_RUNTIME || "all"})`);
    return;
  }

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = Buffer.from(buf);
    },
  }));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(attachSession);

  const PORT = Number(process.env.PORT || 3000);
  const loginRateLimit = createRateLimitMiddleware({
    name: "auth-login",
    windowMs: 10 * 60 * 1000,
    max: 10,
    keyFn: (req) => `${getRequestIp(req)}:${normalizeUsername(req.body?.username) || "unknown"}`,
    errorMessage: "Too many login attempts. Please wait and try again.",
  });
  const webhookRateLimit = createRateLimitMiddleware({
    name: "facebook-webhook",
    windowMs: 60 * 1000,
    max: 240,
    keyFn: (req) => getRequestIp(req) || "unknown",
    errorMessage: "Too many webhook requests. Please retry later.",
  });
  const lineWebhookRateLimit = createRateLimitMiddleware({
    name: "line-webhook",
    windowMs: 60 * 1000,
    max: 240,
    keyFn: (req) => getRequestIp(req) || "unknown",
    errorMessage: "Too many LINE webhook requests. Please retry later.",
  });
  const webChatRateLimit = createRateLimitMiddleware({
    name: "web-chat",
    windowMs: 60 * 1000,
    max: 120,
    keyFn: (req) => getRequestIp(req) || "unknown",
    errorMessage: "Too many web chat requests. Please retry later.",
  });

  // API Routes
  app.get("/api/health", async (_req, res) => {
    try {
      await appDb.ping();
      const redis = await pingRedis();
      res.json({
        status: "ok",
        time: new Date().toISOString(),
        database: appDb.driver,
        runtime: APP_RUNTIME || "all",
        queue: canUseFacebookWebhookQueue() ? "redis" : "inline",
        instagram_queue: canUseInstagramWebhookQueue() ? "redis" : "inline",
        line_queue: canUseLineWebhookQueue() ? "redis" : "inline",
        whatsapp_queue: canUseWhatsAppWebhookQueue() ? "redis" : "inline",
        telegram_queue: canUseTelegramWebhookQueue() ? "redis" : "inline",
        embedding_queue: canUseEmbeddingQueue() ? "redis" : "inline",
        redis: redis.configured ? (redis.healthy ? "ok" : "error") : "disabled",
      });
    } catch (error) {
      console.error("Health check failed:", error);
      res.status(500).json({ status: "error", time: new Date().toISOString(), database: appDb.driver, runtime: APP_RUNTIME || "all" });
    }
  });

  app.post("/api/auth/login", loginRateLimit, async (req, res) => {
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

  app.get("/api/checkin-sessions", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const sessions = await appDb.listCheckinSessions(eventId);
      return res.json(sessions);
    } catch (error) {
      console.error("Failed to fetch check-in sessions:", error);
      return res.status(500).json({ error: "Failed to fetch check-in sessions" });
    }
  });

  app.post("/api/checkin-sessions", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = String(req.body?.event_id || "").trim() || DEFAULT_EVENT_ID;
      const label = String(req.body?.label || "").trim();
      const expiresHours = Number.parseInt(String(req.body?.expires_hours || "8"), 10);

      if (!label) {
        return res.status(400).json({ error: "Session label is required" });
      }
      if (!Number.isFinite(expiresHours) || expiresHours < 1 || expiresHours > 168) {
        return res.status(400).json({ error: "Expiry must be between 1 and 168 hours" });
      }

      const event = await appDb.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }
      if (event.effective_status === "closed" || event.effective_status === "cancelled") {
        return res.status(400).json({ error: "Check-in access cannot be generated for closed or cancelled events" });
      }

      const rawToken = createSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);
      const session = await appDb.createCheckinSession({
        event_id: eventId,
        label,
        created_by_user_id: req.auth?.user.id || null,
        expires_at: expiresAt,
        token_hash: tokenHash,
      });

      await recordAudit(req, "checkin.session_created", "checkin_session", session.id, {
        event_id: eventId,
        label,
        expires_at: expiresAt.toISOString(),
      });

      const appUrl = String(process.env.APP_URL || "").trim();
      const accessPath = `/?checkin_token=${encodeURIComponent(rawToken)}`;
      return res.status(201).json({
        session,
        access_token: rawToken,
        access_path: accessPath,
        access_url: appUrl ? `${appUrl}${accessPath}` : accessPath,
      });
    } catch (error) {
      console.error("Failed to create check-in session:", error);
      return res.status(500).json({ error: "Failed to create check-in session" });
    }
  });

  app.post("/api/checkin-sessions/:id/revoke", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const sessionId = String(req.params.id || "").trim();
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required" });
      }
      const revoked = await appDb.revokeCheckinSession(sessionId);
      if (!revoked) {
        return res.status(404).json({ error: "Check-in session not found" });
      }
      await recordAudit(req, "checkin.session_revoked", "checkin_session", sessionId);
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Failed to revoke check-in session:", error);
      return res.status(500).json({ error: "Failed to revoke check-in session" });
    }
  });

  app.get("/api/checkin-access/session", async (req, res) => {
    try {
      const rawToken = String(req.query.token || "").trim();
      if (!rawToken) {
        return res.status(400).json({ error: "Check-in token is required" });
      }
      const session = await appDb.getCheckinSessionByTokenHash(hashSessionToken(rawToken));
      const payload = await buildCheckinSessionAccessPayload(session);
      if (!payload) {
        return res.status(404).json({ error: "Check-in session not found or expired" });
      }
      await appDb.touchCheckinSession(session.id);
      return res.json({ session: payload });
    } catch (error) {
      console.error("Failed to resolve check-in session:", error);
      return res.status(500).json({ error: "Failed to resolve check-in session" });
    }
  });

  app.post("/api/checkin-access/checkin", async (req, res) => {
    try {
      const rawToken = String(req.body?.token || "").trim();
      if (!rawToken) {
        return res.status(400).json({ error: "Check-in token is required" });
      }

      const session = await appDb.getCheckinSessionByTokenHash(hashSessionToken(rawToken));
      if (!session) {
        return res.status(401).json({ error: "Check-in session not found or expired" });
      }

      const result = await performCheckinForRegistration(req.body?.id, session.event_id);
      await appDb.touchCheckinSession(session.id);

      if (result.statusCode === 200) {
        await appDb.recordAuditLog({
          actor_user_id: null,
          action: result.body.already_checked_in ? "registration.checkin_repeated" : "registration.checked_in_via_token",
          target_type: "registration",
          target_id: String(req.body?.id || "").trim().toUpperCase(),
          metadata: {
            event_id: session.event_id,
            checkin_session_id: session.id,
            ip: getRequestIp(req),
          },
        });
      }

      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error("Failed to check in via token:", error);
      return res.status(500).json({ error: "Failed to check in attendee" });
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

  app.get("/api/channels", requireAuth, async (req, res) => {
    try {
      const platform = typeof req.query.platform === "string" ? req.query.platform.trim() as ChannelPlatform : undefined;
      const channels = await appDb.listChannelAccounts(platform);
      return res.json(
        channels.map((channel) => ({
          id: channel.id,
          platform: channel.platform,
          platform_label: getChannelPlatformDefinition(channel.platform)?.label || channel.platform,
          platform_description: getChannelPlatformDefinition(channel.platform)?.description || "",
          external_id: channel.external_id,
          display_name: channel.display_name,
          event_id: channel.event_id,
          is_active: channel.is_active,
          has_access_token: Boolean(channel.access_token),
          live_messaging_ready: getChannelPlatformDefinition(channel.platform)?.live_messaging_ready || false,
          connection_status: getChannelConnectionStatus(channel.platform, {
            hasAccessToken: Boolean(channel.access_token),
            config: safeParseChannelConfig(channel.config_json),
          }),
          missing_requirements: getChannelMissingRequirements(channel.platform, {
            hasAccessToken: Boolean(channel.access_token),
            config: safeParseChannelConfig(channel.config_json),
          }),
          config: safeParseChannelConfig(channel.config_json),
          config_summary: getChannelConfigSummary(channel.platform, safeParseChannelConfig(channel.config_json)),
          secret_config_fields_present: getPresentSecretConfigFields(channel.platform, safeParseChannelConfig(channel.config_json)),
          created_at: channel.created_at,
          updated_at: channel.updated_at,
        })),
      );
    } catch (error) {
      console.error("Failed to fetch channels:", error);
      return res.status(500).json({ error: "Failed to fetch channels" });
    }
  });

  app.get("/api/channel-platforms", requireAuth, async (_req, res) => {
    try {
      return res.json(ALLOWED_CHANNEL_PLATFORMS.map((platform) => CHANNEL_PLATFORM_DEFINITIONS[platform]));
    } catch (error) {
      console.error("Failed to fetch channel platform definitions:", error);
      return res.status(500).json({ error: "Failed to fetch channel platform definitions" });
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

  app.post("/api/channels", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const platform = String(req.body?.platform || "facebook").trim() as ChannelPlatform;
      const externalId = String(req.body?.external_id || "").trim();
      const displayName = String(req.body?.display_name || "").trim();
      const eventId = String(req.body?.event_id || "").trim();
      const accessToken = String(req.body?.access_token || "").trim();
      const isActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : true;
      if (!ALLOWED_CHANNEL_PLATFORMS.includes(platform)) {
        return res.status(400).json({ error: "Invalid channel platform" });
      }
      if (!externalId || !eventId) {
        return res.status(400).json({ error: "external_id and event_id are required" });
      }

      const event = await appDb.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      const existingChannel = await appDb.getChannelAccount(platform, externalId);
      const nextConfig = sanitizeChannelConfig(platform, req.body?.config);
      const mergedConfig = {
        ...(existingChannel ? safeParseChannelConfig(existingChannel.config_json) : {}),
        ...nextConfig,
      };
      const effectiveHasAccessToken = Boolean(accessToken || existingChannel?.access_token || (platform === "facebook" && process.env.PAGE_ACCESS_TOKEN));
      const missingRequirements = getChannelMissingRequirements(platform, {
        hasAccessToken: effectiveHasAccessToken,
        config: mergedConfig,
      });
      const isDisableOnlyUpdate =
        Boolean(existingChannel) &&
        existingChannel?.event_id === eventId &&
        isActive === false;

      if ((event.effective_status === "closed" || event.effective_status === "cancelled") && !isDisableOnlyUpdate) {
        return res.status(400).json({
          error: "Closed or cancelled events cannot link or re-enable channels",
        });
      }

      if (isActive && missingRequirements.length > 0) {
        return res.status(400).json({
          error: `Missing required channel setup: ${missingRequirements.join(", ")}`,
          missing_requirements: missingRequirements,
        });
      }

      const channel = await appDb.upsertChannelAccount({
        platform,
        external_id: externalId,
        display_name: displayName || externalId,
        event_id: eventId,
        access_token: accessToken,
        config_json: JSON.stringify(mergedConfig),
        is_active: isActive,
      });

      await recordAudit(req, "channel.upserted", "channel", channel.id, {
        platform: channel.platform,
        external_id: channel.external_id,
        event_id: channel.event_id,
        is_active: channel.is_active,
      });

      return res.json({
        id: channel.id,
        platform: channel.platform,
        platform_label: getChannelPlatformDefinition(channel.platform)?.label || channel.platform,
        platform_description: getChannelPlatformDefinition(channel.platform)?.description || "",
        external_id: channel.external_id,
        display_name: channel.display_name,
        event_id: channel.event_id,
        is_active: channel.is_active,
        has_access_token: Boolean(channel.access_token),
        live_messaging_ready: getChannelPlatformDefinition(channel.platform)?.live_messaging_ready || false,
        connection_status: getChannelConnectionStatus(channel.platform, {
          hasAccessToken: Boolean(channel.access_token),
          config: safeParseChannelConfig(channel.config_json),
        }),
        missing_requirements: getChannelMissingRequirements(channel.platform, {
          hasAccessToken: Boolean(channel.access_token),
          config: safeParseChannelConfig(channel.config_json),
        }),
        config: safeParseChannelConfig(channel.config_json),
        config_summary: getChannelConfigSummary(channel.platform, safeParseChannelConfig(channel.config_json)),
        secret_config_fields_present: getPresentSecretConfigFields(channel.platform, safeParseChannelConfig(channel.config_json)),
        created_at: channel.created_at,
        updated_at: channel.updated_at,
      });
    } catch (error) {
      console.error("Failed to upsert channel:", error);
      return res.status(500).json({ error: "Failed to save channel" });
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
      const result = await performCheckinForRegistration(req.body?.id);
      if (result.statusCode === 200) {
        await recordAudit(req, result.body.already_checked_in ? "registration.checkin_repeated" : "registration.checked_in", "registration", String(req.body?.id || "").trim().toUpperCase());
      }
      res.status(result.statusCode).json(result.body);
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

  app.post("/api/registrations/delete", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.body?.id || "").trim().toUpperCase();
      if (!id) {
        return res.status(400).json({ error: "Registration ID is required" });
      }

      const deleted = await appDb.deleteRegistration(id);
      if (!deleted) {
        return res.status(404).json({ error: "Registration not found" });
      }

      await recordAudit(req, "registration.deleted", "registration", id);
      return res.json({ status: "success", id });
    } catch (error) {
      console.error("Failed to delete registration:", error);
      return res.status(500).json({ error: "Failed to delete registration" });
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
      const mergedSettings = {
        ...(await getSettingsMap(eventId)),
        ...body,
      };
      const timingState = getEventState(mergedSettings);
      if (timingState.registrationStatus === "invalid") {
        return res.status(400).json({ error: "Close date must be later than or equal to open date" });
      }
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

  app.post("/api/event-knowledge/reset", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = String(req.body?.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
      const clearContext = req.body?.clear_context !== false;
      const event = await appDb.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      const result = await appDb.resetEventKnowledge(eventId, { clearContext });
      await recordAudit(req, "event_knowledge.reset", "event", eventId, {
        documents_deleted: result.documentsDeleted,
        chunks_deleted: result.chunksDeleted,
        context_cleared: result.contextCleared,
        clear_context: clearContext,
      });

      return res.json({
        status: "ok",
        event_id: eventId,
        documents_deleted: result.documentsDeleted,
        chunks_deleted: result.chunksDeleted,
        context_cleared: result.contextCleared,
        clear_context: clearContext,
      });
    } catch (error) {
      console.error("Failed to reset event knowledge:", error);
      return res.status(500).json({ error: "Failed to reset event knowledge" });
    }
  });

  app.get("/api/documents", requireAuth, async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const rows = await getEventDocuments(eventId);
      res.json(rows);
    } catch (error) {
      console.error("Failed to fetch documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.get("/api/documents/:id/chunks", requireAuth, async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const documentId = String(req.params.id || "").trim();
      if (!documentId) {
        return res.status(400).json({ error: "Document ID is required" });
      }

      const documents = await getEventDocuments(eventId);
      const document = documents.find((row) => row.id === documentId);
      if (!document) {
        return res.status(404).json({ error: "Document not found for this event" });
      }

      const chunks = await getEventDocumentChunks(eventId);
      return res.json(chunks.filter((chunk) => chunk.document_id === documentId));
    } catch (error) {
      console.error("Failed to fetch document chunks:", error);
      return res.status(500).json({ error: "Failed to fetch document chunks" });
    }
  });

  app.get("/api/documents/:id/embedding-preview", requireAuth, async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const documentId = String(req.params.id || "").trim();
      if (!documentId) {
        return res.status(400).json({ error: "Document ID is required" });
      }

      const documents = await getEventDocuments(eventId);
      const document = documents.find((row) => row.id === documentId);
      if (!document) {
        return res.status(404).json({ error: "Document not found for this event" });
      }

      const chunks = (await getEventDocumentChunks(eventId)).filter((chunk) => chunk.document_id === documentId);

      return res.json({
        event_id: eventId,
        embedding_model: getEmbeddingModelName(),
        document,
        chunks,
        payload: buildEmbeddingHookPayload(document, chunks),
      });
    } catch (error) {
      console.error("Failed to fetch embedding preview:", error);
      return res.status(500).json({ error: "Failed to fetch embedding preview" });
    }
  });

  app.post("/api/documents/:id/embedding-enqueue", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const documentId = String(req.params.id || "").trim();
      if (!documentId) {
        return res.status(400).json({ error: "Document ID is required" });
      }

      const documents = await getEventDocuments(eventId);
      const document = documents.find((row) => row.id === documentId);
      if (!document) {
        return res.status(404).json({ error: "Document not found for this event" });
      }

      await appDb.setEventDocumentEmbeddingStatus(documentId, document.is_active ? "pending" : "skipped", {
        embeddingModel: getEmbeddingModelName(),
        embeddedAt: null,
      });

      const job = {
        eventId,
        documentId,
        contentHash: String(document.content_hash || ""),
      } satisfies EmbeddingJob;

      let queued = false;
      if (canUseEmbeddingQueue()) {
        queued = await enqueueEmbeddingJob(job);
      }

      if (!queued) {
        await processEmbeddingJob(job);
      }

      await appDb.recordAuditLog({
        actor_user_id: req.auth?.user.id || null,
        action: "document.embedding.enqueue",
        target_type: "event_document",
        target_id: documentId,
        metadata: {
          event_id: eventId,
          queued,
          hook_configured: Boolean(String(process.env.EMBEDDING_HOOK_URL || "").trim()),
        },
      });

      return res.json({
        status: "ok",
        queued,
        document_id: documentId,
        embedding_status: document.is_active ? "pending" : "skipped",
      });
    } catch (error) {
      console.error("Failed to enqueue embedding job:", error);
      return res.status(500).json({ error: "Failed to enqueue embedding job" });
    }
  });

  app.get("/api/documents/retrieval-debug", requireAuth, async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const query = String(req.query?.query || "").trim();
      const documents = await getEventDocuments(eventId);
      const chunks = await getEventDocumentChunks(eventId);
      const settings = await getSettingsMap(eventId);
      const activeDocuments = documents.filter((document) => document.is_active);
      const activeDocumentIds = new Set(activeDocuments.map((document) => document.id));
      const activeChunks = chunks.filter((chunk) => activeDocumentIds.has(chunk.document_id));
      const ranked = rankKnowledgeMatches(documents, chunks, query);
      const matches = ranked
        .filter((entry, index) => entry.score > 0 || index < 3)
        .slice(0, 8)
        .map((entry, index) => ({
          rank: index + 1,
          score: entry.score,
          document_id: entry.document.id,
          document_title: entry.document.title,
          source_type: entry.document.source_type,
          source_url: entry.document.source_url || null,
          chunk_index: entry.chunk.chunk_index,
          chunk_content: entry.chunk.content,
        }));

      return res.json({
        event_id: eventId,
        query,
        layers: {
          global_system_prompt_present: Boolean(String(settings.global_system_prompt || "").trim()),
          global_system_prompt_chars: String(settings.global_system_prompt || "").trim().length,
          event_context_present: Boolean(String(settings.context || "").trim()),
          event_context_chars: String(settings.context || "").trim().length,
          active_document_count: activeDocuments.length,
          active_chunk_count: activeChunks.length,
        },
        matches,
        composed_knowledge_context: buildKnowledgeContext(documents, chunks, query),
      });
    } catch (error) {
      console.error("Failed to fetch retrieval debug:", error);
      return res.status(500).json({ error: "Failed to fetch retrieval debug" });
    }
  });

  app.post("/api/documents", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = String(req.body?.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
      const title = String(req.body?.title || "").trim();
      const content = String(req.body?.content || "").trim();
      const sourceType = String(req.body?.source_type || "note").trim() || "note";
      const sourceUrl = String(req.body?.source_url || "").trim();
      const isActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : true;
      const allowedSourceTypes = new Set(["note", "document", "url"]);

      if (!title || !content) {
        return res.status(400).json({ error: "title and content are required" });
      }
      if (!allowedSourceTypes.has(sourceType)) {
        return res.status(400).json({ error: "Invalid source_type" });
      }

      const document = await appDb.upsertEventDocument({
        id: typeof req.body?.id === "string" ? req.body.id : undefined,
        event_id: eventId,
        title,
        source_type: sourceType as "note" | "document" | "url",
        source_url: sourceUrl,
        content,
        is_active: isActive,
      });
      await recordAudit(req, "document.upserted", "event_document", document.id, {
        event_id: eventId,
        source_type: sourceType,
        is_active: document.is_active,
      });
      res.json(document);
    } catch (error) {
      console.error("Failed to save document:", error);
      res.status(500).json({ error: "Failed to save document" });
    }
  });

  app.post("/api/documents/:id/status", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const documentId = String(req.params.id || "").trim();
      const isActive = Boolean(req.body?.is_active);
      if (!documentId) {
        return res.status(400).json({ error: "Document ID is required" });
      }

      const updated = await appDb.setEventDocumentActive(documentId, isActive);
      if (!updated) {
        return res.status(404).json({ error: "Document not found" });
      }

      await recordAudit(req, "document.status_updated", "event_document", documentId, {
        is_active: isActive,
      });
      res.json({ status: "ok", id: documentId, is_active: isActive });
    } catch (error) {
      console.error("Failed to update document status:", error);
      res.status(500).json({ error: "Failed to update document status" });
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
      const documents = await getEventDocuments(eventId);
      const chunks = await getEventDocumentChunks(eventId);
      const knowledgeContext = buildKnowledgeContext(documents, chunks, message);
      const event = await appDb.getEventById(eventId);
      const response = await requestOpenRouterChat(message, history, settings, event?.effective_status || "active", knowledgeContext);
      res.json(response);
    } catch (error) {
      console.error("OpenRouter chat error:", error);
      const message = error instanceof Error ? error.message : "Failed to get response from OpenRouter";
      const status = /OPENROUTER_API_KEY/.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  // Facebook Webhook Verification
  app.get("/api/webhook", webhookRateLimit, (req, res) => {
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
  app.post("/api/webhook", webhookRateLimit, (req: RawBodyRequest, res) => {
    if (!verifyFacebookWebhookSignature(req)) {
      console.warn("Rejected Facebook webhook due to invalid signature");
      res.sendStatus(401);
      return;
    }

    const body = req.body;

    if (!body || body.object !== "page") {
      res.sendStatus(404);
      return;
    }

    res.status(200).send("EVENT_RECEIVED");

    const entries = Array.isArray(body.entry) ? body.entry : [];
    void (async () => {
      for (const entry of entries) {
        const messagingEvents = Array.isArray(entry?.messaging) ? entry.messaging : [];
        for (const webhookEvent of messagingEvents) {
          console.log("Received webhook event:", webhookEvent);

          const normalized = normalizeFacebookInboundJob(webhookEvent);
          if (!normalized) continue;

          try {
            const accepted = await acquireFacebookWebhookDedup(normalized.dedupKey);
            if (!accepted) {
              console.log("Skipped duplicate Facebook webhook event:", normalized.dedupKey);
              continue;
            }

            if (canUseFacebookWebhookQueue()) {
              const queued = await enqueueFacebookInboundJob(normalized);
              if (queued) {
                continue;
              }
            }

            await processFacebookInboundJob(normalized);
          } catch (error) {
            console.error("Failed to handle incoming Facebook message:", error);
          }
        }
      }
    })();
  });

  app.post("/api/webhook/line", lineWebhookRateLimit, async (req: RawBodyRequest, res) => {
    try {
      const destination = String(req.body?.destination || "").trim();
      if (!destination) {
        return res.sendStatus(404);
      }

      const channel = await getLineChannel(destination);
      if (!channel) {
        return res.sendStatus(404);
      }

      const signature = typeof req.headers["x-line-signature"] === "string" ? req.headers["x-line-signature"] : "";
      const channelSecret = await getLineChannelSecret(destination);
      if (!verifyLineWebhookSignature(req.rawBody, signature, channelSecret)) {
        console.warn("Rejected LINE webhook due to invalid signature");
        return res.sendStatus(401);
      }

      res.status(200).json({ status: "ok" });

      const events = Array.isArray(req.body?.events) ? req.body.events : [];
      void (async () => {
        for (const webhookEvent of events) {
          try {
            const normalized = normalizeLineTextEvent(webhookEvent, destination);
            if (!normalized) continue;
            const acquired = await acquireLineWebhookDedup(normalized.dedupKey);
            if (!acquired) {
              console.log("Skipped duplicate LINE webhook event:", normalized.dedupKey);
              continue;
            }

            if (canUseLineWebhookQueue()) {
              const queued = await enqueueLineInboundJob(normalized);
              if (queued) {
                continue;
              }
            }

            await processLineInboundJob(normalized);
          } catch (error) {
            console.error("Failed to handle incoming LINE message:", error);
          }
        }
      })();
    } catch (error) {
      console.error("LINE webhook handler failed:", error);
      return res.sendStatus(500);
    }
  });

  app.get("/api/webhook/instagram", webhookRateLimit, (req, res) => {
    void (async () => {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      const verifyToken = await appDb.getSettingValue("verify_token");

      if (mode && token) {
        if (mode === "subscribe" && token === verifyToken) {
          console.log("INSTAGRAM_WEBHOOK_VERIFIED");
          res.status(200).send(challenge);
        } else {
          res.sendStatus(403);
        }
      } else {
        res.sendStatus(400);
      }
    })().catch((error) => {
      console.error("Instagram webhook verification lookup failed:", error);
      res.sendStatus(500);
    });
  });

  app.post("/api/webhook/instagram", webhookRateLimit, (req: RawBodyRequest, res) => {
    if (!verifyFacebookWebhookSignature(req)) {
      console.warn("Rejected Instagram webhook due to invalid signature");
      res.sendStatus(401);
      return;
    }

    const body = req.body;
    if (!body || body.object !== "instagram") {
      res.sendStatus(404);
      return;
    }

    res.status(200).send("EVENT_RECEIVED");

    const entries = Array.isArray(body.entry) ? body.entry : [];
    void (async () => {
      for (const entry of entries) {
        const entryAccountId = String(entry?.id || "").trim();
        const messagingEvents = Array.isArray(entry?.messaging) ? entry.messaging : [];
        for (const webhookEvent of messagingEvents) {
          try {
            const normalized = normalizeInstagramTextEvent(webhookEvent, entryAccountId);
            if (!normalized) continue;
            const acquired = await acquireInstagramWebhookDedup(normalized.dedupKey);
            if (!acquired) {
              console.log("Skipped duplicate Instagram webhook event:", normalized.dedupKey);
              continue;
            }

            if (canUseInstagramWebhookQueue()) {
              const queued = await enqueueInstagramInboundJob(normalized);
              if (queued) {
                continue;
              }
            }

            await processInstagramInboundJob(normalized);
          } catch (error) {
            console.error("Failed to handle incoming Instagram message:", error);
          }
        }
      }
    })();
  });

  app.get("/api/webhook/whatsapp", webhookRateLimit, (req, res) => {
    void (async () => {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      const verifyToken = await appDb.getSettingValue("verify_token");

      if (mode && token) {
        if (mode === "subscribe" && token === verifyToken) {
          console.log("WHATSAPP_WEBHOOK_VERIFIED");
          res.status(200).send(challenge);
        } else {
          res.sendStatus(403);
        }
      } else {
        res.sendStatus(400);
      }
    })().catch((error) => {
      console.error("WhatsApp webhook verification lookup failed:", error);
      res.sendStatus(500);
    });
  });

  app.post("/api/webhook/whatsapp", webhookRateLimit, (req: RawBodyRequest, res) => {
    if (!verifyFacebookWebhookSignature(req)) {
      console.warn("Rejected WhatsApp webhook due to invalid signature");
      res.sendStatus(401);
      return;
    }

    const body = req.body;
    if (!body || body.object !== "whatsapp_business_account") {
      res.sendStatus(404);
      return;
    }

    res.status(200).send("EVENT_RECEIVED");

    const entries = Array.isArray(body.entry) ? body.entry : [];
    void (async () => {
      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value || {};
          const phoneNumberId = String(value?.metadata?.phone_number_id || "").trim();
          const messages = Array.isArray(value?.messages) ? value.messages : [];
          for (const message of messages) {
            try {
              const normalized = normalizeWhatsAppTextEvent(message, phoneNumberId);
              if (!normalized) continue;
              const acquired = await acquireWhatsAppWebhookDedup(normalized.dedupKey);
              if (!acquired) {
                console.log("Skipped duplicate WhatsApp webhook event:", normalized.dedupKey);
                continue;
              }

              if (canUseWhatsAppWebhookQueue()) {
                const queued = await enqueueWhatsAppInboundJob(normalized);
                if (queued) {
                  continue;
                }
              }

              await processWhatsAppInboundJob(normalized);
            } catch (error) {
              console.error("Failed to handle incoming WhatsApp message:", error);
            }
          }
        }
      }
    })();
  });

  app.post("/api/webhook/telegram/:botKey", webhookRateLimit, async (req: RawBodyRequest, res) => {
    try {
      const botKey = String(req.params.botKey || "").trim();
      if (!botKey) {
        return res.sendStatus(404);
      }

      const channel = await getTelegramChannel(botKey);
      if (!channel) {
        return res.sendStatus(404);
      }

      const configuredSecret = await getTelegramWebhookSecret(botKey);
      const providedSecret = typeof req.headers["x-telegram-bot-api-secret-token"] === "string"
        ? req.headers["x-telegram-bot-api-secret-token"]
        : "";
      if (configuredSecret && configuredSecret !== providedSecret) {
        console.warn("Rejected Telegram webhook due to invalid secret token");
        return res.sendStatus(401);
      }

      res.status(200).json({ status: "ok" });

      const normalized = normalizeTelegramTextUpdate(req.body, botKey);
      if (!normalized) {
        return;
      }

      void (async () => {
        const acquired = await acquireTelegramWebhookDedup(normalized.dedupKey);
        if (!acquired) {
          console.log("Skipped duplicate Telegram webhook event:", normalized.dedupKey);
          return;
        }

        if (canUseTelegramWebhookQueue()) {
          const queued = await enqueueTelegramInboundJob(normalized);
          if (queued) {
            return;
          }
        }

        await processTelegramInboundJob(normalized);
      })().catch((error) => {
        console.error("Failed to handle incoming Telegram message:", error);
      });
    } catch (error) {
      console.error("Telegram webhook handler failed:", error);
      return res.sendStatus(500);
    }
  });

  app.options("/api/webchat/messages", async (req, res) => {
    try {
      const widgetKey = String(req.query.widget_key || "").trim();
      if (!widgetKey) {
        return res.sendStatus(400);
      }

      const channel = await getWebChatChannel(widgetKey);
      if (!channel) {
        return res.sendStatus(404);
      }

      const config = safeParseChannelConfig(channel.config_json);
      if (!applyWebChatCorsHeaders(res, typeof req.headers.origin === "string" ? req.headers.origin : "", config)) {
        return res.sendStatus(403);
      }

      return res.sendStatus(204);
    } catch (error) {
      console.error("Failed to prepare web chat CORS preflight:", error);
      return res.sendStatus(500);
    }
  });

  app.get("/api/webchat/config/:widgetKey", async (req, res) => {
    try {
      const widgetKey = String(req.params.widgetKey || "").trim();
      if (!widgetKey) {
        return res.status(400).json({ error: "Widget key is required" });
      }

      const channel = await getWebChatChannel(widgetKey);
      if (!channel) {
        return res.status(404).json({ error: "Web chat widget not found" });
      }

      const config = safeParseChannelConfig(channel.config_json);
      const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : "";
      if (requestOrigin && !applyWebChatCorsHeaders(res, requestOrigin, config)) {
        return res.status(403).json({ error: "Origin is not allowed for this widget" });
      }

      const eventId = await appDb.resolveEventIdForChannel("web_chat", widgetKey);
      if (!eventId) {
        return res.status(404).json({ error: "No active event mapping found for this widget" });
      }

      const settings = await getSettingsMap(eventId);
      return res.json({
        status: "ok",
        event_id: eventId,
        widget: buildWebChatPublicConfig(widgetKey, settings, config),
      });
    } catch (error) {
      console.error("Failed to load web chat config:", error);
      return res.status(500).json({ error: "Failed to load web chat config" });
    }
  });

  app.post("/api/webchat/messages", webChatRateLimit, async (req, res) => {
    try {
      const widgetKey = String(req.body?.widget_key || req.query.widget_key || "").trim();
      const senderId = String(req.body?.sender_id || "").trim();
      const text = String(req.body?.text || "").trim();

      if (!widgetKey || !senderId || !text) {
        return res.status(400).json({ error: "widget_key, sender_id, and text are required" });
      }

      const channel = await getWebChatChannel(widgetKey);
      if (!channel) {
        return res.status(404).json({ error: "Web chat widget not found" });
      }

      const config = safeParseChannelConfig(channel.config_json);
      if (!applyWebChatCorsHeaders(res, typeof req.headers.origin === "string" ? req.headers.origin : "", config)) {
        return res.status(403).json({ error: "Origin is not allowed for this widget" });
      }

      const eventId = await appDb.resolveEventIdForChannel("web_chat", widgetKey);
      if (!eventId) {
        return res.status(404).json({ error: "No active event mapping found for this widget" });
      }

      const priorHistory = await getMessageHistoryForSender(senderId, 12, eventId);
      await saveMessage(senderId, text, "incoming", eventId, widgetKey);

      let replyText = "";
      let ticketRegistrationIds: string[] = [];
      try {
        const result = await generateBotReplyForSender(senderId, eventId, text, priorHistory);
        replyText = result.text;
        ticketRegistrationIds = result.ticketRegistrationIds;
      } catch (error) {
        console.error("Failed to generate web chat bot reply:", error);
        replyText = "ขออภัย ระบบตอบกลับอัตโนมัติขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง";
      }

      if (replyText) {
        await saveMessage(senderId, replyText, "outgoing", eventId, widgetKey);
      }

      const settings = await getSettingsMap(eventId);
      const eventState = getEventState(settings);
      const event = await appDb.getEventById(eventId);
      const artifacts = await buildWebChatArtifacts(eventId, ticketRegistrationIds);
      return res.json({
        status: "ok",
        event_id: eventId,
        event_status: event?.effective_status || "active",
        event_lifecycle: eventState.eventLifecycle,
        registration_window_status: eventState.registrationStatus,
        widget: buildWebChatPublicConfig(widgetKey, settings, config),
        reply_text: replyText,
        tickets: artifacts.tickets,
        map_url: artifacts.map_url,
      });
    } catch (error) {
      console.error("Web chat message handler failed:", error);
      return res.status(500).json({ error: "Failed to process web chat message" });
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
