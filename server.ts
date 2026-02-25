import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { Parser } from "json2csv";
import QRCode from "qrcode";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_DEFAULT_MODEL || "google/gemini-3-flash-preview";
const DB_PATH = process.env.DB_PATH || "bot.db";

const db = new Database(DB_PATH);

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT,
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    type TEXT
  );
  CREATE TABLE IF NOT EXISTS registrations (
    id TEXT PRIMARY KEY,
    sender_id TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    email TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'registered'
  );
`);

// Default settings
const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
insertSetting.run("context", "You are a helpful assistant for a Facebook Page. Be polite and professional.");
insertSetting.run("llm_model", DEFAULT_OPENROUTER_MODEL);
insertSetting.run("verify_token", "my_secret_verify_token");
insertSetting.run("event_name", "AI Innovation Summit 2026");
insertSetting.run("event_location", "Grand Ballroom, Tech Plaza");
insertSetting.run("event_map_url", "https://maps.app.goo.gl/example");
insertSetting.run("event_date", "2026-05-15T09:00");
insertSetting.run("event_description", "A gathering of AI enthusiasts and experts.");
insertSetting.run("event_travel", "Take the SkyTrain to Tech Station, Exit 3.");
insertSetting.run("reg_limit", "200");
insertSetting.run("reg_start", "2026-02-01T00:00");
insertSetting.run("reg_end", "2026-05-01T23:59");

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

type RegistrationRow = {
  id: string;
  sender_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  timestamp: string;
  status: string;
};

type ToolExecutionBundle = {
  messages: ChatHistoryMessage[];
  ticketRegistrationIds: string[];
};

type BotReplyResult = {
  text: string;
  ticketRegistrationIds: string[];
};

function buildEventInfo(settings: Record<string, any>) {
  return `
Current Event Details:
- Name: ${settings.event_name || ""}
- Location: ${settings.event_location || ""}
- Map: ${settings.event_map_url || ""}
- Date: ${settings.event_date ? new Date(settings.event_date).toLocaleString() : ""}
- Description: ${settings.event_description || ""}
- Travel: ${settings.event_travel || ""}
- Registration Limit: ${settings.reg_limit || ""}
- Registration Period: ${settings.reg_start ? new Date(settings.reg_start).toLocaleString() : ""} to ${settings.reg_end ? new Date(settings.reg_end).toLocaleString() : ""}
`;
}

function getSystemInstruction(settings: Record<string, any>) {
  return [
    settings.context || "",
    buildEventInfo(settings),
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

function isPublicRequestPath(reqPath: string) {
  if (reqPath === "/api/health") return true;
  if (reqPath === "/api/webhook") return true;
  if (/^\/api\/tickets\/[^/]+\.svg$/i.test(reqPath)) return true;
  return false;
}

function adminBasicAuth(req: any, res: any, next: any) {
  if (isPublicRequestPath(req.path || req.url || "")) {
    return next();
  }

  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;

  // Fail closed if admin credentials are not configured
  if (!user || !pass) {
    return res.status(503).send("Admin auth is not configured.");
  }

  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="FaceBotStudio Admin"');
    return res.status(401).send("Authentication required.");
  }

  const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  const providedUser = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
  const providedPass = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

  if (providedUser === user && providedPass === pass) {
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="FaceBotStudio Admin"');
  return res.status(401).send("Invalid credentials.");
}

function getSettingsMap() {
  const rows = db.prepare("SELECT * FROM settings").all() as Array<{ key: string; value: string }>;
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {} as Record<string, string>);
}

function getRegistrationById(id: string) {
  return db.prepare("SELECT * FROM registrations WHERE id = ?").get(id) as RegistrationRow | undefined;
}

function saveMessage(senderId: string, text: string, type: "incoming" | "outgoing") {
  db.prepare("INSERT INTO messages (sender_id, text, type) VALUES (?, ?, ?)").run(senderId, text, type);
}

function formatTicketDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleString();
}

function buildTicketImageUrl(registrationId: string) {
  if (!process.env.APP_URL) return null;
  const url = new URL(process.env.APP_URL);
  url.pathname = `/api/tickets/${encodeURIComponent(registrationId)}.svg`;
  url.search = "";
  return url.toString();
}

function renderTicketSvg(reg: RegistrationRow, settings: Record<string, string>, qrDataUrl: string) {
  const eventName = escapeXml(truncateText(settings.event_name || "Event Ticket", 42));
  const location = escapeXml(truncateText(settings.event_location || "-", 44));
  const eventDate = escapeXml(truncateText(formatTicketDate(settings.event_date || ""), 44));
  const attendeeName = escapeXml(truncateText(`${reg.first_name} ${reg.last_name}`.trim(), 36));
  const phone = escapeXml(truncateText(reg.phone || "-", 24));
  const email = escapeXml(truncateText(reg.email || "-", 34));
  const registrationId = escapeXml(reg.id);
  const issuedAt = escapeXml(formatTicketDate(reg.timestamp));
  const mapUrl = escapeXml(truncateText(settings.event_map_url || "", 56));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="640" viewBox="0 0 1080 640" role="img" aria-label="Event ticket ${registrationId}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="55%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <linearGradient id="panel" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#020617" flood-opacity="0.28"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="1080" height="640" fill="#e2e8f0"/>
  <g filter="url(#shadow)">
    <rect x="48" y="48" width="984" height="544" rx="34" fill="url(#bg)"/>
    <rect x="72" y="72" width="620" height="496" rx="26" fill="url(#panel)"/>
    <rect x="720" y="72" width="288" height="496" rx="26" fill="#ffffff" opacity="0.96"/>

    <circle cx="706" cy="164" r="14" fill="#e2e8f0"/>
    <circle cx="706" cy="476" r="14" fill="#e2e8f0"/>
    <line x1="706" y1="184" x2="706" y2="456" stroke="#bfdbfe" stroke-width="2" stroke-dasharray="8 9"/>
  </g>

  <text x="112" y="142" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#2563eb" letter-spacing="2">OFFICIAL REGISTRATION PASS</text>
  <text x="112" y="196" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="#0f172a">${eventName}</text>

  <rect x="112" y="226" width="540" height="2" fill="#e2e8f0"/>

  <text x="112" y="272" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#64748b" letter-spacing="1.5">ATTENDEE</text>
  <text x="112" y="314" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#0f172a">${attendeeName}</text>

  <text x="112" y="362" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#64748b" letter-spacing="1.5">REGISTRATION ID</text>
  <text x="112" y="404" font-family="Courier New, monospace" font-size="28" font-weight="700" fill="#1d4ed8">${registrationId}</text>

  <text x="112" y="452" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#64748b" letter-spacing="1.5">PHONE</text>
  <text x="112" y="486" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#0f172a">${phone}</text>

  <text x="112" y="528" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#64748b" letter-spacing="1.5">EMAIL</text>
  <text x="112" y="560" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#0f172a">${email}</text>

  <text x="736" y="120" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#64748b" letter-spacing="2">SCAN AT CHECK-IN</text>
  <rect x="744" y="138" width="240" height="240" rx="18" fill="#f8fafc" stroke="#e2e8f0"/>
  <image href="${qrDataUrl}" x="764" y="158" width="200" height="200" preserveAspectRatio="xMidYMid meet"/>

  <text x="736" y="418" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#64748b" letter-spacing="1.5">EVENT DATE</text>
  <text x="736" y="446" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#0f172a">${eventDate}</text>

  <text x="736" y="486" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#64748b" letter-spacing="1.5">LOCATION</text>
  <text x="736" y="514" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#0f172a">${location}</text>

  <text x="736" y="550" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="#64748b">Issued: ${issuedAt}</text>
  <text x="736" y="575" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#94a3b8">${mapUrl}</text>
</svg>`;
}

function getMessageHistoryForSender(senderId: string, limit = 12): ChatHistoryMessage[] {
  const rows = db.prepare(
    "SELECT text, type FROM messages WHERE sender_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
  ).all(senderId, limit) as Array<{ text: string; type: string }>;

  return rows
    .reverse()
    .map((row) => ({
      role: row.type === "incoming" ? "user" : "model",
      parts: [{ text: row.text || "" }],
    }));
}

function createRegistration(input: {
  sender_id: string;
  first_name: unknown;
  last_name: unknown;
  phone: unknown;
  email?: unknown;
}) {
  const senderId = String(input.sender_id || "").trim();
  const firstName = String(input.first_name || "").trim();
  const lastName = String(input.last_name || "").trim();
  const phone = String(input.phone || "").trim();
  const email = input.email == null ? "" : String(input.email).trim();

  if (!senderId || !firstName || !lastName || !phone) {
    return { statusCode: 400, content: { error: "Missing required registration fields" } };
  }

  const countRow = db.prepare("SELECT COUNT(*) as count FROM registrations WHERE status != 'cancelled'").get() as any;
  const limitRow = db.prepare("SELECT value FROM settings WHERE key = 'reg_limit'").get() as any;
  const limit = parseInt(limitRow?.value || "200");

  if (countRow.count >= limit) {
    return { statusCode: 400, content: { error: "Registration limit reached" } };
  }

  const startRow = db.prepare("SELECT value FROM settings WHERE key = 'reg_start'").get() as any;
  const endRow = db.prepare("SELECT value FROM settings WHERE key = 'reg_end'").get() as any;
  const now = new Date();
  const start = new Date(startRow?.value);
  const end = new Date(endRow?.value);

  if (!Number.isNaN(start.getTime()) && now < start) {
    return { statusCode: 400, content: { error: "Registration has not started yet" } };
  }
  if (!Number.isNaN(end.getTime()) && now > end) {
    return { statusCode: 400, content: { error: "Registration has closed" } };
  }

  const id = "REG-" + Math.random().toString(36).substring(2, 8).toUpperCase();
  db.prepare(`
    INSERT INTO registrations (id, sender_id, first_name, last_name, phone, email)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, senderId, firstName, lastName, phone, email);

  return { statusCode: 200, content: { id, status: "success" } };
}

function cancelRegistration(id: unknown) {
  const registrationId = String(id || "").trim();
  if (!registrationId) {
    return { statusCode: 400, content: { error: "Registration ID is required" } };
  }

  const result = db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").run(registrationId);
  if (result.changes > 0) {
    return { statusCode: 200, content: { status: "success" } };
  }
  return { statusCode: 404, content: { error: "Registration not found" } };
}

async function requestOpenRouterChat(
  message: string,
  history: ChatHistoryMessage[],
  settings: Record<string, any>,
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
          content: getSystemInstruction(settings),
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

function buildToolResponseMessages(
  senderId: string,
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): ToolExecutionBundle {
  const messages: ChatHistoryMessage[] = [];
  const ticketRegistrationIds: string[] = [];

  for (const call of calls) {
    let content: Record<string, unknown>;

    if (call.name === "registerUser") {
      const result = createRegistration({
        sender_id: senderId,
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
      const result = cancelRegistration(call.args.registration_id);
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
  incomingText: string,
  historyOverride?: ChatHistoryMessage[],
): Promise<BotReplyResult> {
  const settings = getSettingsMap();
  const history = historyOverride || getMessageHistoryForSender(senderId, 12);

  const firstResponse = await requestOpenRouterChat(incomingText, history, settings);
  let finalResponse = firstResponse;
  let ticketRegistrationIds: string[] = [];

  if (firstResponse.functionCalls && firstResponse.functionCalls.length > 0) {
    const toolResult = buildToolResponseMessages(senderId, firstResponse.functionCalls);
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
    );
  }

  return {
    text: getTextFromNormalizedResponse(finalResponse),
    ticketRegistrationIds,
  };
}

async function sendFacebookTextMessage(recipientId: string, text: string) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
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

async function sendFacebookImageMessage(recipientId: string, imageUrl: string) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
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

async function handleIncomingFacebookText(senderId: string, text: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  const priorHistory = getMessageHistoryForSender(senderId, 12);
  saveMessage(senderId, trimmed, "incoming");

  if (!process.env.PAGE_ACCESS_TOKEN) {
    console.warn("PAGE_ACCESS_TOKEN is not set; skipping outbound Facebook reply");
    return;
  }

  let replyText = "";
  let ticketRegistrationIds: string[] = [];
  try {
    const result = await generateBotReplyForSender(senderId, trimmed, priorHistory);
    replyText = result.text;
    ticketRegistrationIds = result.ticketRegistrationIds;
  } catch (error) {
    console.error("Failed to generate bot reply:", error);
    replyText = "ขออภัย ระบบตอบกลับอัตโนมัติขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง";
  }

  if (replyText) {
    await sendFacebookTextMessage(senderId, replyText);
    saveMessage(senderId, replyText, "outgoing");
  }

  const uniqueTicketIds = [...new Set(ticketRegistrationIds)];
  for (const registrationId of uniqueTicketIds) {
    const ticketUrl = buildTicketImageUrl(registrationId);
    if (!ticketUrl) {
      console.warn("APP_URL is not set; skipping ticket image send");
      continue;
    }

    try {
      await sendFacebookImageMessage(senderId, ticketUrl);
      saveMessage(senderId, `[ticket-image] ${registrationId}`, "outgoing");
    } catch (error) {
      console.error("Failed to send ticket image:", error);
      try {
        await sendFacebookTextMessage(senderId, `ตั๋วของคุณ: ${ticketUrl}`);
        saveMessage(senderId, `[ticket-link] ${registrationId}`, "outgoing");
      } catch (fallbackError) {
        console.error("Failed to send ticket link fallback:", fallbackError);
      }
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));
  app.use(adminBasicAuth);

  const PORT = Number(process.env.PORT || 3000);

  // API Routes
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/registrations", (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM registrations ORDER BY timestamp DESC").all();
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch registrations" });
    }
  });

  app.post("/api/registrations", (req, res) => {
    try {
      const result = createRegistration(req.body || {});
      res.status(result.statusCode).json(result.content);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to register user" });
    }
  });

  app.post("/api/registrations/checkin", (req, res) => {
    try {
      const { id } = req.body;
      const result = db.prepare("UPDATE registrations SET status = 'checked-in' WHERE id = ? AND status != 'cancelled'").run(id);
      if (result.changes > 0) {
        res.json({ status: "success" });
      } else {
        res.status(404).json({ error: "Registration not found or already cancelled" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to check in" });
    }
  });

  app.post("/api/registrations/cancel", (req, res) => {
    try {
      const result = cancelRegistration(req.body?.id);
      res.status(result.statusCode).json(result.content);
    } catch (error) {
      res.status(500).json({ error: "Failed to cancel registration" });
    }
  });

  app.get("/api/registrations/export", (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM registrations").all();
      const eventNameRow = db.prepare("SELECT value FROM settings WHERE key = 'event_name'").get() as any;
      const eventName = eventNameRow?.value || "event";
      
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

  app.get("/api/tickets/:id.svg", async (req, res) => {
    try {
      const registrationId = String(req.params.id || "").trim().toUpperCase();
      if (!registrationId) {
        return res.status(400).send("Missing registration ID");
      }

      const reg = getRegistrationById(registrationId);
      if (!reg) {
        return res.status(404).send("Ticket not found");
      }

      const settings = getSettingsMap();
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

  app.get("/api/settings", (req, res) => {
    try {
      res.json(getSettingsMap());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", (req, res) => {
    try {
      const body = req.body;
      const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      
      Object.entries(body).forEach(([key, value]) => {
        stmt.run(key, String(value));
      });
      
      res.json({ status: "ok" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  app.get("/api/messages", (req, res) => {
    try {
      const messages = db.prepare("SELECT * FROM messages ORDER BY timestamp DESC LIMIT 100").all();
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.get("/api/llm/models", async (req, res) => {
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

  app.post("/api/llm/chat", async (req, res) => {
    try {
      const body = req.body || {};
      const message = typeof body.message === "string" ? body.message : "";
      const history = Array.isArray(body.history) ? (body.history as ChatHistoryMessage[]) : [];
      const settings = (body.settings && typeof body.settings === "object") ? body.settings as Record<string, any> : {};
      const response = await requestOpenRouterChat(message, history, settings);
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
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const verifyTokenRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("verify_token") as any;

    if (mode && token) {
      if (mode === "subscribe" && token === verifyTokenRow?.value) {
        console.log("WEBHOOK_VERIFIED");
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(400);
    }
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
        const text = webhookEvent?.message?.text;
        const isEcho = webhookEvent?.message?.is_echo;
        if (!senderId || !text || isEcho) continue;

        void handleIncomingFacebookText(senderId, text).catch((error) => {
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
