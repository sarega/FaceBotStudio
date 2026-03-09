import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
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
import { createRateLimitMiddleware, resetRateLimitCounter } from "./backend/runtime/rateLimit";
import { pingRedis } from "./backend/runtime/redis";
import { resolveStartupSecurityConfig } from "./backend/runtime/startupSecurity";
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
  CSRF_COOKIE_NAME,
  CHECKIN_ACCESS_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  createSessionToken,
  getCheckinAccessSessionTtlMs,
  getSessionTtlMs,
  hashPassword,
  hashSessionToken,
  isValidUsername,
  normalizeUsername,
  passwordHashNeedsRehash,
  parseCookies,
  serializeAdminSessionCookie,
  serializeCheckinAccessSessionCookie,
  serializeCsrfTokenCookie,
  serializeClearedCheckinAccessSessionCookie,
  serializeClearedAdminSessionCookie,
  serializeClearedCsrfTokenCookie,
  verifyPasswordWithMetadata,
  type UserRole,
} from "./backend/auth";
import {
  formatStoredDateForDisplay,
  formatStoredDateRangeForDisplay,
  getEventState,
  normalizeTimeZone,
  type RegistrationWindowState,
} from "./backend/datetime";
import {
  createAppDatabase,
  type AuthUserRow,
  type ChannelPlatform,
  type EventDocumentChunkEmbeddingRow,
  type MessageRow,
  type RegistrationInput,
  type RegistrationRow,
  type RegistrationStatus,
} from "./backend/db/index";
import { DEFAULT_EVENT_ID, EVENT_SETTING_KEYS, GLOBAL_SETTING_KEYS } from "./backend/db/defaultSettings";
import { buildEventLocationSummary, formatEventLocationCompact, resolveEventMapUrl } from "./src/lib/eventLocation";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_DEFAULT_MODEL || "google/gemini-3-flash-preview";
const startupSecurityConfig = resolveStartupSecurityConfig(process.env);
for (const warning of startupSecurityConfig.warnings) {
  console.warn(`[startup] ${warning}`);
}
const appDb = createAppDatabase();
const APP_RUNTIME = startupSecurityConfig.appRuntime;
const RUN_WEB_SERVER = startupSecurityConfig.runWebServer;
const RUN_EMBEDDED_WORKER = startupSecurityConfig.runEmbeddedWorker;
const TRUST_PROXY = startupSecurityConfig.trustProxy;
const INBOUND_BURST_WINDOW_MS = Math.max(250, Number.parseInt(process.env.INBOUND_BURST_WINDOW_MS || "1400", 10) || 1400);
const DEFAULT_FACEBOOK_INBOUND_BURST_WINDOW_MS = Math.max(INBOUND_BURST_WINDOW_MS, 2200);
const FACEBOOK_INBOUND_BURST_WINDOW_MS = Math.max(
  250,
  Number.parseInt(process.env.FACEBOOK_INBOUND_BURST_WINDOW_MS || String(DEFAULT_FACEBOOK_INBOUND_BURST_WINDOW_MS), 10)
    || DEFAULT_FACEBOOK_INBOUND_BURST_WINDOW_MS,
);
const WEBCHAT_BURST_WINDOW_MS = Math.max(0, Number.parseInt(process.env.WEBCHAT_BURST_WINDOW_MS || "350", 10) || 350);
const CONVERSATION_ROW_LIMIT = Math.max(12, Number.parseInt(process.env.CONVERSATION_ROW_LIMIT || "24", 10) || 24);
const INBOUND_RESERVATION_TTL_MS = Math.max(5000, Number.parseInt(process.env.INBOUND_RESERVATION_TTL_MS || "30000", 10) || 30000);
const FAILED_INBOUND_TURN_TTL_MS = Math.max(
  60000,
  Number.parseInt(process.env.FAILED_INBOUND_TURN_TTL_MS || String(1000 * 60 * 60 * 6), 10) || 1000 * 60 * 60 * 6,
);
const BOT_TEMPORARY_FAILURE_MESSAGE = "ขออภัย ระบบตอบกลับอัตโนมัติขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง";
const IS_PRODUCTION = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || "256kb").trim() || "256kb";
const CSRF_ALLOWED_ORIGINS_RAW = String(process.env.CSRF_ALLOWED_ORIGINS || "").trim();
const LOGIN_IP_RATE_LIMIT_NAME = "auth-login-ip";
const LOGIN_USERNAME_RATE_LIMIT_NAME = "auth-login-username";
const ALLOWED_SETTINGS_KEY_SET = new Set<string>([...EVENT_SETTING_KEYS, ...GLOBAL_SETTING_KEYS]);
const CSRF_HEADER_NAME = "x-csrf-token";

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
    provider?: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
    };
  };
};

type LlmUsageContext = {
  eventId?: string;
  actorUserId?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
};

type ToolExecutionBundle = {
  messages: ChatHistoryMessage[];
  ticketRegistrationIds: string[];
};

type AdminAgentActionName =
  | "create_event"
  | "update_event_setup"
  | "update_event_status"
  | "update_event_context"
  | "create_registration"
  | "find_event"
  | "search_system"
  | "get_event_overview"
  | "find_registration"
  | "view_ticket"
  | "list_registrations"
  | "export_registrations_csv"
  | "count_registrations"
  | "get_registration_timeline"
  | "set_registration_status"
  | "send_message_to_sender"
  | "resend_ticket"
  | "resend_email"
  | "retry_bot";

type AdminAgentPolicy = {
  readEvent: boolean;
  manageEventSetup: boolean;
  manageEventStatus: boolean;
  manageEventContext: boolean;
  readRegistration: boolean;
  manageRegistration: boolean;
  messageUser: boolean;
  searchAllEvents: boolean;
};

type AdminAgentToolCall = {
  name: AdminAgentActionName;
  args: Record<string, unknown>;
  source: "llm" | "rule";
};

type AdminAgentPlannerResult = {
  toolCall: AdminAgentToolCall | null;
  assistantText: string;
  meta?: {
    model?: string;
    provider?: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
    };
  };
};

type ManualOutboundTarget = {
  platform: ChannelPlatform;
  eventId: string;
  senderId: string;
  externalId: string;
};

type PendingConversationTurn = {
  inputText: string;
  history: ChatHistoryMessage[];
  highestPendingMessageId: number;
  pendingMessageCount: number;
  latestVisibleOutgoingText: string;
};

type PreparedConversationTurn = PendingConversationTurn & {
  conversationKey: string;
};

type BotReplyResult = {
  text: string;
  ticketRegistrationIds: string[];
};

type FailedInboundTurn = {
  inputText: string;
  history: ChatHistoryMessage[];
  recordedAt: number;
  reason?: string;
};

type AuthContext = {
  sessionId: string;
  tokenHash: string;
  user: AuthUserRow;
};

type CheckinAccessContext = {
  sessionId: string;
  checkinSessionId: string;
  tokenHash: string;
  eventId: string;
  label: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

type EventScopeSource = "query" | "body" | "params" | "default" | "checkin_access";

type EventScopeContext = {
  eventId: string;
  source: EventScopeSource;
};

type ValidationIssue = {
  field: string;
  message: string;
};

type EventScopeOptions = {
  queryKey?: string | null;
  bodyKey?: string | null;
  paramKey?: string | null;
  allowDefault?: boolean;
  allowCheckinAccess?: boolean;
};

type AuthenticatedRequest = Request & {
  auth?: AuthContext;
  checkinAccess?: CheckinAccessContext;
  eventScope?: EventScopeContext;
};

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

const inboundConversationTails = new Map<string, Promise<void>>();
const inboundHandledMessageIds = new Map<string, number>();
const inboundConversationActivity = new Map<string, number>();
const inboundReservedMessageIds = new Map<string, { messageId: number; expiresAt: number }>();
const failedInboundTurns = new Map<string, FailedInboundTurn>();
const ADMIN_AGENT_SHARED_HISTORY_MAX_MESSAGES = 120;
let adminAgentSharedHistory: ChatHistoryMessage[] = [];

function parseRegistrationLimit(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

type EventCapacitySnapshot = {
  activeCount: number;
  cancelledCount: number;
  limit: number | null;
  remainingCount: number | null;
  isFull: boolean;
  capacityStatus: "available" | "full" | "unlimited";
  registrationAvailability: RegistrationWindowState | "full";
};

async function getEventCapacitySnapshot(eventId: string, settings: Record<string, any>): Promise<EventCapacitySnapshot> {
  const registrations = await appDb.listRegistrations(undefined, eventId);
  const activeCount = registrations.filter((registration) => registration.status !== "cancelled").length;
  const cancelledCount = registrations.length - activeCount;
  const limit = parseRegistrationLimit(settings.reg_limit);
  const remainingCount = limit === null ? null : Math.max(limit - activeCount, 0);
  const isFull = limit !== null && activeCount >= limit;
  const eventState = getEventState(settings);

  return {
    activeCount,
    cancelledCount,
    limit,
    remainingCount,
    isFull,
    capacityStatus: limit === null ? "unlimited" : isFull ? "full" : "available",
    registrationAvailability: eventState.registrationStatus === "open" && isFull
      ? "full"
      : eventState.registrationStatus,
  };
}

function buildEventInfo(
  settings: Record<string, any>,
  eventStatus = "active",
  capacitySnapshot?: EventCapacitySnapshot | null,
) {
  const eventState = getEventState(settings);
  const locationSummary = buildEventLocationSummaryFromSettings(settings);
  const locationLabel = formatEventLocationFromSettings(settings);
  const mapUrl = resolveEventMapUrlFromSettings(settings);
  return `
Current Event Details:
- Name: ${settings.event_name || ""}
- Venue: ${locationSummary.venueName || ""}
- Room/Floor/Hall: ${locationSummary.roomDetail || ""}
- Location: ${locationLabel}
- Map: ${mapUrl}
- Event Status Right Now: ${eventStatus}
- Time Zone: ${eventState.timeZone}
- Current System Time: ${eventState.nowLabel}
- Event Window: ${formatStoredDateRangeForDisplay(settings.event_date || "", settings.event_end_date || "", eventState.timeZone)}
- Description: ${settings.event_description || ""}
- Travel: ${settings.event_travel || ""}
- Registration Limit: ${settings.reg_limit || ""}
- Duplicate Name Guard Right Now: ${isTruthySetting(settings.reg_unique_name ?? "1") ? "enabled" : "disabled"}
- Active Registrations Right Now: ${capacitySnapshot?.activeCount ?? 0}
- Cancelled Registrations Right Now: ${capacitySnapshot?.cancelledCount ?? 0}
- Remaining Seats Right Now: ${capacitySnapshot?.remainingCount == null ? "unlimited" : capacitySnapshot.remainingCount}
- Registration Capacity Status Right Now: ${capacitySnapshot?.capacityStatus || "available"}
- Registration Period: ${eventState.startLabel} to ${eventState.endLabel}
- Registration Status Right Now: ${eventState.registrationStatus}
- Registration Availability Right Now: ${capacitySnapshot?.registrationAvailability || eventState.registrationStatus}
- Event Lifecycle Right Now: ${eventState.eventLifecycle}
`;
}

function getSystemInstruction(
  settings: Record<string, any>,
  eventStatus = "active",
  knowledgeContext = "",
  capacitySnapshot?: EventCapacitySnapshot | null,
) {
  const globalPrompt = String(settings.global_system_prompt || "").trim();
  const eventContext = String(settings.context || "").trim();
  return [
    globalPrompt,
    eventContext ? `Event Context:\n${eventContext}` : "",
    knowledgeContext,
    buildEventInfo(settings, eventStatus, capacitySnapshot),
    "Never guess the current date or time. Use the Current System Time above as the source of truth.",
    "Respect the Event Status Right Now field.",
    "If event status is pending, explain that the event is still being prepared and registration has not launched yet.",
    "If event status is inactive, explain that the event is currently inactive and registration is temporarily unavailable.",
    "If event status is cancelled, clearly explain that the event has been cancelled.",
    "If event status is closed, clearly explain that the event has already ended.",
    "Respect the Duplicate Name Guard Right Now field. If it is enabled, do not imply the same first+last name can register multiple times in the same event.",
    "Respect the Registration Status Right Now field. If it is invalid, explain that the registration schedule is misconfigured. If it is not_started or closed, clearly tell the user registration is unavailable and do not imply it is open.",
    "Respect the Registration Availability Right Now field. If it is full, clearly explain that registration is currently unavailable because capacity is full.",
    "Do not volunteer exact remaining seat counts unless the user asks, but never imply registration is still open when capacity is full.",
    "If the event lifecycle is past, explain that the event has already ended.",
    "Read the recent conversation history before replying and continue naturally from the current chat.",
    "Only greet on the first assistant reply of a conversation or after a long idle gap. Do not greet on every reply.",
    "If the user sent several back-to-back messages before your turn, answer them in one natural reply without restarting from the beginning.",
    "Do not repeat the same event benefits, registration call-to-action, or required registration fields if they were already stated in recent history.",
    "When several user questions are pending, answer them concisely and avoid repeating information that was already answered.",
    "For short follow-up questions such as cost, date, location, dress code, or eligibility, answer the follow-up directly before adding any optional next step.",
    "If registration steps were already explained in recent history, do not restate the full steps unless the user explicitly asks for them again.",
    "Do not add another greeting when replying to a follow-up in the same active exchange.",
    "Keep follow-up replies brief and specific. Do not restart the conversation summary unless the user asks for a recap.",
    "Ask for registration details only after the user clearly wants to register or explicitly confirms they want to continue.",
    "Summarize registration details exactly once, immediately before calling the registerUser tool.",
    "When you have collected the user's first name, last name, and phone number (and optionally email), use the registerUser tool to complete the registration.",
    "Politely ask for any missing information one by one.",
    "If registration fails (e.g. limit reached or period closed), explain why to the user.",
    "If registration is rejected because the same first+last name already exists, explain that this event blocks duplicate full names and ask for a different attendee name.",
    "If a user wants to cancel, use the cancelRegistration tool with their ID.",
  ].join("\n\n");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildInboundConversationKey(channel: string, senderId: string, eventId: string) {
  return `${channel}:${eventId}:${senderId}`;
}

function getInboundConversationChannelFromPlatform(platform: ChannelPlatform) {
  switch (platform) {
    case "line_oa":
      return "line";
    case "web_chat":
      return "webchat";
    default:
      return platform;
  }
}

function rememberFailedInboundTurn(conversationKey: string, turn: { inputText: string; history: ChatHistoryMessage[] }, reason?: string) {
  const inputText = String(turn.inputText || "").trim();
  if (!inputText) return;

  const now = Date.now();
  failedInboundTurns.set(conversationKey, {
    inputText,
    history: Array.isArray(turn.history) ? turn.history : [],
    recordedAt: now,
    reason: String(reason || "").slice(0, 500) || undefined,
  });

  if (failedInboundTurns.size > 4000) {
    for (const [key, value] of failedInboundTurns.entries()) {
      if (now - value.recordedAt > FAILED_INBOUND_TURN_TTL_MS) {
        failedInboundTurns.delete(key);
      }
    }
    if (failedInboundTurns.size > 4000) {
      const keys = [...failedInboundTurns.keys()].slice(0, 500);
      for (const key of keys) {
        failedInboundTurns.delete(key);
      }
    }
  }
}

function clearFailedInboundTurn(conversationKey: string) {
  failedInboundTurns.delete(conversationKey);
}

function getFailedInboundTurn(conversationKey: string, now = Date.now()) {
  const cached = failedInboundTurns.get(conversationKey);
  if (!cached) return null;
  if (now - cached.recordedAt > FAILED_INBOUND_TURN_TTL_MS) {
    failedInboundTurns.delete(conversationKey);
    return null;
  }
  return cached;
}

function markInboundConversationActivity(conversationKey: string, activityAt = Date.now()) {
  inboundConversationActivity.set(conversationKey, activityAt);
  if (inboundConversationActivity.size > 4000) {
    const keys = [...inboundConversationActivity.keys()].slice(0, 500);
    for (const key of keys) {
      inboundConversationActivity.delete(key);
    }
  }
}

function getRemainingQuietWindowMs(conversationKey: string, burstWindowMs: number, now = Date.now()) {
  if (burstWindowMs <= 0) return 0;
  const lastActivityAt = inboundConversationActivity.get(conversationKey);
  if (!lastActivityAt) return 0;
  return Math.max(0, burstWindowMs - (now - lastActivityAt));
}

function normalizeReplyComparisonText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateReply(candidate: string, previous: string) {
  const left = normalizeReplyComparisonText(candidate);
  const right = normalizeReplyComparisonText(previous);
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 48 && longer.includes(shorter) && shorter.length / longer.length >= 0.82) {
    return true;
  }

  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 1));
  if (!leftTokens.size || !rightTokens.size) return false;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.88;
}

function buildChatHistoryFromRows(rows: MessageRow[]) {
  return [...rows]
    .map((row): { role: ChatHistoryMessage["role"]; text: string; id: number } => ({
      role: row.type === "incoming" ? "user" : "model",
      text: normalizeMessageTextForHistory(row.text || ""),
      id: row.id,
    }))
    .filter((row) => row.text)
    .sort((left, right) => left.id - right.id)
    .map((row) => ({
      role: row.role,
      parts: [{ text: row.text }],
    }) satisfies ChatHistoryMessage);
}

function getReservedPendingMessageId(conversationKey: string, now = Date.now()) {
  const reservation = inboundReservedMessageIds.get(conversationKey);
  if (!reservation) return 0;
  if (reservation.expiresAt <= now) {
    inboundReservedMessageIds.delete(conversationKey);
    return 0;
  }
  return reservation.messageId;
}

function reservePendingConversation(conversationKey: string, highestPendingMessageId: number, now = Date.now()) {
  if (!Number.isFinite(highestPendingMessageId) || highestPendingMessageId <= 0) return;
  const previousReserved = getReservedPendingMessageId(conversationKey, now);
  inboundReservedMessageIds.set(conversationKey, {
    messageId: Math.max(previousReserved, highestPendingMessageId),
    expiresAt: now + INBOUND_RESERVATION_TTL_MS,
  });
  if (inboundReservedMessageIds.size > 4000) {
    for (const [key, reservation] of inboundReservedMessageIds.entries()) {
      if (reservation.expiresAt <= now) {
        inboundReservedMessageIds.delete(key);
      }
    }
    if (inboundReservedMessageIds.size > 4000) {
      const keys = [...inboundReservedMessageIds.keys()].slice(0, 500);
      for (const key of keys) {
        inboundReservedMessageIds.delete(key);
      }
    }
  }
}

function clearPendingConversationReservation(conversationKey: string, highestPendingMessageId?: number) {
  const reservation = inboundReservedMessageIds.get(conversationKey);
  if (!reservation) return;
  if (typeof highestPendingMessageId === "number" && highestPendingMessageId > 0 && reservation.messageId > highestPendingMessageId) {
    return;
  }
  inboundReservedMessageIds.delete(conversationKey);
}

function getPendingBoundaryMessageId(conversationKey: string, rows: MessageRow[]) {
  const handledMessageId = inboundHandledMessageIds.get(conversationKey);
  const reservedMessageId = getReservedPendingMessageId(conversationKey);
  if (typeof handledMessageId === "number" || reservedMessageId > 0) {
    return Math.max(handledMessageId || 0, reservedMessageId);
  }

  return rows.find((row) => row.type === "outgoing")?.id || 0;
}

async function buildPendingConversationTurn(
  conversationKey: string,
  senderId: string,
  eventId: string,
): Promise<PendingConversationTurn | null> {
  const rows = await appDb.getConversationRowsForSender(senderId, CONVERSATION_ROW_LIMIT, eventId);
  if (!rows.length) return null;

  const boundaryMessageId = getPendingBoundaryMessageId(conversationKey, rows);
  const pendingRows = rows
    .filter((row) => row.type === "incoming" && row.id > boundaryMessageId)
    .sort((left, right) => left.id - right.id);
  if (!pendingRows.length) return null;

  const distinctPendingRows = pendingRows.filter((row, index, list) => {
    const text = String(row.text || "").trim();
    if (!text) return false;
    if (index === 0) return true;
    const previousText = String(list[index - 1]?.text || "").trim();
    return normalizeReplyComparisonText(text) !== normalizeReplyComparisonText(previousText);
  });
  if (!distinctPendingRows.length) return null;

  const latestPendingRow = distinctPendingRows[distinctPendingRows.length - 1];
  const priorPendingRowIds = new Set(
    distinctPendingRows.slice(0, -1).map((row) => row.id),
  );
  const historyRows = rows.filter((row) => {
    if (row.id <= boundaryMessageId) return true;
    return row.type === "incoming" && priorPendingRowIds.has(row.id);
  });
  const latestVisibleOutgoingRow = historyRows.find(
    (row) => row.type === "outgoing" && normalizeMessageTextForHistory(row.text || ""),
  );
  const latestVisibleOutgoingText = latestVisibleOutgoingRow
    ? normalizeMessageTextForHistory(latestVisibleOutgoingRow.text || "")
    : "";

  return {
    inputText: String(latestPendingRow?.text || "").trim(),
    history: buildChatHistoryFromRows(historyRows),
    highestPendingMessageId: latestPendingRow?.id || 0,
    pendingMessageCount: distinctPendingRows.length,
    latestVisibleOutgoingText,
  };
}

async function runSerializedInboundTask<T>(conversationKey: string, task: () => Promise<T>) {
  const previous = inboundConversationTails.get(conversationKey) || Promise.resolve();
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const currentTail = previous.catch(() => undefined).then(() => gate);
  inboundConversationTails.set(conversationKey, currentTail);
  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release?.();
    if (inboundConversationTails.get(conversationKey) === currentTail) {
      inboundConversationTails.delete(conversationKey);
    }
  }
}

function markPendingConversationHandled(conversationKey: string, highestPendingMessageId: number) {
  if (!Number.isFinite(highestPendingMessageId) || highestPendingMessageId <= 0) return;
  const previous = inboundHandledMessageIds.get(conversationKey) || 0;
  if (highestPendingMessageId > previous) {
    inboundHandledMessageIds.set(conversationKey, highestPendingMessageId);
  }
  clearPendingConversationReservation(conversationKey, highestPendingMessageId);
  if (inboundHandledMessageIds.size > 4000) {
    const keys = [...inboundHandledMessageIds.keys()].slice(0, 500);
    for (const key of keys) {
      inboundHandledMessageIds.delete(key);
    }
  }
}

async function prepareBundledConversationTurnForSender(
  channel: string,
  senderId: string,
  eventId: string,
  options?: { burstWindowMs?: number; alreadySerialized?: boolean },
): Promise<PreparedConversationTurn | null> {
  const conversationKey = buildInboundConversationKey(channel, senderId, eventId);
  const burstWindowMs = Math.max(0, options?.burstWindowMs ?? INBOUND_BURST_WINDOW_MS);

  const prepareTurn = async () => {
    if (burstWindowMs > 0) {
      await sleep(burstWindowMs);
    }

    while (true) {
      const remainingQuietMs = getRemainingQuietWindowMs(conversationKey, burstWindowMs);
      if (remainingQuietMs > 0) {
        await sleep(remainingQuietMs);
      }

      const pendingTurn = await buildPendingConversationTurn(conversationKey, senderId, eventId);
      if (!pendingTurn) return null;

      const remainingAfterReadMs = getRemainingQuietWindowMs(conversationKey, burstWindowMs);
      if (remainingAfterReadMs > 0) {
        continue;
      }

      reservePendingConversation(conversationKey, pendingTurn.highestPendingMessageId);
      return {
        ...pendingTurn,
        conversationKey,
      };
    }
  };

  if (options?.alreadySerialized) {
    return prepareTurn();
  }

  return runSerializedInboundTask(conversationKey, prepareTurn);
}

async function generateReplyForPreparedTurn(
  senderId: string,
  eventId: string,
  preparedTurn: PreparedConversationTurn,
): Promise<BotReplyResult> {
  const result = await generateBotReplyForSender(senderId, eventId, preparedTurn.inputText, preparedTurn.history);
  const shouldSuppressDuplicate =
    preparedTurn.pendingMessageCount > 1 &&
    isNearDuplicateReply(result.text, preparedTurn.latestVisibleOutgoingText);

  return {
    ...result,
    text: shouldSuppressDuplicate ? "" : result.text,
  };
}

async function buildLatestIncomingRetryTurn(senderId: string, eventId: string) {
  const rows = await appDb.getConversationRowsForSender(senderId, CONVERSATION_ROW_LIMIT, eventId);
  if (!rows.length) return null;

  const latestIncomingRow = rows.find(
    (row) => row.type === "incoming" && normalizeMessageTextForHistory(row.text || ""),
  );
  if (!latestIncomingRow) return null;

  const inputText = normalizeMessageTextForHistory(latestIncomingRow.text || "");
  if (!inputText) return null;

  const historyRows = rows.filter((row) => row.id < latestIncomingRow.id);
  return {
    inputText,
    history: buildChatHistoryFromRows(historyRows),
    source: "latest-incoming",
  } as const;
}

async function buildRetryTurnForConversation(conversationKey: string, senderId: string, eventId: string) {
  const failedTurn = getFailedInboundTurn(conversationKey);
  if (failedTurn) {
    return {
      inputText: failedTurn.inputText,
      history: failedTurn.history,
      source: "failed-turn",
      reason: failedTurn.reason || null,
    } as const;
  }

  const latestIncomingTurn = await buildLatestIncomingRetryTurn(senderId, eventId);
  if (!latestIncomingTurn) return null;
  return {
    ...latestIncomingTurn,
    reason: null,
  } as const;
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

function splitIntoBatches<T>(items: T[], size: number) {
  const normalizedSize = Math.max(1, size);
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += normalizedSize) {
    batches.push(items.slice(index, index + normalizedSize));
  }
  return batches;
}

async function requestOpenRouterEmbeddings(
  inputs: string[],
  usageContext?: LlmUsageContext,
) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured in .env");
  }

  const normalizedInputs = inputs
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!normalizedInputs.length) return [] as number[][];

  const model = getEmbeddingModelName();
  const vectors: number[][] = [];

  for (const batch of splitIntoBatches(normalizedInputs, 32)) {
    const upstream = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify({
        model,
        input: batch,
        encoding_format: "float",
      }),
    });

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      throw new Error(payload?.error?.message || "OpenRouter embeddings request failed");
    }

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const batchVectors = rows
      .slice()
      .sort((a: any, b: any) => Number(a?.index || 0) - Number(b?.index || 0))
      .map((row: any) => Array.isArray(row?.embedding)
        ? row.embedding.map((entry: unknown) => Number(entry)).filter((entry: number) => Number.isFinite(entry))
        : []);

    if (batchVectors.length !== batch.length || batchVectors.some((vector) => vector.length === 0)) {
      throw new Error("OpenRouter embeddings response was incomplete");
    }

    vectors.push(...batchVectors);

    if (usageContext) {
      try {
        const usage = normalizeOpenRouterUsage(payload);
        await appDb.recordLlmUsage({
          event_id: usageContext.eventId || null,
          actor_user_id: usageContext.actorUserId || null,
          source: usageContext.source,
          provider: "openrouter",
          model: String(payload?.model || model),
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: 0,
          total_tokens: usage.total_tokens || usage.prompt_tokens,
          estimated_cost_usd: usage.estimated_cost_usd,
          metadata: {
            ...usageContext.metadata,
            embedding_inputs: batch.length,
          },
        });
      } catch (error) {
        console.error("Failed to record embedding usage:", error);
      }
    }
  }

  return vectors;
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

const ADMIN_AGENT_ACTION_SET = new Set<AdminAgentActionName>([
  "create_event",
  "update_event_setup",
  "update_event_status",
  "update_event_context",
  "create_registration",
  "find_event",
  "search_system",
  "get_event_overview",
  "find_registration",
  "view_ticket",
  "list_registrations",
  "export_registrations_csv",
  "count_registrations",
  "get_registration_timeline",
  "set_registration_status",
  "send_message_to_sender",
  "resend_ticket",
  "resend_email",
  "retry_bot",
]);

const ADMIN_AGENT_ACTION_POLICY_LABEL: Record<AdminAgentActionName, string> = {
  create_event: "create event",
  update_event_setup: "update event setup",
  update_event_status: "update event status",
  update_event_context: "update event context",
  create_registration: "create registration",
  find_event: "find event",
  search_system: "search system",
  get_event_overview: "event overview",
  find_registration: "find registration",
  view_ticket: "view ticket",
  list_registrations: "list registrations",
  export_registrations_csv: "export registrations csv",
  count_registrations: "count registrations",
  get_registration_timeline: "registration timeline",
  set_registration_status: "set registration status",
  send_message_to_sender: "send message",
  resend_ticket: "resend ticket",
  resend_email: "resend email",
  retry_bot: "retry bot",
};

function parseAdminAgentPolicy(settings: Record<string, any>): AdminAgentPolicy {
  return {
    readEvent: isTruthySetting(settings.admin_agent_policy_read_event ?? "1"),
    manageEventSetup: isTruthySetting(settings.admin_agent_policy_manage_event_setup ?? "0"),
    manageEventStatus: isTruthySetting(settings.admin_agent_policy_manage_event_status ?? "0"),
    manageEventContext: isTruthySetting(settings.admin_agent_policy_manage_event_context ?? "0"),
    readRegistration: isTruthySetting(settings.admin_agent_policy_read_registration ?? "1"),
    manageRegistration: isTruthySetting(settings.admin_agent_policy_manage_registration ?? "1"),
    messageUser: isTruthySetting(settings.admin_agent_policy_message_user ?? "1"),
    searchAllEvents: isTruthySetting(settings.admin_agent_policy_search_all_events ?? "1"),
  };
}

function getAllowedAdminAgentActions(policy: AdminAgentPolicy): AdminAgentActionName[] {
  const allowed = new Set<AdminAgentActionName>();
  if (policy.readEvent) {
    allowed.add("find_event");
    allowed.add("get_event_overview");
  }
  if (policy.searchAllEvents && (policy.readEvent || policy.readRegistration)) {
    allowed.add("search_system");
  }
  if (policy.manageEventSetup) {
    allowed.add("create_event");
    allowed.add("update_event_setup");
  }
  if (policy.manageEventStatus) {
    allowed.add("update_event_status");
  }
  if (policy.manageEventContext) {
    allowed.add("update_event_context");
  }
  if (policy.readRegistration) {
    allowed.add("find_registration");
    allowed.add("view_ticket");
    allowed.add("list_registrations");
    allowed.add("export_registrations_csv");
    allowed.add("count_registrations");
    allowed.add("get_registration_timeline");
  }
  if (policy.manageRegistration) {
    allowed.add("create_registration");
    allowed.add("set_registration_status");
    allowed.add("resend_ticket");
    allowed.add("resend_email");
  }
  if (policy.messageUser) {
    allowed.add("send_message_to_sender");
    allowed.add("retry_bot");
  }
  return [...allowed].filter((name) => ADMIN_AGENT_ACTION_SET.has(name));
}

function ensureAdminActionAllowed(actionName: AdminAgentActionName, allowedActions: Set<AdminAgentActionName>) {
  if (allowedActions.has(actionName)) return;
  const label = ADMIN_AGENT_ACTION_POLICY_LABEL[actionName] || actionName;
  throw new Error(`Action "${label}" is disabled by Agent policy. Enable it in Agent > Advanced Policy.`);
}

function normalizeComparableText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || "";
}

function buildEventLocationSummaryFromSettings(settings: Record<string, unknown>) {
  return buildEventLocationSummary({
    event_venue_name: normalizeOptionalText(settings.event_venue_name),
    event_room_detail: normalizeOptionalText(settings.event_room_detail),
    event_location: normalizeOptionalText(settings.event_location),
    event_travel: normalizeOptionalText(settings.event_travel),
  });
}

function formatEventLocationFromSettings(settings: Record<string, unknown>, fallback = "-") {
  return formatEventLocationCompact({
    event_venue_name: normalizeOptionalText(settings.event_venue_name),
    event_room_detail: normalizeOptionalText(settings.event_room_detail),
    event_location: normalizeOptionalText(settings.event_location),
  }, fallback);
}

function resolveEventMapUrlFromSettings(settings: Record<string, unknown>) {
  return resolveEventMapUrl({
    event_venue_name: normalizeOptionalText(settings.event_venue_name),
    event_room_detail: normalizeOptionalText(settings.event_room_detail),
    event_location: normalizeOptionalText(settings.event_location),
    event_map_url: normalizeOptionalText(settings.event_map_url),
  });
}

function normalizeAdminAgentHistory(history: ChatHistoryMessage[] = []) {
  const normalized: ChatHistoryMessage[] = [];

  for (const item of history) {
    const role = item?.role === "user" ? "user" : "model";
    const parts = Array.isArray(item?.parts) ? item.parts : [];
    const text = parts
      .map((part) => (typeof part?.text === "string" ? normalizeOptionalText(part.text) : ""))
      .filter(Boolean)
      .join("\n");
    if (!text) continue;
    normalized.push({
      role,
      parts: [{ text: truncateText(text, 1800) }],
    });
  }

  return normalized.slice(-ADMIN_AGENT_SHARED_HISTORY_MAX_MESSAGES);
}

function mergeAdminAgentSharedHistory(incomingHistory: ChatHistoryMessage[] = []) {
  const incoming = normalizeAdminAgentHistory(incomingHistory);
  if (incoming.length === 0) return;
  if (incoming.length > adminAgentSharedHistory.length) {
    adminAgentSharedHistory = incoming.slice(-ADMIN_AGENT_SHARED_HISTORY_MAX_MESSAGES);
  }
}

function getAdminAgentPlannerHistory() {
  return normalizeAdminAgentHistory(adminAgentSharedHistory);
}

function appendAdminAgentSharedHistory(role: "user" | "model", text: string) {
  const normalizedText = normalizeOptionalText(text);
  if (!normalizedText) return;

  const candidate: ChatHistoryMessage = {
    role,
    parts: [{ text: truncateText(normalizedText, 1800) }],
  };
  const last = adminAgentSharedHistory[adminAgentSharedHistory.length - 1];
  const lastText = last?.parts?.map((part) => (typeof part?.text === "string" ? normalizeOptionalText(part.text) : "")).filter(Boolean).join("\n") || "";
  if (last && last.role === candidate.role && lastText === candidate.parts[0]?.text) {
    return;
  }

  adminAgentSharedHistory = [
    ...adminAgentSharedHistory,
    candidate,
  ].slice(-ADMIN_AGENT_SHARED_HISTORY_MAX_MESSAGES);
}

function normalizeRegistrationId(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^REG-[A-Z0-9]+$/.test(normalized) ? normalized : "";
}

function extractRegistrationId(value: unknown) {
  const match = String(value ?? "").toUpperCase().match(/\bREG-[A-Z0-9]{4,}\b/);
  return match ? match[0] : "";
}

function normalizeRegistrationStatusInput(value: unknown): RegistrationStatus | null {
  const normalized = normalizeComparableText(value);
  if (normalized === "registered" || normalized === "cancelled" || normalized === "checked-in") {
    return normalized;
  }
  return null;
}

function parsePositiveInteger(value: unknown, fallbackValue: number, maxValue: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return Math.min(parsed, maxValue);
}

function parseNonNegativeInteger(value: unknown, fallbackValue: number, maxValue: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackValue;
  return Math.min(parsed, maxValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readObjectBody(req: Request) {
  return isRecord(req.body) ? req.body : {} as Record<string, unknown>;
}

function trimStringInput(value: unknown, maxLength = 4096) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function readRequiredString(
  source: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
  options?: {
    label?: string;
    maxLength?: number;
    minLength?: number;
    pattern?: RegExp;
    patternMessage?: string;
  },
) {
  const label = options?.label || field;
  const maxLength = options?.maxLength ?? 4096;
  const minLength = options?.minLength ?? 1;
  const value = trimStringInput(source[field], maxLength);

  if (value.length < minLength) {
    issues.push({ field, message: `${label} is required` });
    return "";
  }
  if (options?.pattern && !options.pattern.test(value)) {
    issues.push({ field, message: options.patternMessage || `${label} is invalid` });
    return "";
  }
  return value;
}

function readOptionalString(source: Record<string, unknown>, field: string, maxLength = 4096) {
  if (source[field] == null) return "";
  return trimStringInput(source[field], maxLength);
}

function isLikelyEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function readBooleanWithDefault(source: Record<string, unknown>, field: string, fallbackValue: boolean, issues: ValidationIssue[]) {
  const raw = source[field];
  if (raw == null) return fallbackValue;
  if (typeof raw === "boolean") return raw;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  issues.push({ field, message: `${field} must be a boolean` });
  return fallbackValue;
}

function readIntegerInRange(
  source: Record<string, unknown>,
  field: string,
  minValue: number,
  maxValue: number,
  issues: ValidationIssue[],
  options?: { fallbackValue?: number; label?: string },
) {
  const label = options?.label || field;
  const fallbackValue = typeof options?.fallbackValue === "number" ? options.fallbackValue : minValue;
  const raw = source[field];
  if (raw == null || String(raw).trim() === "") {
    return fallbackValue;
  }

  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < minValue || parsed > maxValue) {
    issues.push({ field, message: `${label} must be between ${minValue} and ${maxValue}` });
    return fallbackValue;
  }
  return parsed;
}

function readEnumValue<T extends readonly string[]>(
  source: Record<string, unknown>,
  field: string,
  allowedValues: T,
  issues: ValidationIssue[],
  options?: { required?: boolean; label?: string },
) {
  const raw = trimStringInput(source[field], 128);
  const label = options?.label || field;
  if (!raw) {
    if (options?.required) {
      issues.push({ field, message: `${label} is required` });
    }
    return "";
  }
  if (!allowedValues.includes(raw as T[number])) {
    issues.push({ field, message: `${label} is invalid` });
    return "";
  }
  return raw as T[number];
}

function respondValidationError(res: Response, issues: ValidationIssue[], statusCode = 400) {
  const filteredIssues = issues.filter((issue) => Boolean(issue.field) && Boolean(issue.message));
  const fallback = filteredIssues.length > 0 ? filteredIssues[0]?.message : "Request validation failed";
  return res.status(statusCode).json({
    error: fallback || "Request validation failed",
    validation_errors: filteredIssues,
  });
}

function formatRegistrationDisplayName(registration: RegistrationRow) {
  const fullName = `${registration.first_name || ""} ${registration.last_name || ""}`.trim();
  return fullName || registration.id;
}

function serializeAdminRegistration(registration: RegistrationRow) {
  return {
    id: registration.id,
    sender_id: registration.sender_id,
    first_name: registration.first_name,
    last_name: registration.last_name,
    full_name: formatRegistrationDisplayName(registration),
    phone: registration.phone || "",
    email: registration.email || "",
    status: registration.status,
    timestamp: registration.timestamp,
  };
}

function normalizeChannelPlatformArg(value: unknown): ChannelPlatform | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  return ALLOWED_CHANNEL_PLATFORMS.includes(raw as ChannelPlatform) ? (raw as ChannelPlatform) : null;
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
  const raw = typeof req.ip === "string" && req.ip.trim()
    ? req.ip.trim()
    : String(req.socket.remoteAddress || "").trim();

  if (!raw) return "";
  if (raw.startsWith("::ffff:")) {
    return raw.slice("::ffff:".length);
  }
  return raw;
}

function sanitizeRateLimitKeyPart(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "unknown";
  return normalized.slice(0, 160);
}

function buildRateLimitKey(...parts: unknown[]) {
  return parts.map((part) => sanitizeRateLimitKeyPart(part)).join(":");
}

function getAuthenticatedUserId(req: Request) {
  return (req as AuthenticatedRequest).auth?.user?.id || "";
}

function getRequesterRateLimitScope(req: Request) {
  return buildRateLimitKey(getRequestIp(req) || "unknown", getAuthenticatedUserId(req) || "anonymous");
}

function getLoginUsernameFromRequest(req: Request) {
  const body = readObjectBody(req);
  return normalizeUsername(body.username) || "unknown";
}

function getLoginIpRateLimitScope(req: Request) {
  return buildRateLimitKey(getRequestIp(req) || "unknown");
}

function getLoginUsernameRateLimitScope(req: Request) {
  return buildRateLimitKey(getLoginUsernameFromRequest(req));
}

function getRateLimitTokenHash(rawToken: unknown) {
  const normalized = String(rawToken ?? "").trim();
  if (!normalized) return "missing";
  return hashSessionToken(normalized.slice(0, 2048));
}

function getCheckinExchangeTokenHashFromRequest(req: Request) {
  const bodyToken = (req as Request & { body?: Record<string, unknown> }).body?.token;
  return getRateLimitTokenHash(bodyToken);
}

function getCheckinAccessRateLimitScope(req: Request) {
  const authReq = req as AuthenticatedRequest;
  const bodyToken = (req as Request & { body?: Record<string, unknown> }).body?.token;
  const fallbackTokenHash = getRateLimitTokenHash(bodyToken);
  return buildRateLimitKey(getRequestIp(req) || "unknown", authReq.checkinAccess?.sessionId || fallbackTokenHash);
}

function normalizeSettingsMutationPayload(source: Record<string, unknown>) {
  const issues: ValidationIssue[] = [];
  const entries: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(source)) {
    if (key === "event_id") continue;
    if (!ALLOWED_SETTINGS_KEY_SET.has(key)) {
      issues.push({ field: key, message: `${key} is not an allowed setting key` });
      continue;
    }

    const valueType = typeof rawValue;
    if (rawValue != null && valueType !== "string" && valueType !== "number" && valueType !== "boolean") {
      issues.push({ field: key, message: `${key} must be a string, number, boolean, or null` });
      continue;
    }

    const normalizedValue = String(rawValue ?? "");
    if (normalizedValue.length > 200000) {
      issues.push({ field: key, message: `${key} exceeds the maximum allowed length` });
      continue;
    }

    entries[key] = normalizedValue;
  }

  return { entries, issues };
}

function normalizeOrigin(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || raw === "null") return "";
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return "";
  }
}

function resolveTrustedCsrfOrigins() {
  const origins = new Set<string>();
  const appUrlOrigin = normalizeOrigin(process.env.APP_URL || "");
  if (appUrlOrigin) {
    origins.add(appUrlOrigin);
  }

  for (const segment of CSRF_ALLOWED_ORIGINS_RAW.split(",")) {
    const origin = normalizeOrigin(segment);
    if (origin) {
      origins.add(origin);
    }
  }

  if (!IS_PRODUCTION) {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }

  return origins;
}

const TRUSTED_CSRF_ORIGINS = resolveTrustedCsrfOrigins();
const UNSAFE_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EVENT_SCOPED_USER_ROLES: UserRole[] = ["owner", "admin", "operator", "checker", "viewer"];

function getOriginFromHeaders(req: Request) {
  const originHeader = req.headers.origin;
  if (typeof originHeader === "string" && originHeader.trim()) {
    return normalizeOrigin(originHeader);
  }

  const refererHeader = req.headers.referer;
  if (typeof refererHeader === "string" && refererHeader.trim()) {
    return normalizeOrigin(refererHeader);
  }

  return "";
}

function getRequestHostOrigin(req: Request) {
  const hostHeader = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  const protoHeader = String(req.headers["x-forwarded-proto"] || req.protocol || (req.secure ? "https" : "http"))
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (!hostHeader || !protoHeader) return "";
  return normalizeOrigin(`${protoHeader}://${hostHeader}`);
}

function hasSessionCookieContext(req: Request) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.has(SESSION_COOKIE_NAME) || cookies.has(CHECKIN_ACCESS_COOKIE_NAME);
}

function hasAdminSessionCookie(req: Request) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.has(SESSION_COOKIE_NAME);
}

function isCsrfCandidateRequest(req: Request) {
  if (!UNSAFE_HTTP_METHODS.has(String(req.method || "").toUpperCase())) return false;
  if (!String(req.path || "").startsWith("/api/")) return false;
  if (String(req.path || "").startsWith("/api/webhook")) return false;
  if (String(req.path || "").startsWith("/api/admin-agent/telegram/webhook")) return false;
  if (String(req.path || "").startsWith("/api/webchat")) return false;
  return hasSessionCookieContext(req);
}

function isCsrfTokenRequiredRequest(req: Request) {
  if (!isCsrfCandidateRequest(req)) return false;
  const requestPath = String(req.path || "");
  if (requestPath.startsWith("/api/auth/login")) return false;
  if (requestPath.startsWith("/api/checkin-access")) return false;
  return hasAdminSessionCookie(req);
}

function readCsrfTokenHeader(req: Request) {
  const rawHeader = req.headers[CSRF_HEADER_NAME];
  if (Array.isArray(rawHeader)) {
    return String(rawHeader[0] || "").trim();
  }
  return typeof rawHeader === "string" ? rawHeader.trim() : "";
}

function hasMatchingCsrfTokens(cookieToken: string, headerToken: string) {
  const cookieValue = String(cookieToken || "").trim();
  const headerValue = String(headerToken || "").trim();
  if (!cookieValue || !headerValue) return false;
  const cookieBuffer = Buffer.from(cookieValue, "utf8");
  const headerBuffer = Buffer.from(headerValue, "utf8");
  if (cookieBuffer.length !== headerBuffer.length) return false;
  return timingSafeEqual(cookieBuffer, headerBuffer);
}

async function recordSecurityEvent(req: AuthenticatedRequest, action: string, metadata?: Record<string, unknown>) {
  try {
    await appDb.recordAuditLog({
      actor_user_id: req.auth?.user.id || null,
      action,
      target_type: "security",
      target_id: String(req.path || "").slice(0, 200) || null,
      metadata: {
        ip: getRequestIp(req),
        method: req.method,
        user_agent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
        ...metadata,
      },
    });
  } catch (error) {
    console.error("Failed to persist security audit log:", error);
  }
}

async function csrfProtectionMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!isCsrfCandidateRequest(req)) {
    return next();
  }

  const requestOrigin = getOriginFromHeaders(req);
  const hostOrigin = getRequestHostOrigin(req);
  const originAllowed = Boolean(requestOrigin) && (
    requestOrigin === hostOrigin
    || TRUSTED_CSRF_ORIGINS.has(requestOrigin)
  );

  if (!originAllowed) {
    await recordSecurityEvent(req, "security.csrf_blocked", {
      origin: requestOrigin || null,
      host_origin: hostOrigin || null,
      referer: typeof req.headers.referer === "string" ? req.headers.referer : null,
    });
    return res.status(403).json({
      error: "CSRF validation failed",
    });
  }

  if (isCsrfTokenRequiredRequest(req)) {
    const cookies = parseCookies(req.headers.cookie);
    const csrfCookieToken = cookies.get(CSRF_COOKIE_NAME) || "";
    const csrfHeaderToken = readCsrfTokenHeader(req);
    if (!hasMatchingCsrfTokens(csrfCookieToken, csrfHeaderToken)) {
      await recordSecurityEvent(req, "security.csrf_token_blocked", {
        has_csrf_cookie: Boolean(csrfCookieToken),
        has_csrf_header: Boolean(csrfHeaderToken),
      });
      return res.status(403).json({
        error: "CSRF token validation failed",
      });
    }
  }

  return next();
}

function ensureCsrfCookieMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!String(req.path || "").startsWith("/api/")) {
    return next();
  }
  if (!req.auth?.user) {
    return next();
  }

  const existingToken = parseCookies(req.headers.cookie).get(CSRF_COOKIE_NAME);
  if (!existingToken) {
    setCsrfCookie(res, createSessionToken(), req);
  }
  return next();
}

function applyPermissionsPolicyHeader(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
  return next();
}

function readEventIdFromSourceValue(value: unknown) {
  return String(value || "").trim();
}

function resolveEventScopeContext(req: AuthenticatedRequest, options?: EventScopeOptions): EventScopeContext | null {
  if (options?.allowCheckinAccess !== false && req.checkinAccess?.eventId) {
    return {
      eventId: req.checkinAccess.eventId,
      source: "checkin_access",
    };
  }

  const paramKey = options?.paramKey === undefined ? null : options.paramKey;
  if (paramKey) {
    const eventId = readEventIdFromSourceValue(req.params?.[paramKey]);
    if (eventId) {
      return { eventId, source: "params" };
    }
  }

  const bodyKey = options?.bodyKey === undefined ? null : options.bodyKey;
  if (bodyKey) {
    const body = readObjectBody(req);
    const eventId = readEventIdFromSourceValue(body[bodyKey]);
    if (eventId) {
      return { eventId, source: "body" };
    }
  }

  const queryKey = options?.queryKey === undefined ? "event_id" : options.queryKey;
  if (queryKey) {
    const raw = req.query?.[queryKey];
    const eventId = Array.isArray(raw)
      ? readEventIdFromSourceValue(raw[0])
      : readEventIdFromSourceValue(raw);
    if (eventId) {
      return { eventId, source: "query" };
    }
  }

  if (options?.allowDefault !== false) {
    return { eventId: DEFAULT_EVENT_ID, source: "default" };
  }

  return null;
}

function requireEventScope(options?: EventScopeOptions) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth?.user && !req.checkinAccess) {
      await recordSecurityEvent(req, "security.event_scope_denied", {
        reason: "missing_auth_context",
      });
      return res.status(401).json({ error: "Authentication required" });
    }

    const scope = resolveEventScopeContext(req, options);
    if (!scope?.eventId) {
      return respondValidationError(res, [{ field: "event_id", message: "event_id is required" }]);
    }

    if (req.checkinAccess?.eventId && req.checkinAccess.eventId !== scope.eventId) {
      await recordSecurityEvent(req, "security.event_scope_denied", {
        reason: "checkin_scope_mismatch",
        checkin_event_id: req.checkinAccess.eventId,
        requested_event_id: scope.eventId,
      });
      return res.status(403).json({ error: "Check-in scope cannot access another event" });
    }

    if (req.auth?.user && !userHasRole(req.auth.user.role, EVENT_SCOPED_USER_ROLES)) {
      await recordSecurityEvent(req, "security.event_scope_denied", {
        reason: "role_not_allowed",
        role: req.auth.user.role,
      });
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    if (req.auth?.user) {
      const role = req.auth.user.role;
      const requiresEventAssignment = role !== "owner" && role !== "admin";
      if (requiresEventAssignment) {
        const assigned = await appDb.isUserAssignedToEvent(req.auth.user.id, scope.eventId);
        if (!assigned) {
          await recordSecurityEvent(req, "security.event_scope_denied", {
            reason: "assignment_missing",
            event_id: scope.eventId,
            role,
          });
          return res.status(403).json({ error: "You are not assigned to this event" });
        }
      }
    }

    const event = await appDb.getEventById(scope.eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    req.eventScope = scope;
    return next();
  };
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

function setSessionCookie(res: Response, token: string, req: Request) {
  appendSetCookieHeader(res, serializeAdminSessionCookie(token, req));
}

function clearSessionCookie(res: Response, req: Request) {
  appendSetCookieHeader(res, serializeClearedAdminSessionCookie(req));
}

function setCsrfCookie(res: Response, token: string, req: Request) {
  appendSetCookieHeader(res, serializeCsrfTokenCookie(token, req));
}

function clearCsrfCookie(res: Response, req: Request) {
  appendSetCookieHeader(res, serializeClearedCsrfTokenCookie(req));
}

function setCheckinAccessCookie(res: Response, token: string, req: Request, expiresAt?: string) {
  const expiresAtMs = Number.isFinite(Date.parse(String(expiresAt || ""))) ? Date.parse(String(expiresAt || "")) : 0;
  const maxAgeSeconds = expiresAtMs > Date.now()
    ? Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000))
    : Math.floor(getCheckinAccessSessionTtlMs() / 1000);
  appendSetCookieHeader(res, serializeCheckinAccessSessionCookie(token, req, { maxAgeSeconds }));
}

function clearCheckinAccessCookie(res: Response, req: Request) {
  appendSetCookieHeader(res, serializeClearedCheckinAccessSessionCookie(req));
}

function appendSetCookieHeader(res: Response, cookieValue: string) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, cookieValue]);
    return;
  }
  res.setHeader("Set-Cookie", [String(current), cookieValue]);
}

function toCheckinAccessContext(session: Awaited<ReturnType<typeof appDb.getCheckinAccessSessionByTokenHash>>, tokenHash: string): CheckinAccessContext | null {
  if (!session) return null;
  return {
    sessionId: session.id,
    checkinSessionId: session.checkin_session_id,
    tokenHash,
    eventId: session.event_id,
    label: session.label,
    expiresAt: session.expires_at,
    lastUsedAt: session.last_used_at,
  };
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
      clearCsrfCookie(res, req);
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

async function attachCheckinAccessSession(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const accessToken = cookies.get(CHECKIN_ACCESS_COOKIE_NAME);
    if (!accessToken) {
      return next();
    }

    const tokenHash = hashSessionToken(accessToken);
    const accessSession = await appDb.getCheckinAccessSessionByTokenHash(tokenHash);
    if (!accessSession) {
      clearCheckinAccessCookie(res, req);
      return next();
    }

    const context = toCheckinAccessContext(accessSession, tokenHash);
    if (!context) {
      clearCheckinAccessCookie(res, req);
      return next();
    }

    req.checkinAccess = context;
    await appDb.touchCheckinAccessSession(accessSession.id);
    return next();
  } catch (error) {
    console.error("Failed to attach check-in access session:", error);
    return res.status(500).json({ error: "Failed to validate check-in access session" });
  }
}

async function exchangeCheckinAccessToken(rawToken: string, req: AuthenticatedRequest, res: Response) {
  const normalizedToken = String(rawToken || "").trim();
  if (!normalizedToken) return null;

  const accessToken = createSessionToken();
  const accessTokenHash = hashSessionToken(accessToken);
  const accessSession = await appDb.exchangeCheckinSessionToken({
    checkin_token_hash: hashSessionToken(normalizedToken),
    access_token_hash: accessTokenHash,
    max_session_ttl_ms: getCheckinAccessSessionTtlMs(),
  });
  if (!accessSession) {
    return null;
  }

  setCheckinAccessCookie(res, accessToken, req, accessSession.expires_at);
  const context = toCheckinAccessContext(accessSession, accessTokenHash);
  if (context) {
    req.checkinAccess = context;
  }
  return accessSession;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.auth?.user) {
    return next();
  }
  void recordSecurityEvent(req, "security.auth_required_denied", {
    reason: "missing_session",
  });
  return res.status(401).json({ error: "Authentication required" });
}

function requireRoles(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth?.user) {
      void recordSecurityEvent(req, "security.role_denied", {
        reason: "missing_session",
        required_roles: allowedRoles,
      });
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!userHasRole(req.auth.user.role, allowedRoles)) {
      void recordSecurityEvent(req, "security.role_denied", {
        reason: "insufficient_role",
        required_roles: allowedRoles,
        user_role: req.auth.user.role,
      });
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
  const scopedRequest = req as AuthenticatedRequest;
  if (scopedRequest.eventScope?.eventId) {
    return scopedRequest.eventScope.eventId;
  }
  const queryRaw = typeof req.query.event_id === "string" ? req.query.event_id : "";
  if (queryRaw.trim()) {
    return queryRaw.trim();
  }
  if (isRecord(scopedRequest.body) && typeof scopedRequest.body.event_id === "string" && scopedRequest.body.event_id.trim()) {
    return scopedRequest.body.event_id.trim();
  }
  return DEFAULT_EVENT_ID;
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

async function getEventDocumentChunkEmbeddings(eventId: string) {
  return appDb.listEventDocumentChunkEmbeddings(eventId);
}

async function getRegistrationById(id: string) {
  return appDb.getRegistrationById(id);
}

function normalizePublicSlug(rawValue: unknown) {
  return String(rawValue || "").trim().toLowerCase();
}

function buildTicketArtifactUrls(registrationId: string) {
  const encodedId = encodeURIComponent(registrationId);
  return {
    png_url: buildTicketImageUrl(registrationId, "png") || `/api/tickets/${encodedId}.png`,
    svg_url: buildTicketImageUrl(registrationId, "svg") || `/api/tickets/${encodedId}.svg`,
  };
}

async function resolvePublicEventBySlug(rawSlug: string) {
  const slug = normalizePublicSlug(rawSlug);
  if (!slug) return null;

  const events = await appDb.listEvents();
  const eventSettingsRows = await Promise.all(
    events.map(async (event) => ({
      event,
      settings: await getSettingsMap(event.id),
    })),
  );

  const explicitMatch = eventSettingsRows.find(({ settings }) => normalizePublicSlug(settings.event_public_slug) === slug);
  if (explicitMatch) {
    return explicitMatch;
  }

  return eventSettingsRows.find(({ event, settings }) =>
    !normalizePublicSlug(settings.event_public_slug) && normalizePublicSlug(event.slug) === slug,
  ) || null;
}

async function buildPublicEventPagePayload(
  event: Awaited<ReturnType<typeof appDb.getEventById>>,
  settings: Record<string, string>,
) {
  if (!event) return null;

  const capacity = await getEventCapacitySnapshot(event.id, settings);
  const location = buildEventLocationSummaryFromSettings(settings);
  const summary = String(settings.event_public_summary || "").trim() || String(settings.event_description || "").trim();
  const publicSlug = String(settings.event_public_slug || "").trim() || event.slug;

  return {
    event: {
      id: event.id,
      name: String(settings.event_name || event.name || "").trim() || event.name,
      slug: publicSlug,
      status: event.effective_status,
      summary,
      description: String(settings.event_description || "").trim(),
      poster_url: String(settings.event_public_poster_url || "").trim(),
      cta_label: String(settings.event_public_cta_label || "").trim() || "Register Now",
      success_message:
        String(settings.event_public_success_message || "").trim()
        || "Registration complete. Save your ticket image to your phone now.",
      date: String(settings.event_date || "").trim(),
      end_date: String(settings.event_end_date || "").trim(),
      date_label: formatTicketDate(settings.event_date || "", settings.event_end_date || "", settings.event_timezone),
      timezone: normalizeTimeZone(settings.event_timezone),
      registration_enabled: isTruthySetting(settings.event_public_registration_enabled ?? "1"),
      registration_availability: event.registration_availability || capacity.registrationAvailability,
      registration_limit: capacity.limit,
      active_registration_count: capacity.activeCount,
      remaining_seats: capacity.remainingCount,
      is_capacity_full: capacity.isFull,
      confirmation_email_enabled: isTruthySetting(settings.confirmation_email_enabled),
    },
    location: {
      venue_name: location.venueName,
      room_detail: location.roomDetail,
      address: location.address,
      title: location.title,
      address_line: location.addressLine,
      compact: location.compact,
      travel_info: location.travelInfo,
      map_url: resolveEventMapUrlFromSettings(settings),
    },
    privacy: {
      enabled: isTruthySetting(settings.event_public_privacy_enabled ?? "1"),
      label: String(settings.event_public_privacy_label || "").trim() || "Privacy",
      text:
        String(settings.event_public_privacy_text || "").trim()
        || "We use your information only for event registration and event-related communication.",
    },
    contact: {
      enabled: isTruthySetting(settings.event_public_contact_enabled ?? "0"),
      intro:
        String(settings.event_public_contact_intro || "").trim()
        || "Need help from our team? Use one of these contact options.",
      messenger_url: String(settings.event_public_contact_messenger_url || "").trim(),
      line_url: String(settings.event_public_contact_line_url || "").trim(),
      phone: String(settings.event_public_contact_phone || "").trim(),
      hours: String(settings.event_public_contact_hours || "").trim(),
    },
    support: {
      bot_enabled: isTruthySetting(settings.event_public_bot_enabled ?? "1"),
    },
  };
}

type CheckinAccessPayloadSource = {
  id: string;
  label: string;
  event_id: string;
  expires_at: string;
  last_used_at: string | null;
};

async function buildCheckinSessionAccessPayload(session: CheckinAccessPayloadSource | null | undefined) {
  if (!session) return null;
  const event = await appDb.getEventById(session.event_id);
  if (!event) return null;
  const settings = await getSettingsMap(session.event_id);
  return {
    id: session.id,
    label: session.label,
    event_id: session.event_id,
    event_name: settings.event_name || event.name,
    event_location: formatEventLocationFromSettings(settings, ""),
    event_timezone: settings.event_timezone || "Asia/Bangkok",
    event_date: settings.event_date || "",
    event_end_date: settings.event_end_date || "",
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

async function performCheckinForRegistration(registrationId: unknown, eventId?: string, options?: { source?: string }) {
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
  if (!alreadyCheckedIn && registration.status === "checked-in") {
    void sendAdminAgentRegistrationNotification({
      kind: "registration_status_changed",
      registration,
      previousStatus: existing.status,
      source: options?.source || "registration_checkin",
      observedAt: new Date().toISOString(),
    });
  }
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

async function resolveManualOutboundTarget(
  eventId: string,
  senderId: string,
  externalId: string,
  platformHint?: string,
): Promise<ManualOutboundTarget> {
  const normalizedEventId = String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
  const normalizedSenderId = String(senderId || "").trim();
  const normalizedExternalId = String(externalId || "").trim();
  const normalizedPlatformHint = String(platformHint || "").trim() as ChannelPlatform | "";

  if (!normalizedSenderId) {
    throw new Error("Sender ID is required");
  }
  if (!normalizedExternalId) {
    throw new Error("Channel destination is required");
  }

  const tryResolveChannel = async (platform: ChannelPlatform) => {
    if (platform === "facebook") {
      const facebookChannel = await appDb.getChannelAccount("facebook", normalizedExternalId);
      if (facebookChannel && facebookChannel.is_active !== false && facebookChannel.event_id === normalizedEventId) {
        return {
          platform: "facebook" as const,
          eventId: normalizedEventId,
          senderId: normalizedSenderId,
          externalId: normalizedExternalId,
        };
      }
      const facebookPage = await appDb.getFacebookPageByPageId(normalizedExternalId);
      if (facebookPage && facebookPage.is_active && facebookPage.event_id === normalizedEventId) {
        return {
          platform: "facebook" as const,
          eventId: normalizedEventId,
          senderId: normalizedSenderId,
          externalId: normalizedExternalId,
        };
      }
      return null;
    }

    const channel = await appDb.getChannelAccount(platform, normalizedExternalId);
    if (!channel || channel.is_active === false || channel.event_id !== normalizedEventId) {
      return null;
    }
    return {
      platform,
      eventId: normalizedEventId,
      senderId: normalizedSenderId,
      externalId: normalizedExternalId,
    } satisfies ManualOutboundTarget;
  };

  if (normalizedPlatformHint) {
    if (!ALLOWED_CHANNEL_PLATFORMS.includes(normalizedPlatformHint)) {
      throw new Error("Invalid channel platform");
    }
    const hintedTarget = await tryResolveChannel(normalizedPlatformHint);
    if (hintedTarget) return hintedTarget;
  }

  for (const platform of ALLOWED_CHANNEL_PLATFORMS) {
    const target = await tryResolveChannel(platform);
    if (target) return target;
  }

  throw new Error("Selected log row is not linked to an active channel for this event");
}

async function sendTextToOutboundTarget(target: ManualOutboundTarget, text: string) {
  switch (target.platform) {
    case "facebook":
      await sendFacebookTextMessage(target.senderId, text, target.externalId);
      return;
    case "line_oa":
      await sendLinePushTextMessage(target.senderId, text, target.externalId);
      return;
    case "instagram":
      await sendInstagramTextMessage(target.senderId, text, target.externalId);
      return;
    case "whatsapp":
      await sendWhatsAppTextMessage(target.senderId, text, target.externalId);
      return;
    case "telegram":
      await sendTelegramTextMessage(target.senderId, text, target.externalId);
      return;
    case "web_chat":
      throw new Error("Manual push is not supported for web chat");
    default:
      throw new Error("Unsupported channel platform");
  }
}

async function sendImageToOutboundTarget(target: ManualOutboundTarget, imageUrl: string) {
  switch (target.platform) {
    case "facebook":
      await sendFacebookImageMessage(target.senderId, imageUrl, target.externalId);
      return;
    case "line_oa":
      await sendLinePushImageMessage(target.senderId, imageUrl, target.externalId);
      return;
    case "instagram":
      await sendInstagramImageMessage(target.senderId, imageUrl, target.externalId);
      return;
    case "whatsapp":
      await sendWhatsAppImageMessage(target.senderId, imageUrl, target.externalId);
      return;
    case "telegram":
      await sendTelegramImageMessage(target.senderId, imageUrl, target.externalId);
      return;
    case "web_chat":
      throw new Error("Manual push is not supported for web chat");
    default:
      throw new Error("Unsupported channel platform");
  }
}

async function sendManualOutboundText(target: ManualOutboundTarget, text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("Manual reply text is required");
  }
  await sendTextToOutboundTarget(target, trimmed);
  await saveMessage(target.senderId, `[manual-reply] ${trimmed}`, "outgoing", target.eventId, target.externalId);
  return {
    steps: ["text"],
  };
}

async function resendTicketArtifactsToOutboundTarget(target: ManualOutboundTarget, registrationId: string) {
  const normalizedRegistrationId = String(registrationId || "").trim().toUpperCase();
  if (!normalizedRegistrationId) {
    throw new Error("Registration ID is required");
  }

  const registration = await getRegistrationById(normalizedRegistrationId);
  if (!registration) {
    throw new Error("Registration not found");
  }

  const registrationEventId = String(registration.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
  if (registrationEventId !== target.eventId) {
    throw new Error("Registration does not belong to the selected event");
  }

  const settings = await getSettingsMap(target.eventId);
  const steps: string[] = [];
  const ticketSummaryText = buildTicketSummaryText(registration, settings);
  await sendTextToOutboundTarget(target, ticketSummaryText);
  await saveMessage(target.senderId, `[manual-ticket-summary] ${normalizedRegistrationId}`, "outgoing", target.eventId, target.externalId);
  steps.push("summary");

  const ticketPngUrl = buildTicketImageUrl(normalizedRegistrationId, "png");
  const ticketSvgUrl = buildTicketImageUrl(normalizedRegistrationId, "svg");
  const ticketFallbackUrl = ticketPngUrl || ticketSvgUrl;

  if (ticketPngUrl) {
    try {
      await sendImageToOutboundTarget(target, ticketPngUrl);
      await saveMessage(target.senderId, `[manual-ticket-image-png] ${normalizedRegistrationId}`, "outgoing", target.eventId, target.externalId);
      steps.push("image");
    } catch (error) {
      console.error("Failed to send manual ticket image:", error);
    }
  }

  if (!steps.includes("image") && ticketFallbackUrl) {
    await sendTextToOutboundTarget(target, `ตั๋วของคุณ: ${ticketFallbackUrl}`);
    await saveMessage(target.senderId, `[manual-ticket-link] ${normalizedRegistrationId}`, "outgoing", target.eventId, target.externalId);
    steps.push("link");
  }

  const mapUrl = resolveEventMapUrlFromSettings(settings);
  if ((steps.includes("image") || steps.includes("link")) && mapUrl) {
    await sendTextToOutboundTarget(target, `แผนที่สถานที่: ${mapUrl}`);
    await saveMessage(target.senderId, `[manual-map-link] ${mapUrl}`, "outgoing", target.eventId, target.externalId);
    steps.push("map");
  }

  return {
    registration_id: normalizedRegistrationId,
    steps,
  };
}

async function retryBotReplyForOutboundTarget(target: ManualOutboundTarget) {
  const channel = getInboundConversationChannelFromPlatform(target.platform);
  const conversationKey = buildInboundConversationKey(channel, target.senderId, target.eventId);

  return runSerializedInboundTask(conversationKey, async () => {
    const retryTurn = await buildRetryTurnForConversation(conversationKey, target.senderId, target.eventId);
    if (!retryTurn) {
      throw new Error("No recent incoming message is available to retry");
    }

    const result = await generateBotReplyForSender(
      target.senderId,
      target.eventId,
      retryTurn.inputText,
      retryTurn.history,
    );

    const replyText = String(result.text || "").trim();
    if (replyText) {
      await sendTextToOutboundTarget(target, replyText);
      await saveMessage(target.senderId, replyText, "outgoing", target.eventId, target.externalId);
    }

    const uniqueTicketIds = [...new Set(result.ticketRegistrationIds.map((id) => String(id || "").trim().toUpperCase()).filter(Boolean))];
    for (const registrationId of uniqueTicketIds) {
      await resendTicketArtifactsToOutboundTarget(target, registrationId);
    }

    clearFailedInboundTurn(conversationKey);
    return {
      steps: [
        replyText ? "text" : "no-text",
        uniqueTicketIds.length > 0 ? "ticket" : "no-ticket",
      ],
      replay_source: retryTurn.source,
      replay_reason: retryTurn.reason,
      ticket_count: uniqueTicketIds.length,
    };
  });
}

function formatAdminAgentRegistrationLine(registration: RegistrationRow) {
  const phone = normalizeOptionalText(registration.phone) || "-";
  const email = normalizeOptionalText(registration.email) || "-";
  return `${registration.id} • ${formatRegistrationDisplayName(registration)} • ${registration.status} • phone ${phone} • email ${email}`;
}

const REGISTRATION_EXPORT_FIELDS: Array<keyof RegistrationRow> = [
  "id",
  "event_id",
  "sender_id",
  "first_name",
  "last_name",
  "phone",
  "email",
  "status",
  "timestamp",
];

function buildRegistrationExportFilename(eventName: string) {
  const slug = String(eventName || "")
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]/g, "-")
    .split("-")
    .filter(Boolean)
    .slice(0, 3)
    .join("-");
  return `registrations-${slug || "data"}.csv`;
}

function buildRegistrationsCsvWithBom(rows: RegistrationRow[]) {
  const normalizedRows = rows.map((row) => ({
    id: String(row.id || ""),
    event_id: String(row.event_id || ""),
    sender_id: String(row.sender_id || ""),
    first_name: String(row.first_name || ""),
    last_name: String(row.last_name || ""),
    phone: String(row.phone || ""),
    email: String(row.email || ""),
    status: String(row.status || ""),
    timestamp: String(row.timestamp || ""),
  })) as RegistrationRow[];
  const json2csvParser = new Parser<RegistrationRow>({ fields: REGISTRATION_EXPORT_FIELDS });
  const csv = json2csvParser.parse(normalizedRows);
  return `\uFEFF${csv}`;
}

async function buildAdminAgentRegistrationCsvBundle(eventId: string, args: Record<string, unknown>, rawMessage: string) {
  const [settings, event, lookup] = await Promise.all([
    getSettingsMap(eventId),
    appDb.getEventById(eventId),
    findRegistrationsForAdminAction(eventId, args, rawMessage, {
      defaultToRecent: true,
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
    }),
  ]);
  const eventName = normalizeOptionalText(settings.event_name) || normalizeOptionalText(event?.name) || eventId;
  return {
    eventId,
    filename: buildRegistrationExportFilename(eventName),
    csv: buildRegistrationsCsvWithBom(lookup.matches),
    totalMatches: lookup.totalMatches,
    filters: lookup.usedFilters,
    registrations: lookup.matches,
  };
}

function buildAdminAgentFindReply(matches: RegistrationRow[], totalMatches: number, limit: number, filters: string[]) {
  if (totalMatches === 0) {
    return filters.length > 0
      ? "ไม่พบข้อมูลตามเงื่อนไขที่ระบุในอีเวนต์นี้"
      : "ยังไม่มีรายชื่อในอีเวนต์นี้";
  }

  const header = filters.length > 0
    ? `พบ ${totalMatches} รายการ (${filters.join(", ")})`
    : `รายชื่อล่าสุด ${Math.min(matches.length, limit)} รายการ`;
  const lines = matches.slice(0, 5).map((registration, index) => `${index + 1}. ${formatAdminAgentRegistrationLine(registration)}`);
  const truncatedNote = totalMatches > matches.length
    ? `\nแสดง ${matches.length} จาก ${totalMatches} รายการ`
    : "";
  return `${header}\n${lines.join("\n")}${truncatedNote}`;
}

function buildAdminAgentListReply(
  matches: RegistrationRow[],
  totalMatches: number,
  limit: number,
  filters: string[],
  timeZone?: string,
  offset = 0,
) {
  if (totalMatches === 0) {
    return filters.length > 0
      ? "ไม่พบรายชื่อที่ตรงเงื่อนไขในอีเวนต์นี้"
      : "ยังไม่มีรายชื่อลงทะเบียนในอีเวนต์นี้";
  }

  const displayCount = Math.min(matches.length, 20);
  const shownStart = Math.min(offset + 1, totalMatches);
  const shownEnd = Math.min(offset + matches.length, totalMatches);
  const header = filters.length > 0
    ? `รายชื่อที่ตรงเงื่อนไข ${totalMatches} รายการ (${filters.join(", ")})`
    : `รายชื่อผู้ลงทะเบียน ${totalMatches} รายการ`;
  const lines = matches.slice(0, displayCount).map((registration, index) => (
    `${index + 1}. ${registration.id} • ${formatRegistrationDisplayName(registration)} • ${registration.status} • phone ${normalizeOptionalText(registration.phone) || "-"} • email ${normalizeOptionalText(registration.email) || "-"} • ${formatEventScopedTimestamp(registration.timestamp, timeZone)}`
  ));
  const notes: string[] = [];
  notes.push(`แสดงลำดับ ${shownStart}-${shownEnd} (limit ${limit}, offset ${offset})`);
  if (matches.length > displayCount) {
    notes.push(`สรุปข้อความ ${displayCount} จาก ${matches.length} รายการที่โหลดมา`);
  }
  if (totalMatches > offset + matches.length) {
    const nextOffset = offset + matches.length;
    notes.push(`ยังเหลืออีก ${totalMatches - nextOffset} รายการ (ลองสั่งต่อด้วย offset ${nextOffset})`);
  }

  return `${header}\n${lines.join("\n")}\n${notes.join("\n")}`;
}

function buildRegistrationLookupFilters(args: Record<string, unknown>, rawMessage: string) {
  const registrationId =
    normalizeRegistrationId(args.registration_id)
    || normalizeRegistrationId(args.id)
    || extractRegistrationId(rawMessage);
  const senderId = normalizeOptionalText(args.sender_id);
  const fullName = normalizeComparableText(
    normalizeOptionalText(args.full_name)
      || `${normalizeOptionalText(args.first_name)} ${normalizeOptionalText(args.last_name)}`.trim(),
  );
  const query = normalizeComparableText(args.query);
  const phone = normalizeComparableText(args.phone);
  const email = normalizeComparableText(args.email);
  const status = normalizeRegistrationStatusInput(args.status);
  const limit = parsePositiveInteger(args.limit, 8, 30);
  const fromTimestampRaw = normalizeOptionalText(args.from_timestamp) || normalizeOptionalText(args.since);
  const toTimestampRaw = normalizeOptionalText(args.to_timestamp) || normalizeOptionalText(args.until);
  const fromTimestamp = fromTimestampRaw ? Date.parse(fromTimestampRaw) : NaN;
  const toTimestamp = toTimestampRaw ? Date.parse(toTimestampRaw) : NaN;
  const fromMs = Number.isFinite(fromTimestamp) ? fromTimestamp : null;
  const toMs = Number.isFinite(toTimestamp) ? toTimestamp : null;

  return {
    registrationId,
    senderId,
    fullName,
    query,
    phone,
    email,
    status,
    limit,
    fromMs,
    toMs,
  };
}

function splitAdminFullName(rawName: string) {
  const tokens = normalizeOptionalText(rawName).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { firstName: "", lastName: "" };
  }
  if (tokens.length === 1) {
    return { firstName: tokens[0], lastName: "" };
  }
  return {
    firstName: tokens[0],
    lastName: tokens.slice(1).join(" "),
  };
}

function normalizeAdminPhoneCandidate(value: unknown) {
  const raw = normalizeOptionalText(value);
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  const hasPlus = cleaned.startsWith("+");
  const digits = hasPlus ? cleaned.slice(1) : cleaned;
  if (!/^\d+$/.test(digits)) return "";
  if (digits.length < 8 || digits.length > 18) return "";
  return hasPlus ? `+${digits}` : digits;
}

function parseAdminRegistrationDraft(args: Record<string, unknown>, rawMessage: string) {
  let firstName = normalizeOptionalText(args.first_name);
  let lastName = normalizeOptionalText(args.last_name);
  let phone = normalizeAdminPhoneCandidate(args.phone);
  let email = normalizeOptionalText(args.email);
  let senderId = normalizeOptionalText(args.sender_id);
  const fullNameArg = normalizeOptionalText(args.full_name);

  if ((!firstName || !lastName) && fullNameArg) {
    const splitFromFull = splitAdminFullName(fullNameArg);
    firstName = firstName || splitFromFull.firstName;
    lastName = lastName || splitFromFull.lastName;
  }

  const rawTokens = normalizeOptionalText(rawMessage)
    .split(/\s+/)
    .map((token) => token.replace(/^[,;]+|[,;]+$/g, "").trim())
    .filter(Boolean);
  if (rawTokens.length > 0) {
    let emailIndex = -1;
    if (!email) {
      emailIndex = rawTokens.findIndex((token) => looksLikeEmailAddress(token));
      if (emailIndex >= 0) {
        email = rawTokens[emailIndex];
      }
    }

    let phoneIndex = -1;
    if (!phone) {
      phoneIndex = rawTokens.findIndex((token) => Boolean(normalizeAdminPhoneCandidate(token)));
      if (phoneIndex >= 0) {
        phone = normalizeAdminPhoneCandidate(rawTokens[phoneIndex]);
      }
    }

    const candidateNameTokens = rawTokens.filter((_, index) => index !== emailIndex && index !== phoneIndex);
    if (!firstName && candidateNameTokens.length > 0) {
      firstName = candidateNameTokens[0] || "";
    }
    if (!lastName && candidateNameTokens.length > 1) {
      lastName = candidateNameTokens.slice(1).join(" ");
    }
  }

  const normalizedPhoneDigits = phone.replace(/\D/g, "");
  if (!senderId) {
    if (normalizedPhoneDigits) {
      senderId = `admin-manual:${normalizedPhoneDigits}`;
    } else {
      senderId = `admin-manual:${Date.now().toString(36)}`;
    }
  }

  return {
    firstName,
    lastName,
    phone,
    email,
    senderId,
  };
}

async function findRegistrationsForAdminAction(
  eventId: string,
  args: Record<string, unknown>,
  rawMessage: string,
  options?: { defaultToRecent?: boolean; limit?: number; offset?: number },
) {
  const rows = await appDb.listRegistrations(undefined, eventId);
  const filters = buildRegistrationLookupFilters(args, rawMessage);
  const limitCandidate = Number.isFinite(options?.limit) ? Number(options?.limit) : filters.limit;
  const limit = Number.isFinite(limitCandidate) && limitCandidate > 0
    ? Math.floor(limitCandidate)
    : 8;
  const offset = parseNonNegativeInteger(options?.offset, 0, Math.max(rows.length, 0));
  let matches = rows.slice();
  const usedFilters: string[] = [];

  if (filters.registrationId) {
    matches = matches.filter((row) => String(row.id || "").trim().toUpperCase() === filters.registrationId);
    usedFilters.push(`id=${filters.registrationId}`);
  }
  if (filters.senderId) {
    matches = matches.filter((row) => String(row.sender_id || "").trim() === filters.senderId);
    usedFilters.push(`sender=${filters.senderId}`);
  }
  if (filters.fullName) {
    matches = matches.filter((row) =>
      normalizeComparableText(`${row.first_name || ""} ${row.last_name || ""}`) === filters.fullName,
    );
    usedFilters.push(`name="${filters.fullName}"`);
  }
  if (filters.phone) {
    matches = matches.filter((row) => normalizeComparableText(row.phone) === filters.phone);
    usedFilters.push(`phone=${filters.phone}`);
  }
  if (filters.email) {
    matches = matches.filter((row) => normalizeComparableText(row.email) === filters.email);
    usedFilters.push(`email=${filters.email}`);
  }
  if (filters.status) {
    matches = matches.filter((row) => row.status === filters.status);
    usedFilters.push(`status=${filters.status}`);
  }
  if (filters.fromMs !== null) {
    matches = matches.filter((row) => {
      const value = Date.parse(String(row.timestamp || ""));
      return Number.isFinite(value) && value >= filters.fromMs!;
    });
    usedFilters.push(`from=${new Date(filters.fromMs).toISOString()}`);
  }
  if (filters.toMs !== null) {
    matches = matches.filter((row) => {
      const value = Date.parse(String(row.timestamp || ""));
      return Number.isFinite(value) && value <= filters.toMs!;
    });
    usedFilters.push(`to=${new Date(filters.toMs).toISOString()}`);
  }

  if (filters.query && !filters.registrationId && !filters.fullName && !filters.phone && !filters.email) {
    const query = filters.query;
    matches = matches.filter((row) => {
      const haystack = [
        row.id,
        row.first_name,
        row.last_name,
        `${row.first_name || ""} ${row.last_name || ""}`,
        row.phone,
        row.email,
        row.sender_id,
      ]
        .map((value) => normalizeComparableText(value))
        .join("\n");
      return haystack.includes(query);
    });
    usedFilters.push(`query="${query}"`);
  }

  const slicedRows = (source: RegistrationRow[]) => {
    const start = Math.min(offset, source.length);
    const end = Math.min(start + limit, source.length);
    return source.slice(start, end);
  };

  if (usedFilters.length === 0 && options?.defaultToRecent) {
    return {
      totalMatches: rows.length,
      matches: slicedRows(rows),
      usedFilters,
      limit,
      offset,
    };
  }

  return {
    totalMatches: matches.length,
    matches: slicedRows(matches),
    usedFilters,
    limit,
    offset,
  };
}

async function resolveSingleRegistrationForAdminAction(eventId: string, args: Record<string, unknown>, rawMessage: string) {
  const idFromArgs =
    normalizeRegistrationId(args.registration_id)
    || normalizeRegistrationId(args.id)
    || extractRegistrationId(rawMessage);

  if (idFromArgs) {
    const registration = await getRegistrationById(idFromArgs);
    if (!registration) {
      throw new Error(`Registration ${idFromArgs} was not found`);
    }
    const registrationEventId = String(registration.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    if (registrationEventId !== eventId) {
      throw new Error(`Registration ${idFromArgs} does not belong to the selected event`);
    }
    return registration;
  }

  const lookup = await findRegistrationsForAdminAction(eventId, args, rawMessage, { defaultToRecent: false, limit: 25 });
  if (lookup.totalMatches === 1 && lookup.matches[0]) {
    return lookup.matches[0];
  }
  if (lookup.totalMatches > 1) {
    throw new Error("Multiple registrations matched. Please specify registration_id");
  }

  const senderId = normalizeOptionalText(args.sender_id);
  if (senderId) {
    const rows = await appDb.listRegistrations(undefined, eventId);
    const latestFromSender = rows.find((row) => String(row.sender_id || "").trim() === senderId);
    if (latestFromSender) {
      return latestFromSender;
    }
  }

  throw new Error("Registration ID is required (example: REG-XXXXXX)");
}

async function resolveManualTargetFromRecentConversation(options: {
  eventId: string;
  senderId: string;
  externalId?: string;
  platform?: ChannelPlatform | null;
}) {
  const eventId = String(options.eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
  const senderId = normalizeOptionalText(options.senderId);
  const externalId = normalizeOptionalText(options.externalId);
  const platformHint = options.platform || undefined;

  if (!senderId) {
    throw new Error("Sender ID is required");
  }

  if (externalId) {
    return resolveManualOutboundTarget(eventId, senderId, externalId, platformHint);
  }

  const rows = await appDb.getConversationRowsForSender(senderId, 30, eventId);
  const latestDestination = rows.find((row) => normalizeOptionalText(row.page_id));
  if (!latestDestination) {
    throw new Error("No recent channel destination found for this sender");
  }

  const inferredExternalId = normalizeOptionalText(latestDestination.page_id);
  return resolveManualOutboundTarget(eventId, senderId, inferredExternalId, platformHint);
}

async function sendRegistrationConfirmationEmailManually(registrationId: string) {
  const normalizedRegistrationId = normalizeRegistrationId(registrationId);
  if (!normalizedRegistrationId) {
    throw new Error("Valid registration ID is required");
  }

  const registration = await getRegistrationById(normalizedRegistrationId);
  if (!registration) {
    throw new Error(`Registration ${normalizedRegistrationId} was not found`);
  }

  const email = String(registration.email || "").trim();
  if (!looksLikeEmailAddress(email)) {
    throw new Error("This registration does not have a valid email");
  }

  const eventId = String(registration.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
  const settings = await getSettingsMap(eventId);
  const subject = renderRegistrationConfirmationSubject(settings.confirmation_email_subject, registration, settings);
  const kind = `manual_confirmation_${Date.now()}`;
  const delivery = await appDb.createRegistrationEmailDelivery({
    registration_id: registration.id,
    event_id: eventId,
    recipient_email: email,
    kind,
    subject,
    provider: "resend",
  });
  if (!delivery) {
    throw new Error("Failed to create email delivery record");
  }

  try {
    const content = buildRegistrationConfirmationEmailContent(registration, settings, subject);
    await sendResendEmail({
      to: email,
      subject,
      text: content.text,
      html: content.html,
    });
    await appDb.markRegistrationEmailDeliverySent(delivery.id, content.provider);
    return {
      registration,
      recipient_email: email,
      subject,
      delivery_id: delivery.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appDb.markRegistrationEmailDeliveryFailed(delivery.id, message, "resend");
    throw new Error(`Failed to send confirmation email: ${message}`);
  }
}

type AdminAgentEventCandidate = {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  effectiveStatus: string;
  registrationAvailability: string;
  searchableCore: string;
  searchableExtended: string;
  searchable: string;
};

type AdminAgentEventSearchOptions = {
  effectiveStatuses?: string[];
  registrationAvailability?: string[];
};

function sanitizeAdminAgentEventQuery(rawQuery: string) {
  const source = normalizeOptionalText(rawQuery);
  if (!source) return "";
  return source
    .replace(/^\/agent\b/i, " ")
    .replace(/[\?\!]/g, " ")
    .replace(/(ค้นหา|search|find|show|list|แสดง|ลิสต์|ช่วย|ขอ|ลอง|บอก|ดู)/gi, " ")
    .replace(/(อีเวนต์|อีเว้นต์|งาน|รายการ|events?)/gi, " ")
    .replace(/(มีอะไรบ้าง|มีอะไร|อะไรบ้าง|ทั้งหมด|all events?)/gi, " ")
    .replace(/(ที่จัดที่|ที่จัด|สถานที่จัดงาน|สถานที่)/g, " ")
    .replace(/(ครับ|ค่ะ|คะ|นะ|หน่อย|ที|ทีครับ|ไหม|มั้ย|หรือเปล่า|หรือไม่|บ้าง)$/g, " ")
    .replace(/(เปิดอยู่|กำลังเปิด|ยังไม่เริ่ม|รอดำเนินการ|จบแล้ว|ปิดแล้ว|ยกเลิก|รับสมัคร|ลงทะเบียน|เต็ม)/g, " ")
    .replace(/\b(active|open|pending|inactive|closed|cancelled|canceled|registration)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAdminAgentEventSearchOptions(
  args: Record<string, unknown>,
  rawMessage: string,
): AdminAgentEventSearchOptions {
  const source = `${normalizeOptionalText(args.query)} ${normalizeOptionalText(args.name)} ${normalizeOptionalText(rawMessage)}`.toLowerCase();
  const effectiveStatuses = new Set<string>();
  const registrationAvailability = new Set<string>();
  const normalizedStatus = normalizeComparableText(args.status);
  const normalizedAvailability = normalizeComparableText(args.registration_availability);
  const normalizedOpenOnly = normalizeComparableText(args.registration_open_only);

  if (normalizedStatus === "active" || /active|เปิดอยู่|กำลังเปิด|เปิดตอนนี้/.test(source)) {
    effectiveStatuses.add("active");
  }
  if (normalizedStatus === "pending" || /pending|รอดำเนินการ|ยังไม่เริ่ม|upcoming/.test(source)) {
    effectiveStatuses.add("pending");
  }
  if (normalizedStatus === "inactive" || /inactive|ปิดใช้งาน|ไม่ active/.test(source)) {
    effectiveStatuses.add("inactive");
  }
  if (normalizedStatus === "closed" || /closed|จบแล้ว|ปิดแล้ว|สิ้นสุด/.test(source)) {
    effectiveStatuses.add("closed");
  }
  if (normalizedStatus === "cancelled" || /cancelled|canceled|ยกเลิก/.test(source)) {
    effectiveStatuses.add("cancelled");
  }

  if (
    normalizedAvailability === "open"
    || /เปิดรับสมัคร|ลงทะเบียน.*(เปิด|อยู่)|registration open|open registration|open for registration/.test(source)
    || normalizedOpenOnly === "true"
    || normalizedOpenOnly === "1"
    || normalizedOpenOnly === "yes"
  ) {
    registrationAvailability.add("open");
  }
  if (normalizedAvailability === "not_started" || /ยังไม่เปิดลงทะเบียน|not started/.test(source)) {
    registrationAvailability.add("not_started");
  }
  if (normalizedAvailability === "closed" || /ปิดรับสมัคร|registration closed|closed registration/.test(source)) {
    registrationAvailability.add("closed");
  }
  if (normalizedAvailability === "full" || /เต็ม|full/.test(source)) {
    registrationAvailability.add("full");
  }

  return {
    effectiveStatuses: [...effectiveStatuses],
    registrationAvailability: [...registrationAvailability],
  };
}

async function listAdminAgentEventCandidates(options?: { eventIds?: Set<string> | null }): Promise<AdminAgentEventCandidate[]> {
  const filterEventIds = options?.eventIds && options.eventIds.size > 0 ? options.eventIds : null;
  const events = (await appDb.listEvents()).filter((event) => (
    !filterEventIds || filterEventIds.has(String(event.id || "").trim())
  ));
  const candidates = await Promise.all(events.map(async (event) => {
    const settings = await getSettingsMap(event.id);
    const configuredName = normalizeOptionalText(settings.event_name);
    const configuredVenueName = normalizeOptionalText(settings.event_venue_name);
    const configuredRoomDetail = normalizeOptionalText(settings.event_room_detail);
    const configuredLocation = normalizeOptionalText(settings.event_location);
    const configuredMapUrl = normalizeOptionalText(settings.event_map_url);
    const configuredDescription = normalizeOptionalText(settings.event_description);
    const configuredTravel = normalizeOptionalText(settings.event_travel);
    const configuredContext = normalizeOptionalText(settings.context);
    const configuredLocationLabel = formatEventLocationFromSettings(settings, "");
    const displayName = configuredName || normalizeOptionalText(event.name) || event.id;
    const searchableCoreParts = [
      normalizeComparableText(event.id),
      normalizeComparableText(event.slug),
      normalizeComparableText(event.name),
      normalizeComparableText(configuredName),
      normalizeComparableText(configuredVenueName),
      normalizeComparableText(configuredRoomDetail),
      normalizeComparableText(configuredLocation),
      normalizeComparableText(configuredLocationLabel),
      normalizeComparableText(configuredMapUrl),
      normalizeComparableText(event.effective_status || ""),
      normalizeComparableText(event.registration_availability || ""),
      event.effective_status === "active" ? "open เปิด เปิดอยู่ กำลังเปิด" : "",
      event.effective_status === "pending" ? "pending upcoming ยังไม่เริ่ม รอดำเนินการ" : "",
      event.effective_status === "closed" ? "closed จบแล้ว ปิดแล้ว สิ้นสุด" : "",
      event.effective_status === "inactive" ? "inactive ปิดใช้งาน" : "",
      event.effective_status === "cancelled" ? "cancelled canceled ยกเลิก" : "",
      event.registration_availability === "open" ? "registration open เปิดรับสมัคร ลงทะเบียนได้" : "",
      event.registration_availability === "not_started" ? "registration not started ยังไม่เปิดลงทะเบียน" : "",
      event.registration_availability === "closed" ? "registration closed ปิดรับสมัคร" : "",
      event.registration_availability === "full" ? "registration full เต็ม" : "",
    ].filter(Boolean);
    const searchableExtendedParts = [
      normalizeComparableText(configuredDescription),
      normalizeComparableText(configuredTravel),
      normalizeComparableText(configuredContext),
    ].filter(Boolean);
    const searchableCore = searchableCoreParts.join("\n");
    const searchableExtended = searchableExtendedParts.join("\n");
    const searchable = [searchableCore, searchableExtended].filter(Boolean).join("\n");
    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      displayName,
      effectiveStatus: String(event.effective_status || ""),
      registrationAvailability: String(event.registration_availability || ""),
      searchableCore,
      searchableExtended,
      searchable,
    };
  }));

  return candidates.sort((left, right) => {
    const leftActive = left.effectiveStatus === "active" ? 0 : 1;
    const rightActive = right.effectiveStatus === "active" ? 0 : 1;
    if (leftActive !== rightActive) return leftActive - rightActive;
    return left.displayName.localeCompare(right.displayName, "th");
  });
}

function buildCharacterNgramSet(value: string, size = 3) {
  const compact = normalizeComparableText(value).replace(/\s+/g, "");
  const ngramSize = Math.max(2, size);
  if (!compact) return new Set<string>();
  if (compact.length <= ngramSize) {
    return new Set([compact]);
  }
  const grams = new Set<string>();
  for (let index = 0; index <= compact.length - ngramSize; index += 1) {
    grams.add(compact.slice(index, index + ngramSize));
  }
  return grams;
}

function computeCharacterNgramOverlap(query: string, haystack: string, size = 3) {
  const left = buildCharacterNgramSet(query, size);
  const right = buildCharacterNgramSet(haystack, size);
  if (!left.size || !right.size) return 0;
  let hit = 0;
  for (const gram of left) {
    if (right.has(gram)) hit += 1;
  }
  return hit / left.size;
}

function scoreAdminAgentEventCandidate(candidate: AdminAgentEventCandidate, normalizedQuery: string) {
  if (!normalizedQuery) return 0;
  const normalizedId = normalizeComparableText(candidate.id);
  const normalizedSlug = normalizeComparableText(candidate.slug);
  const normalizedDisplayName = normalizeComparableText(candidate.displayName);
  const searchableCore = normalizeComparableText(candidate.searchableCore);
  const searchableExtended = normalizeComparableText(candidate.searchableExtended);
  const searchable = normalizeComparableText(candidate.searchable);
  let score = 0;

  if (normalizedId === normalizedQuery) score = Math.max(score, 260);
  if (normalizedSlug === normalizedQuery) score = Math.max(score, 240);
  if (normalizedDisplayName === normalizedQuery) score = Math.max(score, 220);
  if (normalizedId.includes(normalizedQuery)) score = Math.max(score, 236);
  if (normalizedSlug.includes(normalizedQuery)) score = Math.max(score, 216);
  if (normalizedDisplayName.includes(normalizedQuery)) score = Math.max(score, 206 + Math.min(16, normalizedQuery.length));
  if (searchableCore.includes(normalizedQuery)) {
    score = Math.max(score, 190 + Math.min(22, normalizedQuery.length));
  }
  if (searchableExtended.includes(normalizedQuery)) {
    score = Math.max(score, 160 + Math.min(20, normalizedQuery.length));
  }
  if (searchable.includes(normalizedQuery)) {
    score = Math.max(score, 170 + Math.min(30, normalizedQuery.length));
  }

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  if (tokens.length > 0) {
    let hitCount = 0;
    let coreHitCount = 0;
    let titleHitCount = 0;
    for (const token of tokens) {
      if (searchable.includes(token)) {
        hitCount += 1;
      }
      if (searchableCore.includes(token)) {
        coreHitCount += 1;
      }
      if (normalizedDisplayName.includes(token)) {
        titleHitCount += 1;
      }
    }
    if (titleHitCount === tokens.length) {
      score = Math.max(score, 206 + titleHitCount * 8);
    } else if (titleHitCount > 0) {
      score = Math.max(score, 162 + titleHitCount * 7);
    }
    if (coreHitCount === tokens.length) {
      score = Math.max(score, 176 + coreHitCount * 7);
    } else if (coreHitCount > 0) {
      score = Math.max(score, 136 + coreHitCount * 7);
    }
    if (hitCount === tokens.length) {
      score = Math.max(score, 130 + hitCount * 6);
    } else if (hitCount > 0) {
      score = Math.max(score, 70 + hitCount * 8);
    }
  }

  return score;
}

async function searchAdminAgentEvents(
  query: string,
  limit = 5,
  options?: AdminAgentEventSearchOptions,
  scope?: { eventIds?: Set<string> | null },
): Promise<AdminAgentEventCandidate[]> {
  const normalizedQuery = normalizeComparableText(query);
  const maxResults = parsePositiveInteger(limit, 5, 20);
  const candidates = await listAdminAgentEventCandidates(scope);
  const derivedFilters = parseAdminAgentEventSearchOptions({ query }, query);
  const effectiveStatuses = options?.effectiveStatuses?.length
    ? options.effectiveStatuses
    : (derivedFilters.effectiveStatuses || []);
  const registrationAvailability = options?.registrationAvailability?.length
    ? options.registrationAvailability
    : (derivedFilters.registrationAvailability || []);
  let filteredCandidates = candidates.slice();

  if (effectiveStatuses.length > 0) {
    filteredCandidates = filteredCandidates.filter((candidate) =>
      effectiveStatuses.includes(candidate.effectiveStatus),
    );
  }
  if (registrationAvailability.length > 0) {
    filteredCandidates = filteredCandidates.filter((candidate) =>
      registrationAvailability.includes(candidate.registrationAvailability),
    );
  }

  const cleanedQuery = sanitizeAdminAgentEventQuery(query);
  const normalizedCleanedQuery = normalizeComparableText(cleanedQuery);
  const effectiveQuery = normalizedCleanedQuery || normalizedQuery;
  if (!effectiveQuery) {
    return filteredCandidates.slice(0, maxResults);
  }

  const scored = filteredCandidates
    .map((candidate) => ({
      candidate,
      score: scoreAdminAgentEventCandidate(candidate, effectiveQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.candidate.displayName.localeCompare(right.candidate.displayName, "th");
    })
    .slice(0, maxResults)
    .map((entry) => entry.candidate);

  if (scored.length > 0) {
    return scored;
  }

  const fuzzyScored = filteredCandidates
    .map((candidate) => {
      const overlap = computeCharacterNgramOverlap(
        effectiveQuery,
        candidate.searchable,
        effectiveQuery.replace(/\s+/g, "").length >= 8 ? 3 : 2,
      );
      return { candidate, overlap };
    })
    .filter((entry) => entry.overlap >= 0.34)
    .sort((left, right) => {
      if (left.overlap !== right.overlap) return right.overlap - left.overlap;
      return left.candidate.displayName.localeCompare(right.candidate.displayName, "th");
    })
    .slice(0, maxResults)
    .map((entry) => entry.candidate);

  if (fuzzyScored.length > 0) {
    return fuzzyScored;
  }
  if (effectiveStatuses.length > 0 || registrationAvailability.length > 0) {
    return filteredCandidates.slice(0, maxResults);
  }
  return [];
}

function serializeAdminAgentEvent(candidate: AdminAgentEventCandidate) {
  return {
    id: candidate.id,
    slug: candidate.slug,
    name: candidate.name,
    display_name: candidate.displayName,
    effective_status: candidate.effectiveStatus,
    registration_availability: candidate.registrationAvailability || null,
  };
}

function buildAdminAgentFindEventReply(matches: AdminAgentEventCandidate[], query: string, limit: number) {
  if (matches.length === 0) {
    return query
      ? `ไม่พบอีเวนต์ที่ตรงกับ "${query}" ลองระบุคำสำคัญเพิ่มหรือใช้ event_id`
      : "ยังไม่พบรายการอีเวนต์ในระบบ";
  }
  const header = query
    ? `พบอีเวนต์ ${matches.length} รายการที่ตรงกับ "${query}" (แสดงสูงสุด ${Math.min(limit, matches.length)})`
    : `รายการอีเวนต์ที่ใช้งานล่าสุด ${Math.min(limit, matches.length)} รายการ`;
  const lines = matches.slice(0, limit).map((event, index) => (
    `${index + 1}. ${event.id} • ${event.displayName} • ${event.effectiveStatus}`
  ));
  return `${header}\n${lines.join("\n")}`;
}

async function resolveAdminAgentEventId(eventId: string, options?: { allowedEventId?: string; allowCrossEventSearch?: boolean }) {
  const normalizedEventId = normalizeOptionalText(eventId) || DEFAULT_EVENT_ID;
  const allowedEventId = normalizeOptionalText(options?.allowedEventId) || "";
  const allowCrossEventSearch = options?.allowCrossEventSearch !== false;

  if (allowedEventId && !allowCrossEventSearch && normalizedEventId !== allowedEventId) {
    throw new Error(`Cross-event override is disabled by Agent policy. Current event: ${allowedEventId}`);
  }

  const exactEvent = await appDb.getEventById(normalizedEventId);
  if (exactEvent) {
    if (allowedEventId && !allowCrossEventSearch && normalizedEventId !== allowedEventId) {
      throw new Error(`Cross-event override is disabled by Agent policy. Current event: ${allowedEventId}`);
    }
    return normalizedEventId;
  }

  const searchScope = allowedEventId && !allowCrossEventSearch
    ? { eventIds: new Set([allowedEventId]) }
    : undefined;
  const matches = await searchAdminAgentEvents(normalizedEventId, 5, undefined, searchScope);
  if (matches.length === 1) {
    return matches[0]!.id;
  }
  if (matches.length > 1) {
    const options = matches.slice(0, 3).map((event) => `${event.id} (${event.displayName})`).join(", ");
    throw new Error(`Event "${normalizedEventId}" matched multiple events: ${options}. Please specify event_id.`);
  }

  throw new Error(`Event ${normalizedEventId} was not found`);
}

function parseAdminAgentEventOverride(text: string, fallbackEventId: string) {
  const raw = String(text || "").trim();
  const normalized = raw.replace(/^\/agent\b/i, "").trim();
  const overrideWithSlash = normalized.match(/^\/event\s+([a-zA-Z0-9_-]+)\s+([\s\S]+)$/i);
  if (overrideWithSlash) {
    return {
      eventId: String(overrideWithSlash[1] || "").trim() || fallbackEventId,
      command: String(overrideWithSlash[2] || "").trim(),
    };
  }
  const overrideWithPrefix = normalized.match(/^event\s*:\s*([a-zA-Z0-9_-]+)\s+([\s\S]+)$/i);
  if (overrideWithPrefix) {
    return {
      eventId: String(overrideWithPrefix[1] || "").trim() || fallbackEventId,
      command: String(overrideWithPrefix[2] || "").trim(),
    };
  }
  return {
    eventId: fallbackEventId,
    command: normalized,
  };
}

function inferAdminAgentRuleToolCall(
  message: string,
  allowedActions: Set<AdminAgentActionName>,
): AdminAgentToolCall | null {
  if (!allowedActions.has("view_ticket")) {
    return null;
  }

  const normalized = normalizeComparableText(message);
  if (!normalized) return null;
  const hasTicketKeyword = normalized.includes("ticket") || normalized.includes("ตั๋ว");
  if (!hasTicketKeyword) return null;

  const asksPreview =
    normalized.includes("ขอดู")
    || normalized.includes("ดูตั๋ว")
    || normalized.includes("ขอตั๋ว")
    || normalized.includes("เอาตั๋ว")
    || normalized.includes("แสดงตั๋ว")
    || normalized.includes("show ticket")
    || normalized.includes("preview ticket")
    || normalized.includes("ให้ดู");

  const explicitSendToUser =
    normalized.includes("resend")
    || normalized.includes("ส่งให้ user")
    || normalized.includes("ส่งให้user")
    || normalized.includes("send to user")
    || normalized.includes("sender")
    || normalized.includes("ไปให้")
    || normalized.includes("ไปหา")
    || normalized.includes("ให้เขา")
    || normalized.includes("ให้ลูกค้า")
    || normalized.includes("ถึงผู้ใช้")
    || normalized.includes("ถึง user")
    || normalized.includes("ถึงuser");

  if (asksPreview && !explicitSendToUser) {
    return {
      name: "view_ticket",
      args: {},
      source: "rule",
    };
  }

  return null;
}

function normalizeAdminEventStatusInput(value: unknown): "pending" | "active" | "inactive" | "cancelled" | null {
  const normalized = normalizeComparableText(value);
  if (normalized === "pending" || normalized === "active" || normalized === "inactive" || normalized === "cancelled") {
    return normalized;
  }
  if (normalized === "live") return "active";
  if (normalized === "pause" || normalized === "paused") return "inactive";
  return null;
}

function parseOptionalBooleanSetting(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value == null) return null;
  const normalized = normalizeComparableText(value);
  if (!normalized) return null;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return null;
}

function normalizeDateTimeInput(value: unknown) {
  const raw = normalizeOptionalText(value);
  if (!raw) return "";
  const normalized = raw.replace(/\s+/, "T");
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (match) {
    return `${match[1]}T${match[2]}`;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function parseAdminAgentEventSetupPatch(args: Record<string, unknown>) {
  const patch: Record<string, string> = {};
  const changedKeys: string[] = [];

  const put = (key: string, value: string) => {
    patch[key] = value;
    changedKeys.push(key);
  };

  const eventName = normalizeOptionalText(args.event_name) || normalizeOptionalText(args.name);
  if (eventName) put("event_name", eventName);

  const timeZone = normalizeOptionalText(args.event_timezone) || normalizeOptionalText(args.timezone);
  if (timeZone) put("event_timezone", normalizeTimeZone(timeZone));

  const venueName = normalizeOptionalText(args.event_venue_name) || normalizeOptionalText(args.venue_name);
  if (venueName) put("event_venue_name", venueName);

  const roomDetail =
    normalizeOptionalText(args.event_room_detail)
    || normalizeOptionalText(args.room_detail)
    || normalizeOptionalText(args.room)
    || normalizeOptionalText(args.hall);
  if (roomDetail) put("event_room_detail", roomDetail);

  const location = normalizeOptionalText(args.event_location) || normalizeOptionalText(args.location);
  if (location) put("event_location", location);

  const mapUrl = normalizeOptionalText(args.event_map_url) || normalizeOptionalText(args.map_url);
  if (mapUrl) put("event_map_url", mapUrl);

  const eventDate = normalizeDateTimeInput(args.event_date || args.start_date || args.event_start);
  if (eventDate) put("event_date", eventDate);

  const eventEndDate = normalizeDateTimeInput(args.event_end_date || args.end_date || args.event_end);
  if (eventEndDate) put("event_end_date", eventEndDate);

  const description = normalizeOptionalText(args.event_description) || normalizeOptionalText(args.description);
  if (description) put("event_description", description);

  const travel = normalizeOptionalText(args.event_travel) || normalizeOptionalText(args.travel);
  if (travel) put("event_travel", travel);

  const regLimitRaw = normalizeOptionalText(args.reg_limit) || normalizeOptionalText(args.registration_limit);
  if (regLimitRaw) {
    const parsed = parseRegistrationLimit(regLimitRaw);
    if (parsed === null) {
      if (["0", "none", "unlimited", "no-limit", "nolimit", "infinite"].includes(normalizeComparableText(regLimitRaw))) {
        put("reg_limit", "0");
      } else {
        throw new Error("registration_limit must be a positive integer or 0/unlimited");
      }
    } else {
      put("reg_limit", String(parsed));
    }
  }

  const regStart = normalizeDateTimeInput(args.reg_start || args.registration_start || args.open_date);
  if (regStart) put("reg_start", regStart);

  const regEnd = normalizeDateTimeInput(args.reg_end || args.registration_end || args.close_date);
  if (regEnd) put("reg_end", regEnd);

  const uniqueName = parseOptionalBooleanSetting(args.reg_unique_name ?? args.unique_full_name);
  if (uniqueName !== null) {
    put("reg_unique_name", uniqueName ? "1" : "0");
  }

  const confirmationEnabled = parseOptionalBooleanSetting(
    args.confirmation_email_enabled ?? args.email_enabled ?? args.enable_confirmation_email,
  );
  if (confirmationEnabled !== null) {
    put("confirmation_email_enabled", confirmationEnabled ? "1" : "0");
  }

  const confirmationSubject = normalizeOptionalText(args.confirmation_email_subject) || normalizeOptionalText(args.email_subject);
  if (confirmationSubject) {
    put("confirmation_email_subject", confirmationSubject);
  }

  return { patch, changedKeys };
}

function validateEventSettingsPatch(baseSettings: Record<string, string>, patch: Record<string, string>) {
  const merged = {
    ...baseSettings,
    ...patch,
  };
  const state = getEventState(merged);
  if (state.registrationStatus === "invalid") {
    throw new Error("Registration close date must be later than or equal to open date");
  }
  if (state.eventScheduleStatus === "invalid") {
    throw new Error("Event end time must be later than or equal to the event start time");
  }
}

function formatEventScopedTimestamp(value: string, timeZone?: string) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return String(value || "");
  try {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: normalizeTimeZone(timeZone),
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatAdminTimelineMessage(text: string) {
  const normalized = normalizeMessageTextForHistory(text);
  if (normalized) return normalized;
  const raw = String(text || "").trim();
  return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
}

function getAdminTimelineActor(row: MessageRow) {
  if (row.type === "incoming") return "user";
  const markerMatch = String(row.text || "").trim().match(/^\[([a-z-]+)\]/i);
  const marker = String(markerMatch?.[1] || "").toLowerCase();
  if (marker.startsWith("manual-")) return "admin";
  return "bot";
}

async function buildAdminAgentEventOverview(eventId: string, includeRecentRegistrations = 5) {
  const settings = await getSettingsMap(eventId);
  const event = await appDb.getEventById(eventId);
  if (!event) {
    throw new Error(`Event ${eventId} was not found`);
  }
  const state = getEventState(settings);
  const registrations = await appDb.listRegistrations(undefined, eventId);
  const total = registrations.length;
  const active = registrations.filter((row) => row.status !== "cancelled").length;
  const cancelled = registrations.filter((row) => row.status === "cancelled").length;
  const checkedIn = registrations.filter((row) => row.status === "checked-in").length;
  const duplicateNameGuard = isTruthySetting(settings.reg_unique_name ?? "1");
  const registrationLimit = parseRegistrationLimit(settings.reg_limit);
  const registrationStartLabel = formatStoredDateForDisplay(settings.reg_start || "", state.timeZone);
  const registrationEndLabel = formatStoredDateForDisplay(settings.reg_end || "", state.timeZone);
  const eventStartLabel = formatStoredDateForDisplay(settings.event_date || "", state.timeZone);
  const eventEndLabel = formatStoredDateForDisplay(settings.event_end_date || "", state.timeZone);
  const mapUrl = resolveEventMapUrlFromSettings(settings);
  const description = normalizeOptionalText(settings.event_description);
  const travel = normalizeOptionalText(settings.event_travel);
  const context = normalizeOptionalText(settings.context);
  const locationSummary = buildEventLocationSummaryFromSettings(settings);
  const locationLabel = formatEventLocationFromSettings(settings);
  const confirmationEmailEnabled = isTruthySetting(settings.confirmation_email_enabled);
  const recent = registrations.slice(0, Math.min(Math.max(0, includeRecentRegistrations), 10)).map((row) => ({
    id: row.id,
    full_name: formatRegistrationDisplayName(row),
    status: row.status,
    timestamp: row.timestamp,
    timestamp_label: formatEventScopedTimestamp(row.timestamp, settings.event_timezone),
  }));

  const summaryLines = [
    `Event ${event.id}: ${settings.event_name || event.name || "-"}`,
    `สถานะงาน: ${event.effective_status} | สถานะลงทะเบียน: ${event.registration_availability || state.registrationStatus}`,
    `เวลา: ${formatStoredDateRangeForDisplay(settings.event_date || "", settings.event_end_date || "", state.timeZone)}`,
    `สถานที่: ${locationLabel}`,
    `แผนที่: ${mapUrl || "-"}`,
    `ลงทะเบียน: ทั้งหมด ${total} | active ${active} | checked-in ${checkedIn} | cancelled ${cancelled}`,
    `กติกาลงทะเบียน: limit ${registrationLimit ?? "unlimited"} | unique-full-name ${duplicateNameGuard ? "on" : "off"} | เปิด ${registrationStartLabel} | ปิด ${registrationEndLabel}`,
    `อีเมลยืนยัน: ${confirmationEmailEnabled ? "on" : "off"}`,
  ];
  if (locationSummary.venueName) {
    summaryLines.push(`venue: ${locationSummary.venueName}`);
  }
  if (locationSummary.roomDetail) {
    summaryLines.push(`room: ${locationSummary.roomDetail}`);
  }
  if (description) {
    summaryLines.push(`รายละเอียด: ${truncateText(description, 320)}`);
  }
  if (travel) {
    summaryLines.push(`การเดินทาง: ${truncateText(travel, 320)}`);
  }
  if (context) {
    summaryLines.push(`context: ${truncateText(context, 320)}`);
  }
  if (recent.length > 0) {
    summaryLines.push("รายชื่อล่าสุด:");
    for (const row of recent) {
      summaryLines.push(`- ${row.id} • ${row.full_name} • ${row.status} • ${row.timestamp_label}`);
    }
  }

  return {
    reply: summaryLines.join("\n"),
    result: {
      event_id: eventId,
      event_name: settings.event_name || event.name || "",
      effective_status: event.effective_status,
      registration_availability: event.registration_availability || state.registrationStatus,
      timezone: state.timeZone,
      event_date: settings.event_date || "",
      event_end_date: settings.event_end_date || "",
      event_date_label: formatStoredDateRangeForDisplay(settings.event_date || "", settings.event_end_date || "", state.timeZone),
      event_start_label: eventStartLabel,
      event_end_label: eventEndLabel,
      venue_name: locationSummary.venueName,
      room_detail: locationSummary.roomDetail,
      address: locationSummary.address,
      location: locationLabel,
      map_url: mapUrl,
      description,
      travel,
      context,
      context_chars: context.length,
      rules: {
        registration_limit: registrationLimit,
        unique_full_name: duplicateNameGuard,
        registration_start: settings.reg_start || "",
        registration_end: settings.reg_end || "",
        registration_start_label: registrationStartLabel,
        registration_end_label: registrationEndLabel,
        registration_window_state: state.registrationStatus,
      },
      confirmation_email: {
        enabled: confirmationEmailEnabled,
        subject: normalizeOptionalText(settings.confirmation_email_subject),
      },
      registration: {
        total,
        active,
        checked_in: checkedIn,
        cancelled,
        remaining_seats: event.remaining_seats ?? null,
        capacity_limit: event.registration_limit ?? null,
      },
      recent_registrations: recent,
    },
    targetType: "event",
    targetId: eventId,
  };
}

async function requestAdminAgentPlan(
  message: string,
  history: ChatHistoryMessage[],
  settings: Record<string, any>,
  allowedActions: AdminAgentActionName[],
  policy: AdminAgentPolicy,
  usageContext?: LlmUsageContext,
): Promise<AdminAgentPlannerResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured in .env");
  }

  const model = (typeof settings.admin_agent_model === "string" && settings.admin_agent_model.trim())
    ? settings.admin_agent_model.trim()
    : (typeof settings.llm_model === "string" && settings.llm_model.trim())
    ? settings.llm_model.trim()
    : (typeof settings.global_llm_model === "string" && settings.global_llm_model.trim())
    ? settings.global_llm_model.trim()
    : DEFAULT_OPENROUTER_MODEL;
  const customPlannerPrompt = normalizeOptionalText(settings.admin_agent_system_prompt);
  const allowedActionSet = new Set(
    allowedActions.filter((actionName): actionName is AdminAgentActionName => ADMIN_AGENT_ACTION_SET.has(actionName)),
  );
  if (allowedActionSet.size === 0) {
    throw new Error("No Admin Agent actions are allowed by current policy");
  }
  const allowedActionText = [...allowedActionSet].join(", ");
  const basePlannerPrompt = [
    "You are the Admin Agent planner for an event registration operations system.",
    "Your user is an admin/operator, not an attendee.",
    "Use concise operational Thai when asking follow-up questions.",
    `Allowed actions only: ${allowedActionText}.`,
    "Default to the selected event scope unless the admin explicitly asks for another event.",
    policy.searchAllEvents
      ? "Cross-event search and cross-event commands are allowed."
      : "Cross-event search is disabled. Stay within the selected/default event only.",
    "Use conversation history for follow-up intent; do not ignore prior turns in the same chat session.",
    "When enough information exists, return exactly one tool call.",
    "If required fields are missing, do not call a tool and ask one short clarification question in Thai.",
    "Never invent registration IDs, sender IDs, channel IDs, emails, or counts.",
    "When matching by name, pass full_name or first_name/last_name.",
    "Use create_event when admin asks to create a new event from natural language details.",
    "Use update_event_setup to fill event detail/rules fields after event creation.",
    "Use update_event_status for live/inactive/pending/cancelled updates.",
    "Use update_event_context for writing event context notes from admin instructions.",
    "Use find_event when asked to check whether an event exists, or when event name is partial.",
    "Use search_system only when admin asks to search across the whole system.",
    "Use get_event_overview when asked for event status/time/place/map/description/travel/registration-rules summary.",
    "Use create_registration when admin asks to register a new attendee.",
    "Use view_ticket when admin asks to preview/show ticket image for admin only.",
    "Use list_registrations for list requests, and get_registration_timeline for sender chat history.",
    "Use export_registrations_csv when admin asks for CSV/Excel export or full attendee export file.",
    "If admin asks for remaining rows after a previous list, call list_registrations with offset.",
    "Use set_registration_status only when admin asks to change status of an existing registration (registered/cancelled/checked-in).",
    "Do not use set_registration_status to create a new attendee record.",
    "Use resend_ticket only when admin explicitly asks to send ticket to attendee channel; do not use it for admin preview.",
    "If admin says email should be optional for attendee input, do not auto-disable confirmation email. confirmation_email_enabled controls delivery behavior, not whether email field is optional.",
    "Use send_message_to_sender when admin asks to send a custom message to a specific user sender_id.",
    "Do not call find_registration without at least one attendee filter (registration_id, full_name, sender_id, phone, email, or query).",
    "When asked to continue a stuck chat, use retry_bot.",
  ].join("\n");
  const plannerPrompt = customPlannerPrompt
    ? `${basePlannerPrompt}\n\nCustom Planner Prompt:\n${customPlannerPrompt}`
    : basePlannerPrompt;

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: plannerPrompt,
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
            name: "create_event",
            description: "Create a new event workspace, optionally with initial status and setup fields.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string" },
                event_name: { type: "string" },
                status: { type: "string", enum: ["pending", "active", "inactive", "cancelled"] },
                event_timezone: { type: "string" },
                event_venue_name: { type: "string" },
                venue_name: { type: "string" },
                event_room_detail: { type: "string" },
                room_detail: { type: "string" },
                room: { type: "string" },
                hall: { type: "string" },
                event_location: { type: "string" },
                event_map_url: { type: "string" },
                event_date: { type: "string" },
                event_end_date: { type: "string" },
                event_description: { type: "string" },
                event_travel: { type: "string" },
                reg_limit: { type: "string" },
                reg_start: { type: "string" },
                reg_end: { type: "string" },
                reg_unique_name: { type: "boolean" },
                confirmation_email_enabled: { type: "boolean" },
                confirmation_email_subject: { type: "string" },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "update_event_setup",
            description: "Update event detail/rules fields: schedule, location, map, description, travel, registration open/close/limit, unique-name, email confirmation.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                name: { type: "string" },
                event_name: { type: "string" },
                event_timezone: { type: "string" },
                event_venue_name: { type: "string" },
                venue_name: { type: "string" },
                event_room_detail: { type: "string" },
                room_detail: { type: "string" },
                room: { type: "string" },
                hall: { type: "string" },
                event_location: { type: "string" },
                event_map_url: { type: "string" },
                map_url: { type: "string" },
                event_date: { type: "string" },
                event_end_date: { type: "string" },
                event_description: { type: "string" },
                description: { type: "string" },
                event_travel: { type: "string" },
                travel: { type: "string" },
                reg_limit: { type: "string" },
                registration_limit: { type: "string" },
                reg_start: { type: "string" },
                registration_start: { type: "string" },
                reg_end: { type: "string" },
                registration_end: { type: "string" },
                reg_unique_name: { type: "boolean" },
                unique_full_name: { type: "boolean" },
                confirmation_email_enabled: { type: "boolean" },
                confirmation_email_subject: { type: "string" },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "update_event_status",
            description: "Update event lifecycle status (pending/active/inactive/cancelled).",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                status: { type: "string", enum: ["pending", "active", "inactive", "cancelled"] },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "update_event_context",
            description: "Write event context text for the selected event, either replacing or appending.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                context: { type: "string" },
                text: { type: "string" },
                mode: { type: "string", enum: ["replace", "append"] },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "find_event",
            description: "Find events by event ID, slug, or partial event name.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
                event_id: { type: "string" },
                name: { type: "string" },
                slug: { type: "string" },
                status: { type: "string", enum: ["pending", "active", "inactive", "cancelled", "closed"] },
                registration_availability: { type: "string", enum: ["open", "not_started", "closed", "invalid", "full"] },
                registration_open_only: { type: "boolean" },
                limit: { type: "integer", minimum: 1, maximum: 20 },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "search_system",
            description: "Search across all events and registrations by free-text query.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
                include_events: { type: "boolean" },
                include_registrations: { type: "boolean" },
                status: { type: "string", enum: ["registered", "cancelled", "checked-in"] },
                limit: { type: "integer", minimum: 1, maximum: 30 },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "get_event_overview",
            description: "Get event-level overview including status, date/time, location, and registration totals.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                recent_limit: { type: "integer", minimum: 0, maximum: 10 },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "create_registration",
            description: "Create a new attendee registration in the selected event.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                full_name: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                sender_id: { type: "string" },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "find_registration",
            description: "Find registrations in the selected event by ID, full name, sender ID, phone, email, or free-text query.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                registration_id: { type: "string" },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                sender_id: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                query: { type: "string" },
                status: { type: "string", enum: ["registered", "cancelled", "checked-in"] },
                from_timestamp: { type: "string" },
                to_timestamp: { type: "string" },
                since: { type: "string" },
                until: { type: "string" },
                limit: { type: "integer", minimum: 1, maximum: 30 },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "view_ticket",
            description: "Get ticket URLs (PNG/SVG) for one registration without sending anything to attendee channels.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                registration_id: { type: "string" },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                sender_id: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                query: { type: "string" },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "list_registrations",
            description: "List recent registrations in the selected event, optionally filtered by status/date/search.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                status: { type: "string", enum: ["registered", "cancelled", "checked-in"] },
                from_timestamp: { type: "string" },
                to_timestamp: { type: "string" },
                since: { type: "string" },
                until: { type: "string" },
                query: { type: "string" },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                sender_id: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                limit: { type: "integer", minimum: 1, maximum: 50 },
                offset: { type: "integer", minimum: 0, maximum: 5000 },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "export_registrations_csv",
            description: "Export registrations from the selected event into CSV (all matched rows).",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                status: { type: "string", enum: ["registered", "cancelled", "checked-in"] },
                from_timestamp: { type: "string" },
                to_timestamp: { type: "string" },
                since: { type: "string" },
                until: { type: "string" },
                query: { type: "string" },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                sender_id: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "count_registrations",
            description: "Count registrations in the selected event, optionally by status.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                status: { type: "string", enum: ["registered", "cancelled", "checked-in"] },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "get_registration_timeline",
            description: "Get recent message timeline for one registration/sender in the selected event.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                registration_id: { type: "string" },
                sender_id: { type: "string" },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                query: { type: "string" },
                from_timestamp: { type: "string" },
                to_timestamp: { type: "string" },
                since: { type: "string" },
                until: { type: "string" },
                limit: { type: "integer", minimum: 1, maximum: 120 },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "set_registration_status",
            description: "Update one attendee registration status in the selected event.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                registration_id: { type: "string" },
                sender_id: { type: "string" },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                query: { type: "string" },
                status: { type: "string", enum: ["registered", "cancelled", "checked-in"] },
              },
              required: ["status"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "send_message_to_sender",
            description: "Send a custom outbound text message to a user sender ID on their most recent active channel in the selected event.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                sender_id: { type: "string" },
                registration_id: { type: "string" },
                external_id: { type: "string" },
                platform: { type: "string", enum: ["facebook", "line_oa", "instagram", "whatsapp", "telegram", "web_chat"] },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                query: { type: "string" },
                message: { type: "string" },
                text: { type: "string" },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "resend_ticket",
            description: "Resend ticket artifacts to a user on their existing channel.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                registration_id: { type: "string" },
                sender_id: { type: "string" },
                external_id: { type: "string" },
                platform: { type: "string", enum: ["facebook", "line_oa", "instagram", "whatsapp", "telegram", "web_chat"] },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                query: { type: "string" },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "resend_email",
            description: "Resend registration confirmation email to the attendee email in the selected event.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                registration_id: { type: "string" },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                sender_id: { type: "string" },
                query: { type: "string" },
              },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "retry_bot",
            description: "Retry the bot for a sender, using the latest failed or latest incoming turn.",
            parameters: {
              type: "object",
              properties: {
                event_id: { type: "string" },
                sender_id: { type: "string" },
                external_id: { type: "string" },
                platform: { type: "string", enum: ["facebook", "line_oa", "instagram", "whatsapp", "telegram", "web_chat"] },
                registration_id: { type: "string" },
                full_name: { type: "string" },
                first_name: { type: "string" },
                last_name: { type: "string" },
                query: { type: "string" },
              },
            },
          },
        },
      ].filter((tool) => {
        const name = String((tool as { function?: { name?: string } }).function?.name || "") as AdminAgentActionName;
        return allowedActionSet.has(name);
      }),
      tool_choice: "auto",
      parallel_tool_calls: false,
    }),
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new Error(payload?.error?.message || "OpenRouter admin planner request failed");
  }

  const usage = normalizeOpenRouterUsage(payload);
  const assistantMessage = payload?.choices?.[0]?.message || {};
  const assistantText = extractAssistantText(assistantMessage.content).trim();
  const firstToolCall = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls[0] : null;
  const callName = String(firstToolCall?.function?.name || "").trim() as AdminAgentActionName;
  const callArgs = parseToolArgs(firstToolCall?.function?.arguments);

  if (usageContext) {
    try {
      await appDb.recordLlmUsage({
        event_id: usageContext.eventId || null,
        actor_user_id: usageContext.actorUserId || null,
        source: usageContext.source,
        provider: "openrouter",
        model: String(payload?.model || model),
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        estimated_cost_usd: usage.estimated_cost_usd,
        metadata: {
          history_length: history.length,
          ...usageContext.metadata,
        },
      });
    } catch (error) {
      console.warn("Failed to record admin planner LLM usage:", error);
    }
  }

  return {
    toolCall: ADMIN_AGENT_ACTION_SET.has(callName) && allowedActionSet.has(callName)
      ? {
          name: callName,
          args: callArgs,
          source: "llm",
        }
      : null,
    assistantText,
    meta: {
      model: payload?.model || model,
      provider: "openrouter",
      usage,
    },
  };
}

async function executeAdminAgentToolCall(
  eventId: string,
  call: AdminAgentToolCall,
  rawMessage: string,
  options: { policy: AdminAgentPolicy },
) {
  switch (call.name) {
    case "create_event": {
      const eventName = normalizeOptionalText(call.args.name) || normalizeOptionalText(call.args.event_name);
      if (!eventName) {
        throw new Error("Event name is required to create event");
      }

      const created = await appDb.createEvent({ name: eventName });
      const setupPatch = parseAdminAgentEventSetupPatch(call.args);
      if (Object.keys(setupPatch.patch).length > 0) {
        const baseSettings = await getSettingsMap(created.id);
        validateEventSettingsPatch(baseSettings, setupPatch.patch);
        await appDb.upsertSettings(setupPatch.patch, created.id);
      }
      const status = normalizeAdminEventStatusInput(call.args.status);
      if (status) {
        await appDb.updateEvent(created.id, { status });
      }

      return {
        reply: `สร้างอีเวนต์ใหม่แล้ว: ${created.id} • ${eventName}`,
        result: {
          event_id: created.id,
          event_name: eventName,
          status: status || created.status,
          setup_keys: Object.keys(setupPatch.patch),
        },
        targetType: "event",
        targetId: created.id,
      };
    }
    case "update_event_setup": {
      const explicitEventId = normalizeOptionalText(call.args.event_id);
      const targetEventId = explicitEventId || eventId;
      if (!options.policy.searchAllEvents && explicitEventId && explicitEventId !== eventId) {
        throw new Error(`Cross-event setup update is disabled by policy. Current event: ${eventId}`);
      }
      const targetEvent = await appDb.getEventById(targetEventId);
      if (!targetEvent) {
        throw new Error(`Event ${targetEventId} was not found`);
      }

      const { patch, changedKeys } = parseAdminAgentEventSetupPatch(call.args);
      const nextEventName = normalizeOptionalText(call.args.event_name) || normalizeOptionalText(call.args.name);
      if (!nextEventName && changedKeys.length === 0) {
        throw new Error("No setup fields provided");
      }

      const baseSettings = await getSettingsMap(targetEventId);
      if (Object.keys(patch).length > 0) {
        validateEventSettingsPatch(baseSettings, patch);
        await appDb.upsertSettings(patch, targetEventId);
      }
      if (nextEventName && nextEventName !== targetEvent.name) {
        await appDb.updateEvent(targetEventId, { name: nextEventName });
      }

      return {
        reply: `อัปเดต setup ของ ${targetEventId} แล้ว (${Math.max(changedKeys.length, nextEventName ? 1 : 0)} รายการ)`,
        result: {
          event_id: targetEventId,
          updated_event_name: nextEventName || null,
          changed_keys: changedKeys,
        },
        targetType: "event",
        targetId: targetEventId,
      };
    }
    case "update_event_status": {
      const explicitEventId = normalizeOptionalText(call.args.event_id);
      const targetEventId = explicitEventId || eventId;
      if (!options.policy.searchAllEvents && explicitEventId && explicitEventId !== eventId) {
        throw new Error(`Cross-event status update is disabled by policy. Current event: ${eventId}`);
      }
      const status = normalizeAdminEventStatusInput(call.args.status);
      if (!status) {
        throw new Error("Valid event status is required (pending/active/inactive/cancelled)");
      }
      const updated = await appDb.updateEvent(targetEventId, { status });
      if (!updated) {
        throw new Error(`Failed to update event status for ${targetEventId}`);
      }
      return {
        reply: `ตั้งสถานะ ${targetEventId} เป็น ${status} แล้ว`,
        result: {
          event_id: targetEventId,
          status,
        },
        targetType: "event",
        targetId: targetEventId,
      };
    }
    case "update_event_context": {
      const explicitEventId = normalizeOptionalText(call.args.event_id);
      const targetEventId = explicitEventId || eventId;
      if (!options.policy.searchAllEvents && explicitEventId && explicitEventId !== eventId) {
        throw new Error(`Cross-event context update is disabled by policy. Current event: ${eventId}`);
      }
      const incomingText = normalizeOptionalText(call.args.context) || normalizeOptionalText(call.args.text);
      if (!incomingText) {
        throw new Error("Context text is required");
      }
      const mode = normalizeComparableText(call.args.mode) === "append" ? "append" : "replace";
      const currentSettings = await getSettingsMap(targetEventId);
      const currentContext = normalizeOptionalText(currentSettings.context);
      const nextContext = mode === "append" && currentContext
        ? `${currentContext}\n\n${incomingText}`
        : incomingText;
      await appDb.upsertSettings({ context: nextContext }, targetEventId);
      return {
        reply: mode === "append"
          ? `เพิ่ม context ให้ ${targetEventId} แล้ว`
          : `อัปเดต context ของ ${targetEventId} แล้ว`,
        result: {
          event_id: targetEventId,
          mode,
          context_chars: nextContext.length,
        },
        targetType: "event",
        targetId: targetEventId,
      };
    }
    case "find_event": {
      const query =
        normalizeOptionalText(call.args.query)
        || normalizeOptionalText(call.args.event_id)
        || normalizeOptionalText(call.args.name)
        || normalizeOptionalText(call.args.slug)
        || normalizeOptionalText(rawMessage);
      const limit = parsePositiveInteger(call.args.limit, 5, 20);
      const searchOptions = parseAdminAgentEventSearchOptions(call.args, rawMessage);
      const searchScope = options.policy.searchAllEvents ? undefined : { eventIds: new Set([eventId]) };
      const matches = await searchAdminAgentEvents(query, limit, searchOptions, searchScope);
      return {
        reply: buildAdminAgentFindEventReply(matches, query, limit),
        result: {
          query,
          filters: {
            effective_statuses: searchOptions.effectiveStatuses || [],
            registration_availability: searchOptions.registrationAvailability || [],
          },
          total_matches: matches.length,
          limit,
          matches: matches.map(serializeAdminAgentEvent),
        },
        targetType: matches.length === 1 ? "event" : "workspace",
        targetId: matches.length === 1 ? matches[0]!.id : "events",
      };
    }
    case "search_system": {
      if (!options.policy.searchAllEvents) {
        throw new Error("Cross-event search is disabled by Agent policy");
      }
      const query = normalizeComparableText(call.args.query || rawMessage);
      const includeEvents = parseOptionalBooleanSetting(call.args.include_events);
      const includeRegistrations = parseOptionalBooleanSetting(call.args.include_registrations);
      const limit = parsePositiveInteger(call.args.limit, 8, 30);
      const targetStatus = normalizeRegistrationStatusInput(call.args.status);
      const eventSearchOptions = parseAdminAgentEventSearchOptions(call.args, rawMessage);

      const shouldSearchEvents = includeEvents !== false && options.policy.readEvent;
      const shouldSearchRegistrations = includeRegistrations !== false && options.policy.readRegistration;
      if (!shouldSearchEvents && !shouldSearchRegistrations) {
        throw new Error("Search scope is disabled by policy (event-read and registration-read are both off)");
      }
      const eventRows = shouldSearchEvents ? await appDb.listEvents() : [];
      const eventRowMap = new Map(eventRows.map((event) => [event.id, event]));
      const eventNameMap = new Map(eventRows.map((event) => [event.id, event.name]));

      const eventMatches = shouldSearchEvents
        ? (await searchAdminAgentEvents(query, limit, eventSearchOptions)).map((candidate) =>
            eventRowMap.get(candidate.id),
          ).filter((row): row is NonNullable<typeof row> => Boolean(row))
        : [];

      const registrationMatches = shouldSearchRegistrations
        ? (await appDb.listRegistrations(undefined))
            .filter((row) => {
              if (targetStatus && row.status !== targetStatus) return false;
              if (!query) return true;
              const haystack = [
                row.id,
                row.event_id || "",
                eventNameMap.get(String(row.event_id || "")) || "",
                row.first_name,
                row.last_name,
                `${row.first_name || ""} ${row.last_name || ""}`,
                row.phone,
                row.email,
                row.sender_id,
                row.status,
              ].map(normalizeComparableText).join("\n");
              return haystack.includes(query);
            })
            .slice(0, limit)
            .map((row) => ({
              id: row.id,
              event_id: row.event_id || DEFAULT_EVENT_ID,
              event_name: eventNameMap.get(String(row.event_id || "")) || "",
              full_name: formatRegistrationDisplayName(row),
              status: row.status,
              phone: normalizeOptionalText(row.phone),
              email: normalizeOptionalText(row.email),
              timestamp: row.timestamp,
            }))
        : [];

      const replyLines = [
        query ? `ผลค้นหาทั้งระบบสำหรับ "${query}"` : "ผลค้นหาทั้งระบบล่าสุด",
        shouldSearchEvents ? `- events: ${eventMatches.length}` : "- events: skipped",
        shouldSearchRegistrations ? `- registrations: ${registrationMatches.length}` : "- registrations: skipped",
      ];
      if (eventMatches.length > 0) {
        replyLines.push("Events:");
        for (const [index, row] of eventMatches.slice(0, 5).entries()) {
          replyLines.push(`${index + 1}. ${row.id} • ${row.name} • ${row.effective_status}`);
        }
      }
      if (registrationMatches.length > 0) {
        replyLines.push("Registrations:");
        for (const [index, row] of registrationMatches.slice(0, 5).entries()) {
          replyLines.push(`${index + 1}. ${row.id} • ${row.full_name} • ${row.status} • phone ${row.phone || "-"} • email ${row.email || "-"} • ${row.event_id}`);
        }
      }

      return {
        reply: replyLines.join("\n"),
        result: {
          query,
          limit,
          status: targetStatus,
          events: eventMatches.map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            effective_status: row.effective_status,
            registration_availability: row.registration_availability || null,
          })),
          registrations: registrationMatches,
        },
        targetType: "workspace",
        targetId: "system_search",
      };
    }
    case "get_event_overview": {
      const recentLimit = parsePositiveInteger(call.args.recent_limit, 5, 10);
      return buildAdminAgentEventOverview(eventId, recentLimit);
    }
    case "find_registration": {
      const lookup = await findRegistrationsForAdminAction(eventId, call.args, rawMessage, { defaultToRecent: false });
      if (lookup.usedFilters.length === 0) {
        return {
          reply: "ระบุเงื่อนไขผู้ลงทะเบียนก่อน เช่น full name, registration_id, sender_id, phone, email หรือ query",
          result: {
            event_id: eventId,
            requires_filter: true,
          },
          targetType: "event",
          targetId: eventId,
        };
      }
      return {
        reply: buildAdminAgentFindReply(lookup.matches, lookup.totalMatches, lookup.limit, lookup.usedFilters),
        result: {
          event_id: eventId,
          total_matches: lookup.totalMatches,
          limit: lookup.limit,
          filters: lookup.usedFilters,
          matches: lookup.matches.map(serializeAdminRegistration),
        },
        targetType: "event",
        targetId: eventId,
      };
    }
    case "view_ticket": {
      const registration = await resolveSingleRegistrationForAdminAction(eventId, call.args, rawMessage);
      const ticketPngUrl = buildTicketImageUrl(registration.id, "png");
      const ticketSvgUrl = buildTicketImageUrl(registration.id, "svg");
      return {
        reply: `ตั๋วของ ${formatRegistrationDisplayName(registration)} (${registration.id})`,
        result: {
          event_id: eventId,
          registration: serializeAdminRegistration(registration),
          ticket: {
            png_url: ticketPngUrl,
            svg_url: ticketSvgUrl,
          },
        },
        targetType: "registration",
        targetId: registration.id,
      };
    }
    case "create_registration": {
      const draft = parseAdminRegistrationDraft(call.args, rawMessage);
      const missing: string[] = [];
      if (!draft.firstName) missing.push("ชื่อ");
      if (!draft.lastName) missing.push("นามสกุล");
      if (!draft.phone) missing.push("เบอร์โทร");

      if (missing.length > 0) {
        return {
          reply: `ต้องการข้อมูลเพิ่มก่อนลงทะเบียน: ${missing.join(", ")}`,
          result: {
            event_id: eventId,
            missing_fields: missing,
          },
          targetType: "event",
          targetId: eventId,
        };
      }

      const creation = await createRegistration(
        {
          sender_id: draft.senderId,
          event_id: eventId,
          first_name: draft.firstName,
          last_name: draft.lastName,
          phone: draft.phone,
          email: draft.email || "",
        },
        { source: "admin_agent_action" },
      );
      if (creation.statusCode !== 200 || typeof creation.content?.id !== "string") {
        const detail = typeof creation.content?.error === "string"
          ? creation.content.error
          : "Failed to create registration";
        throw new Error(detail);
      }

      const registrationId = String(creation.content.id || "").trim().toUpperCase();
      const registration = await getRegistrationById(registrationId);
      const ticketPngUrl = buildTicketImageUrl(registrationId, "png");
      const ticketSvgUrl = buildTicketImageUrl(registrationId, "svg");
      const attendeeLabel = registration
        ? formatRegistrationDisplayName(registration)
        : `${draft.firstName} ${draft.lastName}`.trim();

      return {
        reply: `ลงทะเบียนเรียบร้อย: ${attendeeLabel} (${registrationId})`,
        result: {
          event_id: eventId,
          registration: registration ? serializeAdminRegistration(registration) : {
            id: registrationId,
            sender_id: draft.senderId,
            event_id: eventId,
            first_name: draft.firstName,
            last_name: draft.lastName,
            phone: draft.phone,
            email: draft.email || "",
            status: "registered",
          },
          sender_id: draft.senderId,
          ticket: {
            png_url: ticketPngUrl,
            svg_url: ticketSvgUrl,
          },
        },
        targetType: "registration",
        targetId: registrationId,
      };
    }
    case "list_registrations": {
      const settings = await getSettingsMap(eventId);
      const offset = parseNonNegativeInteger(call.args.offset, 0, 5000);
      const lookup = await findRegistrationsForAdminAction(eventId, call.args, rawMessage, {
        defaultToRecent: true,
        limit: parsePositiveInteger(call.args.limit, 20, 50),
        offset,
      });
      return {
        reply: buildAdminAgentListReply(
          lookup.matches,
          lookup.totalMatches,
          lookup.limit,
          lookup.usedFilters,
          settings.event_timezone,
          lookup.offset,
        ),
        result: {
          event_id: eventId,
          total_matches: lookup.totalMatches,
          limit: lookup.limit,
          offset: lookup.offset,
          filters: lookup.usedFilters,
          registrations: lookup.matches.map(serializeAdminRegistration),
        },
        targetType: "event",
        targetId: eventId,
      };
    }
    case "export_registrations_csv": {
      const exportBundle = await buildAdminAgentRegistrationCsvBundle(eventId, call.args, rawMessage);
      return {
        reply: exportBundle.totalMatches > 0
          ? `เตรียมไฟล์ CSV แล้ว (${exportBundle.totalMatches} รายการ): ${exportBundle.filename}`
          : `ไม่มีข้อมูลสำหรับ export CSV ในอีเวนต์นี้: ${exportBundle.filename}`,
        result: {
          event_id: exportBundle.eventId,
          total_matches: exportBundle.totalMatches,
          filters: exportBundle.filters,
          filename: exportBundle.filename,
          download_url: `/api/registrations/export?event_id=${encodeURIComponent(exportBundle.eventId)}`,
        },
        targetType: "event",
        targetId: eventId,
      };
    }
    case "count_registrations": {
      const rows = await appDb.listRegistrations(undefined, eventId);
      const totals = {
        total: rows.length,
        active: rows.filter((row) => row.status !== "cancelled").length,
        registered: rows.filter((row) => row.status === "registered").length,
        checked_in: rows.filter((row) => row.status === "checked-in").length,
        cancelled: rows.filter((row) => row.status === "cancelled").length,
      };
      const status = normalizeRegistrationStatusInput(call.args.status);
      const statusCount = status ? rows.filter((row) => row.status === status).length : null;
      return {
        reply: status
          ? `จำนวนผู้ลงทะเบียนสถานะ ${status}: ${statusCount ?? 0} คน`
          : `สรุปผู้ลงทะเบียน: ทั้งหมด ${totals.total} | active ${totals.active} | registered ${totals.registered} | checked-in ${totals.checked_in} | cancelled ${totals.cancelled}`,
        result: {
          event_id: eventId,
          ...totals,
          ...(status ? { status, count: statusCount } : {}),
        },
        targetType: "event",
        targetId: eventId,
      };
    }
    case "get_registration_timeline": {
      const settings = await getSettingsMap(eventId);
      const lookupFilters = buildRegistrationLookupFilters(call.args, rawMessage);
      const limit = parsePositiveInteger(call.args.limit, 30, 120);
      const senderIdFromArgs = normalizeOptionalText(call.args.sender_id);
      let registration: RegistrationRow | null = null;
      let senderId = senderIdFromArgs;

      if (!senderId) {
        registration = await resolveSingleRegistrationForAdminAction(eventId, call.args, rawMessage);
        senderId = normalizeOptionalText(registration.sender_id);
      }
      if (!senderId) {
        throw new Error("Sender ID is required to load timeline");
      }

      let rows = await appDb.getConversationRowsForSender(senderId, limit, eventId);
      if (lookupFilters.fromMs !== null) {
        rows = rows.filter((row) => {
          const value = Date.parse(String(row.timestamp || ""));
          return Number.isFinite(value) && value >= lookupFilters.fromMs!;
        });
      }
      if (lookupFilters.toMs !== null) {
        rows = rows.filter((row) => {
          const value = Date.parse(String(row.timestamp || ""));
          return Number.isFinite(value) && value <= lookupFilters.toMs!;
        });
      }

      const timeline = rows
        .slice()
        .sort((left, right) => left.id - right.id)
        .map((row) => ({
          id: row.id,
          sender_id: row.sender_id,
          direction: row.type,
          actor: getAdminTimelineActor(row),
          timestamp: row.timestamp,
          timestamp_label: formatEventScopedTimestamp(row.timestamp, settings.event_timezone),
          text: formatAdminTimelineMessage(row.text || ""),
        }))
        .filter((row) => row.text);

      const filters: string[] = [];
      if (lookupFilters.fromMs !== null) filters.push(`from=${new Date(lookupFilters.fromMs).toISOString()}`);
      if (lookupFilters.toMs !== null) filters.push(`to=${new Date(lookupFilters.toMs).toISOString()}`);

      const targetLabel = registration
        ? `${formatRegistrationDisplayName(registration)} (${registration.id})`
        : `sender ${senderId}`;
      const replyLines = timeline.slice(-8).map((entry, index) => (
        `${index + 1}. [${entry.direction.toUpperCase()}|${entry.actor}] ${entry.timestamp_label} ${truncateText(entry.text, 140)}`
      ));
      const filterSuffix = filters.length > 0 ? ` (${filters.join(", ")})` : "";
      const reply = timeline.length > 0
        ? `Timeline สำหรับ ${targetLabel}${filterSuffix}\n${replyLines.join("\n")}`
        : `ไม่พบข้อความใน timeline สำหรับ ${targetLabel}${filterSuffix}`;

      return {
        reply,
        result: {
          event_id: eventId,
          sender_id: senderId,
          registration: registration ? serializeAdminRegistration(registration) : null,
          message_count: timeline.length,
          limit,
          filters,
          messages: timeline,
        },
        targetType: registration ? "registration" : "message_sender",
        targetId: registration?.id || senderId,
      };
    }
    case "set_registration_status": {
      const status = normalizeRegistrationStatusInput(call.args.status);
      if (!status) {
        throw new Error("Registration status is required (registered/cancelled/checked-in)");
      }
      let registration: RegistrationRow;
      try {
        registration = await resolveSingleRegistrationForAdminAction(eventId, call.args, rawMessage);
      } catch (error) {
        if (status === "registered") {
          const draft = parseAdminRegistrationDraft(call.args, rawMessage);
          if (draft.firstName && draft.lastName && draft.phone) {
            const creation = await createRegistration(
              {
                sender_id: draft.senderId,
                event_id: eventId,
                first_name: draft.firstName,
                last_name: draft.lastName,
                phone: draft.phone,
                email: draft.email || "",
              },
              { source: "admin_agent_action" },
            );
            if (creation.statusCode !== 200 || typeof creation.content?.id !== "string") {
              const detail = typeof creation.content?.error === "string"
                ? creation.content.error
                : "Failed to create registration";
              throw new Error(detail);
            }
            const createdId = String(creation.content.id || "").trim().toUpperCase();
            const created = await getRegistrationById(createdId);
            const ticketPngUrl = buildTicketImageUrl(createdId, "png");
            const ticketSvgUrl = buildTicketImageUrl(createdId, "svg");
            return {
              reply: `ลงทะเบียนเรียบร้อย: ${(created ? formatRegistrationDisplayName(created) : `${draft.firstName} ${draft.lastName}`.trim())} (${createdId})`,
              result: {
                event_id: eventId,
                registration: created ? serializeAdminRegistration(created) : {
                  id: createdId,
                  sender_id: draft.senderId,
                  event_id: eventId,
                  first_name: draft.firstName,
                  last_name: draft.lastName,
                  phone: draft.phone,
                  email: draft.email || "",
                  status: "registered",
                },
                sender_id: draft.senderId,
                ticket: {
                  png_url: ticketPngUrl,
                  svg_url: ticketSvgUrl,
                },
                upgraded_from: "set_registration_status",
              },
              targetType: "registration",
              targetId: createdId,
            };
          }
        }
        throw error;
      }
      const updated = await updateRegistrationStatusWithNotification(registration.id, status, {
        source: "admin_agent_action",
      });
      if (!updated.updated) {
        throw new Error(`Failed to update status for ${registration.id}`);
      }
      return {
        reply: `อัปเดตสถานะ ${registration.id} เป็น ${status} แล้ว`,
        result: {
          event_id: eventId,
          registration_id: registration.id,
          full_name: formatRegistrationDisplayName(registration),
          status,
        },
        targetType: "registration",
        targetId: registration.id,
      };
    }
    case "send_message_to_sender": {
      const customMessage = normalizeOptionalText(call.args.message) || normalizeOptionalText(call.args.text);
      if (!customMessage) {
        throw new Error("Message text is required to send outbound message");
      }

      let senderId = normalizeOptionalText(call.args.sender_id);
      let registration: RegistrationRow | null = null;
      if (!senderId) {
        registration = await resolveSingleRegistrationForAdminAction(eventId, call.args, rawMessage);
        senderId = normalizeOptionalText(registration.sender_id);
      }
      if (!senderId) {
        throw new Error("Sender ID is required to send outbound message");
      }

      const target = await resolveManualTargetFromRecentConversation({
        eventId,
        senderId,
        externalId: normalizeOptionalText(call.args.external_id),
        platform: normalizeChannelPlatformArg(call.args.platform),
      });
      const delivery = await sendManualOutboundText(target, customMessage);

      return {
        reply: `ส่งข้อความถึง sender ${senderId} แล้ว`,
        result: {
          event_id: eventId,
          sender_id: senderId,
          registration: registration ? serializeAdminRegistration(registration) : null,
          text: customMessage,
          target: {
            platform: target.platform,
            external_id: target.externalId,
          },
          steps: delivery.steps,
        },
        targetType: registration ? "registration" : "message_sender",
        targetId: registration?.id || senderId,
      };
    }
    case "resend_ticket": {
      const registration = await resolveSingleRegistrationForAdminAction(eventId, call.args, rawMessage);
      const senderId = normalizeOptionalText(call.args.sender_id) || normalizeOptionalText(registration.sender_id);
      if (!senderId) {
        throw new Error("Sender ID is required to resend ticket");
      }
      const target = await resolveManualTargetFromRecentConversation({
        eventId,
        senderId,
        externalId: normalizeOptionalText(call.args.external_id),
        platform: normalizeChannelPlatformArg(call.args.platform),
      });
      const resend = await resendTicketArtifactsToOutboundTarget(target, registration.id);
      const ticketPngUrl = buildTicketImageUrl(registration.id, "png");
      const ticketSvgUrl = buildTicketImageUrl(registration.id, "svg");
      return {
        reply: `ส่งตั๋วใหม่แล้ว: ${formatRegistrationDisplayName(registration)} (${registration.id})`,
        result: {
          event_id: eventId,
          registration: serializeAdminRegistration(registration),
          target: {
            platform: target.platform,
            sender_id: target.senderId,
            external_id: target.externalId,
          },
          steps: resend.steps,
          ticket: {
            png_url: ticketPngUrl,
            svg_url: ticketSvgUrl,
          },
        },
        targetType: "registration",
        targetId: registration.id,
      };
    }
    case "resend_email": {
      const registration = await resolveSingleRegistrationForAdminAction(eventId, call.args, rawMessage);
      const emailResult = await sendRegistrationConfirmationEmailManually(registration.id);
      return {
        reply: `ส่งอีเมลยืนยันใหม่แล้ว: ${emailResult.recipient_email} (${registration.id})`,
        result: {
          event_id: eventId,
          registration: serializeAdminRegistration(registration),
          recipient_email: emailResult.recipient_email,
          subject: emailResult.subject,
          delivery_id: emailResult.delivery_id,
        },
        targetType: "registration",
        targetId: registration.id,
      };
    }
    case "retry_bot": {
      let senderId = normalizeOptionalText(call.args.sender_id);
      if (!senderId) {
        const registration = await resolveSingleRegistrationForAdminAction(eventId, call.args, rawMessage);
        senderId = normalizeOptionalText(registration.sender_id);
      }
      if (!senderId) {
        throw new Error("Sender ID is required to retry bot");
      }
      const target = await resolveManualTargetFromRecentConversation({
        eventId,
        senderId,
        externalId: normalizeOptionalText(call.args.external_id),
        platform: normalizeChannelPlatformArg(call.args.platform),
      });
      const retry = await retryBotReplyForOutboundTarget(target);
      return {
        reply: `กระตุ้นบอทให้ตอบต่อแล้วสำหรับ sender ${senderId}`,
        result: {
          event_id: eventId,
          sender_id: senderId,
          target: {
            platform: target.platform,
            external_id: target.externalId,
          },
          ...retry,
        },
        targetType: "message_sender",
        targetId: senderId,
      };
    }
    default:
      throw new Error("Unsupported admin action");
  }
}

function getAdminAgentErrorStatusCode(message: string) {
  const lower = String(message || "").toLowerCase();
  if (
    lower.includes("required")
    || lower.includes("invalid")
    || lower.includes("not found")
    || lower.includes("does not belong")
    || lower.includes("multiple")
    || lower.includes("no recent")
    || lower.includes("missing")
    || lower.includes("unsupported")
    || lower.includes("disabled by agent policy")
    || lower.includes("no channel destination")
  ) {
    return 400;
  }
  return 500;
}

function summarizeAdminAgentResultForAudit(result: unknown) {
  const summary: Record<string, unknown> = {};
  if (!result || typeof result !== "object") return summary;
  const value = result as Record<string, unknown>;
  if (typeof value.event_id === "string" && value.event_id.trim()) summary.event_id = value.event_id.trim();
  if (typeof value.message_count === "number") summary.message_count = value.message_count;
  if (typeof value.total_matches === "number") summary.total_matches = value.total_matches;
  if (typeof value.total === "number") summary.total = value.total;
  if (typeof value.sender_id === "string" && value.sender_id.trim()) summary.sender_id = value.sender_id.trim();
  if (value.registration && typeof value.registration === "object") {
    const registration = value.registration as Record<string, unknown>;
    if (typeof registration.id === "string" && registration.id.trim()) {
      summary.registration_id = registration.id.trim();
    }
  }
  if (value.target && typeof value.target === "object") {
    const target = value.target as Record<string, unknown>;
    if (typeof target.platform === "string" && target.platform.trim()) {
      summary.target_platform = target.platform.trim();
    }
    if (typeof target.external_id === "string" && target.external_id.trim()) {
      summary.target_external_id = target.external_id.trim();
    }
  }
  return summary;
}

function extractAdminAgentTicketUrls(result: unknown) {
  if (!result || typeof result !== "object") return { pngUrl: "", svgUrl: "" };
  const ticket = (result as Record<string, unknown>).ticket;
  if (!ticket || typeof ticket !== "object") return { pngUrl: "", svgUrl: "" };
  const ticketData = ticket as Record<string, unknown>;
  const pngUrl = typeof ticketData.png_url === "string" ? ticketData.png_url.trim() : "";
  const svgUrl = typeof ticketData.svg_url === "string" ? ticketData.svg_url.trim() : "";
  return { pngUrl, svgUrl };
}

type AdminAgentGlobalSettings = {
  enabled: boolean;
  systemPrompt: string;
  model: string;
  defaultEventId: string;
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  telegramAllowedChatIdsRaw: string;
  notificationEnabled: boolean;
  notificationOnRegistrationCreated: boolean;
  notificationOnRegistrationStatusChanged: boolean;
  notificationScope: "all" | "event";
  notificationEventId: string;
};

async function getAdminAgentGlobalSettings(): Promise<AdminAgentGlobalSettings> {
  const [
    enabledRaw,
    systemPromptRaw,
    modelRaw,
    defaultEventIdRaw,
    telegramEnabledRaw,
    telegramBotTokenRaw,
    telegramWebhookSecretRaw,
    telegramAllowedChatIdsRaw,
    notificationEnabledRaw,
    notificationOnRegistrationCreatedRaw,
    notificationOnRegistrationStatusChangedRaw,
    notificationScopeRaw,
    notificationEventIdRaw,
  ] = await Promise.all([
    appDb.getSettingValue("admin_agent_enabled"),
    appDb.getSettingValue("admin_agent_system_prompt"),
    appDb.getSettingValue("admin_agent_model"),
    appDb.getSettingValue("admin_agent_default_event_id"),
    appDb.getSettingValue("admin_agent_telegram_enabled"),
    appDb.getSettingValue("admin_agent_telegram_bot_token"),
    appDb.getSettingValue("admin_agent_telegram_webhook_secret"),
    appDb.getSettingValue("admin_agent_telegram_allowed_chat_ids"),
    appDb.getSettingValue("admin_agent_notification_enabled"),
    appDb.getSettingValue("admin_agent_notification_on_registration_created"),
    appDb.getSettingValue("admin_agent_notification_on_registration_status_changed"),
    appDb.getSettingValue("admin_agent_notification_scope"),
    appDb.getSettingValue("admin_agent_notification_event_id"),
  ]);

  return {
    enabled: isTruthySetting(enabledRaw),
    systemPrompt: normalizeOptionalText(systemPromptRaw),
    model: normalizeOptionalText(modelRaw),
    defaultEventId: normalizeOptionalText(defaultEventIdRaw) || DEFAULT_EVENT_ID,
    telegramEnabled: isTruthySetting(telegramEnabledRaw),
    telegramBotToken: normalizeOptionalText(telegramBotTokenRaw),
    telegramWebhookSecret: normalizeOptionalText(telegramWebhookSecretRaw),
    telegramAllowedChatIdsRaw: String(telegramAllowedChatIdsRaw || ""),
    notificationEnabled: isTruthySetting(notificationEnabledRaw),
    notificationOnRegistrationCreated: isTruthySetting(notificationOnRegistrationCreatedRaw ?? "1"),
    notificationOnRegistrationStatusChanged: isTruthySetting(notificationOnRegistrationStatusChangedRaw ?? "1"),
    notificationScope: normalizeComparableText(notificationScopeRaw) === "event" ? "event" : "all",
    notificationEventId: normalizeOptionalText(notificationEventIdRaw),
  };
}

function parseAdminAgentTelegramAllowedChatIds(rawValue: string) {
  return new Set(
    String(rawValue || "")
      .split(/[\s,\n\r]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function normalizeAdminAgentTelegramUpdate(body: any) {
  const message = body?.message || body?.edited_message;
  const chatId = message?.chat?.id;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (!chatId || !text) {
    return null;
  }
  return {
    updateId: Number(body?.update_id || 0) || 0,
    chatId: String(chatId).trim(),
    text,
    messageId: Number(message?.message_id || 0) || 0,
  };
}

async function sendTelegramTextWithBotToken(botToken: string, chatId: string, text: string) {
  const token = normalizeOptionalText(botToken);
  if (!token) {
    throw new Error("Admin Agent Telegram bot token is missing");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: normalizeLineText(text),
      disable_web_page_preview: true,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.description || "Failed to send Telegram message");
  }
  return payload;
}

async function sendTelegramPhotoWithBotToken(botToken: string, chatId: string, photoUrl: string, caption?: string) {
  const token = normalizeOptionalText(botToken);
  if (!token) {
    throw new Error("Admin Agent Telegram bot token is missing");
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    photo: normalizeOptionalText(photoUrl),
  };
  const safeCaption = normalizeOptionalText(caption);
  if (safeCaption) {
    body.caption = normalizeLineText(safeCaption);
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.description || "Failed to send Telegram photo");
  }
  return payload;
}

async function sendTelegramDocumentWithBotToken(
  botToken: string,
  chatId: string,
  filename: string,
  content: string,
  caption?: string,
) {
  const token = normalizeOptionalText(botToken);
  if (!token) {
    throw new Error("Admin Agent Telegram bot token is missing");
  }

  const formData = new FormData();
  formData.set("chat_id", chatId);
  formData.set("document", new Blob([content], { type: "text/csv;charset=utf-8" }), filename);
  const safeCaption = normalizeOptionalText(caption);
  if (safeCaption) {
    formData.set("caption", normalizeLineText(safeCaption));
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.description || "Failed to send Telegram document");
  }
  return payload;
}

function canNotifyAdminAgentForEvent(settings: AdminAgentGlobalSettings, eventId: string) {
  if (settings.notificationScope !== "event") return true;
  const targetEventId = normalizeOptionalText(settings.notificationEventId) || settings.defaultEventId || DEFAULT_EVENT_ID;
  return normalizeOptionalText(targetEventId) === normalizeOptionalText(eventId);
}

function formatAdminAgentRegistrationNotificationText(options: {
  kind: "registration_created" | "registration_status_changed";
  eventId: string;
  eventName: string;
  registration: RegistrationRow;
  previousStatus?: RegistrationStatus | null;
  source: string;
  observedAtLabel: string;
}) {
  const name = formatRegistrationDisplayName(options.registration);
  const phone = normalizeOptionalText(options.registration.phone) || "-";
  const email = normalizeOptionalText(options.registration.email) || "-";
  const baseLines = [
    "Admin Agent Notification",
    options.kind === "registration_created" ? "ประเภท: ลงทะเบียนใหม่" : "ประเภท: เปลี่ยนสถานะลงทะเบียน",
    `อีเวนต์: ${options.eventName} (${options.eventId})`,
    `ผู้ลงทะเบียน: ${name}`,
    `Registration ID: ${options.registration.id}`,
    `สถานะปัจจุบัน: ${options.registration.status}`,
    `โทรศัพท์: ${phone}`,
    `อีเมล: ${email}`,
  ];
  if (options.kind === "registration_status_changed" && options.previousStatus) {
    baseLines.push(`สถานะเดิม: ${options.previousStatus}`);
  }
  baseLines.push(`แหล่งที่มา: ${options.source}`);
  baseLines.push(`เวลา: ${options.observedAtLabel}`);
  return baseLines.join("\n");
}

async function sendAdminAgentRegistrationNotification(options: {
  kind: "registration_created" | "registration_status_changed";
  registration: RegistrationRow;
  previousStatus?: RegistrationStatus | null;
  source?: string;
  observedAt?: string;
}) {
  try {
    const eventId = normalizeOptionalText(options.registration.event_id) || DEFAULT_EVENT_ID;
    const settings = await getAdminAgentGlobalSettings();
    if (!settings.enabled || !settings.notificationEnabled) return;
    if (options.kind === "registration_created" && !settings.notificationOnRegistrationCreated) return;
    if (options.kind === "registration_status_changed" && !settings.notificationOnRegistrationStatusChanged) return;
    if (!canNotifyAdminAgentForEvent(settings, eventId)) return;
    if (!settings.telegramEnabled || !settings.telegramBotToken) return;

    const recipients = [...parseAdminAgentTelegramAllowedChatIds(settings.telegramAllowedChatIdsRaw)];
    if (recipients.length === 0) return;

    const [event, eventSettings] = await Promise.all([
      appDb.getEventById(eventId),
      getSettingsMap(eventId),
    ]);
    const eventName = normalizeOptionalText(event?.name) || eventId;
    const observedAtRaw = normalizeOptionalText(options.observedAt)
      || (options.kind === "registration_created" ? normalizeOptionalText(options.registration.timestamp) : "")
      || new Date().toISOString();
    const observedAtLabel = formatEventScopedTimestamp(observedAtRaw, eventSettings.event_timezone);
    const text = formatAdminAgentRegistrationNotificationText({
      kind: options.kind,
      eventId,
      eventName,
      registration: options.registration,
      previousStatus: options.previousStatus || null,
      source: normalizeOptionalText(options.source) || "system",
      observedAtLabel,
    });

    await Promise.all(
      recipients.map((chatId) => sendTelegramTextWithBotToken(settings.telegramBotToken, chatId, text)),
    );
  } catch (error) {
    console.error("Failed to send admin agent registration notification:", error);
  }
}

async function runAdminAgentCommand(options: {
  message: string;
  eventId: string;
  history?: ChatHistoryMessage[];
  settings?: Record<string, any>;
  actorUserId?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
}) {
  const requestedEventId = normalizeOptionalText(options.eventId) || DEFAULT_EVENT_ID;
  const parsedCommand = parseAdminAgentEventOverride(options.message, requestedEventId);
  const message = normalizeOptionalText(parsedCommand.command);
  if (!message) {
    throw new Error("Message is required");
  }

  const providedSettings = options.settings && typeof options.settings === "object"
    ? options.settings as Record<string, any>
    : null;
  const requestedSettings = await getSettingsMap(requestedEventId);
  const requestedPolicy = parseAdminAgentPolicy({
    ...requestedSettings,
    ...(providedSettings || {}),
  });

  const overrideEventId = normalizeOptionalText(parsedCommand.eventId);
  const hasCrossEventOverride = Boolean(overrideEventId) && overrideEventId !== requestedEventId;
  if (hasCrossEventOverride) {
    if (!requestedPolicy.searchAllEvents) {
      throw new Error(`Cross-event override is disabled by Agent policy. Current event: ${requestedEventId}`);
    }
  }

  const scopedEventId = await resolveAdminAgentEventId(parsedCommand.eventId || requestedEventId, {
    allowedEventId: requestedEventId,
    allowCrossEventSearch: requestedPolicy.searchAllEvents,
  });
  const eventSettings = await getSettingsMap(scopedEventId);
  const settings = {
    ...eventSettings,
    ...(providedSettings || {}),
  };
  const policy = parseAdminAgentPolicy(settings);
  const allowedActions = getAllowedAdminAgentActions(policy);
  if (allowedActions.length === 0) {
    throw new Error("Admin Agent has no allowed actions. Enable at least one action in Advanced Policy.");
  }
  const allowedActionSet = new Set<AdminAgentActionName>(allowedActions);
  const ruleToolCall = inferAdminAgentRuleToolCall(message, allowedActionSet);
  if (ruleToolCall) {
    const action: AdminAgentToolCall = {
      ...ruleToolCall,
      args: {
        ...ruleToolCall.args,
        event_id: scopedEventId,
      },
    };
    const execution = await executeAdminAgentToolCall(scopedEventId, action, message, {
      policy,
    });
    appendAdminAgentSharedHistory("user", message);
    appendAdminAgentSharedHistory("model", `[${action.name}] ${execution.reply}`);
    return {
      reply: execution.reply,
      action,
      result: execution.result as Record<string, unknown>,
      meta: {
        model: "rule-based",
        provider: "rule",
      },
      eventId: scopedEventId,
      targetType: execution.targetType || "event",
      targetId: execution.targetId || scopedEventId,
    };
  }

  mergeAdminAgentSharedHistory(options.history || []);
  const plannerHistory = getAdminAgentPlannerHistory();

  const plan = await requestAdminAgentPlan(
    message,
    plannerHistory,
    settings,
    allowedActions,
    policy,
    {
      eventId: scopedEventId,
      actorUserId: options.actorUserId || null,
      source: options.source,
      metadata: {
        request_event_id: requestedEventId,
        parsed_event_id: parsedCommand.eventId || requestedEventId,
        ...options.metadata,
      },
    },
  );

  if (!plan.toolCall) {
    const clarificationReply = plan.assistantText || "ขอรายละเอียดเพิ่มอีกนิด เพื่อให้ผมสั่งงานต่อได้ถูกต้อง";
    appendAdminAgentSharedHistory("user", message);
    appendAdminAgentSharedHistory("model", clarificationReply);
    return {
      reply: clarificationReply,
      action: null as AdminAgentToolCall | null,
      result: null as Record<string, unknown> | null,
      meta: plan.meta,
      eventId: scopedEventId,
      targetType: "event",
      targetId: scopedEventId,
    };
  }

  ensureAdminActionAllowed(plan.toolCall.name, allowedActionSet);

  const actionUsesEventScope = !new Set<AdminAgentActionName>(["find_event", "search_system", "create_event"]).has(plan.toolCall.name);
  let executionEventId = scopedEventId;
  if (actionUsesEventScope) {
    const actionEventId = normalizeOptionalText(plan.toolCall.args.event_id);
    if (actionEventId) {
      executionEventId = await resolveAdminAgentEventId(actionEventId, {
        allowedEventId: scopedEventId,
        allowCrossEventSearch: policy.searchAllEvents,
      });
    }
  }

  const action: AdminAgentToolCall = actionUsesEventScope
    ? {
        ...plan.toolCall,
        args: {
          ...plan.toolCall.args,
          event_id: executionEventId,
        },
      }
    : plan.toolCall;

  const execution = await executeAdminAgentToolCall(executionEventId, action, message, {
    policy,
  });
  appendAdminAgentSharedHistory("user", message);
  appendAdminAgentSharedHistory("model", action ? `[${action.name}] ${execution.reply}` : execution.reply);
  return {
    reply: execution.reply,
    action,
    result: execution.result as Record<string, unknown>,
    meta: plan.meta,
    eventId: actionUsesEventScope ? executionEventId : scopedEventId,
    targetType: execution.targetType || "event",
    targetId: execution.targetId || (actionUsesEventScope ? executionEventId : scopedEventId),
  };
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

function maskLineDebugValue(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

type LineBotProfile = {
  userId: string;
  basicId: string;
  displayName: string;
};

async function fetchLineBotProfile(accessToken: string): Promise<LineBotProfile> {
  const trimmedToken = String(accessToken || "").trim();
  if (!trimmedToken) {
    throw new Error("LINE channel access token is not configured");
  }

  const response = await fetch("https://api.line.me/v2/bot/info", {
    headers: {
      Authorization: `Bearer ${trimmedToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : `LINE bot info lookup failed with status ${response.status}`;
    throw new Error(detail);
  }

  const userId = String(payload?.userId || "").trim();
  if (!userId) {
    throw new Error("LINE bot info lookup returned no userId");
  }

  return {
    userId,
    basicId: String(payload?.basicId || "").trim(),
    displayName: String(payload?.displayName || "").trim(),
  };
}

async function buildLineWebhookDebugContext() {
  const channels = await appDb.listChannelAccounts("line_oa");
  return channels.slice(0, 8).map((channel) => ({
    id: channel.id,
    external_id: maskLineDebugValue(channel.external_id),
    display_name: channel.display_name,
    event_id: channel.event_id,
    is_active: channel.is_active,
    has_access_token: Boolean(channel.access_token),
    has_channel_secret: Boolean(String(safeParseChannelConfig(channel.config_json).channel_secret || "").trim()),
  }));
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

  const mapUrl = resolveEventMapUrlFromSettings(settings);
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
      user_agent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    },
  });
}

function formatTicketDate(startValue: string, endValue = "", timeZone?: string) {
  return formatStoredDateRangeForDisplay(startValue, endValue, normalizeTimeZone(timeZone));
}

function tokenizeForDocumentMatch(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function computeLexicalKnowledgeScore(
  document: { title: string; source_url?: string | null },
  chunk: { content: string },
  message: string,
) {
  const normalizedMessage = String(message || "").trim().toLowerCase();
  const tokens = tokenizeForDocumentMatch(message);
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

  return score;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return null;

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (!leftMagnitude || !rightMagnitude) return null;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

type KnowledgeMatch = {
  document: { id: string; title: string; content: string; source_type: string; source_url?: string | null; is_active: boolean };
  chunk: EventDocumentChunkEmbeddingRow;
  index: number;
  score: number;
  lexical_score: number;
  vector_score: number | null;
  strategy: "lexical" | "vector" | "hybrid";
};

async function rankKnowledgeMatches(
  documents: Array<{ id: string; title: string; content: string; source_type: string; source_url?: string | null; is_active: boolean }>,
  chunks: EventDocumentChunkEmbeddingRow[],
  message: string,
) {
  const activeDocuments = documents.filter((document) => document.is_active);
  if (!activeDocuments.length) {
    return {
      matches: [] as KnowledgeMatch[],
      mode: "none" as const,
      vector_ready_chunk_count: 0,
      query_embedding_model: null,
    };
  }

  const documentMap = new Map(activeDocuments.map((document) => [document.id, document]));
  const candidateChunks = chunks.filter((chunk) => documentMap.has(chunk.document_id));
  if (!candidateChunks.length) {
    return {
      matches: [] as KnowledgeMatch[],
      mode: "none" as const,
      vector_ready_chunk_count: 0,
      query_embedding_model: null,
    };
  }

  const embeddingModel = getEmbeddingModelName();
  const vectorReadyChunks = candidateChunks.filter((chunk) =>
    chunk.embedding_status === "ready"
    && chunk.embedding_model === embeddingModel
    && Array.isArray(chunk.embedding_vector)
    && chunk.embedding_vector.length > 0,
  );

  let queryVector: number[] | null = null;
  if (String(message || "").trim() && vectorReadyChunks.length > 0) {
    try {
      queryVector = (await requestOpenRouterEmbeddings(
        [message],
        {
          source: "knowledge_query_embedding",
          metadata: {
            active_document_count: activeDocuments.length,
            vector_ready_chunk_count: vectorReadyChunks.length,
          },
        },
      ))[0] || null;
    } catch (error) {
      console.error("Falling back to lexical retrieval because query embedding failed:", error);
    }
  }

  const matches = candidateChunks
    .map((chunk, index) => {
      const document = documentMap.get(chunk.document_id)!;
      const lexicalScore = computeLexicalKnowledgeScore(document, chunk, message);
      const vectorScore = queryVector && chunk.embedding_vector
        ? cosineSimilarity(queryVector, chunk.embedding_vector)
        : null;
      const vectorBoost = vectorScore === null ? 0 : Math.max(vectorScore, 0) * 10;
      const score = lexicalScore + vectorBoost;
      const strategy = vectorScore !== null && lexicalScore > 0
        ? "hybrid"
        : vectorScore !== null
        ? "vector"
        : "lexical";

      return {
        document,
        chunk,
        index,
        score,
        lexical_score: lexicalScore,
        vector_score: vectorScore,
        strategy,
      } satisfies KnowledgeMatch;
    })
    .sort((left, right) => (right.score - left.score) || (right.lexical_score - left.lexical_score) || (left.index - right.index));

  return {
    matches,
    mode: queryVector ? "hybrid" as const : "lexical" as const,
    vector_ready_chunk_count: vectorReadyChunks.length,
    query_embedding_model: queryVector ? embeddingModel : null,
  };
}

function buildKnowledgeContextFromMatches(matches: KnowledgeMatch[]) {
  const selected = matches
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

async function buildKnowledgeContext(
  documents: Array<{ id: string; title: string; content: string; source_type: string; source_url?: string | null; is_active: boolean }>,
  chunks: EventDocumentChunkEmbeddingRow[],
  message: string,
) {
  const rankedChunks = await rankKnowledgeMatches(documents, chunks, message);
  return buildKnowledgeContextFromMatches(rankedChunks.matches);
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
  const location = formatEventLocationFromSettings(settings);
  const eventName = escapeXml(String(settings.event_name || "Event Ticket").trim() || "Event Ticket");
  const attendeeName = escapeXml(`${reg.first_name || ""} ${reg.last_name || ""}`.trim() || "-");
  const registrationId = escapeXml(reg.id);
  const escapedLocation = escapeXml(location);
  const eventDate = escapeXml(formatTicketDate(settings.event_date || "", settings.event_end_date || "", timeZone));
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
          <p class="value-sm">${escapedLocation}</p>
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
  const eventDate = formatTicketDate(settings.event_date || "", settings.event_end_date || "", timeZone);
  const location = formatEventLocationFromSettings(settings);

  return [
    "ลงทะเบียนสำเร็จแล้ว ✅",
    `ชื่อ: ${fullName}`,
    `รหัสตั๋ว: ${reg.id}`,
    `วันเวลา: ${eventDate}`,
    `สถานที่: ${location}`,
    "กรุณาเก็บข้อความนี้และรูปตั๋วไว้สำหรับเช็กอิน",
  ].join("\n");
}

function isTruthySetting(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function looksLikeEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function renderRegistrationConfirmationSubject(
  template: string,
  registration: RegistrationRow,
  settings: Record<string, string>,
) {
  const fullName = `${registration.first_name || ""} ${registration.last_name || ""}`.trim();
  const eventName = String(settings.event_name || "Event").trim() || "Event";
  const eventDate = formatTicketDate(settings.event_date || "", settings.event_end_date || "", normalizeTimeZone(settings.event_timezone));
  const source = String(template || "").trim() || "Your registration for {{event_name}}";

  return source
    .replace(/\{\{\s*event_name\s*\}\}/gi, eventName)
    .replace(/\{\{\s*registration_id\s*\}\}/gi, registration.id)
    .replace(/\{\{\s*full_name\s*\}\}/gi, fullName || registration.id)
    .replace(/\{\{\s*event_date\s*\}\}/gi, eventDate)
    .trim();
}

function buildRegistrationConfirmationEmailContent(
  registration: RegistrationRow,
  settings: Record<string, string>,
  subject: string,
) {
  const eventName = String(settings.event_name || "Event").trim() || "Event";
  const fullName = `${registration.first_name || ""} ${registration.last_name || ""}`.trim() || "-";
  const timeZone = normalizeTimeZone(settings.event_timezone);
  const eventDate = formatTicketDate(settings.event_date || "", settings.event_end_date || "", timeZone);
  const location = formatEventLocationFromSettings(settings);
  const mapUrl = resolveEventMapUrlFromSettings(settings);
  const travel = buildEventLocationSummaryFromSettings(settings).travelInfo;
  const ticketPngUrl = buildTicketImageUrl(registration.id, "png");
  const ticketSvgUrl = buildTicketImageUrl(registration.id, "svg");
  const ticketUrl = ticketPngUrl || ticketSvgUrl || "";
  const escapedSubject = escapeXml(subject);
  const escapedEventName = escapeXml(eventName);
  const escapedFullName = escapeXml(fullName);
  const escapedRegistrationId = escapeXml(registration.id);
  const escapedEventDate = escapeXml(eventDate);
  const escapedLocation = escapeXml(location);
  const escapedMapUrl = escapeXml(mapUrl);
  const escapedTravel = escapeXml(travel);
  const escapedTicketUrl = escapeXml(ticketUrl);

  const textLines = [
    "Registration confirmed",
    "",
    `Event: ${eventName}`,
    `Name: ${fullName}`,
    `Registration ID: ${registration.id}`,
    `Date: ${eventDate}`,
    `Location: ${location}`,
    mapUrl ? `Map: ${mapUrl}` : "",
    travel ? `Travel: ${travel}` : "",
    ticketUrl ? `Ticket: ${ticketUrl}` : "",
  ].filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f3f6fb;font-family:'Noto Sans Thai',system-ui,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:24px;overflow:hidden;">
      <div style="padding:24px 24px 18px;background:linear-gradient(135deg,#2857f0 0%,#3567f6 100%);color:#ffffff;">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Registration confirmed</p>
        <h1 style="margin:0;font-size:28px;line-height:1.2;">${escapedEventName}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:16px;">Hello ${escapedFullName}, your registration is confirmed.</p>
        <div style="border:1px solid #dbe4f0;border-radius:18px;padding:16px 18px;background:#f8fbff;">
          <p style="margin:0 0 8px;"><strong>Registration ID:</strong> ${escapedRegistrationId}</p>
          <p style="margin:0 0 8px;"><strong>Date:</strong> ${escapedEventDate}</p>
          <p style="margin:0;"><strong>Location:</strong> ${escapedLocation}</p>
        </div>
        ${ticketPngUrl ? `<div style="margin-top:18px;"><img src="${escapedTicketUrl}" alt="Ticket ${escapedRegistrationId}" style="display:block;width:100%;max-width:360px;border-radius:18px;border:1px solid #dbe4f0;" /></div>` : ""}
        ${ticketUrl ? `<p style="margin:18px 0 0;"><a href="${escapedTicketUrl}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#2857f0;color:#ffffff;text-decoration:none;font-weight:700;">Open Ticket</a></p>` : ""}
        ${mapUrl ? `<p style="margin:18px 0 0;"><a href="${escapedMapUrl}" style="color:#2857f0;">Open Map</a></p>` : ""}
        ${travel ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#334155;"><strong>Travel:</strong> ${escapedTravel}</p>` : ""}
      </div>
      <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
        ${escapedSubject}
      </div>
    </div>
  </body>
</html>`;

  return {
    text: textLines.join("\n"),
    html,
    provider: "resend",
  };
}

async function sendResendEmail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.EMAIL_FROM || "").trim();
  const replyTo = String(process.env.EMAIL_REPLY_TO || "").trim();
  if (!apiKey || !from) {
    throw new Error("Email service is not configured (missing RESEND_API_KEY or EMAIL_FROM)");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [options.to],
      subject: options.subject,
      text: options.text,
      html: options.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(payload?.message || payload?.error || payload?.name || "Failed to send email confirmation"),
    );
  }

  return payload;
}

async function sendRegistrationConfirmationEmailIfNeeded(registrationId: string) {
  const registration = await getRegistrationById(registrationId);
  if (!registration) return;

  const email = String(registration.email || "").trim();
  if (!looksLikeEmailAddress(email)) return;

  const eventId = String(registration.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
  const settings = await getSettingsMap(eventId);
  if (!isTruthySetting(settings.confirmation_email_enabled)) return;

  const subject = renderRegistrationConfirmationSubject(settings.confirmation_email_subject, registration, settings);
  const delivery = await appDb.createRegistrationEmailDelivery({
    registration_id: registration.id,
    event_id: eventId,
    recipient_email: email,
    kind: "confirmation",
    subject,
    provider: "resend",
  });
  if (!delivery) return;

  try {
    const content = buildRegistrationConfirmationEmailContent(registration, settings, subject);
    await sendResendEmail({
      to: email,
      subject,
      text: content.text,
      html: content.html,
    });
    await appDb.markRegistrationEmailDeliverySent(delivery.id, content.provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appDb.markRegistrationEmailDeliveryFailed(delivery.id, message, "resend");
    console.error(`Failed to send confirmation email for registration ${registration.id}:`, error);
  }
}

function renderTicketSvg(reg: RegistrationRow, settings: Record<string, string>, qrDataUrl: string) {
  const timeZone = normalizeTimeZone(settings.event_timezone);
  const locationLabel = formatEventLocationFromSettings(settings);
  const eventNameLines = wrapTextLines(settings.event_name || "Event Ticket", 18, 2).map(escapeXml);
  const locationLines = wrapTextLines(locationLabel, 18, 2).map(escapeXml);
  const eventDateLines = wrapTextLines(
    formatTicketDate(settings.event_date || "", settings.event_end_date || "", timeZone),
    18,
    2,
  ).map(escapeXml);
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

function normalizeMessageTextForHistory(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (/^\[line:[a-z-]+\]/i.test(raw)) {
    return "";
  }
  const markerMatch = raw.match(/^\[([a-z-]+)\]\s*(.*)$/i);
  if (!markerMatch) {
    return raw;
  }

  const marker = markerMatch[1].toLowerCase();
  const detail = String(markerMatch[2] || "").trim();
  if (marker === "manual-reply") {
    return detail;
  }
  if (
    marker === "ticket-summary"
    || marker === "ticket-image-png"
    || marker === "ticket-image-svg"
    || marker === "ticket-link"
    || marker === "map-link"
    || marker === "manual-ticket-summary"
    || marker === "manual-ticket-image-png"
    || marker === "manual-ticket-image-svg"
    || marker === "manual-ticket-link"
    || marker === "manual-map-link"
  ) {
    return "";
  }
  return raw;
}

async function getMessageHistoryForSender(senderId: string, limit = 12, eventId?: string): Promise<ChatHistoryMessage[]> {
  const rows = await appDb.getMessageHistoryRows(senderId, limit, eventId);

  return rows
    .reverse()
    .map((row) => ({
      role: (row.type === "incoming" ? "user" : "model") as ChatHistoryMessage["role"],
      text: normalizeMessageTextForHistory(row.text || ""),
    }))
    .filter((row) => row.text)
    .map((row) => ({
      role: row.role,
      parts: [{ text: row.text }],
    }));
}

async function createRegistration(input: RegistrationInput, options?: { source?: string }) {
  const result = await appDb.createRegistration(input);
  if (result.statusCode === 200 && typeof result.content.id === "string") {
    const registrationId = String(result.content.id).trim().toUpperCase();
    void (async () => {
      const registration = await getRegistrationById(registrationId);
      if (!registration) return;
      await sendAdminAgentRegistrationNotification({
        kind: "registration_created",
        registration,
        source: options?.source || "registration_create",
      });
    })().catch((error) => {
      console.error(`Failed to send registration-created notification for ${registrationId}:`, error);
    });
    void sendRegistrationConfirmationEmailIfNeeded(registrationId).catch((error) => {
      console.error(`Failed to queue confirmation email for registration ${registrationId}:`, error);
    });
  }
  return result;
}

async function updateRegistrationStatusWithNotification(
  id: unknown,
  status: RegistrationStatus,
  options?: { source?: string },
) {
  const registrationId = String(id || "").trim().toUpperCase();
  if (!registrationId) {
    return { updated: false, registration: null as RegistrationRow | null, previousStatus: null as RegistrationStatus | null };
  }

  const before = await getRegistrationById(registrationId);
  const updated = await appDb.updateRegistrationStatus(registrationId, status);
  if (!updated) {
    return { updated: false, registration: null as RegistrationRow | null, previousStatus: before?.status || null };
  }

  const after = await getRegistrationById(registrationId);
  const registration = after || (before ? { ...before, status } : null);
  const previousStatus = before?.status || null;
  if (registration && previousStatus && previousStatus !== registration.status) {
    void sendAdminAgentRegistrationNotification({
      kind: "registration_status_changed",
      registration,
      previousStatus,
      source: options?.source || "registration_status_update",
      observedAt: new Date().toISOString(),
    });
  }

  return { updated: true, registration, previousStatus };
}

async function cancelRegistration(id: unknown, options?: { source?: string }) {
  const registrationId = String(id || "").trim().toUpperCase();
  if (!registrationId) {
    return { statusCode: 400, content: { error: "Registration ID is required" } };
  }

  const result = await updateRegistrationStatusWithNotification(registrationId, "cancelled", {
    source: options?.source || "registration_cancel",
  });
  if (result.updated) {
    return { statusCode: 200, content: { status: "success" } };
  }
  return { statusCode: 404, content: { error: "Registration not found" } };
}

function normalizeOpenRouterUsage(payload: any) {
  const usage = payload?.usage && typeof payload.usage === "object" ? payload.usage : {};
  const promptTokens = Math.max(0, Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0));
  const completionTokens = Math.max(0, Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0));
  const totalTokens = Math.max(0, Number(usage?.total_tokens ?? promptTokens + completionTokens));
  const estimatedCostUsd = Math.max(0, Number(usage?.cost ?? payload?.cost ?? 0));

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    estimated_cost_usd: estimatedCostUsd,
  };
}

async function requestOpenRouterChat(
  message: string,
  history: ChatHistoryMessage[],
  settings: Record<string, any>,
  eventStatus = "active",
  knowledgeContext = "",
  usageContext?: LlmUsageContext,
  eventId?: string,
): Promise<NormalizedChatResponse> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured in .env");
  }

  const model = (typeof settings.llm_model === "string" && settings.llm_model.trim())
    ? settings.llm_model.trim()
    : (typeof settings.global_llm_model === "string" && settings.global_llm_model.trim())
    ? settings.global_llm_model.trim()
    : DEFAULT_OPENROUTER_MODEL;
  const capacitySnapshot = eventId ? await getEventCapacitySnapshot(eventId, settings) : null;

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: getSystemInstruction(settings, eventStatus, knowledgeContext, capacitySnapshot),
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
  const usage = normalizeOpenRouterUsage(payload);

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

  if (usageContext) {
    try {
      await appDb.recordLlmUsage({
        event_id: usageContext.eventId || null,
        actor_user_id: usageContext.actorUserId || null,
        source: usageContext.source,
        provider: "openrouter",
        model: String(payload?.model || model),
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        estimated_cost_usd: usage.estimated_cost_usd,
        metadata: {
          history_length: history.length,
          has_knowledge_context: Boolean(String(knowledgeContext || "").trim()),
          ...usageContext.metadata,
        },
      });
    } catch (error) {
      console.warn("Failed to record LLM usage:", error);
    }
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
      provider: "openrouter",
      usage,
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
      const result = await createRegistration(
        {
          sender_id: senderId,
          event_id: eventId,
          first_name: call.args.first_name,
          last_name: call.args.last_name,
          phone: call.args.phone,
          email: call.args.email,
        },
        { source: "attendee_bot_tool" },
      );
      content = result.content;
      if (result.statusCode === 200 && typeof result.content.id === "string") {
        ticketRegistrationIds.push(result.content.id);
      }
    } else if (call.name === "cancelRegistration") {
      const result = await cancelRegistration(call.args.registration_id, { source: "attendee_bot_tool" });
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
  const chunks = await getEventDocumentChunkEmbeddings(eventId);
  const knowledgeContext = await buildKnowledgeContext(documents, chunks, incomingText);
  const event = await appDb.getEventById(eventId);
  const history = historyOverride || await getMessageHistoryForSender(senderId, 12, eventId);

  const firstResponse = await requestOpenRouterChat(
    incomingText,
    history,
    settings,
    event?.effective_status || "active",
    knowledgeContext,
    {
      eventId,
      source: "channel_reply",
      metadata: { stage: "initial" },
    },
    eventId,
  );
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
      {
        eventId,
        source: "channel_reply",
        metadata: { stage: "tool_followup", tool_count: firstResponse.functionCalls.length },
      },
      eventId,
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
  await saveMessage(senderId, trimmed, "incoming", eventId, pageId);
  const conversationKey = buildInboundConversationKey("facebook", senderId, eventId);
  markInboundConversationActivity(conversationKey);

  if (!(await getFacebookAccessToken(pageId))) {
    console.warn(`Facebook access token is unavailable for page ${pageId || "default"}; skipping outbound reply`);
    return;
  }

  await runSerializedInboundTask(conversationKey, async () => {
    const preparedTurn = await prepareBundledConversationTurnForSender("facebook", senderId, eventId, {
      burstWindowMs: FACEBOOK_INBOUND_BURST_WINDOW_MS,
      alreadySerialized: true,
    });
    if (!preparedTurn) return;

    let replyText = "";
    let ticketRegistrationIds: string[] = [];
    try {
      const result = await generateReplyForPreparedTurn(senderId, eventId, preparedTurn);
      replyText = result.text;
      ticketRegistrationIds = result.ticketRegistrationIds;
      clearFailedInboundTurn(preparedTurn.conversationKey);
    } catch (error) {
      console.error("Failed to generate bot reply:", error);
      rememberFailedInboundTurn(
        preparedTurn.conversationKey,
        preparedTurn,
        error instanceof Error ? error.message : String(error),
      );
      replyText = BOT_TEMPORARY_FAILURE_MESSAGE;
    }

    if (replyText) {
      await sendFacebookTextMessage(senderId, replyText, pageId);
      await saveMessage(senderId, replyText, "outgoing", eventId, pageId);
    }
    markPendingConversationHandled(preparedTurn.conversationKey, preparedTurn.highestPendingMessageId);

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
      const mapUrl = resolveEventMapUrlFromSettings(settings || {});
      if (mapUrl) {
        try {
          await sendFacebookTextMessage(senderId, `แผนที่สถานที่: ${mapUrl}`, pageId);
          await saveMessage(senderId, `[map-link] ${mapUrl}`, "outgoing", eventId, pageId);
        } catch (error) {
          console.error("Failed to send map link:", error);
        }
      }
    }
  });
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
  await saveMessage(senderId, trimmed, "incoming", eventId, destination);
  markInboundConversationActivity(buildInboundConversationKey("line", senderId, eventId));

  if (!(await getLineAccessToken(destination))) {
    console.warn(`LINE access token is unavailable for destination ${destination}; skipping outbound reply`);
    await saveLineDeliveryTrace(senderId, eventId, destination, "channel-misconfigured", "Missing LINE access token");
    return;
  }

  const preparedTurn = await prepareBundledConversationTurnForSender("line", senderId, eventId);
  if (!preparedTurn) return;

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateReplyForPreparedTurn(senderId, eventId, preparedTurn);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
    clearFailedInboundTurn(preparedTurn.conversationKey);
  } catch (error) {
    console.error("Failed to generate LINE bot reply:", error);
    rememberFailedInboundTurn(
      preparedTurn.conversationKey,
      preparedTurn,
      error instanceof Error ? error.message : String(error),
    );
    replyText = BOT_TEMPORARY_FAILURE_MESSAGE;
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
      markPendingConversationHandled(preparedTurn.conversationKey, preparedTurn.highestPendingMessageId);
    } catch (error) {
      console.error("Failed to send LINE reply text:", error);
      await saveLineDeliveryTrace(senderId, eventId, destination, "reply-failed", error instanceof Error ? error.message : String(error));
      if (replyToken) {
        try {
          await sendLinePushTextMessage(senderId, replyText, destination);
          await saveLineDeliveryTrace(senderId, eventId, destination, "push-fallback-sent", "Reply token failed; delivered via push");
          await saveMessage(senderId, replyText, "outgoing", eventId, destination);
          markPendingConversationHandled(preparedTurn.conversationKey, preparedTurn.highestPendingMessageId);
        } catch (pushError) {
          console.error("Failed to send LINE push fallback text:", pushError);
          await saveLineDeliveryTrace(senderId, eventId, destination, "push-fallback-failed", pushError instanceof Error ? pushError.message : String(pushError));
        }
      }
    }
  } else {
    markPendingConversationHandled(preparedTurn.conversationKey, preparedTurn.highestPendingMessageId);
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
    const mapUrl = resolveEventMapUrlFromSettings(settings || {});
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
  await saveMessage(senderId, trimmed, "incoming", eventId, accountId);
  markInboundConversationActivity(buildInboundConversationKey("instagram", senderId, eventId));

  if (!(await getInstagramAccessToken(accountId))) {
    console.warn(`Instagram access token is unavailable for account ${accountId || "unknown"}; skipping outbound reply`);
    return;
  }

  const preparedTurn = await prepareBundledConversationTurnForSender("instagram", senderId, eventId);
  if (!preparedTurn) return;

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateReplyForPreparedTurn(senderId, eventId, preparedTurn);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
    clearFailedInboundTurn(preparedTurn.conversationKey);
  } catch (error) {
    console.error("Failed to generate Instagram bot reply:", error);
    rememberFailedInboundTurn(
      preparedTurn.conversationKey,
      preparedTurn,
      error instanceof Error ? error.message : String(error),
    );
    replyText = BOT_TEMPORARY_FAILURE_MESSAGE;
  }

  if (replyText) {
    await sendInstagramTextMessage(senderId, replyText, accountId);
    await saveMessage(senderId, replyText, "outgoing", eventId, accountId);
  }
  markPendingConversationHandled(preparedTurn.conversationKey, preparedTurn.highestPendingMessageId);

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
    const mapUrl = resolveEventMapUrlFromSettings(settings || {});
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
  await saveMessage(senderId, trimmed, "incoming", eventId, phoneNumberId);
  markInboundConversationActivity(buildInboundConversationKey("whatsapp", senderId, eventId));

  if (!(await getWhatsAppAccessToken(phoneNumberId))) {
    console.warn(`WhatsApp access token is unavailable for phone number ${phoneNumberId || "unknown"}; skipping outbound reply`);
    return;
  }

  const preparedTurn = await prepareBundledConversationTurnForSender("whatsapp", senderId, eventId);
  if (!preparedTurn) return;

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateReplyForPreparedTurn(senderId, eventId, preparedTurn);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
    clearFailedInboundTurn(preparedTurn.conversationKey);
  } catch (error) {
    console.error("Failed to generate WhatsApp bot reply:", error);
    rememberFailedInboundTurn(
      preparedTurn.conversationKey,
      preparedTurn,
      error instanceof Error ? error.message : String(error),
    );
    replyText = BOT_TEMPORARY_FAILURE_MESSAGE;
  }

  if (replyText) {
    await sendWhatsAppTextMessage(senderId, replyText, phoneNumberId);
    await saveMessage(senderId, replyText, "outgoing", eventId, phoneNumberId);
  }
  markPendingConversationHandled(preparedTurn.conversationKey, preparedTurn.highestPendingMessageId);

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
    const mapUrl = resolveEventMapUrlFromSettings(settings || {});
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
  await saveMessage(senderId, trimmed, "incoming", eventId, botKey);
  markInboundConversationActivity(buildInboundConversationKey("telegram", senderId, eventId));

  if (!(await getTelegramAccessToken(botKey))) {
    console.warn(`Telegram bot token is unavailable for bot ${botKey || "unknown"}; skipping outbound reply`);
    return;
  }

  const preparedTurn = await prepareBundledConversationTurnForSender("telegram", senderId, eventId);
  if (!preparedTurn) return;

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateReplyForPreparedTurn(senderId, eventId, preparedTurn);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
    clearFailedInboundTurn(preparedTurn.conversationKey);
  } catch (error) {
    console.error("Failed to generate Telegram bot reply:", error);
    rememberFailedInboundTurn(
      preparedTurn.conversationKey,
      preparedTurn,
      error instanceof Error ? error.message : String(error),
    );
    replyText = BOT_TEMPORARY_FAILURE_MESSAGE;
  }

  if (replyText) {
    await sendTelegramTextMessage(senderId, replyText, botKey);
    await saveMessage(senderId, replyText, "outgoing", eventId, botKey);
  }
  markPendingConversationHandled(preparedTurn.conversationKey, preparedTurn.highestPendingMessageId);

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
    const mapUrl = resolveEventMapUrlFromSettings(settings || {});
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
    console.warn("Embedding job content hash changed before processing; using latest document snapshot:", job.documentId);
  }

  const chunks = (await getEventDocumentChunkEmbeddings(job.eventId)).filter((chunk) => chunk.document_id === job.documentId);
  if (!chunks.length) {
    await appDb.setEventDocumentEmbeddingStatus(job.documentId, "failed", {
      embeddingModel: getEmbeddingModelName(),
      embeddedAt: null,
    });
    return;
  }

  try {
    const vectors = await requestOpenRouterEmbeddings(
      chunks.map((chunk) => chunk.content),
      {
        eventId: job.eventId,
        source: "knowledge_document_embedding",
        metadata: {
          document_id: job.documentId,
          chunk_count: chunks.length,
        },
      },
    );

    const updatedCount = await appDb.saveEventDocumentChunkEmbeddings(
      job.documentId,
      chunks.map((chunk, index) => ({
        chunk_id: chunk.id,
        content_hash: chunk.content_hash || null,
        embedding: vectors[index] || [],
      })),
      {
        embeddingModel: getEmbeddingModelName(),
        embeddedAt: new Date(),
      },
    );

    if (updatedCount !== chunks.length) {
      throw new Error(`Stored embeddings for ${updatedCount}/${chunks.length} chunks`);
    }
  } catch (error) {
    console.error("Failed to generate or store embeddings:", job.documentId, error);
    await appDb.setEventDocumentEmbeddingStatus(job.documentId, "failed", {
      embeddingModel: getEmbeddingModelName(),
      embeddedAt: null,
    });
    return;
  }

  const payload = buildEmbeddingHookPayload(document, chunks);
  const hookUrl = String(process.env.EMBEDDING_HOOK_URL || "").trim();
  if (!hookUrl) {
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
  } catch (error) {
    console.error("Embedding hook delivery failed after local embeddings were stored:", job.documentId, error);
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
  app.disable("x-powered-by");
  app.set("trust proxy", TRUST_PROXY);
  app.use(helmet({
    contentSecurityPolicy: IS_PRODUCTION
      ? {
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            workerSrc: ["'self'", "blob:"],
            formAction: ["'self'"],
          },
        }
      : false,
    hsts: IS_PRODUCTION
      ? {
          maxAge: 15552000,
          includeSubDomains: true,
        }
      : false,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(applyPermissionsPolicyHeader);
  app.use(express.json({
    limit: JSON_BODY_LIMIT,
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = Buffer.from(buf);
    },
  }));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const bodyParserError = error as { type?: string; status?: number; message?: string };
    if (bodyParserError?.type === "entity.too.large" || bodyParserError?.status === 413) {
      return res.status(413).json({ error: "Payload too large" });
    }
    if (bodyParserError instanceof SyntaxError && /json/i.test(String(bodyParserError.message || ""))) {
      return res.status(400).json({ error: "Malformed JSON payload" });
    }
    return next(error);
  });
  app.use(express.static(path.join(__dirname, "public")));
  app.use(attachSession);
  app.use("/api/checkin-access", attachCheckinAccessSession);
  app.use(ensureCsrfCookieMiddleware);
  app.use(csrfProtectionMiddleware);

  const PORT = Number(process.env.PORT || 3000);
  const loginIpRateLimit = createRateLimitMiddleware({
    name: LOGIN_IP_RATE_LIMIT_NAME,
    windowMs: 10 * 60 * 1000,
    max: 5,
    keyFn: (req) => getLoginIpRateLimitScope(req),
    errorMessage: "Too many login attempts from this IP. Please wait and try again.",
    onBlocked: async ({ req, count, retryAfterSeconds }) => {
      await recordSecurityEvent(req as AuthenticatedRequest, "auth.login_rate_limited", {
        scope: "ip",
        ip: getRequestIp(req),
        blocked_count: count,
        retry_after_seconds: retryAfterSeconds,
      });
    },
  });
  const loginUsernameRateLimit = createRateLimitMiddleware({
    name: LOGIN_USERNAME_RATE_LIMIT_NAME,
    windowMs: 10 * 60 * 1000,
    max: 5,
    keyFn: (req) => getLoginUsernameRateLimitScope(req),
    errorMessage: "Too many login attempts for this username. Please wait and try again.",
    onBlocked: async ({ req, count, retryAfterSeconds }) => {
      await recordSecurityEvent(req as AuthenticatedRequest, "auth.login_rate_limited", {
        scope: "username",
        username: getLoginUsernameFromRequest(req),
        blocked_count: count,
        retry_after_seconds: retryAfterSeconds,
      });
    },
  });
  const checkinAccessIpRateLimit = createRateLimitMiddleware({
    name: "checkin-access-ip",
    windowMs: 60 * 1000,
    max: 300,
    keyFn: (req) => buildRateLimitKey(getRequestIp(req) || "unknown"),
    errorMessage: "Too many check-in access requests. Please retry shortly.",
  });
  const checkinAccessExchangeRateLimit = createRateLimitMiddleware({
    name: "checkin-access-exchange",
    windowMs: 10 * 60 * 1000,
    max: 24,
    keyFn: (req) => buildRateLimitKey(getRequestIp(req) || "unknown", getCheckinExchangeTokenHashFromRequest(req)),
    errorMessage: "Too many check-in exchange attempts. Please retry later.",
  });
  const checkinAccessSessionReadRateLimit = createRateLimitMiddleware({
    name: "checkin-access-session-read",
    windowMs: 60 * 1000,
    max: 120,
    keyFn: (req) => getCheckinAccessRateLimitScope(req),
    errorMessage: "Too many check-in session requests. Please retry shortly.",
  });
  const checkinAccessCheckinRateLimit = createRateLimitMiddleware({
    name: "checkin-access-checkin",
    windowMs: 60 * 1000,
    max: 300,
    keyFn: (req) => getCheckinAccessRateLimitScope(req),
    errorMessage: "Too many check-in attempts. Please retry shortly.",
  });
  const auditLogsReadRateLimit = createRateLimitMiddleware({
    name: "audit-logs-read",
    windowMs: 60 * 1000,
    max: 45,
    keyFn: (req) => getRequesterRateLimitScope(req),
    errorMessage: "Too many audit log requests. Please retry shortly.",
  });
  const registrationsExportRateLimit = createRateLimitMiddleware({
    name: "registrations-export",
    windowMs: 10 * 60 * 1000,
    max: 12,
    keyFn: (req) => getRequesterRateLimitScope(req),
    errorMessage: "Too many export requests. Please wait and try again.",
  });
  const retrievalDebugRateLimit = createRateLimitMiddleware({
    name: "documents-retrieval-debug",
    windowMs: 60 * 1000,
    max: 20,
    keyFn: (req) => getRequesterRateLimitScope(req),
    errorMessage: "Too many retrieval debug requests. Please retry later.",
  });
  const embeddingEnqueueRateLimit = createRateLimitMiddleware({
    name: "documents-embedding-enqueue",
    windowMs: 10 * 60 * 1000,
    max: 60,
    keyFn: (req) => getRequesterRateLimitScope(req),
    errorMessage: "Too many embedding enqueue requests. Please retry later.",
  });
  const manualOutboundActionRateLimit = createRateLimitMiddleware({
    name: "manual-outbound-action",
    windowMs: 60 * 1000,
    max: 50,
    keyFn: (req) => getRequesterRateLimitScope(req),
    errorMessage: "Too many manual outbound actions. Please retry shortly.",
  });
  const llmModelsRateLimit = createRateLimitMiddleware({
    name: "llm-models",
    windowMs: 60 * 1000,
    max: 20,
    keyFn: (req) => getRequesterRateLimitScope(req),
    errorMessage: "Too many model list requests. Please retry shortly.",
  });
  const llmChatRateLimit = createRateLimitMiddleware({
    name: "llm-chat",
    windowMs: 60 * 1000,
    max: 60,
    keyFn: (req) => getRequesterRateLimitScope(req),
    errorMessage: "Too many chat requests. Please slow down and retry.",
  });
  const adminAgentRateLimit = createRateLimitMiddleware({
    name: "admin-agent-chat",
    windowMs: 60 * 1000,
    max: 30,
    keyFn: (req) => getRequesterRateLimitScope(req),
    errorMessage: "Too many admin agent requests. Please retry shortly.",
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

  app.post("/api/auth/login", loginIpRateLimit, loginUsernameRateLimit, async (req, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const usernameRaw = readRequiredString(body, "username", issues, { label: "Username", maxLength: 128 });
      const password = readRequiredString(body, "password", issues, { label: "Password", maxLength: 512 });
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const username = normalizeUsername(usernameRaw);

      const user = await appDb.getUserByUsername(username);
      if (!user || !user.is_active) {
        await recordSecurityEvent(req as AuthenticatedRequest, "auth.login_failed", {
          username,
          reason: "invalid_user",
        });
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const passwordHash = await appDb.getUserPasswordHash(username);
      const passwordVerification = typeof passwordHash === "string"
        ? verifyPasswordWithMetadata(password, passwordHash)
        : { valid: false, needsRehash: false };
      const valid = passwordVerification.valid;

      if (!valid) {
        await recordSecurityEvent(req as AuthenticatedRequest, "auth.login_failed", {
          username,
          reason: "invalid_password",
        });
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const existingSessionToken = parseCookies(req.headers.cookie).get(SESSION_COOKIE_NAME);
      if (existingSessionToken) {
        await appDb.deleteSession(hashSessionToken(existingSessionToken));
      }

      const sessionToken = createSessionToken();
      const tokenHash = hashSessionToken(sessionToken);
      const expiresAt = new Date(Date.now() + getSessionTtlMs());
      await appDb.createSession(user.id, tokenHash, expiresAt);
      if (typeof passwordHash === "string" && (passwordVerification.needsRehash || passwordHashNeedsRehash(passwordHash))) {
        await appDb.updateUserPasswordHash(user.id, hashPassword(password));
        await recordSecurityEvent(req as AuthenticatedRequest, "auth.password_rehashed", {
          username,
          user_id: user.id,
        });
      }
      await appDb.updateUserLastLogin(user.id);
      setSessionCookie(res, sessionToken, req);
      setCsrfCookie(res, createSessionToken(), req);
      await resetRateLimitCounter(LOGIN_IP_RATE_LIMIT_NAME, getLoginIpRateLimitScope(req));
      await resetRateLimitCounter(LOGIN_USERNAME_RATE_LIMIT_NAME, buildRateLimitKey(username));
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
        await recordSecurityEvent(req, "auth.logout_succeeded", {
          user_id: req.auth.user.id,
        });
      }
      clearSessionCookie(res, req);
      clearCsrfCookie(res, req);
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
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const username = normalizeUsername(readRequiredString(body, "username", issues, { label: "Username", maxLength: 128 }));
      const password = readRequiredString(body, "password", issues, { label: "Password", maxLength: 512 });
      const role = readEnumValue(body, "role", ALL_USER_ROLES, issues, { required: true, label: "role" }) as UserRole | "";
      const displayName = readOptionalString(body, "display_name", 180) || username;
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const normalizedRole = role as UserRole;

      if (!username || !isValidUsername(username)) {
        return res.status(400).json({ error: "Username must be 3-32 chars and use only a-z, 0-9, dot, dash, or underscore" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      if (normalizedRole === "owner") {
        return res.status(400).json({ error: "Create owners manually in the database only" });
      }
      if (req.auth?.user.role === "admin" && normalizedRole === "admin") {
        return res.status(403).json({ error: "Admins can only create operator, checker, or viewer accounts" });
      }

      const user = await appDb.createUser({
        username,
        display_name: displayName,
        password_hash: hashPassword(password),
        role: normalizedRole,
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
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const role = readEnumValue(body, "role", ALL_USER_ROLES, issues, { required: true, label: "role" }) as UserRole | "";
      if (!userId) {
        issues.push({ field: "id", message: "User ID is required" });
      }
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const normalizedRole = role as UserRole;

      const targetUser = await appDb.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!req.auth?.user || !canManageTargetUser(req.auth.user, targetUser, "role")) {
        return res.status(403).json({ error: "You cannot change this user's role" });
      }
      if (req.auth.user.role === "admin" && (normalizedRole === "owner" || normalizedRole === "admin")) {
        return res.status(403).json({ error: "Admins can only assign operator, checker, or viewer roles" });
      }

      const updated = await appDb.updateUserRole(userId, normalizedRole);
      if (!updated) return res.status(404).json({ error: "User not found" });

      await recordAudit(req, "auth.role_updated", "user", userId, { role: normalizedRole });
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Failed to update user role:", error);
      return res.status(500).json({ error: "Failed to update user role" });
    }
  });

  app.post("/api/auth/users/:id/status", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.params.id || "").trim();
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const isActive = readBooleanWithDefault(body, "is_active", false, issues);
      if (!userId) {
        issues.push({ field: "id", message: "User ID is required" });
      }
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
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

  app.delete("/api/auth/users/:id", requireRoles(["owner", "admin"]), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = String(req.params.id || "").trim();
      if (!userId) {
        return res.status(400).json({ error: "Invalid user" });
      }

      const targetUser = await appDb.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!req.auth?.user || !canManageTargetUser(req.auth.user, targetUser, "status")) {
        return res.status(403).json({ error: "You cannot delete this user" });
      }

      const removed = await appDb.removeUser(userId);
      if (!removed) {
        return res.status(404).json({ error: "User not found" });
      }

      await recordAudit(req, "auth.user_deleted", "user", userId, {
        username: targetUser.username,
        role: targetUser.role,
      });
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Failed to delete user:", error);
      return res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.get("/api/audit-logs", requireRoles(["owner", "admin"]), auditLogsReadRateLimit, async (_req: AuthenticatedRequest, res) => {
    try {
      const logs = await appDb.listAuditLogs(100);
      return res.json(logs);
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
      return res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  app.get(
    "/api/checkin-sessions",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const sessions = await appDb.listCheckinSessions(eventId);
      return res.json(sessions);
    } catch (error) {
      console.error("Failed to fetch check-in sessions:", error);
      return res.status(500).json({ error: "Failed to fetch check-in sessions" });
    }
    },
  );

  app.post(
    "/api/checkin-sessions",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const eventId = getRequestedEventId(req);
      const label = readRequiredString(body, "label", issues, { label: "Session label", maxLength: 160 });
      const expiresHours = readIntegerInRange(body, "expires_hours", 1, 24, issues, { fallbackValue: 8, label: "Expiry" });
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }

      const event = await appDb.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }
      if (
        event.effective_status === "closed"
        || event.effective_status === "cancelled"
        || event.effective_status === "inactive"
      ) {
        return res.status(400).json({ error: "Check-in access cannot be generated for inactive, closed, or cancelled events" });
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
    },
  );

  app.post("/api/checkin-sessions/:id/revoke", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const sessionId = String(req.params.id || "").trim().slice(0, 120);
      if (!sessionId) {
        return respondValidationError(res, [{ field: "id", message: "Session ID is required" }]);
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

  app.post("/api/checkin-access/exchange", checkinAccessIpRateLimit, checkinAccessExchangeRateLimit, async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const rawToken = readRequiredString(body, "token", issues, {
        label: "Check-in token",
        maxLength: 4096,
      });
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const tokenHash = getRateLimitTokenHash(rawToken);

      const exchangedSession = await exchangeCheckinAccessToken(rawToken, req, res);
      if (!exchangedSession) {
        await recordSecurityEvent(req, "checkin.exchange_failed", {
          reason: "invalid_or_expired",
          token_hash: tokenHash,
        });
        return res.status(401).json({ error: "Check-in token is invalid, expired, or already used" });
      }

      const payload = await buildCheckinSessionAccessPayload(exchangedSession);
      if (!payload) {
        clearCheckinAccessCookie(res, req);
        await recordSecurityEvent(req, "checkin.exchange_failed", {
          reason: "event_not_found",
          token_hash: tokenHash,
          checkin_session_id: exchangedSession.id,
          event_id: exchangedSession.event_id,
        });
        return res.status(404).json({ error: "Check-in event not found" });
      }

      await recordSecurityEvent(req, "checkin.exchange_succeeded", {
        token_hash: tokenHash,
        event_id: payload.event_id,
        checkin_access_session_id: payload.id,
      });
      return res.json({ session: payload });
    } catch (error) {
      console.error("Failed to exchange check-in token:", error);
      return res.status(500).json({ error: "Failed to exchange check-in token" });
    }
  });

  app.get("/api/checkin-access/session", checkinAccessIpRateLimit, checkinAccessSessionReadRateLimit, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.checkinAccess) {
        const payload = await buildCheckinSessionAccessPayload({
          id: req.checkinAccess.sessionId,
          label: req.checkinAccess.label,
          event_id: req.checkinAccess.eventId,
          expires_at: req.checkinAccess.expiresAt,
          last_used_at: new Date().toISOString(),
        });
        if (payload) {
          return res.json({ session: payload });
        }
        clearCheckinAccessCookie(res, req);
      }

      if (typeof req.query.token === "string" && req.query.token.trim()) {
        await recordSecurityEvent(req, "checkin.exchange_legacy_query_blocked", {
          token_hash: getRateLimitTokenHash(req.query.token),
        });
        return res.status(400).json({ error: "Query token exchange is no longer supported. Use POST /api/checkin-access/exchange." });
      }

      return res.status(401).json({ error: "Check-in access session is required" });
    } catch (error) {
      console.error("Failed to resolve check-in session:", error);
      return res.status(500).json({ error: "Failed to resolve check-in session" });
    }
  });

  app.post(
    "/api/checkin-access/checkin",
    checkinAccessIpRateLimit,
    checkinAccessCheckinRateLimit,
    requireEventScope({
      allowDefault: false,
      allowCheckinAccess: true,
      queryKey: null,
      bodyKey: null,
      paramKey: null,
    }),
    async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.checkinAccess) {
        await recordSecurityEvent(req, "checkin.access_denied", {
          reason: "missing_access_session",
        });
        return res.status(401).json({ error: "Check-in access session not found or expired" });
      }

      const accessContext = req.checkinAccess;
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const registrationId = readRequiredString(body, "id", issues, {
        label: "Registration ID",
        maxLength: 64,
      }).toUpperCase();
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }

      const result = await performCheckinForRegistration(registrationId, accessContext.eventId, {
        source: "checkin_access",
      });
      await appDb.touchCheckinAccessSession(accessContext.sessionId);

      if (result.statusCode === 200) {
        await appDb.recordAuditLog({
          actor_user_id: null,
          action: result.body.already_checked_in ? "registration.checkin_repeated" : "registration.checked_in_via_token",
          target_type: "registration",
          target_id: registrationId,
          metadata: {
            event_id: accessContext.eventId,
            checkin_session_id: accessContext.checkinSessionId,
            checkin_access_session_id: accessContext.sessionId,
            ip: getRequestIp(req),
          },
        });
      }

      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      console.error("Failed to check in via token:", error);
      return res.status(500).json({ error: "Failed to check in attendee" });
    }
    },
  );

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
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const name = readRequiredString(body, "name", issues, { label: "Event name", maxLength: 180 });
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const event = await appDb.createEvent({ name });
      await recordAudit(req, "event.created", "event", event.id, { name: event.name });
      return res.status(201).json(event);
    } catch (error) {
      console.error("Failed to create event:", error);
      return res.status(500).json({ error: "Failed to create event" });
    }
  });

  app.post(
    "/api/events/:id",
    requireRoles(["owner", "admin"]),
    requireEventScope({ paramKey: "id", allowDefault: false, allowCheckinAccess: false, queryKey: null }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const nameRaw = readOptionalString(body, "name", 180);
      const statusRaw = readOptionalString(body, "status", 24);
      const status = statusRaw
        ? readEnumValue(
            { status: statusRaw },
            "status",
            ["pending", "active", "inactive", "cancelled"] as const,
            issues,
            { required: false, label: "Event status" },
          )
        : "";
      if (!nameRaw && !statusRaw) {
        issues.push({ field: "name", message: "name or status is required" });
      }
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const updated = await appDb.updateEvent(eventId, {
        name: nameRaw || undefined,
        status: status ? status as any : undefined,
      });
      if (!updated) {
        return res.status(404).json({ error: "Event not found" });
      }
      await recordAudit(req, "event.updated", "event", eventId, {
        name: nameRaw || null,
        status: status || null,
      });
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Failed to update event:", error);
      return res.status(500).json({ error: "Failed to update event" });
    }
    },
  );

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

  app.post(
    "/api/facebook-pages",
    requireRoles(["owner", "admin"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: false, allowCheckinAccess: false, queryKey: null }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const pageId = readRequiredString(body, "page_id", issues, { label: "page_id", maxLength: 256 });
      const pageName = readOptionalString(body, "page_name", 256);
      const eventId = getRequestedEventId(req);
      const pageAccessToken = readOptionalString(body, "page_access_token", 4096);
      const isActive = readBooleanWithDefault(body, "is_active", true, issues);
      if (issues.length > 0) {
        return respondValidationError(res, issues);
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
    },
  );

  app.post(
    "/api/channels",
    requireRoles(["owner", "admin"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: false, allowCheckinAccess: false, queryKey: null }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const platform = readOptionalString(body, "platform", 40) as ChannelPlatform || "facebook";
      const requestedExternalId = readOptionalString(body, "external_id", 300);
      const displayName = readOptionalString(body, "display_name", 300);
      const eventId = getRequestedEventId(req);
      const accessToken = readOptionalString(body, "access_token", 4096);
      const isActive = readBooleanWithDefault(body, "is_active", true, issues);
      const originalPlatformRaw = readOptionalString(body, "original_platform", 40);
      const originalExternalId = readOptionalString(body, "original_external_id", 300);
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      if (!ALLOWED_CHANNEL_PLATFORMS.includes(platform)) {
        return res.status(400).json({ error: "Invalid channel platform" });
      }
      if (Boolean(originalPlatformRaw) !== Boolean(originalExternalId)) {
        return res.status(400).json({ error: "original_platform and original_external_id must be provided together" });
      }
      if (originalPlatformRaw && !ALLOWED_CHANNEL_PLATFORMS.includes(originalPlatformRaw as ChannelPlatform)) {
        return res.status(400).json({ error: "Invalid original channel platform" });
      }
      if (!eventId) {
        return res.status(400).json({ error: "external_id and event_id are required" });
      }

      const event = await appDb.getEventById(eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      const originalPlatform = (originalPlatformRaw || "") as ChannelPlatform | "";
      const originalChannel = originalPlatform
        ? await appDb.getChannelAccount(originalPlatform, originalExternalId)
        : undefined;
      if (originalPlatform && !originalChannel) {
        return res.status(404).json({ error: "Original channel not found" });
      }

      const initialCredentialSource =
        originalChannel && originalChannel.platform === platform
          ? originalChannel
          : undefined;
      const nextConfig = sanitizeChannelConfig(platform, body.config);
      const provisionalAccessToken = accessToken || String(initialCredentialSource?.access_token || "").trim();
      let resolvedExternalId = requestedExternalId;
      let resolvedDisplayName = displayName || requestedExternalId;
      let lineBotProfile: LineBotProfile | null = null;

      if (platform === "line_oa" && provisionalAccessToken) {
        try {
          lineBotProfile = await fetchLineBotProfile(provisionalAccessToken);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return res.status(400).json({ error: `Failed to resolve LINE bot user ID from the access token: ${detail}` });
        }
        resolvedExternalId = lineBotProfile.userId;
        resolvedDisplayName = displayName || lineBotProfile.displayName || lineBotProfile.basicId || lineBotProfile.userId;
      }

      if (!resolvedExternalId) {
        return res.status(400).json({ error: "external_id and event_id are required" });
      }

      const isSameIdentityAsOriginal =
        Boolean(originalChannel)
        && originalChannel?.platform === platform
        && originalChannel?.external_id === resolvedExternalId;
      const existingChannel = isSameIdentityAsOriginal
        ? originalChannel
        : await appDb.getChannelAccount(platform, resolvedExternalId);
      if (existingChannel && originalChannel && existingChannel.id !== originalChannel.id) {
        return res.status(409).json({ error: "A channel with this platform and external ID already exists" });
      }

      const credentialSource =
        initialCredentialSource
        || (existingChannel && existingChannel.platform === platform ? existingChannel : undefined);
      const mergedConfig = {
        ...(credentialSource ? safeParseChannelConfig(credentialSource.config_json) : {}),
        ...nextConfig,
      };
      const effectiveAccessToken = accessToken || String(credentialSource?.access_token || "").trim();

      const effectiveHasAccessToken = Boolean(effectiveAccessToken || (platform === "facebook" && process.env.PAGE_ACCESS_TOKEN));
      const missingRequirements = getChannelMissingRequirements(platform, {
        hasAccessToken: effectiveHasAccessToken,
        config: mergedConfig,
      });
      const isDisableOnlyUpdate =
        Boolean(originalChannel || existingChannel) &&
        (originalChannel || existingChannel)?.event_id === eventId &&
        (originalChannel || existingChannel)?.platform === platform &&
        (originalChannel || existingChannel)?.external_id === resolvedExternalId &&
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

      const channelInput = {
        platform,
        external_id: resolvedExternalId,
        display_name: resolvedDisplayName || resolvedExternalId,
        event_id: eventId,
        access_token: effectiveAccessToken,
        config_json: JSON.stringify(mergedConfig),
        is_active: isActive,
      };
      const channel = originalChannel
        ? await appDb.updateChannelAccount(originalChannel.platform, originalChannel.external_id, channelInput)
        : await appDb.upsertChannelAccount(channelInput);

      await recordAudit(req, "channel.upserted", "channel", channel.id, {
        platform: channel.platform,
        external_id: channel.external_id,
        event_id: channel.event_id,
        is_active: channel.is_active,
        ...(originalChannel
          ? {
              original_platform: originalChannel.platform,
              original_external_id: originalChannel.external_id,
            }
          : {}),
        ...(lineBotProfile
          ? {
              line_basic_id: lineBotProfile.basicId || null,
              line_display_name: lineBotProfile.displayName || null,
            }
          : {}),
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
    },
  );

  app.get("/api/public/events/:slug", async (req, res) => {
    try {
      const match = await resolvePublicEventBySlug(req.params.slug);
      if (!match || !isTruthySetting(match.settings.event_public_page_enabled ?? "0")) {
        return res.status(404).json({ error: "Public event page unavailable" });
      }

      const payload = await buildPublicEventPagePayload(match.event, match.settings);
      if (!payload) {
        return res.status(404).json({ error: "Public event page unavailable" });
      }

      return res.json(payload);
    } catch (error) {
      console.error("Failed to fetch public event page:", error);
      return res.status(500).json({ error: "Failed to load public event page" });
    }
  });

  app.post("/api/public/events/:slug/register", async (req: AuthenticatedRequest, res) => {
    try {
      const match = await resolvePublicEventBySlug(req.params.slug);
      if (!match || !isTruthySetting(match.settings.event_public_page_enabled ?? "0")) {
        return res.status(404).json({ error: "Public event page unavailable" });
      }

      const payload = await buildPublicEventPagePayload(match.event, match.settings);
      if (!payload) {
        return res.status(404).json({ error: "Public event page unavailable" });
      }
      if (!payload.event.registration_enabled) {
        return res.status(400).json({ error: "Public registration is disabled for this event" });
      }

      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const firstName = readRequiredString(body, "first_name", issues, { label: "first_name", maxLength: 180 });
      const lastName = readRequiredString(body, "last_name", issues, { label: "last_name", maxLength: 180 });
      const phone = readRequiredString(body, "phone", issues, { label: "phone", maxLength: 64 });
      const email = readOptionalString(body, "email", 320);
      if (email && !isLikelyEmailAddress(email)) {
        issues.push({ field: "email", message: "email is invalid" });
      }
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }

      const senderSeed = [phone, email, firstName, lastName]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
        .join(":")
        .replace(/[^a-z0-9:@._+-]+/g, "-")
        .slice(0, 80);
      const senderId = `public-web:${match.event.id}:${senderSeed || Date.now().toString(36)}:${Date.now().toString(36)}`;

      const creation = await createRegistration({
        sender_id: senderId,
        event_id: match.event.id,
        first_name: firstName,
        last_name: lastName,
        phone,
        email,
      }, {
        source: "public_event_page",
      });

      const mapUrl = payload.location.map_url || "";
      const eventName = payload.event.name;
      const eventDateLabel = payload.event.date_label;
      const locationLabel = payload.location.compact || "-";

      if (creation.statusCode === 200 && typeof creation.content.id === "string") {
        const registrationId = String(creation.content.id || "").trim().toUpperCase();
        const ticket = buildTicketArtifactUrls(registrationId);
        await recordAudit(req, "public.registration.created", "registration", registrationId, {
          event_id: match.event.id,
          public_slug: payload.event.slug,
        });
        return res.json({
          status: "success",
          message: "Registration complete",
          success_message: payload.event.success_message,
          email_backup_enabled: payload.event.confirmation_email_enabled,
          map_url: mapUrl,
          registration: {
            id: registrationId,
            first_name: firstName,
            last_name: lastName,
            phone,
            email,
          },
          ticket,
          event: {
            name: eventName,
            date_label: eventDateLabel,
            location: locationLabel,
          },
        });
      }

      if (creation.statusCode === 409 && typeof creation.content.duplicate_registration_id === "string") {
        const registrationId = String(creation.content.duplicate_registration_id || "").trim().toUpperCase();
        const existing = await getRegistrationById(registrationId);
        const ticket = buildTicketArtifactUrls(registrationId);
        await recordAudit(req, "public.registration.duplicate_reused", "registration", registrationId, {
          event_id: match.event.id,
          public_slug: payload.event.slug,
        });
        return res.json({
          status: "duplicate",
          message: "You already have a ticket for this event",
          success_message: "You already have a ticket for this event. Save it again below.",
          email_backup_enabled: payload.event.confirmation_email_enabled,
          map_url: mapUrl,
          registration: {
            id: registrationId,
            first_name: existing?.first_name || firstName,
            last_name: existing?.last_name || lastName,
            phone: existing?.phone || phone,
            email: existing?.email || email,
          },
          ticket,
          event: {
            name: eventName,
            date_label: eventDateLabel,
            location: locationLabel,
          },
        });
      }

      return res.status(creation.statusCode).json(creation.content);
    } catch (error) {
      console.error("Failed to register via public event page:", error);
      return res.status(500).json({ error: "Failed to register for this event" });
    }
  });

  app.post("/api/public/events/:slug/chat", webChatRateLimit, async (req, res) => {
    try {
      const match = await resolvePublicEventBySlug(req.params.slug);
      if (!match || !isTruthySetting(match.settings.event_public_page_enabled ?? "0")) {
        return res.status(404).json({ error: "Public event page unavailable" });
      }
      if (!isTruthySetting(match.settings.event_public_bot_enabled ?? "1")) {
        return res.status(400).json({ error: "Bot help is disabled for this event" });
      }

      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const senderId = readRequiredString(body, "sender_id", issues, { label: "sender_id", maxLength: 240 });
      const text = readRequiredString(body, "text", issues, { label: "text", maxLength: 4000 });
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }

      const pageId = `public-event:${match.event.id}`;
      await saveMessage(senderId, text, "incoming", match.event.id, pageId);
      const conversationKey = buildInboundConversationKey("public-web", senderId, match.event.id);
      markInboundConversationActivity(conversationKey);

      const preparedTurn = await prepareBundledConversationTurnForSender("public-web", senderId, match.event.id, {
        burstWindowMs: WEBCHAT_BURST_WINDOW_MS,
      });

      let replyText = "";
      let ticketRegistrationIds: string[] = [];
      if (preparedTurn) {
        try {
          const result = await generateReplyForPreparedTurn(senderId, match.event.id, preparedTurn);
          replyText = result.text;
          ticketRegistrationIds = result.ticketRegistrationIds;
          clearFailedInboundTurn(preparedTurn.conversationKey);
        } catch (error) {
          console.error("Failed to generate public event bot reply:", error);
          rememberFailedInboundTurn(
            preparedTurn.conversationKey,
            preparedTurn,
            error instanceof Error ? error.message : String(error),
          );
          replyText = BOT_TEMPORARY_FAILURE_MESSAGE;
        }
      }

      if (replyText) {
        await saveMessage(senderId, replyText, "outgoing", match.event.id, pageId);
      }
      if (preparedTurn) {
        markPendingConversationHandled(preparedTurn.conversationKey, preparedTurn.highestPendingMessageId);
      }

      const artifacts = await buildWebChatArtifacts(match.event.id, ticketRegistrationIds);
      return res.json({
        status: "ok",
        reply_text: replyText,
        map_url: artifacts.map_url,
        tickets: artifacts.tickets,
      });
    } catch (error) {
      console.error("Public event chat handler failed:", error);
      return res.status(500).json({ error: "Failed to process event chat message" });
    }
  });

  app.get(
    "/api/registrations",
    requireAuth,
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const rows = await appDb.listRegistrations(undefined, eventId);
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch registrations" });
    }
    },
  );

  app.post(
    "/api/registrations",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const senderId = readRequiredString(body, "sender_id", issues, { label: "sender_id", maxLength: 255 });
      const firstName = readRequiredString(body, "first_name", issues, { label: "first_name", maxLength: 180 });
      const lastName = readRequiredString(body, "last_name", issues, { label: "last_name", maxLength: 180 });
      const phone = readRequiredString(body, "phone", issues, { label: "phone", maxLength: 64 });
      const email = readOptionalString(body, "email", 320);
      if (email && !isLikelyEmailAddress(email)) {
        issues.push({ field: "email", message: "email is invalid" });
      }
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const registrationInput: RegistrationInput = {
        sender_id: senderId,
        event_id: eventId,
        first_name: firstName,
        last_name: lastName,
        phone,
        email,
      };
      const result = await createRegistration(registrationInput, {
        source: "registrations_create_api",
      });
      if (result.statusCode === 200 && typeof result.content.id === "string") {
        await recordAudit(req, "registration.created", "registration", String(result.content.id), {
          sender_id: senderId,
          event_id: eventId,
        });
      }
      res.status(result.statusCode).json(result.content);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to register user" });
    }
    },
  );

  app.post("/api/registrations/checkin", requireRoles(["owner", "admin", "operator", "checker"]), async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const registrationId = readRequiredString(body, "id", issues, { label: "Registration ID", maxLength: 64 }).toUpperCase();
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const result = await performCheckinForRegistration(registrationId, undefined, {
        source: "registrations_checkin_api",
      });
      if (result.statusCode === 200) {
        await recordAudit(
          req,
          result.body.already_checked_in ? "registration.checkin_repeated" : "registration.checked_in",
          "registration",
          registrationId,
          {
            event_id: result.body?.registration?.event_id || null,
          },
        );
      }
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      res.status(500).json({ error: "Failed to check in" });
    }
  });

  app.post("/api/registrations/cancel", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const registrationId = readRequiredString(body, "id", issues, { label: "Registration ID", maxLength: 64 }).toUpperCase();
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const existing = registrationId ? await getRegistrationById(registrationId) : null;
      const result = await cancelRegistration(registrationId, { source: "registrations_cancel_api" });
      if (result.statusCode === 200) {
        await recordAudit(req, "registration.cancelled", "registration", registrationId, {
          event_id: existing?.event_id || null,
        });
      }
      res.status(result.statusCode).json(result.content);
    } catch (error) {
      res.status(500).json({ error: "Failed to cancel registration" });
    }
  });

  app.post("/api/registrations/status", requireRoles(["owner", "admin", "operator"]), async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const id = readRequiredString(body, "id", issues, { label: "Registration ID", maxLength: 64 }).toUpperCase();
      const status = readEnumValue(
        body,
        "status",
        ["registered", "cancelled", "checked-in"] as const,
        issues,
        { required: true, label: "status" },
      );
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }

      const updated = await updateRegistrationStatusWithNotification(id, status as RegistrationStatus, {
        source: "registrations_status_api",
      });
      if (updated.updated) {
        await recordAudit(req, "registration.status_updated", "registration", id, {
          status,
          event_id: updated.registration?.event_id || null,
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
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const id = readRequiredString(body, "id", issues, { label: "Registration ID", maxLength: 64 }).toUpperCase();
      if (issues.length > 0) {
        return respondValidationError(res, issues);
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

  app.get(
    "/api/registrations/export",
    requireAuth,
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    registrationsExportRateLimit,
    async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const rows = await appDb.exportRegistrations(eventId);
      const eventName = (await appDb.getSettingValue("event_name", eventId)) || "event";
      const filename = buildRegistrationExportFilename(eventName);
      const csvWithBOM = buildRegistrationsCsvWithBom(rows);
      await recordSecurityEvent(req, "registration.export_downloaded", {
        event_id: eventId,
        rows: rows.length,
        filename,
      });

      res.header("Content-Type", "text/csv; charset=utf-8");
      res.attachment(filename);
      res.send(csvWithBOM);
    } catch (error) {
      res.status(500).json({ error: "Failed to export CSV" });
    }
    },
  );

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

  app.get(
    "/api/settings",
    requireAuth,
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      res.json(await getSettingsMap(eventId));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
    },
  );

  app.post(
    "/api/settings",
    requireRoles(["owner", "admin"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const input = readObjectBody(req);
      const { entries: body, issues } = normalizeSettingsMutationPayload(input);
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      if (Object.keys(body).length === 0) {
        return respondValidationError(res, [{ field: "body", message: "No settings payload provided" }]);
      }
      const mergedSettings = {
        ...(await getSettingsMap(eventId)),
        ...body,
      };
      const timingState = getEventState(mergedSettings);
      if (timingState.registrationStatus === "invalid") {
        return res.status(400).json({ error: "Close date must be later than or equal to open date" });
      }
      if (timingState.eventScheduleStatus === "invalid") {
        return res.status(400).json({ error: "Event end time must be later than or equal to the event start time" });
      }
      await appDb.upsertSettings(body, eventId);
      await recordAudit(req, "settings.updated", "settings", eventId, {
        keys: Object.keys(body),
        event_id: eventId,
      });
      if (Object.keys(body).some((key) => key === "verify_token" || key.startsWith("admin_agent_telegram_"))) {
        await recordSecurityEvent(req, "security.webhook_config_updated", {
          keys: Object.keys(body),
          event_id: eventId,
        });
      }
      res.json({ status: "ok" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update settings" });
    }
    },
  );

  app.post(
    "/api/event-knowledge/reset",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const eventId = getRequestedEventId(req);
      const issues: ValidationIssue[] = [];
      const clearContext = readBooleanWithDefault(body, "clear_context", true, issues);
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
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
    },
  );

  app.get(
    "/api/documents",
    requireAuth,
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const rows = await getEventDocuments(eventId);
      res.json(rows);
    } catch (error) {
      console.error("Failed to fetch documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
    },
  );

  app.get(
    "/api/documents/:id/chunks",
    requireAuth,
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req, res) => {
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
    },
  );

  app.get(
    "/api/documents/:id/embedding-preview",
    requireAuth,
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req, res) => {
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
    },
  );

  app.post(
    "/api/documents/:id/embedding-enqueue",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    embeddingEnqueueRateLimit,
    async (req: AuthenticatedRequest, res) => {
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
          embedding_model: getEmbeddingModelName(),
          local_vector_store: true,
          hook_configured: Boolean(String(process.env.EMBEDDING_HOOK_URL || "").trim()),
        },
      });

      return res.json({
        status: "ok",
        queued,
        queue_mode: canUseEmbeddingQueue() ? "redis" : "inline",
        worker_mode: RUN_EMBEDDED_WORKER ? "embedded" : "external",
        local_vector_store: true,
        embedding_model: getEmbeddingModelName(),
        hook_configured: Boolean(String(process.env.EMBEDDING_HOOK_URL || "").trim()),
        document_id: documentId,
        embedding_status: document.is_active ? "pending" : "skipped",
      });
    } catch (error) {
      console.error("Failed to enqueue embedding job:", error);
      return res.status(500).json({ error: "Failed to enqueue embedding job" });
    }
    },
  );

  app.get(
    "/api/documents/retrieval-debug",
    requireAuth,
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    retrievalDebugRateLimit,
    async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const querySource = Array.isArray(req.query?.query) ? req.query.query[0] : req.query?.query;
      const issues: ValidationIssue[] = [];
      const query = readRequiredString({ query: querySource }, "query", issues, {
        label: "query",
        maxLength: 2000,
      });
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const documents = await getEventDocuments(eventId);
      const chunks = await getEventDocumentChunkEmbeddings(eventId);
      const settings = await getSettingsMap(eventId);
      const activeDocuments = documents.filter((document) => document.is_active);
      const activeDocumentIds = new Set(activeDocuments.map((document) => document.id));
      const activeChunks = chunks.filter((chunk) => activeDocumentIds.has(chunk.document_id));
      const ranked = await rankKnowledgeMatches(documents, chunks, query);
      const matches = ranked.matches
        .filter((entry, index) => entry.score > 0 || index < 3)
        .slice(0, 8)
        .map((entry, index) => ({
          rank: index + 1,
          score: entry.score,
          lexical_score: entry.lexical_score,
          vector_score: entry.vector_score,
          strategy: entry.strategy,
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
          retrieval_mode: ranked.mode,
          query_embedding_model: ranked.query_embedding_model,
          active_document_count: activeDocuments.length,
          active_chunk_count: activeChunks.length,
          vector_ready_chunk_count: ranked.vector_ready_chunk_count,
        },
        matches,
        composed_knowledge_context: buildKnowledgeContextFromMatches(ranked.matches),
      });
    } catch (error) {
      console.error("Failed to fetch retrieval debug:", error);
      return res.status(500).json({ error: "Failed to fetch retrieval debug" });
    }
    },
  );

  app.post(
    "/api/documents",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const eventId = getRequestedEventId(req);
      const issues: ValidationIssue[] = [];
      const title = readRequiredString(body, "title", issues, { label: "title", maxLength: 255 });
      const content = readRequiredString(body, "content", issues, { label: "content", maxLength: 200000 });
      const sourceType = readEnumValue(
        body,
        "source_type",
        ["note", "document", "url"] as const,
        issues,
        { required: false, label: "source_type" },
      ) || "note";
      const sourceUrl = readOptionalString(body, "source_url", 1000);
      const isActive = readBooleanWithDefault(body, "is_active", true, issues);
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }

      const document = await appDb.upsertEventDocument({
        id: typeof body.id === "string" ? body.id : undefined,
        event_id: eventId,
        title,
        source_type: sourceType,
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
    },
  );

  app.post(
    "/api/documents/:id/status",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: false, allowCheckinAccess: false, queryKey: null }),
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const documentId = String(req.params.id || "").trim();
      const isActive = readBooleanWithDefault(body, "is_active", false, issues);
      const eventId = getRequestedEventId(req);
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      if (!documentId) {
        return res.status(400).json({ error: "Document ID is required" });
      }
      const eventDocuments = await getEventDocuments(eventId);
      if (!eventDocuments.some((row) => row.id === documentId)) {
        return res.status(404).json({ error: "Document not found for this event" });
      }

      const updated = await appDb.setEventDocumentActive(documentId, isActive);
      if (!updated) {
        return res.status(404).json({ error: "Document not found" });
      }

      await recordAudit(req, "document.status_updated", "event_document", documentId, {
        event_id: eventId,
        is_active: isActive,
      });
      res.json({ status: "ok", id: documentId, is_active: isActive });
    } catch (error) {
      console.error("Failed to update document status:", error);
      res.status(500).json({ error: "Failed to update document status" });
    }
    },
  );

  app.get(
    "/api/messages",
    requireRoles(["owner", "admin", "operator", "viewer"]),
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const pageSize = parsePositiveInteger(req.query?.limit, 200, 1000);
      const beforeIdParsed = Number.parseInt(String(req.query?.before_id || "").trim(), 10);
      const beforeId = Number.isFinite(beforeIdParsed) && beforeIdParsed > 0
        ? Math.trunc(beforeIdParsed)
        : undefined;

      const rows = await appDb.listMessages(pageSize + 1, eventId, beforeId);
      const hasMore = rows.length > pageSize;
      const items = hasMore ? rows.slice(0, pageSize) : rows;
      const senderIds = [...new Set(items.map((row) => normalizeOptionalText(row.sender_id)).filter(Boolean))];
      const externalIds = [...new Set(items.map((row) => normalizeOptionalText(row.page_id)).filter(Boolean))];
      const [channels, senderRegistrations] = await Promise.all([
        externalIds.length > 0 ? appDb.listChannelAccounts() : Promise.resolve([]),
        senderIds.length > 0 ? appDb.listRegistrationsBySenderIds(senderIds, eventId) : Promise.resolve([]),
      ]);
      const channelByExternalId = new Map<string, { platform: ChannelPlatform; display_name: string }>();
      for (const channel of channels) {
        const channelEventId = normalizeOptionalText(channel.event_id) || DEFAULT_EVENT_ID;
        if (channelEventId !== eventId) continue;
        const externalId = normalizeOptionalText(channel.external_id);
        if (!externalId) continue;
        if (!channelByExternalId.has(externalId)) {
          channelByExternalId.set(externalId, {
            platform: channel.platform,
            display_name: normalizeOptionalText(channel.display_name),
          });
        }
      }
      const registrationBySenderId = new Map<string, RegistrationRow>();
      for (const registration of senderRegistrations) {
        const senderId = normalizeOptionalText(registration.sender_id);
        if (!senderId || registrationBySenderId.has(senderId)) continue;
        registrationBySenderId.set(senderId, registration);
      }
      const enrichedItems = items.map((row) => {
        const senderId = normalizeOptionalText(row.sender_id);
        const pageId = normalizeOptionalText(row.page_id);
        const channel = pageId ? channelByExternalId.get(pageId) : undefined;
        const registration = senderId ? registrationBySenderId.get(senderId) : undefined;
        return {
          ...row,
          platform: channel?.platform || null,
          channel_display_name: channel?.display_name || null,
          sender_name: registration ? formatRegistrationDisplayName(registration) : null,
          sender_phone: registration ? normalizeOptionalText(registration.phone) : null,
          sender_email: registration ? normalizeOptionalText(registration.email) : null,
          registration_id: registration?.id || null,
        };
      });
      const nextBeforeId = items.length > 0
        ? Math.min(...items.map((row) => Number(row.id || 0)).filter((id) => Number.isFinite(id) && id > 0))
        : null;

      res.json({
        items: enrichedItems,
        has_more: hasMore,
        next_before_id: nextBeforeId,
        page_size: pageSize,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
    },
  );

  app.post(
    "/api/messages/manual-send",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    manualOutboundActionRateLimit,
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const mode = readEnumValue(body, "mode", ["text", "ticket"] as const, issues, { required: true, label: "mode" });
      const eventId = getRequestedEventId(req);
      const senderId = readRequiredString(body, "sender_id", issues, { label: "sender_id", maxLength: 255 });
      const pageId = readRequiredString(body, "page_id", issues, { label: "page_id", maxLength: 255 });
      const platform = readOptionalString(body, "platform", 64);
      const text = readOptionalString(body, "text", 5000);
      const registrationId = readOptionalString(body, "registration_id", 64).toUpperCase();
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }

      if (mode === "text" && !text) {
        return respondValidationError(res, [{ field: "text", message: "Manual reply text is required" }]);
      }
      if (mode === "ticket" && !registrationId) {
        return respondValidationError(res, [{ field: "registration_id", message: "Registration ID is required to resend a ticket" }]);
      }

      const target = await resolveManualOutboundTarget(eventId, senderId, pageId, platform);
      const result =
        mode === "text"
          ? await sendManualOutboundText(target, text)
          : await resendTicketArtifactsToOutboundTarget(target, registrationId);

      await recordAudit(
        req,
        mode === "text" ? "message.manual_sent" : "registration.ticket_resent_manual",
        mode === "text" ? "message" : "registration",
        mode === "text" ? senderId : registrationId,
        {
          event_id: eventId,
          sender_id: senderId,
          page_id: pageId,
          platform: target.platform,
          ...(mode === "text" ? { text_preview: text.slice(0, 180) } : { registration_id: registrationId }),
          ...result,
        },
      );

      return res.json({
        status: "ok",
        mode,
        platform: target.platform,
        ...result,
      });
    } catch (error) {
      console.error("Failed to send manual override message:", error);
      const message = error instanceof Error ? error.message : "Failed to send manual override message";
      const lower = message.toLowerCase();
      const statusCode =
        lower.includes("required")
        || lower.includes("invalid")
        || lower.includes("not supported")
        || lower.includes("not linked")
        || lower.includes("not found")
        || lower.includes("does not belong")
          ? 400
          : 500;
      return res.status(statusCode).json({
        error: message,
      });
    }
    },
  );

  app.post(
    "/api/messages/manual-retry-bot",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    manualOutboundActionRateLimit,
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const eventId = getRequestedEventId(req);
      const senderId = readRequiredString(body, "sender_id", issues, { label: "sender_id", maxLength: 255 });
      const pageId = readRequiredString(body, "page_id", issues, { label: "page_id", maxLength: 255 });
      const platform = readOptionalString(body, "platform", 64);
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }

      const target = await resolveManualOutboundTarget(eventId, senderId, pageId, platform);
      const result = await retryBotReplyForOutboundTarget(target);

      await recordAudit(
        req,
        "message.manual_retry",
        "message",
        senderId,
        {
          event_id: eventId,
          sender_id: senderId,
          page_id: pageId,
          platform: target.platform,
          ...result,
        },
      );

      return res.json({
        status: "ok",
        mode: "retry-bot",
        platform: target.platform,
        ...result,
      });
    } catch (error) {
      console.error("Failed to retry bot reply manually:", error);
      const message = error instanceof Error ? error.message : "Failed to retry bot reply";
      const lower = message.toLowerCase();
      const statusCode =
        lower.includes("required")
        || lower.includes("invalid")
        || lower.includes("not supported")
        || lower.includes("not linked")
        || lower.includes("not found")
        || lower.includes("does not belong")
        || lower.includes("no recent incoming")
          ? 400
          : 500;
      return res.status(statusCode).json({ error: message });
    }
    },
  );

  app.get("/api/llm/models", requireRoles(["owner", "admin", "operator"]), llmModelsRateLimit, async (req, res) => {
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

  app.get(
    "/api/llm/usage-summary",
    requireRoles(["owner", "admin"]),
    requireEventScope({ queryKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    async (req, res) => {
    try {
      const eventId = getRequestedEventId(req);
      const summary = await appDb.getLlmUsageSummary(eventId);
      res.json(summary);
    } catch (error) {
      console.error("LLM usage summary error:", error);
      res.status(500).json({ error: "Failed to fetch LLM usage summary" });
    }
    },
  );

  app.post(
    "/api/llm/chat",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    llmChatRateLimit,
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const message = readRequiredString(body, "message", issues, { label: "message", maxLength: 8000 });
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }
      const history = Array.isArray(body.history) ? (body.history as ChatHistoryMessage[]) : [];
      const eventId = getRequestedEventId(req);
      const settings = (body.settings && typeof body.settings === "object")
        ? body.settings as Record<string, any>
        : await getSettingsMap(eventId);
      const documents = await getEventDocuments(eventId);
      const chunks = await getEventDocumentChunkEmbeddings(eventId);
      const knowledgeContext = await buildKnowledgeContext(documents, chunks, message);
      const event = await appDb.getEventById(eventId);
      const hasToolResponses = history.some((entry) =>
        Array.isArray(entry?.parts) && entry.parts.some((part) => Boolean(part?.functionResponse)),
      );
      const response = await requestOpenRouterChat(
        message,
        history,
        settings,
        event?.effective_status || "active",
        knowledgeContext,
        {
          eventId,
          actorUserId: req.auth?.user.id || null,
          source: "admin_test",
          metadata: { stage: hasToolResponses ? "tool_followup" : "initial" },
        },
        eventId,
      );
      res.json(response);
    } catch (error) {
      console.error("OpenRouter chat error:", error);
      const message = error instanceof Error ? error.message : "Failed to get response from OpenRouter";
      const status = /OPENROUTER_API_KEY/.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    }
    },
  );

  app.post("/api/admin-agent/history/reset", requireRoles(["owner", "admin", "operator"]), adminAgentRateLimit, async (req: AuthenticatedRequest, res) => {
    try {
      adminAgentSharedHistory = [];
      await recordAudit(req, "admin_agent.history_reset", "workspace", "admin_agent", {
        source: "ui",
      });
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Admin agent history reset error:", error);
      return res.status(500).json({ error: "Failed to reset admin agent history" });
    }
  });

  app.post(
    "/api/admin-agent/chat",
    requireRoles(["owner", "admin", "operator"]),
    requireEventScope({ bodyKey: "event_id", allowDefault: true, allowCheckinAccess: false }),
    adminAgentRateLimit,
    async (req: AuthenticatedRequest, res) => {
    try {
      const body = readObjectBody(req);
      const issues: ValidationIssue[] = [];
      const message = readRequiredString(body, "message", issues, { label: "message", maxLength: 8000 });
      if (issues.length > 0) {
        return respondValidationError(res, issues);
      }

      const history = Array.isArray(body.history) ? (body.history as ChatHistoryMessage[]) : [];
      const eventId = getRequestedEventId(req);
      const settings = (body.settings && typeof body.settings === "object")
        ? body.settings as Record<string, any>
        : await getSettingsMap(eventId);
      const parsedScope = parseAdminAgentEventOverride(message, eventId);
      const requestedEventId = normalizeOptionalText(parsedScope.eventId) || eventId;
      const globalAgentSettings = await getAdminAgentGlobalSettings();
      if (!globalAgentSettings.enabled) {
        return res.status(403).json({ error: "Admin Agent is disabled. Enable it in Agent Setup first." });
      }

      try {
        const execution = await runAdminAgentCommand({
          message,
          eventId,
          history,
          settings: {
            ...settings,
            ...(globalAgentSettings.systemPrompt ? { admin_agent_system_prompt: globalAgentSettings.systemPrompt } : {}),
            ...(globalAgentSettings.model ? { admin_agent_model: globalAgentSettings.model } : {}),
          },
          actorUserId: req.auth?.user.id || null,
          source: "admin_agent_planner",
          metadata: { mode: "ui" },
        });
        const effectiveEventId = normalizeOptionalText(execution.eventId) || requestedEventId;

        await recordAudit(
          req,
          execution.action ? "admin_agent.action_executed" : "admin_agent.clarification_requested",
          execution.targetType || "event",
          execution.targetId || effectiveEventId,
          {
            event_id: effectiveEventId,
            action: execution.action?.name || null,
            source: execution.action?.source || "llm",
            args: execution.action?.args || {},
            result: summarizeAdminAgentResultForAudit(execution.result),
          },
        );
        return res.json({
          reply: execution.reply,
          action: execution.action,
          result: execution.result,
          meta: execution.meta,
          event_id: effectiveEventId,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to execute admin action";
        await recordAudit(
          req,
          "admin_agent.action_failed",
          "event",
          requestedEventId,
          {
            event_id: requestedEventId,
            action: null,
            source: "llm",
            args: {},
            error: errorMessage,
          },
        );
        return res.status(getAdminAgentErrorStatusCode(errorMessage)).json({ error: errorMessage });
      }
    } catch (error) {
      console.error("Admin agent chat error:", error);
      const message = error instanceof Error ? error.message : "Failed to process admin agent request";
      const status = /OPENROUTER_API_KEY/.test(message) ? 400 : 500;
      return res.status(status).json({ error: message });
    }
    },
  );

  app.post("/api/admin-agent/telegram/webhook", webhookRateLimit, (req: RawBodyRequest, res) => {
    const payload = req.body;
    res.status(200).json({ status: "ok" });

    void (async () => {
      try {
        const settings = await getAdminAgentGlobalSettings();
        if (!settings.enabled || !settings.telegramEnabled || !settings.telegramBotToken) {
          return;
        }

        const providedSecret = typeof req.headers["x-telegram-bot-api-secret-token"] === "string"
          ? req.headers["x-telegram-bot-api-secret-token"]
          : "";
        if (settings.telegramWebhookSecret && providedSecret !== settings.telegramWebhookSecret) {
          console.warn("Rejected Admin Agent Telegram webhook due to invalid secret token");
          return;
        }

        const normalized = normalizeAdminAgentTelegramUpdate(payload);
        if (!normalized) return;
        const text = normalized.text;
        const allowedChatIds = parseAdminAgentTelegramAllowedChatIds(settings.telegramAllowedChatIdsRaw);
        if (allowedChatIds.size > 0 && !allowedChatIds.has(normalized.chatId)) {
          console.warn("Ignored Admin Agent Telegram message from unauthorized chat", {
            chat_id: normalized.chatId,
            update_id: normalized.updateId,
          });
          if (/^\/(?:start|help|id|myid)\b/i.test(text)) {
            await sendTelegramTextWithBotToken(
              settings.telegramBotToken,
              normalized.chatId,
              [
                "แชทนี้ยังไม่ได้รับอนุญาตให้ใช้ Admin Agent",
                `chat_id: ${normalized.chatId}`,
                "ให้นำ chat_id นี้ไปใส่ใน Allowed Chat IDs (หนึ่งบรรทัดต่อหนึ่ง ID)",
              ].join("\n"),
            );
          }
          return;
        }

        if (/^\/(?:id|myid)\b/i.test(text)) {
          await sendTelegramTextWithBotToken(
            settings.telegramBotToken,
            normalized.chatId,
            [
              "Admin Agent Chat ID",
              `chat_id: ${normalized.chatId}`,
              "คัดลอกค่า chat_id นี้ไปใส่ใน Allowed Chat IDs (หนึ่งบรรทัดต่อหนึ่ง ID)",
            ].join("\n"),
          );
          return;
        }

        if (/^\/start\b/i.test(text) || /^\/help\b/i.test(text)) {
          const helpMessage = [
            "Admin Agent พร้อมใช้งาน",
            "",
            "Telegram setup (step-by-step):",
            "1) เปิด Agent tab ในเว็บ แล้ว Enable Telegram Access + Save",
            "2) วาง Bot Token และตั้ง Webhook Secret Token ให้ตรงกัน",
            "3) เรียก setWebhook ด้วย URL /api/admin-agent/telegram/webhook",
            `4) พิมพ์ /myid เพื่อดู chat_id ของแชทนี้ (${normalized.chatId})`,
            "5) ใส่ Allowed Chat IDs ของแอดมินที่อนุญาต",
            "6) กลับมาที่ Telegram แล้วพิมพ์ /agent <คำสั่ง>",
            "",
            "ตัวอย่างคำสั่ง:",
            "- หาอีเวนต์ สหจะโยคะ 5 สัปดาห์",
            "- สร้างอีเวนต์ โปรแกรมใหม่ชื่อ Yoga Intro",
            "- ตั้งสถานะ event นี้เป็น active",
            "- อัปเดต context event นี้ว่า ...",
            "- สรุปอีเวนต์นี้",
            "- ขอรายละเอียดอีเวนต์นี้ทั้งหมด",
            "- นับจำนวนผู้ลงทะเบียนทั้งหมด",
            "- list registrations status registered",
            "- export registrations csv",
            "- ดูตั๋ว REG-XXXXXX",
            "- ลงทะเบียนใหม่ ชื่อ สมชาย ใจดี เบอร์ 0895551234 อีเมล somchai@example.com",
            "- ตั้งสถานะ REG-XXXXXX เป็น checked-in",
            "- หาชื่อ สมชาย ใจดี",
            "- ส่งข้อความถึง sender 123456 ว่า ติดตามรายละเอียดได้ที่ลิงก์นี้",
            "- timeline REG-XXXXXX",
            "- resend ticket REG-XXXXXX",
            "- resend email REG-XXXXXX",
            "- retry bot sender 123456",
            "- /event evt_xxx แล้วตามด้วยคำสั่ง",
          ].join("\n");
          await sendTelegramTextWithBotToken(settings.telegramBotToken, normalized.chatId, helpMessage);
          return;
        }

        const parsedCommand = parseAdminAgentEventOverride(text, settings.defaultEventId || DEFAULT_EVENT_ID);
        const eventId = normalizeOptionalText(parsedCommand.eventId) || DEFAULT_EVENT_ID;
        const command = normalizeOptionalText(parsedCommand.command);
        if (!command) {
          await sendTelegramTextWithBotToken(
            settings.telegramBotToken,
            normalized.chatId,
            "กรุณาพิมพ์คำสั่งหลัง /agent หรือส่งคำสั่งตรงๆ",
          );
          return;
        }

        try {
          const execution = await runAdminAgentCommand({
            message: command,
            eventId,
            history: [],
            settings: {
              ...(settings.systemPrompt ? { admin_agent_system_prompt: settings.systemPrompt } : {}),
              ...(settings.model ? { admin_agent_model: settings.model } : {}),
            },
            source: "admin_agent_telegram",
            metadata: {
              mode: "telegram",
              chat_id: normalized.chatId,
              update_id: normalized.updateId,
            },
          });

          const replyText = execution.action
            ? `[${execution.action.name}] ${execution.reply}`
            : execution.reply;
          const effectiveEventId = normalizeOptionalText(execution.eventId) || eventId;

          await sendTelegramTextWithBotToken(settings.telegramBotToken, normalized.chatId, replyText);
          const ticketUrls = extractAdminAgentTicketUrls(execution.result);
          if (ticketUrls.pngUrl) {
            try {
              await sendTelegramPhotoWithBotToken(
                settings.telegramBotToken,
                normalized.chatId,
                ticketUrls.pngUrl,
                "Ticket preview",
              );
            } catch (error) {
              console.warn("Failed to send admin ticket PNG preview to Telegram:", error);
              await sendTelegramTextWithBotToken(
                settings.telegramBotToken,
                normalized.chatId,
                `Ticket PNG: ${ticketUrls.pngUrl}`,
              );
            }
          } else if (ticketUrls.svgUrl) {
            await sendTelegramTextWithBotToken(
              settings.telegramBotToken,
              normalized.chatId,
              `Ticket SVG: ${ticketUrls.svgUrl}`,
            );
          }
          if (execution.action?.name === "export_registrations_csv") {
            const exportBundle = await buildAdminAgentRegistrationCsvBundle(
              effectiveEventId,
              execution.action.args,
              command,
            );
            if (exportBundle.totalMatches > 0) {
              await sendTelegramDocumentWithBotToken(
                settings.telegramBotToken,
                normalized.chatId,
                exportBundle.filename,
                exportBundle.csv,
                `CSV ผู้ลงทะเบียน ${exportBundle.totalMatches} รายการ`,
              );
            }
          }

          await appDb.recordAuditLog({
            actor_user_id: null,
            action: execution.action ? "admin_agent.telegram_action_executed" : "admin_agent.telegram_clarification",
            target_type: execution.targetType || "event",
            target_id: execution.targetId || effectiveEventId,
            metadata: {
              event_id: effectiveEventId,
              chat_id: normalized.chatId,
              action: execution.action?.name || null,
              args: execution.action?.args || {},
              result: summarizeAdminAgentResultForAudit(execution.result),
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to execute admin command";
          await sendTelegramTextWithBotToken(settings.telegramBotToken, normalized.chatId, `Error: ${message}`);
          await appDb.recordAuditLog({
            actor_user_id: null,
            action: "admin_agent.telegram_action_failed",
            target_type: "event",
            target_id: eventId,
            metadata: {
              event_id: eventId,
              chat_id: normalized.chatId,
              error: message,
            },
          });
        }
      } catch (error) {
        console.error("Admin Agent Telegram webhook failed:", error);
      }
    })();
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
      const bodyKeys = req.body && typeof req.body === "object"
        ? Object.keys(req.body as Record<string, unknown>)
        : [];
      if (!destination) {
        console.warn("Rejected LINE webhook because destination is missing", {
          body_keys: bodyKeys,
          raw_body_length: req.rawBody?.length || 0,
        });
        return res.sendStatus(404);
      }

      const channel = await getLineChannel(destination);
      if (!channel) {
        console.warn("Rejected LINE webhook because destination did not match an active LINE channel", {
          destination: maskLineDebugValue(destination),
          body_keys: bodyKeys,
          raw_body_length: req.rawBody?.length || 0,
          saved_line_channels: await buildLineWebhookDebugContext(),
        });
        return res.sendStatus(404);
      }

      const signature = typeof req.headers["x-line-signature"] === "string" ? req.headers["x-line-signature"] : "";
      const channelSecret = await getLineChannelSecret(destination);
      if (!verifyLineWebhookSignature(req.rawBody, signature, channelSecret)) {
        console.warn("Rejected LINE webhook due to invalid signature", {
          destination: maskLineDebugValue(destination),
          signature_present: Boolean(signature),
          raw_body_length: req.rawBody?.length || 0,
          channel_secret_configured: Boolean(channelSecret),
          channel_id: channel.id,
        });
        return res.sendStatus(401);
      }

      res.status(200).json({ status: "ok" });

      const events = Array.isArray(req.body?.events) ? req.body.events : [];
      if (events.length === 0) {
        console.info("Accepted LINE webhook verification request", {
          destination: maskLineDebugValue(destination),
          channel_id: channel.id,
          event_id: channel.event_id,
          body_keys: bodyKeys,
        });
      } else {
        console.info("Accepted LINE webhook request", {
          destination: maskLineDebugValue(destination),
          channel_id: channel.id,
          event_id: channel.event_id,
          event_count: events.length,
          event_types: events.slice(0, 5).map((event) => String(event?.type || "").trim() || "unknown"),
        });
      }
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

      await saveMessage(senderId, text, "incoming", eventId, widgetKey);
      markInboundConversationActivity(buildInboundConversationKey("webchat", senderId, eventId));

      const preparedTurn = await prepareBundledConversationTurnForSender("webchat", senderId, eventId, {
        burstWindowMs: WEBCHAT_BURST_WINDOW_MS,
      });

      let replyText = "";
      let ticketRegistrationIds: string[] = [];
      if (preparedTurn) {
        try {
          const result = await generateReplyForPreparedTurn(senderId, eventId, preparedTurn);
          replyText = result.text;
          ticketRegistrationIds = result.ticketRegistrationIds;
          clearFailedInboundTurn(preparedTurn.conversationKey);
        } catch (error) {
          console.error("Failed to generate web chat bot reply:", error);
          rememberFailedInboundTurn(
            preparedTurn.conversationKey,
            preparedTurn,
            error instanceof Error ? error.message : String(error),
          );
          replyText = BOT_TEMPORARY_FAILURE_MESSAGE;
        }
      }

      if (replyText) {
        await saveMessage(senderId, replyText, "outgoing", eventId, widgetKey);
      }
      if (preparedTurn) {
        markPendingConversationHandled(preparedTurn.conversationKey, preparedTurn.highestPendingMessageId);
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

startServer().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
