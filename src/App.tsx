import { useDeferredValue, useState, useEffect, useRef, type ButtonHTMLAttributes, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";
import QRCode from "qrcode";
import { 
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowUpRight,
  MessageSquare, 
  Settings as SettingsIcon, 
  Code, 
  Activity, 
  Send, 
  Bot, 
  User,
  RefreshCw,
  Save,
  Copy,
  CheckCircle2,
  AlertCircle,
  Users,
  Download,
  QrCode,
  Search,
  Camera,
  Play,
  Square,
  ExternalLink,
  Shield,
  LogOut,
  UserPlus,
  CalendarRange,
  Link2,
  Lock,
  MonitorCog,
  Plus,
  Trash2,
  ChevronDown,
  MoreHorizontal,
  CircleHelp,
  Eye,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  PencilLine,
  Power,
  Phone,
  X,
} from "lucide-react";
import { getAdminAgentResponse, getChatResponse } from "./services/gemini";
import { ChatBubble } from "./components/ChatBubble";
import { EmailHtmlEditor } from "./components/EmailHtmlEditor";
import { Ticket } from "./components/Ticket";
import { AdminEmailStatusResponse, AdminEmailTestResponse, AuthUser, ChannelAccountRecord, ChannelPlatform, ChannelPlatformDefinition, CheckinAccessSession, CheckinSessionRecord, EmbeddingPreviewResponse, EventDocumentChunkRecord, EventDocumentRecord, EventRecord, EventStatus, LlmUsageSummary, Message, PublicEventChatHistoryResponse, PublicEventChatResponse, PublicEventPageResponse, PublicEventRecoveredRegistrationResponse, PublicEventRegistrationResponse, PublicInboxConversationDetailResponse, PublicInboxConversationStatus, PublicInboxConversationSummary, PublicInboxReplyResponse, RetrievalDebugResponse, Settings, UserRole } from "./types";
import { EMAIL_TEMPLATE_DEFAULTS, EMAIL_TEMPLATE_KIND_OPTIONS, getEmailTemplateSettingKey, replaceEmailTemplateTokens, type EmailTemplateKind } from "./lib/emailTemplateCatalog";
import { buildEventLocationSummary, buildGoogleMapsEmbedUrl, formatEventLocationCompact, resolveEventMapUrl } from "./lib/eventLocation";
import { PUBLIC_SUMMARY_MAX_WORDS, countApproxWords, resolveEnglishPublicSlug, resolvePublicSummary, sanitizeEnglishSlugInput } from "./lib/publicEventPage";

interface Registration {
  id: string;
  sender_id: string;
  event_id?: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  timestamp: string;
  status: string;
}

interface LlmModelOption {
  id: string;
  name: string;
  context_length?: number;
}

type PublicRegistrationFormState = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
};

type PublicTicketLookupFormState = {
  phone: string;
  email: string;
  attendee_name: string;
};

type PublicChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  mapUrl: string;
  tickets: PublicEventChatResponse["tickets"];
  serverMessageId?: number;
};

const PUBLIC_PAGE_QR_SIZE = 960;
const PUBLIC_PAGE_QR_MARGIN = 2;

function isRecoveredPublicRegistrationResult(
  value: PublicEventRegistrationResponse | null,
): value is PublicEventRecoveredRegistrationResponse {
  return Boolean(
    value
    && (value.status === "success" || value.status === "duplicate" || value.status === "recovered"),
  );
}

interface AuditLogEntry {
  id: number;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

type RegistrationStatus = "registered" | "cancelled" | "checked-in";
type RegistrationWindowUiState = "open" | "not_started" | "closed" | "invalid";
type RegistrationAvailabilityUiState = RegistrationWindowUiState | "full";
type ThemeMode = "light" | "dark" | "system";
type AppTab = "event" | "mail" | "design" | "test" | "agent" | "logs" | "settings" | "team" | "registrations" | "checkin" | "inbox";
type AgentWorkspaceView = "console" | "setup";
type EventWorkspaceView = "setup" | "public";
type EventWorkspaceFilter = "all" | EventStatus;
type EventWorkspaceSort = "event_start_desc" | "name_asc" | "modified_desc";
type BadgeTone = "neutral" | "blue" | "emerald" | "amber" | "rose" | "violet";
type ActionTone = BadgeTone;
type BannerTone = "neutral" | "blue" | "emerald" | "amber" | "rose";

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

type GlobalSearchResultKind = "event" | "registration" | "channel" | "document" | "log";
type SearchFocusTarget = { kind: GlobalSearchResultKind; id: string } | null;
type WebhookConfigKey =
  | "facebook"
  | "line"
  | "instagram"
  | "whatsapp"
  | "telegram"
  | "webchat_config"
  | "webchat_message";

type AdminAgentChatMessage = {
  role: "user" | "agent";
  text: string;
  timestamp: string;
  actionName?: string;
  actionSource?: "llm" | "rule";
  ticketPngUrl?: string;
  ticketSvgUrl?: string;
  csvDownloadUrl?: string;
};

type AdminAgentCommandTemplate = {
  id: string;
  label: string;
  command: string;
  note: string;
  keywords: string[];
};

type AdminAgentDashboardEventSummary = {
  id: string;
  name: string;
  slug: string;
  effective_status: EventStatus;
  registration_availability: EventRecord["registration_availability"] | null;
  updated_at: string;
  total_registrations: number;
  registered_count: number;
  cancelled_count: number;
  checked_in_count: number;
  is_selected: boolean;
  is_default: boolean;
};

type AdminAgentDashboardResponse = {
  generated_at: string;
  selected_event_id: string | null;
  summary: {
    total_events: number;
    operational_events: number;
    active_events: number;
    pending_events: number;
    inactive_events: number;
    history_events: number;
    closed_events: number;
    cancelled_events: number;
    archived_events: number;
    total_registrations: number;
    registered_registrations: number;
    cancelled_registrations: number;
    checked_in_registrations: number;
    selected_event_registrations: number;
    selected_event_registered: number;
    selected_event_cancelled: number;
    selected_event_checked_in: number;
  };
  events: AdminAgentDashboardEventSummary[];
};

let qrReaderCtorPromise: Promise<typeof import("@zxing/browser").BrowserQRCodeReader> | null = null;

async function loadQrReaderCtor() {
  if (!qrReaderCtorPromise) {
    qrReaderCtorPromise = import("@zxing/browser").then((module) => module.BrowserQRCodeReader);
  }
  return qrReaderCtorPromise;
}

interface HelpContent {
  title: string;
  summary: string;
  points: Array<{
    label: string;
    body: string;
  }>;
}

const TAB_HELP_CONTENT: Record<AppTab, HelpContent> = {
  event: {
    title: "Event Workspace Help",
    summary: "Keep operational event facts here. This tab defines what the event is and when registration should behave as open, closed, or unavailable.",
    points: [
      {
        label: "Event details",
        body: "Name, location, date, description, travel notes, and map URL belong here because they are first-party facts about the event itself.",
      },
      {
        label: "Registration rules",
        body: "Open and close dates are evaluated in the selected event time zone. If the close date is earlier than the open date, registration will stay unavailable.",
      },
      {
        label: "Lifecycle",
        body: "Manual status still matters, but the effective status can auto-close once the event end time is already in the past, or the start time if no end is set.",
      },
    ],
  },
  mail: {
    title: "Mail Workspace Help",
    summary: "Transactional email is managed separately so template editing, readiness checks, and test sends do not compete with event setup layout.",
    points: [
      {
        label: "Sender readiness",
        body: "Provider, sender address, reply-to, and app URL come from environment variables. This workspace surfaces whether that runtime config is actually ready to send.",
      },
      {
        label: "Per-kind templates",
        body: "Registration confirmation, ticket delivery, payment confirmation, and event update emails should evolve independently so one flow does not force wording compromises on another.",
      },
      {
        label: "Preview before send",
        body: "Use the rendered subject, text, and HTML preview with a test send before wiring new paid or operational flows into production delivery.",
      },
    ],
  },
  design: {
    title: "Context Help",
    summary: "Use this tab for long-form knowledge that should guide responses for one event without cluttering the main screen.",
    points: [
      {
        label: "Event context",
        body: "Put FAQ, speaker notes, agenda details, venue policies, and structured reference text in the free-form context area.",
      },
      {
        label: "Knowledge documents",
        body: "Attached documents are stored separately so they can be chunked, inspected, enabled or disabled, and later upgraded into deeper retrieval flows.",
      },
      {
        label: "Reset actions",
        body: "Clear Knowledge Docs removes attached documents, chunks, and embedding state. Reset All Knowledge also wipes the free-form context text.",
      },
    ],
  },
  test: {
    title: "Test Console Help",
    summary: "Use the test surface to verify prompts, event context, and retrieval before exposing the flow to real users.",
    points: [
      {
        label: "Probe behavior",
        body: "Ask the bot representative questions and inspect whether the selected event is producing the right operational answers.",
      },
      {
        label: "Check retrieval",
        body: "When debugging, compare the response with the active documents and chunk inspector to confirm the correct knowledge source was used.",
      },
      {
        label: "Keep it isolated",
        body: "This tab is for simulation only. It should help verify behavior without changing production registrations or channels.",
      },
    ],
  },
  agent: {
    title: "Agent Console Help",
    summary: "Run operational admin commands here, and configure standalone Agent behavior including external Telegram access.",
    points: [
      {
        label: "Operational commands",
        body: "Use natural commands to find attendees, count registrations, resend ticket or email, and retry stuck bot replies.",
      },
      {
        label: "Dedicated setup",
        body: "Agent prompt, model override, default event routing, and Telegram webhook control live here instead of general event chat setup.",
      },
      {
        label: "External access",
        body: "Telegram can call this Agent without loading the web UI, with allowlisted chat IDs and webhook secret protection.",
      },
    ],
  },
  settings: {
    title: "Setup Help",
    summary: "Global controls live here: AI policy, channel wiring, team permissions, and integration endpoints.",
    points: [
      {
        label: "Global prompt",
        body: "Organization-wide tone, safety rules, and escalation behavior belong in the global system prompt. Event-specific content should stay in Context.",
      },
      {
        label: "Channel mapping",
        body: "Link channels to the selected event so incoming messages land in the correct workspace. Keep channel status healthy before going live.",
      },
      {
        label: "Model overrides",
        body: "Only set an event-level model override when one event truly needs different behavior. Otherwise keep the global default simple.",
      },
    ],
  },
  team: {
    title: "Team Access Help",
    summary: "Manage who can access the workspace, which role they have, and whether their account should remain active.",
    points: [
      {
        label: "Roles",
        body: "Use the lightest role that still fits the teammate's job. Owner and admin accounts should stay limited.",
      },
      {
        label: "Access control",
        body: "Disable access when someone should stop using the workspace but you still want to keep the account. Delete only when the account should be removed permanently.",
      },
      {
        label: "Onboarding",
        body: "Create new teammates here with a username, display name, password, and role so they can sign in immediately.",
      },
    ],
  },
  registrations: {
    title: "Registrations Help",
    summary: "Review attendee records, export data, and verify ticket state from one place.",
    points: [
      {
        label: "Selection",
        body: "Choose one attendee to inspect full details, ticket output, and operational status without losing the list context.",
      },
      {
        label: "Status control",
        body: "Use the action buttons for explicit operational changes. Badges indicate state only and are not interactive.",
      },
      {
        label: "Exports",
        body: "Use export flows only after confirming the selected event and current filters to avoid pulling the wrong attendee set.",
      },
    ],
  },
  checkin: {
    title: "Check-in Help",
    summary: "This tab is optimized for front-desk operations, with QR scanning first and manual lookup as fallback.",
    points: [
      {
        label: "Scanner flow",
        body: "Allow camera access and keep the attendee ticket inside the scan frame. The latest result panel confirms the most recent scan.",
      },
      {
        label: "Manual fallback",
        body: "If scanning fails, enter the registration ID directly. Use this only when the ticket or camera flow is unavailable.",
      },
      {
        label: "Access links",
        body: "Generate separate mobile-friendly check-in sessions for staff so they can work without full admin access.",
      },
    ],
  },
  inbox: {
    title: "Public Inbox Help",
    summary: "Monitor attendee conversations coming from the public event page, decide who needs follow-up, and keep the thread state explicit.",
    points: [
      {
        label: "Attention queue",
        body: "Threads move to waiting-admin when the attendee asks for a human or when the bot fails. Use that as the triage queue first.",
      },
      {
        label: "Status flow",
        body: "Mark waiting-user after you have given instructions and are expecting the attendee to respond. Mark resolved only when the issue is clearly closed.",
      },
      {
        label: "Scope",
        body: "This tab only covers conversations from the public event page. Messenger, LINE, and other channels remain in the general logs view.",
      },
    ],
  },
  logs: {
    title: "Logs Help",
    summary: "Use logs to inspect live conversations, traces, and failures without editing the underlying event setup.",
    points: [
      {
        label: "Trace first",
        body: "Start from status traces and message flow so you can separate channel delivery issues from model or retrieval issues.",
      },
      {
        label: "Event scope",
        body: "Logs are scoped to the selected event, so confirm the workspace before diagnosing missing or unexpected conversations.",
      },
      {
        label: "Operational use",
        body: "Use this tab for diagnosis and audit. Content or policy changes should still happen in Event, Context, or Setup.",
      },
    ],
  },
};

const ADMIN_AGENT_COMMAND_TEMPLATES: AdminAgentCommandTemplate[] = [
  {
    id: "list-events",
    label: "List All Events",
    command: "list events",
    note: "ลิสต์ event ทั้งหมดจาก DB ตาม policy ที่เปิดไว้",
    keywords: ["event", "list", "all", "workspace", "ทั้งหมด"],
  },
  {
    id: "list-events-operational",
    label: "List Operational Events",
    command: "list events type:operational",
    note: "ดูเฉพาะ active, pending, inactive",
    keywords: ["event", "operational", "active", "pending", "inactive", "workspace"],
  },
  {
    id: "list-events-pending",
    label: "List Pending Events",
    command: "list events status:pending",
    note: "ดูเฉพาะงานที่ยังไม่เริ่ม",
    keywords: ["event", "pending", "upcoming", "รอดำเนินการ"],
  },
  {
    id: "list-events-history",
    label: "List History Events",
    command: "list events type:history",
    note: "ดู closed, cancelled, archived",
    keywords: ["event", "history", "closed", "cancelled", "archived", "ย้อนหลัง"],
  },
  {
    id: "find-event",
    label: "Find Event",
    command: 'find_event query="โปรแกรมสหจะโยคะ 5 สัปดาห์"',
    note: "ค้นหาอีเวนต์จากชื่อบางส่วน",
    keywords: ["event", "find", "search", "อีเวนต์", "ค้นหา"],
  },
  {
    id: "event-overview",
    label: "Event Overview",
    command: "get_event_overview",
    note: "ดูสรุปสถานะงาน เวลา สถานที่ กติกา และยอดลงทะเบียน",
    keywords: ["overview", "status", "summary", "สรุป", "สถานะงาน"],
  },
  {
    id: "search-system",
    label: "Search System",
    command: 'search_system query="สุขุมวิท"',
    note: "ค้นหาทั้งระบบทุกอีเวนต์",
    keywords: ["global", "search", "cross", "ระบบ", "ค้นทั้งระบบ"],
  },
  {
    id: "list-registrations",
    label: "List Registrations",
    command: "list_registrations limit=50",
    note: "ดึงรายชื่อผู้ลงทะเบียนล่าสุดตาม event ปัจจุบัน",
    keywords: ["registration", "list", "attendees", "รายชื่อ", "ลงทะเบียน"],
  },
  {
    id: "list-registrations-offset",
    label: "List More (Offset)",
    command: "list_registrations limit=50 offset=50",
    note: "ดึงรายการถัดไปจากชุดก่อนหน้า",
    keywords: ["offset", "pagination", "more", "ต่อ", "ถัดไป"],
  },
  {
    id: "count-registrations",
    label: "Count Registrations",
    command: "count_registrations",
    note: "นับจำนวนผู้ลงทะเบียนรวมและแยกสถานะ",
    keywords: ["count", "totals", "นับ", "จำนวน"],
  },
  {
    id: "find-registration-name",
    label: "Find By Name",
    command: 'find_registration full_name="ชื่อ นามสกุล"',
    note: "ค้นหาผู้ลงทะเบียนจากชื่อ-นามสกุล",
    keywords: ["find", "name", "registration", "ค้นหา", "ชื่อ"],
  },
  {
    id: "find-registration-id",
    label: "Find By Registration ID",
    command: "find_registration registration_id=REG-XXXXXX",
    note: "ค้นหาจากเลขทะเบียน",
    keywords: ["reg", "id", "lookup", "เลขทะเบียน"],
  },
  {
    id: "create-registration",
    label: "Create Registration",
    command: 'create_registration first_name="สมชาย" last_name="ใจดี" phone="0890000000" email="somchai@example.com"',
    note: "ลงทะเบียนผู้เข้าร่วมใหม่",
    keywords: ["create", "register", "ลงทะเบียน", "new attendee"],
  },
  {
    id: "set-registration-status",
    label: "Set Registration Status",
    command: "set_registration_status registration_id=REG-XXXXXX status=checked-in",
    note: "เปลี่ยนสถานะผู้ลงทะเบียน",
    keywords: ["status", "checkin", "cancel", "สถานะ"],
  },
  {
    id: "timeline",
    label: "Registration Timeline",
    command: "get_registration_timeline registration_id=REG-XXXXXX",
    note: "ดูประวัติแชทของผู้ลงทะเบียนคนนั้น",
    keywords: ["timeline", "history", "chat", "ประวัติ"],
  },
  {
    id: "view-ticket",
    label: "View Ticket (Admin)",
    command: "view_ticket registration_id=REG-XXXXXX",
    note: "ดูตั๋วสำหรับแอดมิน โดยไม่ส่งไปหา user",
    keywords: ["ticket", "preview", "admin", "ดูตั๋ว"],
  },
  {
    id: "resend-ticket",
    label: "Resend Ticket To User",
    command: "resend_ticket registration_id=REG-XXXXXX sender_id=USER_SENDER_ID",
    note: "ส่งตั๋วไปยัง user channel เดิม",
    keywords: ["ticket", "resend", "send user", "ส่งตั๋ว"],
  },
  {
    id: "resend-email",
    label: "Resend Email",
    command: "resend_email registration_id=REG-XXXXXX",
    note: "ส่งอีเมลยืนยันซ้ำ",
    keywords: ["email", "resend", "ส่งเมล"],
  },
  {
    id: "export-csv",
    label: "Export CSV",
    command: "export_registrations_csv",
    note: "ส่งไฟล์ CSV รายชื่อทั้งหมด",
    keywords: ["csv", "export", "excel", "ไฟล์"],
  },
  {
    id: "send-message",
    label: "Send Message To Sender",
    command: 'send_message_to_sender sender_id=USER_SENDER_ID message="ข้อความที่ต้องการส่ง"',
    note: "ส่งข้อความ manual ไปยัง user",
    keywords: ["message", "sender", "manual", "ส่งข้อความ"],
  },
  {
    id: "retry-bot",
    label: "Retry Bot",
    command: "retry_bot sender_id=USER_SENDER_ID",
    note: "กระตุ้นบอทให้ตอบต่อใน thread เดิม",
    keywords: ["retry", "stuck", "resume", "ค้าง"],
  },
  {
    id: "update-event-status",
    label: "Update Event Status",
    command: "update_event_status status=active",
    note: "เปลี่ยนสถานะงาน เช่น active/inactive/pending/cancelled",
    keywords: ["event", "status", "active", "inactive"],
  },
  {
    id: "update-event-context",
    label: "Update Event Context",
    command: 'update_event_context mode=replace context="รายละเอียดใหม่..."',
    note: "อัปเดตข้อความ context ของงาน",
    keywords: ["context", "update", "event", "รายละเอียด"],
  },
  {
    id: "event-override",
    label: "Cross-Event Scope",
    command: "/event evt_xxx get_event_overview",
    note: "สั่งงานข้าม event แบบระบุ event id",
    keywords: ["event", "override", "scope", "ข้ามงาน"],
  },
];
const ADMIN_AGENT_CONSOLE_QUICK_TEMPLATE_IDS = [
  "list-events",
  "list-events-operational",
  "list-events-pending",
  "list-events-history",
  "event-overview",
] as const;

const MANAGEABLE_ROLES: UserRole[] = ["owner", "admin", "operator", "checker", "viewer"];
const THEME_STORAGE_KEY = "facebotstudio-theme";
const ADMIN_AGENT_CHAT_STORAGE_KEY = "facebotstudio-admin-agent-chat-v1";
const PUBLIC_EVENT_CHAT_SENDER_STORAGE_KEY_PREFIX = "facebotstudio-public-event-chat-sender-v1";
const PUBLIC_EVENT_CHAT_HISTORY_STORAGE_KEY_PREFIX = "facebotstudio-public-event-chat-history-v1";
const LOG_PAGE_SIZE = 200;
const COLLAPSED_SECTION_STORAGE_KEY = "facebotstudio-collapsed-sections-v1";
const COLLAPSIBLE_SECTION_KEYS = {
  contextEvent: "context-event",
  contextKnowledgeDocuments: "context-knowledge-documents",
  contextAttachedDocuments: "context-attached-documents",
  contextChunkInspector: "context-chunk-inspector",
  contextEmbeddingPreview: "context-embedding-preview",
  contextRetrievalDebug: "context-retrieval-debug",
  contextLlmUsage: "context-llm-usage",
  agentRuntime: "agent-runtime",
  agentExternalChannel: "agent-external-channel",
  setupChannels: "setup-channels",
  setupWebhookConfig: "setup-webhook-config",
} as const;
const CHANNEL_PLATFORM_WEBHOOK_MAP: Record<ChannelPlatform, WebhookConfigKey[]> = {
  facebook: ["facebook"],
  line_oa: ["line"],
  instagram: ["instagram"],
  whatsapp: ["whatsapp"],
  telegram: ["telegram"],
  web_chat: ["webchat_config", "webchat_message"],
};
const ADMIN_AGENT_DESKTOP_NOTIFY_PREF_STORAGE_KEY = "facebotstudio-admin-agent-desktop-notify-pref-v1";
const ADMIN_AGENT_DESKTOP_NOTIFY_LAST_AUDIT_STORAGE_KEY = "facebotstudio-admin-agent-desktop-notify-last-audit-v1";
const CSRF_COOKIE_NAME = "fbs_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const UNSAFE_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const INITIAL_CHECKIN_TOKEN =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("checkin_token")?.trim() || ""
    : "";

function getDefaultTabForRole(role: UserRole | null | undefined): AppTab {
  if (role === "checker") return "registrations";
  if (role === "viewer") return "logs";
  if (role === "operator") return "test";
  return "event";
}

function stripCheckinTokenFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("checkin_token")) return;
  url.searchParams.delete("checkin_token");
  const query = url.searchParams.toString();
  const nextUrl = `${url.pathname}${query ? `?${query}` : ""}${url.hash || ""}`;
  window.history.replaceState({}, document.title, nextUrl);
}

function getStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function getPublicEventChatSenderStorageKey(slug: string) {
  return `${PUBLIC_EVENT_CHAT_SENDER_STORAGE_KEY_PREFIX}:${slug}`;
}

function getPublicEventChatHistoryStorageKey(slug: string) {
  return `${PUBLIC_EVENT_CHAT_HISTORY_STORAGE_KEY_PREFIX}:${slug}`;
}

function createPublicChatMessage(
  role: PublicChatMessage["role"],
  text: string,
  options?: { mapUrl?: string; tickets?: PublicEventChatResponse["tickets"]; timestamp?: string; serverMessageId?: number },
): PublicChatMessage {
  const timestamp = options?.timestamp || new Date().toISOString();
  return {
    id: `${role}:${timestamp}:${Math.random().toString(36).slice(2, 10)}`,
    role,
    text,
    timestamp,
    mapUrl: options?.mapUrl || "",
    tickets: Array.isArray(options?.tickets) ? options?.tickets : [],
    serverMessageId: typeof options?.serverMessageId === "number" ? options.serverMessageId : undefined,
  };
}

function normalizeExternalHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function normalizePhoneHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/[^+\d]/g, "");
  return normalized ? `tel:${normalized}` : "";
}

function mergeServerMessagesIntoPublicChatHistory(current: PublicChatMessage[], rows: Message[]) {
  const next = [...current];
  for (const row of rows) {
    const rowId = typeof row.id === "number" ? row.id : Number.isFinite(Number(row.id)) ? Number(row.id) : undefined;
    const role = row.type === "incoming" ? "user" : "assistant";
    const text = String(row.text || "");
    const timestamp = String(row.timestamp || new Date().toISOString());
    const alreadyExists = next.some((message) =>
      (typeof rowId === "number" && typeof message.serverMessageId === "number" && message.serverMessageId === rowId)
      || (
        message.role === role
        && message.text.trim() === text.trim()
        && Math.abs(new Date(message.timestamp).getTime() - new Date(timestamp).getTime()) < 15_000
      ),
    );
    if (alreadyExists) continue;
    next.push(createPublicChatMessage(role, text, {
      timestamp,
      serverMessageId: rowId,
    }));
  }
  return next.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function readPublicEventChatHistory(slug: string) {
  if (typeof window === "undefined" || !slug) return [] as PublicChatMessage[];
  try {
    const raw = window.localStorage.getItem(getPublicEventChatHistoryStorageKey(slug));
    if (!raw) return [] as PublicChatMessage[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as PublicChatMessage[];
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        const role = row.role === "user" ? "user" : row.role === "assistant" ? "assistant" : null;
        const text = typeof row.text === "string" ? row.text : "";
        const timestamp = typeof row.timestamp === "string" ? row.timestamp : "";
        if (!role || !timestamp) return null;
        const tickets = Array.isArray(row.tickets)
          ? row.tickets
            .filter((item) => item && typeof item === "object")
            .map((item) => {
              const ticket = item as Record<string, unknown>;
              const registrationId = typeof ticket.registration_id === "string" ? ticket.registration_id : "";
              const summaryText = typeof ticket.summary_text === "string" ? ticket.summary_text : "";
              if (!registrationId) return null;
              return {
                registration_id: registrationId,
                summary_text: summaryText,
                png_url: typeof ticket.png_url === "string" && ticket.png_url.trim() ? ticket.png_url : null,
                svg_url: typeof ticket.svg_url === "string" && ticket.svg_url.trim() ? ticket.svg_url : null,
              };
            })
            .filter(Boolean) as PublicEventChatResponse["tickets"]
          : [];
        return {
          id: typeof row.id === "string" && row.id.trim()
            ? row.id
            : `${role}:${timestamp}:${Math.random().toString(36).slice(2, 10)}`,
          role,
          text,
          timestamp,
          mapUrl: typeof row.mapUrl === "string" ? row.mapUrl : "",
          tickets,
          serverMessageId:
            typeof row.serverMessageId === "number"
              ? row.serverMessageId
              : Number.isFinite(Number(row.serverMessageId))
                ? Number(row.serverMessageId)
                : undefined,
        } satisfies PublicChatMessage;
      })
      .filter(Boolean) as PublicChatMessage[];
  } catch {
    return [] as PublicChatMessage[];
  }
}

function writePublicEventChatHistory(slug: string, messages: PublicChatMessage[]) {
  if (typeof window === "undefined" || !slug) return;
  try {
    window.localStorage.setItem(
      getPublicEventChatHistoryStorageKey(slug),
      JSON.stringify(messages.slice(-80)),
    );
  } catch {
    // ignore storage write failures
  }
}

function getOrCreatePublicEventChatSenderId(slug: string) {
  if (typeof window === "undefined" || !slug) return "";
  const storageKey = getPublicEventChatSenderStorageKey(slug);
  const existing = window.localStorage.getItem(storageKey)?.trim() || "";
  if (existing) return existing;
  const next = `public-web:${slug}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  try {
    window.localStorage.setItem(storageKey, next);
  } catch {
    // ignore storage write failures
  }
  return next;
}

function readAdminAgentChatStore() {
  if (typeof window === "undefined") return {} as Record<string, AdminAgentChatMessage[]>;
  try {
    const raw = window.localStorage.getItem(ADMIN_AGENT_CHAT_STORAGE_KEY);
    if (!raw) return {} as Record<string, AdminAgentChatMessage[]>;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {} as Record<string, AdminAgentChatMessage[]>;
    const store: Record<string, AdminAgentChatMessage[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const messages = value
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const row = item as Record<string, unknown>;
          const role = row.role === "user" ? "user" : row.role === "agent" ? "agent" : null;
          const text = typeof row.text === "string" ? row.text : "";
          const timestamp = typeof row.timestamp === "string" ? row.timestamp : "";
          if (!role || !text || !timestamp) return null;
          const actionSource = row.actionSource === "rule" ? "rule" : "llm";
          const ticketPngUrl = typeof row.ticketPngUrl === "string" ? row.ticketPngUrl : "";
          const ticketSvgUrl = typeof row.ticketSvgUrl === "string" ? row.ticketSvgUrl : "";
          const csvDownloadUrl = typeof row.csvDownloadUrl === "string" ? row.csvDownloadUrl : "";
          return {
            role,
            text,
            timestamp,
            actionName: typeof row.actionName === "string" ? row.actionName : "",
            actionSource,
            ticketPngUrl,
            ticketSvgUrl,
            csvDownloadUrl,
          } satisfies AdminAgentChatMessage;
        })
        .filter(Boolean) as AdminAgentChatMessage[];
      if (messages.length > 0) {
        store[key] = messages.slice(-120);
      }
    }
    return store;
  } catch {
    return {} as Record<string, AdminAgentChatMessage[]>;
  }
}

function writeAdminAgentChatStore(store: Record<string, AdminAgentChatMessage[]>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_AGENT_CHAT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage write failures
  }
}

function readCollapsedSectionStore() {
  if (typeof window === "undefined") return {} as Record<string, boolean>;
  try {
    const raw = window.localStorage.getItem(COLLAPSED_SECTION_STORAGE_KEY);
    if (!raw) return {} as Record<string, boolean>;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {} as Record<string, boolean>;
    const normalized: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== "string" || !key.trim()) continue;
      normalized[key] = Boolean(value);
    }
    return normalized;
  } catch {
    return {} as Record<string, boolean>;
  }
}

function writeCollapsedSectionStore(map: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_SECTION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage write failures
  }
}

function getDesktopNotifyPrefStorageKey(userId: string) {
  return `${ADMIN_AGENT_DESKTOP_NOTIFY_PREF_STORAGE_KEY}:${userId}`;
}

function getDesktopNotifyLastAuditStorageKey(userId: string) {
  return `${ADMIN_AGENT_DESKTOP_NOTIFY_LAST_AUDIT_STORAGE_KEY}:${userId}`;
}

function readDesktopNotifyPreference(userId: string) {
  if (typeof window === "undefined" || !userId) return false;
  try {
    return window.localStorage.getItem(getDesktopNotifyPrefStorageKey(userId)) === "1";
  } catch {
    return false;
  }
}

function writeDesktopNotifyPreference(userId: string, enabled: boolean) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(getDesktopNotifyPrefStorageKey(userId), enabled ? "1" : "0");
  } catch {
    // ignore storage write failures
  }
}

function readDesktopNotifyLastAuditId(userId: string) {
  if (typeof window === "undefined" || !userId) return 0;
  try {
    const raw = window.localStorage.getItem(getDesktopNotifyLastAuditStorageKey(userId));
    const parsed = Number.parseInt(String(raw || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeDesktopNotifyLastAuditId(userId: string, id: number) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(getDesktopNotifyLastAuditStorageKey(userId), String(Math.max(0, Math.trunc(id || 0))));
  } catch {
    // ignore storage write failures
  }
}

function resolveThemeMode(mode: ThemeMode) {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark" as const;
  }
  return "light" as const;
}

function normalizeDateTimeLocalValue(value: string | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (match) {
    return `${match[1]}T${match[2]}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocalValue(value: string | undefined) {
  const normalized = normalizeDateTimeLocalValue(value);
  if (!normalized) return null;
  const [datePart, timePart] = normalized.split("T");
  if (!datePart || !timePart) return null;
  const [year, month, day] = datePart.split("-").map((part) => Number.parseInt(part, 10));
  const [hour, minute] = timePart.split(":").map((part) => Number.parseInt(part, 10));
  if ([year, month, day, hour, minute].some((valuePart) => !Number.isFinite(valuePart))) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function formatDateTimeLocalValue(date: Date) {
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getDefaultEventEndDate(startValue: string | undefined) {
  const startDate = parseDateTimeLocalValue(startValue);
  if (!startDate) return "";
  return formatDateTimeLocalValue(new Date(startDate.getTime() + 2 * 60 * 60 * 1000));
}

function getDefaultRegistrationCloseDate(startValue: string | undefined) {
  const startDate = parseDateTimeLocalValue(startValue);
  if (!startDate) return "";
  const closeDate = new Date(startDate);
  closeDate.setDate(closeDate.getDate() - 1);
  closeDate.setHours(17, 0, 0, 0);
  return formatDateTimeLocalValue(closeDate);
}

const DEFAULT_TIMEZONE = "Asia/Bangkok";
const EVENT_NAME_COLLATOR = new Intl.Collator(["th", "en"], { numeric: true, sensitivity: "base" });

function parseLineTraceMessage(text: string) {
  const match = String(text || "").match(/^\[line:([a-z-]+)\]\s*(.*)$/i);
  if (!match) return null;

  return {
    status: match[1].toLowerCase(),
    detail: match[2] || "",
  };
}

function parseInternalLogMarker(text: string) {
  const match = String(text || "").match(/^\[([a-z-]+)\]\s*(.*)$/i);
  if (!match) return null;

  const marker = match[1].toLowerCase();
  const detail = match[2] || "";
  const markerMap: Record<string, { label: string; tone: BadgeTone; actor: "manual" | "bot"; summarize: (value: string) => string }> = {
    "manual-reply": {
      label: "manual reply",
      tone: "violet",
      actor: "manual",
      summarize: (value) => value,
    },
    "manual-ticket-summary": {
      label: "manual ticket summary",
      tone: "violet",
      actor: "manual",
      summarize: (value) => `Resent ticket summary for ${value || "registration"}`,
    },
    "manual-ticket-image-png": {
      label: "manual ticket image",
      tone: "violet",
      actor: "manual",
      summarize: (value) => `Resent PNG ticket image for ${value || "registration"}`,
    },
    "manual-ticket-image-svg": {
      label: "manual ticket image",
      tone: "violet",
      actor: "manual",
      summarize: (value) => `Resent SVG ticket image for ${value || "registration"}`,
    },
    "manual-ticket-link": {
      label: "manual ticket link",
      tone: "violet",
      actor: "manual",
      summarize: (value) => `Resent ticket link for ${value || "registration"}`,
    },
    "manual-map-link": {
      label: "manual map link",
      tone: "violet",
      actor: "manual",
      summarize: (value) => value ? `Sent map link: ${value}` : "Sent map link",
    },
    "ticket-summary": {
      label: "bot ticket summary",
      tone: "blue",
      actor: "bot",
      summarize: (value) => `Bot sent ticket summary for ${value || "registration"}`,
    },
    "ticket-image-png": {
      label: "bot ticket image",
      tone: "blue",
      actor: "bot",
      summarize: (value) => `Bot sent PNG ticket image for ${value || "registration"}`,
    },
    "ticket-image-svg": {
      label: "bot ticket image",
      tone: "blue",
      actor: "bot",
      summarize: (value) => `Bot sent SVG ticket image for ${value || "registration"}`,
    },
    "ticket-link": {
      label: "bot ticket link",
      tone: "blue",
      actor: "bot",
      summarize: (value) => `Bot sent ticket link for ${value || "registration"}`,
    },
    "map-link": {
      label: "bot map link",
      tone: "blue",
      actor: "bot",
      summarize: (value) => value ? `Bot sent map link: ${value}` : "Bot sent map link",
    },
  };

  const config = markerMap[marker];
  if (!config) return null;

  return {
    marker,
    label: config.label,
    tone: config.tone,
    actor: config.actor,
    detail,
    summary: config.summarize(detail),
  };
}

function formatTraceStatusLabel(status: string) {
  return status
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getLogMessageDisplayText(message: Message) {
  const lineTrace = parseLineTraceMessage(message.text);
  if (lineTrace) {
    return lineTrace.detail || formatTraceStatusLabel(lineTrace.status);
  }

  const auditMarker = parseInternalLogMarker(message.text);
  if (auditMarker) {
    return auditMarker.marker === "manual-reply" ? auditMarker.detail : auditMarker.summary;
  }

  return message.text;
}

function getLogDirectionMeta(type: string) {
  if (type === "incoming") {
    return {
      label: "Incoming",
      icon: <ArrowDownLeft className="h-3.5 w-3.5" />,
      className: "text-emerald-700",
    };
  }
  return {
    label: "Outgoing",
    icon: <ArrowUpRight className="h-3.5 w-3.5" />,
    className: "text-blue-700",
  };
}

function buildWebChatEmbedSnippet(appUrl: string, widgetKey: string) {
  const normalizedBase = String(appUrl || "").replace(/\/+$/, "");
  const safeKey = String(widgetKey || "").trim();
  return `<script src="${normalizedBase}/webchat-widget.js" data-widget-key="${safeKey}" data-api-base="${normalizedBase}"></script>`;
}

function normalizeTimeZoneForUi(value: string | undefined) {
  const timeZone = String(value || "").trim();
  if (!timeZone) return DEFAULT_TIMEZONE;

  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function getOffsetMinutesForUi(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const parts = formatter.formatToParts(date);
  const token = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = token.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] || "0", 10);
  return sign * (hours * 60 + minutes);
}

function zonedDateTimeToUtcForUi(value: string, timeZone: string) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);

  const zone = normalizeTimeZoneForUi(timeZone);
  let instant = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 2; i += 1) {
    const offsetMinutes = getOffsetMinutesForUi(instant, zone);
    instant = new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000);
  }
  return instant;
}

function formatInTimeZoneForUi(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZoneForUi(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDatePartsInTimeZoneForUi(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZoneForUi(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const pick = (type: string) => formatted.find((part) => part.type === type)?.value || "";
  return {
    date: `${pick("day")}/${pick("month")}/${pick("year")}`,
    time: `${pick("hour")}:${pick("minute")}`,
  };
}

function formatEventDateRangeForUi(startValue: string, endValue: string, timeZone: string) {
  const startInstant = zonedDateTimeToUtcForUi(startValue, timeZone);
  const endInstant = zonedDateTimeToUtcForUi(endValue, timeZone);

  if (startInstant && endInstant) {
    const startParts = formatDatePartsInTimeZoneForUi(startInstant, timeZone);
    const endParts = formatDatePartsInTimeZoneForUi(endInstant, timeZone);
    if (startParts.date === endParts.date) {
      return `${startParts.date}, ${startParts.time} -> ${endParts.time}`;
    }
    return `${formatInTimeZoneForUi(startInstant, timeZone)} -> ${formatInTimeZoneForUi(endInstant, timeZone)}`;
  }

  if (startInstant) return formatInTimeZoneForUi(startInstant, timeZone);
  if (endInstant) return formatInTimeZoneForUi(endInstant, timeZone);
  return startValue || endValue || "-";
}

function describeEventTiming(settings: Settings) {
  const timeZone = normalizeTimeZoneForUi(settings.event_timezone);
  const now = new Date();
  const start = zonedDateTimeToUtcForUi(settings.reg_start || "", timeZone);
  const end = zonedDateTimeToUtcForUi(settings.reg_end || "", timeZone);
  const eventDate = zonedDateTimeToUtcForUi(settings.event_date || "", timeZone);
  const eventEndDate = zonedDateTimeToUtcForUi(settings.event_end_date || "", timeZone);
  const eventCloseDate = eventEndDate || eventDate;
  const eventScheduleStatus =
    eventDate && eventEndDate && eventEndDate.getTime() < eventDate.getTime() ? "invalid" : "valid";

  let registrationStatus: RegistrationWindowUiState = "open";
  if (start && end && end.getTime() < start.getTime()) {
    registrationStatus = "invalid";
  } else if (start && now < start) {
    registrationStatus = "not_started";
  } else if (end && now > end) {
    registrationStatus = "closed";
  }

  const eventLifecycle = !(eventDate || eventEndDate)
    ? "unscheduled"
    : eventDate && now.getTime() < eventDate.getTime()
    ? "upcoming"
    : eventDate && eventEndDate && eventCloseDate && now.getTime() <= eventCloseDate.getTime()
    ? "ongoing"
    : "past";

  return {
    timeZone,
    now,
    nowLabel: formatInTimeZoneForUi(now, timeZone),
    start,
    end,
    eventDate,
    eventEndDate,
    eventCloseDate,
    eventScheduleStatus,
    startLabel: start ? formatInTimeZoneForUi(start, timeZone) : "-",
    endLabel: end ? formatInTimeZoneForUi(end, timeZone) : "-",
    eventDateLabel: formatEventDateRangeForUi(settings.event_date || "", settings.event_end_date || "", timeZone),
    eventEndDateLabel: eventEndDate ? formatInTimeZoneForUi(eventEndDate, timeZone) : settings.event_end_date || "-",
    eventCloseLabel: eventCloseDate ? formatInTimeZoneForUi(eventCloseDate, timeZone) : settings.event_end_date || settings.event_date || "-",
    eventLifecycle,
    registrationStatus,
    registrationLabel:
      registrationStatus === "invalid"
        ? "Invalid Range"
        : registrationStatus === "not_started"
        ? "Not Open Yet"
        : registrationStatus === "closed"
        ? "Closed"
        : "Open",
  };
}

function getEventStatusLabel(status: EventStatus) {
  switch (status) {
    case "pending":
      return "pending";
    case "active":
      return "active";
    case "inactive":
      return "inactive";
    case "closed":
      return "closed";
    case "cancelled":
      return "cancelled";
    case "archived":
      return "archived";
    default:
      return status;
  }
}

function getEventStatusTone(status: EventStatus): BadgeTone {
  switch (status) {
    case "active":
      return "emerald";
    case "pending":
      return "amber";
    case "inactive":
      return "neutral";
    case "cancelled":
      return "rose";
    case "archived":
      return "neutral";
    default:
      return "neutral";
  }
}

function getEventStatusBadgeClass(status: EventStatus) {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700";
    case "pending":
      return "bg-amber-100 text-amber-700";
    case "inactive":
      return "bg-slate-100 text-slate-700";
    case "closed":
      return "bg-slate-200 text-slate-600";
    case "cancelled":
      return "bg-rose-100 text-rose-700";
    case "archived":
      return "bg-slate-200 text-slate-600";
    default:
      return "bg-slate-200 text-slate-600";
  }
}

function getEventWorkspaceTimestamp(event: EventRecord) {
  const updatedAt = Date.parse(String(event.updated_at || ""));
  if (!Number.isNaN(updatedAt)) return updatedAt;
  const createdAt = Date.parse(String(event.created_at || ""));
  return Number.isNaN(createdAt) ? 0 : createdAt;
}

function getEventWorkspaceStartTimestamp(event: EventRecord) {
  const parsed = parseDateTimeLocalValue(event.event_date || "");
  if (parsed) return parsed.getTime();
  return Number.NEGATIVE_INFINITY;
}

function compareEventWorkspaceRecords(left: EventRecord, right: EventRecord, sortMode: EventWorkspaceSort) {
  if (sortMode === "name_asc") {
    const byName = EVENT_NAME_COLLATOR.compare(left.name, right.name);
    if (byName !== 0) return byName;
    return getEventWorkspaceTimestamp(right) - getEventWorkspaceTimestamp(left);
  }
  if (sortMode === "modified_desc") {
    const byModified = getEventWorkspaceTimestamp(right) - getEventWorkspaceTimestamp(left);
    if (byModified !== 0) return byModified;
    return EVENT_NAME_COLLATOR.compare(left.name, right.name);
  }
  const leftStart = getEventWorkspaceStartTimestamp(left);
  const rightStart = getEventWorkspaceStartTimestamp(right);
  const leftHasStart = Number.isFinite(leftStart);
  const rightHasStart = Number.isFinite(rightStart);
  if (leftHasStart && rightHasStart && rightStart !== leftStart) {
    return rightStart - leftStart;
  }
  if (leftHasStart !== rightHasStart) {
    return leftHasStart ? -1 : 1;
  }
  const byModified = getEventWorkspaceTimestamp(right) - getEventWorkspaceTimestamp(left);
  if (byModified !== 0) return byModified;
  return EVENT_NAME_COLLATOR.compare(left.name, right.name);
}

function formatEventWorkspaceDateLabel(value: string | null | undefined) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getEventHistoryGroupKey(value: string | null | undefined) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatEventHistoryGroupLabel(value: string | null | undefined) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "Older";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function getRegistrationWindowTone(status: RegistrationWindowUiState): BadgeTone {
  switch (status) {
    case "open":
      return "emerald";
    case "not_started":
      return "amber";
    case "closed":
      return "rose";
    case "invalid":
      return "rose";
    default:
      return "neutral";
  }
}

function parseRegistrationLimitValue(value: string | null | undefined) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function describeRegistrationCapacity(limitValue: string | null | undefined, activeCount: number) {
  const limit = parseRegistrationLimitValue(limitValue);
  const remaining = limit === null ? null : Math.max(limit - activeCount, 0);
  const isFull = limit !== null && activeCount >= limit;
  const fillPercent = limit === null ? null : limit <= 0 ? 100 : Math.min(100, Math.round((activeCount / limit) * 100));

  return {
    limit,
    remaining,
    isFull,
    fillPercent,
  };
}

function describeRegistrationAvailability(
  eventStatus: EventStatus | null | undefined,
  windowStatus: RegistrationWindowUiState,
  isFull: boolean,
) {
  if (eventStatus === "cancelled") {
    return { label: "Cancelled", tone: "rose" as const, helper: "This event was cancelled." };
  }
  if (eventStatus === "closed") {
    return { label: "Ended", tone: "neutral" as const, helper: "The event has already ended." };
  }
  if (eventStatus === "pending") {
    return { label: "Pending", tone: "amber" as const, helper: "Launch the event before accepting registrations." };
  }
  if (eventStatus === "archived") {
    return { label: "Archived", tone: "neutral" as const, helper: "This event has been archived and is no longer accepting registrations." };
  }
  if (eventStatus === "inactive") {
    return { label: "Inactive", tone: "neutral" as const, helper: "This event is currently inactive, so registrations stay paused." };
  }
  if (windowStatus === "invalid") {
    return { label: "Schedule Error", tone: "rose" as const, helper: "Registration dates are misconfigured." };
  }
  if (windowStatus === "not_started") {
    return { label: "Not Open", tone: "amber" as const, helper: "Registration has not opened yet." };
  }
  if (windowStatus === "closed") {
    return { label: "Closed", tone: "rose" as const, helper: "Registration has passed its close date." };
  }
  if (isFull) {
    return { label: "Full", tone: "rose" as const, helper: "Capacity is full, so new registrations are blocked." };
  }
  return { label: "Open", tone: "emerald" as const, helper: "New registrations can still be accepted." };
}

function getRegistrationAvailabilityTone(status: RegistrationAvailabilityUiState | null | undefined): BadgeTone {
  if (status === "full") return "rose";
  if (!status) return "neutral";
  return getRegistrationWindowTone(status);
}

function getRegistrationAvailabilityLabel(status: RegistrationAvailabilityUiState | null | undefined) {
  switch (status) {
    case "full":
      return "full";
    case "not_started":
      return "not open";
    case "closed":
      return "reg closed";
    case "invalid":
      return "schedule error";
    default:
      return "open";
  }
}

function describeEventOperatorGuard(
  eventStatus: EventStatus | null | undefined,
  registrationAvailability: RegistrationAvailabilityUiState | null | undefined,
) {
  if (eventStatus === "cancelled") {
    return {
      tone: "rose" as const,
      label: "Event Cancelled",
      body: "Channels can stay connected, but the bot should clearly tell users the event was cancelled and stop new registrations.",
    };
  }
  if (eventStatus === "closed") {
    return {
      tone: "neutral" as const,
      label: "Event Ended",
      body: "The event has already ended. Logs may still arrive, but new registration attempts should be declined.",
    };
  }
  if (eventStatus === "pending") {
    return {
      tone: "amber" as const,
      label: "Launch Pending",
      body: "Channels may stay wired, but the bot should explain that registration has not launched yet.",
    };
  }
  if (eventStatus === "archived") {
    return {
      tone: "neutral" as const,
      label: "Archived",
      body: "This event is archived. Keep channels detached or inactive so no new attendee traffic routes here.",
    };
  }
  if (eventStatus === "inactive") {
    return {
      tone: "neutral" as const,
      label: "Inactive",
      body: "Channels may stay connected, but the bot should tell users the event is currently inactive and stop new registrations.",
    };
  }
  if (registrationAvailability === "full") {
    return {
      tone: "rose" as const,
      label: "Capacity Full",
      body: "Channels remain live, but the bot should decline new registrations until seats open up.",
    };
  }
  if (registrationAvailability === "not_started") {
    return {
      tone: "amber" as const,
      label: "Registration Not Open",
      body: "Channels are live, but the bot should wait for the configured registration start time before accepting signups.",
    };
  }
  if (registrationAvailability === "closed") {
    return {
      tone: "rose" as const,
      label: "Registration Closed",
      body: "Channels are live, but the bot should tell users the registration window has closed.",
    };
  }
  if (registrationAvailability === "invalid") {
    return {
      tone: "rose" as const,
      label: "Schedule Error",
      body: "Registration dates are misconfigured. The bot should avoid accepting signups until the range is fixed.",
    };
  }
  return {
    tone: "emerald" as const,
    label: "Registration Open",
    body: "Channels can accept normal FAQ and registration flows for this event.",
  };
}

function describeCheckinOperatorGuard(
  eventStatus: EventStatus | null | undefined,
  registrationAvailability: RegistrationAvailabilityUiState | null | undefined,
) {
  if (eventStatus === "cancelled") {
    return {
      tone: "rose" as const,
      label: "Revoke Check-in",
      body: "This event was cancelled. Door staff should stop admitting attendees and revoke active check-in links.",
    };
  }
  if (eventStatus === "closed") {
    return {
      tone: "neutral" as const,
      label: "Past Event",
      body: "The event has already ended. Check-in is usually no longer needed except for audit review.",
    };
  }
  if (eventStatus === "inactive") {
    return {
      tone: "neutral" as const,
      label: "Inactive",
      body: "This event is currently inactive. Keep check-in off until the event is live again.",
    };
  }
  if (eventStatus === "archived") {
    return {
      tone: "neutral" as const,
      label: "Archived",
      body: "This event is archived. Keep check-in disabled and use it only for audit/history review.",
    };
  }
  if (registrationAvailability === "full") {
    return {
      tone: "amber" as const,
      label: "Door Only",
      body: "Registration is full, but check-in for already registered attendees can continue normally.",
    };
  }
  if (registrationAvailability === "closed") {
    return {
      tone: "amber" as const,
      label: "Registration Closed",
      body: "New signups are closed, but existing attendees can still be checked in.",
    };
  }
  if (registrationAvailability === "not_started") {
    return {
      tone: "amber" as const,
      label: "Pre-Launch",
      body: "Registration has not opened yet. Use check-in only when your staff is intentionally preparing ahead of the event.",
    };
  }
  if (registrationAvailability === "invalid") {
    return {
      tone: "rose" as const,
      label: "Schedule Error",
      body: "Registration dates are misconfigured. Check-in can still work for existing records, but the event setup should be fixed first.",
    };
  }
  return {
    tone: "emerald" as const,
    label: "Door Ready",
    body: "Check-in can run normally for this event.",
  };
}

function getDocumentEmbeddingTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case "ready":
      return "emerald";
    case "failed":
      return "rose";
    case "skipped":
      return "neutral";
    default:
      return "amber";
  }
}

function getConnectionStatusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case "ready":
      return "emerald";
    case "partial":
      return "amber";
    default:
      return "rose";
  }
}

function getRegistrationStatusTone(status: string | null | undefined): BadgeTone {
  switch (status) {
    case "checked-in":
      return "emerald";
    case "cancelled":
      return "neutral";
    default:
      return "blue";
  }
}

function getPublicInboxStatusTone(status: PublicInboxConversationStatus): BadgeTone {
  switch (status) {
    case "waiting-admin":
      return "rose";
    case "waiting-user":
      return "amber";
    case "resolved":
      return "emerald";
    default:
      return "blue";
  }
}

function getPublicInboxStatusLabel(status: PublicInboxConversationStatus) {
  switch (status) {
    case "waiting-admin":
      return "Waiting Admin";
    case "waiting-user":
      return "Waiting User";
    case "resolved":
      return "Resolved";
    default:
      return "Open";
  }
}

function getPublicInboxAttentionReasonLabel(reason: string | null | undefined) {
  switch (String(reason || "").trim()) {
    case "handoff_request":
      return "Human requested";
    case "bot_failure":
      return "Bot failure";
    default:
      return "";
  }
}

function getCheckinSessionTone(session: CheckinSessionRecord): BadgeTone {
  if (session.revoked_at) return "neutral";
  return session.is_active ? "emerald" : "amber";
}

function getUserAccessTone(isActive: boolean): BadgeTone {
  return isActive ? "emerald" : "neutral";
}

function toBannerTone(tone: BadgeTone): BannerTone {
  switch (tone) {
    case "blue":
      return "blue";
    case "emerald":
      return "emerald";
    case "amber":
      return "amber";
    case "rose":
      return "rose";
    default:
      return "neutral";
  }
}

function getChannelTokenStatusMeta(channel: ChannelAccountRecord): { label: string; className: string; icon: ReactNode } {
  if (channel.platform === "web_chat") {
    return {
      label: "No token needed",
      className: "text-violet-700",
      icon: <Shield className="h-3.5 w-3.5" />,
    };
  }
  if (channel.has_access_token) {
    return {
      label: "Token saved",
      className: "text-emerald-700",
      icon: <Lock className="h-3.5 w-3.5" />,
    };
  }
  if (channel.platform === "facebook") {
    return {
      label: "Using env fallback",
      className: "text-amber-700",
      icon: <AlertCircle className="h-3.5 w-3.5" />,
    };
  }
  return {
    label: "Token missing",
    className: "text-rose-700",
    icon: <AlertCircle className="h-3.5 w-3.5" />,
  };
}

function ChannelPlatformLogo({
  platform,
  className = "h-10 w-10 rounded-2xl",
}: {
  platform: ChannelPlatform;
  className?: string;
}) {
  const baseClass = `inline-flex shrink-0 items-center justify-center border border-white/35 text-white shadow-sm ${className}`.trim();
  const iconClass = "h-6 w-6";

  if (platform === "facebook") {
    return (
      <span
        className={baseClass}
        style={{ background: "linear-gradient(135deg, #0099FF 0%, #2563EB 100%)" }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className={iconClass}>
          <path
            fill="rgba(255,255,255,0.98)"
            d="M12 4.9c-4.35 0-7.9 3.18-7.9 7.1 0 2.2 1.1 4.14 2.84 5.45V20l2.62-1.45c.76.2 1.58.3 2.44.3 4.35 0 7.9-3.18 7.9-7.1S16.35 4.9 12 4.9Z"
          />
          <path
            fill="#1D4ED8"
            d="M7.5 13.9 10.84 10.33a.45.45 0 0 1 .58-.05l2.31 1.73 2.7-2.66c.2-.19.5.06.34.28l-3.34 3.57a.45.45 0 0 1-.58.05l-2.31-1.73-2.7 2.66c-.2.19-.5-.06-.34-.28Z"
          />
        </svg>
      </span>
    );
  }

  if (platform === "line_oa") {
    return (
      <span className={baseClass} style={{ backgroundColor: "#06C755" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" className={iconClass}>
          <rect x="4" y="5" width="16" height="11" rx="5" fill="currentColor" />
          <path d="M10 16h4l-2 2.6z" fill="currentColor" />
          <text x="12" y="12.6" textAnchor="middle" fontSize="5.2" fontWeight="700" fill="#06C755" fontFamily="Arial, sans-serif">
            LINE
          </text>
        </svg>
      </span>
    );
  }

  if (platform === "instagram") {
    return (
      <span
        className={baseClass}
        style={{ background: "linear-gradient(135deg, #F58529 0%, #DD2A7B 55%, #8134AF 100%)" }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className={`${iconClass} fill-none stroke-current`}>
          <rect x="5.25" y="5.25" width="13.5" height="13.5" rx="4" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3.25" strokeWidth="1.8" />
          <circle cx="16.55" cy="7.45" r="1" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }

  if (platform === "whatsapp") {
    return (
      <span className={baseClass} style={{ backgroundColor: "#25D366" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" className={`${iconClass} fill-none stroke-current`}>
          <path d="M12 5.2a6.8 6.8 0 0 0-5.9 10.2L5.2 19l3.8-1a6.8 6.8 0 1 0 3-12.8Z" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.3 9.4c.2-.3.4-.4.6-.4h.5c.2 0 .4.1.5.4l.6 1.5c.1.3 0 .6-.2.8l-.5.5c.7 1.2 1.7 2.1 3 2.8l.5-.4c.2-.2.5-.2.8-.1l1.4.6c.3.1.4.3.4.5v.5c0 .3-.1.5-.4.6-.4.2-.9.4-1.4.3-3.3-.5-6.2-3.2-7-6.5-.1-.5 0-1 .2-1.5Z" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }

  if (platform === "telegram") {
    return (
      <span className={baseClass} style={{ backgroundColor: "#229ED9" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" className={iconClass}>
          <path d="M18.8 6.2 5.9 11.2c-.9.4-.9 1.1-.2 1.3l3.3 1 1.3 4c.2.6.3.8.8.8.4 0 .6-.2.8-.4l1.8-1.7 3.7 2.8c.7.4 1.2.2 1.4-.7l2.2-10.3c.3-1-.3-1.5-1.2-1.1Z" />
        </svg>
      </span>
    );
  }

  if (platform === "web_chat") {
    return (
      <span className={baseClass} style={{ backgroundColor: "#475569" }} aria-hidden="true">
        <svg viewBox="0 0 24 24" className={`${iconClass} fill-none stroke-current`}>
          <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h5A2.5 2.5 0 0 1 15 7.5v3A2.5 2.5 0 0 1 12.5 13H10l-3 2v-2.3A2.5 2.5 0 0 1 5 10.5Z" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12.5 10A2.5 2.5 0 0 1 15 7.5h1.5A2.5 2.5 0 0 1 19 10v2A2.5 2.5 0 0 1 16.5 14H15l-2 1.5V13.8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  return null;
}

function PublicContactActionLink({
  href,
  label,
  kind,
  compact = false,
}: {
  href: string;
  label: string;
  kind: "messenger" | "line" | "phone";
  compact?: boolean;
}) {
  const iconClass = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const baseClass = compact
    ? "public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
    : "public-page-control inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600";

  return (
    <a href={href} target={kind === "phone" ? undefined : "_blank"} rel={kind === "phone" ? undefined : "noopener noreferrer"} className={baseClass}>
      {kind === "messenger" ? (
        <ChannelPlatformLogo platform="facebook" className="h-6 w-6 rounded-xl" />
      ) : kind === "line" ? (
        <ChannelPlatformLogo platform="line_oa" className="h-6 w-6 rounded-xl" />
      ) : (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <Phone className={iconClass} />
        </span>
      )}
      {label}
    </a>
  );
}

const BADGE_BASE_CLASS =
  "inline-flex max-w-full items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] leading-tight text-center select-none";

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-slate-200 bg-slate-100 text-slate-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

function StatusBadge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={`${BADGE_BASE_CLASS} ${BADGE_TONE_CLASSES[tone]} ${className}`.trim()}>{children}</span>;
}

function SelectionMarker({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700 ${className}`.trim()}>
      <CheckCircle2 className="h-3.5 w-3.5" />
      selected
    </span>
  );
}

const BANNER_TONE_CLASSES: Record<BannerTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
};

function PageBanner({
  tone = "neutral",
  icon,
  children,
  className = "",
}: {
  tone?: BannerTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${BANNER_TONE_CLASSES[tone]} ${className}`.trim()}>
      <div className="flex items-start gap-2">
        {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
        <p className="leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

function StatusLine({
  items,
  className = "",
}: {
  items: Array<ReactNode | null | undefined | false>;
  className?: string;
}) {
  const filtered = items.filter(Boolean) as ReactNode[];
  if (filtered.length === 0) return null;
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600 ${className}`.trim()}>
      {filtered.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-slate-300">·</span>}
          {item}
        </span>
      ))}
    </p>
  );
}

function SelectionCard({
  selected,
  searchFocused = false,
  className = "",
  children,
}: {
  selected: boolean;
  searchFocused?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`${selected ? "border-blue-200 bg-blue-50 shadow-sm" : "border-slate-200 bg-slate-50 hover:bg-slate-100"} ${
        searchFocused ? "ring-2 ring-blue-200 ring-offset-2" : ""
      } ${className}`.trim()}
    >
      {children}
    </div>
  );
}

function MetaRow({
  items,
  className = "",
}: {
  items: Array<ReactNode | null | undefined | false>;
  className?: string;
}) {
  const filtered = items.filter(Boolean) as ReactNode[];
  if (filtered.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 ${className}`.trim()}>
      {filtered.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-2">
          {index > 0 && <span className="text-slate-300">•</span>}
          {item}
        </span>
      ))}
    </div>
  );
}

function CompactStatRow({
  stats,
  className = "",
}: {
  stats: Array<{ label: string; value: string | number; tone?: BannerTone }>;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 ${className}`.trim()}>
      {stats.map((stat) => {
        const toneClasses =
          stat.tone === "emerald"
            ? "text-emerald-700"
            : stat.tone === "amber"
            ? "text-amber-700"
            : stat.tone === "blue"
            ? "text-blue-700"
            : "text-slate-700";
        return (
          <div key={stat.label} className="inline-flex items-center gap-1.5">
            <span className={`text-sm font-semibold ${toneClasses}`}>{stat.value}</span>
            <span className="text-[11px] text-slate-500">{stat.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function AdminAgentDashboardMiniStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: BadgeTone;
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-900"
      : tone === "violet"
      ? "border-violet-200 bg-violet-50 text-violet-900"
      : "border-slate-300 bg-white text-slate-900";

  return (
    <div className={`rounded-2xl border px-3 py-2 ${toneClasses}`.trim()}>
      <div className="text-base font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">{label}</div>
    </div>
  );
}

function AdminAgentDashboardMeter({
  label,
  totalLabel,
  segments,
  className = "",
}: {
  label: string;
  totalLabel: string;
  segments: Array<{ label: string; value: number; tone: "emerald" | "amber" | "blue" | "violet" | "slate" }>;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const toneClassMap: Record<"emerald" | "amber" | "blue" | "violet" | "slate", { bar: string; dot: string; text: string }> = {
    emerald: {
      bar: "bg-emerald-500",
      dot: "bg-emerald-500",
      text: "text-emerald-800",
    },
    amber: {
      bar: "bg-amber-400",
      dot: "bg-amber-400",
      text: "text-amber-800",
    },
    blue: {
      bar: "bg-blue-500",
      dot: "bg-blue-500",
      text: "text-blue-800",
    },
    violet: {
      bar: "bg-violet-500",
      dot: "bg-violet-500",
      text: "text-violet-800",
    },
    slate: {
      bar: "bg-slate-500",
      dot: "bg-slate-500",
      text: "text-slate-800",
    },
  };

  return (
    <div className={`rounded-2xl border border-slate-300 bg-white px-3 py-2.5 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700">{label}</p>
        <p className="text-xs font-semibold text-slate-900">{totalLabel}</p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200">
        <div className="flex h-full w-full overflow-hidden rounded-full">
          {total > 0 ? (
            segments.filter((segment) => segment.value > 0).map((segment) => (
              <div
                key={segment.label}
                className={toneClassMap[segment.tone].bar}
                style={{ width: `${(segment.value / total) * 100}%` }}
                title={`${segment.label}: ${segment.value}`}
              />
            ))
          ) : (
            <div className="h-full w-full bg-slate-300" />
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((segment) => (
          <div key={segment.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-700">
            <span className={`h-2 w-2 rounded-full ${toneClassMap[segment.tone].dot}`} />
            <span className={`font-semibold ${toneClassMap[segment.tone].text}`}>{segment.value}</span>
            <span>{segment.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineWarning({
  tone = "amber",
  children,
  className = "",
}: {
  tone?: BannerTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <PageBanner
      tone={tone}
      icon={tone === "rose" ? <AlertCircle className="h-4 w-4" /> : <CircleHelp className="h-4 w-4" />}
      className={className}
    >
      {children}
    </PageBanner>
  );
}

function InspectorSection({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${className}`.trim()}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

const ACTION_BUTTON_BASE_CLASS =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const ACTION_BUTTON_TONE_CLASSES: Record<ActionTone, { idle: string; active: string }> = {
  neutral: {
    idle: "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
    active: "border-slate-900 bg-slate-900 text-white",
  },
  blue: {
    idle: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
    active: "border-blue-600 bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)]",
  },
  emerald: {
    idle: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    active: "border-emerald-600 bg-emerald-600 text-white",
  },
  amber: {
    idle: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    active: "border-amber-600 bg-amber-600 text-white",
  },
  rose: {
    idle: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
    active: "border-rose-600 bg-rose-600 text-white",
  },
  violet: {
    idle: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
    active: "border-violet-600 bg-violet-600 text-white",
  },
};

function ActionButton({
  tone = "neutral",
  active = false,
  className = "",
  children,
  type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const toneClasses = active ? ACTION_BUTTON_TONE_CLASSES[tone].active : ACTION_BUTTON_TONE_CLASSES[tone].idle;
  return (
    <button
      {...props}
      type={type || "button"}
      className={`${ACTION_BUTTON_BASE_CLASS} ${toneClasses} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

function CollapseIconButton({
  collapsed,
  onClick,
  label = "section",
  tone = "neutral",
  className = "",
}: {
  collapsed: boolean;
  onClick: () => void;
  label?: string;
  tone?: ActionTone;
  className?: string;
}) {
  const action = collapsed ? "Expand" : "Collapse";
  return (
    <ActionButton
      onClick={onClick}
      aria-label={`${action} ${label}`}
      title={`${action} ${label}`}
      tone={tone}
      className={`h-8 w-8 min-h-0 rounded-lg p-0 text-lg font-black leading-none ${className}`.trim()}
    >
      <span aria-hidden="true" className="font-mono">{collapsed ? "+" : "-"}</span>
    </ActionButton>
  );
}

function HelpPopover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelOffset, setPanelOffset] = useState(0);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPanelOffset(0);
      return;
    }

    const updatePosition = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const margin = 16;
      const rect = panel.getBoundingClientRect();
      let nextOffset = 0;

      if (rect.left < margin) {
        nextOffset += margin - rect.left;
      }
      if (rect.right > window.innerWidth - margin) {
        nextOffset -= rect.right - (window.innerWidth - margin);
      }

      setPanelOffset(nextOffset);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={panelRef}
          className="app-overlay-surface absolute right-0 top-full z-20 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-xl"
          style={panelOffset ? { transform: `translateX(${panelOffset}px)` } : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function InlineActionsMenu({
  label,
  tone = "neutral",
  children,
  className = "",
  iconOnly = false,
}: {
  label: string;
  tone?: ActionTone;
  children: ReactNode;
  className?: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`relative shrink-0 ${className}`.trim()} ref={menuRef}>
      <ActionButton
        onClick={() => setOpen((current) => !current)}
        tone={tone}
        className={
          iconOnly
            ? "h-9 w-9 min-h-0 rounded-lg p-0"
            : `min-w-[3.75rem] px-3 text-sm ${className.includes("w-full") ? "w-full justify-center" : ""}`.trim()
        }
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
      >
        {iconOnly ? (
          <>
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">{label}</span>
          </>
        ) : (
          <>
            <span className="truncate">{label}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </ActionButton>
      {open && (
        <div
          className="app-overlay-surface absolute right-0 top-full z-20 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
          onClick={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[role="menuitem"]')) {
              setOpen(false);
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuActionItem({
  tone = "neutral",
  className = "",
  children,
  type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  className?: string;
  children: ReactNode;
}) {
  const textClasses: Record<ActionTone, string> = {
    neutral: "text-slate-600 hover:bg-slate-50",
    blue: "text-blue-700 hover:bg-blue-50",
    emerald: "text-emerald-700 hover:bg-emerald-50",
    amber: "text-amber-700 hover:bg-amber-50",
    rose: "text-rose-700 hover:bg-rose-50",
    violet: "text-violet-700 hover:bg-violet-50",
  };

  return (
    <button
      {...props}
      type={type || "button"}
      role="menuitem"
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${textClasses[tone]} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

function MenuActionLink({
  tone = "neutral",
  className = "",
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  tone?: ActionTone;
  className?: string;
  children: ReactNode;
}) {
  const textClasses: Record<ActionTone, string> = {
    neutral: "text-slate-600 hover:bg-slate-50",
    blue: "text-blue-700 hover:bg-blue-50",
    emerald: "text-emerald-700 hover:bg-emerald-50",
    amber: "text-amber-700 hover:bg-amber-50",
    rose: "text-rose-700 hover:bg-rose-50",
    violet: "text-violet-700 hover:bg-violet-50",
  };

  return (
    <a
      {...props}
      role="menuitem"
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${textClasses[tone]} ${className}`.trim()}
    >
      {children}
    </a>
  );
}

function CopyField({
  label,
  value,
  onCopy,
  help,
  copied = false,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  help?: ReactNode;
  copied?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</label>
        {help ? (
          <HelpPopover label={`Open setup note for ${label}`}>{help}</HelpPopover>
        ) : null}
      </div>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={value}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-mono outline-none"
        />
        <button
          onClick={onCopy}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
          aria-label={`Copy ${label}`}
        >
          {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
        </button>
      </div>
    </div>
  );
}

function EventWorkspaceRow({
  event,
  selected,
  searchFocused,
  onSelect,
}: {
  event: EventRecord;
  selected: boolean;
  searchFocused: boolean;
  onSelect: () => void;
}) {
  const lastUpdatedLabel = formatEventWorkspaceDateLabel(event.updated_at || event.created_at);
  const showAvailabilityBadge =
    event.registration_availability
    && event.registration_availability !== "open"
    && event.effective_status !== "closed"
    && event.effective_status !== "cancelled"
    && event.effective_status !== "archived";

  return (
    <button
      id={getSearchTargetDomId("event", event.id)}
      onClick={onSelect}
      className="w-full overflow-hidden rounded-2xl text-left"
    >
      <SelectionCard selected={selected} searchFocused={searchFocused} className="rounded-2xl border px-4 py-3 transition-colors">
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{event.name}</p>
            <MetaRow
              className="mt-1"
              items={[
                <span className="font-mono">{event.slug}</span>,
                <span>Updated {lastUpdatedLabel}</span>,
              ]}
            />
            <StatusLine
              className="mt-1"
              items={[
                showAvailabilityBadge ? <>Registration {getRegistrationAvailabilityLabel(event.registration_availability)}</> : null,
                event.is_default ? "Default workspace" : null,
              ]}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end lg:pl-3">
            <StatusBadge tone={getEventStatusTone(event.effective_status)}>
              {getEventStatusLabel(event.effective_status)}
            </StatusBadge>
            {selected && <SelectionMarker />}
          </div>
        </div>
      </SelectionCard>
    </button>
  );
}

const RECOMMENDED_ADMIN_AGENT_PROMPT = [
  "You are an internal Admin Operations Agent for FB Bot Studio.",
  "Your user is an admin/operator, not an attendee.",
  "Use concise operational Thai.",
  "Follow Agent policy scopes strictly. If required action is disabled, tell admin to enable it in Advanced Action Policy.",
  "Respect event scope: operate on the selected event unless admin explicitly specifies another event ID.",
  "When admin asks by partial event name, find and confirm matching event IDs before running event-specific actions.",
  "Use prior chat turns as working memory for follow-up questions in the same session.",
  "When asked for event details, include schedule, location, map, description, travel notes, and registration rules (capacity/open/close/unique-name).",
  "When policy allows, you can create event, update event setup/status/context, and update registration status.",
  "When asked to message a user by sender ID, execute the send-message action and report delivery target.",
  "Prioritize safety and accuracy:",
  "- Ask one short clarification when required fields are missing.",
  "- Never invent IDs, names, counts, or delivery results.",
  "- After success, summarize what was executed with key identifiers.",
  "- After failure, explain the reason and next corrective step for admin.",
  "Stay focused on admin operations only.",
].join("\n");

const INITIAL_SETTINGS: Settings = {
  context: "",
  llm_model: "",
  global_system_prompt: "You are a helpful assistant for an event registration system. Be polite, concise, and operationally accurate.",
  global_llm_model: "google/gemini-3-flash-preview",
  admin_agent_enabled: "0",
  admin_agent_system_prompt: RECOMMENDED_ADMIN_AGENT_PROMPT,
  admin_agent_model: "",
  admin_agent_default_event_id: "evt_default",
  admin_agent_policy_read_event: "1",
  admin_agent_policy_manage_event_setup: "0",
  admin_agent_policy_manage_event_status: "0",
  admin_agent_policy_manage_event_context: "0",
  admin_agent_policy_read_registration: "1",
  admin_agent_policy_manage_registration: "1",
  admin_agent_policy_message_user: "1",
  admin_agent_policy_search_all_events: "1",
  admin_agent_telegram_enabled: "0",
  admin_agent_telegram_bot_token: "",
  admin_agent_telegram_webhook_secret: "",
  admin_agent_telegram_allowed_chat_ids: "",
  admin_agent_notification_enabled: "0",
  admin_agent_notification_on_registration_created: "1",
  admin_agent_notification_on_registration_status_changed: "1",
  admin_agent_notification_scope: "all",
  admin_agent_notification_event_id: "",
  verify_token: "",
  event_name: "",
  event_timezone: DEFAULT_TIMEZONE,
  event_venue_name: "",
  event_room_detail: "",
  event_location: "",
  event_map_url: "",
  event_date: "",
  event_end_date: "",
  event_description: "",
  event_travel: "",
  event_public_page_enabled: "0",
  event_public_show_seat_availability: "0",
  event_public_slug: "",
  event_public_poster_url: "",
  event_public_summary: "",
  event_public_registration_enabled: "1",
  event_public_ticket_recovery_mode: "shared_contact",
  event_public_bot_enabled: "1",
  event_public_success_message: "Registration complete. Save your ticket image to your phone now.",
  event_public_cta_label: "Register Now",
  event_public_privacy_enabled: "1",
  event_public_privacy_label: "Privacy",
  event_public_privacy_text:
    "We use your information only for event registration, ticket delivery, and event-related communication. We do not sell personal data. Access is limited to authorized event staff, and we can delete your data on request.",
  event_public_contact_enabled: "0",
  event_public_contact_intro: "Need help from our team? Use one of these contact options.",
  event_public_contact_messenger_url: "",
  event_public_contact_line_url: "",
  event_public_contact_phone: "",
  event_public_contact_hours: "",
  confirmation_email_enabled: "0",
  confirmation_email_subject: "Your registration for {{event_name}}",
  email_template_registration_confirmation_subject: "",
  email_template_registration_confirmation_html: "",
  email_template_registration_confirmation_text: "",
  email_template_ticket_delivery_subject: "",
  email_template_ticket_delivery_html: "",
  email_template_ticket_delivery_text: "",
  email_template_payment_confirmation_subject: "",
  email_template_payment_confirmation_html: "",
  email_template_payment_confirmation_text: "",
  email_template_event_update_subject: "",
  email_template_event_update_html: "",
  email_template_event_update_text: "",
  email_template_magic_link_login_subject: "",
  email_template_magic_link_login_html: "",
  email_template_magic_link_login_text: "",
  reg_unique_name: "1",
  reg_limit: "200",
  reg_start: "",
  reg_end: "",
};

function getBlankEventScopedSettings() {
  return {
    context: "",
    llm_model: "",
    event_name: "",
    event_timezone: DEFAULT_TIMEZONE,
    event_venue_name: "",
    event_room_detail: "",
    event_location: "",
    event_map_url: "",
    event_date: "",
    event_end_date: "",
    event_description: "",
    event_travel: "",
    event_public_page_enabled: "0",
    event_public_show_seat_availability: "0",
    event_public_slug: "",
    event_public_poster_url: "",
    event_public_summary: "",
    event_public_registration_enabled: "1",
    event_public_ticket_recovery_mode: "shared_contact",
    event_public_bot_enabled: "1",
    event_public_success_message: "Registration complete. Save your ticket image to your phone now.",
    event_public_cta_label: "Register Now",
    event_public_privacy_enabled: "1",
    event_public_privacy_label: "Privacy",
    event_public_privacy_text:
      "We use your information only for event registration, ticket delivery, and event-related communication. We do not sell personal data. Access is limited to authorized event staff, and we can delete your data on request.",
    event_public_contact_enabled: "0",
    event_public_contact_intro: "Need help from our team? Use one of these contact options.",
    event_public_contact_messenger_url: "",
    event_public_contact_line_url: "",
    event_public_contact_phone: "",
    event_public_contact_hours: "",
    confirmation_email_enabled: "0",
    confirmation_email_subject: "Your registration for {{event_name}}",
    email_template_registration_confirmation_subject: "",
    email_template_registration_confirmation_html: "",
    email_template_registration_confirmation_text: "",
    email_template_ticket_delivery_subject: "",
    email_template_ticket_delivery_html: "",
    email_template_ticket_delivery_text: "",
    email_template_payment_confirmation_subject: "",
    email_template_payment_confirmation_html: "",
    email_template_payment_confirmation_text: "",
    email_template_event_update_subject: "",
    email_template_event_update_html: "",
    email_template_event_update_text: "",
    email_template_magic_link_login_subject: "",
    email_template_magic_link_login_html: "",
    email_template_magic_link_login_text: "",
    reg_unique_name: "1",
    reg_limit: "200",
    reg_start: "",
    reg_end: "",
  } satisfies Pick<
    Settings,
    | "context"
    | "llm_model"
    | "event_name"
    | "event_timezone"
    | "event_venue_name"
    | "event_room_detail"
    | "event_location"
    | "event_map_url"
    | "event_date"
    | "event_end_date"
    | "event_description"
    | "event_travel"
    | "event_public_page_enabled"
    | "event_public_show_seat_availability"
    | "event_public_slug"
    | "event_public_poster_url"
    | "event_public_summary"
    | "event_public_registration_enabled"
    | "event_public_ticket_recovery_mode"
    | "event_public_bot_enabled"
    | "event_public_success_message"
    | "event_public_cta_label"
    | "event_public_privacy_enabled"
    | "event_public_privacy_label"
    | "event_public_privacy_text"
    | "event_public_contact_enabled"
    | "event_public_contact_intro"
    | "event_public_contact_messenger_url"
    | "event_public_contact_line_url"
    | "event_public_contact_phone"
    | "event_public_contact_hours"
    | "confirmation_email_enabled"
    | "confirmation_email_subject"
    | "email_template_registration_confirmation_subject"
    | "email_template_registration_confirmation_html"
    | "email_template_registration_confirmation_text"
    | "email_template_ticket_delivery_subject"
    | "email_template_ticket_delivery_html"
    | "email_template_ticket_delivery_text"
    | "email_template_payment_confirmation_subject"
    | "email_template_payment_confirmation_html"
    | "email_template_payment_confirmation_text"
    | "email_template_event_update_subject"
    | "email_template_event_update_html"
    | "email_template_event_update_text"
    | "email_template_magic_link_login_subject"
    | "email_template_magic_link_login_html"
    | "email_template_magic_link_login_text"
    | "reg_unique_name"
    | "reg_limit"
    | "reg_start"
    | "reg_end"
  >;
}

const EVENT_SETUP_SETTINGS_KEYS = [
  "event_name",
  "event_timezone",
  "event_venue_name",
  "event_room_detail",
  "event_location",
  "event_map_url",
  "event_date",
  "event_end_date",
  "event_description",
  "event_travel",
  "reg_unique_name",
  "reg_limit",
  "reg_start",
  "reg_end",
] as const satisfies ReadonlyArray<keyof Settings>;

const EMAIL_TEMPLATE_SETTINGS_KEYS = [
  "email_template_registration_confirmation_subject",
  "email_template_registration_confirmation_html",
  "email_template_registration_confirmation_text",
  "email_template_ticket_delivery_subject",
  "email_template_ticket_delivery_html",
  "email_template_ticket_delivery_text",
  "email_template_payment_confirmation_subject",
  "email_template_payment_confirmation_html",
  "email_template_payment_confirmation_text",
  "email_template_event_update_subject",
  "email_template_event_update_html",
  "email_template_event_update_text",
  "email_template_magic_link_login_subject",
  "email_template_magic_link_login_html",
  "email_template_magic_link_login_text",
] as const satisfies ReadonlyArray<keyof Settings>;

const EVENT_MAIL_SETTINGS_KEYS = [
  "confirmation_email_enabled",
  "confirmation_email_subject",
  ...EMAIL_TEMPLATE_SETTINGS_KEYS,
] as const satisfies ReadonlyArray<keyof Settings>;

const EVENT_PUBLIC_SETTINGS_KEYS = [
  "event_public_page_enabled",
  "event_public_show_seat_availability",
  "event_public_slug",
  "event_public_poster_url",
  "event_public_summary",
  "event_public_registration_enabled",
  "event_public_ticket_recovery_mode",
  "event_public_bot_enabled",
  "event_public_success_message",
  "event_public_cta_label",
  "event_public_privacy_enabled",
  "event_public_privacy_label",
  "event_public_privacy_text",
  "event_public_contact_enabled",
  "event_public_contact_intro",
  "event_public_contact_messenger_url",
  "event_public_contact_line_url",
  "event_public_contact_phone",
  "event_public_contact_hours",
] as const satisfies ReadonlyArray<keyof Settings>;

const EVENT_CONTEXT_SETTINGS_KEYS = ["context"] as const satisfies ReadonlyArray<keyof Settings>;

const AI_SETTINGS_KEYS = [
  "global_system_prompt",
  "global_llm_model",
  "llm_model",
] as const satisfies ReadonlyArray<keyof Settings>;

const AGENT_SETTINGS_KEYS = [
  "admin_agent_enabled",
  "admin_agent_system_prompt",
  "admin_agent_model",
  "admin_agent_default_event_id",
  "admin_agent_policy_read_event",
  "admin_agent_policy_manage_event_setup",
  "admin_agent_policy_manage_event_status",
  "admin_agent_policy_manage_event_context",
  "admin_agent_policy_read_registration",
  "admin_agent_policy_manage_registration",
  "admin_agent_policy_message_user",
  "admin_agent_policy_search_all_events",
  "admin_agent_telegram_enabled",
  "admin_agent_telegram_bot_token",
  "admin_agent_telegram_webhook_secret",
  "admin_agent_telegram_allowed_chat_ids",
  "admin_agent_notification_enabled",
  "admin_agent_notification_on_registration_created",
  "admin_agent_notification_on_registration_status_changed",
  "admin_agent_notification_scope",
  "admin_agent_notification_event_id",
] as const satisfies ReadonlyArray<keyof Settings>;

const WEBHOOK_SETTINGS_KEYS = ["verify_token"] as const satisfies ReadonlyArray<keyof Settings>;

function buildSettingsFromResponse(previous: Settings, data: Partial<Settings> | Record<string, unknown>) {
  return {
    context: typeof data.context === "string" ? data.context : "",
    llm_model: typeof data.llm_model === "string" ? data.llm_model : "",
    global_system_prompt:
      typeof data.global_system_prompt === "string" ? data.global_system_prompt : previous.global_system_prompt,
    global_llm_model:
      typeof data.global_llm_model === "string" ? data.global_llm_model : previous.global_llm_model,
    admin_agent_enabled:
      typeof data.admin_agent_enabled === "string" && data.admin_agent_enabled.trim()
        ? data.admin_agent_enabled.trim()
        : previous.admin_agent_enabled,
    admin_agent_system_prompt:
      typeof data.admin_agent_system_prompt === "string"
        ? data.admin_agent_system_prompt
        : previous.admin_agent_system_prompt,
    admin_agent_model:
      typeof data.admin_agent_model === "string"
        ? data.admin_agent_model
        : previous.admin_agent_model,
    admin_agent_default_event_id:
      typeof data.admin_agent_default_event_id === "string" && data.admin_agent_default_event_id.trim()
        ? data.admin_agent_default_event_id.trim()
        : previous.admin_agent_default_event_id,
    admin_agent_policy_read_event:
      typeof data.admin_agent_policy_read_event === "string" && data.admin_agent_policy_read_event.trim()
        ? data.admin_agent_policy_read_event.trim()
        : previous.admin_agent_policy_read_event,
    admin_agent_policy_manage_event_setup:
      typeof data.admin_agent_policy_manage_event_setup === "string" && data.admin_agent_policy_manage_event_setup.trim()
        ? data.admin_agent_policy_manage_event_setup.trim()
        : previous.admin_agent_policy_manage_event_setup,
    admin_agent_policy_manage_event_status:
      typeof data.admin_agent_policy_manage_event_status === "string" && data.admin_agent_policy_manage_event_status.trim()
        ? data.admin_agent_policy_manage_event_status.trim()
        : previous.admin_agent_policy_manage_event_status,
    admin_agent_policy_manage_event_context:
      typeof data.admin_agent_policy_manage_event_context === "string" && data.admin_agent_policy_manage_event_context.trim()
        ? data.admin_agent_policy_manage_event_context.trim()
        : previous.admin_agent_policy_manage_event_context,
    admin_agent_policy_read_registration:
      typeof data.admin_agent_policy_read_registration === "string" && data.admin_agent_policy_read_registration.trim()
        ? data.admin_agent_policy_read_registration.trim()
        : previous.admin_agent_policy_read_registration,
    admin_agent_policy_manage_registration:
      typeof data.admin_agent_policy_manage_registration === "string" && data.admin_agent_policy_manage_registration.trim()
        ? data.admin_agent_policy_manage_registration.trim()
        : previous.admin_agent_policy_manage_registration,
    admin_agent_policy_message_user:
      typeof data.admin_agent_policy_message_user === "string" && data.admin_agent_policy_message_user.trim()
        ? data.admin_agent_policy_message_user.trim()
        : previous.admin_agent_policy_message_user,
    admin_agent_policy_search_all_events:
      typeof data.admin_agent_policy_search_all_events === "string" && data.admin_agent_policy_search_all_events.trim()
        ? data.admin_agent_policy_search_all_events.trim()
        : previous.admin_agent_policy_search_all_events,
    admin_agent_telegram_enabled:
      typeof data.admin_agent_telegram_enabled === "string" && data.admin_agent_telegram_enabled.trim()
        ? data.admin_agent_telegram_enabled.trim()
        : previous.admin_agent_telegram_enabled,
    admin_agent_telegram_bot_token:
      typeof data.admin_agent_telegram_bot_token === "string"
        ? data.admin_agent_telegram_bot_token
        : previous.admin_agent_telegram_bot_token,
    admin_agent_telegram_webhook_secret:
      typeof data.admin_agent_telegram_webhook_secret === "string"
        ? data.admin_agent_telegram_webhook_secret
        : previous.admin_agent_telegram_webhook_secret,
    admin_agent_telegram_allowed_chat_ids:
      typeof data.admin_agent_telegram_allowed_chat_ids === "string"
        ? data.admin_agent_telegram_allowed_chat_ids
        : previous.admin_agent_telegram_allowed_chat_ids,
    admin_agent_notification_enabled:
      typeof data.admin_agent_notification_enabled === "string" && data.admin_agent_notification_enabled.trim()
        ? data.admin_agent_notification_enabled.trim()
        : previous.admin_agent_notification_enabled,
    admin_agent_notification_on_registration_created:
      typeof data.admin_agent_notification_on_registration_created === "string" && data.admin_agent_notification_on_registration_created.trim()
        ? data.admin_agent_notification_on_registration_created.trim()
        : previous.admin_agent_notification_on_registration_created,
    admin_agent_notification_on_registration_status_changed:
      typeof data.admin_agent_notification_on_registration_status_changed === "string" && data.admin_agent_notification_on_registration_status_changed.trim()
        ? data.admin_agent_notification_on_registration_status_changed.trim()
        : previous.admin_agent_notification_on_registration_status_changed,
    admin_agent_notification_scope:
      typeof data.admin_agent_notification_scope === "string" && data.admin_agent_notification_scope.trim()
        ? (data.admin_agent_notification_scope.trim() === "event" ? "event" : "all")
        : previous.admin_agent_notification_scope,
    admin_agent_notification_event_id:
      typeof data.admin_agent_notification_event_id === "string"
        ? data.admin_agent_notification_event_id.trim()
        : previous.admin_agent_notification_event_id,
    verify_token: typeof data.verify_token === "string" ? data.verify_token : previous.verify_token,
    event_name: typeof data.event_name === "string" ? data.event_name : "",
    event_timezone: normalizeTimeZoneForUi(
      typeof data.event_timezone === "string" ? data.event_timezone : DEFAULT_TIMEZONE,
    ),
    event_venue_name: typeof data.event_venue_name === "string" ? data.event_venue_name : "",
    event_room_detail: typeof data.event_room_detail === "string" ? data.event_room_detail : "",
    event_location: typeof data.event_location === "string" ? data.event_location : "",
    event_map_url: typeof data.event_map_url === "string" ? data.event_map_url : "",
    event_date: normalizeDateTimeLocalValue(typeof data.event_date === "string" ? data.event_date : ""),
    event_end_date: normalizeDateTimeLocalValue(typeof data.event_end_date === "string" ? data.event_end_date : ""),
    event_description: typeof data.event_description === "string" ? data.event_description : "",
    event_travel: typeof data.event_travel === "string" ? data.event_travel : "",
    event_public_page_enabled:
      typeof data.event_public_page_enabled === "string" && data.event_public_page_enabled.trim()
        ? data.event_public_page_enabled.trim()
        : INITIAL_SETTINGS.event_public_page_enabled,
    event_public_show_seat_availability:
      typeof data.event_public_show_seat_availability === "string" && data.event_public_show_seat_availability.trim()
        ? data.event_public_show_seat_availability.trim()
        : INITIAL_SETTINGS.event_public_show_seat_availability,
    event_public_slug:
      typeof data.event_public_slug === "string"
        ? sanitizeEnglishSlugInput(data.event_public_slug)
        : INITIAL_SETTINGS.event_public_slug,
    event_public_poster_url:
      typeof data.event_public_poster_url === "string"
        ? data.event_public_poster_url
        : INITIAL_SETTINGS.event_public_poster_url,
    event_public_summary:
      typeof data.event_public_summary === "string"
        ? data.event_public_summary
        : INITIAL_SETTINGS.event_public_summary,
    event_public_registration_enabled:
      typeof data.event_public_registration_enabled === "string" && data.event_public_registration_enabled.trim()
        ? data.event_public_registration_enabled.trim()
        : INITIAL_SETTINGS.event_public_registration_enabled,
    event_public_ticket_recovery_mode:
      typeof data.event_public_ticket_recovery_mode === "string" && data.event_public_ticket_recovery_mode.trim()
        ? data.event_public_ticket_recovery_mode.trim()
        : INITIAL_SETTINGS.event_public_ticket_recovery_mode,
    event_public_bot_enabled:
      typeof data.event_public_bot_enabled === "string" && data.event_public_bot_enabled.trim()
        ? data.event_public_bot_enabled.trim()
        : INITIAL_SETTINGS.event_public_bot_enabled,
    event_public_success_message:
      typeof data.event_public_success_message === "string" && data.event_public_success_message.trim()
        ? data.event_public_success_message
        : INITIAL_SETTINGS.event_public_success_message,
    event_public_cta_label:
      typeof data.event_public_cta_label === "string" && data.event_public_cta_label.trim()
        ? data.event_public_cta_label
        : INITIAL_SETTINGS.event_public_cta_label,
    event_public_privacy_enabled:
      typeof data.event_public_privacy_enabled === "string" && data.event_public_privacy_enabled.trim()
        ? data.event_public_privacy_enabled.trim()
        : INITIAL_SETTINGS.event_public_privacy_enabled,
    event_public_privacy_label:
      typeof data.event_public_privacy_label === "string" && data.event_public_privacy_label.trim()
        ? data.event_public_privacy_label
        : INITIAL_SETTINGS.event_public_privacy_label,
    event_public_privacy_text:
      typeof data.event_public_privacy_text === "string" && data.event_public_privacy_text.trim()
        ? data.event_public_privacy_text
        : INITIAL_SETTINGS.event_public_privacy_text,
    event_public_contact_enabled:
      typeof data.event_public_contact_enabled === "string" && data.event_public_contact_enabled.trim()
        ? data.event_public_contact_enabled.trim()
        : INITIAL_SETTINGS.event_public_contact_enabled,
    event_public_contact_intro:
      typeof data.event_public_contact_intro === "string"
        ? data.event_public_contact_intro
        : INITIAL_SETTINGS.event_public_contact_intro,
    event_public_contact_messenger_url:
      typeof data.event_public_contact_messenger_url === "string"
        ? data.event_public_contact_messenger_url
        : INITIAL_SETTINGS.event_public_contact_messenger_url,
    event_public_contact_line_url:
      typeof data.event_public_contact_line_url === "string"
        ? data.event_public_contact_line_url
        : INITIAL_SETTINGS.event_public_contact_line_url,
    event_public_contact_phone:
      typeof data.event_public_contact_phone === "string"
        ? data.event_public_contact_phone
        : INITIAL_SETTINGS.event_public_contact_phone,
    event_public_contact_hours:
      typeof data.event_public_contact_hours === "string"
        ? data.event_public_contact_hours
        : INITIAL_SETTINGS.event_public_contact_hours,
    confirmation_email_enabled:
      typeof data.confirmation_email_enabled === "string" && data.confirmation_email_enabled.trim()
        ? data.confirmation_email_enabled.trim()
        : INITIAL_SETTINGS.confirmation_email_enabled,
    confirmation_email_subject:
      typeof data.confirmation_email_subject === "string" && data.confirmation_email_subject.trim()
        ? data.confirmation_email_subject
        : INITIAL_SETTINGS.confirmation_email_subject,
    email_template_registration_confirmation_subject:
      typeof data.email_template_registration_confirmation_subject === "string"
        ? data.email_template_registration_confirmation_subject
        : (typeof data.confirmation_email_subject === "string" ? data.confirmation_email_subject : INITIAL_SETTINGS.email_template_registration_confirmation_subject),
    email_template_registration_confirmation_html:
      typeof data.email_template_registration_confirmation_html === "string"
        ? data.email_template_registration_confirmation_html
        : INITIAL_SETTINGS.email_template_registration_confirmation_html,
    email_template_registration_confirmation_text:
      typeof data.email_template_registration_confirmation_text === "string"
        ? data.email_template_registration_confirmation_text
        : INITIAL_SETTINGS.email_template_registration_confirmation_text,
    email_template_ticket_delivery_subject:
      typeof data.email_template_ticket_delivery_subject === "string"
        ? data.email_template_ticket_delivery_subject
        : INITIAL_SETTINGS.email_template_ticket_delivery_subject,
    email_template_ticket_delivery_html:
      typeof data.email_template_ticket_delivery_html === "string"
        ? data.email_template_ticket_delivery_html
        : INITIAL_SETTINGS.email_template_ticket_delivery_html,
    email_template_ticket_delivery_text:
      typeof data.email_template_ticket_delivery_text === "string"
        ? data.email_template_ticket_delivery_text
        : INITIAL_SETTINGS.email_template_ticket_delivery_text,
    email_template_payment_confirmation_subject:
      typeof data.email_template_payment_confirmation_subject === "string"
        ? data.email_template_payment_confirmation_subject
        : INITIAL_SETTINGS.email_template_payment_confirmation_subject,
    email_template_payment_confirmation_html:
      typeof data.email_template_payment_confirmation_html === "string"
        ? data.email_template_payment_confirmation_html
        : INITIAL_SETTINGS.email_template_payment_confirmation_html,
    email_template_payment_confirmation_text:
      typeof data.email_template_payment_confirmation_text === "string"
        ? data.email_template_payment_confirmation_text
        : INITIAL_SETTINGS.email_template_payment_confirmation_text,
    email_template_event_update_subject:
      typeof data.email_template_event_update_subject === "string"
        ? data.email_template_event_update_subject
        : INITIAL_SETTINGS.email_template_event_update_subject,
    email_template_event_update_html:
      typeof data.email_template_event_update_html === "string"
        ? data.email_template_event_update_html
        : INITIAL_SETTINGS.email_template_event_update_html,
    email_template_event_update_text:
      typeof data.email_template_event_update_text === "string"
        ? data.email_template_event_update_text
        : INITIAL_SETTINGS.email_template_event_update_text,
    email_template_magic_link_login_subject:
      typeof data.email_template_magic_link_login_subject === "string"
        ? data.email_template_magic_link_login_subject
        : INITIAL_SETTINGS.email_template_magic_link_login_subject,
    email_template_magic_link_login_html:
      typeof data.email_template_magic_link_login_html === "string"
        ? data.email_template_magic_link_login_html
        : INITIAL_SETTINGS.email_template_magic_link_login_html,
    email_template_magic_link_login_text:
      typeof data.email_template_magic_link_login_text === "string"
        ? data.email_template_magic_link_login_text
        : INITIAL_SETTINGS.email_template_magic_link_login_text,
    reg_unique_name:
      typeof data.reg_unique_name === "string" && data.reg_unique_name.trim()
        ? data.reg_unique_name.trim()
        : INITIAL_SETTINGS.reg_unique_name,
    reg_limit:
      typeof data.reg_limit === "string" && data.reg_limit.trim() ? data.reg_limit.trim() : INITIAL_SETTINGS.reg_limit,
    reg_start: normalizeDateTimeLocalValue(typeof data.reg_start === "string" ? data.reg_start : ""),
    reg_end: normalizeDateTimeLocalValue(typeof data.reg_end === "string" ? data.reg_end : ""),
  } satisfies Settings;
}

function normalizeSearchQuery(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function buildPublicEventSlug(value: string) {
  return resolveEnglishPublicSlug({ eventName: value });
}

function getPublicEventSlugFromPath(pathname: string) {
  const match = String(pathname || "").match(/^\/events\/([^/?#]+)\/?$/i);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

function matchesSearchQuery(query: string, values: Array<string | null | undefined>) {
  if (!query) return true;
  const haystack = values
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return query.split(/\s+/).every((token) => haystack.includes(token));
}

function getSearchTargetDomId(kind: GlobalSearchResultKind, id: string) {
  return `search-target-${kind}-${id}`;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(Math.max(0, Number(value || 0)));
}

function formatUsdCost(value: number) {
  const numeric = Math.max(0, Number(value || 0));
  if (numeric === 0) return "$0.00";
  if (numeric < 0.01) return `$${numeric.toFixed(4)}`;
  return `$${numeric.toFixed(2)}`;
}

function formatAdminActionLabel(value: string | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "action";
  return raw
    .replace(/_/g, " ")
    .split(" ")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function extractAdminAgentTicketUrls(result: Record<string, unknown> | null | undefined) {
  const ticket = result?.ticket;
  if (!ticket || typeof ticket !== "object") {
    return { pngUrl: "", svgUrl: "" };
  }
  const ticketRecord = ticket as Record<string, unknown>;
  return {
    pngUrl: typeof ticketRecord.png_url === "string" ? ticketRecord.png_url.trim() : "",
    svgUrl: typeof ticketRecord.svg_url === "string" ? ticketRecord.svg_url.trim() : "",
  };
}

function extractAdminAgentCsvDownloadUrl(result: Record<string, unknown> | null | undefined) {
  const raw = typeof result?.download_url === "string" ? result.download_url.trim() : "";
  return raw || "";
}

function normalizeMessageId(value: unknown) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : null;
}

function mergeLogMessageRows(latestFirst: Message[], olderRows: Message[]) {
  const merged = [...latestFirst];
  const seen = new Set<number>();
  for (const row of merged) {
    const id = normalizeMessageId(row.id);
    if (id !== null) seen.add(id);
  }
  for (const row of olderRows) {
    const id = normalizeMessageId(row.id);
    if (id !== null && seen.has(id)) continue;
    merged.push(row);
    if (id !== null) seen.add(id);
  }
  return merged;
}

function getEmailTemplateFieldKey(kind: EmailTemplateKind, field: "subject" | "html" | "text") {
  return getEmailTemplateSettingKey(kind, field) as keyof Settings;
}

function getStoredEmailTemplateValue(settings: Settings, kind: EmailTemplateKind, field: "subject" | "html" | "text") {
  const key = getEmailTemplateFieldKey(kind, field);
  return typeof settings[key] === "string" ? String(settings[key] || "") : "";
}

function getResolvedEmailTemplateValue(settings: Settings, kind: EmailTemplateKind, field: "subject" | "html" | "text") {
  const raw = getStoredEmailTemplateValue(settings, kind, field);
  if (raw.trim()) return raw;
  if (kind === "registration_confirmation" && field === "subject" && settings.confirmation_email_subject.trim()) {
    return settings.confirmation_email_subject;
  }
  return EMAIL_TEMPLATE_DEFAULTS[kind][field];
}

function hasCustomEmailTemplateOverride(settings: Settings, kind: EmailTemplateKind) {
  const html = getStoredEmailTemplateValue(settings, kind, "html").trim();
  const text = getStoredEmailTemplateValue(settings, kind, "text").trim();
  if (html || text) return true;

  const subject = getStoredEmailTemplateValue(settings, kind, "subject").trim();
  if (!subject) {
    return kind === "registration_confirmation"
      ? settings.confirmation_email_subject.trim() !== EMAIL_TEMPLATE_DEFAULTS.registration_confirmation.subject.trim()
      : false;
  }

  if (
    kind === "registration_confirmation"
    && subject === EMAIL_TEMPLATE_DEFAULTS.registration_confirmation.subject.trim()
    && settings.confirmation_email_subject.trim() === subject
  ) {
    return false;
  }

  return true;
}

function updateEmailTemplateValue(settings: Settings, kind: EmailTemplateKind, field: "subject" | "html" | "text", value: string) {
  const key = getEmailTemplateFieldKey(kind, field);
  return {
    ...settings,
    [key]: value,
    ...(kind === "registration_confirmation" && field === "subject"
      ? { confirmation_email_subject: value }
      : {}),
  } satisfies Settings;
}

function resetEmailTemplateToDefault(settings: Settings, kind: EmailTemplateKind) {
  return {
    ...settings,
    [getEmailTemplateFieldKey(kind, "subject")]: "",
    [getEmailTemplateFieldKey(kind, "html")]: "",
    [getEmailTemplateFieldKey(kind, "text")]: "",
    ...(kind === "registration_confirmation"
      ? { confirmation_email_subject: EMAIL_TEMPLATE_DEFAULTS.registration_confirmation.subject }
      : {}),
  } satisfies Settings;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("event");
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [emailStatus, setEmailStatus] = useState<AdminEmailStatusResponse | null>(null);
  const [emailStatusLoading, setEmailStatusLoading] = useState(false);
  const [selectedEmailTemplateKind, setSelectedEmailTemplateKind] = useState<EmailTemplateKind>("registration_confirmation");
  const [emailTestAddress, setEmailTestAddress] = useState("");
  const [emailTestSending, setEmailTestSending] = useState(false);
  const [emailTestMessage, setEmailTestMessage] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [publicEventPage, setPublicEventPage] = useState<PublicEventPageResponse | null>(null);
  const [publicEventLoading, setPublicEventLoading] = useState(false);
  const [publicEventError, setPublicEventError] = useState("");
  const [publicPosterUploading, setPublicPosterUploading] = useState(false);
  const [publicRegistrationForm, setPublicRegistrationForm] = useState<PublicRegistrationFormState>({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
  });
  const [publicTicketLookupForm, setPublicTicketLookupForm] = useState<PublicTicketLookupFormState>({
    phone: "",
    email: "",
    attendee_name: "",
  });
  const [publicRegistrationSubmitting, setPublicRegistrationSubmitting] = useState(false);
  const [publicTicketLookupSubmitting, setPublicTicketLookupSubmitting] = useState(false);
  const [publicRegistrationError, setPublicRegistrationError] = useState("");
  const [publicTicketLookupError, setPublicTicketLookupError] = useState("");
  const [publicRegistrationResult, setPublicRegistrationResult] = useState<PublicEventRegistrationResponse | null>(null);
  const [publicPrivacyOpen, setPublicPrivacyOpen] = useState(false);
  const [publicChatOpen, setPublicChatOpen] = useState(false);
  const [publicChatInput, setPublicChatInput] = useState("");
  const [publicChatSenderId, setPublicChatSenderId] = useState("");
  const [publicChatMessages, setPublicChatMessages] = useState<PublicChatMessage[]>([]);
  const [publicChatLastMessageId, setPublicChatLastMessageId] = useState(0);
  const [publicChatSending, setPublicChatSending] = useState(false);
  const [publicChatError, setPublicChatError] = useState("");
  const publicChatBodyRef = useRef<HTMLDivElement | null>(null);
  const publicPosterFileInputRef = useRef<HTMLInputElement | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [logsLoadingMore, setLogsLoadingMore] = useState(false);
  const [publicInboxConversations, setPublicInboxConversations] = useState<PublicInboxConversationSummary[]>([]);
  const [publicInboxLoading, setPublicInboxLoading] = useState(false);
  const [publicInboxMessage, setPublicInboxMessage] = useState("");
  const [publicInboxSearchQuery, setPublicInboxSearchQuery] = useState("");
  const [publicInboxStatusFilter, setPublicInboxStatusFilter] = useState<"all" | "attention" | PublicInboxConversationStatus>("all");
  const [selectedPublicInboxSenderId, setSelectedPublicInboxSenderId] = useState("");
  const [selectedPublicInboxConversation, setSelectedPublicInboxConversation] = useState<PublicInboxConversationSummary | null>(null);
  const [publicInboxConversationMessages, setPublicInboxConversationMessages] = useState<Message[]>([]);
  const [publicInboxConversationLoading, setPublicInboxConversationLoading] = useState(false);
  const [publicInboxStatusUpdating, setPublicInboxStatusUpdating] = useState(false);
  const [publicInboxReplyText, setPublicInboxReplyText] = useState("");
  const [publicInboxReplySending, setPublicInboxReplySending] = useState(false);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [channels, setChannels] = useState<ChannelAccountRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventLoading, setEventLoading] = useState(false);
  const [eventMessage, setEventMessage] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [eventCreateOpen, setEventCreateOpen] = useState(false);
  const [newPageId, setNewPageId] = useState("");
  const [newPageName, setNewPageName] = useState("");
  const [newPageAccessToken, setNewPageAccessToken] = useState("");
  const [newChannelPlatform, setNewChannelPlatform] = useState<ChannelPlatform>("facebook");
  const [newChannelConfig, setNewChannelConfig] = useState<Record<string, string>>({});
  const [editingChannelKey, setEditingChannelKey] = useState("");
  const [channelPlatformDefinitions, setChannelPlatformDefinitions] = useState<ChannelPlatformDefinition[]>([]);
  const [teamUsers, setTeamUsers] = useState<AuthUser[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamMessage, setTeamMessage] = useState("");
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserDisplayName, setNewUserDisplayName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("operator");
  const [documents, setDocuments] = useState<EventDocumentRecord[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsMessage, setDocumentsMessage] = useState("");
  const [editingDocumentId, setEditingDocumentId] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentSourceType, setDocumentSourceType] = useState<"note" | "document" | "url">("note");
  const [documentSourceUrl, setDocumentSourceUrl] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [documentChunks, setDocumentChunks] = useState<EventDocumentChunkRecord[]>([]);
  const [documentChunksLoading, setDocumentChunksLoading] = useState(false);
  const [selectedDocumentForChunksId, setSelectedDocumentForChunksId] = useState("");
  const [retrievalQuery, setRetrievalQuery] = useState("");
  const [retrievalDebug, setRetrievalDebug] = useState<RetrievalDebugResponse | null>(null);
  const [retrievalLoading, setRetrievalLoading] = useState(false);
  const [retrievalMessage, setRetrievalMessage] = useState("");
  const [embeddingPreview, setEmbeddingPreview] = useState<EmbeddingPreviewResponse | null>(null);
  const [embeddingPreviewLoading, setEmbeddingPreviewLoading] = useState(false);
  const [embeddingPreviewMessage, setEmbeddingPreviewMessage] = useState("");
  const [embeddingEnqueueLoading, setEmbeddingEnqueueLoading] = useState(false);
  const [knowledgeResetting, setKnowledgeResetting] = useState(false);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [selectedRegistrationId, setSelectedRegistrationId] = useState("");
  const [testMessages, setTestMessages] = useState<{ role: "user" | "model", parts: { text?: string, functionCall?: any, functionResponse?: any }[], timestamp: string }[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [adminAgentMessages, setAdminAgentMessages] = useState<AdminAgentChatMessage[]>([]);
  const [adminAgentInputText, setAdminAgentInputText] = useState("");
  const [adminCommandPaletteOpen, setAdminCommandPaletteOpen] = useState(false);
  const [adminCommandPaletteQuery, setAdminCommandPaletteQuery] = useState("");
  const [adminAgentTyping, setAdminAgentTyping] = useState(false);
  const [adminAgentDashboard, setAdminAgentDashboard] = useState<AdminAgentDashboardResponse | null>(null);
  const [adminAgentDashboardLoading, setAdminAgentDashboardLoading] = useState(false);
  const [adminAgentDashboardError, setAdminAgentDashboardError] = useState("");
  const [adminAgentDashboardOpen, setAdminAgentDashboardOpen] = useState(true);
  const [agentMobileFocusMode, setAgentMobileFocusMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 1024;
  });
  const [desktopNotifyEnabled, setDesktopNotifyEnabled] = useState(false);
  const [desktopNotifyPermission, setDesktopNotifyPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return "unsupported";
    }
    return Notification.permission;
  });
  const [copied, setCopied] = useState(false);
  const [publicPageLinkCopied, setPublicPageLinkCopied] = useState(false);
  const [publicPageQrDataUrl, setPublicPageQrDataUrl] = useState("");
  const [publicPageQrSvgMarkup, setPublicPageQrSvgMarkup] = useState("");
  const [publicPageQrError, setPublicPageQrError] = useState("");
  const [selectedWebhookConfigKey, setSelectedWebhookConfigKey] = useState<WebhookConfigKey>("facebook");
  const [setupSelectedChannelId, setSetupSelectedChannelId] = useState("");
  const [channelConfigDialogOpen, setChannelConfigDialogOpen] = useState(false);
  const [searchId, setSearchId] = useState("");
  const [checkinAccessToken] = useState(INITIAL_CHECKIN_TOKEN);
  const [checkinAccessMode, setCheckinAccessMode] = useState(Boolean(INITIAL_CHECKIN_TOKEN));
  const [checkinAccessSession, setCheckinAccessSession] = useState<CheckinAccessSession | null>(null);
  const [checkinAccessLoading, setCheckinAccessLoading] = useState(Boolean(INITIAL_CHECKIN_TOKEN));
  const [checkinAccessError, setCheckinAccessError] = useState("");
  const [checkinSessions, setCheckinSessions] = useState<CheckinSessionRecord[]>([]);
  const [checkinSessionsLoading, setCheckinSessionsLoading] = useState(false);
  const [checkinSessionLabel, setCheckinSessionLabel] = useState("");
  const [checkinSessionHours, setCheckinSessionHours] = useState("8");
  const [checkinSessionMessage, setCheckinSessionMessage] = useState("");
  const [checkinSessionCreating, setCheckinSessionCreating] = useState(false);
  const [checkinSessionRevokingId, setCheckinSessionRevokingId] = useState("");
  const [checkinSessionReveal, setCheckinSessionReveal] = useState<{ token: string; url: string; id: string } | null>(null);
  const [checkinLatestResult, setCheckinLatestResult] = useState<Registration | null>(null);
  const [checkinStatus, setCheckinStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [checkinErrorMessage, setCheckinErrorMessage] = useState("");
  const [statusUpdateLoading, setStatusUpdateLoading] = useState(false);
  const [statusUpdateMessage, setStatusUpdateMessage] = useState("");
  const [deleteRegistrationLoading, setDeleteRegistrationLoading] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [insightsPanelOpen, setInsightsPanelOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [eventListQuery, setEventListQuery] = useState("");
  const [eventWorkspaceFilter, setEventWorkspaceFilter] = useState<EventWorkspaceFilter>("all");
  const [eventWorkspaceSort, setEventWorkspaceSort] = useState<EventWorkspaceSort>("event_start_desc");
  const [registrationListQuery, setRegistrationListQuery] = useState("");
  const [documentListQuery, setDocumentListQuery] = useState("");
  const [logListQuery, setLogListQuery] = useState("");
  const [selectedLogMessageId, setSelectedLogMessageId] = useState<number | null>(null);
  const [manualOverrideText, setManualOverrideText] = useState("");
  const [manualOverrideRegistrationId, setManualOverrideRegistrationId] = useState("");
  const [manualOverrideAction, setManualOverrideAction] = useState<"" | "text" | "ticket" | "retry">("");
  const [manualOverrideMessage, setManualOverrideMessage] = useState("");
  const [logRegistrationDraft, setLogRegistrationDraft] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
  });
  const [logRegistrationAction, setLogRegistrationAction] = useState<"" | "create_ticket">("");
  const [logRegistrationMessage, setLogRegistrationMessage] = useState("");
  const [logToolsOpen, setLogToolsOpen] = useState(false);
  const [eventHistoryOpenKeys, setEventHistoryOpenKeys] = useState<string[]>([]);
  const [collapsedSectionMap, setCollapsedSectionMap] = useState<Record<string, boolean>>(() => {
    const stored = readCollapsedSectionStore();
    if (stored[COLLAPSIBLE_SECTION_KEYS.contextLlmUsage] === undefined) {
      stored[COLLAPSIBLE_SECTION_KEYS.contextLlmUsage] = true;
    }
    return stored;
  });
  const [collapsedContextDocumentIds, setCollapsedContextDocumentIds] = useState<string[]>([]);
  const [searchFocusTarget, setSearchFocusTarget] = useState<SearchFocusTarget>(null);
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [llmModelsLoading, setLlmModelsLoading] = useState(false);
  const [llmModelsError, setLlmModelsError] = useState("");
  const [llmUsageSummary, setLlmUsageSummary] = useState<LlmUsageSummary | null>(null);
  const [llmUsageLoading, setLlmUsageLoading] = useState(false);
  const [llmUsageError, setLlmUsageError] = useState("");
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerStarting, setScannerStarting] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [lastScannedValue, setLastScannedValue] = useState("");
  const [eventWorkspaceView, setEventWorkspaceView] = useState<EventWorkspaceView>("setup");
  const [eventWorkspaceMenuOpen, setEventWorkspaceMenuOpen] = useState(false);
  const [operationsMenuOpen, setOperationsMenuOpen] = useState(false);
  const [setupMenuOpen, setSetupMenuOpen] = useState(false);
  const [agentWorkspaceView, setAgentWorkspaceView] = useState<AgentWorkspaceView>("console");
  const [agentWorkspaceMenuOpen, setAgentWorkspaceMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [knowledgeActionsOpen, setKnowledgeActionsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hoverDropdownEnabled, setHoverDropdownEnabled] = useState(false);
  const [registrationVisibleCount, setRegistrationVisibleCount] = useState(120);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const scannerCooldownRef = useRef(false);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedEventIdRef = useRef("");
  const selectedPublicInboxSenderIdRef = useRef("");
  const publicChatLastMessageIdRef = useRef(0);
  const settingsRef = useRef(INITIAL_SETTINGS);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const qrReaderRef = useRef<BrowserQRCodeReader | null>(null);
  const eventWorkspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const operationsMenuRef = useRef<HTMLDivElement | null>(null);
  const setupMenuRef = useRef<HTMLDivElement | null>(null);
  const agentWorkspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const eventWorkspaceMenuCloseTimerRef = useRef<number | null>(null);
  const operationsMenuCloseTimerRef = useRef<number | null>(null);
  const setupMenuCloseTimerRef = useRef<number | null>(null);
  const agentWorkspaceMenuCloseTimerRef = useRef<number | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const knowledgeActionsRef = useRef<HTMLDivElement | null>(null);
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const searchFocusTimeoutRef = useRef<number | null>(null);
  const adminAgentScrollRef = useRef<HTMLDivElement | null>(null);
  const adminAgentBottomRef = useRef<HTMLDivElement | null>(null);
  const adminAgentInputRef = useRef<HTMLInputElement | null>(null);
  const adminCommandPaletteRef = useRef<HTMLDivElement | null>(null);
  const adminCommandPaletteSearchInputRef = useRef<HTMLInputElement | null>(null);
  const adminAgentHistoryLoadedKeyRef = useRef("");
  const desktopNotifyBootstrappedRef = useRef(false);
  const desktopNotifyLastAuditIdRef = useRef(0);
  selectedEventIdRef.current = selectedEventId;
  selectedPublicInboxSenderIdRef.current = selectedPublicInboxSenderId;
  publicChatLastMessageIdRef.current = publicChatLastMessageId;
  settingsRef.current = settings;

  const currentPathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const publicEventSlug = getPublicEventSlugFromPath(currentPathname);
  const isPublicEventRoute = Boolean(publicEventSlug);
  const role = authUser?.role;
  const canEditSettings = role === "owner" || role === "admin";
  const canRunTest = role === "owner" || role === "admin" || role === "operator";
  const canRunAgent = role === "owner" || role === "admin" || role === "operator";
  const canViewLogs = role === "owner" || role === "admin" || role === "operator" || role === "viewer";
  const canManageRegistrations = role === "owner" || role === "admin" || role === "operator" || role === "checker";
  const canChangeRegistrationStatus = role === "owner" || role === "admin" || role === "operator";
  const canManageKnowledge = role === "owner" || role === "admin" || role === "operator";
  const canManageUsers = role === "owner" || role === "admin";
  const canChangeRoles = role === "owner" || role === "admin";
  const canManageCheckinAccess = role === "owner" || role === "admin" || role === "operator";
  const canSendManualOverride = role === "owner" || role === "admin" || role === "operator";
  const canManageTargetRole = (user: AuthUser) => {
    if (!authUser || user.id === authUser.id || !canChangeRoles) return false;
    if (authUser.role === "owner") return user.role !== "owner";
    return user.role === "operator" || user.role === "checker" || user.role === "viewer";
  };
  const canManageTargetAccess = (user: AuthUser) => {
    if (!authUser || user.id === authUser.id || !canManageUsers) return false;
    if (authUser.role === "owner") return true;
    return user.role === "operator" || user.role === "checker" || user.role === "viewer";
  };
  const canDeleteTeamUser = (user: AuthUser) => canManageTargetAccess(user);
  const deferredGlobalSearchQuery = useDeferredValue(normalizeSearchQuery(globalSearchQuery));
  const deferredEventListQuery = useDeferredValue(normalizeSearchQuery(eventListQuery));
  const deferredRegistrationListQuery = useDeferredValue(normalizeSearchQuery(registrationListQuery));
  const deferredDocumentListQuery = useDeferredValue(normalizeSearchQuery(documentListQuery));
  const deferredLogListQuery = useDeferredValue(normalizeSearchQuery(logListQuery));
  const deferredPublicInboxQuery = useDeferredValue(normalizeSearchQuery(publicInboxSearchQuery));
  const deferredAdminCommandPaletteQuery = useDeferredValue(normalizeSearchQuery(adminCommandPaletteQuery));
  const adminAgentChatStorageKey = authUser?.id
    ? `${authUser.id}:global`
    : "";
  const isSectionCollapsed = (key: string) => Boolean(collapsedSectionMap[key]);
  const toggleSectionCollapsed = (key: string) => {
    setCollapsedSectionMap((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };
  const isContextDocumentCollapsed = (documentId: string) => collapsedContextDocumentIds.includes(documentId);
  const toggleContextDocumentCollapsed = (documentId: string) => {
    setCollapsedContextDocumentIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  };
  useEffect(() => {
    writeCollapsedSectionStore(collapsedSectionMap);
  }, [collapsedSectionMap]);
  const desktopNotificationSupported = typeof window !== "undefined" && typeof Notification !== "undefined";
  const desktopNotifyPermissionLabel =
    desktopNotifyPermission === "granted"
      ? "granted"
      : desktopNotifyPermission === "denied"
      ? "blocked"
      : desktopNotifyPermission === "default"
      ? "not requested"
      : "unsupported";

  const selectedRegistration = registrations.find((reg) => reg.id === selectedRegistrationId) || null;
  const latestCheckinRegistration = checkinLatestResult || selectedRegistration;
  const selectedDocumentForChunks = documents.find((document) => document.id === selectedDocumentForChunksId) || null;
  const activeLlmModel = settings.llm_model?.trim() || settings.global_llm_model?.trim() || "google/gemini-3-flash-preview";
  const selectedEventUsage = llmUsageSummary?.selected_event || null;
  const overallLlmUsage = llmUsageSummary?.overall || null;
  const selectedEventTopModel = llmUsageSummary?.selected_event_models?.[0] || null;
  const registeredCount = registrations.filter((reg) => reg.status === "registered").length;
  const cancelledCount = registrations.filter((reg) => reg.status === "cancelled").length;
  const checkedInCount = registrations.filter((reg) => reg.status === "checked-in").length;
  const activeAgentMessageCount = adminAgentMessages.length;
  const filteredAdminCommandTemplates = ADMIN_AGENT_COMMAND_TEMPLATES.filter((template) =>
    matchesSearchQuery(deferredAdminCommandPaletteQuery, [
      template.id,
      template.label,
      template.command,
      template.note,
      template.keywords.join(" "),
    ]),
  );
  const adminAgentConsoleQuickTemplates = ADMIN_AGENT_CONSOLE_QUICK_TEMPLATE_IDS
    .map((id) => ADMIN_AGENT_COMMAND_TEMPLATES.find((template) => template.id === id) || null)
    .filter((template): template is AdminAgentCommandTemplate => Boolean(template));
  const adminAgentPolicy = {
    readEvent: settings.admin_agent_policy_read_event !== "0",
    manageEventSetup: settings.admin_agent_policy_manage_event_setup === "1",
    manageEventStatus: settings.admin_agent_policy_manage_event_status === "1",
    manageEventContext: settings.admin_agent_policy_manage_event_context === "1",
    readRegistration: settings.admin_agent_policy_read_registration !== "0",
    manageRegistration: settings.admin_agent_policy_manage_registration !== "0",
    messageUser: settings.admin_agent_policy_message_user !== "0",
    searchAllEvents: settings.admin_agent_policy_search_all_events !== "0",
  };
  const adminAgentEnabledPolicies = [
    adminAgentPolicy.readEvent ? "event-read" : "",
    adminAgentPolicy.manageEventSetup ? "event-setup-write" : "",
    adminAgentPolicy.manageEventStatus ? "event-status-write" : "",
    adminAgentPolicy.manageEventContext ? "event-context-write" : "",
    adminAgentPolicy.readRegistration ? "registration-read" : "",
    adminAgentPolicy.manageRegistration ? "registration-write" : "",
    adminAgentPolicy.messageUser ? "message-send/retry" : "",
    adminAgentPolicy.searchAllEvents ? "cross-event-search" : "",
  ].filter(Boolean);
  const adminAgentGuardTone: BadgeTone = settings.admin_agent_enabled === "1" ? "emerald" : "amber";
  const adminAgentGuardLabel = settings.admin_agent_enabled === "1" ? "live actions" : "disabled";
  const adminAgentGuardBody =
    settings.admin_agent_enabled === "1"
      ? `Agent mode executes only enabled policy scopes (${adminAgentEnabledPolicies.length}/8): ${adminAgentEnabledPolicies.join(", ") || "none"}.`
      : "Enable Admin Agent in setup before running commands from UI or Telegram.";
  const isAgentMobileFocusMode = activeTab === "agent" && agentWorkspaceView === "console" && agentMobileFocusMode;
  const selectedAdminAgentDashboardEvent = adminAgentDashboard?.events.find((event) => event.is_selected) || null;
  const activeAttendeeCount = registrations.filter((reg) => reg.status !== "cancelled").length;
  const checkInRate = activeAttendeeCount > 0 ? Math.round((checkedInCount / activeAttendeeCount) * 100) : 0;
  const latestResultState: "success" | "already" | "invalid" | "cancelled" | "idle" =
    checkinStatus === "error" && checkinErrorMessage.toLowerCase().includes("already")
      ? "already"
      : checkinStatus === "error"
      ? "invalid"
      : latestCheckinRegistration?.status === "cancelled"
      ? "cancelled"
      : latestCheckinRegistration
      ? "success"
      : "idle";
  const latestResultToneClass =
    latestResultState === "success"
      ? "border-emerald-200 bg-emerald-50"
      : latestResultState === "already"
      ? "border-amber-200 bg-amber-50"
      : latestResultState === "invalid"
      ? "border-rose-200 bg-rose-50"
      : latestResultState === "cancelled"
      ? "border-slate-300 bg-slate-100"
      : "border-slate-200 bg-slate-50";
  const latestResultLabel =
    latestResultState === "success"
      ? "Check-in success"
      : latestResultState === "already"
      ? "Already checked in"
      : latestResultState === "invalid"
      ? "Invalid ticket"
      : latestResultState === "cancelled"
      ? "Cancelled attendee"
      : "Waiting for scan";
  const canUseQrScanner =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);
  const searchShortcutLabel =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      ? "Cmd K"
      : "Ctrl K";
  const eventWorkspaceTabs = [
    { id: "setup" as const, icon: CalendarRange, label: "Event Setup", description: "Operational event details and registration rules" },
    { id: "public" as const, icon: Eye, label: "Public Page", description: "Poster, public copy, and privacy messaging" },
  ];
  const selectedEventWorkspaceTab = eventWorkspaceTabs.find((tab) => tab.id === eventWorkspaceView) || eventWorkspaceTabs[0];
  const isOperationsTab = activeTab === "registrations" || activeTab === "inbox" || activeTab === "checkin" || activeTab === "logs";
  const isSetupTab = activeTab === "settings" || activeTab === "team";
  const primaryTabs = [
    ...(canEditSettings ? [{ id: "event" as const, icon: CalendarRange, label: "Event" }] : []),
    ...(canEditSettings ? [{ id: "mail" as const, icon: Send, label: "Mail" }] : []),
    ...(canEditSettings ? [{ id: "design" as const, icon: Code, label: "Context" }] : []),
    ...(canRunTest ? [{ id: "test" as const, icon: MessageSquare, label: "Test" }] : []),
    ...(canRunAgent ? [{ id: "agent" as const, icon: MonitorCog, label: "Agent" }] : []),
  ];
  const setupTabs = [
    ...(canEditSettings ? [{ id: "settings" as const, icon: SettingsIcon, label: "Organization Setup" }] : []),
    ...(canManageUsers ? [{ id: "team" as const, icon: Shield, label: "Team Access" }] : []),
  ];
  const selectedSetupTab = setupTabs.find((tab) => tab.id === activeTab) || setupTabs[0] || null;
  const agentWorkspaceTabs = [
    { id: "console" as const, icon: MonitorCog, label: "Agent Chat", description: "Operational command chat" },
    { id: "setup" as const, icon: SettingsIcon, label: "Runtime Setup", description: "Runtime policy and external channel setup" },
  ];
  const operationsTabs = [
    ...(canManageRegistrations ? [{ id: "registrations" as const, icon: Users, label: "Registrations" }] : []),
    ...(canViewLogs ? [{ id: "inbox" as const, icon: MessageSquare, label: "Public Inbox" }] : []),
    ...(canManageRegistrations ? [{ id: "checkin" as const, icon: QrCode, label: "Check-in" }] : []),
    ...(canViewLogs ? [{ id: "logs" as const, icon: Activity, label: "Logs" }] : []),
  ];
  const helpContent = TAB_HELP_CONTENT[activeTab];
  const selectedTicketPngUrl = selectedRegistration
    ? `/api/tickets/${encodeURIComponent(selectedRegistration.id)}.png`
    : "";
  const selectedTicketSvgUrl = selectedRegistration
    ? `/api/tickets/${encodeURIComponent(selectedRegistration.id)}.svg`
    : "";
  const timingInfo = describeEventTiming(settings);
  const eventLocationSummary = buildEventLocationSummary(settings);
  const attendeeLocationLabel = formatEventLocationCompact(settings, "");
  const resolvedEventMapUrl = resolveEventMapUrl(settings);
  const eventMapEmbedUrl = buildGoogleMapsEmbedUrl(settings);
  const eventMapIsGenerated = !settings.event_map_url.trim() && Boolean(resolvedEventMapUrl);
  const selectedEvent = events.find((event) => event.id === selectedEventId) || null;
  const emailReadinessTone: BadgeTone = emailStatus?.configured
    ? "emerald"
    : emailStatus?.readiness === "invalid_config"
      ? "rose"
      : "amber";
  const emailReadinessLabel = emailStatus?.configured
    ? "ready"
    : emailStatus?.readiness === "invalid_config"
      ? "invalid"
      : "incomplete";
  const resolvedPublicPageSlug = resolveEnglishPublicSlug({
    customSlug: settings.event_public_slug,
    eventName: settings.event_name || selectedEvent?.name || "",
    eventSlug: selectedEvent?.slug || "",
    eventId: selectedEvent?.id || selectedEventId,
  });
  const publicPagePreviewPath = `/events/${encodeURIComponent(resolvedPublicPageSlug)}`;
  const publicPageAbsoluteUrl = typeof window !== "undefined"
    ? new URL(publicPagePreviewPath, window.location.origin).toString()
    : publicPagePreviewPath;
  const emailTemplateDefinition = EMAIL_TEMPLATE_DEFAULTS[selectedEmailTemplateKind];
  const selectedEmailTemplateSubject = getResolvedEmailTemplateValue(settings, selectedEmailTemplateKind, "subject");
  const selectedEmailTemplateHtml = getResolvedEmailTemplateValue(settings, selectedEmailTemplateKind, "html");
  const selectedEmailTemplateText = getResolvedEmailTemplateValue(settings, selectedEmailTemplateKind, "text");
  const emailPreviewBaseUrl = typeof window !== "undefined" ? window.location.origin : publicPageAbsoluteUrl;
  const emailPreviewTicketUrl = emailPreviewBaseUrl
    ? new URL(`/api/tickets/${encodeURIComponent("TEST-TICKET")}.png`, emailPreviewBaseUrl).toString()
    : "";
  const emailPreviewTokens = {
    app_url: emailPreviewBaseUrl,
    event_name: settings.event_name || selectedEvent?.name || "Sample Event",
    full_name: "Test Attendee",
    registration_id: "TEST-TICKET",
    event_date: timingInfo.eventDateLabel,
    event_location: attendeeLocationLabel || "Main venue",
    map_url: resolvedEventMapUrl || "",
    travel_info: eventLocationSummary.travelInfo || "Follow the current event travel instructions.",
    ticket_url: emailPreviewTicketUrl,
    event_page_url: publicPageAbsoluteUrl,
    support_email: emailStatus?.replyToAddress || "support@example.com",
    payment_amount: "THB 1,500",
    payment_status: "Paid",
    update_summary: "Schedule or venue changes will be summarized here before this email goes live.",
    magic_link_url: emailPreviewBaseUrl,
  };
  const renderedEmailPreviewSubject = replaceEmailTemplateTokens(selectedEmailTemplateSubject, emailPreviewTokens);
  const renderedEmailPreviewHtml = replaceEmailTemplateTokens(selectedEmailTemplateHtml, emailPreviewTokens);
  const renderedEmailPreviewText = replaceEmailTemplateTokens(selectedEmailTemplateText, emailPreviewTokens);
  const publicPageQrFileBase = `event-${resolvedPublicPageSlug || "public-page"}-qr`;
  const publicPageAutoSummary = resolvePublicSummary("", settings.event_description);
  const publicPageSummary = resolvePublicSummary(settings.event_public_summary, settings.event_description);
  const publicPageSummaryWordCount = countApproxWords(settings.event_public_summary);
  const publicPagePosterUrl = settings.event_public_poster_url.trim();
  const publicPageEnabled = settings.event_public_page_enabled === "1";
  const publicShowSeatAvailability = settings.event_public_show_seat_availability === "1";
  const publicRegistrationEnabled = settings.event_public_registration_enabled === "1";
  const publicTicketRecoveryMode = settings.event_public_ticket_recovery_mode === "verified_contact"
    ? "verified_contact"
    : "shared_contact";
  const publicBotEnabled = settings.event_public_bot_enabled === "1";
  const publicPrivacyEnabled = settings.event_public_privacy_enabled === "1";
  const publicContactEnabled = settings.event_public_contact_enabled === "1";
  const publicContactIntro = settings.event_public_contact_intro.trim() || INITIAL_SETTINGS.event_public_contact_intro;
  const publicContactMessengerHref = normalizeExternalHref(settings.event_public_contact_messenger_url);
  const publicContactLineHref = normalizeExternalHref(settings.event_public_contact_line_url);
  const publicContactPhoneHref = normalizePhoneHref(settings.event_public_contact_phone);
  const publicContactHasContent = Boolean(
    publicContactMessengerHref
    || publicContactLineHref
    || settings.event_public_contact_phone.trim()
    || settings.event_public_contact_hours.trim(),
  );

  useEffect(() => {
    let cancelled = false;

    const generatePublicPageQrAssets = async () => {
      if (!publicPageAbsoluteUrl) {
        setPublicPageQrDataUrl("");
        setPublicPageQrSvgMarkup("");
        setPublicPageQrError("");
        return;
      }

      try {
        const [dataUrl, svgMarkup] = await Promise.all([
          QRCode.toDataURL(publicPageAbsoluteUrl, {
            width: PUBLIC_PAGE_QR_SIZE,
            margin: PUBLIC_PAGE_QR_MARGIN,
            color: {
              dark: "#0f172a",
              light: "#ffffff",
            },
          }),
          QRCode.toString(publicPageAbsoluteUrl, {
            type: "svg",
            width: PUBLIC_PAGE_QR_SIZE,
            margin: PUBLIC_PAGE_QR_MARGIN,
            color: {
              dark: "#0f172a",
              light: "#ffffff",
            },
          }),
        ]);

        if (cancelled) return;
        setPublicPageQrDataUrl(dataUrl);
        setPublicPageQrSvgMarkup(svgMarkup);
        setPublicPageQrError("");
      } catch (error) {
        if (cancelled) return;
        setPublicPageQrDataUrl("");
        setPublicPageQrSvgMarkup("");
        setPublicPageQrError(error instanceof Error ? error.message : "Failed to generate public page QR code");
      }
    };

    void generatePublicPageQrAssets();

    return () => {
      cancelled = true;
    };
  }, [publicPageAbsoluteUrl]);

  const publicRouteLocationFields = publicEventPage
    ? {
        event_venue_name: publicEventPage.location.venue_name,
        event_room_detail: publicEventPage.location.room_detail,
        event_location: publicEventPage.location.address,
      }
    : null;
  const publicRouteMapEmbedUrl = publicRouteLocationFields ? buildGoogleMapsEmbedUrl(publicRouteLocationFields) : "";
  const publicRouteAvailabilityTone = getRegistrationAvailabilityTone(publicEventPage?.event.registration_availability);
  const publicRouteAvailabilityLabel = getRegistrationAvailabilityLabel(publicEventPage?.event.registration_availability);
  const registrationCapacity = describeRegistrationCapacity(settings.reg_limit, activeAttendeeCount);
  const registrationAvailability = describeRegistrationAvailability(
    selectedEvent?.effective_status,
    timingInfo.registrationStatus,
    registrationCapacity.isFull,
  );
  const eventOperatorGuard = describeEventOperatorGuard(
    selectedEvent?.effective_status,
    selectedEvent?.registration_availability,
  );
  const checkinOperatorGuard = describeCheckinOperatorGuard(
    selectedEvent?.effective_status,
    selectedEvent?.registration_availability,
  );
  const selectedEventChannels = channels.filter((channel) => channel.event_id === selectedEventId);
  const eventNameById = new Map(events.map((event) => [event.id, event.name] as const));
  const workspaceChannelCount = channels.length;
  const workspaceActiveChannelCount = channels.filter((channel) => channel.is_active).length;
  const workspaceChannelPlatformCount = new Set(channels.map((channel) => channel.platform)).size;
  const workspaceChannelEventCount = new Set(channels.map((channel) => channel.event_id).filter(Boolean)).size;
  const workspaceOtherEventChannels = channels.filter((channel) => channel.event_id !== selectedEventId);
  const workspaceChannelPreview = workspaceOtherEventChannels.slice(0, 6);
  const allChannelIdsKey = channels.map((channel) => channel.id).join("|");
  const selectedEventChannelIdsKey = selectedEventChannels.map((channel) => channel.id).join("|");
  const setupSelectedChannel =
    channels.find((channel) => channel.id === setupSelectedChannelId)
    || selectedEventChannels[0]
    || workspaceOtherEventChannels[0]
    || null;
  const selectedChannelPlatformDefinition = channelPlatformDefinitions.find((definition) => definition.id === newChannelPlatform) || null;
  const editingChannel = channels.find((channel) => `${channel.platform}:${channel.external_id}` === editingChannelKey) || null;
  const editingChannelKeepsCredentials = Boolean(editingChannel && editingChannel.platform === newChannelPlatform);
  const lineChannelIdAutoResolved = newChannelPlatform === "line_oa";
  const channelFormMissingRequirements = (() => {
    if (!selectedChannelPlatformDefinition) return [];
    const missing: string[] = [];
    const hasAccessToken = Boolean(
      newPageAccessToken.trim()
      || (editingChannelKeepsCredentials && editingChannel?.has_access_token)
      || (newChannelPlatform === "facebook"),
    );
    if (selectedChannelPlatformDefinition.access_token_required && !hasAccessToken) {
      missing.push(selectedChannelPlatformDefinition.access_token_label);
    }
    for (const field of selectedChannelPlatformDefinition.config_fields) {
      if (field.required && !String(newChannelConfig[field.key] || "").trim()) {
        missing.push(field.label);
      }
    }
    return missing;
  })();
  const selectedEventChannelWritesLocked =
    selectedEvent?.effective_status === "closed"
    || selectedEvent?.effective_status === "cancelled"
    || selectedEvent?.effective_status === "archived";
  const selectedEventCheckinLocked =
    selectedEvent?.effective_status === "inactive"
    || selectedEvent?.effective_status === "closed"
    || selectedEvent?.effective_status === "cancelled"
    || selectedEvent?.effective_status === "archived";
  const workingEvents = events.filter((event) => event.effective_status === "active" || event.effective_status === "pending");
  const inactiveEvents = events.filter((event) => event.effective_status === "inactive");
  const nonHistoricalEvents = [...workingEvents, ...inactiveEvents];
  const queryMatchedEvents = [...events]
    .filter((event) =>
      matchesSearchQuery(deferredEventListQuery, [
        event.name,
        event.slug,
        getEventStatusLabel(event.effective_status),
        getRegistrationAvailabilityLabel(event.registration_availability),
      ]),
    )
    .sort((left, right) => compareEventWorkspaceRecords(left, right, eventWorkspaceSort));
  const eventWorkspaceCounts = {
    all: queryMatchedEvents.length,
    active: queryMatchedEvents.filter((event) => event.effective_status === "active").length,
    pending: queryMatchedEvents.filter((event) => event.effective_status === "pending").length,
    inactive: queryMatchedEvents.filter((event) => event.effective_status === "inactive").length,
    closed: queryMatchedEvents.filter((event) => event.effective_status === "closed").length,
    cancelled: queryMatchedEvents.filter((event) => event.effective_status === "cancelled").length,
    archived: queryMatchedEvents.filter((event) => event.effective_status === "archived").length,
  };
  const filteredEventWorkspaceEvents = queryMatchedEvents.filter((event) =>
    eventWorkspaceFilter === "all" ? true : event.effective_status === eventWorkspaceFilter,
  );
  const filteredWorkingEvents = filteredEventWorkspaceEvents.filter(
    (event) => event.effective_status === "active" || event.effective_status === "pending",
  );
  const filteredInactiveEvents = filteredEventWorkspaceEvents.filter((event) => event.effective_status === "inactive");
  const filteredArchivedEvents = filteredEventWorkspaceEvents.filter((event) => event.effective_status === "archived");
  const filteredHistoricalEvents = filteredEventWorkspaceEvents.filter(
    (event) => event.effective_status === "closed" || event.effective_status === "cancelled",
  );
  const recentHistoricalEvents = filteredHistoricalEvents.slice(0, 6);
  const historyEventGroups = filteredHistoricalEvents
    .slice(6)
    .reduce<
    Array<{ key: string; label: string; events: EventRecord[] }>
  >((groups, event) => {
    const key = getEventHistoryGroupKey(event.updated_at || event.created_at);
    const existing = groups.find((group) => group.key === key);
    if (existing) {
      existing.events.push(event);
      return groups;
    }
    groups.push({
      key,
      label: formatEventHistoryGroupLabel(event.updated_at || event.created_at),
      events: [event],
    });
    return groups;
  }, [])
    .map((group) => ({
      ...group,
      events: [...group.events].sort((left, right) => compareEventWorkspaceRecords(left, right, eventWorkspaceSort)),
    }))
    .sort((left, right) => {
      const leftTimestamp = Math.max(...left.events.map((event) => getEventWorkspaceTimestamp(event)));
      const rightTimestamp = Math.max(...right.events.map((event) => getEventWorkspaceTimestamp(event)));
      return rightTimestamp - leftTimestamp;
    });
  const eventWorkspaceFilterOptions: Array<{ id: EventWorkspaceFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: eventWorkspaceCounts.all },
    { id: "active", label: "Live", count: eventWorkspaceCounts.active },
    { id: "pending", label: "Pending", count: eventWorkspaceCounts.pending },
    { id: "inactive", label: "Inactive", count: eventWorkspaceCounts.inactive },
    { id: "closed", label: "Closed", count: eventWorkspaceCounts.closed },
    { id: "cancelled", label: "Cancelled", count: eventWorkspaceCounts.cancelled },
    { id: "archived", label: "Archived", count: eventWorkspaceCounts.archived },
  ];
  const liveWorkspaceHeading =
    eventWorkspaceFilter === "active"
      ? "Live Workspaces"
      : eventWorkspaceFilter === "pending"
      ? "Pending Workspaces"
      : "Live & Pending";
  const historyWorkspaceHeading =
    eventWorkspaceFilter === "closed"
      ? "Recently Closed"
      : eventWorkspaceFilter === "cancelled"
      ? "Recently Cancelled"
      : "Recent History";
  const inactiveWorkspaceHeading = eventWorkspaceFilter === "inactive" ? "Inactive Workspaces" : "Inactive";
  const archivedWorkspaceHeading = eventWorkspaceFilter === "archived" ? "Archived Workspaces" : "Archived";
  const selectorEvents = [...nonHistoricalEvents].sort((left, right) => compareEventWorkspaceRecords(left, right, eventWorkspaceSort));
  const selectedEventAvailableInSelector = Boolean(
    selectedEvent && selectorEvents.some((event) => event.id === selectedEvent.id),
  );
  const selectorPlaceholderLabel = selectorEvents.length === 0
    ? "No live, pending, or inactive workspaces"
    : selectedEvent
      ? "Historical workspace selected. Choose a live, pending, or inactive workspace."
      : "Select a live, pending, or inactive workspace";
  const eventStatusToggle = (() => {
    if (!selectedEvent) {
      return {
        label: "LIVE!",
        nextStatus: "active" as const,
        tone: "emerald" as ActionTone,
        disabled: true,
      };
    }
    if (selectedEvent.effective_status === "closed") {
      if (selectedEvent.status === "inactive") {
        return {
          label: "Inactive",
          nextStatus: "inactive" as const,
          tone: "neutral" as ActionTone,
          disabled: true,
        };
      }
      if (selectedEvent.status === "cancelled") {
        return {
          label: "Restore Inactive",
          nextStatus: "inactive" as const,
          tone: "neutral" as ActionTone,
          disabled: selectedEvent.is_default || eventLoading,
        };
      }
      if (selectedEvent.status === "archived") {
        return {
          label: "Restore Inactive",
          nextStatus: "inactive" as const,
          tone: "neutral" as ActionTone,
          disabled: selectedEvent.is_default || eventLoading,
        };
      }
      return {
        label: "Set Inactive",
        nextStatus: "inactive" as const,
        tone: "neutral" as ActionTone,
        disabled: eventLoading,
      };
    }
    if (selectedEvent.status === "active") {
      return {
        label: "Set Inactive",
        nextStatus: "inactive" as const,
        tone: "neutral" as ActionTone,
        disabled: eventLoading,
      };
    }
    if (selectedEvent.status === "inactive") {
      return {
        label: "LIVE!",
        nextStatus: "active" as const,
        tone: "emerald" as ActionTone,
        disabled: eventLoading,
      };
    }
    if (selectedEvent.status === "cancelled") {
      return {
        label: "Restore Inactive",
        nextStatus: "inactive" as const,
        tone: "neutral" as ActionTone,
        disabled: eventLoading,
      };
    }
    if (selectedEvent.status === "archived") {
      return {
        label: "Restore Inactive",
        nextStatus: "inactive" as const,
        tone: "neutral" as ActionTone,
        disabled: eventLoading,
      };
    }
    return {
      label: "LIVE!",
      nextStatus: "active" as const,
      tone: "emerald" as ActionTone,
      disabled: eventLoading,
    };
  })();
  const visibleSelectedEventChannels = selectedEventChannels;
  const filteredRegistrations = registrations.filter((reg) =>
    matchesSearchQuery(deferredRegistrationListQuery, [
      reg.id,
      reg.first_name,
      reg.last_name,
      `${reg.first_name} ${reg.last_name}`,
      reg.phone,
      reg.email,
      reg.status,
    ]),
  );
  const visibleRegistrations = filteredRegistrations.slice(0, registrationVisibleCount);
  const hasMoreRegistrations = filteredRegistrations.length > visibleRegistrations.length;
  const filteredDocuments = documents.filter((document) =>
    matchesSearchQuery(deferredDocumentListQuery, [
      document.title,
      document.source_type,
      document.source_url,
      document.embedding_status,
      document.content,
      document.is_active ? "active" : "inactive",
    ]),
  );
  const filteredMessages = messages.filter((message) =>
    matchesSearchQuery(deferredLogListQuery, [
      message.sender_id,
      message.sender_name,
      message.sender_phone,
      message.sender_email,
      message.registration_id,
      message.platform,
      message.channel_display_name,
      message.text,
      message.type,
      parseLineTraceMessage(message.text)?.status,
      parseLineTraceMessage(message.text)?.detail,
    ]),
  );
  const filteredPublicInboxConversations = publicInboxConversations.filter((conversation) => {
    const matchesStatus =
      publicInboxStatusFilter === "all"
        ? true
        : publicInboxStatusFilter === "attention"
        ? conversation.needs_attention
        : conversation.status === publicInboxStatusFilter;
    return matchesStatus && matchesSearchQuery(deferredPublicInboxQuery, [
      conversation.participant_label,
      conversation.sender_name,
      conversation.sender_phone,
      conversation.sender_email,
      conversation.registration_id,
      conversation.sender_id,
      conversation.last_message_text,
      conversation.public_slug,
      conversation.attention_reason,
      getPublicInboxStatusLabel(conversation.status),
    ]);
  });
  const publicInboxCounts = {
    all: publicInboxConversations.length,
    attention: publicInboxConversations.filter((conversation) => conversation.needs_attention).length,
    open: publicInboxConversations.filter((conversation) => conversation.status === "open").length,
    "waiting-admin": publicInboxConversations.filter((conversation) => conversation.status === "waiting-admin").length,
    "waiting-user": publicInboxConversations.filter((conversation) => conversation.status === "waiting-user").length,
    resolved: publicInboxConversations.filter((conversation) => conversation.status === "resolved").length,
  };
  const activePublicInboxConversation =
    publicInboxConversations.find((conversation) => conversation.sender_id === selectedPublicInboxSenderId)
    || selectedPublicInboxConversation;
  const selectedLogMessage =
    filteredMessages.find((message) => message.id === selectedLogMessageId)
    || filteredMessages[0]
    || null;
  const selectedSenderThread = selectedLogMessage
    ? [...messages]
        .filter((message) => message.sender_id === selectedLogMessage.sender_id)
        .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    : [];
  const selectedSenderRegistrations = selectedLogMessage
    ? [...registrations]
        .filter((registration) => registration.sender_id === selectedLogMessage.sender_id)
        .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    : [];
  const selectedSenderRegistrationKey = selectedSenderRegistrations.map((registration) => registration.id).join("|");
  const selectedLogChannel = selectedLogMessage?.page_id
    ? channels.find((channel) =>
        channel.event_id === (selectedLogMessage.event_id || selectedEventId)
        && channel.external_id === selectedLogMessage.page_id,
      ) || null
    : null;
  const selectedLogAuditMarker = selectedLogMessage ? parseInternalLogMarker(selectedLogMessage.text) : null;
  const manualOverrideUnavailableReason =
    !selectedLogMessage
      ? "Select a sender thread first."
      : !selectedLogMessage.event_id
      ? "This log row does not include an event context."
      : !selectedLogMessage.page_id
      ? "This log row does not include a channel destination."
      : selectedLogChannel?.platform === "web_chat"
      ? "Manual push is not supported for web chat."
      : "";
  const manualReplyTemplates = [
    {
      id: "ask_registration_fields",
      label: "Ask Details",
      text:
        selectedEvent?.registration_availability === "full"
          ? "ขออภัยค่ะ ตอนนี้ที่นั่งของงานนี้เต็มแล้ว หากมีที่ว่างเพิ่มแพรวจะแจ้งให้ทราบนะคะ"
          : "หากต้องการลงทะเบียน กรุณาส่งชื่อ นามสกุล และเบอร์โทรศัพท์ได้เลยค่ะ ถ้ามีอีเมลสามารถแนบมาเพิ่มได้ค่ะ",
    },
    {
      id: "reviewing",
      label: "Reviewing",
      text: "รับข้อมูลแล้วค่ะ เดี๋ยวแพรวตรวจสอบและยืนยันให้ในข้อความถัดไปนะคะ",
    },
    {
      id: "ticket_sent",
      label: "Ticket Sent",
      text: "ส่งตั๋วให้แล้วนะคะ กรุณาตรวจสอบในแชตนี้ได้เลยค่ะ หากเปิดไม่ได้แจ้งแพรวได้ทันทีค่ะ",
    },
    {
      id: "map_followup",
      label: "Map Follow-up",
      text: resolvedEventMapUrl
        ? `แผนที่สถานที่อยู่ที่นี่ค่ะ ${resolvedEventMapUrl}`
        : "เดี๋ยวแพรวจะแนบแผนที่สถานที่ให้ในข้อความถัดไปนะคะ",
    },
  ];
  const globalEventResults = deferredGlobalSearchQuery
    ? events.filter((event) =>
        matchesSearchQuery(deferredGlobalSearchQuery, [
          event.name,
          event.slug,
          getEventStatusLabel(event.effective_status),
          getRegistrationAvailabilityLabel(event.registration_availability),
        ]),
      ).slice(0, 6)
    : [];
  const globalRegistrationResults = deferredGlobalSearchQuery
    ? registrations.filter((reg) =>
        matchesSearchQuery(deferredGlobalSearchQuery, [
          reg.id,
          reg.first_name,
          reg.last_name,
          `${reg.first_name} ${reg.last_name}`,
          reg.phone,
          reg.email,
        ]),
      ).slice(0, 8)
    : [];
  const globalChannelResults = deferredGlobalSearchQuery
    ? channels.filter((channel) =>
        matchesSearchQuery(deferredGlobalSearchQuery, [
          channel.display_name,
          channel.external_id,
          channel.platform_label,
          channel.platform,
          channel.connection_status,
          channel.platform_description,
        ]),
      ).slice(0, 8)
    : [];
  const globalDocumentResults = deferredGlobalSearchQuery
    ? documents.filter((document) =>
        matchesSearchQuery(deferredGlobalSearchQuery, [
          document.title,
          document.source_type,
          document.source_url,
          document.embedding_status,
        ]),
      ).slice(0, 6)
    : [];
  const globalLogResults = deferredGlobalSearchQuery
    ? messages.filter((message) =>
        matchesSearchQuery(deferredGlobalSearchQuery, [message.sender_id, message.text, message.type]),
      ).slice(0, 6)
    : [];

  const readCookieValue = (name: string) => {
    if (typeof document === "undefined") return "";
    const prefix = `${name}=`;
    const segments = document.cookie ? document.cookie.split(";") : [];
    for (const segment of segments) {
      const trimmed = segment.trim();
      if (!trimmed.startsWith(prefix)) continue;
      const rawValue = trimmed.slice(prefix.length);
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }
    return "";
  };

  const appendCsrfHeader = (init?: RequestInit) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (!UNSAFE_HTTP_METHODS.has(method)) {
      return init;
    }

    const csrfToken = readCookieValue(CSRF_COOKIE_NAME);
    if (!csrfToken) {
      return init;
    }

    const headers = new Headers(init?.headers || undefined);
    if (!headers.has(CSRF_HEADER_NAME)) {
      headers.set(CSRF_HEADER_NAME, csrfToken);
    }
    return {
      ...(init || {}),
      headers,
    } satisfies RequestInit;
  };

  const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, appendCsrfHeader(init));
    if (res.status === 401 && !checkinAccessMode) {
      setAuthStatus("unauthenticated");
      setAuthUser(null);
      setLoading(false);
      stopQrScanner();
    }
    return res;
  };

  const normalizeAuditLogEntry = (value: unknown): AuditLogEntry | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const id = Number(row.id);
    const action = String(row.action || "").trim();
    const createdAt = String(row.created_at || "").trim();
    if (!Number.isFinite(id) || id <= 0 || !action || !createdAt) {
      return null;
    }
    const metadata = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {};
    return {
      id: Math.trunc(id),
      action,
      target_type: row.target_type == null ? null : String(row.target_type),
      target_id: row.target_id == null ? null : String(row.target_id),
      metadata,
      created_at: createdAt,
    };
  };

  const fetchAuditLogs = async () => {
    const res = await apiFetch("/api/audit-logs");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || "Failed to fetch audit logs");
    }
    const data = await res.json().catch(() => ([]));
    if (!Array.isArray(data)) return [] as AuditLogEntry[];
    return data
      .map((row) => normalizeAuditLogEntry(row))
      .filter(Boolean) as AuditLogEntry[];
  };

  const requestDesktopNotificationPermission = async () => {
    if (!desktopNotificationSupported) {
      setSettingsMessage("Desktop notifications are not supported in this browser");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setDesktopNotifyPermission(permission);
      if (permission === "granted") {
        setSettingsMessage("Desktop notifications enabled for this browser");
      } else if (permission === "denied") {
        setSettingsMessage("Desktop notifications are blocked by browser/system settings");
      } else {
        setSettingsMessage("Desktop notifications remain in not requested state");
      }
      window.setTimeout(() => setSettingsMessage(""), 2500);
    } catch (err) {
      console.error("Failed to request notification permission", err);
      setSettingsMessage("Failed to request desktop notification permission");
    }
  };

  const fetchCurrentUser = async () => {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      throw new Error("Not authenticated");
    }
    const data = await res.json();
    return data.user as AuthUser;
  };

  const normalizeCheckinRegistration = (value: any): Registration | null => {
    if (!value || typeof value !== "object") return null;
    const id = String(value.id || "").trim();
    if (!id) return null;
    return {
      id,
      sender_id: String(value.sender_id || ""),
      event_id: value.event_id == null ? null : String(value.event_id),
      first_name: String(value.first_name || ""),
      last_name: String(value.last_name || ""),
      phone: String(value.phone || ""),
      email: String(value.email || ""),
      timestamp: String(value.timestamp || ""),
      status: String(value.status || "registered"),
    };
  };

  const normalizePublicInboxConversationStatusValue = (value: unknown): PublicInboxConversationStatus => {
    const status = String(value || "").trim();
    if (status === "waiting-admin" || status === "waiting-user" || status === "resolved") {
      return status;
    }
    return "open";
  };

  const normalizePublicInboxConversationSummary = (value: unknown): PublicInboxConversationSummary | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const senderId = String(row.sender_id || "").trim();
    const eventId = String(row.event_id || "").trim();
    if (!senderId || !eventId) return null;
    return {
      sender_id: senderId,
      event_id: eventId,
      public_slug: String(row.public_slug || "").trim(),
      participant_label: String(row.participant_label || senderId).trim() || senderId,
      sender_name: row.sender_name == null ? null : String(row.sender_name || "").trim() || null,
      sender_phone: row.sender_phone == null ? null : String(row.sender_phone || "").trim() || null,
      sender_email: row.sender_email == null ? null : String(row.sender_email || "").trim() || null,
      registration_id: row.registration_id == null ? null : String(row.registration_id || "").trim() || null,
      status: normalizePublicInboxConversationStatusValue(row.status),
      needs_attention: Boolean(row.needs_attention),
      attention_reason: row.attention_reason == null ? null : String(row.attention_reason || "").trim() || null,
      last_message_text: String(row.last_message_text || "").trim(),
      last_message_type: row.last_message_type === "outgoing" ? "outgoing" : "incoming",
      last_message_at: String(row.last_message_at || "").trim(),
      last_incoming_at: row.last_incoming_at == null ? null : String(row.last_incoming_at || "").trim() || null,
      last_outgoing_at: row.last_outgoing_at == null ? null : String(row.last_outgoing_at || "").trim() || null,
      message_count: Math.max(0, Number(row.message_count || 0) || 0),
    };
  };

  const normalizePublicInboxMessage = (value: unknown): Message | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const senderId = String(row.sender_id || "").trim();
    const text = String(row.text || "");
    const timestamp = String(row.timestamp || "").trim();
    if (!senderId || !timestamp) return null;
    return {
      id: typeof row.id === "number" ? row.id : Number.isFinite(Number(row.id)) ? Number(row.id) : undefined,
      sender_id: senderId,
      event_id: row.event_id == null ? null : String(row.event_id || "").trim() || null,
      page_id: row.page_id == null ? null : String(row.page_id || "").trim() || null,
      platform: row.platform == null ? null : String(row.platform || "").trim() as ChannelPlatform | null,
      channel_display_name: row.channel_display_name == null ? null : String(row.channel_display_name || "").trim() || null,
      sender_name: row.sender_name == null ? null : String(row.sender_name || "").trim() || null,
      sender_phone: row.sender_phone == null ? null : String(row.sender_phone || "").trim() || null,
      sender_email: row.sender_email == null ? null : String(row.sender_email || "").trim() || null,
      registration_id: row.registration_id == null ? null : String(row.registration_id || "").trim() || null,
      text,
      timestamp,
      type: row.type === "outgoing" ? "outgoing" : "incoming",
    };
  };

  const fetchCheckinAccessSession = async (token = checkinAccessToken, options?: { silentNoSession?: boolean }) => {
    const silentNoSession = Boolean(options?.silentNoSession);
    if (!silentNoSession) {
      setCheckinAccessLoading(true);
      setCheckinAccessError("");
    }
    try {
      const sessionRes = await fetch("/api/checkin-access/session");
      const sessionData = await sessionRes.json().catch(() => ({}));
      if (sessionRes.ok) {
        const session = sessionData?.session as CheckinAccessSession;
        setCheckinAccessSession(session);
        setSelectedEventId(session?.event_id || "");
        setCheckinAccessMode(true);
        stripCheckinTokenFromUrl();
        return session;
      }

      if (silentNoSession && sessionRes.status === 401 && !token) {
        return null;
      }

      if (!token) {
        throw new Error(sessionData?.error || "Failed to load check-in session");
      }

      const exchangeRes = await fetch("/api/checkin-access/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const exchangeData = await exchangeRes.json().catch(() => ({}));
      if (!exchangeRes.ok) {
        throw new Error(exchangeData?.error || "Failed to exchange check-in token");
      }
      const session = exchangeData?.session as CheckinAccessSession;
      setCheckinAccessSession(session);
      setSelectedEventId(session?.event_id || "");
      setCheckinAccessMode(true);
      stripCheckinTokenFromUrl();
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load check-in session";
      if (!silentNoSession) {
        setCheckinAccessError(message);
      }
      setCheckinAccessSession(null);
      return null;
    } finally {
      if (!silentNoSession) {
        setCheckinAccessLoading(false);
      }
    }
  };

  const fetchCheckinSessions = async (eventId = selectedEventId) => {
    if (!canManageCheckinAccess || !eventId) {
      setCheckinSessions([]);
      return [];
    }
    setCheckinSessionsLoading(true);
    try {
      const res = await apiFetch(`/api/checkin-sessions?event_id=${encodeURIComponent(eventId)}`);
      const data = await res.json().catch(() => ([]));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch check-in sessions");
      }
      const rows = Array.isArray(data) ? (data as CheckinSessionRecord[]) : [];
      setCheckinSessions(rows);
      return rows;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch check-in sessions";
      setCheckinSessionMessage(message);
      return [];
    } finally {
      setCheckinSessionsLoading(false);
    }
  };

  const fetchEvents = async () => {
    setEventLoading(true);
    try {
      const res = await apiFetch("/api/events");
      const data = await res.json().catch(() => ([]));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch events");
      }
      const rows = Array.isArray(data) ? (data as EventRecord[]) : [];
      setEvents(rows);
      const firstWorking =
        rows.find((event) => event.effective_status === "active")
        || rows.find((event) => event.effective_status === "pending")
        || rows.find((event) => event.effective_status === "inactive");
      setSelectedEventId((prev) => prev && rows.some((event) => event.id === prev) ? prev : firstWorking?.id || rows[0]?.id || "");
      return rows;
    } catch (err) {
      console.error("Failed to fetch events", err);
      setEventMessage(err instanceof Error ? err.message : "Failed to fetch events");
      return [];
    } finally {
      setEventLoading(false);
    }
  };

  const fetchChannels = async () => {
    try {
      const res = await apiFetch("/api/channels");
      const data = await res.json().catch(() => ([]));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch channels");
      }
      const rows = Array.isArray(data) ? data as ChannelAccountRecord[] : [];
      setChannels(rows);
      return rows;
    } catch (err) {
      console.error("Failed to fetch channels", err);
      setEventMessage(err instanceof Error ? err.message : "Failed to fetch channels");
      return [];
    }
  };

  const fetchChannelPlatforms = async () => {
    try {
      const res = await apiFetch("/api/channel-platforms");
      const data = await res.json().catch(() => ([]));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch channel platform definitions");
      }
      const rows = Array.isArray(data) ? (data as ChannelPlatformDefinition[]) : [];
      setChannelPlatformDefinitions(rows);
      return rows;
    } catch (err) {
      console.error("Failed to fetch channel platform definitions", err);
      setEventMessage(err instanceof Error ? err.message : "Failed to fetch channel platform definitions");
      return [];
    }
  };

  const fetchTeamUsers = async () => {
    if (!(role === "owner" || role === "admin")) {
      setTeamUsers([]);
      return;
    }

    setTeamLoading(true);
    try {
      const res = await apiFetch("/api/auth/users");
      const data = await res.json().catch(() => ([]));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch users");
      }
      setTeamUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch users", err);
      setTeamMessage(err instanceof Error ? err.message : "Failed to fetch users");
    } finally {
      setTeamLoading(false);
    }
  };

  const loadAppData = async () => {
    setLoading(true);
    try {
      const [eventRows] = await Promise.all([
        fetchEvents(),
        fetchChannels(),
        fetchChannelPlatforms(),
        role === "owner" || role === "admin" ? fetchTeamUsers() : Promise.resolve(),
      ]);
      if (!eventRows.length) {
        setLoading(false);
      }
    } finally {
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setHoverDropdownEnabled(false);
      return;
    }

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 640px)");
    const update = () => {
      setHoverDropdownEnabled(mediaQuery.matches);
    };
    update();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved = resolveThemeMode(themeMode);
      root.classList.toggle("theme-dark", resolved === "dark");
      root.classList.toggle("theme-light", resolved === "light");
      root.dataset.themeMode = themeMode;
      root.dataset.themeResolved = resolved;
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    };

    apply();

    if (themeMode !== "system" || !window.matchMedia) {
      return undefined;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => apply();
    media.addEventListener?.("change", handleChange);
    return () => {
      media.removeEventListener?.("change", handleChange);
    };
  }, [themeMode]);

  useEffect(() => {
    if (!adminAgentChatStorageKey) {
      adminAgentHistoryLoadedKeyRef.current = "";
      setAdminAgentMessages([]);
      return;
    }

    const store = readAdminAgentChatStore();
    const nextMessages = store[adminAgentChatStorageKey] || [];
    adminAgentHistoryLoadedKeyRef.current = "";
    setAdminAgentMessages(() => {
      adminAgentHistoryLoadedKeyRef.current = adminAgentChatStorageKey;
      return nextMessages;
    });
  }, [adminAgentChatStorageKey]);

  useEffect(() => {
    if (!adminAgentChatStorageKey) return;
    if (adminAgentHistoryLoadedKeyRef.current !== adminAgentChatStorageKey) return;

    const store = readAdminAgentChatStore();
    if (adminAgentMessages.length > 0) {
      store[adminAgentChatStorageKey] = adminAgentMessages.slice(-120);
    } else {
      delete store[adminAgentChatStorageKey];
    }
    writeAdminAgentChatStore(store);
  }, [adminAgentMessages, adminAgentChatStorageKey]);

  useEffect(() => {
    const allChannelIds = allChannelIdsKey ? allChannelIdsKey.split("|") : [];
    const selectedChannelIds = selectedEventChannelIdsKey ? selectedEventChannelIdsKey.split("|") : [];
    if (!allChannelIds.length) {
      setSetupSelectedChannelId("");
      return;
    }
    setSetupSelectedChannelId((current) =>
      allChannelIds.includes(current)
        ? current
        : selectedChannelIds[0] || allChannelIds[0],
    );
  }, [allChannelIdsKey, selectedEventChannelIdsKey]);

  useEffect(() => {
    const selectedChannelIds = selectedEventChannelIdsKey ? selectedEventChannelIdsKey.split("|") : [];
    if (!selectedChannelIds.length) return;
    setSetupSelectedChannelId((current) =>
      selectedChannelIds.includes(current)
        ? current
        : selectedChannelIds[0],
    );
  }, [selectedEventId, selectedEventChannelIdsKey]);

  useEffect(() => {
    if (!setupSelectedChannel) return;
    const nextKeys = CHANNEL_PLATFORM_WEBHOOK_MAP[setupSelectedChannel.platform];
    if (!nextKeys.includes(selectedWebhookConfigKey)) {
      setSelectedWebhookConfigKey(nextKeys[0]);
    }
  }, [setupSelectedChannel?.platform, selectedWebhookConfigKey]);

  useEffect(() => {
    if (!desktopNotificationSupported) {
      setDesktopNotifyPermission("unsupported");
      return;
    }
    const syncPermission = () => {
      setDesktopNotifyPermission(Notification.permission);
    };
    syncPermission();
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);
    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, [desktopNotificationSupported]);

  useEffect(() => {
    const userId = authUser?.id || "";
    desktopNotifyBootstrappedRef.current = false;
    desktopNotifyLastAuditIdRef.current = 0;
    if (!userId) {
      setDesktopNotifyEnabled(false);
      return;
    }
    setDesktopNotifyEnabled(readDesktopNotifyPreference(userId));
    desktopNotifyLastAuditIdRef.current = readDesktopNotifyLastAuditId(userId);
  }, [authUser?.id]);

  useEffect(() => {
    const userId = authUser?.id || "";
    if (!userId) return;
    writeDesktopNotifyPreference(userId, desktopNotifyEnabled);
  }, [authUser?.id, desktopNotifyEnabled]);

  useEffect(() => {
    if (authStatus !== "authenticated" || checkinAccessMode) return;
    if (!(role === "owner" || role === "admin")) return;
    if (settings.admin_agent_notification_enabled !== "1") return;
    if (!desktopNotifyEnabled || desktopNotifyPermission !== "granted" || !desktopNotificationSupported) return;

    let cancelled = false;
    const allowedStatusActions = new Set([
      "registration.status_updated",
      "registration.cancelled",
      "registration.checked_in",
      "registration.checked_in_via_token",
    ]);
    const userId = authUser?.id || "";

    const pollAuditNotifications = async () => {
      try {
        const logs = await fetchAuditLogs();
        if (cancelled || logs.length === 0) return;

        const sortedAsc = logs
          .slice()
          .sort((left, right) => left.id - right.id);
        const newestId = sortedAsc[sortedAsc.length - 1]?.id || desktopNotifyLastAuditIdRef.current;
        if (!desktopNotifyBootstrappedRef.current) {
          desktopNotifyBootstrappedRef.current = true;
          desktopNotifyLastAuditIdRef.current = newestId;
          if (userId) writeDesktopNotifyLastAuditId(userId, newestId);
          return;
        }

        const freshRows = sortedAsc.filter((row) => row.id > desktopNotifyLastAuditIdRef.current);
        if (freshRows.length === 0) {
          desktopNotifyLastAuditIdRef.current = newestId;
          if (userId) writeDesktopNotifyLastAuditId(userId, newestId);
          return;
        }

        const maxId = freshRows[freshRows.length - 1]?.id || newestId;
        const scopeMode = settings.admin_agent_notification_scope === "event" ? "event" : "all";
        const scopeEventId = scopeMode === "event"
          ? String(
              settings.admin_agent_notification_event_id
              || settings.admin_agent_default_event_id
              || selectedEventId
              || "",
            ).trim()
          : "";

        for (const row of freshRows.slice(-12)) {
          const metadata = row.metadata || {};
          const eventId = String(metadata.event_id || "").trim();
          if (scopeMode === "event") {
            if (!scopeEventId) continue;
            if (!eventId || eventId !== scopeEventId) continue;
          }

          const isCreated = row.action === "registration.created";
          const isStatus = allowedStatusActions.has(row.action);
          const isPublicAttention = row.action === "public.chat.attention_requested";
          if (!isCreated && !isStatus && !isPublicAttention) continue;
          if (isCreated && settings.admin_agent_notification_on_registration_created === "0") continue;
          if (isStatus && settings.admin_agent_notification_on_registration_status_changed === "0") continue;

          const registrationId = String(row.target_id || "").trim().toUpperCase();
          const eventName = events.find((event) => event.id === eventId)?.name || eventId || "Unknown Event";
          const statusFromMetadata = String(metadata.status || "").trim();
          const statusLabel = statusFromMetadata
            || (row.action === "registration.checked_in" || row.action === "registration.checked_in_via_token"
              ? "checked-in"
              : row.action === "registration.cancelled"
              ? "cancelled"
              : "");
          const attentionReason = String(metadata.reason || "").trim();
          const title = isCreated
            ? "ลงทะเบียนใหม่"
            : isStatus
            ? "อัปเดตสถานะลงทะเบียน"
            : "Public chat needs attention";
          const timeLabel = new Date(row.created_at).toLocaleString("th-TH", {
            dateStyle: "short",
            timeStyle: "short",
          });
          const body = isPublicAttention
            ? [
                eventName,
                attentionReason === "bot_failure" ? "bot failure" : "staff request",
                String(metadata.message_preview || "").trim(),
                timeLabel,
              ]
                .filter(Boolean)
                .join(" • ")
            : [
                eventName,
                registrationId ? `ID ${registrationId}` : "",
                statusLabel ? `status ${statusLabel}` : "",
                timeLabel,
              ]
                .filter(Boolean)
                .join(" • ");

          try {
            new Notification(title, {
              body,
              tag: `${isPublicAttention ? "public-chat" : "reg-audit"}-${row.id}`,
              silent: false,
            });
          } catch (notifyError) {
            console.error("Failed to show desktop notification", notifyError);
          }
        }

        desktopNotifyLastAuditIdRef.current = maxId;
        if (userId) writeDesktopNotifyLastAuditId(userId, maxId);
      } catch (err) {
        console.error("Failed to poll desktop notifications from audit logs", err);
      }
    };

    void pollAuditNotifications();
    const timer = window.setInterval(() => {
      void pollAuditNotifications();
    }, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    authStatus,
    checkinAccessMode,
    role,
    authUser?.id,
    desktopNotifyEnabled,
    desktopNotifyPermission,
    desktopNotificationSupported,
    settings.admin_agent_notification_enabled,
    settings.admin_agent_notification_on_registration_created,
    settings.admin_agent_notification_on_registration_status_changed,
    settings.admin_agent_notification_scope,
    settings.admin_agent_notification_event_id,
    settings.admin_agent_default_event_id,
    selectedEventId,
    events,
  ]);

  useEffect(() => {
    if (!publicEventSlug) {
      setPublicEventPage(null);
      setPublicEventError("");
      setPublicEventLoading(false);
      setPublicRegistrationError("");
      setPublicTicketLookupError("");
      setPublicRegistrationResult(null);
      setPublicTicketLookupForm({
        phone: "",
        email: "",
        attendee_name: "",
      });
      setPublicPrivacyOpen(false);
      setPublicChatOpen(false);
      setPublicChatInput("");
      setPublicChatSenderId("");
      setPublicChatMessages([]);
      setPublicChatLastMessageId(0);
      setPublicChatSending(false);
      setPublicChatError("");
      return;
    }

    setPublicChatOpen(false);
    setPublicChatInput("");
    setPublicChatSending(false);
    setPublicChatError("");
    setPublicChatSenderId(getOrCreatePublicEventChatSenderId(publicEventSlug));
    const storedHistory = readPublicEventChatHistory(publicEventSlug);
    setPublicChatMessages(storedHistory);
    setPublicChatLastMessageId(
      storedHistory.reduce((max, message) => Math.max(max, Number(message.serverMessageId || 0) || 0), 0),
    );

    let cancelled = false;
    void (async () => {
      setPublicEventLoading(true);
      setPublicEventError("");
      setPublicRegistrationError("");
      setPublicTicketLookupError("");
      setPublicRegistrationResult(null);
      setPublicTicketLookupForm({
        phone: "",
        email: "",
        attendee_name: "",
      });
      try {
        const res = await apiFetch(`/api/public/events/${encodeURIComponent(publicEventSlug)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((data as { error?: string }).error || "Failed to load public event page");
        }
        if (cancelled) return;
        setPublicEventPage(data as PublicEventPageResponse);
      } catch (err) {
        if (cancelled) return;
        setPublicEventPage(null);
        setPublicEventError(err instanceof Error ? err.message : "Failed to load public event page");
      } finally {
        if (!cancelled) {
          setPublicEventLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publicEventSlug]);

  useEffect(() => {
    if (!publicEventSlug) return;
    writePublicEventChatHistory(publicEventSlug, publicChatMessages);
  }, [publicEventSlug, publicChatMessages]);

  useEffect(() => {
    if (!publicEventSlug || !publicEventPage) return;
    setPublicChatMessages((current) => {
      if (current.length > 0) return current;
      return [
        createPublicChatMessage(
          "assistant",
          `Need help with ${publicEventPage.event.name}? Ask about the schedule, location, travel, registration, or ticket recovery.`,
        ),
      ];
    });
  }, [publicEventSlug, publicEventPage]);

  useEffect(() => {
    if (!publicEventSlug || !publicEventPage?.support.bot_enabled || !publicChatSenderId) return;
    void syncPublicChatHistory({ silent: true });
  }, [publicEventSlug, publicEventPage, publicChatSenderId]);

  useEffect(() => {
    if (!publicChatOpen) return;
    const container = publicChatBodyRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [publicChatMessages, publicChatOpen]);

  useEffect(() => {
    if (!publicEventSlug || !publicEventPage?.support.bot_enabled || !publicChatSenderId) return;
    const interval = window.setInterval(() => {
      void syncPublicChatHistory({
        afterId: publicChatLastMessageIdRef.current,
        silent: true,
      });
    }, 8000);
    return () => window.clearInterval(interval);
  }, [publicEventSlug, publicEventPage, publicChatSenderId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (publicEventSlug) {
        setAuthStatus("unauthenticated");
        setAuthUser(null);
        setLoading(false);
        return;
      }

      if (checkinAccessMode) {
        setLoading(false);
        setAuthStatus("unauthenticated");
        await fetchCheckinAccessSession();
        return;
      }

      void fetchCheckinAccessSession("", { silentNoSession: true })
        .then((existingCheckinSession) => {
          if (cancelled || !existingCheckinSession) return;
          setLoading(false);
          setAuthStatus("unauthenticated");
        })
        .catch(() => {
          // Ignore silent probe failures and continue normal auth bootstrap.
        });

      try {
        const user = await fetchCurrentUser();
        if (cancelled) return;
        setAuthUser(user);
        setAuthStatus("authenticated");
        setActiveTab(getDefaultTabForRole(user.role));
      } catch {
        if (cancelled) return;
        setAuthStatus("unauthenticated");
        setAuthUser(null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkinAccessMode, publicEventSlug]);

  useEffect(() => {
    if (publicEventSlug || checkinAccessMode || authStatus !== "authenticated") return;

    void loadAppData();
  }, [authStatus, role, checkinAccessMode, publicEventSlug]);

  useEffect(() => {
    if (publicEventSlug || authStatus !== "authenticated" || !selectedEventId) return;

    void (async () => {
      setLoading(true);
      try {
        await Promise.all([
          fetchSettings(selectedEventId),
          canViewLogs ? fetchMessages(selectedEventId) : Promise.resolve(),
          fetchRegistrations(selectedEventId),
          fetchDocuments(selectedEventId),
          canRunTest ? fetchLlmModels() : Promise.resolve(),
          canEditSettings ? fetchLlmUsageSummary(selectedEventId) : Promise.resolve(null),
          canEditSettings ? fetchEmailStatus(selectedEventId) : Promise.resolve(null),
          canManageCheckinAccess ? fetchCheckinSessions(selectedEventId) : Promise.resolve([]),
        ]);
      } finally {
        setLoading(false);
      }
    })();

    const interval = setInterval(() => {
      void Promise.all([
        canViewLogs ? fetchMessages(selectedEventId) : Promise.resolve(),
        fetchRegistrations(selectedEventId),
        fetchDocuments(selectedEventId),
        canEditSettings ? fetchLlmUsageSummary(selectedEventId) : Promise.resolve(null),
        canManageCheckinAccess ? fetchCheckinSessions(selectedEventId) : Promise.resolve([]),
      ]);
    }, 10000);

    return () => clearInterval(interval);
  }, [authStatus, selectedEventId, canRunTest, canViewLogs, canManageCheckinAccess, canEditSettings, publicEventSlug]);

  useEffect(() => {
    setRegistrationVisibleCount(120);
  }, [selectedEventId, deferredRegistrationListQuery]);

  useEffect(() => {
    const nextSettings = {
      ...settingsRef.current,
      ...getBlankEventScopedSettings(),
    };
    setSettings(nextSettings);
    setSavedSettings(nextSettings);
    setMessages([]);
    setLogsHasMore(false);
    setLogsLoadingMore(false);
    setPublicPosterUploading(false);
    setPublicInboxConversations([]);
    setPublicInboxMessage("");
    setPublicInboxSearchQuery("");
    setPublicInboxStatusFilter("all");
    setSelectedPublicInboxSenderId("");
    setSelectedPublicInboxConversation(null);
    setPublicInboxConversationMessages([]);
    setPublicInboxConversationLoading(false);
    setPublicInboxStatusUpdating(false);
    setRegistrations([]);
    setSelectedRegistrationId("");
    setEmailStatus(null);
    setEmailTestAddress("");
    setEmailTestMessage("");
    setCheckinLatestResult(null);
    setCheckinSessionMessage("");
    setCheckinSessionReveal(null);
    setDocuments([]);
    setDocumentsMessage("");
    setEditingDocumentId("");
    setDocumentTitle("");
    setDocumentSourceType("note");
    setDocumentSourceUrl("");
    setDocumentContent("");
    setDocumentChunks([]);
    setSelectedDocumentForChunksId("");
    setCollapsedContextDocumentIds([]);
    setRetrievalQuery("");
    setRetrievalDebug(null);
    setRetrievalMessage("");
    setEmbeddingPreview(null);
    setEmbeddingPreviewMessage("");
    resetChannelForm();
  }, [selectedEventId]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !selectedEventId || !selectedDocumentForChunksId) return;
    void fetchDocumentChunks(selectedDocumentForChunksId, selectedEventId);
    void fetchEmbeddingPreview(selectedDocumentForChunksId, selectedEventId);
  }, [authStatus, selectedEventId, selectedDocumentForChunksId]);

  useEffect(() => {
    if (authStatus !== "authenticated" || publicEventSlug || checkinAccessMode || activeTab !== "inbox" || !selectedEventId) {
      return;
    }

    void fetchPublicInboxConversations(selectedEventId);
    const interval = window.setInterval(() => {
      void fetchPublicInboxConversations(selectedEventId, { silent: true });
      if (selectedPublicInboxSenderIdRef.current) {
        void fetchPublicInboxConversation(selectedPublicInboxSenderIdRef.current, selectedEventId, { silent: true });
      }
    }, 10000);

    return () => window.clearInterval(interval);
  }, [authStatus, activeTab, selectedEventId, publicEventSlug, checkinAccessMode]);

  useEffect(() => {
    if (selectedPublicInboxSenderId && filteredPublicInboxConversations.some((conversation) => conversation.sender_id === selectedPublicInboxSenderId)) {
      return;
    }
    const nextSenderId = filteredPublicInboxConversations[0]?.sender_id || "";
    if (nextSenderId !== selectedPublicInboxSenderId) {
      setSelectedPublicInboxSenderId(nextSenderId);
    }
  }, [filteredPublicInboxConversations, selectedPublicInboxSenderId]);

  useEffect(() => {
    setPublicInboxReplyText("");
  }, [selectedEventId, selectedPublicInboxSenderId]);

  useEffect(() => {
    if (!selectedPublicInboxSenderId) {
      setSelectedPublicInboxConversation(null);
      setPublicInboxConversationMessages([]);
      return;
    }
    if (activeTab !== "inbox" || authStatus !== "authenticated" || !selectedEventId) return;
    void fetchPublicInboxConversation(selectedPublicInboxSenderId, selectedEventId);
  }, [activeTab, authStatus, selectedEventId, selectedPublicInboxSenderId]);

  const stopQrScanner = () => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;

    if (scanIntervalRef.current != null) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }

    scanBusyRef.current = false;
    scannerCooldownRef.current = false;
    setScannerActive(false);
    setScannerStarting(false);
  };

  useEffect(() => {
    return () => {
      stopQrScanner();
      qrReaderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "registrations" && activeTab !== "checkin") {
      stopQrScanner();
    }
  }, [activeTab]);

  useEffect(() => {
    setEventWorkspaceMenuOpen(false);
    setOperationsMenuOpen(false);
    setSetupMenuOpen(false);
    setAgentWorkspaceMenuOpen(false);
    clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
    clearMenuCloseTimer(operationsMenuCloseTimerRef);
    clearMenuCloseTimer(setupMenuCloseTimerRef);
    clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
    setUserMenuOpen(false);
    setKnowledgeActionsOpen(false);
    setGlobalSearchOpen(false);
    setHelpOpen(false);
    setAdminCommandPaletteOpen(false);
    setAdminCommandPaletteQuery("");
  }, [activeTab]);

  useEffect(() => {
    if (!eventWorkspaceMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!eventWorkspaceMenuRef.current?.contains(event.target as Node)) {
        setEventWorkspaceMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [eventWorkspaceMenuOpen]);

  useEffect(() => {
    if (!operationsMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!operationsMenuRef.current?.contains(event.target as Node)) {
        setOperationsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [operationsMenuOpen]);

  useEffect(() => {
    return () => {
      clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
      clearMenuCloseTimer(operationsMenuCloseTimerRef);
      clearMenuCloseTimer(setupMenuCloseTimerRef);
      clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
    };
  }, []);

  useEffect(() => {
    if (!setupMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!setupMenuRef.current?.contains(event.target as Node)) {
        setSetupMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [setupMenuOpen]);

  useEffect(() => {
    if (!agentWorkspaceMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!agentWorkspaceMenuRef.current?.contains(event.target as Node)) {
        setAgentWorkspaceMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [agentWorkspaceMenuOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (!knowledgeActionsOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!knowledgeActionsRef.current?.contains(event.target as Node)) {
        setKnowledgeActionsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [knowledgeActionsOpen]);

  useEffect(() => {
    if (!globalSearchOpen) return;

    const focusInput = window.setTimeout(() => {
      globalSearchInputRef.current?.focus();
      globalSearchInputRef.current?.select();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGlobalSearchOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusInput);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [globalSearchOpen]);

  useEffect(() => {
    if (!adminCommandPaletteOpen) return;

    const focusInput = window.setTimeout(() => {
      adminCommandPaletteSearchInputRef.current?.focus();
      adminCommandPaletteSearchInputRef.current?.select();
    }, 0);

    const handlePointerDown = (event: MouseEvent) => {
      if (!adminCommandPaletteRef.current?.contains(event.target as Node)) {
        setAdminCommandPaletteOpen(false);
        setAdminCommandPaletteQuery("");
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAdminCommandPaletteOpen(false);
        setAdminCommandPaletteQuery("");
        adminAgentInputRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusInput);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [adminCommandPaletteOpen]);

  useEffect(() => {
    if (activeTab !== "agent" || agentWorkspaceView !== "console") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== "p") {
        return;
      }
      event.preventDefault();
      setAdminCommandPaletteOpen((current) => {
        if (current) {
          setAdminCommandPaletteQuery("");
          return false;
        }
        return true;
      });
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, agentWorkspaceView]);

  useEffect(() => {
    if (agentWorkspaceView === "console") return;
    setAdminCommandPaletteOpen(false);
    setAdminCommandPaletteQuery("");
  }, [agentWorkspaceView]);

  useEffect(() => {
    if (checkinAccessMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }
      event.preventDefault();
      setGlobalSearchOpen(true);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [checkinAccessMode]);

  useEffect(() => {
    return () => {
      if (searchFocusTimeoutRef.current !== null) {
        window.clearTimeout(searchFocusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!helpOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [helpOpen]);

  useEffect(() => {
    if (filteredMessages.length === 0) {
      setSelectedLogMessageId(null);
      return;
    }

    if (!filteredMessages.some((message) => message.id === selectedLogMessageId)) {
      setSelectedLogMessageId(filteredMessages[0]?.id ?? null);
    }
  }, [filteredMessages, selectedLogMessageId]);

  useEffect(() => {
    if (activeTab !== "agent" || agentWorkspaceView !== "console") return;

    const scrollToBottom = () => {
      const panel = adminAgentScrollRef.current;
      if (panel) {
        panel.scrollTop = panel.scrollHeight;
      }
      adminAgentBottomRef.current?.scrollIntoView({ block: "end" });
    };

    const scheduleScroll = () => {
      window.requestAnimationFrame(scrollToBottom);
    };

    scheduleScroll();
    const timeoutId = window.setTimeout(scheduleScroll, 90);
    const lateTimeoutId = window.setTimeout(scheduleScroll, 240);

    const panel = adminAgentScrollRef.current;
    let mutationObserver: MutationObserver | null = null;
    const handlePanelAssetLoad = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === "IMG" || target.tagName === "VIDEO") {
        scheduleScroll();
      }
    };
    if (panel) {
      mutationObserver = new MutationObserver(() => {
        scheduleScroll();
      });
      mutationObserver.observe(panel, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      panel.addEventListener("load", handlePanelAssetLoad, true);
    }

    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(lateTimeoutId);
      mutationObserver?.disconnect();
      panel?.removeEventListener("load", handlePanelAssetLoad, true);
    };
  }, [activeTab, agentWorkspaceView, selectedEventId, adminAgentMessages.length, adminAgentTyping]);

  useEffect(() => {
    setManualOverrideText("");
    setManualOverrideMessage("");
    setLogRegistrationMessage("");
    setLogToolsOpen(false);
    setManualOverrideRegistrationId((current) =>
      selectedSenderRegistrations.some((registration) => registration.id === current)
        ? current
        : selectedSenderRegistrations[0]?.id || "",
    );
    setLogRegistrationDraft(() => {
      const latestRegistration = selectedSenderRegistrations[0];
      return {
        first_name: latestRegistration?.first_name || "",
        last_name: latestRegistration?.last_name || "",
        phone: latestRegistration?.phone || "",
        email: latestRegistration?.email || "",
      };
    });
  }, [selectedLogMessage?.id, selectedSenderRegistrationKey]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;

    const allowedTabs = [
      ...(canEditSettings ? ["event"] : []),
      ...(canEditSettings ? ["mail"] : []),
      ...(canEditSettings ? ["design"] : []),
      ...(canRunTest ? ["test"] : []),
      ...(canRunAgent ? ["agent"] : []),
      ...(canManageRegistrations ? ["registrations", "checkin"] : []),
      ...(canViewLogs ? ["inbox"] : []),
      ...(canViewLogs ? ["logs"] : []),
      ...(canEditSettings ? ["settings"] : []),
      ...(canManageUsers ? ["team"] : []),
    ] as AppTab[];

    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0] || getDefaultTabForRole(role));
    }
  }, [authStatus, activeTab, canEditSettings, canRunTest, canRunAgent, canViewLogs, canManageRegistrations, canManageUsers, role]);

  const extractRegistrationId = (rawValue: string) => {
    const text = String(rawValue || "").trim().toUpperCase();
    const match = text.match(/REG-[A-Z0-9]+/);
    return match?.[0] || "";
  };

  const fetchSettings = async (eventId = selectedEventId) => {
    if (!eventId) {
      const nextSettings = {
        ...settingsRef.current,
        ...getBlankEventScopedSettings(),
      };
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      return;
    }

    try {
      const res = await apiFetch(`/api/settings?event_id=${encodeURIComponent(eventId)}`);
      if (!res.ok) {
        throw new Error("Failed to fetch settings");
      }
      const data = await res.json();
      if (selectedEventIdRef.current !== eventId) return;
      const nextSettings = buildSettingsFromResponse(settingsRef.current, data);
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
    } catch (err) {
      console.error("Failed to fetch settings", err);
    }
  };

  const fetchEmailStatus = async (eventId = selectedEventId) => {
    if (!canEditSettings || !eventId) {
      setEmailStatus(null);
      return null;
    }

    setEmailStatusLoading(true);
    try {
      const res = await apiFetch(`/api/admin/email/status?event_id=${encodeURIComponent(eventId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.error || "Failed to fetch email status");
      }
      const nextStatus = data as AdminEmailStatusResponse;
      if (selectedEventIdRef.current !== eventId) return nextStatus;
      setEmailStatus(nextStatus);
      return nextStatus;
    } catch (err) {
      console.error("Failed to fetch email status", err);
      if (selectedEventIdRef.current === eventId) {
        setEmailStatus(null);
        const message = err instanceof Error ? err.message : "Failed to fetch email status";
        setEmailTestMessage(`Failed: ${message}`);
      }
      return null;
    } finally {
      if (selectedEventIdRef.current === eventId) {
        setEmailStatusLoading(false);
      }
    }
  };

  const fetchAdminAgentDashboard = async (eventId = selectedEventId, options?: { silent?: boolean }) => {
    if (!canRunAgent) {
      setAdminAgentDashboard(null);
      return null;
    }

    const targetEventId = String(eventId || "").trim();
    if (!options?.silent) {
      setAdminAgentDashboardLoading(true);
    }
    setAdminAgentDashboardError("");
    try {
      const query = targetEventId ? `?event_id=${encodeURIComponent(targetEventId)}` : "";
      const res = await apiFetch(`/api/admin-agent/dashboard${query}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string })?.error || "Failed to fetch agent dashboard");
      }
      const nextDashboard = data as AdminAgentDashboardResponse;
      setAdminAgentDashboard(nextDashboard);
      return nextDashboard;
    } catch (err) {
      console.error("Failed to fetch agent dashboard", err);
      setAdminAgentDashboardError(err instanceof Error ? err.message : "Failed to fetch agent dashboard");
      return null;
    } finally {
      setAdminAgentDashboardLoading(false);
    }
  };

  useEffect(() => {
    if (authStatus !== "authenticated" || activeTab !== "agent" || agentWorkspaceView !== "console" || !canRunAgent) {
      return;
    }
    void fetchAdminAgentDashboard(selectedEventId);
  }, [authStatus, activeTab, agentWorkspaceView, canRunAgent, selectedEventId]);

  const handleSendTestEmail = async () => {
    if (!selectedEventId || !emailTestAddress.trim()) {
      setEmailTestMessage("Enter a destination email first");
      return;
    }

    setEmailTestSending(true);
    setEmailTestMessage("");
    try {
      const res = await apiFetch("/api/admin/email/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: selectedEventId,
          kind: selectedEmailTemplateKind,
          to: emailTestAddress.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.error || (data as any)?.message || "Failed to send test email");
      }
      const result = data as AdminEmailTestResponse;
      setEmailTestMessage(`${EMAIL_TEMPLATE_DEFAULTS[result.kind].label} test email sent to ${result.to}`);
      await fetchEmailStatus(selectedEventId);
    } catch (err) {
      console.error("Failed to send test email", err);
      const message = err instanceof Error ? err.message : "Failed to send test email";
      setEmailTestMessage(`Failed: ${message}`);
      await fetchEmailStatus(selectedEventId);
    } finally {
      setEmailTestSending(false);
    }
  };

  const fetchLlmModels = async () => {
    setLlmModelsLoading(true);
    setLlmModelsError("");
    try {
      const res = await apiFetch("/api/llm/models");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch LLM models");
      }
      setLlmModels(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch LLM models", err);
      setLlmModelsError(err instanceof Error ? err.message : "Failed to fetch LLM models");
    } finally {
      setLlmModelsLoading(false);
    }
  };

  const fetchLlmUsageSummary = async (eventId = selectedEventId) => {
    if (!canEditSettings) {
      setLlmUsageSummary(null);
      setLlmUsageError("");
      return null;
    }

    setLlmUsageLoading(true);
    setLlmUsageError("");
    try {
      const res = await apiFetch(`/api/llm/usage-summary?event_id=${encodeURIComponent(eventId || "")}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch LLM usage summary");
      }
      const summary = data as LlmUsageSummary;
      setLlmUsageSummary(summary);
      return summary;
    } catch (err) {
      console.error("Failed to fetch LLM usage summary", err);
      setLlmUsageError(err instanceof Error ? err.message : "Failed to fetch LLM usage summary");
      return null;
    } finally {
      setLlmUsageLoading(false);
    }
  };

  const fetchDocuments = async (eventId = selectedEventId) => {
    if (!eventId) {
      setDocuments([]);
      setSelectedDocumentForChunksId("");
      setDocumentChunks([]);
      return [];
    }

    setDocumentsLoading(true);
    try {
      const res = await apiFetch(`/api/documents?event_id=${encodeURIComponent(eventId)}`);
      const data = await res.json().catch(() => ([]));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch documents");
      }
      if (selectedEventIdRef.current !== eventId) return [];
      const rows = Array.isArray(data) ? data as EventDocumentRecord[] : [];
      setDocuments(rows);
      setSelectedDocumentForChunksId((prev) => prev && rows.some((document) => document.id === prev) ? prev : rows[0]?.id || "");
      return rows;
    } catch (err) {
      console.error("Failed to fetch documents", err);
      setDocumentsMessage(err instanceof Error ? err.message : "Failed to fetch documents");
      return [];
    } finally {
      setDocumentsLoading(false);
    }
  };

  const fetchDocumentChunks = async (documentId = selectedDocumentForChunksId, eventId = selectedEventId) => {
    if (!documentId || !eventId) {
      setDocumentChunks([]);
      return [];
    }

    setDocumentChunksLoading(true);
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(documentId)}/chunks?event_id=${encodeURIComponent(eventId)}`);
      const data = await res.json().catch(() => ([]));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch document chunks");
      }
      if (selectedEventIdRef.current !== eventId) return [];
      const rows = Array.isArray(data) ? data as EventDocumentChunkRecord[] : [];
      setDocumentChunks(rows);
      return rows;
    } catch (err) {
      console.error("Failed to fetch document chunks", err);
      setDocumentsMessage(err instanceof Error ? err.message : "Failed to fetch document chunks");
      setDocumentChunks([]);
      return [];
    } finally {
      setDocumentChunksLoading(false);
    }
  };

  const fetchRetrievalDebug = async (query = retrievalQuery, eventId = selectedEventId) => {
    const trimmedQuery = String(query || "").trim();
    if (!eventId) {
      setRetrievalDebug(null);
      setRetrievalMessage("");
      return null;
    }
    if (!trimmedQuery) {
      setRetrievalDebug(null);
      setRetrievalMessage("Enter a test question to inspect retrieval for this event.");
      return null;
    }

    setRetrievalLoading(true);
    setRetrievalMessage("");
    try {
      const res = await apiFetch(
        `/api/documents/retrieval-debug?event_id=${encodeURIComponent(eventId)}&query=${encodeURIComponent(trimmedQuery)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.error || "Failed to inspect retrieval");
      }
      if (selectedEventIdRef.current !== eventId) return null;
      setRetrievalDebug(data as RetrievalDebugResponse);
      if (!(data as RetrievalDebugResponse).matches?.length) {
        setRetrievalMessage("No high-confidence chunk matches found. The bot will rely on event context and system prompt.");
      }
      return data as RetrievalDebugResponse;
    } catch (err) {
      console.error("Failed to inspect retrieval", err);
      const message = err instanceof Error ? err.message : "Failed to inspect retrieval";
      setRetrievalMessage(message);
      setRetrievalDebug(null);
      return null;
    } finally {
      setRetrievalLoading(false);
    }
  };

  const fetchEmbeddingPreview = async (documentId = selectedDocumentForChunksId, eventId = selectedEventId) => {
    if (!documentId || !eventId) {
      setEmbeddingPreview(null);
      setEmbeddingPreviewMessage("");
      return null;
    }

    setEmbeddingPreviewLoading(true);
    setEmbeddingPreviewMessage("");
    try {
      const res = await apiFetch(
        `/api/documents/${encodeURIComponent(documentId)}/embedding-preview?event_id=${encodeURIComponent(eventId)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.error || "Failed to fetch embedding preview");
      }
      if (selectedEventIdRef.current !== eventId) return null;
      setEmbeddingPreview(data as EmbeddingPreviewResponse);
      return data as EmbeddingPreviewResponse;
    } catch (err) {
      console.error("Failed to fetch embedding preview", err);
      const message = err instanceof Error ? err.message : "Failed to fetch embedding preview";
      setEmbeddingPreviewMessage(message);
      setEmbeddingPreview(null);
      return null;
    } finally {
      setEmbeddingPreviewLoading(false);
    }
  };

  const handleEnqueueEmbedding = async (documentId = selectedDocumentForChunksId, eventId = selectedEventId) => {
    if (!documentId || !eventId) return false;

    setEmbeddingEnqueueLoading(true);
    setEmbeddingPreviewMessage("");
    try {
      const res = await apiFetch(
        `/api/documents/${encodeURIComponent(documentId)}/embedding-enqueue?event_id=${encodeURIComponent(eventId)}`,
        {
          method: "POST",
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.error || "Failed to queue embedding job");
      }
      await fetchDocuments(eventId);
      await fetchEmbeddingPreview(documentId, eventId);
      const queued = Boolean((data as any)?.queued);
      const queueMode = String((data as any)?.queue_mode || (queued ? "redis" : "inline"));
      const workerMode = String((data as any)?.worker_mode || "embedded");
      const embeddingModel = String((data as any)?.embedding_model || "text-embedding-3-small");
      const localVectorStore = Boolean((data as any)?.local_vector_store);
      const hookConfigured = Boolean((data as any)?.hook_configured);

      if (queued) {
        setEmbeddingPreviewMessage(
          workerMode === "external"
            ? `Embedding queued in Redis. A worker service will generate ${embeddingModel} vectors before retrieval can use them.`
            : `Embedding queued in Redis. This service will generate ${embeddingModel} vectors in the background.`,
        );
      } else {
        setEmbeddingPreviewMessage(
          localVectorStore && queueMode === "inline"
            ? `Embeddings were generated locally with ${embeddingModel}. Retrieval can use vector search now.`
            : "Embedding job processed immediately.",
        );
      }
      if (hookConfigured) {
        setEmbeddingPreviewMessage((current) => `${current} External hook delivery is also enabled.`);
      }
      return true;
    } catch (err) {
      console.error("Failed to queue embedding job", err);
      setEmbeddingPreviewMessage(err instanceof Error ? err.message : "Failed to queue embedding job");
      return false;
    } finally {
      setEmbeddingEnqueueLoading(false);
    }
  };

  const fetchMessages = async (
    eventId = selectedEventId,
    options?: { beforeId?: number | null; append?: boolean },
  ) => {
    const append = Boolean(options?.append);
    const beforeId = normalizeMessageId(options?.beforeId);
    if (append) {
      setLogsLoadingMore(true);
    }
    try {
      const params = new URLSearchParams();
      params.set("event_id", eventId);
      params.set("limit", String(LOG_PAGE_SIZE));
      if (beforeId) {
        params.set("before_id", String(beforeId));
      }

      const res = await apiFetch(`/api/messages?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to fetch messages");
      }
      const data = await res.json();
      if (selectedEventIdRef.current !== eventId) return;

      const items = Array.isArray(data)
        ? data as Message[]
        : Array.isArray((data as Record<string, unknown>)?.items)
        ? (data as Record<string, unknown>).items as Message[]
        : [];
      const hasMore = !Array.isArray(data) && Boolean((data as Record<string, unknown>)?.has_more);

      if (append) {
        setMessages((prev) => mergeLogMessageRows(prev, items));
        setLogsHasMore(hasMore);
      } else {
        setMessages((prev) => mergeLogMessageRows(items, prev));
        if (messages.length === 0) {
          setLogsHasMore(hasMore);
        }
      }
    } catch (err) {
      console.error("Failed to fetch messages", err);
    } finally {
      if (append) {
        setLogsLoadingMore(false);
      }
    }
  };

  const handleLoadOlderLogs = async () => {
    if (logsLoadingMore || !logsHasMore) return;
    const oldestId = messages.reduce<number | null>((minId, row) => {
      const currentId = normalizeMessageId(row.id);
      if (currentId == null) return minId;
      if (minId == null) return currentId;
      return currentId < minId ? currentId : minId;
    }, null);
    if (!oldestId) return;
    await fetchMessages(selectedEventId, { append: true, beforeId: oldestId });
  };

  const sendManualOverride = async (mode: "text" | "ticket") => {
    if (!selectedLogMessage) {
      setManualOverrideMessage("Select a log row first");
      return false;
    }
    if (manualOverrideUnavailableReason) {
      setManualOverrideMessage(manualOverrideUnavailableReason);
      return false;
    }

    const eventId = String(selectedLogMessage.event_id || selectedEventId).trim();
    const pageId = String(selectedLogMessage.page_id || "").trim();
    const senderId = String(selectedLogMessage.sender_id || "").trim();
    const text = manualOverrideText.trim();
    const registrationId = manualOverrideRegistrationId.trim().toUpperCase();

    if (!eventId || !pageId || !senderId) {
      setManualOverrideMessage("This sender thread is missing event or channel information");
      return false;
    }
    if (mode === "text" && !text) {
      setManualOverrideMessage("Enter a manual reply before sending");
      return false;
    }
    if (mode === "ticket" && !registrationId) {
      setManualOverrideMessage("Select a registration before resending the ticket");
      return false;
    }

    setManualOverrideAction(mode);
    setManualOverrideMessage("");
    try {
      const res = await apiFetch("/api/messages/manual-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          event_id: eventId,
          sender_id: senderId,
          page_id: pageId,
          platform: selectedLogChannel?.platform || undefined,
          text,
          registration_id: registrationId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.error || "Failed to send manual override");
      }
      setSelectedLogMessageId(null);
      if (mode === "text") {
        setManualOverrideText("");
      }
      await fetchMessages(eventId);
      setManualOverrideMessage(
        mode === "text"
          ? "Manual reply sent to the live chat"
          : "Ticket resent to the selected sender",
      );
      return true;
    } catch (err) {
      console.error("Failed to send manual override", err);
      setManualOverrideMessage(err instanceof Error ? err.message : "Failed to send manual override");
      return false;
    } finally {
      setManualOverrideAction("");
    }
  };

  const retryBotFromLog = async () => {
    if (!selectedLogMessage) {
      setManualOverrideMessage("Select a log row first");
      return false;
    }
    if (manualOverrideUnavailableReason) {
      setManualOverrideMessage(manualOverrideUnavailableReason);
      return false;
    }

    const eventId = String(selectedLogMessage.event_id || selectedEventId).trim();
    const pageId = String(selectedLogMessage.page_id || "").trim();
    const senderId = String(selectedLogMessage.sender_id || "").trim();

    if (!eventId || !pageId || !senderId) {
      setManualOverrideMessage("This sender thread is missing event or channel information");
      return false;
    }

    setManualOverrideAction("retry");
    setManualOverrideMessage("");
    try {
      const res = await apiFetch("/api/messages/manual-retry-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          sender_id: senderId,
          page_id: pageId,
          platform: selectedLogChannel?.platform || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as any)?.error || "Failed to retry bot reply");
      }

      await fetchMessages(eventId);
      setSelectedLogMessageId(null);

      const steps = Array.isArray((data as any)?.steps)
        ? (data as any).steps.map((entry: unknown) => String(entry || ""))
        : [];
      const sentText = steps.includes("text");
      const sentTicket = steps.includes("ticket");

      if (!sentText && !sentTicket) {
        setManualOverrideMessage("Retry completed but no outbound message was generated");
      } else if (String((data as any)?.replay_source || "") === "failed-turn") {
        setManualOverrideMessage("Bot resumed from the last failed turn");
      } else {
        setManualOverrideMessage("Bot retried from the latest incoming message");
      }
      return true;
    } catch (err) {
      console.error("Failed to retry bot reply", err);
      setManualOverrideMessage(err instanceof Error ? err.message : "Failed to retry bot reply");
      return false;
    } finally {
      setManualOverrideAction("");
    }
  };

  const applyManualReplyTemplate = (templateText: string) => {
    const trimmedTemplate = templateText.trim();
    if (!trimmedTemplate) return;
    setManualOverrideText((current) => {
      const trimmedCurrent = current.trim();
      if (!trimmedCurrent) return trimmedTemplate;
      if (trimmedCurrent.includes(trimmedTemplate)) return current;
      return `${trimmedCurrent}\n\n${trimmedTemplate}`;
    });
  };

  const createRegistrationAndIssueTicketFromLog = async () => {
    if (!selectedLogMessage) {
      setLogRegistrationMessage("Select a log row first");
      return false;
    }
    if (manualOverrideUnavailableReason) {
      setLogRegistrationMessage(manualOverrideUnavailableReason);
      return false;
    }

    const eventId = String(selectedLogMessage.event_id || selectedEventId).trim();
    const pageId = String(selectedLogMessage.page_id || "").trim();
    const senderId = String(selectedLogMessage.sender_id || "").trim();
    const payload = {
      sender_id: senderId,
      event_id: eventId,
      first_name: logRegistrationDraft.first_name.trim(),
      last_name: logRegistrationDraft.last_name.trim(),
      phone: logRegistrationDraft.phone.trim(),
      email: logRegistrationDraft.email.trim(),
    };

    if (!eventId || !pageId || !senderId) {
      setLogRegistrationMessage("This sender thread is missing event or channel information");
      return false;
    }
    if (!payload.first_name || !payload.last_name || !payload.phone) {
      setLogRegistrationMessage("First name, last name, and phone are required");
      return false;
    }

    setLogRegistrationAction("create_ticket");
    setLogRegistrationMessage("");
    try {
      const createRes = await apiFetch("/api/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        throw new Error((createData as any)?.error || "Failed to create registration");
      }

      const registrationId = String((createData as any)?.id || "").trim().toUpperCase();
      if (!registrationId) {
        throw new Error("Registration was created but no registration ID was returned");
      }

      const resendRes = await apiFetch("/api/messages/manual-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "ticket",
          event_id: eventId,
          sender_id: senderId,
          page_id: pageId,
          platform: selectedLogChannel?.platform || undefined,
          registration_id: registrationId,
        }),
      });
      const resendData = await resendRes.json().catch(() => ({}));
      if (!resendRes.ok) {
        throw new Error((resendData as any)?.error || "Registration created but ticket resend failed");
      }

      await Promise.all([fetchRegistrations(eventId), fetchEvents(), fetchMessages(eventId)]);
      setManualOverrideRegistrationId(registrationId);
      setLogRegistrationMessage(`Registration ${registrationId} created and ticket sent`);
      return true;
    } catch (err) {
      console.error("Failed to create registration from logs", err);
      setLogRegistrationMessage(err instanceof Error ? err.message : "Failed to create registration from logs");
      return false;
    } finally {
      setLogRegistrationAction("");
    }
  };

  const normalizeSettingsForSave = (source: Settings): Settings => ({
    ...source,
    event_public_slug: sanitizeEnglishSlugInput(source.event_public_slug),
    event_date: normalizeDateTimeLocalValue(source.event_date),
    event_end_date: normalizeDateTimeLocalValue(source.event_end_date),
    reg_start: normalizeDateTimeLocalValue(source.reg_start),
    reg_end: normalizeDateTimeLocalValue(source.reg_end),
  });

  const normalizedSettings = normalizeSettingsForSave(settings);
  const normalizedSavedSettings = normalizeSettingsForSave(savedSettings);
  const handleEventDateChange = (nextEventDate: string) => {
    setSettings((current) => {
      const previousSuggestedEnd = getDefaultEventEndDate(current.event_date);
      const previousSuggestedClose = getDefaultRegistrationCloseDate(current.event_date);
      const nextSuggestedEnd = getDefaultEventEndDate(nextEventDate);
      const nextSuggestedClose = getDefaultRegistrationCloseDate(nextEventDate);

      const shouldAutofillEnd =
        !normalizeDateTimeLocalValue(current.event_end_date)
        || normalizeDateTimeLocalValue(current.event_end_date) === previousSuggestedEnd;
      const shouldAutofillClose =
        !normalizeDateTimeLocalValue(current.reg_end)
        || normalizeDateTimeLocalValue(current.reg_end) === previousSuggestedClose;

      return {
        ...current,
        event_date: nextEventDate,
        event_end_date: shouldAutofillEnd ? nextSuggestedEnd : current.event_end_date,
        reg_end: shouldAutofillClose ? nextSuggestedClose : current.reg_end,
      };
    });
  };
  const areSettingsKeysDirty = (keys: ReadonlyArray<keyof Settings>) =>
    keys.some((key) => normalizedSettings[key] !== normalizedSavedSettings[key]);
  const isEmailTemplateKindDirty = (kind: EmailTemplateKind) =>
    (["subject", "html", "text"] as const).some((field) => {
      const key = getEmailTemplateFieldKey(kind, field);
      return normalizedSettings[key] !== normalizedSavedSettings[key];
    });
  const eventSetupDirty = areSettingsKeysDirty(EVENT_SETUP_SETTINGS_KEYS);
  const eventMailDirty = areSettingsKeysDirty(EVENT_MAIL_SETTINGS_KEYS);
  const eventPublicDirty = areSettingsKeysDirty(EVENT_PUBLIC_SETTINGS_KEYS);
  const eventWorkspaceDirty = eventSetupDirty || eventPublicDirty;
  const emailTemplateDirty = areSettingsKeysDirty(EMAIL_TEMPLATE_SETTINGS_KEYS);
  const selectedEmailTemplateDirty = isEmailTemplateKindDirty(selectedEmailTemplateKind);
  const selectedEmailTemplateIsCustom = hasCustomEmailTemplateOverride(settings, selectedEmailTemplateKind);
  const eventDetailsDirty = eventWorkspaceDirty || eventMailDirty;
  const eventContextDirty = areSettingsKeysDirty(EVENT_CONTEXT_SETTINGS_KEYS);
  const aiSettingsDirty = areSettingsKeysDirty(AI_SETTINGS_KEYS);
  const agentSettingsDirty = areSettingsKeysDirty(AGENT_SETTINGS_KEYS);
  const webhookSettingsDirty = areSettingsKeysDirty(WEBHOOK_SETTINGS_KEYS);
  const workspaceSetupDirty = aiSettingsDirty || webhookSettingsDirty;
  const setupDirty = workspaceSetupDirty || agentSettingsDirty;
  const hasAnyUnsavedSettings = eventDetailsDirty || eventContextDirty || setupDirty;

  const confirmDiscardDirtyChanges = ({
    nextTab,
    nextEventId,
  }: {
    nextTab?: AppTab;
    nextEventId?: string;
  } = {}) => {
    const dirtySections = new Set<string>();
    const eventSwitching = typeof nextEventId === "string" && nextEventId !== selectedEventId;

    if (eventSwitching) {
      if (eventWorkspaceDirty) dirtySections.add("Event");
      if (eventMailDirty) dirtySections.add("Mail");
      if (eventContextDirty) dirtySections.add("Context");
      if (workspaceSetupDirty) dirtySections.add("Setup");
      if (agentSettingsDirty) dirtySections.add("Agent");
    } else if (nextTab && nextTab !== activeTab) {
      if (activeTab === "event" && eventWorkspaceDirty) dirtySections.add("Event");
      if (activeTab === "mail" && eventMailDirty) dirtySections.add("Mail");
      if (activeTab === "design" && eventContextDirty) dirtySections.add("Context");
      if (activeTab === "settings" && workspaceSetupDirty) dirtySections.add("Setup");
      if (activeTab === "agent" && agentSettingsDirty) dirtySections.add("Agent");
    }

    if (!dirtySections.size) return true;
    return window.confirm(`You have unsaved ${Array.from(dirtySections).join(", ")} changes. Leave without saving?`);
  };

  const forceScrollAdminAgentToBottom = () => {
    const runScroll = () => {
      const panel = adminAgentScrollRef.current;
      if (panel) {
        panel.scrollTop = panel.scrollHeight;
      }
      adminAgentBottomRef.current?.scrollIntoView({ block: "end" });
    };

    const schedule = (delayMs: number) => {
      window.setTimeout(() => {
        window.requestAnimationFrame(runScroll);
      }, delayMs);
    };

    window.requestAnimationFrame(runScroll);
    schedule(60);
    schedule(180);
    schedule(360);
  };

  const clearMenuCloseTimer = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleEventWorkspaceMenuClose = () => {
    if (!hoverDropdownEnabled) return;
    clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
    eventWorkspaceMenuCloseTimerRef.current = window.setTimeout(() => {
      setEventWorkspaceMenuOpen(false);
      eventWorkspaceMenuCloseTimerRef.current = null;
    }, 180);
  };

  const scheduleSetupMenuClose = () => {
    if (!hoverDropdownEnabled) return;
    clearMenuCloseTimer(setupMenuCloseTimerRef);
    setupMenuCloseTimerRef.current = window.setTimeout(() => {
      setSetupMenuOpen(false);
      setupMenuCloseTimerRef.current = null;
    }, 180);
  };

  const scheduleOperationsMenuClose = () => {
    if (!hoverDropdownEnabled) return;
    clearMenuCloseTimer(operationsMenuCloseTimerRef);
    operationsMenuCloseTimerRef.current = window.setTimeout(() => {
      setOperationsMenuOpen(false);
      operationsMenuCloseTimerRef.current = null;
    }, 180);
  };

  const scheduleAgentWorkspaceMenuClose = () => {
    if (!hoverDropdownEnabled) return;
    clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
    agentWorkspaceMenuCloseTimerRef.current = window.setTimeout(() => {
      setAgentWorkspaceMenuOpen(false);
      agentWorkspaceMenuCloseTimerRef.current = null;
    }, 180);
  };

  const handleNavigateToTab = (nextTab: AppTab) => {
    if (nextTab === activeTab) {
      if (nextTab === "agent") {
        forceScrollAdminAgentToBottom();
      }
      return true;
    }
    if (!confirmDiscardDirtyChanges({ nextTab })) return false;
    setActiveTab(nextTab);
    if (nextTab === "agent") {
      forceScrollAdminAgentToBottom();
    }
    setSetupMenuOpen(false);
    setOperationsMenuOpen(false);
    setAgentWorkspaceMenuOpen(false);
    return true;
  };

  const handleOpenEventWorkspaceView = (nextView: EventWorkspaceView) => {
    if (!handleNavigateToTab("event")) return false;
    setEventWorkspaceView(nextView);
    setEventWorkspaceMenuOpen(false);
    clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
    setSetupMenuOpen(false);
    clearMenuCloseTimer(setupMenuCloseTimerRef);
    setOperationsMenuOpen(false);
    clearMenuCloseTimer(operationsMenuCloseTimerRef);
    setAgentWorkspaceMenuOpen(false);
    clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
    return true;
  };

  const handleSelectEvent = (nextEventId: string) => {
    if (!nextEventId || nextEventId === selectedEventId) return true;
    if (!confirmDiscardDirtyChanges({ nextEventId })) return false;
    setSelectedEventId(nextEventId);
    return true;
  };

  useEffect(() => {
    if (!hasAnyUnsavedSettings) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasAnyUnsavedSettings]);

  const saveSettingsSubset = async (keys: Array<keyof Settings>, successLabel: string, sourceSettings?: Settings) => {
    setSaving(true);
    setSettingsMessage("");
    try {
      const normalized = normalizeSettingsForSave(sourceSettings || settings);
      const payload = Object.fromEntries(keys.map((key) => [key, normalized[key]])) as Partial<Settings>;
      const res = await apiFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, event_id: selectedEventId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to save settings");
      }
      setSettings(normalized);
      setSavedSettings((prev) => ({
        ...prev,
        ...(Object.fromEntries(keys.map((key) => [key, normalized[key]])) as Partial<Settings>),
      }));
      setSettingsMessage(successLabel);
      window.setTimeout(() => setSettingsMessage(""), 2500);
      return true;
    } catch (err) {
      console.error("Failed to save settings", err);
      setSettingsMessage(err instanceof Error ? err.message : "Failed to save settings");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveEventDetails = async () => {
    if (timingInfo.registrationStatus === "invalid") {
      setSettingsMessage("Close Date must be later than or equal to Open Date");
      return;
    }
    if (timingInfo.eventScheduleStatus === "invalid") {
      setSettingsMessage("Event end time must be later than or equal to the event start time");
      return;
    }

    const saved = await saveSettingsSubset([...EVENT_SETUP_SETTINGS_KEYS], "Event setup saved");

    if (saved) {
      const nextEventName = settings.event_name.trim();
      if (selectedEvent && nextEventName && nextEventName !== selectedEvent.name) {
        const synced = await handleUpdateEvent({
          name: nextEventName,
          silent: true,
        });
        if (!synced) return;
      } else {
        await fetchEvents();
      }
    }
  };

  const saveEventMailSettings = async () => {
    await saveSettingsSubset([...EVENT_MAIL_SETTINGS_KEYS], "Mail settings saved");
  };

  const saveEventPublicPage = async () => {
    const nextSettings = {
      ...settings,
      event_public_slug: resolveEnglishPublicSlug({
        customSlug: settings.event_public_slug,
        eventName: settings.event_name || selectedEvent?.name || "",
        eventSlug: selectedEvent?.slug || "",
        eventId: selectedEvent?.id || selectedEventId,
      }),
    };
    setSettings(nextSettings);
    const saved = await saveSettingsSubset([
      "event_public_page_enabled",
      "event_public_show_seat_availability",
      "event_public_slug",
      "event_public_poster_url",
      "event_public_summary",
      "event_public_registration_enabled",
      "event_public_ticket_recovery_mode",
      "event_public_bot_enabled",
      "event_public_success_message",
      "event_public_cta_label",
      "event_public_privacy_enabled",
      "event_public_privacy_label",
      "event_public_privacy_text",
      "event_public_contact_enabled",
      "event_public_contact_intro",
      "event_public_contact_messenger_url",
      "event_public_contact_line_url",
      "event_public_contact_phone",
      "event_public_contact_hours",
    ], "Public page settings saved", nextSettings);

    if (saved) {
      await fetchEvents();
    }
  };

  const handlePublicPosterFileUpload = async (file: File | null) => {
    if (!file || !selectedEventId) return;

    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      setSettingsMessage("Poster image must be PNG, JPG, or WebP");
      if (publicPosterFileInputRef.current) {
        publicPosterFileInputRef.current.value = "";
      }
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSettingsMessage("Poster image must be 2 MB or smaller");
      if (publicPosterFileInputRef.current) {
        publicPosterFileInputRef.current.value = "";
      }
      return;
    }

    setPublicPosterUploading(true);
    setSettingsMessage("");
    try {
      const params = new URLSearchParams({ event_id: selectedEventId });
      const res = await apiFetch(`/api/public-page/poster-upload?${params.toString()}`, {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "x-file-name": file.name,
        },
        body: await file.arrayBuffer(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Failed to upload poster image");
      }
      const posterUrl = String((data as { poster_url?: string }).poster_url || "").trim();
      if (!posterUrl) {
        throw new Error("Poster upload did not return a file URL");
      }

      setSettings((current) => ({
        ...current,
        event_public_poster_url: posterUrl,
      }));
      setSavedSettings((current) => ({
        ...current,
        event_public_poster_url: posterUrl,
      }));
      setSettingsMessage("Poster image uploaded");
      window.setTimeout(() => setSettingsMessage(""), 2500);
    } catch (err) {
      setSettingsMessage(err instanceof Error ? err.message : "Failed to upload poster image");
    } finally {
      setPublicPosterUploading(false);
      if (publicPosterFileInputRef.current) {
        publicPosterFileInputRef.current.value = "";
      }
    }
  };

  const handlePublicRegistrationFieldChange = (field: keyof PublicRegistrationFormState, value: string) => {
    setPublicRegistrationError("");
    setPublicRegistrationForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handlePublicTicketLookupFieldChange = (field: keyof PublicTicketLookupFormState, value: string) => {
    setPublicTicketLookupError("");
    if (field !== "attendee_name") {
      setPublicRegistrationResult((current) => {
        if (current?.status === "name_verification_required" || current?.status === "verification_required") {
          return null;
        }
        return current;
      });
    }
    setPublicTicketLookupForm((current) => ({
      ...current,
      ...(field === "attendee_name" ? {} : { attendee_name: "" }),
      [field]: value,
    }));
  };

  const resetPublicRegistrationFlow = () => {
    setPublicRegistrationResult(null);
    setPublicRegistrationError("");
    setPublicTicketLookupError("");
    setPublicRegistrationForm({
      first_name: "",
      last_name: "",
      phone: "",
      email: "",
    });
    setPublicTicketLookupForm({
      phone: "",
      email: "",
      attendee_name: "",
    });
  };

  const syncPublicChatHistory = async (options?: { afterId?: number; silent?: boolean }) => {
    if (!publicEventSlug || !publicChatSenderId) return null;
    const afterId = Math.max(0, options?.afterId ?? 0);
    try {
      const params = new URLSearchParams({
        sender_id: publicChatSenderId,
      });
      if (afterId > 0) {
        params.set("after_id", String(afterId));
      }
      const res = await apiFetch(`/api/public/events/${encodeURIComponent(publicEventSlug)}/chat/history?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Failed to sync event chat");
      }
      const payload = data as PublicEventChatHistoryResponse;
      const serverRows = Array.isArray(payload.items)
        ? payload.items
            .map((item) => normalizePublicInboxMessage(item))
            .filter(Boolean) as Message[]
        : [];
      setPublicChatMessages((current) => mergeServerMessagesIntoPublicChatHistory(current, serverRows));
      setPublicChatLastMessageId((current) => Math.max(current, Number(payload.latest_message_id || 0) || 0));
      return payload;
    } catch (err) {
      if (!options?.silent) {
        setPublicChatError(err instanceof Error ? err.message : "Failed to sync event chat");
      }
      return null;
    }
  };

  const handlePublicChatSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!publicEventSlug || !publicEventPage || !publicEventPage.support.bot_enabled) return;

    const trimmed = publicChatInput.trim();
    if (!trimmed) return;

    const senderId = publicChatSenderId || getOrCreatePublicEventChatSenderId(publicEventSlug);
    if (!publicChatSenderId && senderId) {
      setPublicChatSenderId(senderId);
    }

    const userMessage = createPublicChatMessage("user", trimmed);
    setPublicChatMessages((current) => [...current, userMessage]);
    setPublicChatInput("");
    setPublicChatError("");
    setPublicChatSending(true);

    try {
      const res = await apiFetch(`/api/public/events/${encodeURIComponent(publicEventSlug)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_id: senderId,
          text: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Failed to send message");
      }

      const payload = data as PublicEventChatResponse;
      const assistantText = payload.reply_text.trim()
        || (payload.tickets.length > 0
          ? "I found your ticket details below."
          : payload.map_url
            ? "Here is the map link."
            : "Please try asking a more specific question about the event, registration, or your ticket.");
      setPublicChatMessages((current) => [
        ...current,
        createPublicChatMessage("assistant", assistantText, {
          mapUrl: payload.map_url || "",
          serverMessageId: typeof payload.latest_message_id === "number" ? payload.latest_message_id : undefined,
          tickets: payload.tickets,
        }),
      ]);
      setPublicChatLastMessageId((current) => Math.max(current, Number(payload.latest_message_id || 0) || 0));
    } catch (err) {
      setPublicChatError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setPublicChatSending(false);
    }
  };

  const handlePublicChatInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const handlePublicRegistrationSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!publicEventSlug || !publicEventPage) return;

    const firstName = publicRegistrationForm.first_name.trim();
    const lastName = publicRegistrationForm.last_name.trim();
    const phone = publicRegistrationForm.phone.trim();
    const email = publicRegistrationForm.email.trim();
    if (!firstName || !lastName || !phone) {
      setPublicRegistrationError("Please enter first name, last name, and phone number.");
      return;
    }

    setPublicRegistrationSubmitting(true);
    setPublicRegistrationError("");
    setPublicTicketLookupError("");
    try {
      const res = await apiFetch(`/api/public/events/${encodeURIComponent(publicEventSlug)}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          phone,
          email,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const validationMessage = Array.isArray((data as { issues?: Array<{ message?: string }> }).issues)
          ? (data as { issues: Array<{ message?: string }> }).issues.find((issue) => issue?.message)?.message
          : "";
        throw new Error(validationMessage || (data as { error?: string }).error || "Failed to register");
      }
      setPublicRegistrationResult(data as PublicEventRegistrationResponse);
      window.setTimeout(() => {
        document.getElementById("public-ticket-ready")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 40);
    } catch (err) {
      setPublicRegistrationError(err instanceof Error ? err.message : "Failed to register");
    } finally {
      setPublicRegistrationSubmitting(false);
    }
  };

  const handlePublicTicketLookupSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!publicEventSlug || !publicEventPage) return;

    const phone = publicTicketLookupForm.phone.trim();
    const email = publicTicketLookupForm.email.trim();
    const attendeeName = publicTicketLookupForm.attendee_name.trim();
    if (!phone && !email) {
      setPublicTicketLookupError("Enter your phone number or email to find your ticket.");
      return;
    }

    setPublicTicketLookupSubmitting(true);
    setPublicTicketLookupError("");
    setPublicRegistrationError("");
    try {
      const res = await apiFetch(`/api/public/events/${encodeURIComponent(publicEventSlug)}/find-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          email,
          attendee_name: attendeeName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const validationMessage = Array.isArray((data as { validation_errors?: Array<{ message?: string }> }).validation_errors)
          ? (data as { validation_errors: Array<{ message?: string }> }).validation_errors.find((issue) => issue?.message)?.message
          : "";
        throw new Error(validationMessage || (data as { error?: string }).error || "Failed to find ticket");
      }
      const result = data as PublicEventRegistrationResponse;
      setPublicRegistrationResult(result);
      if (result.status === "success" || result.status === "duplicate" || result.status === "recovered") {
        window.setTimeout(() => {
          document.getElementById("public-ticket-ready")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 40);
      }
    } catch (err) {
      setPublicTicketLookupError(err instanceof Error ? err.message : "Failed to find ticket");
    } finally {
      setPublicTicketLookupSubmitting(false);
    }
  };

  const saveEventContext = async () => saveSettingsSubset(["context"], "Event context saved");

  const saveAiSettings = async () => saveSettingsSubset([
    "global_system_prompt",
    "global_llm_model",
    "llm_model",
  ], "AI settings saved");

  const saveAgentSettings = async () => saveSettingsSubset([
    "admin_agent_enabled",
    "admin_agent_system_prompt",
    "admin_agent_model",
    "admin_agent_default_event_id",
    "admin_agent_policy_read_event",
    "admin_agent_policy_manage_event_setup",
    "admin_agent_policy_manage_event_status",
    "admin_agent_policy_manage_event_context",
    "admin_agent_policy_read_registration",
    "admin_agent_policy_manage_registration",
    "admin_agent_policy_message_user",
    "admin_agent_policy_search_all_events",
    "admin_agent_telegram_enabled",
    "admin_agent_telegram_bot_token",
    "admin_agent_telegram_webhook_secret",
    "admin_agent_telegram_allowed_chat_ids",
    "admin_agent_notification_enabled",
    "admin_agent_notification_on_registration_created",
    "admin_agent_notification_on_registration_status_changed",
    "admin_agent_notification_scope",
    "admin_agent_notification_event_id",
  ], "Agent settings saved");

  const saveWebhookSettings = async () => saveSettingsSubset(["verify_token"], "Webhook settings saved");

  const resetDocumentForm = () => {
    setEditingDocumentId("");
    setDocumentTitle("");
    setDocumentSourceType("note");
    setDocumentSourceUrl("");
    setDocumentContent("");
  };

  const handleResetEventKnowledge = async (clearContext: boolean) => {
    const eventId = selectedEventId;
    if (!eventId) return false;

    const eventLabel = selectedEvent?.name || "the selected event";
    const confirmed = window.confirm(
      clearContext
        ? `Reset all event knowledge for "${eventLabel}"?\n\nThis will remove:\n- Event Context\n- Attached documents\n- Generated chunks\n- Embedding state\n\nThis cannot be undone from the app.`
        : `Clear knowledge documents for "${eventLabel}"?\n\nThis will remove:\n- Attached documents\n- Generated chunks\n- Embedding state\n\nEvent Context will be kept.`,
    );
    if (!confirmed) return false;

    setKnowledgeResetting(true);
    setSettingsMessage("");
    setDocumentsMessage("");
    try {
      const res = await apiFetch("/api/event-knowledge/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, clear_context: clearContext }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Failed to reset event knowledge");
      }

      if (selectedEventIdRef.current !== eventId) return false;

      if (clearContext) {
        setSettings((prev) => ({ ...prev, context: "" }));
      }
      setDocuments([]);
      resetDocumentForm();
      setDocumentChunks([]);
      setSelectedDocumentForChunksId("");
      setRetrievalQuery("");
      setRetrievalDebug(null);
      setRetrievalMessage("");
      setEmbeddingPreview(null);
      setEmbeddingPreviewMessage("");
      if (documentFileInputRef.current) {
        documentFileInputRef.current.value = "";
      }

      if (clearContext) {
        await fetchSettings(eventId);
      }
      setSettingsMessage(clearContext ? "Event knowledge reset" : "Knowledge documents cleared");
      setDocumentsMessage(
        `Cleared ${Number((data as { documents_deleted?: number }).documents_deleted || 0)} documents and ${Number((data as { chunks_deleted?: number }).chunks_deleted || 0)} chunks for this event.`,
      );
      window.setTimeout(() => setSettingsMessage(""), 3000);
      window.setTimeout(() => setDocumentsMessage(""), 4000);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reset event knowledge";
      setSettingsMessage(message);
      setDocumentsMessage(message);
      return false;
    } finally {
      setKnowledgeResetting(false);
    }
  };

  const handleImportDocumentFile = async (file: File | null) => {
    if (!file) return;

    const supportedExtensions = new Set(["txt", "md", "markdown", "csv", "json", "html", "htm", "xml"]);
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const isSupportedType =
      supportedExtensions.has(extension) ||
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      file.type === "application/xml";

    if (!isSupportedType) {
      setDocumentsMessage("Only text-based files are supported right now (.txt, .md, .csv, .json, .html, .xml).");
      if (documentFileInputRef.current) {
        documentFileInputRef.current.value = "";
      }
      return;
    }

    setDocumentsLoading(true);
    setDocumentsMessage("");
    try {
      const importedText = (await file.text()).replace(/\u0000/g, "").trim();
      if (!importedText) {
        throw new Error("This file is empty");
      }

      const baseName = file.name.replace(/\.[^/.]+$/, "").trim() || "Imported Document";
      setEditingDocumentId("");
      setDocumentTitle(baseName);
      setDocumentSourceType("document");
      setDocumentSourceUrl("");
      setDocumentContent(importedText);
      setDocumentsMessage(`Imported ${file.name}. Review the content and save it to this event.`);
    } catch (err) {
      setDocumentsMessage(err instanceof Error ? err.message : "Failed to import file");
    } finally {
      setDocumentsLoading(false);
      if (documentFileInputRef.current) {
        documentFileInputRef.current.value = "";
      }
    }
  };

  const loadDocumentIntoForm = (document: EventDocumentRecord) => {
    setEditingDocumentId(document.id);
    setDocumentTitle(document.title);
    setDocumentSourceType(document.source_type);
    setDocumentSourceUrl(document.source_url || "");
    setDocumentContent(document.content);
    setSelectedDocumentForChunksId(document.id);
    setDocumentsMessage(`Editing document ${document.title}`);
  };

  const handleSaveDocument = async () => {
    if (!selectedEventId) return;
    if (!documentTitle.trim() || !documentContent.trim()) {
      setDocumentsMessage("Document title and content are required");
      return;
    }

    setDocumentsLoading(true);
    setDocumentsMessage("");
    try {
      const res = await apiFetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingDocumentId || undefined,
          event_id: selectedEventId,
          title: documentTitle.trim(),
          source_type: documentSourceType,
          source_url: documentSourceUrl.trim(),
          content: documentContent.trim(),
          is_active: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save document");
      }

      await fetchDocuments(selectedEventId);
      if (data?.id) {
        setSelectedDocumentForChunksId(String(data.id));
        await fetchDocumentChunks(String(data.id), selectedEventId);
      }
      setDocumentsMessage(editingDocumentId ? "Document updated" : "Document saved");
      resetDocumentForm();
      window.setTimeout(() => setDocumentsMessage(""), 2500);
    } catch (err) {
      setDocumentsMessage(err instanceof Error ? err.message : "Failed to save document");
    } finally {
      setDocumentsLoading(false);
    }
  };

  const handleDocumentStatusToggle = async (documentId: string, isActive: boolean) => {
    setDocumentsLoading(true);
    setDocumentsMessage("");
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(documentId)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: selectedEventId,
          is_active: !isActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update document status");
      }

      await fetchDocuments(selectedEventId);
      if (selectedDocumentForChunksId === documentId) {
        await fetchDocumentChunks(documentId, selectedEventId);
      }
      setDocumentsMessage(!isActive ? "Document enabled" : "Document disabled");
      window.setTimeout(() => setDocumentsMessage(""), 2500);
    } catch (err) {
      setDocumentsMessage(err instanceof Error ? err.message : "Failed to update document status");
    } finally {
      setDocumentsLoading(false);
    }
  };

  const fetchRegistrations = async (eventId = selectedEventId) => {
    try {
      const res = await apiFetch(`/api/registrations?event_id=${encodeURIComponent(eventId)}`);
      if (!res.ok) {
        throw new Error("Failed to fetch registrations");
      }
      const data = await res.json();
      if (selectedEventIdRef.current !== eventId) return;
      setRegistrations(Array.isArray(data) ? data : []);
      setSelectedRegistrationId((prev) => {
        const rows = Array.isArray(data) ? (data as Registration[]) : [];
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id || "";
      });
    } catch (err) {
      console.error("Failed to fetch registrations", err);
    }
  };

  const fetchPublicInboxConversations = async (eventId = selectedEventId, options?: { silent?: boolean }) => {
    if (!eventId) return;
    const silent = Boolean(options?.silent);
    if (!silent) {
      setPublicInboxLoading(true);
      setPublicInboxMessage("");
    }
    try {
      const res = await apiFetch(`/api/public-inbox?event_id=${encodeURIComponent(eventId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Failed to fetch public inbox");
      }
      if (selectedEventIdRef.current !== eventId) return;
      const rawItems = Array.isArray((data as { items?: unknown[] }).items) ? (data as { items: unknown[] }).items : [];
      const items = rawItems
        .map((item) => normalizePublicInboxConversationSummary(item))
        .filter(Boolean) as PublicInboxConversationSummary[];
      setPublicInboxConversations(items);
      setSelectedPublicInboxConversation((current) => {
        if (!current) return null;
        return items.find((item) => item.sender_id === current.sender_id) || current;
      });
      setSelectedPublicInboxSenderId((current) => {
        if (current && items.some((item) => item.sender_id === current)) {
          return current;
        }
        return items[0]?.sender_id || "";
      });
    } catch (err) {
      console.error("Failed to fetch public inbox conversations", err);
      if (!silent) {
        setPublicInboxMessage(err instanceof Error ? err.message : "Failed to fetch public inbox");
      }
    } finally {
      if (!silent) {
        setPublicInboxLoading(false);
      }
    }
  };

  const fetchPublicInboxConversation = async (senderId = selectedPublicInboxSenderId, eventId = selectedEventId, options?: { silent?: boolean }) => {
    if (!eventId || !senderId) {
      setSelectedPublicInboxConversation(null);
      setPublicInboxConversationMessages([]);
      return;
    }
    const silent = Boolean(options?.silent);
    if (!silent) {
      setPublicInboxConversationLoading(true);
      setPublicInboxMessage("");
    }
    try {
      const params = new URLSearchParams({
        event_id: eventId,
        sender_id: senderId,
      });
      const res = await apiFetch(`/api/public-inbox/conversation?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Failed to fetch conversation");
      }
      if (selectedEventIdRef.current !== eventId || selectedPublicInboxSenderIdRef.current !== senderId) return;
      const normalizedConversation = normalizePublicInboxConversationSummary((data as PublicInboxConversationDetailResponse).conversation);
      const normalizedMessages = Array.isArray((data as PublicInboxConversationDetailResponse).messages)
        ? (data as PublicInboxConversationDetailResponse).messages
            .map((item) => normalizePublicInboxMessage(item))
            .filter(Boolean) as Message[]
        : [];
      setSelectedPublicInboxConversation(normalizedConversation);
      setPublicInboxConversationMessages(normalizedMessages);
      if (normalizedConversation) {
        setPublicInboxConversations((current) =>
          current.some((item) => item.sender_id === normalizedConversation.sender_id)
            ? current.map((item) => (item.sender_id === normalizedConversation.sender_id ? normalizedConversation : item))
            : [normalizedConversation, ...current],
        );
      }
    } catch (err) {
      console.error("Failed to fetch public inbox conversation", err);
      if (!silent) {
        setPublicInboxMessage(err instanceof Error ? err.message : "Failed to fetch conversation");
      }
    } finally {
      if (!silent) {
        setPublicInboxConversationLoading(false);
      }
    }
  };

  const updatePublicInboxConversationStatus = async (status: PublicInboxConversationStatus) => {
    if (!selectedEventId || !selectedPublicInboxSenderId) return false;
    setPublicInboxStatusUpdating(true);
    setPublicInboxMessage("");
    try {
      const res = await apiFetch("/api/public-inbox/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: selectedEventId,
          sender_id: selectedPublicInboxSenderId,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Failed to update conversation status");
      }
      const nextStatus = normalizePublicInboxConversationStatusValue((data as { conversation_status?: string }).conversation_status || status);
      setPublicInboxConversations((current) =>
        current.map((item) =>
          item.sender_id === selectedPublicInboxSenderId
            ? {
                ...item,
                status: nextStatus,
                needs_attention: nextStatus === "waiting-admin",
              }
            : item,
        ),
      );
      setSelectedPublicInboxConversation((current) =>
        current && current.sender_id === selectedPublicInboxSenderId
          ? {
              ...current,
              status: nextStatus,
              needs_attention: nextStatus === "waiting-admin",
            }
          : current,
      );
      setPublicInboxMessage(`Conversation marked ${getPublicInboxStatusLabel(nextStatus).toLowerCase()}`);
      window.setTimeout(() => setPublicInboxMessage(""), 2500);
      return true;
    } catch (err) {
      setPublicInboxMessage(err instanceof Error ? err.message : "Failed to update conversation status");
      return false;
    } finally {
      setPublicInboxStatusUpdating(false);
    }
  };

  const handlePublicInboxReplySubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!selectedEventId || !selectedPublicInboxSenderId) return false;
    const trimmed = publicInboxReplyText.trim();
    if (!trimmed) {
      setPublicInboxMessage("Reply text is required");
      return false;
    }

    setPublicInboxReplySending(true);
    setPublicInboxMessage("");
    try {
      const res = await apiFetch("/api/public-inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: selectedEventId,
          sender_id: selectedPublicInboxSenderId,
          text: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Failed to send reply");
      }

      const payload = data as PublicInboxReplyResponse;
      const normalizedStatus = normalizePublicInboxConversationStatusValue(payload.conversation_status);
      const normalizedMessage = normalizePublicInboxMessage(payload.message);
      if (normalizedMessage) {
        setPublicInboxConversationMessages((current) => [...current, normalizedMessage]);
      }
      setPublicInboxConversations((current) =>
        current.map((item) =>
          item.sender_id === selectedPublicInboxSenderId
            ? {
                ...item,
                status: normalizedStatus,
                needs_attention: normalizedStatus === "waiting-admin",
                last_message_text: trimmed,
                last_message_type: "outgoing",
                last_message_at: normalizedMessage?.timestamp || new Date().toISOString(),
                last_outgoing_at: normalizedMessage?.timestamp || new Date().toISOString(),
                message_count: item.message_count + 1,
              }
            : item,
        ),
      );
      setSelectedPublicInboxConversation((current) =>
        current && current.sender_id === selectedPublicInboxSenderId
          ? {
              ...current,
              status: normalizedStatus,
              needs_attention: normalizedStatus === "waiting-admin",
              last_message_text: trimmed,
              last_message_type: "outgoing",
              last_message_at: normalizedMessage?.timestamp || new Date().toISOString(),
              last_outgoing_at: normalizedMessage?.timestamp || new Date().toISOString(),
              message_count: current.message_count + 1,
            }
          : current,
      );
      setPublicInboxReplyText("");
      setPublicInboxMessage("Reply sent to public event page");
      window.setTimeout(() => setPublicInboxMessage(""), 2500);
      return true;
    } catch (err) {
      setPublicInboxMessage(err instanceof Error ? err.message : "Failed to send reply");
      return false;
    } finally {
      setPublicInboxReplySending(false);
    }
  };

  const handleCheckinById = async (rawId: string, options?: { clearInputOnSuccess?: boolean }) => {
    const normalizedId = extractRegistrationId(rawId);
    if (!normalizedId) {
      setCheckinStatus("error");
      setCheckinErrorMessage("Invalid registration ID / QR code");
      return false;
    }

    setCheckinStatus("loading");
    setCheckinErrorMessage("");
    try {
      const requestBody = { id: normalizedId };
      const res = await (checkinAccessMode ? fetch("/api/checkin-access/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }) : apiFetch("/api/registrations/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }));
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCheckinStatus("success");
        setSearchId(normalizedId);
        const latest = normalizeCheckinRegistration(data?.registration);
        if (latest) {
          setCheckinLatestResult(latest);
          if (!checkinAccessMode) {
            setSelectedRegistrationId(latest.id);
          }
        } else if (!checkinAccessMode) {
          setSelectedRegistrationId(normalizedId);
        }
        if (checkinAccessMode && checkinAccessSession) {
          setCheckinAccessSession({
            ...checkinAccessSession,
            last_used_at: new Date().toISOString(),
          });
        }
        if (!checkinAccessMode) {
          void fetchRegistrations(selectedEventId);
        }
        setTimeout(() => {
          setCheckinStatus("idle");
          setCheckinErrorMessage("");
          if (options?.clearInputOnSuccess !== false) {
            setSearchId("");
          }
        }, 3000);
        return true;
      } else {
        setCheckinStatus("error");
        setCheckinErrorMessage(data?.error || "Failed to check in attendee");
        const latest = normalizeCheckinRegistration(data?.registration);
        if (latest) {
          setCheckinLatestResult(latest);
        }
        return false;
      }
    } catch (err) {
      setCheckinStatus("error");
      setCheckinErrorMessage("Network error during check-in");
      return false;
    }
  };

  const handleCheckin = async () => {
    if (!searchId) return;
    await handleCheckinById(searchId);
  };

  const handleCreateCheckinSession = async () => {
    if (!selectedEventId || !canManageCheckinAccess) return;
    const label = checkinSessionLabel.trim();
    const expiresHours = Number.parseInt(checkinSessionHours, 10);

    if (!label) {
      setCheckinSessionMessage("Session label is required");
      return;
    }
    if (!Number.isFinite(expiresHours) || expiresHours < 1 || expiresHours > 168) {
      setCheckinSessionMessage("Expiry must be between 1 and 168 hours");
      return;
    }

    setCheckinSessionCreating(true);
    setCheckinSessionMessage("");
    try {
      const res = await apiFetch("/api/checkin-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: selectedEventId,
          label,
          expires_hours: expiresHours,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create check-in access");
      }
      setCheckinSessionReveal({
        token: String(data?.access_token || ""),
        url: String(data?.access_url || ""),
        id: String(data?.session?.id || ""),
      });
      setCheckinSessionLabel("");
      setCheckinSessionHours("8");
      setCheckinSessionMessage("Check-in access link created");
      await fetchCheckinSessions(selectedEventId);
    } catch (err) {
      setCheckinSessionMessage(err instanceof Error ? err.message : "Failed to create check-in access");
    } finally {
      setCheckinSessionCreating(false);
    }
  };

  const handleRevokeCheckinSession = async (sessionId: string) => {
    const target = checkinSessions.find((session) => session.id === sessionId);
    const confirmed = window.confirm(
      `Revoke check-in access "${target?.label || sessionId}"?\n\nAnyone using this link will lose access immediately.`,
    );
    if (!confirmed) return;

    setCheckinSessionRevokingId(sessionId);
    setCheckinSessionMessage("");
    try {
      const res = await apiFetch(`/api/checkin-sessions/${encodeURIComponent(sessionId)}/revoke`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to revoke check-in access");
      }
      setCheckinSessionMessage("Check-in access revoked");
      await fetchCheckinSessions(selectedEventId);
    } catch (err) {
      setCheckinSessionMessage(err instanceof Error ? err.message : "Failed to revoke check-in access");
    } finally {
      setCheckinSessionRevokingId("");
    }
  };

  const updateRegistrationStatus = async (registrationId: string, status: RegistrationStatus) => {
    setStatusUpdateLoading(true);
    setStatusUpdateMessage("");
    try {
      const res = await apiFetch("/api/registrations/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: registrationId, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update registration status");
      }
      setStatusUpdateMessage(`Updated ${registrationId} to ${status}`);
      setSelectedRegistrationId(registrationId);
      await Promise.all([fetchRegistrations(selectedEventId), fetchEvents()]);
      window.setTimeout(() => setStatusUpdateMessage(""), 2500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update registration status";
      setStatusUpdateMessage(message);
    } finally {
      setStatusUpdateLoading(false);
    }
  };

  const deleteRegistration = async (registrationId: string) => {
    const registration = registrations.find((row) => row.id === registrationId);
    const label = registration ? `${registration.first_name} ${registration.last_name}`.trim() || registrationId : registrationId;
    const confirmed = window.confirm(
      `Delete registration "${label}" (${registrationId})?\n\nThis will permanently remove the attendee record from this event.`,
    );
    if (!confirmed) return false;

    setDeleteRegistrationLoading(true);
    setStatusUpdateMessage("");
    try {
      const res = await apiFetch("/api/registrations/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: registrationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete registration");
      }

      setStatusUpdateMessage(`Deleted ${registrationId}`);
      if (selectedRegistrationId === registrationId) {
        setSelectedRegistrationId("");
      }
      await Promise.all([fetchRegistrations(selectedEventId), fetchEvents()]);
      window.setTimeout(() => setStatusUpdateMessage(""), 2500);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete registration";
      setStatusUpdateMessage(message);
      return false;
    } finally {
      setDeleteRegistrationLoading(false);
    }
  };

  const startQrScanner = async () => {
    if (scannerStarting || scannerActive) return;
    setScannerError("");
    setLastScannedValue("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerError("Camera access is not supported in this browser. Use manual check-in instead.");
      return;
    }

    setScannerStarting(true);
    try {
      if (!videoRef.current) {
        throw new Error("Video preview is not ready");
      }

      if (!qrReaderRef.current) {
        const BrowserQRCodeReader = await loadQrReaderCtor();
        qrReaderRef.current = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 250,
          delayBetweenScanSuccess: 1200,
          tryPlayVideoTimeout: 5000,
        });
      }

      const controls = await qrReaderRef.current.decodeFromVideoDevice(undefined, videoRef.current, async (result) => {
        const rawValue = String(result?.getText?.() || "").trim();
        if (!rawValue || scanBusyRef.current || scannerCooldownRef.current) return;

        const registrationId = extractRegistrationId(rawValue);
        setLastScannedValue(rawValue);
        if (!registrationId) return;

        scanBusyRef.current = true;
        scannerCooldownRef.current = true;
        setSearchId(registrationId);
        try {
          await handleCheckinById(registrationId, { clearInputOnSuccess: false });
        } finally {
          scanBusyRef.current = false;
          window.setTimeout(() => {
            scannerCooldownRef.current = false;
          }, 1500);
        }
      });

      scannerControlsRef.current = controls;
      const stream = videoRef.current.srcObject instanceof MediaStream ? videoRef.current.srcObject : null;
      if (stream) {
        cameraStreamRef.current = stream;
      }
      scannerCooldownRef.current = false;
      setScannerActive(true);
    } catch (err) {
      console.error("Failed to start QR scanner", err);
      stopQrScanner();
      const message = err instanceof Error ? err.message : "Failed to start camera";
      if (message.toLowerCase().includes("permission") || message.toLowerCase().includes("notallowed")) {
        setScannerError("Camera permission was denied. Allow camera access in the browser and try again.");
      } else {
        setScannerError(message);
      }
    } finally {
      setScannerStarting(false);
    }
  };

  const handleTestSend = async () => {
    if (!inputText.trim()) return;

    const userMsg = { role: "user" as const, parts: [{ text: inputText }], timestamp: new Date().toISOString() };
    setTestMessages(prev => [...prev, userMsg]);
    setInputText("");
    setIsTyping(true);

    try {
      const history = testMessages.map(m => ({
        role: m.role,
        parts: m.parts
      }));
      
      const response = await getChatResponse(inputText, settings, history, selectedEventId);
      
      const parts = response.candidates[0].content.parts;
      const newModelMsg = { role: "model" as const, parts, timestamp: new Date().toISOString() };
      setTestMessages(prev => [...prev, newModelMsg]);

      // Handle function calls
      if (response.functionCalls) {
        for (const call of response.functionCalls) {
          if (call.name === "registerUser") {
            const regData = call.args as any;
            const res = await apiFetch("/api/registrations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...regData, sender_id: "TEST_USER", event_id: selectedEventId }),
            });
            const result = await res.json();
            
            // Send function result back into the LLM conversation
            const funcResponseMsg = { 
              role: "model" as const, 
              parts: [{ 
                functionResponse: { 
                  name: "registerUser", 
                  response: { content: result } 
                } 
              }], 
              timestamp: new Date().toISOString() 
            };
            
            setTestMessages(prev => [...prev, funcResponseMsg]);
            
            // Get follow-up response
            const followUp = await getChatResponse("Registration successful. ID is " + result.id, settings, [...history, newModelMsg, funcResponseMsg], selectedEventId);
            setTestMessages(prev => [...prev, { role: "model", parts: followUp.candidates[0].content.parts, timestamp: new Date().toISOString() }]);
            void Promise.all([fetchRegistrations(selectedEventId), fetchEvents()]);
          } else if (call.name === "cancelRegistration") {
            const { registration_id } = call.args as any;
            const result = registration_id
              ? await (async () => {
                  const res = await apiFetch("/api/registrations/cancel", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: registration_id }),
                  });
                  return res.json();
                })()
              : {
                  status: "confirmation_required",
                  error: "Test console only simulates direct cancellation by Registration ID. Use a live channel or public page to test contact-based cancellation.",
                };

            const funcResponseMsg = { 
              role: "model" as const, 
              parts: [{ 
                functionResponse: { 
                  name: "cancelRegistration", 
                  response: { content: result } 
                } 
              }], 
              timestamp: new Date().toISOString() 
            };
            
            setTestMessages(prev => [...prev, funcResponseMsg]);
            
            const followUpPrompt = registration_id
              ? "Registration " + registration_id + " has been cancelled."
              : "Continue based on the cancellation tool result.";
            const followUp = await getChatResponse(followUpPrompt, settings, [...history, newModelMsg, funcResponseMsg], selectedEventId);
            setTestMessages(prev => [...prev, { role: "model", parts: followUp.candidates[0].content.parts, timestamp: new Date().toISOString() }]);
            void Promise.all([fetchRegistrations(selectedEventId), fetchEvents()]);
          }
        }
      }
    } catch (err) {
      console.error("LLM error", err);
      setTestMessages(prev => [...prev, { role: "model", parts: [{ text: "Error: Failed to get response from OpenRouter." }], timestamp: new Date().toISOString() }]);
    } finally {
      if (canEditSettings) {
        void fetchLlmUsageSummary(selectedEventId);
      }
      setIsTyping(false);
    }
  };

  const closeAdminCommandPalette = () => {
    setAdminCommandPaletteOpen(false);
    setAdminCommandPaletteQuery("");
  };

  const applyAdminAgentCommand = (command: string) => {
    setAdminAgentInputText(command);
    closeAdminCommandPalette();
    window.setTimeout(() => {
      adminAgentInputRef.current?.focus();
      const nextLength = command.length;
      adminAgentInputRef.current?.setSelectionRange(nextLength, nextLength);
    }, 0);
  };

  const handleApplyAdminCommandTemplate = (template: AdminAgentCommandTemplate) => {
    applyAdminAgentCommand(template.command);
  };

  const handleToggleAdminCommandPalette = () => {
    setAdminCommandPaletteOpen((current) => {
      if (current) {
        setAdminCommandPaletteQuery("");
        return false;
      }
      return true;
    });
  };

  const handleAdminAgentSend = async () => {
    if (!adminAgentInputText.trim()) return;

    const outgoingText = adminAgentInputText.trim();
    closeAdminCommandPalette();
    const userMsg: AdminAgentChatMessage = {
      role: "user",
      text: outgoingText,
      timestamp: new Date().toISOString(),
    };
    setAdminAgentMessages((prev) => [...prev, userMsg]);
    setAdminAgentInputText("");
    setAdminAgentTyping(true);

    try {
      const history = adminAgentMessages.map((msg) => ({
        role: msg.role === "user" ? "user" as const : "model" as const,
        parts: [{
          text: msg.role === "agent" && msg.actionName
            ? `[${msg.actionName}] ${msg.text}`
            : msg.text,
        }],
      }));
      const response = await getAdminAgentResponse(outgoingText, settings, history, selectedEventId);
      const replyText = String(response.reply || "").trim() || "ดำเนินการแล้ว";
      const ticketUrls = extractAdminAgentTicketUrls(response.result || null);
      const csvDownloadUrl = extractAdminAgentCsvDownloadUrl(response.result || null);

      setAdminAgentMessages((prev) => [
        ...prev,
        {
          role: "agent",
          text: replyText,
          timestamp: new Date().toISOString(),
          actionName: response.action?.name || "",
          actionSource: response.action?.source || "llm",
          ticketPngUrl: ticketUrls.pngUrl,
          ticketSvgUrl: ticketUrls.svgUrl,
          csvDownloadUrl,
        },
      ]);

      if (response.action?.name) {
        const actionEventId = String(response.event_id || selectedEventId || "").trim() || selectedEventId;
        void fetchAdminAgentDashboard(actionEventId || selectedEventId, { silent: true });
        if (actionEventId && actionEventId === selectedEventId) {
          void Promise.all([
            fetchSettings(selectedEventId),
            fetchMessages(selectedEventId),
            fetchRegistrations(selectedEventId),
            fetchEvents(),
          ]);
        } else {
          void fetchEvents();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run admin agent";
      setAdminAgentMessages((prev) => [
        ...prev,
        {
          role: "agent",
          text: `Error: ${message}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      if (canEditSettings) {
        void fetchLlmUsageSummary(selectedEventId);
      }
      setAdminAgentTyping(false);
    }
  };

  const handleAdminAgentClearChat = async () => {
    setAdminAgentMessages([]);
    try {
      await apiFetch("/api/admin-agent/history/reset", { method: "POST" });
    } catch (err) {
      console.error("Failed to reset shared admin agent history", err);
    }
  };

  const handleLogin = async () => {
    setLoginSubmitting(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to login");
      }

      const loggedInUser = data.user as AuthUser;
      setAuthUser(loggedInUser);
      setAuthStatus("authenticated");
      setActiveTab(getDefaultTabForRole(loggedInUser.role));
      setLoginPassword("");
      setTeamMessage("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Failed to login");
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (hasAnyUnsavedSettings && !window.confirm("You have unsaved changes. Logout without saving?")) {
      return;
    }
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("Failed to logout", err);
    } finally {
      setAuthStatus("unauthenticated");
      setAuthUser(null);
      setMessages([]);
      setLogsHasMore(false);
      setLogsLoadingMore(false);
      setTestMessages([]);
      setAdminAgentMessages([]);
      setInputText("");
      setAdminAgentInputText("");
      setIsTyping(false);
      setAdminAgentTyping(false);
      setRegistrations([]);
      setDocuments([]);
      setTeamUsers([]);
      setEvents([]);
      setChannels([]);
      setChannelPlatformDefinitions([]);
      setSelectedEventId("");
      setEventMessage("");
      setDocumentsMessage("");
      resetDocumentForm();
      resetChannelForm();
      setLoading(false);
      stopQrScanner();
    }
  };

  const handleCreateEvent = async () => {
    const name = newEventName.trim();
    if (!name) return;
    setEventLoading(true);
    setEventMessage("");
    try {
      const res = await apiFetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create event");
      }
      setNewEventName("");
      setEventCreateOpen(false);
      await fetchEvents();
      await fetchChannels();
      if (data?.id) {
        setSelectedEventId(String(data.id));
      }
      setEventMessage(`Created event ${data?.name || name}`);
      window.setTimeout(() => setEventMessage(""), 2500);
    } catch (err) {
      setEventMessage(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setEventLoading(false);
    }
  };

  const handleUpdateEvent = async ({
    status,
    name,
    successMessage = "Event updated",
    silent = false,
  }: {
    status?: "pending" | "active" | "inactive" | "cancelled" | "archived";
    name?: string;
    successMessage?: string;
    silent?: boolean;
  } = {}) => {
    if (!selectedEventId || !selectedEvent) return;
    const payload: Record<string, unknown> = {};
    const trimmedName = String(name || "").trim();
    if (trimmedName && trimmedName !== selectedEvent.name) {
      payload.name = trimmedName;
    }
    if (status && status !== selectedEvent.status) {
      payload.status = status;
    }
    if (!Object.keys(payload).length) return;

    setEventLoading(true);
    setEventMessage("");
    try {
      const res = await apiFetch(`/api/events/${encodeURIComponent(selectedEventId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update event");
      }
      await fetchEvents();
      if (!silent && successMessage) {
        setEventMessage(successMessage);
        window.setTimeout(() => setEventMessage(""), 2500);
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update event";
      if (silent) {
        setSettingsMessage(message);
      } else {
        setEventMessage(message);
      }
      return false;
    } finally {
      setEventLoading(false);
    }
  };

  const handleCloneEvent = async () => {
    if (!selectedEventId || !selectedEvent) return;
    if (
      hasAnyUnsavedSettings
      && !window.confirm("Clone from the last saved version of this event? Unsaved changes on the current event will not be included.")
    ) {
      return;
    }
    const suggestedName = `${settings.event_name.trim() || selectedEvent.name} Copy`;
    const nameInput = window.prompt("Name for the cloned event", suggestedName);
    if (nameInput == null) return;
    const nextName = nameInput.trim();
    if (!nextName) {
      setEventMessage("Cloned event name is required");
      return;
    }
    const includeDocuments = documents.length > 0
      ? window.confirm("Copy knowledge documents to the cloned event too? Registrations and channel assignments will still be skipped.")
      : false;

    setEventLoading(true);
    setEventMessage("");
    try {
      const res = await apiFetch(`/api/events/${encodeURIComponent(selectedEventId)}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName, include_documents: includeDocuments }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to clone event");
      }
      await Promise.all([fetchEvents(), fetchChannels()]);
      if (data?.event?.id) {
        setSelectedEventId(String(data.event.id));
        setEventWorkspaceView("setup");
        setActiveTab("event");
      }
      const copiedDocuments = Number(data?.copied?.documents || 0);
      setEventMessage(
        copiedDocuments > 0
          ? `Event cloned. Copied ${copiedDocuments} knowledge documents. Registrations and channel assignments were not copied.`
          : "Event cloned. Registrations, channel assignments, and knowledge documents were not copied.",
      );
      window.setTimeout(() => setEventMessage(""), 3500);
    } catch (err) {
      setEventMessage(err instanceof Error ? err.message : "Failed to clone event");
    } finally {
      setEventLoading(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!selectedEventId || !selectedEvent) return;
    if (selectedEvent.is_default) {
      setEventMessage("Default event cannot be deleted");
      return;
    }
    if (selectedEvent.status !== "archived") {
      setEventMessage("Archive the event before deleting it");
      return;
    }
    const confirmed = window.confirm(
      `Delete "${selectedEvent.name}" permanently?\n\nThis only works when the event has no registrations, messages, documents, check-in links, or channel assignments.`,
    );
    if (!confirmed) return;

    setEventLoading(true);
    setEventMessage("");
    try {
      const res = await apiFetch(`/api/events/${encodeURIComponent(selectedEventId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const blockerText = Array.isArray(data?.blockers) && data.blockers.length > 0
          ? ` (${data.blockers.join(", ")})`
          : "";
        throw new Error((data?.error || "Failed to delete event") + blockerText);
      }
      setSelectedEventId("");
      await Promise.all([fetchEvents(), fetchChannels()]);
      setEventWorkspaceView("setup");
      setEventMessage("Event deleted");
      window.setTimeout(() => setEventMessage(""), 3000);
    } catch (err) {
      setEventMessage(err instanceof Error ? err.message : "Failed to delete event");
    } finally {
      setEventLoading(false);
    }
  };

  const resetChannelForm = () => {
    setEditingChannelKey("");
    setNewPageId("");
    setNewPageName("");
    setNewPageAccessToken("");
    setNewChannelPlatform("facebook");
    setNewChannelConfig({});
  };

  const loadChannelIntoForm = (channel: ChannelAccountRecord) => {
    setEditingChannelKey(`${channel.platform}:${channel.external_id}`);
    setNewChannelPlatform(channel.platform);
    setNewPageId(channel.external_id);
    setNewPageName(channel.display_name);
    setNewPageAccessToken("");
    setNewChannelConfig(channel.config || {});
  };

  const handleToggleChannel = async (channel: ChannelAccountRecord) => {
    if (!selectedEventId) return;
    const platform = channel.platform;
    const externalId = channel.external_id.trim();
    const displayName = channel.display_name.trim();
    const accessToken = "";
    if (!externalId) {
      setEventMessage("Channel external ID is required");
      return;
    }

    setEventLoading(true);
    setEventMessage("");
    try {
      const res = await apiFetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          external_id: externalId,
          display_name: displayName || externalId,
          event_id: channel.event_id || selectedEventId,
          access_token: accessToken,
          config: channel.config || {},
          is_active: !channel.is_active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save channel");
      }
      await fetchChannels();
      setEventMessage(`Channel ${channel.is_active ? "disabled" : "enabled"}`);
      window.setTimeout(() => setEventMessage(""), 2500);
    } catch (err) {
      setEventMessage(err instanceof Error ? err.message : "Failed to save channel");
    } finally {
      setEventLoading(false);
    }
  };

  const handleSaveChannel = async () => {
    if (!selectedEventId) return false;
    const externalId = newPageId.trim();
    const displayName = newPageName.trim();
    const accessToken = newPageAccessToken.trim();
    const nextIsActive = editingChannel?.is_active ?? true;
    if (!lineChannelIdAutoResolved && !externalId) {
      setEventMessage(selectedChannelPlatformDefinition?.external_id_label || "Channel external ID is required");
      return false;
    }

    setEventLoading(true);
    setEventMessage("");
    try {
      const res = await apiFetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: newChannelPlatform,
          external_id: externalId,
          display_name: displayName || externalId,
          ...(!editingChannel ? { event_id: selectedEventId } : {}),
          access_token: accessToken,
          config: newChannelConfig,
          is_active: nextIsActive,
          ...(editingChannel
            ? {
                original_platform: editingChannel.platform,
                original_external_id: editingChannel.external_id,
              }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save channel");
      }
      await fetchChannels();
      setEventMessage(editingChannelKey ? "Channel connection updated" : "Channel created and assigned");
      resetChannelForm();
      window.setTimeout(() => setEventMessage(""), 2500);
      return true;
    } catch (err) {
      setEventMessage(err instanceof Error ? err.message : "Failed to save channel");
      return false;
    } finally {
      setEventLoading(false);
    }
  };

  const handleAssignChannelToSelectedEvent = async (channel: ChannelAccountRecord) => {
    if (!selectedEventId || !selectedEvent) return false;
    if (channel.event_id === selectedEventId) {
      selectSetupChannel(channel);
      return true;
    }
    if (selectedEventChannelWritesLocked) {
      setEventMessage("Archived, closed, or cancelled events cannot link channels");
      return false;
    }

    const previousEventName = channel.event_id
      ? eventNameById.get(channel.event_id) || channel.event_id
      : "";
    if (channel.event_id && channel.event_id !== selectedEventId) {
      const confirmed = window.confirm(
        `Move ${channel.display_name} from ${previousEventName || "its current event"} to ${selectedEvent.name}?`,
      );
      if (!confirmed) return false;
    }

    setEventLoading(true);
    setEventMessage("");
    try {
      const res = await apiFetch(`/api/channels/${encodeURIComponent(channel.id)}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: selectedEventId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to assign channel");
      }
      await fetchChannels();
      setSetupSelectedChannelId(channel.id);
      setEventMessage(channel.event_id ? "Channel moved to selected event" : "Channel assigned to selected event");
      window.setTimeout(() => setEventMessage(""), 2500);
      return true;
    } catch (err) {
      setEventMessage(err instanceof Error ? err.message : "Failed to assign channel");
      return false;
    } finally {
      setEventLoading(false);
    }
  };

  const handleUnassignChannelFromSelectedEvent = async (channel: ChannelAccountRecord) => {
    const confirmed = window.confirm(`Remove ${channel.display_name} from the selected event?`);
    if (!confirmed) return false;

    setEventLoading(true);
    setEventMessage("");
    try {
      const res = await apiFetch(`/api/channels/${encodeURIComponent(channel.id)}/unassign`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to remove channel from event");
      }
      await fetchChannels();
      setSetupSelectedChannelId(channel.id);
      setEventMessage("Channel removed from selected event");
      window.setTimeout(() => setEventMessage(""), 2500);
      return true;
    } catch (err) {
      setEventMessage(err instanceof Error ? err.message : "Failed to remove channel from event");
      return false;
    } finally {
      setEventLoading(false);
    }
  };

  const handleCreateUser = async () => {
    setTeamLoading(true);
    setTeamMessage("");
    try {
      const res = await apiFetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUserUsername,
          display_name: newUserDisplayName,
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create user");
      }
      setTeamMessage(`Created user ${data.user?.username || newUserUsername}`);
      setNewUserUsername("");
      setNewUserDisplayName("");
      setNewUserPassword("");
      setNewUserRole("operator");
      await fetchTeamUsers();
      window.setTimeout(() => setTeamMessage(""), 2500);
    } catch (err) {
      setTeamMessage(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setTeamLoading(false);
    }
  };

  const handleUserRoleChange = async (userId: string, role: UserRole) => {
    setTeamLoading(true);
    setTeamMessage("");
    try {
      const res = await apiFetch(`/api/auth/users/${encodeURIComponent(userId)}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update role");
      }
      setTeamMessage("Updated user role");
      await fetchTeamUsers();
      window.setTimeout(() => setTeamMessage(""), 2500);
    } catch (err) {
      setTeamMessage(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setTeamLoading(false);
    }
  };

  const handleUserAccessToggle = async (userId: string, isActive: boolean) => {
    setTeamLoading(true);
    setTeamMessage("");
    try {
      const res = await apiFetch(`/api/auth/users/${encodeURIComponent(userId)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update access");
      }
      setTeamMessage(isActive ? "User access restored" : "User access removed");
      await fetchTeamUsers();
      window.setTimeout(() => setTeamMessage(""), 2500);
    } catch (err) {
      setTeamMessage(err instanceof Error ? err.message : "Failed to update access");
    } finally {
      setTeamLoading(false);
    }
  };

  const handleDeleteUser = async (user: AuthUser) => {
    if (!canDeleteTeamUser(user)) return;

    const confirmed = window.confirm(
      `Delete ${user.display_name || user.username} permanently?\n\nThis will remove the account, revoke active sessions, and remove all workspace access. This cannot be undone.`,
    );
    if (!confirmed) return;

    setTeamLoading(true);
    setTeamMessage("");
    try {
      const res = await apiFetch(`/api/auth/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete user");
      }
      setTeamMessage(`Deleted user ${user.username}`);
      await fetchTeamUsers();
      window.setTimeout(() => setTeamMessage(""), 2500);
    } catch (err) {
      setTeamMessage(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setTeamLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyPublicPageUrlToClipboard = async () => {
    if (!publicPageAbsoluteUrl) return;
    try {
      await navigator.clipboard.writeText(publicPageAbsoluteUrl);
      setPublicPageLinkCopied(true);
      window.setTimeout(() => setPublicPageLinkCopied(false), 2000);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Failed to copy public page URL");
    }
  };

  const triggerDownloadFromHref = (href: string, fileName: string) => {
    if (!href) return;
    const link = document.createElement("a");
    link.href = href;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const triggerDownloadFromBlob = (blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    try {
      triggerDownloadFromHref(objectUrl, fileName);
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  };

  const handleDownloadPublicPageQrPng = () => {
    if (!publicPageQrDataUrl) {
      setSettingsMessage("QR code is not ready yet");
      return;
    }
    triggerDownloadFromHref(publicPageQrDataUrl, `${publicPageQrFileBase}.png`);
  };

  const handleDownloadPublicPageQrSvg = () => {
    if (!publicPageQrSvgMarkup) {
      setSettingsMessage("QR code is not ready yet");
      return;
    }
    triggerDownloadFromBlob(new Blob([publicPageQrSvgMarkup], { type: "image/svg+xml;charset=utf-8" }), `${publicPageQrFileBase}.svg`);
  };

  const focusSearchTarget = (kind: GlobalSearchResultKind, id: string) => {
    if (searchFocusTimeoutRef.current !== null) {
      window.clearTimeout(searchFocusTimeoutRef.current);
    }
    setSearchFocusTarget({ kind, id });
    window.setTimeout(() => {
      document.getElementById(getSearchTargetDomId(kind, id))?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, 180);
    searchFocusTimeoutRef.current = window.setTimeout(() => {
      setSearchFocusTarget((current) => (current?.kind === kind && current.id === id ? null : current));
      searchFocusTimeoutRef.current = null;
    }, 2600);
  };

  const isSearchFocused = (kind: GlobalSearchResultKind, id: string) =>
    searchFocusTarget?.kind === kind && searchFocusTarget.id === id;

  const selectDocumentForChunks = (documentId: string) => {
    setSelectedDocumentForChunksId(documentId);
    focusSearchTarget("document", documentId);
  };

  const selectSetupChannel = (channel: ChannelAccountRecord) => {
    setSetupSelectedChannelId(channel.id);
    const nextKeys = CHANNEL_PLATFORM_WEBHOOK_MAP[channel.platform];
    if (!nextKeys.includes(selectedWebhookConfigKey)) {
      setSelectedWebhookConfigKey(nextKeys[0]);
    }
  };

  const focusSetupChannel = (channel: ChannelAccountRecord) => {
    selectSetupChannel(channel);
    return true;
  };

  const openChannelConfigDialog = (channel?: ChannelAccountRecord) => {
    if (channel) {
      if (!focusSetupChannel(channel)) return;
      loadChannelIntoForm(channel);
    } else {
      resetChannelForm();
    }
    setHelpOpen(false);
    setChannelConfigDialogOpen(true);
  };

  const closeChannelConfigDialog = () => {
    setChannelConfigDialogOpen(false);
    resetChannelForm();
  };

  const handleGlobalSearchSelect = (kind: GlobalSearchResultKind, id: string) => {
    if (kind === "event") {
      const event = events.find((item) => item.id === id);
      if (!confirmDiscardDirtyChanges({ nextTab: "event", nextEventId: id })) return;
      setEventListQuery(event?.slug || event?.name || "");
      setSelectedEventId(id);
      setActiveTab("event");
      focusSearchTarget("event", id);
    }
    if (kind === "registration") {
      const registration = registrations.find((item) => item.id === id);
      if (!confirmDiscardDirtyChanges({ nextTab: "registrations" })) return;
      setRegistrationListQuery(registration?.id || "");
      setActiveTab("registrations");
      setSelectedRegistrationId(id);
      focusSearchTarget("registration", id);
    }
    if (kind === "channel") {
      const channel = channels.find((item) => item.id === id);
      if (!confirmDiscardDirtyChanges({ nextTab: "settings" })) return;
      if (channel) {
        selectSetupChannel(channel);
        loadChannelIntoForm(channel);
        setChannelConfigDialogOpen(true);
      }
      setActiveTab("settings");
      focusSearchTarget("channel", id);
    }
    if (kind === "document") {
      const document = documents.find((item) => item.id === id);
      if (!confirmDiscardDirtyChanges({ nextTab: "design" })) return;
      setDocumentListQuery(document?.title || "");
      setActiveTab("design");
      selectDocumentForChunks(id);
    }
    if (kind === "log") {
      const message = messages.find((item) => String(item.id) === id);
      if (!confirmDiscardDirtyChanges({ nextTab: "logs" })) return;
      setLogListQuery(message?.sender_id || message?.text || "");
      setActiveTab("logs");
      focusSearchTarget("log", id);
    }
    setGlobalSearchOpen(false);
    setGlobalSearchQuery("");
  };

  if (authStatus === "checking") {
    if (checkinAccessMode) {
      return (
        <div className="min-h-dvh bg-slate-50 flex items-center justify-center">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      );
    }
  }

  if (checkinAccessMode) {
    if (checkinAccessLoading) {
      return (
        <div className="min-h-dvh bg-slate-50 flex items-center justify-center">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      );
    }

    if (!checkinAccessSession) {
      return (
        <div className="min-h-dvh bg-slate-50 text-slate-900 flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-sm space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Check-in link unavailable</h1>
              <p className="text-sm text-slate-500 mt-2">
                {checkinAccessError || "This check-in session is invalid, expired, or has already been revoked."}
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-dvh overflow-x-hidden bg-slate-50 text-slate-900 font-sans">
        <header className="app-header-surface sticky top-0 z-10 border-b border-slate-200 bg-white backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                  <QrCode className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-bold">{checkinAccessSession.event_name}</h1>
                  <p className="truncate text-xs text-slate-500">
                    Check-in session: <span className="font-semibold text-slate-700">{checkinAccessSession.label}</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <StatusBadge tone={getEventStatusTone(checkinAccessSession.event_status)}>
                {getEventStatusLabel(checkinAccessSession.event_status)}
              </StatusBadge>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Expires</p>
                <p className="mt-1 text-xs font-semibold text-slate-900">{new Date(checkinAccessSession.expires_at).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:gap-6 sm:py-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Event Status</p>
              <p className="mt-2 text-lg font-semibold text-blue-900 capitalize">{checkinAccessSession.event_status}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Last Used</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {checkinAccessSession.last_used_at ? new Date(checkinAccessSession.last_used_at).toLocaleString() : "Not used yet"}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Camera className="w-5 h-5 text-blue-600" />
                  QR Scanner
                </h2>
                <p className="text-sm text-slate-500">Allow camera access, then scan attendee tickets continuously.</p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <ActionButton
                  onClick={startQrScanner}
                  disabled={!canUseQrScanner || scannerActive || scannerStarting}
                  tone="blue"
                  active
                  className="min-w-0 flex-1 text-sm sm:w-auto sm:flex-none"
                >
                  {scannerStarting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Start Camera
                </ActionButton>
                <ActionButton
                  onClick={stopQrScanner}
                  disabled={!scannerActive && !scannerStarting}
                  tone="neutral"
                  className="min-w-0 flex-1 text-sm sm:w-auto sm:flex-none"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </ActionButton>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-950">
              <div className="aspect-video relative">
                <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
                {!scannerActive && !scannerStarting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-3 p-6 text-center">
                    <Camera className="w-10 h-10 opacity-70" />
                    <p className="text-sm max-w-sm">
                      {canUseQrScanner
                        ? "Tap Start Camera to request permission and begin scanning."
                        : "This browser does not support camera access. Use manual check-in instead."}
                    </p>
                  </div>
                )}
                {scannerStarting && (
                  <div className="absolute inset-0 flex items-center justify-center text-white">
                    <RefreshCw className="w-6 h-6 animate-spin" />
                  </div>
                )}
                {scannerActive && (
                  <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-32 border-2 border-blue-300/90 rounded-3xl shadow-[0_0_0_9999px_rgba(15,23,42,0.28)] pointer-events-none" />
                )}
              </div>
            </div>
            {lastScannedValue && (
              <p className="mt-3 text-xs text-slate-500 break-all">
                Last scan: <span className="font-mono">{lastScannedValue}</span>
              </p>
            )}
            {scannerError && <p className="mt-2 text-xs text-rose-600">{scannerError}</p>}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Search className="w-5 h-5 text-blue-600" />
                Manual Check-in
              </h2>
              <p className="text-sm text-slate-500">Use registration ID if scanning fails.</p>
            </div>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleCheckin()}
                  placeholder="REG-XXXXXX"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-base font-mono outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <ActionButton
                onClick={handleCheckin}
                disabled={!searchId || checkinStatus === "loading"}
                tone={checkinStatus === "success" ? "emerald" : checkinStatus === "error" ? "rose" : "blue"}
                active
                className="w-full text-sm"
              >
                {checkinStatus === "loading" && <RefreshCw className="w-4 h-4 animate-spin" />}
                {checkinStatus === "success" && <CheckCircle2 className="w-4 h-4" />}
                {checkinStatus === "error" && <AlertCircle className="w-4 h-4" />}
                {checkinStatus === "success" ? "Checked In!" : checkinStatus === "error" ? "Check-in Failed" : "Check In Attendee"}
              </ActionButton>
              {checkinStatus === "error" && checkinErrorMessage && (
                <p className="text-xs text-rose-600">{checkinErrorMessage}</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-lg font-semibold">Latest Result</h3>
                <StatusLine
                  className="mt-1"
                  items={[
                    latestResultLabel,
                    latestCheckinRegistration ? `ID ${latestCheckinRegistration.id}` : null,
                  ]}
                />
              </div>
            </div>

            {!latestCheckinRegistration ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                No attendee checked in yet in this session.
              </div>
            ) : (
              <div className={`rounded-2xl border p-4 space-y-3 ${latestResultToneClass}`}>
                <div>
                  <p className="text-lg font-semibold text-slate-900">
                    {latestCheckinRegistration.first_name} {latestCheckinRegistration.last_name}
                  </p>
                  <p className="text-xs font-mono text-blue-600">{latestCheckinRegistration.id}</p>
                </div>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Phone</p>
                    <p className="text-slate-700">{latestCheckinRegistration.phone || "-"}</p>
                  </div>
                  <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Email</p>
                    <p className="text-slate-700 break-all">{latestCheckinRegistration.email || "-"}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (!isPublicEventRoute && authStatus === "checking") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!isPublicEventRoute && authStatus === "unauthenticated") {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 backdrop-blur p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">FaceBotStudio Admin</h1>
              <p className="text-sm text-slate-300">Sign in to access registrations, logs, and event settings.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Username</label>
              <input
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loginSubmitting && handleLogin()}
                className="w-full rounded-2xl bg-slate-900 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="owner"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loginSubmitting && handleLogin()}
                className="w-full rounded-2xl bg-slate-900 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            {authError && (
              <p className="text-sm text-rose-300">{authError}</p>
            )}
            <button
              onClick={handleLogin}
              disabled={!loginUsername.trim() || !loginPassword || loginSubmitting}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-3 font-semibold transition-colors"
            >
              {loginSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isPublicEventRoute && loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const appUrl = process.env.APP_URL || window.location.origin;
  const webhookUrl = `${appUrl}/api/webhook`;
  const lineWebhookUrl = `${appUrl}/api/webhook/line`;
  const instagramWebhookUrl = `${appUrl}/api/webhook/instagram`;
  const whatsappWebhookUrl = `${appUrl}/api/webhook/whatsapp`;
  const telegramWebhookUrl = `${appUrl}/api/webhook/telegram/{botKey}`;
  const adminAgentTelegramWebhookUrl = `${appUrl}/api/admin-agent/telegram/webhook`;
  const adminAgentTelegramSetWebhookUrl = settings.admin_agent_telegram_bot_token.trim()
    ? `https://api.telegram.org/bot${settings.admin_agent_telegram_bot_token.trim()}/setWebhook?url=${encodeURIComponent(adminAgentTelegramWebhookUrl)}${settings.admin_agent_telegram_webhook_secret.trim() ? `&secret_token=${encodeURIComponent(settings.admin_agent_telegram_webhook_secret.trim())}` : ""}`
    : "";
  const webChatConfigUrl = `${appUrl}/api/webchat/config/{widgetKey}`;
  const webChatMessageUrl = `${appUrl}/api/webchat/messages`;
  const webhookConfigItems: Array<{
    key: WebhookConfigKey;
    shortLabel: string;
    label: string;
    value: string;
    help?: ReactNode;
  }> = [
    {
      key: "facebook",
      shortLabel: "Facebook",
      label: "Facebook Callback URL",
      value: webhookUrl,
    },
    {
      key: "line",
      shortLabel: "LINE",
      label: "LINE Callback URL",
      value: lineWebhookUrl,
      help: <>Save <code>Channel Access Token</code> as the channel token and keep <code>Channel Secret</code> in platform-specific config.</>,
    },
    {
      key: "instagram",
      shortLabel: "Instagram",
      label: "Instagram Callback URL",
      value: instagramWebhookUrl,
      help: "Use the Instagram business account ID as the external ID and save the linked Meta token as the access token.",
    },
    {
      key: "whatsapp",
      shortLabel: "WhatsApp",
      label: "WhatsApp Callback URL",
      value: whatsappWebhookUrl,
      help: <>Use <code>Phone Number ID</code> as the external ID and keep <code>Business Account ID</code> in platform-specific config.</>,
    },
    {
      key: "telegram",
      shortLabel: "Telegram",
      label: "Telegram Callback URL",
      value: telegramWebhookUrl,
      help: <>Replace <code>{"{botKey}"}</code> with the Telegram channel external ID.</>,
    },
    {
      key: "webchat_config",
      shortLabel: "Web Chat Config",
      label: "Web Chat Config URL",
      value: webChatConfigUrl,
      help: <>Replace <code>{"{widgetKey}"}</code> with the Web Chat channel external ID.</>,
    },
    {
      key: "webchat_message",
      shortLabel: "Web Chat Message",
      label: "Web Chat Message URL",
      value: webChatMessageUrl,
      help: <>POST <code>widget_key</code>, <code>sender_id</code>, and <code>text</code> from the site widget.</>,
    },
  ];
  const setupWebhookItems =
    setupSelectedChannel
      ? webhookConfigItems.filter((item) =>
          CHANNEL_PLATFORM_WEBHOOK_MAP[setupSelectedChannel.platform].includes(item.key),
        )
      : webhookConfigItems;
  const selectedWebhookConfigItem =
    setupWebhookItems.find((item) => item.key === selectedWebhookConfigKey)
    || setupWebhookItems[0]
    || webhookConfigItems[0];
  const teamAccessPanel = (role === "owner" || role === "admin") ? (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Team Access
            </h2>
            <p className="mt-1 text-sm text-slate-500">Session-based admin access with roles stored in the database.</p>
            <p className="mt-2 text-xs text-amber-700">
              Delete removes the account permanently, revokes active sessions, and cannot be undone.
            </p>
          </div>
          <button
            onClick={fetchTeamUsers}
            disabled={teamLoading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white transition-colors hover:bg-slate-50 disabled:opacity-50"
            title="Refresh users"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${teamLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.92fr)]">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Current Members</p>
              <p className="text-xs text-slate-500">Manage active accounts, roles, and emergency access changes.</p>
            </div>
            <span className="text-xs font-medium text-slate-500">{teamUsers.length} members</span>
          </div>
          <div className="space-y-3">
            {teamUsers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                No users loaded yet.
              </div>
            ) : (
              teamUsers.map((user) => (
                <div key={user.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{user.display_name}</p>
                      <p className="mt-1 text-xs text-slate-500">{user.username}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <StatusLine
                        items={[
                          user.is_active ? "active" : "disabled",
                          user.role,
                        ]}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div>
                      {canManageTargetRole(user) ? (
                        <select
                          value={user.role}
                          onChange={(e) => handleUserRoleChange(user.id, e.target.value as UserRole)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={teamLoading}
                        >
                          {MANAGEABLE_ROLES.filter((roleOption) => authUser?.role === "owner" || (roleOption !== "owner" && roleOption !== "admin")).map((roleOption) => (
                            <option key={roleOption} value={roleOption}>
                              {roleOption}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-400">
                          Role change is restricted for this account.
                        </div>
                      )}
                    </div>
                    {(canManageTargetAccess(user) || canDeleteTeamUser(user)) && (
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <ActionButton
                          onClick={() => handleUserAccessToggle(user.id, !user.is_active)}
                          disabled={teamLoading}
                          tone={user.is_active ? "rose" : "emerald"}
                          className="text-sm"
                        >
                          {user.is_active ? "Remove Access" : "Restore Access"}
                        </ActionButton>
                        {canDeleteTeamUser(user) && (
                          <ActionButton
                            onClick={() => void handleDeleteUser(user)}
                            disabled={teamLoading}
                            tone="rose"
                            className="text-sm"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete Member
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {canManageUsers && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600" />
              <p className="text-sm font-semibold text-slate-900">Add Team Member</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">Create a new admin workspace account with a role and temporary password.</p>
            <div className="mt-3 space-y-2.5">
              <input
                value={newUserDisplayName}
                onChange={(e) => setNewUserDisplayName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Display name"
              />
              <input
                value={newUserUsername}
                onChange={(e) => setNewUserUsername(e.target.value.toLowerCase())}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="username"
              />
              <input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Temporary password"
              />
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                {MANAGEABLE_ROLES.filter((roleOption) => roleOption !== "owner" && (role !== "admin" || roleOption !== "admin")).map((roleOption) => (
                  <option key={roleOption} value={roleOption}>
                    {roleOption}
                  </option>
                ))}
              </select>
              <ActionButton
                onClick={handleCreateUser}
                disabled={teamLoading || !newUserUsername.trim() || !newUserPassword || newUserPassword.length < 8}
                tone="blue"
                active
                className="w-full text-sm"
              >
                <UserPlus className="w-4 h-4" />
                Create User
              </ActionButton>
            </div>
            {teamMessage && (
              <p className={`mt-4 text-xs ${teamMessage.toLowerCase().includes("failed") || teamMessage.toLowerCase().includes("error") || teamMessage.toLowerCase().includes("exists") ? "text-rose-600" : "text-emerald-600"}`}>
                {teamMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  ) : null;

  const logStatusMessages = [manualOverrideMessage, logRegistrationMessage].filter(Boolean);
  const logManualOverridePanel = canSendManualOverride && selectedLogMessage ? (
    <div className="log-tools-surface max-h-[56vh] overflow-y-auto rounded-2xl border-2 border-amber-200 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Manual Override</p>
          <p className="mt-1 hidden text-xs leading-relaxed text-slate-500 sm:block">
            Send a human reply or create and issue a ticket directly from this sender thread.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedLogChannel && (
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
              {selectedLogChannel.platform_label || selectedLogChannel.platform}
            </span>
          )}
          {manualOverrideUnavailableReason ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
              <AlertCircle className="h-3.5 w-3.5" />
              unavailable
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              ready
            </span>
          )}
        </div>
      </div>

      {manualOverrideUnavailableReason ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
          {manualOverrideUnavailableReason}
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Sender Registrations</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Existing registrations in this event for the selected sender.
                </p>
              </div>
              <span className="text-xs font-medium text-slate-500">
                {selectedSenderRegistrations.length} record{selectedSenderRegistrations.length === 1 ? "" : "s"}
              </span>
            </div>
            {selectedSenderRegistrations.length > 0 ? (
              <div className="mt-3 space-y-2">
                {selectedSenderRegistrations.map((registration) => (
                  <div
                    key={registration.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setManualOverrideRegistrationId(registration.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setManualOverrideRegistrationId(registration.id);
                      }
                    }}
                    className={`grid w-full cursor-pointer gap-2 rounded-2xl border px-3 py-3 text-left transition-colors md:grid-cols-[minmax(0,1fr)_auto] ${
                      manualOverrideRegistrationId === registration.id
                        ? "border-blue-200 bg-blue-50"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-xs font-semibold text-blue-600">{registration.id}</p>
                          <span className="text-xs font-medium text-slate-600">{registration.status}</span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {registration.first_name} {registration.last_name}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {registration.phone || "-"}
                        {registration.email ? ` • ${registration.email}` : ""}
                      </p>
                      </div>
                    <div className="flex flex-col items-start gap-2 md:items-end">
                      <p className="text-[11px] text-slate-500 md:text-right">
                        {new Date(registration.timestamp).toLocaleString()}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          tone="neutral"
                          className="min-h-8 rounded-full px-3 py-1.5 text-[11px]"
                          onClick={(event) => {
                            event.stopPropagation();
                            copyToClipboard(registration.id);
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy ID
                        </ActionButton>
                        <a
                          href={`/api/tickets/${encodeURIComponent(registration.id)}.png`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex min-h-8 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open Ticket
                        </a>
                        {canChangeRegistrationStatus && registration.status !== "cancelled" && (
                          <ActionButton
                            tone="rose"
                            className="min-h-8 rounded-full px-3 py-1.5 text-[11px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              const confirmed = window.confirm(`Cancel registration ${registration.id}?`);
                              if (!confirmed) return;
                              void updateRegistrationStatus(registration.id, "cancelled");
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Cancel
                          </ActionButton>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs leading-relaxed text-slate-500">
                No registration for this sender is in the current event list yet.
              </div>
            )}
          </div>

          <div className="mt-4 space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              Manual Reply
            </label>
            <div className="flex flex-wrap gap-2">
              {manualReplyTemplates.map((template) => (
                <ActionButton
                  key={template.id}
                  tone="neutral"
                  className="min-h-8 rounded-full px-3 py-1.5 text-[11px]"
                  onClick={() => applyManualReplyTemplate(template.text)}
                >
                  {template.label}
                </ActionButton>
              ))}
            </div>
            <textarea
              value={manualOverrideText}
              onChange={(event) => setManualOverrideText(event.target.value)}
              placeholder="Type the operator reply that should be sent to this chat."
              rows={4}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm leading-relaxed text-slate-700 outline-none transition focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end">
              <ActionButton
                tone="blue"
                active
                onClick={() => void sendManualOverride("text")}
                disabled={manualOverrideAction !== "" || !manualOverrideText.trim()}
              >
                <Send className="h-4 w-4" />
                {manualOverrideAction === "text" ? "Sending..." : "Send Reply"}
              </ActionButton>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Resume Bot</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Re-run the bot on the latest sender turn if auto-reply failed and stopped.
                </p>
              </div>
              <span className="text-xs font-medium text-amber-700">recovery</span>
            </div>
            <div className="mt-3 flex justify-end">
              <ActionButton
                tone="amber"
                onClick={() => void retryBotFromLog()}
                disabled={manualOverrideAction !== ""}
              >
                <RefreshCw className={`h-4 w-4 ${manualOverrideAction === "retry" ? "animate-spin" : ""}`} />
                {manualOverrideAction === "retry" ? "Retrying..." : "Retry Bot Reply"}
              </ActionButton>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Resend Ticket</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Use this after a registration already exists for the sender.
                </p>
              </div>
              <span className="text-xs font-medium text-slate-500">
                {selectedSenderRegistrations.length} registration{selectedSenderRegistrations.length === 1 ? "" : "s"}
              </span>
            </div>
            {selectedSenderRegistrations.length > 0 ? (
              <div className="mt-3 flex flex-col gap-3 lg:flex-row">
                <select
                  value={manualOverrideRegistrationId}
                  onChange={(event) => setManualOverrideRegistrationId(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {selectedSenderRegistrations.map((registration) => (
                    <option key={registration.id} value={registration.id}>
                      {registration.id} · {registration.first_name} {registration.last_name} · {registration.status}
                    </option>
                  ))}
                </select>
                <ActionButton
                  tone="neutral"
                  onClick={() => void sendManualOverride("ticket")}
                  disabled={manualOverrideAction !== "" || !manualOverrideRegistrationId}
                >
                  <RefreshCw className="h-4 w-4" />
                  {manualOverrideAction === "ticket" ? "Resending..." : "Resend Ticket"}
                </ActionButton>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs leading-relaxed text-slate-500">
                No registration for this sender is in the current event list yet.
              </div>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Create Registration + Issue Ticket</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Use this when the bot did not finish registration but the sender is ready to confirm now.
                </p>
              </div>
              <span className="text-xs font-medium text-blue-700">operator flow</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input
                value={logRegistrationDraft.first_name}
                onChange={(event) =>
                  setLogRegistrationDraft((current) => ({ ...current, first_name: event.target.value }))
                }
                placeholder="First name"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={logRegistrationDraft.last_name}
                onChange={(event) =>
                  setLogRegistrationDraft((current) => ({ ...current, last_name: event.target.value }))
                }
                placeholder="Last name"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={logRegistrationDraft.phone}
                onChange={(event) =>
                  setLogRegistrationDraft((current) => ({ ...current, phone: event.target.value }))
                }
                placeholder="Phone"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                value={logRegistrationDraft.email}
                onChange={(event) =>
                  setLogRegistrationDraft((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="Email (optional)"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mt-3 flex justify-end">
              <ActionButton
                tone="blue"
                active
                onClick={() => void createRegistrationAndIssueTicketFromLog()}
                disabled={manualOverrideAction !== "" || logRegistrationAction !== ""}
              >
                <Plus className="h-4 w-4" />
                {logRegistrationAction === "create_ticket" ? "Creating..." : "Create + Send Ticket"}
              </ActionButton>
            </div>
          </div>
        </>
      )}

      {logStatusMessages.map((message) => {
        const lower = String(message).toLowerCase();
        const isError =
          lower.includes("failed")
          || lower.includes("error")
          || lower.includes("required")
          || lower.includes("not")
          || lower.includes("invalid");
        return (
          <p key={message} className={`mt-4 text-xs ${isError ? "text-rose-600" : "text-emerald-600"}`}>
            {message}
          </p>
        );
      })}
    </div>
  ) : null;

  const logInspectorPanel = !selectedLogMessage ? (
    <div className="flex h-full items-center justify-center px-8 py-12 text-center text-sm text-slate-400">
      Select a log row to inspect the full message and sender history.
    </div>
  ) : (
    <div className="log-inspector-surface chat-selectable flex h-full min-h-[34rem] flex-col">
      <div className="border-b border-slate-100 bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Sender History</p>
            <StatusLine
              className="mt-1"
              items={[
                <>
                  {getLogDirectionMeta(selectedLogMessage.type).label} via {selectedLogMessage.platform || "unknown"}
                </>,
                new Date(selectedLogMessage.timestamp).toLocaleString(),
              ]}
            />
            {(selectedLogMessage.sender_name || selectedLogMessage.registration_id) && (
              <p className="mt-1 truncate text-xs font-medium text-slate-700">
                {selectedLogMessage.sender_name || "-"}
                {selectedLogMessage.registration_id ? ` • ${selectedLogMessage.registration_id}` : ""}
              </p>
            )}
            <p className="mt-0.5 break-all font-mono text-xs text-blue-600">{selectedLogMessage.sender_id}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {selectedSenderThread.length} message{selectedSenderThread.length === 1 ? "" : "s"} in the current event log
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canSendManualOverride && (
              <ActionButton
                tone={logToolsOpen ? "amber" : "neutral"}
                className="min-h-8 rounded-full px-3 py-1.5 text-[11px]"
                onClick={() => setLogToolsOpen((open) => !open)}
              >
                <PencilLine className="h-3.5 w-3.5" />
                {logToolsOpen ? "Hide Tools" : "Manual Tools"}
              </ActionButton>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-3">
          {logToolsOpen && logManualOverridePanel}

          <InspectorSection
            title="Selected Entry"
            subtitle={new Date(selectedLogMessage.timestamp).toLocaleString()}
            className="bg-slate-100"
          >
            {(() => {
              const selectedTrace = parseLineTraceMessage(selectedLogMessage.text);
              if (selectedTrace) {
                return (
                  <div className="space-y-1.5">
                    <StatusLine items={[<>Trace {formatTraceStatusLabel(selectedTrace.status)}</>]} />
                    <p className="chat-selectable whitespace-pre-wrap break-words text-[13px] leading-5 text-slate-700">
                      {selectedTrace.detail || "-"}
                    </p>
                  </div>
                );
              }
              if (selectedLogAuditMarker && selectedLogAuditMarker.marker !== "manual-reply") {
                return (
                  <div className="space-y-1.5">
                    <StatusLine items={[`${selectedLogAuditMarker.actor} · ${selectedLogAuditMarker.label}`]} />
                    <p className="chat-selectable whitespace-pre-wrap break-words text-[13px] leading-5 text-slate-700">
                      {selectedLogAuditMarker.summary}
                    </p>
                  </div>
                );
              }
              return (
                <p className="chat-selectable whitespace-pre-wrap break-words text-[13px] leading-5 text-slate-700">
                  {selectedLogAuditMarker?.detail || selectedLogMessage.text}
                </p>
              );
            })()}
          </InspectorSection>
        </div>
      </div>

      <div className="log-history-surface chat-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {selectedSenderThread.map((threadMessage) => {
          const lineTrace = parseLineTraceMessage(threadMessage.text);
          const auditMarker = lineTrace ? null : parseInternalLogMarker(threadMessage.text);
          const isCurrentMessage = threadMessage.id === selectedLogMessage.id;
          const directionMeta = getLogDirectionMeta(threadMessage.type);
          const alignClass = lineTrace || auditMarker || threadMessage.type === "incoming" ? "justify-start" : "justify-end";
          return (
            <div key={threadMessage.id} className={`flex ${alignClass}`}>
              <div
                className={`w-full max-w-[86%] rounded-2xl border px-3 py-2.5 shadow-sm ${
                  isCurrentMessage
                    ? "border-blue-200 bg-blue-50"
                    : lineTrace
                    ? "border-amber-100 bg-amber-50"
                    : auditMarker
                    ? "border-violet-100 bg-violet-50"
                    : threadMessage.type === "incoming"
                    ? "border-emerald-100 bg-emerald-50"
                    : "border-slate-200 bg-white"
                } ${isCurrentMessage ? "ring-1 ring-blue-200" : ""}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${directionMeta.className}`}>
                      {directionMeta.icon}
                      {directionMeta.label}
                    </span>
                    {lineTrace && <span className="text-[11px] text-amber-700">Trace</span>}
                    {auditMarker && <span className="text-[11px] text-slate-600">{auditMarker.actor}</span>}
                    {isCurrentMessage && <SelectionMarker />}
                  </div>
                  <p className="text-[10px] text-slate-500">{new Date(threadMessage.timestamp).toLocaleString()}</p>
                </div>
                <p className="chat-selectable mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-slate-700">
                  {lineTrace
                    ? lineTrace.detail || formatTraceStatusLabel(lineTrace.status)
                    : auditMarker
                    ? auditMarker.marker === "manual-reply"
                      ? auditMarker.detail
                      : auditMarker.summary
                    : threadMessage.text}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const isChatConsoleTab = activeTab === "test" || (activeTab === "agent" && agentWorkspaceView === "console");

  if (isPublicEventRoute) {
    const publicEventName = publicEventPage?.event.name || "Event";
    const publicLocationLabel = publicEventPage?.location.compact || "Venue details will be announced soon";
    const publicSummary = publicEventPage?.event.summary || publicEventPage?.event.description || "";
    const publicRouteMessengerHref = publicEventPage ? normalizeExternalHref(publicEventPage.contact.messenger_url) : "";
    const publicRouteLineHref = publicEventPage ? normalizeExternalHref(publicEventPage.contact.line_url) : "";
    const publicRoutePhoneHref = publicEventPage ? normalizePhoneHref(publicEventPage.contact.phone) : "";
    const publicRouteContactVisible = Boolean(
      publicEventPage?.contact.enabled
      && (
        publicRouteMessengerHref
        || publicRouteLineHref
        || publicEventPage.contact.phone.trim()
        || publicEventPage.contact.hours.trim()
      ),
    );
    const publicRegistrationAvailable = Boolean(
      publicEventPage
      && publicEventPage.event.registration_enabled
      && publicEventPage.event.registration_availability === "open",
    );
    const publicTicketRecoveryMode = publicEventPage?.event.ticket_recovery_mode || "shared_contact";
    const publicRecoveredRegistrationResult = isRecoveredPublicRegistrationResult(publicRegistrationResult)
      ? publicRegistrationResult
      : null;
    const publicTicketReady = Boolean(publicRecoveredRegistrationResult);
    const publicNameVerificationRequired = publicRegistrationResult?.status === "name_verification_required";
    const publicVerifiedRecoveryRequired = publicRegistrationResult?.status === "verification_required";
    const publicAvailabilityHelper = (() => {
      switch (publicEventPage?.event.registration_availability) {
        case "full":
          return "This event is full right now.";
        case "closed":
          return "Registration for this event has closed.";
        case "not_started":
          return "Registration has not opened yet.";
        case "invalid":
          return "Registration timing is being updated.";
        default:
          return "Register on this page and save your ticket image immediately.";
      }
    })();

    return (
      <div className="public-page-selectable min-h-dvh bg-slate-50 text-slate-900 font-sans">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 shadow-[0_10px_24px_rgba(37,99,235,0.18)]">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{publicEventName}</p>
                <p className="truncate text-xs text-slate-500">{publicLocationLabel}</p>
              </div>
            </div>
            {publicEventPage && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StatusBadge tone={getEventStatusTone(publicEventPage.event.status)}>
                  {getEventStatusLabel(publicEventPage.event.status)}
                </StatusBadge>
                <StatusBadge tone={publicRouteAvailabilityTone}>
                  {publicRouteAvailabilityLabel}
                </StatusBadge>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8">
          {publicEventLoading ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : publicEventError || !publicEventPage ? (
            <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                <AlertCircle className="h-7 w-7" />
              </div>
              <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">Public page unavailable</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {publicEventError || "This event page is not published or could not be found."}
              </p>
            </div>
          ) : (
            <>
              <section className="grid gap-5 lg:items-start lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
                <div className="self-start overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
                  <div className="aspect-[800/1132] w-full">
                    {publicEventPage.event.poster_url ? (
                      <img
                        src={publicEventPage.event.poster_url}
                        alt={`${publicEventPage.event.name} poster`}
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
                        <Eye className="h-9 w-9 text-slate-400" />
                        <div>
                          <p className="text-sm font-semibold text-slate-700">Event poster</p>
                          <p className="mt-1 text-xs text-slate-500">Recommended size 800 x 1132 px</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-5 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm lg:self-start sm:p-6">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={getEventStatusTone(publicEventPage.event.status)}>
                      {getEventStatusLabel(publicEventPage.event.status)}
                    </StatusBadge>
                    <StatusBadge tone={publicRouteAvailabilityTone}>
                      {publicRouteAvailabilityLabel}
                    </StatusBadge>
                  </div>

                  <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                      {publicEventPage.event.name}
                    </h1>
                    {publicSummary && (
                      <p className="mt-2.5 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                        {publicSummary}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Date & Time</p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-900">{publicEventPage.event.date_label}</p>
                      <p className="mt-1 text-xs text-slate-500">{publicEventPage.event.timezone}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Location</p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-900">
                        {publicEventPage.location.title || publicLocationLabel}
                      </p>
                      {publicEventPage.location.address_line && (
                        <p className="mt-1 text-xs text-slate-500">{publicEventPage.location.address_line}</p>
                      )}
                    </div>
                  </div>

                  <div className={`grid gap-3 ${publicEventPage.event.show_seat_availability ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Registration</p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-900">{publicAvailabilityHelper}</p>
                    </div>
                    {publicEventPage.event.show_seat_availability && (
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Seats</p>
                        <p className="mt-1.5 text-sm font-semibold text-slate-900">
                          {publicEventPage.event.registration_limit == null
                            ? "Unlimited"
                            : `${publicEventPage.event.active_registration_count}/${publicEventPage.event.registration_limit}`}
                        </p>
                      </div>
                    )}
                    {publicEventPage.event.show_seat_availability && (
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Remaining</p>
                        <p className="mt-1.5 text-sm font-semibold text-slate-900">
                          {publicEventPage.event.remaining_seats == null ? "Open" : publicEventPage.event.remaining_seats}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <a
                      href="#public-registration"
                      className="public-page-control inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
                    >
                      {publicEventPage.event.cta_label}
                    </a>
                    {publicEventPage.location.map_url && (
                      <a
                        href={publicEventPage.location.map_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="public-page-control inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open in Maps
                      </a>
                    )}
                  </div>
                </div>
              </section>

              <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,24rem)]">
                <div className="space-y-6">
                  {publicEventPage.event.description && (
                    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-blue-600" />
                        <h2 className="text-lg font-semibold text-slate-900">About This Event</h2>
                      </div>
                      <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600">
                        {publicEventPage.event.description}
                      </p>
                    </div>
                  )}

                  <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Location & Travel</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          {publicEventPage.location.title || publicLocationLabel}
                        </p>
                      </div>
                      {publicEventPage.location.map_url && (
                        <a
                          href={publicEventPage.location.map_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Open in Maps
                        </a>
                      )}
                    </div>

                    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      {publicRouteMapEmbedUrl ? (
                        <iframe
                          title="Event location map"
                          src={publicRouteMapEmbedUrl}
                          className="h-80 w-full border-0"
                          loading="lazy"
                          referrerPolicy="no-referrer-when-downgrade"
                          allowFullScreen
                        />
                      ) : (
                        <div className="flex h-80 items-center justify-center px-6 text-center text-sm text-slate-500">
                          Map preview will appear here when venue details are available.
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Venue</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {publicEventPage.location.title || publicLocationLabel}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Address</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {publicEventPage.location.address_line || publicEventPage.location.address || "-"}
                        </p>
                      </div>
                    </div>

                    {publicEventPage.location.travel_info && (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Travel Info</p>
                        <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">
                          {publicEventPage.location.travel_info}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <aside id="public-registration" className="space-y-6 xl:sticky xl:top-6 xl:self-start">
                  <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    {!publicTicketReady ? (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h2 className="text-lg font-semibold text-slate-900">Register</h2>
                            <p className="mt-1 text-sm text-slate-500">
                              Fill in one short form. Your ticket appears on this page immediately.
                            </p>
                          </div>
                          <StatusBadge tone={publicRouteAvailabilityTone}>
                            {publicRouteAvailabilityLabel}
                          </StatusBadge>
                        </div>

                        {publicRegistrationAvailable ? (
                          <form className="mt-5 space-y-3" onSubmit={handlePublicRegistrationSubmit}>
                            <div>
                              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">First Name</label>
                              <input
                                value={publicRegistrationForm.first_name}
                                onChange={(e) => handlePublicRegistrationFieldChange("first_name", e.target.value)}
                                autoComplete="given-name"
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="First name"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Last Name</label>
                              <input
                                value={publicRegistrationForm.last_name}
                                onChange={(e) => handlePublicRegistrationFieldChange("last_name", e.target.value)}
                                autoComplete="family-name"
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Last name"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Phone</label>
                              <input
                                value={publicRegistrationForm.phone}
                                onChange={(e) => handlePublicRegistrationFieldChange("phone", e.target.value)}
                                autoComplete="tel"
                                inputMode="tel"
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Phone number"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Email</label>
                              <input
                                value={publicRegistrationForm.email}
                                onChange={(e) => handlePublicRegistrationFieldChange("email", e.target.value)}
                                autoComplete="email"
                                inputMode="email"
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Email address"
                              />
                            </div>

                            {publicRegistrationError && (
                              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                {publicRegistrationError}
                              </div>
                            )}

                            <button
                              type="submit"
                              disabled={publicRegistrationSubmitting}
                              className="public-page-control inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {publicRegistrationSubmitting && <RefreshCw className="h-4 w-4 animate-spin" />}
                              {publicEventPage.event.cta_label}
                            </button>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-500">
                              <span>Save your ticket image to your phone after submitting.</span>
                              {publicEventPage.privacy.enabled && (
                                <button
                                  type="button"
                                  onClick={() => setPublicPrivacyOpen(true)}
                                  className="public-page-control inline-flex items-center gap-1 font-semibold text-slate-700 transition-colors hover:text-blue-600"
                                >
                                  <Lock className="h-3.5 w-3.5" />
                                  {publicEventPage.privacy.label}
                                </button>
                              )}
                            </div>
                          </form>
                        ) : (
                          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <p className="text-sm font-semibold text-slate-900">{publicAvailabilityHelper}</p>
                            <p className="mt-2 text-sm leading-6 text-slate-500">
                              This page stays here for event details, location, and ticket recovery when available.
                            </p>
                            {publicEventPage.privacy.enabled && (
                              <button
                                type="button"
                                onClick={() => setPublicPrivacyOpen(true)}
                              className="public-page-control mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-700 transition-colors hover:text-blue-600"
                              >
                                <Lock className="h-3.5 w-3.5" />
                                {publicEventPage.privacy.label}
                              </button>
                            )}
                          </div>
                        )}

                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Find My Ticket</p>
                              <p className="mt-1 text-sm leading-6 text-slate-500">
                                {publicTicketRecoveryMode === "verified_contact"
                                  ? "This event is set up for verified ticket recovery. OTP or reference-based release will plug in here for paid events."
                                  : "Already registered? Enter your phone number or email. If that contact has multiple attendees, we will ask for the attendee name next."}
                              </p>
                            </div>
                            <StatusBadge tone="neutral">Recovery</StatusBadge>
                          </div>

                          <form className="mt-4 space-y-3" onSubmit={handlePublicTicketLookupSubmit}>
                            <div>
                              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Phone</label>
                              <input
                                value={publicTicketLookupForm.phone}
                                onChange={(e) => handlePublicTicketLookupFieldChange("phone", e.target.value)}
                                autoComplete="tel"
                                inputMode="tel"
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Phone number"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Email</label>
                              <input
                                value={publicTicketLookupForm.email}
                                onChange={(e) => handlePublicTicketLookupFieldChange("email", e.target.value)}
                                autoComplete="email"
                                inputMode="email"
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Email address"
                              />
                            </div>
                            {publicNameVerificationRequired && (
                              <div>
                                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Attendee Name</label>
                                <input
                                  value={publicTicketLookupForm.attendee_name}
                                  onChange={(e) => handlePublicTicketLookupFieldChange("attendee_name", e.target.value)}
                                  autoComplete="name"
                                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                  placeholder="Enter the attendee's first and last name"
                                />
                              </div>
                            )}
                            {publicNameVerificationRequired && publicRegistrationResult && (
                              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                                {publicRegistrationResult.message}
                              </div>
                            )}
                            {publicVerifiedRecoveryRequired && publicRegistrationResult && (
                              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                {publicRegistrationResult.message}
                              </div>
                            )}
                            {publicTicketLookupError && (
                              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                {publicTicketLookupError}
                              </div>
                            )}
                            <button
                              type="submit"
                              disabled={publicTicketLookupSubmitting}
                              className="public-page-control inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {publicTicketLookupSubmitting && <RefreshCw className="h-4 w-4 animate-spin" />}
                              {publicNameVerificationRequired ? "Verify Attendee Name" : "Find My Ticket"}
                            </button>
                          </form>
                        </div>
                      </>
                    ) : (
                      <div id="public-ticket-ready" className="space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {publicRecoveredRegistrationResult?.status === "success" ? "Registration complete" : "Ticket found"}
                            </div>
                            <h2 className="mt-3 text-lg font-semibold text-slate-900">
                              {publicRecoveredRegistrationResult?.registration.first_name} {publicRecoveredRegistrationResult?.registration.last_name}
                            </h2>
                            <p className="mt-1 text-sm leading-6 text-slate-500">
                              {publicRecoveredRegistrationResult?.success_message}
                            </p>
                          </div>
                        </div>

                        <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50">
                          <a href={publicRecoveredRegistrationResult?.ticket.png_url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={publicRecoveredRegistrationResult?.ticket.png_url}
                              alt={`Ticket for ${publicRecoveredRegistrationResult?.registration.id}`}
                              className="w-full"
                            />
                          </a>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <a
                            href={publicRecoveredRegistrationResult?.ticket.png_url}
                            download={`${publicRecoveredRegistrationResult?.registration.id}.png`}
                            className="public-page-control inline-flex items-center justify-center rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                          >
                            Save Ticket Image
                          </a>
                          {publicRecoveredRegistrationResult?.map_url ? (
                            <a
                              href={publicRecoveredRegistrationResult?.map_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="public-page-control inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                            >
                              <ExternalLink className="h-4 w-4" />
                              View Map
                            </a>
                          ) : (
                            <a
                              href={publicRecoveredRegistrationResult?.ticket.svg_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="public-page-control inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                            >
                              <ExternalLink className="h-4 w-4" />
                              Open SVG Copy
                            </a>
                          )}
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
                          <p className="font-semibold text-slate-900">{publicRecoveredRegistrationResult?.event.name}</p>
                          <p className="mt-1">{publicRecoveredRegistrationResult?.event.date_label}</p>
                          <p className="mt-1">{publicRecoveredRegistrationResult?.event.location}</p>
                          <p className="mt-3 text-xs text-slate-500">
                            Save this image now. Email backup, if configured for this event, will arrive separately.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={resetPublicRegistrationFlow}
                          className="public-page-control inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                        >
                          {publicRecoveredRegistrationResult?.status === "success" ? "Register Another Attendee" : "Back to Registration"}
                        </button>
                      </div>
                    )}
                  </div>

                  {publicRouteContactVisible && (
                    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-900">Help & Contact</h2>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            {publicEventPage.contact.intro}
                          </p>
                        </div>
                        <StatusBadge tone="neutral">Fallback</StatusBadge>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {publicRouteMessengerHref && (
                          <PublicContactActionLink href={publicRouteMessengerHref} label="Chat on Messenger" kind="messenger" />
                        )}
                        {publicRouteLineHref && (
                          <PublicContactActionLink href={publicRouteLineHref} label="Chat on LINE" kind="line" />
                        )}
                        {publicRoutePhoneHref && (
                          <PublicContactActionLink href={publicRoutePhoneHref} label={`Call ${publicEventPage.contact.phone}`} kind="phone" />
                        )}
                      </div>

                      {publicEventPage.contact.hours && (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Support Hours</p>
                          <p className="mt-2 text-sm font-semibold text-slate-900">{publicEventPage.contact.hours}</p>
                        </div>
                      )}
                    </div>
                  )}
                </aside>
              </section>

              {publicPrivacyOpen && publicEventPage.privacy.enabled && (
                <div
                  className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 px-4"
                  onClick={() => setPublicPrivacyOpen(false)}
                >
                  <div
                    className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                          <Lock className="h-5 w-5" />
                        </div>
                        <h2 className="mt-4 text-xl font-bold text-slate-900">{publicEventPage.privacy.label}</h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPublicPrivacyOpen(false)}
                        className="public-page-control inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                        aria-label="Close privacy notice"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600">
                      {publicEventPage.privacy.text}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        {publicEventPage?.support.bot_enabled && (
          <>
            <AnimatePresence>
              {publicChatOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 sm:left-auto sm:right-6 sm:w-[25rem]"
                >
                  <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Event Help</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Ask about schedule, venue, travel, registration, or ticket recovery.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPublicChatOpen(false)}
                        className="public-page-control inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                        aria-label="Close help chat"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div
                      ref={publicChatBodyRef}
                      className="max-h-[min(56vh,34rem)] space-y-3 overflow-y-auto bg-slate-50/80 px-4 py-4"
                    >
                      {publicChatMessages.map((message) => {
                        const isAssistant = message.role === "assistant";
                        return (
                          <div key={message.id} className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}>
                            <div
                              className={`max-w-[88%] rounded-[1.5rem] px-4 py-3 text-sm shadow-sm ${
                                isAssistant
                                  ? "border border-slate-200 bg-white text-slate-800"
                                  : "bg-blue-600 text-white"
                              }`}
                              style={{ fontFamily: "var(--font-edit)" }}
                            >
                              {message.text && <p className="whitespace-pre-line leading-6">{message.text}</p>}

                              {message.tickets.length > 0 && (
                                <div className={`${message.text ? "mt-3" : ""} space-y-2`}>
                                  {message.tickets.map((ticket) => (
                                    <div
                                      key={`${message.id}:${ticket.registration_id}`}
                                      className={`rounded-2xl border px-3 py-3 ${
                                        isAssistant
                                          ? "border-slate-200 bg-slate-50"
                                          : "border-blue-400/60 bg-blue-500/30"
                                      }`}
                                    >
                                      <p className={`text-[11px] font-bold uppercase tracking-[0.16em] ${isAssistant ? "text-slate-500" : "text-blue-100/90"}`}>
                                        Ticket {ticket.registration_id}
                                      </p>
                                      {ticket.summary_text && (
                                        <p className={`mt-2 whitespace-pre-line text-xs leading-5 ${isAssistant ? "text-slate-600" : "text-blue-50"}`}>
                                          {ticket.summary_text}
                                        </p>
                                      )}
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {ticket.png_url && (
                                          <a
                                            href={ticket.png_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`public-page-control inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                                              isAssistant
                                                ? "bg-blue-600 text-white"
                                                : "bg-white text-blue-700"
                                            }`}
                                          >
                                            <Download className="h-3.5 w-3.5" />
                                            PNG
                                          </a>
                                        )}
                                        {ticket.svg_url && (
                                          <a
                                            href={ticket.svg_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`public-page-control inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                                              isAssistant
                                                ? "border-slate-200 bg-white text-slate-700"
                                                : "border-blue-200/70 bg-transparent text-white"
                                            }`}
                                          >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            SVG
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {message.mapUrl && (
                                <div className={`${message.text || message.tickets.length > 0 ? "mt-3" : ""}`}>
                                  <a
                                    href={message.mapUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`public-page-control inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                                      isAssistant
                                        ? "border border-slate-200 bg-slate-50 text-slate-700"
                                        : "bg-white text-blue-700"
                                    }`}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Open Map
                                  </a>
                                </div>
                              )}

                              <p className={`mt-2 text-[10px] ${isAssistant ? "text-slate-400" : "text-blue-100/80"}`}>
                                {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <form className="border-t border-slate-200 bg-white p-4" onSubmit={handlePublicChatSubmit}>
                      {publicChatError && (
                        <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          {publicChatError}
                        </div>
                      )}
                      <label className="sr-only" htmlFor="public-chat-input">Message</label>
                      <div className="flex items-end gap-2">
                        <textarea
                          id="public-chat-input"
                          value={publicChatInput}
                          onChange={(e) => setPublicChatInput(e.target.value)}
                          onKeyDown={handlePublicChatInputKeyDown}
                          rows={2}
                          placeholder="Ask a question"
                          className="min-h-[4.25rem] flex-1 resize-none rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          style={{ fontFamily: "var(--font-edit)" }}
                        />
                        <button
                          type="submit"
                          disabled={publicChatSending || !publicChatInput.trim()}
                          className="public-page-control inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label="Send message"
                        >
                          {publicChatSending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </button>
                      </div>

                      {publicRouteContactVisible && (
                        <div className="mt-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Need a human instead?</p>
                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            {publicEventPage.contact.intro}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {publicRouteMessengerHref && (
                              <PublicContactActionLink href={publicRouteMessengerHref} label="Messenger" kind="messenger" compact />
                            )}
                            {publicRouteLineHref && (
                              <PublicContactActionLink href={publicRouteLineHref} label="LINE" kind="line" compact />
                            )}
                            {publicRoutePhoneHref && (
                              <PublicContactActionLink href={publicRoutePhoneHref} label="Call" kind="phone" compact />
                            )}
                          </div>
                          {publicEventPage.contact.hours && (
                            <p className="mt-3 text-[11px] text-slate-500">
                              Available: <span className="font-semibold text-slate-700">{publicEventPage.contact.hours}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </form>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 sm:right-6">
              <button
                type="button"
                onClick={() => setPublicChatOpen((current) => !current)}
                className="public-page-control inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_48px_rgba(15,23,42,0.24)] transition-transform hover:-translate-y-0.5"
              >
                {publicChatOpen ? <X className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                {publicChatOpen ? "Close Help" : "Need Help?"}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className={`app-shell bg-slate-50 text-slate-900 font-sans ${
        isChatConsoleTab ? "flex h-dvh flex-col overflow-hidden" : "min-h-dvh"
      }`}
    >
      <header className={`app-header-surface sticky top-0 z-20 border-b border-slate-200 bg-white backdrop-blur ${
        isAgentMobileFocusMode ? "hidden lg:block" : ""
      }`}>
        <div className="max-w-7xl mx-auto px-3 py-2 sm:px-4 lg:px-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,34rem)_minmax(0,1fr)] lg:items-center">
            <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue-600 shadow-[0_10px_24px_rgba(37,99,235,0.2)] sm:h-10 sm:w-10">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-[1.05rem] font-bold tracking-tight sm:text-2xl">FB Bot Studio</h1>
                  {selectedEvent && (
                    <>
                      <StatusBadge tone={getEventStatusTone(selectedEvent.effective_status)} className="inline-flex">
                        {getEventStatusLabel(selectedEvent.effective_status)}
                      </StatusBadge>
                      {selectedEvent.registration_availability === "full" && (
                        <StatusBadge tone="rose" className="inline-flex">full</StatusBadge>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="col-start-2 row-start-1 relative justify-self-end self-start lg:col-start-3" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen((open) => !open)}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 sm:px-3"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
              >
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-semibold leading-none">{authUser?.display_name || authUser?.username}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">{authUser?.role}</p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <User className="h-4 w-4" />
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {userMenuOpen && (
                <div className="app-overlay-surface absolute right-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="truncate text-sm font-semibold text-slate-900">{authUser?.display_name || authUser?.username}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">{authUser?.role}</p>
                  </div>
                  <div className="mt-3">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      <MonitorCog className="h-3.5 w-3.5" />
                      Theme
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
                      {([
                        { id: "light", label: "Light" },
                        { id: "dark", label: "Dark" },
                        { id: "system", label: "System" },
                      ] as Array<{ id: ThemeMode; label: string }>).map((mode) => (
                        <button
                          key={mode.id}
                          onClick={() => {
                            setThemeMode(mode.id);
                            setUserMenuOpen(false);
                          }}
                          className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
                            themeMode === mode.id
                              ? "bg-white text-blue-600 shadow-sm"
                              : "text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    role="menuitem"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              )}
            </div>

            <div className="col-span-2 row-start-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:flex lg:justify-center">
              <label htmlFor="event-selector" className="sr-only">
                Workspace switcher
              </label>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 lg:w-[min(32rem,100%)]">
                <CalendarRange className="h-4 w-4 shrink-0 text-slate-400" />
                <select
                  id="event-selector"
                  value={selectedEventAvailableInSelector ? selectedEventId : ""}
                  onChange={(e) => {
                    if (!handleSelectEvent(e.target.value)) {
                      e.currentTarget.value = selectedEventId;
                    }
                  }}
                  disabled={!selectorEvents.length || eventLoading}
                  className="min-w-0 w-full truncate bg-transparent text-sm font-medium outline-none disabled:opacity-60"
                >
                  <option value="" disabled>
                    {selectorPlaceholderLabel}
                  </option>
                  {selectorEvents.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name} ({getEventStatusLabel(event.effective_status)}{event.registration_availability && event.registration_availability !== "open" ? ` • ${getRegistrationAvailabilityLabel(event.registration_availability)}` : ""})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <div className="app-toolbar-surface grid flex-1 grid-flow-col auto-cols-fr gap-1 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-wrap sm:gap-1 sm:rounded-2xl">
              {primaryTabs.map((tab) => {
                if (tab.id === "event") {
                  return (
                    <div
                      key={tab.id}
                      className="relative min-w-0"
                      ref={eventWorkspaceMenuRef}
                      onMouseEnter={() => {
                        if (!hoverDropdownEnabled) return;
                        clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
                        setEventWorkspaceMenuOpen(true);
                        clearMenuCloseTimer(setupMenuCloseTimerRef);
                        setSetupMenuOpen(false);
                        clearMenuCloseTimer(operationsMenuCloseTimerRef);
                        setOperationsMenuOpen(false);
                        clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
                        setAgentWorkspaceMenuOpen(false);
                      }}
                      onMouseLeave={() => {
                        scheduleEventWorkspaceMenuClose();
                      }}
                    >
                      <button
                        onClick={() => {
                          setAgentWorkspaceMenuOpen(false);
                          if (hoverDropdownEnabled) {
                            setEventWorkspaceMenuOpen(true);
                            return;
                          }
                          setEventWorkspaceMenuOpen((open) => !open);
                        }}
                        className={`flex min-h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-all sm:min-h-9 sm:rounded-xl sm:px-2.5 ${
                          activeTab === "event" || eventWorkspaceMenuOpen
                            ? "bg-white text-blue-600 shadow-sm"
                            : "text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                        }`}
                        aria-expanded={eventWorkspaceMenuOpen}
                        aria-haspopup="menu"
                        aria-current={activeTab === "event" ? "page" : undefined}
                      >
                        <selectedEventWorkspaceTab.icon className="h-4 w-4 shrink-0" />
                        <span className="sr-only sm:not-sr-only sm:truncate">{tab.label}</span>
                        {eventWorkspaceDirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />}
                        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${eventWorkspaceMenuOpen ? "rotate-180" : ""}`} />
                      </button>
                      {eventWorkspaceMenuOpen && (
                        <div
                          className="app-overlay-surface absolute left-0 top-full z-30 mt-2 w-max min-w-[13rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                          onMouseEnter={() => {
                            if (!hoverDropdownEnabled) return;
                            clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
                          }}
                          onMouseLeave={() => {
                            scheduleEventWorkspaceMenuClose();
                          }}
                        >
                          {eventWorkspaceTabs.map((eventViewTab) => (
                            <button
                              key={eventViewTab.id}
                              onClick={() => {
                                handleOpenEventWorkspaceView(eventViewTab.id);
                              }}
                              className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:bg-slate-100 focus-visible:text-slate-900 ${
                                activeTab === "event" && eventWorkspaceView === eventViewTab.id
                                  ? "bg-blue-50 text-blue-700"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              }`}
                              role="menuitem"
                            >
                              <eventViewTab.icon className="h-4 w-4" />
                              <span className="font-medium">{eventViewTab.label}</span>
                              {eventViewTab.id === "setup" && eventSetupDirty && <span className="ml-auto h-2 w-2 rounded-full bg-amber-400" aria-hidden />}
                              {eventViewTab.id === "public" && eventPublicDirty && <span className="ml-auto h-2 w-2 rounded-full bg-amber-400" aria-hidden />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                if (tab.id === "agent") {
                  return (
                    <div
                      key={tab.id}
                      className="relative min-w-0"
                      ref={agentWorkspaceMenuRef}
                      onMouseEnter={() => {
                        if (!hoverDropdownEnabled) return;
                        clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
                        setAgentWorkspaceMenuOpen(true);
                        clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
                        setEventWorkspaceMenuOpen(false);
                        clearMenuCloseTimer(setupMenuCloseTimerRef);
                        setSetupMenuOpen(false);
                        clearMenuCloseTimer(operationsMenuCloseTimerRef);
                        setOperationsMenuOpen(false);
                      }}
                      onMouseLeave={() => {
                        scheduleAgentWorkspaceMenuClose();
                      }}
                    >
                      <button
                        onClick={() => {
                          setEventWorkspaceMenuOpen(false);
                          if (hoverDropdownEnabled) {
                            setAgentWorkspaceMenuOpen(true);
                            return;
                          }
                          setAgentWorkspaceMenuOpen((open) => !open);
                        }}
                        className={`flex min-h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-all sm:min-h-9 sm:rounded-xl sm:px-2.5 ${
                          activeTab === "agent" || agentWorkspaceMenuOpen
                            ? "bg-white text-blue-600 shadow-sm"
                            : "text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                        }`}
                        aria-expanded={agentWorkspaceMenuOpen}
                        aria-haspopup="menu"
                        aria-current={activeTab === "agent" ? "page" : undefined}
                      >
                        <tab.icon className="h-4 w-4 shrink-0" />
                        <span className="sr-only sm:not-sr-only sm:truncate">{tab.label}</span>
                        {agentSettingsDirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />}
                        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${agentWorkspaceMenuOpen ? "rotate-180" : ""}`} />
                      </button>
                      {agentWorkspaceMenuOpen && (
                        <div
                          className="app-overlay-surface absolute right-0 top-full z-30 mt-2 w-max min-w-[13rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                          onMouseEnter={() => {
                            if (!hoverDropdownEnabled) return;
                            clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
                          }}
                          onMouseLeave={() => {
                            scheduleAgentWorkspaceMenuClose();
                          }}
                        >
                          {agentWorkspaceTabs.map((agentViewTab) => (
                            <button
                              key={agentViewTab.id}
                              onClick={() => {
                                if (!handleNavigateToTab("agent")) return;
                                setAgentWorkspaceView(agentViewTab.id);
                                setAgentWorkspaceMenuOpen(false);
                                clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
                                if (agentViewTab.id === "console") {
                                  forceScrollAdminAgentToBottom();
                                }
                              }}
                              className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:bg-slate-100 focus-visible:text-slate-900 ${
                                activeTab === "agent" && agentWorkspaceView === agentViewTab.id
                                  ? "bg-blue-50 text-blue-700"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              }`}
                              role="menuitem"
                            >
                              <agentViewTab.icon className="h-4 w-4" />
                              <span className="font-medium">{agentViewTab.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <button
                    key={tab.id}
                    onClick={() => handleNavigateToTab(tab.id)}
                    className={`flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-all sm:min-h-9 sm:rounded-xl sm:px-2.5 ${
                      activeTab === tab.id
                        ? "bg-white text-blue-600 shadow-sm"
                        : "text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                    }`}
                    aria-current={activeTab === tab.id ? "page" : undefined}
                  >
                    <tab.icon className="h-4 w-4 shrink-0" />
                    <span className="sr-only sm:not-sr-only sm:truncate">{tab.label}</span>
                    {(tab.id === "mail" && eventMailDirty) && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />
                    )}
                    {(tab.id === "design" && eventContextDirty) && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />
                    )}
                  </button>
                );
              })}
              {operationsTabs.length > 0 && (
                <div
                  className="relative min-w-0"
                  ref={operationsMenuRef}
                  onMouseEnter={() => {
                    if (!hoverDropdownEnabled) return;
                    clearMenuCloseTimer(operationsMenuCloseTimerRef);
                    setOperationsMenuOpen(true);
                    clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
                    setEventWorkspaceMenuOpen(false);
                    clearMenuCloseTimer(setupMenuCloseTimerRef);
                    setSetupMenuOpen(false);
                    clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
                    setAgentWorkspaceMenuOpen(false);
                  }}
                  onMouseLeave={() => {
                    scheduleOperationsMenuClose();
                  }}
                >
                  <button
                    onClick={() => {
                      setEventWorkspaceMenuOpen(false);
                      setAgentWorkspaceMenuOpen(false);
                      if (hoverDropdownEnabled) {
                        setOperationsMenuOpen(true);
                        return;
                      }
                      setOperationsMenuOpen((open) => !open);
                    }}
                    className={`flex min-h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-all sm:min-h-9 sm:rounded-xl sm:px-2.5 ${
                      isOperationsTab || operationsMenuOpen
                        ? "bg-white text-blue-600 shadow-sm"
                        : "text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                    }`}
                    aria-expanded={operationsMenuOpen}
                    aria-haspopup="menu"
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    <span className="sr-only sm:not-sr-only sm:truncate">Operations</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${operationsMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {operationsMenuOpen && (
                    <div
                      className="app-overlay-surface absolute right-0 top-full z-30 mt-2 w-max min-w-[11.5rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                      onMouseEnter={() => {
                        if (!hoverDropdownEnabled) return;
                        clearMenuCloseTimer(operationsMenuCloseTimerRef);
                      }}
                      onMouseLeave={() => {
                        scheduleOperationsMenuClose();
                      }}
                    >
                      {operationsTabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => {
                            handleNavigateToTab(tab.id);
                          }}
                          className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:bg-slate-100 focus-visible:text-slate-900 ${
                            activeTab === tab.id
                              ? "bg-blue-50 text-blue-700"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                          role="menuitem"
                        >
                          <tab.icon className="h-4 w-4" />
                          <span className="font-medium">{tab.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {setupTabs.length > 0 && selectedSetupTab && (
                <div
                  className="relative min-w-0"
                  ref={setupMenuRef}
                  onMouseEnter={() => {
                    if (!hoverDropdownEnabled) return;
                    clearMenuCloseTimer(setupMenuCloseTimerRef);
                    setSetupMenuOpen(true);
                    clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
                    setEventWorkspaceMenuOpen(false);
                    clearMenuCloseTimer(operationsMenuCloseTimerRef);
                    setOperationsMenuOpen(false);
                    clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
                    setAgentWorkspaceMenuOpen(false);
                  }}
                  onMouseLeave={() => {
                    scheduleSetupMenuClose();
                  }}
                >
                  <button
                    onClick={() => {
                      setEventWorkspaceMenuOpen(false);
                      setAgentWorkspaceMenuOpen(false);
                      if (hoverDropdownEnabled) {
                        setSetupMenuOpen(true);
                        return;
                      }
                      setSetupMenuOpen((open) => !open);
                    }}
                    className={`flex min-h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-all sm:min-h-9 sm:rounded-xl sm:px-2.5 ${
                      isSetupTab || setupMenuOpen
                        ? "bg-white text-blue-600 shadow-sm"
                        : "text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                    }`}
                    aria-expanded={setupMenuOpen}
                    aria-haspopup="menu"
                  >
                    <selectedSetupTab.icon className="h-4 w-4 shrink-0" />
                    <span className="sr-only sm:not-sr-only sm:truncate">Setup</span>
                    {workspaceSetupDirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />}
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${setupMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {setupMenuOpen && (
                    <div
                      className="app-overlay-surface absolute right-0 top-full z-30 mt-2 w-max min-w-[11.5rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                      onMouseEnter={() => {
                        if (!hoverDropdownEnabled) return;
                        clearMenuCloseTimer(setupMenuCloseTimerRef);
                      }}
                      onMouseLeave={() => {
                        scheduleSetupMenuClose();
                      }}
                    >
                      {setupTabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => {
                            handleNavigateToTab(tab.id);
                          }}
                          className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors focus-visible:bg-slate-100 focus-visible:text-slate-900 ${
                            activeTab === tab.id
                              ? "bg-blue-50 text-blue-700"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                          role="menuitem"
                        >
                          <tab.icon className="h-4 w-4" />
                          <span className="font-medium">{tab.label}</span>
                          {tab.id === "settings" && workspaceSetupDirty && <span className="ml-auto h-2 w-2 rounded-full bg-amber-400" aria-hidden />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => setGlobalSearchOpen(true)}
                className={`flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-all sm:min-h-9 sm:rounded-xl sm:px-2.5 ${
                  globalSearchOpen
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                }`}
                aria-label="Open global search"
              >
                <Search className="h-4 w-4 shrink-0" />
                <span className="sr-only sm:not-sr-only sm:truncate">Search</span>
                <span className="hidden rounded-lg bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 lg:inline-flex">
                  {searchShortcutLabel}
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main
        className={
          isChatConsoleTab
            ? isAgentMobileFocusMode
              ? "max-w-7xl mx-auto flex-1 min-h-0 overflow-hidden px-0 py-0 lg:px-6 lg:py-5"
              : "max-w-7xl mx-auto flex-1 min-h-0 overflow-hidden px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5"
            : `max-w-7xl mx-auto px-3 py-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-4 lg:px-6 lg:py-5 ${canEditSettings ? "lg:pb-28" : ""}`
        }
      >
        <AnimatePresence mode="wait">
          {activeTab === "event" && (
            <motion.div
              key="event"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
                <div className="space-y-4 xl:col-span-7">
                  {eventWorkspaceView === "setup" ? (
                    <>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Bot className="w-5 h-5 text-blue-600" />
                            Event Information
                          </h3>
                          {selectedEvent && (
                            <StatusBadge tone={getEventStatusTone(selectedEvent.effective_status)}>
                              {getEventStatusLabel(selectedEvent.effective_status)}
                            </StatusBadge>
                          )}
                        </div>
                        <StatusLine
                          className="mt-1"
                          items={[
                            selectedEvent ? <>Mode {getEventStatusLabel(selectedEvent.status)}</> : null,
                            selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open"
                              ? <>Registration {getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}</>
                              : "Registration open",
                            eventSetupDirty ? "Unsaved changes" : "All changes saved",
                          ]}
                        />
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                        <ActionButton
                          onClick={() => void saveEventDetails()}
                          disabled={saving}
                          tone="blue"
                          active
                          className="w-full text-sm sm:w-auto sm:shrink-0"
                        >
                          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          Save Event Setup
                        </ActionButton>
                        <ActionButton
                          onClick={() => void handleUpdateEvent({ status: eventStatusToggle.nextStatus })}
                          disabled={eventStatusToggle.disabled}
                          tone={eventStatusToggle.tone}
                          active={eventStatusToggle.nextStatus === "active"}
                          className="w-full text-sm sm:w-auto sm:shrink-0"
                        >
                          {eventLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : eventStatusToggle.nextStatus === "active" ? <Power className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                          {eventStatusToggle.label}
                        </ActionButton>
                        {selectedEvent && (
                          <InlineActionsMenu label="Event Actions" tone="neutral">
                            <MenuActionItem
                              onClick={() => void handleCloneEvent()}
                              disabled={!selectedEvent || eventLoading}
                              tone="neutral"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              <span className="font-medium">Clone Event</span>
                            </MenuActionItem>
                            {!selectedEvent.is_default && selectedEvent.status !== "inactive" && selectedEvent.status !== "archived" && (
                              <MenuActionItem
                                onClick={() => void handleUpdateEvent({ status: "inactive" })}
                                disabled={!selectedEvent || eventLoading}
                                tone="neutral"
                                className="mt-1"
                              >
                                <Power className="h-3.5 w-3.5" />
                                <span className="font-medium">Set Inactive</span>
                              </MenuActionItem>
                            )}
                            {!selectedEvent.is_default && selectedEvent.status !== "archived" && (
                              <MenuActionItem
                                onClick={() => void handleUpdateEvent({ status: "archived" })}
                                disabled={!selectedEvent || eventLoading}
                                tone="neutral"
                                className="mt-1"
                              >
                                <Archive className="h-3.5 w-3.5" />
                                <span className="font-medium">Archive Event</span>
                              </MenuActionItem>
                            )}
                            {!selectedEvent.is_default && selectedEvent.status === "archived" && (
                              <MenuActionItem
                                onClick={() => void handleUpdateEvent({ status: "inactive" })}
                                disabled={!selectedEvent || eventLoading}
                                tone="neutral"
                                className="mt-1"
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                                <span className="font-medium">Restore Archived</span>
                              </MenuActionItem>
                            )}
                            {!selectedEvent.is_default && selectedEvent.status === "archived" && (
                              <MenuActionItem
                                onClick={() => void handleDeleteEvent()}
                                disabled={!selectedEvent || eventLoading}
                                tone="rose"
                                className="mt-1"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span className="font-medium">Delete Event</span>
                              </MenuActionItem>
                            )}
                            {!selectedEvent.is_default && selectedEvent.status !== "cancelled" && selectedEvent.status !== "archived" && (
                              <MenuActionItem
                                onClick={() => void handleUpdateEvent({ status: "cancelled" })}
                                disabled={!selectedEvent || eventLoading}
                                tone="rose"
                                className="mt-1"
                              >
                                <AlertCircle className="h-3.5 w-3.5" />
                                <span className="font-medium">Cancel Event</span>
                              </MenuActionItem>
                            )}
                          </InlineActionsMenu>
                        )}
                      </div>
                    </div>

                    {selectedEvent?.effective_status === "closed" && (
                      <PageBanner tone="amber" icon={<AlertCircle className="h-4 w-4" />} className="mb-4">
                        Registration closed automatically when the event window ended at {timingInfo.eventCloseLabel}. Current system time is {timingInfo.nowLabel}.
                      </PageBanner>
                    )}
                    {selectedEvent
                      && selectedEvent.effective_status !== "closed"
                      && selectedEvent.effective_status !== "cancelled"
                      && selectedEvent.effective_status !== "archived"
                      && selectedEvent.registration_availability
                      && selectedEvent.registration_availability !== "open" && (
                        <PageBanner tone="amber" icon={<AlertCircle className="h-4 w-4" />} className="mb-4">
                          Registration {getRegistrationAvailabilityLabel(selectedEvent.registration_availability).toLowerCase()}. Existing attendees can still check in.
                        </PageBanner>
                      )}

                    {(eventMessage || settingsMessage) && (
                      <div className="mb-4 space-y-1">
                        {eventMessage && (
                          <p className={`text-xs ${eventMessage.toLowerCase().includes("failed") || eventMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                            {eventMessage}
                          </p>
                        )}
                        {settingsMessage && (
                          <p className={`text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                            {settingsMessage}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Event Name</label>
                        <input
                          value={settings.event_name}
                          onChange={(e) => setSettings({ ...settings, event_name: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g. AI Innovation Summit 2026"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Event Starts</label>
                            <input
                              type="datetime-local"
                              value={settings.event_date}
                              onChange={(e) => handleEventDateChange(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Event Ends (Optional)</label>
                            <input
                              type="datetime-local"
                              value={settings.event_end_date}
                              onChange={(e) => setSettings({ ...settings, event_end_date: e.target.value })}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Event Ends auto-fills to 2 hours later after you set Event Starts. Adjust it if the session runs longer.
                        </p>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description</label>
                        <textarea
                          value={settings.event_description}
                          onChange={(e) => setSettings({ ...settings, event_description: e.target.value })}
                          rows={6}
                          className="w-full min-h-[9rem] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-y"
                          placeholder="What is this event about?"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Time Zone</label>
                        <input
                          value={settings.event_timezone}
                          onChange={(e) => setSettings({ ...settings, event_timezone: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g. Asia/Bangkok"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-4 flex flex-col gap-1">
                            <h4 className="text-sm font-semibold text-slate-900">Location Details</h4>
                            <p className="text-xs text-slate-500">
                              Separate venue, room, and address so tickets, email, and attendee previews stay consistent.
                            </p>
                          </div>

                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Venue Name</label>
                              <input
                                value={settings.event_venue_name}
                                onChange={(e) => setSettings({ ...settings, event_venue_name: e.target.value })}
                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="e.g. Dhakbwan Resort"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Room / Floor / Hall</label>
                              <input
                                value={settings.event_room_detail}
                                onChange={(e) => setSettings({ ...settings, event_room_detail: e.target.value })}
                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="e.g. ห้องภิรัชญ์การ"
                              />
                            </div>

                            <div className="md:col-span-2">
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Address / Location</label>
                              <input
                                value={settings.event_location}
                                onChange={(e) => setSettings({ ...settings, event_location: e.target.value })}
                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="e.g. Tech Plaza, Bangkok"
                              />
                            </div>

                            <div className="md:col-span-2">
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Google Maps URL</label>
                              <input
                                value={settings.event_map_url}
                                onChange={(e) => setSettings({ ...settings, event_map_url: e.target.value })}
                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="https://maps.app.goo.gl/..."
                              />
                              <p className="mt-1 text-[11px] text-slate-500">
                                Leave blank to auto-generate a Google Maps search link from Venue Name and Address.
                              </p>
                            </div>

                            <div className="md:col-span-2">
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Travel Instructions</label>
                              <textarea
                                value={settings.event_travel}
                                onChange={(e) => setSettings({ ...settings, event_travel: e.target.value })}
                                rows={4}
                                className="w-full min-h-[6.5rem] p-4 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-y"
                                placeholder="How to get there?"
                              />
                            </div>

                            <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Attendee Preview</p>
                                  <p className="mt-1 text-sm font-semibold text-slate-900">
                                    {eventLocationSummary.title || eventLocationSummary.address || "Location details will appear here"}
                                  </p>
                                  {eventLocationSummary.title && eventLocationSummary.addressLine && (
                                    <p className="mt-1 text-xs text-slate-500">{eventLocationSummary.addressLine}</p>
                                  )}
                                </div>
                                {resolvedEventMapUrl && (
                                  <a
                                    href={resolvedEventMapUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-200 hover:text-blue-600"
                                  >
                                    <Link2 className="h-3.5 w-3.5" />
                                    {eventMapIsGenerated ? "Generated Map" : "Map Link"}
                                  </a>
                                )}
                              </div>

                              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
                                {eventMapEmbedUrl ? (
                                  <iframe
                                    title="Event location map preview"
                                    src={eventMapEmbedUrl}
                                    className="h-80 w-full border-0"
                                    loading="lazy"
                                    referrerPolicy="no-referrer-when-downgrade"
                                    allowFullScreen
                                  />
                                ) : (
                                  <div className="flex h-80 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-slate-500">
                                    <Link2 className="h-5 w-5 text-slate-400" />
                                    <p>Add Venue Name and Address to preview a map here.</p>
                                  </div>
                                )}
                              </div>

                              {eventLocationSummary.travelInfo && (
                                <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3">
                                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Travel Info</p>
                                  <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{eventLocationSummary.travelInfo}</p>
                                </div>
                              )}

                              {resolvedEventMapUrl && (
                                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                  <span className="font-semibold text-slate-700">
                                    {eventMapIsGenerated ? "Auto-generated map link:" : "Saved map link:"}
                                  </span>{" "}
                                  <a
                                    href={resolvedEventMapUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="break-all text-blue-600 hover:text-blue-700"
                                  >
                                    {resolvedEventMapUrl}
                                  </a>
                                </div>
                              )}
                              {eventMapIsGenerated && (
                                <p className="mt-2 text-[11px] text-slate-500">
                                  The preview and outgoing map links currently use a Google Maps search built from your venue and address.
                                </p>
                              )}
                              {!resolvedEventMapUrl && (
                                <p className="mt-2 text-[11px] text-slate-500">
                                  Add a venue and address, or paste a Google Maps URL, to enable map preview and outbound map sharing.
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start justify-between gap-3 sm:block">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Activity className="w-5 h-5 text-blue-600" />
                          Registration Rules
                        </h3>
                        <StatusLine
                          className="mt-1"
                          items={[
                            <>Window {timingInfo.registrationLabel}</>,
                            registrationCapacity.limit === null ? "Unlimited capacity" : `Capacity ${activeAttendeeCount}/${registrationCapacity.limit}`,
                            settings.reg_unique_name !== "0" ? "Duplicate guard on" : "Duplicate guard off",
                          ]}
                        />
                        <div className="sm:hidden">
                          <HelpPopover label="Open note for Registration Rules">
                            Registration availability depends on the event time zone, the open and close range, and the event window. If you add an optional end time, the event closes only after that end time.
                          </HelpPopover>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="hidden sm:block">
                          <HelpPopover label="Open note for Registration Rules">
                            Registration availability depends on the event time zone, the open and close range, and the event window. If you add an optional end time, the event closes only after that end time.
                          </HelpPopover>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Max Capacity</label>
                        <input
                          type="number"
                          value={settings.reg_limit}
                          onChange={(e) => setSettings({ ...settings, reg_limit: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Open Date</label>
                        <input
                          type="datetime-local"
                          value={settings.reg_start}
                          onChange={(e) => setSettings({ ...settings, reg_start: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Close Date</label>
                        <input
                          type="datetime-local"
                          value={settings.reg_end}
                          onChange={(e) => setSettings({ ...settings, reg_end: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                      <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>
                        Auto-suggested to 17:00 on the day before the event so registration does not stay open into the event itself.
                      </span>
                    </div>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Duplicate Name Guard</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Block repeated registrations with the same first and last name in this event. Phone and email can still repeat.
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={settings.reg_unique_name !== "0"}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                reg_unique_name: e.target.checked ? "1" : "0",
                              })
                            }
                          />
                          One ticket per full name
                        </label>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Current Time</p>
                        <p className="mt-1 text-xs text-slate-700">{timingInfo.nowLabel}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{timingInfo.timeZone}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Event Window</p>
                        <p className="mt-1 text-xs text-slate-700">{timingInfo.eventDateLabel}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Registration Opens</p>
                        <p className="mt-1 text-xs text-slate-700">{timingInfo.startLabel}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Registration Closes</p>
                        <p className="mt-1 text-xs text-slate-700">{timingInfo.endLabel}</p>
                      </div>
                    </div>
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Transactional Mail</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Registration confirmation, ticket delivery, and future event-update templates now live in the dedicated Mail workspace.
                          </p>
                        </div>
                        <ActionButton
                          onClick={() => handleNavigateToTab("mail")}
                          tone="neutral"
                          className="px-3 text-xs"
                        >
                          <Send className="h-3.5 w-3.5" />
                          Open Mail Workspace
                        </ActionButton>
                      </div>
                      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Registration Email</p>
                          <p className="mt-1 text-xs text-slate-700">{settings.confirmation_email_enabled === "1" ? "Enabled" : "Disabled"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Config Readiness</p>
                          <p className="mt-1 text-xs text-slate-700">{emailReadinessLabel}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Sender</p>
                          <p className="mt-1 break-all text-xs text-slate-700">{emailStatus?.fromAddress || "Not set"}</p>
                        </div>
                      </div>
                    </div>
                    {timingInfo.registrationStatus === "invalid" && (
                      <InlineWarning tone="rose" className="mt-3">
                        Close Date is earlier than Open Date. Fix the range first; otherwise registration will stay unavailable.
                      </InlineWarning>
                    )}
                    {timingInfo.eventScheduleStatus === "invalid" && (
                      <InlineWarning tone="rose" className="mt-3">
                        Event end time is earlier than Event start time. Fix the event window first so the schedule is clear across chat, tickets, and email.
                      </InlineWarning>
                    )}
                    {registrationCapacity.isFull && (
                      <InlineWarning tone="amber" className="mt-3">
                        Capacity is full. New registrations are blocked until you increase the limit or cancel an attendee.
                      </InlineWarning>
                    )}
                  </div>
                    </>
                  ) : (
                    <>
                      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-semibold flex items-center gap-2">
                                <Eye className="w-5 h-5 text-blue-600" />
                                Public Event Page
                              </h3>
                              <StatusBadge tone={publicPageEnabled ? "emerald" : "neutral"}>
                                {publicPageEnabled ? "enabled" : "draft"}
                              </StatusBadge>
                            </div>
                            <StatusLine
                              className="mt-1"
                              items={[
                                publicRegistrationEnabled ? "Inline registration on" : "Inline registration off",
                                publicShowSeatAvailability ? "Seat counts on" : "Seat counts hidden",
                                publicBotEnabled ? "Help chat on" : "Help chat off",
                                publicPrivacyEnabled ? "Privacy note on" : "Privacy note off",
                                publicContactEnabled ? "Contact options on" : "Contact options off",
                                eventPublicDirty ? "Unsaved changes" : "All changes saved",
                              ]}
                            />
                          </div>
                          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                            <ActionButton
                              onClick={() => void saveEventPublicPage()}
                              disabled={saving}
                              tone="blue"
                              active
                              className="w-full text-sm sm:w-auto sm:shrink-0"
                            >
                              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              Save Public Page
                            </ActionButton>
                          </div>
                        </div>

                        {(eventMessage || settingsMessage) && (
                          <div className="mb-4 space-y-1">
                            {eventMessage && (
                              <p className={`text-xs ${eventMessage.toLowerCase().includes("failed") || eventMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                                {eventMessage}
                              </p>
                            )}
                            {settingsMessage && (
                              <p className={`text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                                {settingsMessage}
                              </p>
                            )}
                          </div>
                        )}

                        <PageBanner tone="blue" icon={<CircleHelp className="h-4 w-4" />} className="mb-4">
                          Public route is now live at your event slug. Attendees stay on one page for poster, event facts, registration, ticket delivery, privacy info, and fallback contact options.
                        </PageBanner>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="mb-4 flex flex-col gap-1">
                              <h4 className="text-sm font-semibold text-slate-900">Page Controls</h4>
                              <p className="text-xs text-slate-500">
                                Stage the public-facing experience separately from internal event operations.
                              </p>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div className="md:col-span-2 flex flex-wrap gap-2">
                                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={publicPageEnabled}
                                    onChange={(e) =>
                                      setSettings({
                                        ...settings,
                                        event_public_page_enabled: e.target.checked ? "1" : "0",
                                      })
                                    }
                                  />
                                  Public page enabled
                                </label>
                                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={publicRegistrationEnabled}
                                    onChange={(e) =>
                                      setSettings({
                                        ...settings,
                                        event_public_registration_enabled: e.target.checked ? "1" : "0",
                                      })
                                    }
                                  />
                                  Inline registration
                                </label>
                                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={publicShowSeatAvailability}
                                    onChange={(e) =>
                                      setSettings({
                                        ...settings,
                                        event_public_show_seat_availability: e.target.checked ? "1" : "0",
                                      })
                                    }
                                  />
                                  Show seat counts
                                </label>
                                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={publicBotEnabled}
                                    onChange={(e) =>
                                      setSettings({
                                        ...settings,
                                        event_public_bot_enabled: e.target.checked ? "1" : "0",
                                      })
                                    }
                                  />
                                  Bot help
                                </label>
                                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={publicPrivacyEnabled}
                                    onChange={(e) =>
                                      setSettings({
                                        ...settings,
                                        event_public_privacy_enabled: e.target.checked ? "1" : "0",
                                      })
                                    }
                                  />
                                  Privacy note
                                </label>
                                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={publicContactEnabled}
                                    onChange={(e) =>
                                      setSettings({
                                        ...settings,
                                        event_public_contact_enabled: e.target.checked ? "1" : "0",
                                      })
                                    }
                                  />
                                  Contact options
                                </label>
                              </div>

                              <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Poster Image URL</label>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <input
                                    value={settings.event_public_poster_url}
                                    onChange={(e) => setSettings({ ...settings, event_public_poster_url: e.target.value })}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="/uploads/event-posters/... or https://.../event-poster.jpg"
                                  />
                                  <input
                                    ref={publicPosterFileInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="hidden"
                                    onChange={(event) => void handlePublicPosterFileUpload(event.target.files?.[0] || null)}
                                  />
                                  <ActionButton
                                    onClick={() => publicPosterFileInputRef.current?.click()}
                                    disabled={publicPosterUploading}
                                    tone="neutral"
                                    className="shrink-0 px-3 text-xs"
                                  >
                                    {publicPosterUploading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                                    Upload Poster
                                  </ActionButton>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Upload PNG, JPG, or WebP up to 2 MB, or paste a hosted image URL manually.
                                </p>
                              </div>

                              <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Public Slug</label>
                                <input
                                  value={settings.event_public_slug}
                                  onChange={(e) => setSettings({ ...settings, event_public_slug: sanitizeEnglishSlugInput(e.target.value) })}
                                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                  placeholder={resolvedPublicPageSlug || "event-page"}
                                />
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <ActionButton
                                    onClick={() =>
                                      setSettings({
                                        ...settings,
                                        event_public_slug: resolveEnglishPublicSlug({
                                          eventName: settings.event_name || selectedEvent?.name || "",
                                          eventSlug: selectedEvent?.slug || "",
                                          eventId: selectedEvent?.id || selectedEventId,
                                        }),
                                      })
                                    }
                                    tone="neutral"
                                    className="px-3 text-xs"
                                  >
                                    Generate English Slug
                                  </ActionButton>
                                  <span className="text-[11px] text-slate-500">Target route: <span className="font-mono text-slate-700">{publicPagePreviewPath}</span></span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Lowercase English letters, numbers, and hyphens only. Slug is auto-shortened for cleaner URLs.
                                </p>
                              </div>

                              <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Primary CTA Label</label>
                                <input
                                  value={settings.event_public_cta_label}
                                  onChange={(e) => setSettings({ ...settings, event_public_cta_label: e.target.value })}
                                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                  placeholder="Register Now"
                                />
                              </div>

                              <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Public Summary</label>
                                <textarea
                                  value={settings.event_public_summary}
                                  onChange={(e) => setSettings({ ...settings, event_public_summary: e.target.value })}
                                  rows={4}
                                  className="w-full min-h-[7rem] p-4 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-y"
                                  placeholder="Leave blank to auto-generate a short public summary from the event description."
                                />
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <ActionButton
                                    onClick={() => setSettings({ ...settings, event_public_summary: publicPageAutoSummary })}
                                    disabled={!publicPageAutoSummary}
                                    tone="neutral"
                                    className="px-3 text-xs"
                                  >
                                    Use Auto Summary
                                  </ActionButton>
                                  <ActionButton
                                    onClick={() => setSettings({ ...settings, event_public_summary: "" })}
                                    disabled={!settings.event_public_summary.trim()}
                                    tone="neutral"
                                    className="px-3 text-xs"
                                  >
                                    Clear Override
                                  </ActionButton>
                                  <span className="text-[11px] text-slate-500">
                                    {settings.event_public_summary.trim()
                                      ? `${publicPageSummaryWordCount} words in custom summary`
                                      : `Auto summary stays within ${PUBLIC_SUMMARY_MAX_WORDS} words`}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Auto preview: <span className="text-slate-700">{publicPageAutoSummary || "Add an event description first."}</span>
                                </p>
                              </div>

                              <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Success Message</label>
                                <textarea
                                  value={settings.event_public_success_message}
                                  onChange={(e) => setSettings({ ...settings, event_public_success_message: e.target.value })}
                                  rows={3}
                                  className="w-full min-h-[5.5rem] p-4 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-y"
                                  placeholder="Registration complete. Save your ticket image to your phone now."
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ticket Recovery Mode</label>
                                <select
                                  value={settings.event_public_ticket_recovery_mode}
                                  onChange={(e) => setSettings({ ...settings, event_public_ticket_recovery_mode: e.target.value })}
                                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value="shared_contact">Shared Contact (free/community events)</option>
                                  <option value="verified_contact">Verified Recovery (paid events, future OTP/reference flow)</option>
                                </select>
                                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                                  {publicTicketRecoveryMode === "verified_contact"
                                    ? "Use this to prepare paid events. Online ticket recovery will not auto-release a ticket until OTP or order-reference verification is added."
                                    : "Best for free events where families may share one phone or email. If multiple attendees use the same contact, the page will ask for the attendee name next."}
                                </p>
                              </div>

                              <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Privacy Label</label>
                                <input
                                  value={settings.event_public_privacy_label}
                                  onChange={(e) => setSettings({ ...settings, event_public_privacy_label: e.target.value })}
                                  disabled={!publicPrivacyEnabled}
                                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                  placeholder="Privacy"
                                />
                              </div>

                              <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Privacy Notice Text</label>
                                <textarea
                                  value={settings.event_public_privacy_text}
                                  onChange={(e) => setSettings({ ...settings, event_public_privacy_text: e.target.value })}
                                  disabled={!publicPrivacyEnabled}
                                  rows={4}
                                  className="w-full min-h-[7rem] p-4 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-y disabled:cursor-not-allowed disabled:opacity-60"
                                  placeholder="Explain how attendee data is used, retained, and deleted on request."
                                />
                              </div>

                              <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="mb-4">
                                  <h5 className="text-sm font-semibold text-slate-900">Help & Contact</h5>
                                  <p className="mt-1 text-xs text-slate-500">
                                    Offer fallback ways to reach a human if the attendee does not want to use the web chat or needs direct support.
                                  </p>
                                </div>

                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contact Intro</label>
                                    <textarea
                                      value={settings.event_public_contact_intro}
                                      onChange={(e) => setSettings({ ...settings, event_public_contact_intro: e.target.value })}
                                      disabled={!publicContactEnabled}
                                      rows={3}
                                      className="w-full min-h-[5.5rem] rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                      placeholder="Need help from our team? Use one of these contact options."
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Messenger URL</label>
                                    <input
                                      value={settings.event_public_contact_messenger_url}
                                      onChange={(e) => setSettings({ ...settings, event_public_contact_messenger_url: e.target.value })}
                                      disabled={!publicContactEnabled}
                                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                      placeholder="https://m.me/yourpage"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">LINE URL</label>
                                    <input
                                      value={settings.event_public_contact_line_url}
                                      onChange={(e) => setSettings({ ...settings, event_public_contact_line_url: e.target.value })}
                                      disabled={!publicContactEnabled}
                                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                      placeholder="https://lin.ee/youraccount"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone</label>
                                    <input
                                      value={settings.event_public_contact_phone}
                                      onChange={(e) => setSettings({ ...settings, event_public_contact_phone: e.target.value })}
                                      disabled={!publicContactEnabled}
                                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                      placeholder="+66 8x xxx xxxx"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Support Hours</label>
                                    <input
                                      value={settings.event_public_contact_hours}
                                      onChange={(e) => setSettings({ ...settings, event_public_contact_hours: e.target.value })}
                                      disabled={!publicContactEnabled}
                                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                                      placeholder="Mon-Sat, 09:00-18:00"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
                        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                              <ExternalLink className="w-5 h-5 text-blue-600" />
                              Public Page Preview
                            </h3>
                            <p className="mt-1 text-sm text-slate-500">
                              Preview the live one-page attendee flow exactly as the public route will render it.
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                              Live URL: <span className="font-mono text-slate-700">{publicPagePreviewPath}</span>
                            </div>
                            {publicPageEnabled ? (
                              <a
                                href={publicPagePreviewPath}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Open Public Page
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-400">
                                Enable public page to publish
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                            <div className="flex items-start gap-3">
                              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
                                <QrCode className="h-5 w-5" />
                              </span>
                              <div className="min-w-0">
                                <h4 className="text-sm font-semibold text-slate-900">Public Link & QR</h4>
                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                  Download a clean QR asset for posters, handouts, or venue signage. SVG is best for print.
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Full Public URL</p>
                              <p className="mt-2 break-all font-mono text-xs leading-6 text-slate-700">{publicPageAbsoluteUrl}</p>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              <ActionButton
                                onClick={() => void copyPublicPageUrlToClipboard()}
                                tone="neutral"
                                className="px-3 text-xs"
                              >
                                {publicPageLinkCopied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                                {publicPageLinkCopied ? "Copied" : "Copy Full URL"}
                              </ActionButton>
                              <ActionButton
                                onClick={handleDownloadPublicPageQrPng}
                                disabled={!publicPageQrDataUrl}
                                tone="blue"
                                className="px-3 text-xs"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download PNG
                              </ActionButton>
                              <ActionButton
                                onClick={handleDownloadPublicPageQrSvg}
                                disabled={!publicPageQrSvgMarkup}
                                tone="neutral"
                                className="px-3 text-xs"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download SVG
                              </ActionButton>
                              {publicPageEnabled && (
                                <ActionButton
                                  onClick={() => window.open(publicPagePreviewPath, "_blank", "noopener,noreferrer")}
                                  tone="neutral"
                                  className="px-3 text-xs"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Open Page
                                </ActionButton>
                              )}
                            </div>

                            {!publicPageEnabled && (
                              <p className="mt-3 text-[11px] leading-5 text-amber-700">
                                QR can be prepared now, but the public page must be enabled before attendees can open it successfully.
                              </p>
                            )}
                            {publicPageQrError && (
                              <p className="mt-3 text-[11px] leading-5 text-rose-600">
                                {publicPageQrError}
                              </p>
                            )}
                          </div>

                          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">QR Preview</p>
                            <div className="mt-3 overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
                              {publicPageQrDataUrl ? (
                                <img
                                  src={publicPageQrDataUrl}
                                  alt={`QR code for ${publicPageAbsoluteUrl}`}
                                  className="mx-auto w-full max-w-[14rem]"
                                />
                              ) : (
                                <div className="flex aspect-square w-full items-center justify-center rounded-[1.25rem] bg-slate-50 text-slate-400">
                                  <RefreshCw className="h-6 w-6 animate-spin" />
                                </div>
                              )}
                            </div>
                            <p className="mt-3 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                              Scan to register
                            </p>
                          </div>
                        </div>

                        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4 sm:p-5">
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                              {publicPagePosterUrl ? (
                                <img
                                  src={publicPagePosterUrl}
                                  alt={settings.event_name || selectedEvent?.name || "Event poster"}
                                  className="aspect-[800/1132] w-full object-cover"
                                />
                              ) : (
                                <div className="flex aspect-[800/1132] flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
                                  <Eye className="h-8 w-8 text-slate-400" />
                                  <div>
                                    <p className="text-sm font-semibold text-slate-700">Poster Preview</p>
                                    <p className="mt-1 text-xs text-slate-500">Recommended size 800 x 1132 px</p>
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="space-y-4">
                              <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge tone={publicPageEnabled ? "emerald" : "neutral"}>
                                    {publicPageEnabled ? "Public page enabled" : "Draft mode"}
                                  </StatusBadge>
                                  {selectedEvent?.registration_availability && (
                                    <StatusBadge tone={selectedEvent.registration_availability === "open" ? "blue" : "amber"}>
                                      {getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}
                                    </StatusBadge>
                                  )}
                                </div>
                                <div>
                                  <h4 className="text-2xl font-bold tracking-tight text-slate-900">
                                    {settings.event_name || selectedEvent?.name || "Event title"}
                                  </h4>
                                  <p className="mt-2 text-sm leading-6 text-slate-600">
                                    {publicPageSummary || "Public summary will appear here. Keep it short, easy to scan, and non-technical for attendees."}
                                  </p>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Date & Time</p>
                                    <p className="mt-1 text-sm text-slate-800">{timingInfo.eventDateLabel}</p>
                                  </div>
                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Location</p>
                                    <p className="mt-1 text-sm text-slate-800">{attendeeLocationLabel || "Venue details"}</p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm">
                                    {settings.event_public_cta_label.trim() || INITIAL_SETTINGS.event_public_cta_label}
                                  </span>
                                  {publicPrivacyEnabled && (
                                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                                      <Lock className="mr-1.5 h-3.5 w-3.5" />
                                      {settings.event_public_privacy_label.trim() || INITIAL_SETTINGS.event_public_privacy_label}
                                    </span>
                                  )}
                                  {publicBotEnabled && (
                                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                                      <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                                      Ask for help
                                    </span>
                                  )}
                                  {publicContactEnabled && publicContactHasContent && (
                                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                                      <Phone className="mr-1.5 h-3.5 w-3.5" />
                                      Contact fallback
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">Inline Registration</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      One short form, ticket returned immediately on the same page, email optional as backup.
                                    </p>
                                  </div>
                                  <StatusBadge tone={publicRegistrationEnabled ? "emerald" : "neutral"}>
                                    {publicRegistrationEnabled ? "enabled" : "hidden"}
                                  </StatusBadge>
                                </div>
                                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">First name</div>
                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">Last name</div>
                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">Phone</div>
                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">Email</div>
                                </div>
                                <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50 px-4 py-4">
                                  <p className="text-sm font-semibold text-blue-900">Success state</p>
                                  <p className="mt-1 text-sm leading-6 text-blue-800">
                                    {settings.event_public_success_message.trim() || INITIAL_SETTINGS.event_public_success_message}
                                  </p>
                                </div>
                                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                  <p className="text-sm font-semibold text-slate-900">Ticket recovery</p>
                                  <p className="mt-1 text-xs leading-5 text-slate-600">
                                    {publicTicketRecoveryMode === "verified_contact"
                                      ? "Verified recovery mode. Paid events can plug OTP or order-reference verification into this slot later."
                                      : "Shared-contact mode. If one phone or email is used for multiple attendees, the public page will ask for the attendee name before releasing a ticket."}
                                  </p>
                                </div>
                                {publicPrivacyEnabled && (
                                  <p className="mt-4 text-xs leading-5 text-slate-500">
                                    <span className="font-semibold text-slate-700">{settings.event_public_privacy_label.trim() || INITIAL_SETTINGS.event_public_privacy_label}:</span>{" "}
                                    {settings.event_public_privacy_text.trim() || INITIAL_SETTINGS.event_public_privacy_text}
                                  </p>
                                )}
                                {publicContactEnabled && publicContactHasContent && (
                                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                    <p className="text-sm font-semibold text-slate-900">Help & Contact</p>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">
                                      {publicContactIntro}
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {publicContactMessengerHref && (
                                        <PublicContactActionLink href={publicContactMessengerHref} label="Messenger" kind="messenger" compact />
                                      )}
                                      {publicContactLineHref && (
                                        <PublicContactActionLink href={publicContactLineHref} label="LINE" kind="line" compact />
                                      )}
                                      {publicContactPhoneHref && (
                                        <PublicContactActionLink href={publicContactPhoneHref} label={settings.event_public_contact_phone.trim() || "Call"} kind="phone" compact />
                                      )}
                                    </div>
                                    {settings.event_public_contact_hours.trim() && (
                                      <p className="mt-3 text-xs text-slate-500">
                                        Available: <span className="font-semibold text-slate-700">{settings.event_public_contact_hours.trim()}</span>
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-3 xl:col-span-5 xl:self-start">
                  <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${
                    isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels)
                      ? "p-3 sm:p-3"
                      : "flex flex-col space-y-4 p-4 sm:p-5 xl:h-[calc(100dvh-10rem)] xl:min-h-[42rem]"
                  }`}>
                    <div className={`flex justify-between gap-3 ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels) ? "items-center" : "items-start"}`}>
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <CalendarRange className="w-5 h-5 text-blue-600" />
                          Event Workspace
                        </h3>
                        <p className="text-sm text-slate-500">Create, switch, and manage the lifecycle of event workspaces.</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <ActionButton
                          onClick={() => setEventCreateOpen((current) => !current)}
                          tone="neutral"
                          active={eventCreateOpen}
                          className="text-sm"
                        >
                          <Plus className="h-4 w-4" />
                          {eventCreateOpen ? "Close" : "New Event"}
                        </ActionButton>
                        <button
                          onClick={() => void Promise.all([fetchEvents(), fetchChannels()])}
                          disabled={eventLoading}
                          className="p-2 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                          title="Refresh events"
                        >
                          <RefreshCw className={`w-4 h-4 text-slate-500 ${eventLoading ? "animate-spin" : ""}`} />
                        </button>
                      </div>
                    </div>

                    {eventCreateOpen && (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            value={newEventName}
                            onChange={(e) => setNewEventName(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="New event name"
                          />
                          <ActionButton
                            onClick={() => void handleCreateEvent()}
                            disabled={!newEventName.trim() || eventLoading}
                            tone="blue"
                            active
                            className="w-full text-sm sm:w-auto"
                          >
                            Create Event
                          </ActionButton>
                        </div>
                      </div>
                    )}

                    <div className={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels) ? "space-y-3" : "space-y-3 xl:flex-shrink-0"}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="relative min-w-0 flex-1">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            value={eventListQuery}
                            onChange={(e) => setEventListQuery(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Search events by name, slug, or status"
                          />
                          {eventListQuery && (
                            <button
                              onClick={() => setEventListQuery("")}
                              className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                              aria-label="Clear event search"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="sm:w-56">
                          <select
                            value={eventWorkspaceSort}
                            onChange={(e) => setEventWorkspaceSort(e.target.value as EventWorkspaceSort)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            aria-label="Sort events"
                          >
                            <option value="event_start_desc">Event Start</option>
                            <option value="name_asc">Alphabetical</option>
                            <option value="modified_desc">Modified Time</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {eventWorkspaceFilterOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setEventWorkspaceFilter(option.id)}
                            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              eventWorkspaceFilter === option.id
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            <span>{option.label}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                              eventWorkspaceFilter === option.id ? "bg-white/15 text-white" : "bg-white text-slate-500"
                            }`}>
                              {option.count}
                            </span>
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span>{filteredEventWorkspaceEvents.length} matching events</span>
                        <span className="text-slate-300">•</span>
                        <span>{eventWorkspaceCounts.active + eventWorkspaceCounts.pending} active queue</span>
                        <span className="text-slate-300">•</span>
                        <span>{eventWorkspaceCounts.inactive} inactive</span>
                        <span className="text-slate-300">•</span>
                        <span>{eventWorkspaceCounts.archived} archived</span>
                        <span className="text-slate-300">•</span>
                        <span>{eventWorkspaceCounts.closed + eventWorkspaceCounts.cancelled} in history</span>
                      </div>
                    </div>

                    <div className={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels) ? "space-y-5" : "min-h-0 flex-1 space-y-5 overflow-y-auto pr-1"}>
                      {filteredEventWorkspaceEvents.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                          {deferredEventListQuery
                            ? "No events match this search."
                            : eventWorkspaceFilter === "all"
                            ? "No event workspaces yet."
                            : "No events for this lifecycle yet."}
                        </div>
                      ) : (
                        <>
                          {filteredWorkingEvents.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-700">{liveWorkspaceHeading}</p>
                                <span className="text-xs font-medium text-slate-500">{filteredWorkingEvents.length} events</span>
                              </div>
                              <div className="space-y-2">
                                {filteredWorkingEvents.map((event) => (
                                  <EventWorkspaceRow
                                    key={event.id}
                                    event={event}
                                    selected={selectedEventId === event.id}
                                    searchFocused={isSearchFocused("event", event.id)}
                                    onSelect={() => handleSelectEvent(event.id)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {filteredInactiveEvents.length > 0 && (
                            <div className="space-y-2 border-t border-slate-100 pt-5">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-700">{inactiveWorkspaceHeading}</p>
                                <span className="text-xs font-medium text-slate-500">{filteredInactiveEvents.length} events</span>
                              </div>
                              <div className="space-y-2">
                                {filteredInactiveEvents.map((event) => (
                                  <EventWorkspaceRow
                                    key={event.id}
                                    event={event}
                                    selected={selectedEventId === event.id}
                                    searchFocused={isSearchFocused("event", event.id)}
                                    onSelect={() => handleSelectEvent(event.id)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {filteredArchivedEvents.length > 0 && (
                            <div className="space-y-2 border-t border-slate-100 pt-5">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-700">{archivedWorkspaceHeading}</p>
                                <span className="text-xs font-medium text-slate-500">{filteredArchivedEvents.length} events</span>
                              </div>
                              <div className="space-y-2">
                                {filteredArchivedEvents.map((event) => (
                                  <EventWorkspaceRow
                                    key={event.id}
                                    event={event}
                                    selected={selectedEventId === event.id}
                                    searchFocused={isSearchFocused("event", event.id)}
                                    onSelect={() => handleSelectEvent(event.id)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {recentHistoricalEvents.length > 0 && (
                            <div className="space-y-2 border-t border-slate-100 pt-5">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-700">{historyWorkspaceHeading}</p>
                                <span className="text-xs font-medium text-slate-500">{recentHistoricalEvents.length} events</span>
                              </div>
                              <div className="space-y-2">
                                {recentHistoricalEvents.map((event) => (
                                  <EventWorkspaceRow
                                    key={event.id}
                                    event={event}
                                    selected={selectedEventId === event.id}
                                    searchFocused={isSearchFocused("event", event.id)}
                                    onSelect={() => handleSelectEvent(event.id)}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {historyEventGroups.length > 0 && (
                            <div className="space-y-2 border-t border-slate-100 pt-5">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-700">History by Month</p>
                                <span className="text-xs font-medium text-slate-500">{historyEventGroups.length} groups</span>
                              </div>
                              <div className="space-y-2">
                                {historyEventGroups.map((group) => {
                                  const open = Boolean(deferredEventListQuery) || eventHistoryOpenKeys.includes(group.key);
                                  return (
                                    <div key={group.key} className="rounded-2xl border border-slate-200 bg-slate-50">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEventHistoryOpenKeys((current) =>
                                            current.includes(group.key)
                                              ? current.filter((item) => item !== group.key)
                                              : [...current, group.key],
                                          )
                                        }
                                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                                      >
                                        <div>
                                          <p className="text-sm font-semibold text-slate-700">{group.label}</p>
                                          <p className="text-xs text-slate-500">{group.events.length} events</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-medium text-slate-500">{group.events.length} events</span>
                                          {!deferredEventListQuery && (
                                            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
                                          )}
                                        </div>
                                      </button>
                                      {open && (
                                        <div className="space-y-2 border-t border-slate-200 p-2">
                                          {group.events.map((event) => (
                                            <EventWorkspaceRow
                                              key={event.id}
                                              event={event}
                                              selected={selectedEventId === event.id}
                                              searchFocused={isSearchFocused("event", event.id)}
                                              onSelect={() => handleSelectEvent(event.id)}
                                            />
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                  </div>

                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "mail" && (
            <motion.div
              key="mail"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Send className="w-5 h-5 text-blue-600" />
                        Event Mail
                      </h3>
                      <HelpPopover label="Open note for Event Mail">
                        Sender identity comes from Railway environment variables. This workspace manages per-event transactional templates, readiness checks, and test sends.
                      </HelpPopover>
                      <StatusBadge tone={settings.confirmation_email_enabled === "1" ? "emerald" : "neutral"}>
                        {settings.confirmation_email_enabled === "1" ? "registration email on" : "registration email off"}
                      </StatusBadge>
                      <StatusBadge tone={emailReadinessTone}>{emailReadinessLabel}</StatusBadge>
                    </div>
                    <StatusLine
                      className="mt-1"
                      items={[
                        emailStatus?.provider ? <>Provider {emailStatus.provider}</> : "Provider resend",
                        eventMailDirty ? "Unsaved changes" : "All changes saved",
                      ]}
                    />
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                    <ActionButton
                      onClick={() => void saveEventMailSettings()}
                      disabled={saving}
                      tone="blue"
                      active
                      className="w-full text-sm sm:w-auto sm:shrink-0"
                    >
                      {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save Mail
                    </ActionButton>
                  </div>
                </div>

                {(eventMessage || settingsMessage) && (
                  <div className="mb-4 space-y-1">
                    {eventMessage && (
                      <p className={`text-xs ${eventMessage.toLowerCase().includes("failed") || eventMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                        {eventMessage}
                      </p>
                    )}
                    {settingsMessage && (
                      <p className={`text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                        {settingsMessage}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[360px_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">Delivery Controls</p>
                            <HelpPopover label="Open note for Delivery Controls">
                              Sender, reply-to, provider, and app URL come from environment config. This card only controls per-event delivery behavior and status checks.
                            </HelpPopover>
                            <StatusBadge tone={emailReadinessTone}>{emailReadinessLabel}</StatusBadge>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void fetchEmailStatus(selectedEventId)}
                          disabled={!selectedEventId || emailStatusLoading}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {emailStatusLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Refresh
                        </button>
                      </div>
                      <label className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          checked={settings.confirmation_email_enabled === "1"}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              confirmation_email_enabled: e.target.checked ? "1" : "0",
                            })
                          }
                        />
                        Enable registration confirmation email
                      </label>
                      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-1">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Sender</p>
                          <p className="mt-1 break-all text-xs text-slate-700">{emailStatus?.fromAddress || "Not set"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Reply-To</p>
                          <p className="mt-1 break-all text-xs text-slate-700">{emailStatus?.replyToAddress || "Not set"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Provider</p>
                          <p className="mt-1 text-xs text-slate-700">{emailStatus?.provider || "resend"}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">App URL</p>
                          <p className="mt-1 break-all text-xs text-slate-700">{emailStatus?.appUrl || "Not set"}</p>
                        </div>
                      </div>
                      {emailStatus?.errorMessage && (
                        <p className="mt-3 text-xs text-rose-600">{emailStatus.errorMessage}</p>
                      )}
                      {emailStatus?.missingFields?.length ? (
                        <p className="mt-2 text-[11px] text-amber-700">
                          Missing: {emailStatus.missingFields.join(", ")}
                        </p>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">Send Test Email</p>
                        <HelpPopover label="Open note for Send Test Email">
                          Sends the currently selected mail type with the selected event&apos;s sample data and current sender configuration.
                        </HelpPopover>
                      </div>
                      <div className="mt-4 flex flex-col gap-3">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 mb-1">Destination</label>
                          <input
                            type="email"
                            value={emailTestAddress}
                            onChange={(e) => setEmailTestAddress(e.target.value)}
                            placeholder="you@example.com"
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSendTestEmail()}
                          disabled={!selectedEventId || !emailTestAddress.trim() || emailTestSending}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {emailTestSending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Send {emailTemplateDefinition.label} Test
                        </button>
                      </div>
                      {emailTestMessage && (
                        <p className={`mt-3 text-xs ${emailTestMessage.toLowerCase().includes("failed") || emailTestMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-slate-600"}`}>
                          {emailTestMessage}
                        </p>
                      )}
                      {emailStatus?.lastTestResult && (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                          <p className="font-semibold text-slate-800">Last test result</p>
                          <p className="mt-1">{EMAIL_TEMPLATE_DEFAULTS[emailStatus.lastTestResult.kind].label}</p>
                          <p className="mt-1 break-all">
                            {emailStatus.lastTestResult.success ? "Sent" : "Failed"} to {emailStatus.lastTestResult.to}
                          </p>
                          <p className="mt-1">
                            {new Date(emailStatus.lastTestResult.attemptedAt).toLocaleString()}
                          </p>
                          {emailStatus.lastTestResult.error && (
                            <p className="mt-1 text-rose-600">{emailStatus.lastTestResult.error}</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">Mail Types</p>
                        <HelpPopover label="Open note for Mail Types">
                          <div className="space-y-2">
                            {EMAIL_TEMPLATE_KIND_OPTIONS.map((option) => (
                              <p key={option.kind}>
                                <span className="font-semibold text-slate-800">{option.label}</span>
                                <span className="block">{option.description}</span>
                              </p>
                            ))}
                            <p>Default uses the built-in template. Custom means this event has its own saved subject, HTML, or text.</p>
                          </div>
                        </HelpPopover>
                        <StatusBadge tone={emailTemplateDirty ? "amber" : "neutral"}>
                          {emailTemplateDirty ? "Template edits pending" : "Templates saved"}
                        </StatusBadge>
                      </div>
                      <div className="mt-4 space-y-2">
                        {EMAIL_TEMPLATE_KIND_OPTIONS.map((option) => {
                          const selected = option.kind === selectedEmailTemplateKind;
                          const dirty = isEmailTemplateKindDirty(option.kind);
                          const custom = hasCustomEmailTemplateOverride(settings, option.kind);
                          return (
                            <button
                              key={option.kind}
                              type="button"
                              onClick={() => setSelectedEmailTemplateKind(option.kind)}
                              className={`flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                                selected
                                  ? "border-blue-200 bg-blue-50"
                                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                              }`}
                            >
                              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${selected ? "bg-blue-500" : dirty ? "bg-amber-400" : "bg-slate-200"}`} aria-hidden />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className={`text-sm font-semibold ${selected ? "text-blue-700" : "text-slate-900"}`}>{option.label}</p>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                    custom
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-slate-100 text-slate-600"
                                  }`}>
                                    {custom ? "custom" : "default"}
                                  </span>
                                  {dirty && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">edited</span>}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">{emailTemplateDefinition.label} Template</p>
                            <HelpPopover label={`Open note for ${emailTemplateDefinition.label} template`}>
                              <p>{emailTemplateDefinition.description}</p>
                              <p className="mt-2 font-semibold text-slate-800">Supported tokens</p>
                              <p className="mt-1 break-words">{emailTemplateDefinition.supportedTokens.map((token) => `{{${token}}}`).join(", ")}</p>
                              <p className="mt-2">Default uses the built-in template until this event saves its own subject, HTML, or text.</p>
                            </HelpPopover>
                            <StatusBadge tone={selectedEmailTemplateDirty ? "amber" : "neutral"}>
                              {selectedEmailTemplateDirty ? "Unsaved" : "Saved"}
                            </StatusBadge>
                            <StatusBadge tone={selectedEmailTemplateIsCustom ? "blue" : "neutral"}>
                              {selectedEmailTemplateIsCustom ? "custom" : "default"}
                            </StatusBadge>
                          </div>
                        </div>
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
                          <ActionButton
                            onClick={() => setSettings(resetEmailTemplateToDefault(settings, selectedEmailTemplateKind))}
                            disabled={!selectedEmailTemplateIsCustom}
                            tone="neutral"
                            className="w-full text-sm sm:w-auto"
                          >
                            Reset to Default
                          </ActionButton>
                        </div>
                      </div>
                      <div className="mt-4 space-y-4">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 mb-1">Subject</label>
                          <input
                            value={selectedEmailTemplateSubject}
                            onChange={(e) => setSettings(updateEmailTemplateValue(settings, selectedEmailTemplateKind, "subject", e.target.value))}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <EmailHtmlEditor
                          value={selectedEmailTemplateHtml}
                          renderedPreviewHtml={renderedEmailPreviewHtml}
                          supportedTokens={emailTemplateDefinition.supportedTokens}
                          onChange={(nextHtml) => setSettings(updateEmailTemplateValue(settings, selectedEmailTemplateKind, "html", nextHtml))}
                        />
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 mb-1">Plain Text Body</label>
                          <textarea
                            value={selectedEmailTemplateText}
                            onChange={(e) => setSettings(updateEmailTemplateValue(settings, selectedEmailTemplateKind, "text", e.target.value))}
                            rows={10}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Rendered Subject</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">{renderedEmailPreviewSubject}</p>
                      <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Rendered Text Preview</p>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-600">{renderedEmailPreviewText}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "design" && (
            <motion.div
              key="design"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">Context</h2>
                  {selectedEvent && (
                    <StatusBadge tone={getEventStatusTone(selectedEvent.effective_status)}>
                      {getEventStatusLabel(selectedEvent.effective_status)}
                    </StatusBadge>
                  )}
                </div>
                <StatusLine
                  className="mt-1"
                  items={[
                    "Context note",
                    "Knowledge base",
                    "Retrieval tools",
                    eventContextDirty ? "Unsaved changes" : "Saved",
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
                <div className="space-y-3 xl:col-span-7">
                  <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent) ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
                    <div className={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent) ? "mb-0" : "mb-3"} space-y-2`}>
                      <div className={`flex flex-col gap-2 lg:flex-row lg:justify-between ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent) ? "lg:items-center" : "lg:items-start"}`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold">Event Context</h2>
                            {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent) && (
                              <HelpPopover label="Open note for Event Context">
                                Per-event FAQ, source text, and response guidance for the selected workspace.
                              </HelpPopover>
                            )}
                          </div>
                          <StatusLine items={[eventContextDirty ? "Unsaved changes" : "All changes saved"]} />
                        </div>
                        <div className="flex w-full items-stretch gap-2 sm:w-auto lg:justify-end">
                          {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent) && (
                            <>
                              <ActionButton
                                onClick={() => void saveEventContext()}
                                disabled={saving || !canManageKnowledge}
                                tone="blue"
                                active
                                className="min-w-0 flex-1 text-sm sm:flex-none"
                              >
                                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save Event Context
                              </ActionButton>
                              <div className="relative shrink-0" ref={knowledgeActionsRef}>
                                <ActionButton
                                  onClick={() => setKnowledgeActionsOpen((open) => !open)}
                                  disabled={knowledgeResetting || saving || !selectedEventId || !canManageKnowledge}
                                  tone="rose"
                                  className="min-h-full min-w-[3rem] px-3 text-sm"
                                  aria-expanded={knowledgeActionsOpen}
                                  aria-haspopup="menu"
                                >
                                  {knowledgeResetting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                                  <span className="sr-only sm:not-sr-only">Danger</span>
                                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${knowledgeActionsOpen ? "rotate-180" : ""}`} />
                                </ActionButton>
                                {knowledgeActionsOpen && (
                                  <div className="app-overlay-surface absolute right-0 top-full z-20 mt-2 w-[min(18rem,calc(100vw-2.5rem))] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                                    <button
                                      onClick={() => {
                                        setKnowledgeActionsOpen(false);
                                        void handleResetEventKnowledge(false);
                                      }}
                                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-amber-700 transition-colors hover:bg-amber-50"
                                      role="menuitem"
                                    >
                                      <AlertCircle className="h-4 w-4 shrink-0" />
                                      <span className="font-medium">Clear Knowledge Docs</span>
                                    </button>
                                    <button
                                      onClick={() => {
                                        setKnowledgeActionsOpen(false);
                                        void handleResetEventKnowledge(true);
                                      }}
                                      className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-rose-700 transition-colors hover:bg-rose-50"
                                      role="menuitem"
                                    >
                                      <AlertCircle className="h-4 w-4 shrink-0" />
                                      <span className="font-medium">Reset All Knowledge</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                          <CollapseIconButton
                            collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent)}
                            onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent)}
                          />
                        </div>
                      </div>
                    </div>
                    {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent) && (
                      <>
                        <textarea
                          rows={10}
                          value={settings.context}
                          onChange={(e) => setSettings({ ...settings, context: e.target.value })}
                          className="w-full min-h-[16rem] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm resize-y"
                          placeholder="Event-specific FAQ, speaker details, agenda, venue notes, policies, etc."
                        />
                        {settingsMessage && (
                          <p className={`mt-3 text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                            {settingsMessage}
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments) ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
                    <div className={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments) ? "mb-0" : "mb-3"} flex flex-col gap-2 sm:flex-row sm:justify-between ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments) ? "sm:items-center" : "sm:items-start"}`}>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold">Knowledge Documents</h3>
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments) && (
                          <HelpPopover label="Open note for Knowledge Documents">
                            Attach reusable notes, FAQ fragments, policy text, URLs, or import text-based files into the selected event.
                          </HelpPopover>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments) && (
                          <>
                            <input
                              ref={documentFileInputRef}
                              type="file"
                              accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.xml,text/plain,text/markdown,text/csv,application/json,application/xml,text/html"
                              className="hidden"
                              onChange={(e) => void handleImportDocumentFile(e.target.files?.[0] || null)}
                            />
                            <ActionButton
                              onClick={() => documentFileInputRef.current?.click()}
                              disabled={documentsLoading}
                              tone="neutral"
                              className="text-sm"
                            >
                              Import File
                            </ActionButton>
                            {editingDocumentId && (
                              <ActionButton
                                onClick={resetDocumentForm}
                                tone="neutral"
                                className="text-sm"
                              >
                                Cancel Edit
                              </ActionButton>
                            )}
                          </>
                        )}
                        <CollapseIconButton
                          collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments)}
                          onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments)}
                        />
                      </div>
                    </div>

                    {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments) && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Title</label>
                            <input
                              value={documentTitle}
                              onChange={(e) => setDocumentTitle(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="e.g. Venue parking rules"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Source Type</label>
                            <select
                              value={documentSourceType}
                              onChange={(e) => setDocumentSourceType(e.target.value as "note" | "document" | "url")}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="note">Note</option>
                              <option value="document">Document</option>
                              <option value="url">URL</option>
                            </select>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Source URL (Optional)</label>
                            <input
                              value={documentSourceUrl}
                              onChange={(e) => setDocumentSourceUrl(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="https://example.com/reference"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Document Content</label>
                            <textarea
                              rows={7}
                              value={documentContent}
                              onChange={(e) => setDocumentContent(e.target.value)}
                              className="w-full min-h-[11rem] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm resize-y"
                              placeholder="Paste FAQ answers, rules, agenda details, speaker notes, or any event-specific reference content here."
                            />
                          </div>
                        </div>

                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                          <ActionButton
                            onClick={() => void handleSaveDocument()}
                            disabled={!selectedEventId || documentsLoading || !documentTitle.trim() || !documentContent.trim()}
                            tone="blue"
                            active
                            className="w-full text-sm sm:w-auto"
                          >
                            {documentsLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {editingDocumentId ? "Update Document" : "Save Document"}
                          </ActionButton>
                          <p className="text-xs text-slate-500">
                            Imported text is chunked after save so the same document store stays clean and reusable.
                          </p>
                        </div>

                        {documentsMessage && (
                          <p className={`mt-3 text-xs ${documentsMessage.toLowerCase().includes("failed") || documentsMessage.toLowerCase().includes("error") || documentsMessage.toLowerCase().includes("required") ? "text-rose-600" : "text-emerald-600"}`}>
                            {documentsMessage}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-3 xl:col-span-5">
                  <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments) ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
                    <div className={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments) ? "mb-0 items-center" : "mb-2.5 items-start"} flex justify-between gap-2`}>
                      <button
                        type="button"
                        onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments)}
                        className="min-w-0 flex-1 text-left"
                        aria-label={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments) ? "Expand" : "Collapse"} Attached Documents`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold">Attached Documents</h3>
                          <span className="text-xs font-medium text-slate-500">{filteredDocuments.length}</span>
                        </div>
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments) && (
                          <p className="mt-1 text-xs text-slate-500">Only active documents are used during retrieval.</p>
                        )}
                      </button>
                      <div className="flex items-center gap-2">
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments) && (
                          <HelpPopover label="Open note for Attached Documents">
                            Only active documents are used during retrieval.
                          </HelpPopover>
                        )}
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments) && (
                          <button
                            onClick={() => void fetchDocuments(selectedEventId)}
                            disabled={documentsLoading || !selectedEventId}
                            className="rounded-xl p-2 transition-colors hover:bg-slate-100 disabled:opacity-50"
                            title="Refresh documents"
                          >
                            <RefreshCw className={`w-4 h-4 text-slate-500 ${documentsLoading ? "animate-spin" : ""}`} />
                          </button>
                        )}
                        <CollapseIconButton
                          collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments)}
                          onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments)}
                        />
                      </div>
                    </div>

                    {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments) && (
                      <>
                        <div className="mb-3 relative">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            value={documentListQuery}
                            onChange={(e) => setDocumentListQuery(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Search documents by title, content, source, or status"
                          />
                          {documentListQuery && (
                            <button
                              onClick={() => setDocumentListQuery("")}
                              className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                              aria-label="Clear document search"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="space-y-3">
                          {filteredDocuments.length === 0 && (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                              {deferredDocumentListQuery ? "No documents match this search." : "No documents attached to this event yet."}
                            </div>
                          )}
                          {filteredDocuments.map((document) => {
                            const documentCollapsed = isContextDocumentCollapsed(document.id);
                            return (
                              <div
                                key={document.id}
                                id={getSearchTargetDomId("document", document.id)}
                                className={`rounded-2xl border p-4 ${
                                  documentCollapsed ? "space-y-0" : "space-y-3"
                                } ${
                                  selectedDocumentForChunksId === document.id
                                    ? "border-blue-200 bg-blue-50"
                                    : "border-slate-200 bg-slate-50"
                                } ${
                                  isSearchFocused("document", document.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""
                                }`}
                              >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-900 truncate">{document.title}</p>
                                    <StatusLine
                                      className="mt-2"
                                      items={[
                                        document.source_type,
                                        `${document.chunk_count || 0} chunks`,
                                        document.is_active ? "Active" : "Inactive",
                                        `Embed ${document.embedding_status || "pending"}`,
                                      ]}
                                    />
                                    {selectedDocumentForChunksId === document.id && <SelectionMarker className="mt-1" />}
                                  </div>
                                  <CollapseIconButton
                                    collapsed={documentCollapsed}
                                    onClick={() => toggleContextDocumentCollapsed(document.id)}
                                    label="document"
                                    className="self-start"
                                  />
                                </div>
                                {!documentCollapsed && (
                                  <>
                                    <p className="text-sm text-slate-600 whitespace-pre-wrap">
                                      {document.content.length > 180 ? `${document.content.slice(0, 180)}...` : document.content}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <ActionButton
                                        onClick={() => loadDocumentIntoForm(document)}
                                        tone="neutral"
                                        className="px-3"
                                      >
                                        <PencilLine className="h-3.5 w-3.5" />
                                        Edit
                                      </ActionButton>
                                      <InlineActionsMenu
                                        label="Actions"
                                        tone={document.is_active ? "amber" : "neutral"}
                                      >
                                        <MenuActionItem
                                          onClick={() => selectDocumentForChunks(document.id)}
                                          tone={selectedDocumentForChunksId === document.id ? "blue" : "neutral"}
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                          <span className="font-medium">
                                            {selectedDocumentForChunksId === document.id ? "Viewing Chunks" : "View Chunks"}
                                          </span>
                                        </MenuActionItem>
                                        {document.source_url && (
                                          <MenuActionLink
                                            href={document.source_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            tone="neutral"
                                            className="mt-1"
                                          >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            <span className="font-medium">Open Source URL</span>
                                          </MenuActionLink>
                                        )}
                                        <MenuActionItem
                                          onClick={() => void handleDocumentStatusToggle(document.id, document.is_active)}
                                          disabled={documentsLoading}
                                          tone={document.is_active ? "amber" : "emerald"}
                                          className="mt-1"
                                        >
                                          <Power className="h-3.5 w-3.5" />
                                          <span className="font-medium">
                                            {document.is_active ? "Disable Document" : "Enable Document"}
                                          </span>
                                        </MenuActionItem>
                                      </InlineActionsMenu>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  <div className={`rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector) ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
                    <div className={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector) ? "mb-0" : "mb-2"} flex items-center justify-between gap-2`}>
                      <button
                        type="button"
                        onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector)}
                        className="min-w-0 flex-1 text-left"
                        aria-label={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector) ? "Expand" : "Collapse"} Chunk Inspector`}
                      >
                        <h3 className="font-semibold text-slate-900">Chunk Inspector</h3>
                      </button>
                      <div className="flex items-center gap-2">
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector) && (
                          <HelpPopover label="Open note for Chunk Inspector">
                            Preview the exact chunks available for retrieval from the selected document.
                          </HelpPopover>
                        )}
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector) && selectedDocumentForChunks && (
                          <button
                            onClick={() => void fetchDocumentChunks(selectedDocumentForChunks.id, selectedEventId)}
                            disabled={documentChunksLoading}
                            className="rounded-xl p-2 transition-colors hover:bg-slate-200 disabled:opacity-50"
                            title="Refresh chunks"
                          >
                            <RefreshCw className={`w-4 h-4 text-slate-500 ${documentChunksLoading ? "animate-spin" : ""}`} />
                          </button>
                        )}
                        <CollapseIconButton
                          collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector)}
                          onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector)}
                        />
                      </div>
                    </div>

                    {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector) && (
                      <>
                        {!selectedDocumentForChunks ? (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500">
                            Select a document to inspect its chunks.
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <p className="font-semibold text-slate-900">{selectedDocumentForChunks.title}</p>
                              <StatusLine
                                className="mt-2"
                                items={[
                                  selectedDocumentForChunks.source_type,
                                  `${selectedDocumentForChunks.chunk_count || 0} chunks`,
                                  selectedDocumentForChunks.is_active ? "active" : "inactive",
                                  `embed ${selectedDocumentForChunks.embedding_status || "pending"}`,
                                ]}
                              />
                            </div>

                            <div className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
                              {documentChunksLoading && (
                                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">
                                  Loading chunks...
                                </div>
                              )}
                              {!documentChunksLoading && documentChunks.length === 0 && (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
                                  No chunks generated for this document yet.
                                </div>
                              )}
                              {!documentChunksLoading && documentChunks.map((chunk) => (
                                <div key={chunk.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                    Chunk {chunk.chunk_index + 1}
                                  </p>
                                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{chunk.content}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                  </div>

                  <div className={`rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview) ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
                    <div className={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview) ? "mb-0" : "mb-2"} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
                      <button
                        type="button"
                        onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview)}
                        className="min-w-0 flex-1 text-left"
                        aria-label={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview) ? "Expand" : "Collapse"} Embedding Preview`}
                      >
                        <h3 className="font-semibold text-slate-900">Embedding Preview</h3>
                      </button>
                      <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview) && (
                          <HelpPopover label="Open note for Embedding Preview">
                            Vector-ready metadata and hook payload for the selected document.
                          </HelpPopover>
                        )}
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview) && selectedDocumentForChunks && (
                          <div className="flex w-full items-center gap-2 sm:w-auto">
                            <ActionButton
                              onClick={() => void handleEnqueueEmbedding(selectedDocumentForChunks.id, selectedEventId)}
                              disabled={embeddingPreviewLoading || embeddingEnqueueLoading}
                              tone="neutral"
                              active
                              className="min-w-0 flex-1 text-sm sm:flex-none"
                            >
                              {(embeddingPreviewLoading || embeddingEnqueueLoading) ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                              Queue Embedding
                            </ActionButton>
                            <button
                              onClick={() => void fetchEmbeddingPreview(selectedDocumentForChunks.id, selectedEventId)}
                              disabled={embeddingPreviewLoading || embeddingEnqueueLoading}
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl p-2 transition-colors hover:bg-slate-200 disabled:opacity-50"
                              title="Refresh embedding preview"
                            >
                              <RefreshCw className={`w-4 h-4 text-slate-500 ${embeddingPreviewLoading ? "animate-spin" : ""}`} />
                            </button>
                          </div>
                        )}
                        <CollapseIconButton
                          collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview)}
                          onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview)}
                        />
                      </div>
                    </div>

                    {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview) && (
                      <>
                        {!selectedDocumentForChunks ? (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500">
                            Select a document to inspect its vector-ready metadata.
                          </div>
                        ) : (
                          <div className="min-w-0 space-y-3">
                            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
                              หลังจาก queue สำเร็จ worker จะสร้าง embeddings และเก็บ vectors ไว้ในระบบนี้ก่อน ทำให้ retrieval ใช้ cosine similarity
                              ร่วมกับ keyword ranking ได้จริง ส่วน
                              {" "}
                              <span className="font-semibold">Queue Embedding</span>
                              {" "}
                              ยังสามารถส่ง payload ไปที่
                              {" "}
                              <span className="font-mono">EMBEDDING_HOOK_URL</span>
                              {" "}
                              เพิ่มเติมได้ถ้าต้องการ sync ออกระบบภายนอก
                            </div>

                            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                              <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
                                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Document Embedding State</p>
                                <div className="space-y-2 text-sm">
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                    <span className="text-slate-600">Embedding model</span>
                                    <span className="self-start text-xs font-medium text-slate-700 sm:self-auto">
                                      {embeddingPreview?.embedding_model || "text-embedding-3-small"}
                                    </span>
                                  </div>
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                    <span className="text-slate-600">Document status</span>
                                    <span className="self-start text-xs font-medium text-slate-700 sm:self-auto">
                                      {embeddingPreview?.document.embedding_status || selectedDocumentForChunks.embedding_status || "pending"}
                                    </span>
                                  </div>
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                    <span className="text-slate-600">Document content hash</span>
                                    <span className="w-full min-w-0 break-all text-left text-xs font-mono text-slate-500 sm:max-w-[14rem] sm:text-right">
                                      {embeddingPreview?.document.content_hash || selectedDocumentForChunks.content_hash || "-"}
                                    </span>
                                  </div>
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                    <span className="text-slate-600">Chunk count</span>
                                    <span className="self-start text-xs font-medium text-slate-700 sm:self-auto">
                                      {embeddingPreview?.chunks.length ?? selectedDocumentForChunks.chunk_count ?? 0}
                                    </span>
                                  </div>
                                </div>
                                {embeddingPreviewMessage && (
                                  <p className={`mt-3 text-xs ${embeddingPreviewMessage.toLowerCase().includes("failed") || embeddingPreviewMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-slate-500"}`}>
                                    {embeddingPreviewMessage}
                                  </p>
                                )}
                              </div>

                              <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
                                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Chunk Metadata</p>
                                <div className="max-h-[14rem] space-y-2 overflow-y-auto overflow-x-hidden pr-1">
                                  {embeddingPreviewLoading && (
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                                      Loading embedding preview...
                                    </div>
                                  )}
                                  {!embeddingPreviewLoading && !embeddingPreview?.chunks.length && (
                                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                                      No chunks available for embedding yet.
                                    </div>
                                  )}
                                  {!embeddingPreviewLoading && embeddingPreview?.chunks.map((chunk) => (
                                    <div key={chunk.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                      <StatusLine
                                        className="mb-2"
                                        items={[
                                          <>chunk {chunk.chunk_index + 1}</>,
                                          `${chunk.char_count || chunk.content.length} chars`,
                                          `~${chunk.token_estimate || 0} tokens`,
                                          chunk.embedding_status || "pending",
                                        ]}
                                      />
                                      <p className="break-all text-xs font-mono text-slate-500">{chunk.content_hash || "-"}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
                              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Embedding Hook Payload</p>
                              <div className="max-h-[22rem] overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <pre className="whitespace-pre-wrap break-all text-xs font-mono text-slate-700">
                                  {embeddingPreview ? JSON.stringify(embeddingPreview.payload, null, 2) : "Select a document to preview the embedding payload."}
                                </pre>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className={`rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-600 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug) ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
                    <div className={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug) ? "mb-0" : "mb-2"} flex items-center justify-between gap-2`}>
                      <button
                        type="button"
                        onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug)}
                        className="min-w-0 flex-1 text-left"
                        aria-label={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug) ? "Expand" : "Collapse"} Retrieval Debug`}
                      >
                        <h3 className="font-semibold text-slate-900">Retrieval Debug</h3>
                      </button>
                      <div className="flex items-center gap-2">
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug) && (
                          <HelpPopover label="Open note for Retrieval Debug">
                            Inspect which event chunks this workspace would send into the prompt for a specific question.
                          </HelpPopover>
                        )}
                        <CollapseIconButton
                          collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug)}
                          onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug)}
                        />
                      </div>
                    </div>

                    {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug) && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr,0.9fr]">
                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Test Query
                            </label>
                            <textarea
                              value={retrievalQuery}
                              onChange={(e) => setRetrievalQuery(e.target.value)}
                              rows={2}
                              placeholder="Example: งานนี้จัดที่ไหน เดินทางยังไง และเปิดลงทะเบียนถึงวันไหน"
                              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <div className="mt-3 flex items-center gap-2">
                              <ActionButton
                                onClick={() => void fetchRetrievalDebug()}
                                disabled={!selectedEventId || retrievalLoading || !retrievalQuery.trim()}
                                tone="neutral"
                                active
                                className="text-sm"
                              >
                                {retrievalLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                Analyze Retrieval
                              </ActionButton>
                              {retrievalDebug && (
                                <span className="text-xs text-slate-500">
                                  Event-scoped results for <span className="font-semibold text-slate-700">{selectedEvent?.name || "selected event"}</span>
                                </span>
                              )}
                            </div>
                            {retrievalMessage && (
                              <p className={`mt-3 text-xs ${retrievalMessage.toLowerCase().includes("failed") || retrievalMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-amber-700"}`}>
                                {retrievalMessage}
                              </p>
                            )}
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Prompt Layers
                            </p>
                            <div className="space-y-2 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Retrieval mode</span>
                                <span className="text-xs font-medium text-slate-700">
                                  {retrievalDebug?.layers.retrieval_mode || "lexical"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Global system prompt</span>
                                <span className="text-xs font-medium text-slate-700">
                                  {retrievalDebug?.layers.global_system_prompt_present ? `${retrievalDebug.layers.global_system_prompt_chars} chars` : "empty"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Event context</span>
                                <span className="text-xs font-medium text-slate-700">
                                  {retrievalDebug?.layers.event_context_present ? `${retrievalDebug.layers.event_context_chars} chars` : "empty"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Active documents</span>
                                <span className="text-xs font-medium text-slate-700">
                                  {retrievalDebug?.layers.active_document_count ?? documents.filter((document) => document.is_active).length}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Active chunks</span>
                                <span className="text-xs font-medium text-slate-700">
                                  {retrievalDebug?.layers.active_chunk_count ?? documentChunks.length}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Vector-ready chunks</span>
                                <span className="text-xs font-medium text-slate-700">
                                  {retrievalDebug?.layers.vector_ready_chunk_count ?? 0}
                                </span>
                              </div>
                              {retrievalDebug?.layers.query_embedding_model && (
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-slate-600">Query embedding model</span>
                                  <span className="text-xs font-medium text-slate-700">
                                    {retrievalDebug.layers.query_embedding_model}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {retrievalDebug && (
                          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr,0.9fr]">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Matched Chunks</p>
                                  <p className="text-xs text-slate-500">Top ranked event chunks for this query.</p>
                                </div>
                                <span className="text-xs font-medium text-slate-700">
                                  {retrievalDebug.matches.length} matches
                                </span>
                              </div>

                              <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                                {retrievalDebug.matches.length === 0 && (
                                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                                    No ranked chunks for this query. The bot will answer from global rules and event context only.
                                  </div>
                                )}
                                {retrievalDebug.matches.map((match) => (
                                  <div key={`${match.document_id}:${match.chunk_index}:${match.rank}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <StatusLine
                                      className="mb-3"
                                      items={[
                                        <>#{match.rank}</>,
                                        `score ${match.score.toFixed(2)}`,
                                        match.strategy || null,
                                        typeof match.vector_score === "number" ? `vector ${match.vector_score.toFixed(2)}` : null,
                                        typeof match.lexical_score === "number" ? `lexical ${match.lexical_score}` : null,
                                        match.source_type,
                                        `chunk ${match.chunk_index + 1}`,
                                      ]}
                                    />
                                    <p className="font-semibold text-slate-900">{match.document_title}</p>
                                    {match.source_url && (
                                      <a
                                        href={match.source_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        Open source URL
                                      </a>
                                    )}
                                    <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{match.chunk_content}</p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                                Injected Knowledge Context
                              </p>
                              <div className="max-h-[26rem] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <pre className="whitespace-pre-wrap text-xs font-mono text-slate-700">
                                  {retrievalDebug.composed_knowledge_context || "No knowledge context was composed for this query."}
                                </pre>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextLlmUsage) ? "p-2.5 sm:p-3" : "p-3 sm:p-4"}`}>
                    <div className={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextLlmUsage) ? "mb-0 items-center" : "mb-3 items-start"} flex flex-col gap-2 sm:flex-row sm:justify-between`}>
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Activity className="w-5 h-5 text-blue-600" />
                          LLM Usage
                        </h3>
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextLlmUsage) && (
                          <p className="text-sm text-slate-500">Track token burn and estimated spend per event before turning this into credits.</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextLlmUsage) && (
                          <button
                            onClick={() => void fetchLlmUsageSummary(selectedEventId)}
                            disabled={llmUsageLoading}
                            className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                            title="Refresh LLM usage"
                          >
                            <RefreshCw className={`h-4 w-4 ${llmUsageLoading ? "animate-spin" : ""}`} />
                          </button>
                        )}
                        <CollapseIconButton
                          collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextLlmUsage)}
                          onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextLlmUsage)}
                          label="LLM usage"
                        />
                      </div>
                    </div>
                    {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextLlmUsage) && (
                      <>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Gateway</p>
                        <p className="mt-1 break-words text-sm font-semibold leading-snug text-slate-900">OpenRouter API</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Central billing point for all event chats.</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Active Model</p>
                        <p className="mt-1 break-all text-sm font-semibold leading-snug text-slate-900">{activeLlmModel}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Current workspace resolves to this model.</p>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Selected Event</p>
                        <p className="mt-1 text-sm font-semibold leading-snug text-blue-900">
                          {formatCompactNumber(selectedEventUsage?.total_tokens || 0)} tokens
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed text-blue-700">
                          {formatUsdCost(selectedEventUsage?.estimated_cost_usd || 0)} across {formatCompactNumber(selectedEventUsage?.request_count || 0)} requests
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600">All Workspaces</p>
                        <p className="mt-1 text-sm font-semibold leading-snug text-emerald-900">
                          {formatCompactNumber(overallLlmUsage?.total_tokens || 0)} tokens
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed text-emerald-700">
                          {formatUsdCost(overallLlmUsage?.estimated_cost_usd || 0)} across {formatCompactNumber(overallLlmUsage?.request_count || 0)} requests
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Top Models In Event</p>
                          <span className="text-xs font-medium text-slate-500">{llmUsageSummary?.selected_event_models.length || 0}</span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {(llmUsageSummary?.selected_event_models.length || 0) === 0 ? (
                            <p className="text-xs text-slate-500">No usage captured for this event yet.</p>
                          ) : (
                            llmUsageSummary?.selected_event_models.map((item) => (
                              <div key={`event-model-${item.provider}-${item.model}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">{item.model}</p>
                                  <p className="text-[11px] text-slate-500">{formatCompactNumber(item.request_count)} requests</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs font-semibold text-slate-900">{formatCompactNumber(item.total_tokens)} tk</p>
                                  <p className="text-[11px] text-slate-500">{formatUsdCost(item.estimated_cost_usd)}</p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Top Models Overall</p>
                          <span className="text-xs font-medium text-slate-500">{llmUsageSummary?.overall_models.length || 0}</span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {(llmUsageSummary?.overall_models.length || 0) === 0 ? (
                            <p className="text-xs text-slate-500">No global usage captured yet.</p>
                          ) : (
                            llmUsageSummary?.overall_models.map((item) => (
                              <div key={`all-model-${item.provider}-${item.model}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">{item.model}</p>
                                  <p className="text-[11px] text-slate-500">{formatCompactNumber(item.request_count)} requests</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs font-semibold text-slate-900">{formatCompactNumber(item.total_tokens)} tk</p>
                                  <p className="text-[11px] text-slate-500">{formatUsdCost(item.estimated_cost_usd)}</p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {llmUsageError && <p className="mt-3 text-xs text-rose-600">{llmUsageError}</p>}
                    {!llmUsageError && (
                      <p className="mt-3 text-xs text-slate-500">
                        Usage is captured from the OpenRouter response payload at request time, so this can become the ledger for credit deduction later.
                      </p>
                    )}
                      </>
                    )}
                  </div>

                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "test" && (
            <motion.div
              key="test"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100">
                    <Bot className="h-5 w-5 text-blue-600" />
                  </div>
                    <div>
                      <h3 className="font-semibold text-sm">Bot Simulator</h3>
                      <StatusLine
                        className="mt-0.5"
                        items={[
                          "Simulator active",
                          `${testMessages.length} msgs`,
                          eventOperatorGuard.label,
                          selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : null,
                          selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open"
                            ? getRegistrationAvailabilityLabel(selectedEvent.registration_availability)
                            : null,
                        ]}
                      />
                      <div className="mt-1">
                        <HelpPopover label="Open note for Simulation Guard">
                          {eventOperatorGuard.body}
                        </HelpPopover>
                      </div>
                  </div>
                </div>
                <InlineActionsMenu label="Actions" tone="neutral">
                  <MenuActionItem
                    onClick={() => setTestMessages([])}
                    disabled={testMessages.length === 0}
                    tone="neutral"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="font-medium">Clear Chat</span>
                  </MenuActionItem>
                </InlineActionsMenu>
              </div>

              <div className="chat-scroll chat-selectable flex-1 min-h-0 space-y-2 overflow-y-auto bg-slate-50 p-3 sm:p-4">
                {testMessages.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center space-y-4 text-center opacity-40">
                    <MessageSquare className="h-10 w-10" />
                    <p className="text-sm max-w-xs">Start a conversation to test your bot's custom context.</p>
                  </div>
                )}
                {testMessages.map((msg, i) => {
                  const text = msg.parts.find((p) => p.text)?.text;
                  const funcCall = msg.parts.find((p) => p.functionCall)?.functionCall;
                  const funcResp = msg.parts.find((p) => p.functionResponse)?.functionResponse;

                  if (funcCall) return null;
                  if (funcResp) {
                    const data = funcResp.response.content;
                    const reg = registrations.find((r) => r.id === data.id);
                    if (!reg) return null;
                    return (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        key={i}
                      >
                        <Ticket
                          registrationId={reg.id}
                          firstName={reg.first_name}
                          lastName={reg.last_name}
                          phone={reg.phone}
                          email={reg.email}
                          timestamp={reg.timestamp}
                          eventName={settings.event_name}
                          eventLocation={attendeeLocationLabel}
                          eventDateLabel={timingInfo.eventDateLabel}
                          eventMapUrl={resolvedEventMapUrl}
                        />
                      </motion.div>
                    );
                  }

                  return (
                    <ChatBubble
                      key={i}
                      text={text || ""}
                      type={msg.role === "user" ? "outgoing" : "incoming"}
                      timestamp={msg.timestamp}
                    />
                  );
                })}
                {isTyping && (
                  <div className="flex justify-start mb-4">
                    <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-none border border-slate-100 flex gap-1">
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 p-2.5 sm:p-3 lg:px-5 lg:pb-6 lg:pt-3">
                <div className="flex gap-2 lg:pr-16">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleTestSend()}
                    placeholder="Type a message..."
                    className="flex-1 rounded-xl border-none bg-slate-100 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <ActionButton
                    onClick={handleTestSend}
                    disabled={!inputText.trim() || isTyping}
                    tone="blue"
                    active
                    className="px-3"
                  >
                    <Send className="w-5 h-5" />
                  </ActionButton>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "agent" && (
            <motion.div
              key="agent"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={agentWorkspaceView === "console" ? "h-full min-h-0" : "space-y-4"}
            >
              {agentWorkspaceView === "console" && (
              <div className={`agent-console-shell flex h-full min-h-0 flex-col overflow-hidden bg-white ${
                isAgentMobileFocusMode
                  ? "rounded-none border-0 shadow-none sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm"
                  : "rounded-2xl border border-slate-200 shadow-sm"
              }`}>
                <div className="agent-console-header border-b border-slate-100 bg-slate-50 px-3 py-2.5 sm:px-4 sm:py-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 sm:h-9 sm:w-9">
                      <MonitorCog className="h-4 w-4 text-violet-700 sm:h-5 sm:w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h3 className="truncate text-sm font-semibold">Admin Agent</h3>
                          <HelpPopover label="Open note for Agent Guard">
                            {adminAgentGuardBody}
                          </HelpPopover>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAdminAgentDashboardOpen((current) => !current)}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition ${
                              adminAgentDashboardOpen
                                ? "border-violet-200 bg-violet-50 text-violet-700"
                                : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                            }`}
                            aria-label={adminAgentDashboardOpen ? "Hide dashboard" : "Show dashboard"}
                            title={adminAgentDashboardOpen ? "Hide dashboard" : "Show dashboard"}
                          >
                            <LayoutDashboard className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void fetchAdminAgentDashboard(selectedEventId)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-slate-700"
                            aria-label="Refresh agent dashboard"
                            title="Refresh dashboard"
                          >
                            <RefreshCw className={`h-4 w-4 ${adminAgentDashboardLoading ? "animate-spin" : ""}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAgentMobileFocusMode((current) => !current)}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition lg:hidden ${
                              agentMobileFocusMode
                                ? "border-violet-200 bg-violet-50 text-violet-700"
                                : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                            }`}
                            aria-label={agentMobileFocusMode ? "Exit focus mode" : "Enter focus mode"}
                            title={agentMobileFocusMode ? "Exit focus mode" : "Enter focus mode"}
                          >
                            {agentMobileFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                          </button>
                          <InlineActionsMenu label="Agent actions" tone="neutral" iconOnly>
                            <MenuActionItem
                              onClick={() => void handleAdminAgentClearChat()}
                              disabled={adminAgentMessages.length === 0}
                              tone="neutral"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span className="font-medium">Clear Chat</span>
                            </MenuActionItem>
                          </InlineActionsMenu>
                        </div>
                      </div>
                      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <StatusLine
                          items={[
                            settings.admin_agent_enabled === "1" ? "enabled" : "disabled",
                            `${activeAgentMessageCount} msgs`,
                            adminAgentGuardLabel,
                            selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : null,
                            agentMobileFocusMode ? "focus mode" : null,
                          ]}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {adminAgentDashboardOpen && (
                  <div className="border-b border-slate-200 bg-white px-3 py-2 sm:px-4 sm:py-2.5">
                    <div className="agent-dashboard-surface rounded-2xl border border-slate-300 bg-slate-50/80 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700">Overview</p>
                            {adminAgentDashboardLoading && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                                <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                                syncing
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-slate-950">
                              {selectedEvent?.name || "No workspace selected"}
                            </p>
                            {selectedEvent && (
                              <StatusBadge tone={getEventStatusTone(selectedEvent.effective_status)}>
                                {getEventStatusLabel(selectedEvent.effective_status)}
                              </StatusBadge>
                            )}
                          </div>
                          <StatusLine
                            className="mt-1 text-slate-700"
                            items={[
                              selectedAdminAgentDashboardEvent
                                ? `updated ${formatEventWorkspaceDateLabel(selectedAdminAgentDashboardEvent.updated_at)}`
                                : null,
                              `${adminAgentDashboard?.summary.total_events ?? 0} workspaces`,
                              `${adminAgentDashboard?.summary.total_registrations ?? 0} registrations`,
                            ]}
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAdminAgentDashboardOpen(false)}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:border-violet-300 hover:text-violet-700"
                          >
                            Hide
                          </button>
                          {selectedEventId && (
                            <button
                              type="button"
                              onClick={() => {
                                setEventWorkspaceView("setup");
                                setActiveTab("event");
                              }}
                              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:border-blue-300 hover:text-blue-700"
                            >
                              Workspace
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-2.5 space-y-2.5">
                        {adminAgentDashboardError && (
                          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                            {adminAgentDashboardError}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                          <AdminAgentDashboardMiniStat
                            label="events"
                            value={adminAgentDashboard?.summary.total_events ?? "..."}
                          />
                          <AdminAgentDashboardMiniStat
                            label="live"
                            value={adminAgentDashboard?.summary.active_events ?? "..."}
                            tone="emerald"
                          />
                          <AdminAgentDashboardMiniStat
                            label="pending"
                            value={adminAgentDashboard?.summary.pending_events ?? "..."}
                            tone="amber"
                          />
                          <AdminAgentDashboardMiniStat
                            label="current regs"
                            value={adminAgentDashboard?.summary.selected_event_registrations ?? "..."}
                            tone="blue"
                          />
                        </div>

                        <AdminAgentDashboardMeter
                          label="Workspace Status"
                          totalLabel={`${adminAgentDashboard?.summary.total_events ?? 0} total`}
                          segments={[
                            { label: "live", value: adminAgentDashboard?.summary.active_events ?? 0, tone: "emerald" },
                            { label: "pending", value: adminAgentDashboard?.summary.pending_events ?? 0, tone: "amber" },
                            { label: "inactive", value: adminAgentDashboard?.summary.inactive_events ?? 0, tone: "slate" },
                            { label: "history", value: adminAgentDashboard?.summary.history_events ?? 0, tone: "violet" },
                          ]}
                        />

                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                          <AdminAgentDashboardMeter
                            label="Current Registrations"
                            totalLabel={`${adminAgentDashboard?.summary.selected_event_registrations ?? 0} total`}
                            segments={[
                              { label: "registered", value: adminAgentDashboard?.summary.selected_event_registered ?? 0, tone: "blue" },
                              { label: "checked-in", value: adminAgentDashboard?.summary.selected_event_checked_in ?? 0, tone: "emerald" },
                              { label: "cancelled", value: adminAgentDashboard?.summary.selected_event_cancelled ?? 0, tone: "amber" },
                            ]}
                          />

                          <div className="rounded-2xl border border-slate-300 bg-white px-3 py-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700">Quick Actions</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => applyAdminAgentCommand("list events")}
                                className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:border-violet-300 hover:text-violet-700"
                              >
                                List Events
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!selectedEventId) return;
                                  applyAdminAgentCommand(`/event ${selectedEventId} get_event_overview`);
                                }}
                                disabled={!selectedEventId}
                                className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:border-violet-300 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Event Overview
                              </button>
                            </div>
                            <StatusLine
                              className="mt-2 text-slate-700"
                              items={[
                                selectedAdminAgentDashboardEvent?.slug ? <span className="font-mono">{selectedAdminAgentDashboardEvent.slug}</span> : null,
                                selectedAdminAgentDashboardEvent?.is_default ? "default workspace" : null,
                              ]}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={adminAgentScrollRef} className="agent-chat-canvas chat-scroll chat-selectable flex-1 min-h-0 space-y-2 overflow-y-auto bg-slate-50 p-3 sm:p-4">
                  {adminAgentMessages.length === 0 && (
                    <div className="flex h-full flex-col items-center justify-center space-y-4 text-center opacity-40">
                      <MonitorCog className="h-10 w-10" />
                      <div className="space-y-2">
                        <p className="text-sm max-w-xs">
                          สั่งงาน Agent เช่น สร้าง/อัปเดต event, ตั้ง status/context, จัดการ registration, ส่งข้อความถึง user, หรือค้นทั้งระบบตาม policy ที่เปิดไว้
                        </p>
                        <p className="text-xs">CLI shortcuts: <span className="font-medium">list events</span>, <span className="font-medium">list events status:pending</span>, <span className="font-medium">/event evt_xxx get_event_overview</span></p>
                      </div>
                    </div>
                  )}
                  {adminAgentMessages.map((msg, index) => (
                    <div key={`${msg.timestamp}-${index}`} className="space-y-1">
                      <ChatBubble
                        text={msg.text}
                        type={msg.role === "user" ? "outgoing" : "incoming"}
                        timestamp={msg.timestamp}
                      />
                      {msg.role === "agent" && (msg.ticketPngUrl || msg.ticketSvgUrl || msg.csvDownloadUrl) && (
                        <div className="ml-2 space-y-2 pb-1">
                          {msg.ticketPngUrl && (
                            <a
                              href={msg.ticketPngUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="agent-inline-asset inline-block rounded-xl border border-slate-200 bg-white p-1"
                            >
                              <img
                                src={msg.ticketPngUrl}
                                alt="Ticket preview"
                                className="max-h-56 w-auto rounded-lg"
                                loading="lazy"
                              />
                            </a>
                          )}
                          {!msg.ticketPngUrl && msg.ticketSvgUrl && (
                            <a
                              href={msg.ticketSvgUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="agent-inline-asset inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700"
                            >
                              Open ticket (SVG)
                            </a>
                          )}
                          {msg.csvDownloadUrl && (
                            <a
                              href={msg.csvDownloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="agent-inline-asset inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700"
                            >
                              Download CSV
                            </a>
                          )}
                        </div>
                      )}
                      {msg.role === "agent" && msg.actionName && (
                        <StatusLine
                          className="ml-2 pb-2"
                          items={[
                            formatAdminActionLabel(msg.actionName),
                            msg.actionSource || "llm",
                          ]}
                        />
                      )}
                    </div>
                  ))}

                  {adminAgentTyping && (
                    <div className="flex justify-start mb-4">
                      <div className="agent-typing-bubble bg-white px-4 py-3 rounded-2xl rounded-bl-none border border-slate-100 flex gap-1">
                        <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" />
                        <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}
                  <div ref={adminAgentBottomRef} className="h-px w-full" aria-hidden />
                </div>

                <div className="agent-chat-composer border-t border-slate-100 p-2.5 sm:p-3 lg:px-5 lg:pb-6 lg:pt-3">
                  <div ref={adminCommandPaletteRef} className="relative">
                    <AnimatePresence>
                      {adminCommandPaletteOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 6 }}
                          className="agent-command-palette absolute bottom-[calc(100%+0.6rem)] left-0 right-0 z-30 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
                        >
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2">
                            <Search className="h-3.5 w-3.5 text-slate-400" />
                            <input
                              ref={adminCommandPaletteSearchInputRef}
                              type="text"
                              value={adminCommandPaletteQuery}
                              onChange={(event) => setAdminCommandPaletteQuery(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  const firstTemplate = filteredAdminCommandTemplates[0];
                                  if (firstTemplate) {
                                    handleApplyAdminCommandTemplate(firstTemplate);
                                  }
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  closeAdminCommandPalette();
                                  adminAgentInputRef.current?.focus();
                                }
                              }}
                              placeholder="Search command..."
                              className="flex-1 border-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                            />
                            {adminCommandPaletteQuery && (
                              <button
                                type="button"
                                onClick={() => setAdminCommandPaletteQuery("")}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                                aria-label="Clear command search"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                            {filteredAdminCommandTemplates.slice(0, 12).map((template) => (
                              <button
                                key={template.id}
                                type="button"
                                onClick={() => handleApplyAdminCommandTemplate(template)}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-violet-300 hover:bg-violet-50"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-sm font-semibold text-slate-800">{template.label}</span>
                                  <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    {template.id}
                                  </span>
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">{template.note}</p>
                                <code className="mt-1.5 block rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                                  {template.command}
                                </code>
                              </button>
                            ))}
                            {filteredAdminCommandTemplates.length === 0 && (
                              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                                No command found. Try keyword like `registration`, `event`, `ticket`, or `search`.
                              </div>
                            )}
                          </div>
                          <p className="mt-2 px-1 text-[11px] text-slate-500">
                            Shortcut: <span className="font-semibold">Ctrl/Cmd + Shift + P</span>
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="flex gap-2 lg:pr-16">
                      <ActionButton
                        onClick={handleToggleAdminCommandPalette}
                        tone="neutral"
                        className="px-2.5"
                        aria-label={adminCommandPaletteOpen ? "Close command palette" : "Open command palette"}
                        title="Command Palette (Ctrl/Cmd + Shift + P)"
                      >
                        <Code className="h-4 w-4" />
                      </ActionButton>
                      <input
                        ref={adminAgentInputRef}
                        type="text"
                        value={adminAgentInputText}
                        onChange={(e) => setAdminAgentInputText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAdminAgentSend();
                          }
                        }}
                        placeholder="สั่งงาน Admin Agent หรือพิมพ์ CLI เช่น list events status:pending"
                        className="agent-command-input flex-1 rounded-xl border-none bg-slate-100 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                      />
                      <ActionButton
                        onClick={handleAdminAgentSend}
                        disabled={!adminAgentInputText.trim() || adminAgentTyping || settings.admin_agent_enabled !== "1"}
                        tone="violet"
                        active
                        className="px-3"
                      >
                        <Send className="w-5 h-5" />
                      </ActionButton>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {adminAgentConsoleQuickTemplates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => handleApplyAdminCommandTemplate(template)}
                          className="agent-preset-chip rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 sm:px-3 sm:py-1.5 sm:text-xs"
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              )}

              {agentWorkspaceView !== "console" && (
              <div className="space-y-4 xl:max-w-4xl">
                <div className="flex items-center justify-end">
                  <ActionButton
                    onClick={() => void saveAgentSettings()}
                    disabled={saving || !canEditSettings}
                    tone="violet"
                    active
                    className="whitespace-nowrap px-3 text-sm"
                  >
                    {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Agent Setup
                  </ActionButton>
                </div>
                {agentWorkspaceView === "setup" && (
                <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime) ? "p-3" : "space-y-4 p-4"}`}>
                  <div className={`flex justify-between gap-3 ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime) ? "items-center" : "items-start"}`}>
                    <button
                      type="button"
                      onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime)}
                      className="min-w-0 flex-1 text-left"
                      aria-label={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime) ? "Expand" : "Collapse"} Agent Runtime`}
                    >
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Bot className="w-5 h-5 text-violet-600" />
                        Agent Runtime
                      </h3>
                      {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime) && (
                        <p className="text-sm text-slate-500">
                          Separate prompt/model and routing for Admin Agent, independent from event chat bot setup.
                        </p>
                      )}
                    </button>
                    <CollapseIconButton
                      collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime)}
                      onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime)}
                      label="Agent Runtime"
                    />
                  </div>

                  {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime) && (
                  <>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={settings.admin_agent_enabled === "1"}
                        onChange={(e) => setSettings({ ...settings, admin_agent_enabled: e.target.checked ? "1" : "0" })}
                        disabled={!canEditSettings}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span>
                        <span className="font-semibold text-slate-800">Enable Admin Agent</span>
                        <span className="mt-0.5 block text-xs text-slate-500">Controls both in-app Agent console and external Agent endpoints.</span>
                      </span>
                    </label>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Agent System Prompt (Admin)</label>
                      <ActionButton
                        onClick={() => setSettings({ ...settings, admin_agent_system_prompt: RECOMMENDED_ADMIN_AGENT_PROMPT })}
                        disabled={!canEditSettings}
                        tone="neutral"
                        className="min-h-0 px-2 py-1 text-[11px]"
                      >
                        Use Recommended
                      </ActionButton>
                    </div>
                    <textarea
                      value={settings.admin_agent_system_prompt}
                      onChange={(e) => setSettings({ ...settings, admin_agent_system_prompt: e.target.value })}
                      disabled={!canEditSettings}
                      className="w-full h-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                      placeholder="System prompt for internal admin operations (separate from attendee chat bot)"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">Prompt นี้ใช้เฉพาะ Admin Agent และไม่กระทบ prompt ของ bot ที่คุยกับผู้ใช้งานภายนอก</p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Agent Model Override</label>
                      <input
                        value={settings.admin_agent_model}
                        onChange={(e) => setSettings({ ...settings, admin_agent_model: e.target.value })}
                        disabled={!canEditSettings}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500"
                        placeholder="Blank = use event/global model"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Default Event ID (External)</label>
                      <div className="flex gap-2">
                        <input
                          value={settings.admin_agent_default_event_id}
                          onChange={(e) => setSettings({ ...settings, admin_agent_default_event_id: e.target.value })}
                          disabled={!canEditSettings}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500"
                          placeholder="evt_default"
                        />
                        <ActionButton
                          onClick={() => setSettings({ ...settings, admin_agent_default_event_id: selectedEventId })}
                          disabled={!canEditSettings || !selectedEventId}
                          tone="neutral"
                          className="shrink-0 px-2.5 text-[11px]"
                        >
                          Use Current
                        </ActionButton>
                      </div>
                    </div>
                  </div>

                  <details className="rounded-xl border border-slate-200 bg-slate-50">
                    <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-slate-800">
                      Advanced Action Policy
                    </summary>
                    <div className="space-y-2 border-t border-slate-200 px-3 py-3 text-sm">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_policy_read_event !== "0"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_policy_read_event: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span><span className="font-medium">Event Read</span> <span className="text-xs text-slate-500">find_event, event overview</span></span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_policy_manage_event_setup === "1"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_policy_manage_event_setup: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span><span className="font-medium">Event Setup Write</span> <span className="text-xs text-slate-500">create event + set detail/rules</span></span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_policy_manage_event_status === "1"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_policy_manage_event_status: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span><span className="font-medium">Event Status Write</span> <span className="text-xs text-slate-500">set pending/active/inactive/cancelled/archived</span></span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_policy_manage_event_context === "1"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_policy_manage_event_context: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span><span className="font-medium">Event Context Write</span> <span className="text-xs text-slate-500">update context knowledge</span></span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_policy_read_registration !== "0"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_policy_read_registration: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span><span className="font-medium">Registration Read</span> <span className="text-xs text-slate-500">find/list/count/timeline</span></span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_policy_manage_registration !== "0"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_policy_manage_registration: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span><span className="font-medium">Registration Write</span> <span className="text-xs text-slate-500">set status, resend ticket/email</span></span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_policy_message_user !== "0"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_policy_message_user: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span><span className="font-medium">Messaging Actions</span> <span className="text-xs text-slate-500">send message, retry bot</span></span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_policy_search_all_events !== "0"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_policy_search_all_events: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span><span className="font-medium">Search Whole System</span> <span className="text-xs text-slate-500">allow cross-event search/override</span></span>
                      </label>
                    </div>
                  </details>

                  <details className="rounded-xl border border-slate-200 bg-slate-50">
                    <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-slate-800">
                      Notification Automation
                    </summary>
                    <div className="space-y-3 border-t border-slate-200 px-3 py-3 text-sm">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_notification_enabled === "1"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_notification_enabled: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span>
                          <span className="font-medium">Enable Auto Notifications</span>
                          <span className="text-xs text-slate-500">Send registration activity and public chat attention alerts to admin automatically.</span>
                        </span>
                      </label>

                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={desktopNotifyEnabled}
                              onChange={(e) => setDesktopNotifyEnabled(e.target.checked)}
                              disabled={!canEditSettings || !desktopNotificationSupported || settings.admin_agent_notification_enabled !== "1"}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                            />
                            <span>
                              <span className="font-medium">Desktop Notifications (This Browser)</span>
                              <span className="text-xs text-slate-500">Show native browser notifications from registration changes and public chat attention signals.</span>
                            </span>
                          </label>
                          <ActionButton
                            onClick={() => void requestDesktopNotificationPermission()}
                            disabled={!canEditSettings || !desktopNotificationSupported || desktopNotifyPermission === "granted"}
                            tone="neutral"
                            className="px-2.5 py-1.5 text-xs"
                          >
                            Request Permission
                          </ActionButton>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <StatusBadge
                            tone={
                              desktopNotifyPermission === "granted"
                                ? "emerald"
                                : desktopNotifyPermission === "denied"
                                ? "rose"
                                : "neutral"
                            }
                          >
                            {desktopNotifyPermissionLabel}
                          </StatusBadge>
                          <span className="text-[11px] text-slate-500">Requires browser permission and an active web session.</span>
                        </div>
                      </div>

                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_notification_on_registration_created !== "0"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_notification_on_registration_created: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings || settings.admin_agent_notification_enabled !== "1"}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span>
                          <span className="font-medium">Notify On New Registration</span>
                          <span className="text-xs text-slate-500">Trigger when a new attendee is created.</span>
                        </span>
                      </label>

                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={settings.admin_agent_notification_on_registration_status_changed !== "0"}
                          onChange={(e) => setSettings({ ...settings, admin_agent_notification_on_registration_status_changed: e.target.checked ? "1" : "0" })}
                          disabled={!canEditSettings || settings.admin_agent_notification_enabled !== "1"}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                        />
                        <span>
                          <span className="font-medium">Notify On Status Changes</span>
                          <span className="text-xs text-slate-500">Trigger when status changes (registered/cancelled/checked-in).</span>
                        </span>
                      </label>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Notification Scope</label>
                          <select
                            value={settings.admin_agent_notification_scope}
                            onChange={(e) => setSettings({ ...settings, admin_agent_notification_scope: e.target.value === "event" ? "event" : "all" })}
                            disabled={!canEditSettings || settings.admin_agent_notification_enabled !== "1"}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                          >
                            <option value="all">All Events</option>
                            <option value="event">One Event Only</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Target Event ID</label>
                          <div className="flex gap-2">
                            <input
                              value={settings.admin_agent_notification_event_id}
                              onChange={(e) => setSettings({ ...settings, admin_agent_notification_event_id: e.target.value })}
                              disabled={!canEditSettings || settings.admin_agent_notification_enabled !== "1" || settings.admin_agent_notification_scope !== "event"}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-slate-100"
                              placeholder="evt_default"
                            />
                            <ActionButton
                              onClick={() => setSettings({ ...settings, admin_agent_notification_event_id: selectedEventId })}
                              disabled={
                                !canEditSettings
                                || settings.admin_agent_notification_enabled !== "1"
                                || settings.admin_agent_notification_scope !== "event"
                                || !selectedEventId
                              }
                              tone="neutral"
                              className="shrink-0 px-2.5 text-[11px]"
                            >
                              Use Current
                            </ActionButton>
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-slate-500">
                        Delivery channel uses Admin Agent Telegram Bot + Allowed Chat IDs. If Telegram access is disabled or no chat IDs are configured, notifications will be skipped.
                      </p>
                    </div>
                  </details>
                  </>
                  )}

                  {!canEditSettings && (
                    <p className="text-xs text-amber-600">Only owner/admin can change Agent settings. Operator can still run commands.</p>
                  )}
                </div>
                )}

                {agentWorkspaceView === "setup" && (
                <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel) ? "p-3" : "space-y-4 p-4"}`}>
                  <div className={`flex justify-between gap-3 ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel) ? "items-center" : "items-start"}`}>
                    <button
                      type="button"
                      onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel)}
                      className="min-w-0 flex-1 text-left"
                      aria-label={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel) ? "Expand" : "Collapse"} External Agent Channel`}
                    >
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Link2 className="w-5 h-5 text-violet-600" />
                        External Agent Channel (Telegram)
                      </h3>
                      {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel) && (
                        <p className="text-sm text-slate-500">
                          Dedicated Telegram webhook for Admin Agent commands, separate from event chat channels.
                        </p>
                      )}
                    </button>
                    <div className="flex items-center gap-2">
                      {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel) && (
                        <HelpPopover label="Open note for Admin Agent Telegram setup">
                          <p className="font-semibold text-slate-700">Telegram setup (step by step)</p>
                          <ol className="mt-2 list-decimal space-y-1 pl-4">
                            <li>สร้าง bot ด้วย BotFather แล้วคัดลอก Bot Token</li>
                            <li>เปิด Enable Telegram Access แล้วกด Save Agent Setup</li>
                            <li>กด Copy setWebhook แล้วเปิด URL เพื่อตั้ง webhook</li>
                            <li>เปิด Telegram แล้วส่ง <code>/myid</code> ไปหาบอทเพื่อดู <code>chat_id</code> (ตัวเลข)</li>
                            <li>นำเลข <code>chat_id</code> ที่ได้ ไปใส่ใน Allowed Chat IDs (หนึ่งบรรทัดต่อหนึ่ง ID)</li>
                          </ol>
                          <p className="mt-2 text-[11px] text-slate-500">
                            สำคัญ: Allowed Chat IDs ต้องใช้เลข chat_id ของผู้ใช้/กลุ่ม ไม่ใช่ชื่อบอทหรือ username เช่น <code>@fb_bot</code>
                          </p>
                          <p className="mt-2 text-[11px] text-slate-500">
                            Webhook Secret Token เป็นตัวเลือกเสริมเพื่อเพิ่มความปลอดภัย ถ้าใช้ ให้ตั้งค่าเดียวกันทั้งในแอพและตอน setWebhook
                          </p>
                        </HelpPopover>
                      )}
                      <CollapseIconButton
                        collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel)}
                        onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel)}
                        label="External Agent Channel"
                      />
                    </div>
                  </div>

                  {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel) && (
                  <>
                  <label className="flex items-start gap-3 text-sm rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={settings.admin_agent_telegram_enabled === "1"}
                      onChange={(e) => setSettings({ ...settings, admin_agent_telegram_enabled: e.target.checked ? "1" : "0" })}
                      disabled={!canEditSettings}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                    <span>
                      <span className="font-semibold text-slate-800">Enable Telegram Access</span>
                      <span className="mt-0.5 block text-xs text-slate-500">When enabled, incoming Telegram updates can run Admin Agent commands.</span>
                    </span>
                  </label>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Telegram Bot Token</label>
                      <input
                        type="password"
                        value={settings.admin_agent_telegram_bot_token}
                        onChange={(e) => setSettings({ ...settings, admin_agent_telegram_bot_token: e.target.value })}
                        disabled={!canEditSettings}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500"
                        placeholder="123456:ABC..."
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Webhook Secret Token</label>
                      <input
                        type="password"
                        value={settings.admin_agent_telegram_webhook_secret}
                        onChange={(e) => setSettings({ ...settings, admin_agent_telegram_webhook_secret: e.target.value })}
                        disabled={!canEditSettings}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500"
                        placeholder="Set same value in Telegram setWebhook secret_token"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Allowed Chat IDs</label>
                      <textarea
                        value={settings.admin_agent_telegram_allowed_chat_ids}
                        onChange={(e) => setSettings({ ...settings, admin_agent_telegram_allowed_chat_ids: e.target.value })}
                        disabled={!canEditSettings}
                        className="w-full h-20 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500"
                        placeholder="Numeric chat_id only, one per line (e.g. 123456789 or -100...). Leave blank = allow all."
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        Use your own chat_id (not bot name/username). Send <code>/myid</code> to the bot to see it.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Telegram Webhook URL</p>
                    <code className="block break-all text-xs text-slate-700">{adminAgentTelegramWebhookUrl}</code>
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        onClick={() => copyToClipboard(adminAgentTelegramWebhookUrl)}
                        tone="neutral"
                        className="text-xs px-2.5 py-1.5 min-h-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy URL
                      </ActionButton>
                      <ActionButton
                        onClick={() => copyToClipboard(adminAgentTelegramSetWebhookUrl)}
                        tone="neutral"
                        disabled={!adminAgentTelegramSetWebhookUrl}
                        className="text-xs px-2.5 py-1.5 min-h-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy setWebhook
                      </ActionButton>
                    </div>
                    {adminAgentTelegramSetWebhookUrl && (
                      <code className="block break-all text-[11px] text-slate-500">{adminAgentTelegramSetWebhookUrl}</code>
                    )}
                  </div>
                  </>
                  )}

                </div>
                )}

                {settingsMessage && (
                  <p className={`text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                    {settingsMessage}
                  </p>
                )}
              </div>
              )}
            </motion.div>
          )}

          {activeTab === "registrations" && (
            <motion.div
              key="registrations"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,23rem)]">
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-base font-semibold">Registered Attendees</h2>
                        <StatusLine
                          className="mt-0.5"
                          items={[
                            `${filteredRegistrations.length} results`,
                            registrationAvailability.label,
                          ]}
                        />
                        <p className="text-xs text-slate-500">
                          {registrationCapacity.limit === null
                            ? `${activeAttendeeCount} active attendees. Search fast, then progressively load more rows when this event gets large.`
                            : registrationCapacity.remaining === 0
                            ? `Capacity is full. ${activeAttendeeCount} of ${registrationCapacity.limit} seats are occupied, so new registrations are blocked.`
                            : `${activeAttendeeCount} of ${registrationCapacity.limit} seats filled. ${registrationCapacity.remaining} seats remaining before registration closes for capacity.`}
                        </p>
                      </div>
                      <InlineActionsMenu label="Actions" tone="neutral">
                        <MenuActionLink
                          href={`/api/registrations/export?event_id=${encodeURIComponent(selectedEventId)}`}
                          tone="neutral"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span className="font-medium">Export CSV</span>
                        </MenuActionLink>
                      </InlineActionsMenu>
                    </div>
                    <div className="border-b border-slate-100 px-3 py-2.5 sm:px-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          value={registrationListQuery}
                          onChange={(e) => setRegistrationListQuery(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Search by name, registration ID, phone, or email"
                        />
                        {registrationListQuery && (
                          <button
                            onClick={() => setRegistrationListQuery("")}
                            className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                            aria-label="Clear registration search"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="max-h-[28rem] space-y-2 overflow-y-auto p-3 md:hidden">
                      {filteredRegistrations.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                          {deferredRegistrationListQuery ? "No attendees match this search." : "No registrations yet."}
                        </div>
                      ) : (
                        visibleRegistrations.map((reg) => (
                          <button
                            key={reg.id}
                            id={getSearchTargetDomId("registration", reg.id)}
                            onClick={() => setSelectedRegistrationId(reg.id)}
                            className={`w-full rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                              selectedRegistrationId === reg.id
                                ? "border-blue-200 bg-blue-50"
                                : "border-slate-200 bg-white hover:bg-slate-50"
                            } ${isSearchFocused("registration", reg.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">{reg.first_name} {reg.last_name}</p>
                                <p className="mt-0.5 font-mono text-[11px] font-bold text-blue-600">{reg.id}</p>
                                <p className="mt-0.5 truncate text-[10px] text-slate-500">
                                  {reg.phone || reg.email || "No contact info"}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                <StatusBadge tone={getRegistrationStatusTone(reg.status)}>{reg.status}</StatusBadge>
                                {selectedRegistrationId === reg.id && <SelectionMarker />}
                              </div>
                            </div>
                            <p className="mt-1 text-[10px] text-slate-500">{new Date(reg.timestamp).toLocaleString()}</p>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="hidden max-h-[38rem] overflow-auto md:block">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                          <tr>
                            <th className="px-4 py-2.5">ID</th>
                            <th className="px-4 py-2.5">Name</th>
                            <th className="px-4 py-2.5">Contact</th>
                            <th className="px-4 py-2.5">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredRegistrations.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-4 py-10 text-center text-slate-400 italic">
                                  {deferredRegistrationListQuery ? "No attendees match this search." : "No registrations yet."}
                                </td>
                              </tr>
                          ) : (
                            visibleRegistrations.map((reg) => (
                              <tr
                                key={reg.id}
                                id={getSearchTargetDomId("registration", reg.id)}
                                onClick={() => setSelectedRegistrationId(reg.id)}
                                className={`registration-row hover:bg-slate-50 transition-colors cursor-pointer ${
                                  selectedRegistrationId === reg.id ? "registration-row-selected bg-blue-50" : ""
                                } ${
                                  isSearchFocused("registration", reg.id) ? "bg-blue-50" : ""
                                }`}
                              >
                                <td className="px-4 py-2.5 font-mono text-[11px] font-bold text-blue-600">
                                  {reg.id}
                                </td>
                                <td className="px-4 py-2.5">
                                  <p className="text-sm font-medium">{reg.first_name} {reg.last_name}</p>
                                  <p className="text-[10px] text-slate-400">{new Date(reg.timestamp).toLocaleString()}</p>
                                </td>
                                <td className="px-4 py-2.5">
                                  <p className="text-[11px]">{reg.phone}</p>
                                  <p className="text-[10px] text-slate-400">{reg.email}</p>
                                </td>
                                <td className="px-4 py-2.5">
                                  <StatusBadge tone={getRegistrationStatusTone(reg.status)}>
                                    {reg.status}
                                  </StatusBadge>
                                  {selectedRegistrationId === reg.id && (
                                    <p className="mt-1 text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Selected</p>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-2.5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                      <p>
                        Showing {visibleRegistrations.length} of {filteredRegistrations.length} attendees
                      </p>
                      {hasMoreRegistrations && (
                        <ActionButton
                          onClick={() => setRegistrationVisibleCount((count) => count + 120)}
                          tone="neutral"
                          className="w-full text-sm sm:w-auto"
                        >
                          Load 120 More
                        </ActionButton>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <Activity className="w-4 h-4 text-blue-600" />
                          Event Stats
                        </h3>
                        <p className="hidden text-xs text-slate-500 sm:block">Glanceable live totals for this event.</p>
                      </div>
                      <StatusBadge tone={registrationAvailability.tone}>{registrationAvailability.label}</StatusBadge>
                    </div>
                    <div className="space-y-2.5">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Seat Capacity</p>
                            <p className="mt-1 text-2xl font-bold text-slate-900">
                              {registrationCapacity.limit === null ? activeAttendeeCount : `${activeAttendeeCount}/${registrationCapacity.limit}`}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {registrationCapacity.limit === null
                                ? "No hard capacity limit is configured for this event."
                                : registrationCapacity.remaining === 0
                                ? "No seats remaining. Registration now stops at capacity."
                                : `${registrationCapacity.remaining} seats remain before registration auto-closes for capacity.`}
                            </p>
                          </div>
                          {registrationCapacity.limit !== null && (
                            <div className="text-right">
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Filled</p>
                              <p className="mt-1 text-lg font-bold text-slate-900">{registrationCapacity.fillPercent}%</p>
                            </div>
                          )}
                        </div>
                        {registrationCapacity.limit !== null && (
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full transition-[width] ${
                                registrationCapacity.isFull ? "bg-rose-500" : "bg-blue-600"
                              }`}
                              style={{ width: `${registrationCapacity.fillPercent}%` }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Total</p>
                          <p className="mt-1 text-base font-bold text-slate-900">{registrations.length}</p>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">Registered</p>
                          <p className="mt-1 text-base font-bold text-blue-700">{registeredCount}</p>
                        </div>
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-600">Checked</p>
                          <p className="mt-1 text-base font-bold text-emerald-700">{checkedInCount}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Cancelled</p>
                          <p className="mt-1 text-base font-bold text-slate-700">{cancelledCount}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Check-in Rate</p>
                          <p className="mt-1 text-xs text-slate-500">{registrationAvailability.helper}</p>
                        </div>
                        <p className="text-lg font-bold text-violet-700">{checkInRate}%</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-base font-semibold">Selected Ticket</h3>
                        <p className="text-xs text-slate-500">Click a registration row to preview, download, and edit status.</p>
                      </div>
                      {selectedRegistration && (
                        <StatusBadge tone={getRegistrationStatusTone(selectedRegistration.status)}>
                          {selectedRegistration.status}
                        </StatusBadge>
                      )}
                    </div>

                    {!selectedRegistration ? (
                      <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                        No attendee selected yet.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="max-h-[23rem] overflow-auto rounded-2xl bg-slate-50 p-1.5">
                          <Ticket
                            registrationId={selectedRegistration.id}
                            firstName={selectedRegistration.first_name}
                            lastName={selectedRegistration.last_name}
                            phone={selectedRegistration.phone}
                            email={selectedRegistration.email}
                            timestamp={selectedRegistration.timestamp}
                            eventName={settings.event_name}
                            eventLocation={attendeeLocationLabel}
                            eventDateLabel={timingInfo.eventDateLabel}
                            eventMapUrl={resolvedEventMapUrl}
                          />
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          <a
                            href={selectedTicketPngUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${ACTION_BUTTON_BASE_CLASS} ${ACTION_BUTTON_TONE_CLASSES.blue.active} min-w-0 flex-1 text-sm sm:flex-none`}
                          >
                            <ExternalLink className="w-4 h-4" />
                            Open PNG Ticket
                          </a>
                          <InlineActionsMenu label="Ticket Actions" tone="neutral">
                            <MenuActionLink
                              href={selectedTicketPngUrl}
                              download={`${selectedRegistration.id}.png`}
                              tone="neutral"
                            >
                              <Download className="h-3.5 w-3.5" />
                              <span className="font-medium">Download PNG</span>
                            </MenuActionLink>
                            <MenuActionLink
                              href={selectedTicketSvgUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              tone="blue"
                              className="mt-1"
                            >
                              <QrCode className="h-3.5 w-3.5" />
                              <span className="font-medium">Open SVG Preview</span>
                            </MenuActionLink>
                            {canChangeRegistrationStatus && (
                              <MenuActionItem
                                onClick={() => void deleteRegistration(selectedRegistration.id)}
                                disabled={deleteRegistrationLoading}
                                tone="rose"
                                className="mt-1"
                              >
                                {deleteRegistrationLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                <span className="font-medium">Delete Registration</span>
                              </MenuActionItem>
                            )}
                          </InlineActionsMenu>
                        </div>

                        {canChangeRegistrationStatus && (
                        <div className="border-t border-slate-100 pt-3">
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Admin Status Override</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {(["registered", "checked-in", "cancelled"] as RegistrationStatus[]).map((statusOption) => {
                              const active = selectedRegistration.status === statusOption;
                              return (
                                <ActionButton
                                  key={statusOption}
                                  onClick={() => updateRegistrationStatus(selectedRegistration.id, statusOption)}
                                  disabled={statusUpdateLoading}
                                  tone={
                                    statusOption === "checked-in"
                                      ? "emerald"
                                      : statusOption === "cancelled"
                                      ? "neutral"
                                      : "blue"
                                  }
                                  active={active}
                                  className="w-full text-sm"
                                >
                                  {statusOption === "registered"
                                    ? "Mark Registered"
                                    : statusOption === "checked-in"
                                    ? "Mark Checked In"
                                    : "Mark Cancelled"}
                                </ActionButton>
                              );
                            })}
                          </div>
                          {statusUpdateMessage && (
                            <p className={`mt-2 text-xs ${statusUpdateMessage.toLowerCase().includes("failed") || statusUpdateMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                              {statusUpdateMessage}
                            </p>
                          )}
                        </div>
                        )}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </motion.div>
          )}
          {activeTab === "checkin" && (
            <motion.div
              key="checkin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                          <QrCode className="w-5 h-5 text-blue-600" />
                          Check-in Mode
                        </h2>
                        <p className="text-sm text-slate-500">
                          Mobile-first check-in flow for staff at the door. Use manual ID entry or scan a QR code.
                        </p>
                      </div>
                    </div>

                    <div className="mb-4">
                      <PageBanner
                        tone={toBannerTone(checkinOperatorGuard.tone)}
                        icon={<QrCode className="h-4 w-4" />}
                      >
                        Door mode active · {selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : "No event selected"}
                        {selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open"
                          ? ` · ${getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}`
                          : ""}
                        {selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open"
                          ? " · Existing attendees can still check in"
                          : ""}
                      </PageBanner>
                    </div>

                    <CompactStatRow
                      stats={[
                        { label: "Registered", value: registeredCount, tone: "blue" },
                        { label: "Cancelled", value: cancelledCount, tone: "neutral" },
                        { label: "Checked in", value: checkedInCount, tone: "emerald" },
                        { label: "Check-in rate", value: `${checkInRate}%`, tone: "neutral" },
                      ]}
                    />
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Camera className="w-5 h-5 text-blue-600" />
                          QR Scanner
                        </h3>
                        <p className="text-sm text-slate-500">
                          Open the camera and scan attendee QR codes continuously.
                        </p>
                      </div>
                      <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
                        <ActionButton
                          onClick={startQrScanner}
                          disabled={!canUseQrScanner || scannerActive || scannerStarting}
                          tone="blue"
                          active
                          className="w-full text-sm"
                        >
                          {scannerStarting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          Start Camera
                        </ActionButton>
                        <ActionButton
                          onClick={stopQrScanner}
                          disabled={!scannerActive && !scannerStarting}
                          tone="neutral"
                          className="w-full text-sm"
                        >
                          <Square className="w-4 h-4" />
                          Stop
                        </ActionButton>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-950">
                      <div className="aspect-video relative">
                        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
                        {!scannerActive && !scannerStarting && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-3 p-6 text-center">
                            <Camera className="w-10 h-10 opacity-70" />
                            <p className="text-sm max-w-sm">
                              {canUseQrScanner
                                ? "Tap Start Camera to request permission and begin scanning."
                                : "This browser does not support camera access. Use manual check-in instead."}
                            </p>
                          </div>
                        )}
                        {scannerStarting && (
                          <div className="absolute inset-0 flex items-center justify-center text-white">
                            <RefreshCw className="w-6 h-6 animate-spin" />
                          </div>
                        )}
                        {scannerActive && (
                          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-32 border-2 border-blue-300/90 rounded-3xl shadow-[0_0_0_9999px_rgba(15,23,42,0.28)] pointer-events-none" />
                        )}
                      </div>
                    </div>

                    {lastScannedValue && (
                      <p className="mt-3 text-xs text-slate-500 break-all">
                        Last scan: <span className="font-mono">{lastScannedValue}</span>
                      </p>
                    )}
                    {scannerError && <p className="mt-2 text-xs text-rose-600">{scannerError}</p>}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Search className="w-5 h-5 text-blue-600" />
                      Manual Check-in
                    </h3>
                    <p className="text-sm text-slate-500 mb-4">
                      Enter the registration ID manually if the QR code cannot be scanned.
                    </p>
                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={searchId}
                          onChange={(e) => setSearchId(e.target.value.toUpperCase())}
                          onKeyDown={(e) => e.key === "Enter" && handleCheckin()}
                          placeholder="REG-XXXXXX"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-base font-mono outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <ActionButton
                        onClick={handleCheckin}
                        disabled={!searchId || checkinStatus === "loading"}
                        tone={checkinStatus === "success" ? "emerald" : checkinStatus === "error" ? "rose" : "blue"}
                        active
                        className="w-full text-sm"
                      >
                        {checkinStatus === "loading" && <RefreshCw className="w-4 h-4 animate-spin" />}
                        {checkinStatus === "success" && <CheckCircle2 className="w-4 h-4" />}
                        {checkinStatus === "error" && <AlertCircle className="w-4 h-4" />}
                        {checkinStatus === "success" ? "Checked In!" : checkinStatus === "error" ? "Check-in Failed" : "Check In Attendee"}
                      </ActionButton>
                      {checkinStatus === "error" && checkinErrorMessage && (
                        <p className="text-xs text-rose-600">{checkinErrorMessage}</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <h3 className="text-lg font-semibold">Latest Result</h3>
                        <StatusLine
                          className="mt-1"
                          items={[
                            latestResultLabel,
                            latestCheckinRegistration ? `ID ${latestCheckinRegistration.id}` : null,
                          ]}
                        />
                      </div>
                    </div>

                    {!latestCheckinRegistration ? (
                      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
                        No attendee checked in yet in this session.
                      </div>
                    ) : (
                      <div className={`rounded-2xl border p-4 space-y-3 ${latestResultToneClass}`}>
                        <div>
                          <p className="text-lg font-semibold text-slate-900">
                            {latestCheckinRegistration.first_name} {latestCheckinRegistration.last_name}
                          </p>
                          <p className="text-xs font-mono text-blue-600">{latestCheckinRegistration.id}</p>
                        </div>
                        <div className="grid grid-cols-1 gap-2 text-sm">
                          <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Phone</p>
                            <p className="text-slate-700">{latestCheckinRegistration.phone || "-"}</p>
                          </div>
                          <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Email</p>
                            <p className="text-slate-700 break-all">{latestCheckinRegistration.email || "-"}</p>
                          </div>
                        </div>
                        {!checkinAccessMode && (
                          <ActionButton
                            onClick={() => handleNavigateToTab("registrations")}
                            tone="neutral"
                            className="w-full text-sm"
                          >
                            Open Full Registration Record
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </div>

                  {canManageCheckinAccess && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Shield className="w-5 h-5 text-blue-600" />
                          Check-in Access
                        </h3>
                        <p className="text-sm text-slate-500">
                          Generate a mobile-friendly check-in link for staff without giving them full admin access.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Session Label</label>
                          <input
                            type="text"
                            value={checkinSessionLabel}
                            onChange={(e) => setCheckinSessionLabel(e.target.value)}
                            placeholder="Front Desk A"
                            className="w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Hours</label>
                          <input
                            type="number"
                            min={1}
                            max={168}
                            value={checkinSessionHours}
                            onChange={(e) => setCheckinSessionHours(e.target.value)}
                            className="w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                      <ActionButton
                        onClick={handleCreateCheckinSession}
                        disabled={checkinSessionCreating || !selectedEventId || selectedEventCheckinLocked}
                        tone="blue"
                        active
                        className="w-full text-sm sm:w-auto"
                      >
                        {checkinSessionCreating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                        Generate Check-in Link
                      </ActionButton>

                      {checkinSessionMessage && (
                        <p className={`text-xs ${checkinSessionMessage.toLowerCase().includes("failed") || checkinSessionMessage.toLowerCase().includes("required") ? "text-rose-600" : "text-emerald-600"}`}>
                          {checkinSessionMessage}
                        </p>
                      )}

                      {checkinSessionReveal && (
                        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">New check-in link</p>
                          <CopyField
                            label="Access URL"
                            value={checkinSessionReveal.url}
                            onCopy={() => copyToClipboard(checkinSessionReveal.url)}
                            copied={copied}
                            help="The raw token is shown once. Share this URL only with staff who need scanner-only access."
                          />
                        </div>
                      )}

                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Active and recent check-in links</p>
                          <button
                            onClick={() => void fetchCheckinSessions(selectedEventId)}
                            className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                          >
                            <RefreshCw className={`w-4 h-4 text-slate-400 ${checkinSessionsLoading ? "animate-spin" : ""}`} />
                          </button>
                        </div>
                        {checkinSessions.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                            No check-in links created for this event yet.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {checkinSessions.map((session) => (
                              <div key={session.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-2.5">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900 truncate">{session.label}</p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    <StatusBadge tone={getCheckinSessionTone(session)}>
                                      {session.revoked_at ? "revoked" : session.is_active ? "active" : "expired"}
                                    </StatusBadge>
                                    {!session.revoked_at && (
                                      <InlineActionsMenu label="Manage Access" tone="neutral">
                                        <MenuActionItem
                                          onClick={() => void handleRevokeCheckinSession(session.id)}
                                          disabled={checkinSessionRevokingId === session.id}
                                          tone="rose"
                                        >
                                          {checkinSessionRevokingId === session.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                          <span className="font-medium">Revoke Link</span>
                                        </MenuActionItem>
                                      </InlineActionsMenu>
                                    )}
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Expires</p>
                                    <p className="mt-1 text-[11px] text-slate-700">{new Date(session.expires_at).toLocaleString()}</p>
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Last Used</p>
                                    <p className="mt-1 text-[11px] text-slate-700">{session.last_used_at ? new Date(session.last_used_at).toLocaleString() : "never"}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
          {activeTab === "inbox" && (
            <motion.div
              key="inbox"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="border-b border-slate-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">Public Inbox</h2>
                        <StatusBadge tone={publicInboxCounts.attention > 0 ? "rose" : "neutral"}>
                          {publicInboxCounts.attention > 0 ? `${publicInboxCounts.attention} need attention` : "No attention queue"}
                        </StatusBadge>
                      </div>
                      <StatusLine
                        className="mt-1"
                        items={[
                          `${publicInboxCounts.all} conversation${publicInboxCounts.all === 1 ? "" : "s"}`,
                          deferredPublicInboxQuery ? `${filteredPublicInboxConversations.length} match` : null,
                          selectedEvent ? selectedEvent.name : null,
                        ]}
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Human handoff requests and bot failures from the public event page land here first.
                      </p>
                    </div>
                    <button
                      onClick={() => void fetchPublicInboxConversations(selectedEventId)}
                      className="rounded-lg p-2 transition-colors hover:bg-slate-100"
                      aria-label="Refresh public inbox"
                    >
                      <RefreshCw className={`h-4 w-4 text-slate-400 ${publicInboxLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>

                  <div className="mt-3 flex flex-col gap-3">
                    <div className="relative min-w-0">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={publicInboxSearchQuery}
                        onChange={(event) => setPublicInboxSearchQuery(event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Search by attendee, sender ID, registration ID, contact, or last message"
                      />
                      {publicInboxSearchQuery && (
                        <button
                          onClick={() => setPublicInboxSearchQuery("")}
                          className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                          aria-label="Clear inbox search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {([
                        { id: "all", label: "All", count: publicInboxCounts.all },
                        { id: "attention", label: "Attention", count: publicInboxCounts.attention },
                        { id: "open", label: "Open", count: publicInboxCounts.open },
                        { id: "waiting-admin", label: "Waiting Admin", count: publicInboxCounts["waiting-admin"] },
                        { id: "waiting-user", label: "Waiting User", count: publicInboxCounts["waiting-user"] },
                        { id: "resolved", label: "Resolved", count: publicInboxCounts.resolved },
                      ] as Array<{ id: "all" | "attention" | PublicInboxConversationStatus; label: string; count: number }>).map((filter) => {
                        const isActive = publicInboxStatusFilter === filter.id;
                        return (
                          <button
                            key={filter.id}
                            onClick={() => setPublicInboxStatusFilter(filter.id)}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              isActive
                                ? "border-blue-200 bg-blue-50 text-blue-700"
                                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            <span>{filter.label}</span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? "bg-white/80 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                              {filter.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {publicInboxMessage && (
                      <p className={`text-xs ${
                        publicInboxMessage.toLowerCase().includes("failed") || publicInboxMessage.toLowerCase().includes("error")
                          ? "text-rose-600"
                          : "text-emerald-600"
                      }`}>
                        {publicInboxMessage}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid min-h-[34rem] grid-cols-1 xl:grid-cols-[minmax(0,0.85fr)_minmax(22rem,1.15fr)]">
                  <div className="border-b border-slate-100 xl:border-b-0 xl:border-r xl:border-slate-100">
                    {publicInboxLoading && publicInboxConversations.length === 0 ? (
                      <div className="flex h-full items-center justify-center px-6 py-16 text-center text-sm text-slate-400">
                        Loading public inbox conversations...
                      </div>
                    ) : filteredPublicInboxConversations.length === 0 ? (
                      <div className="flex h-full items-center justify-center px-6 py-16 text-center text-sm text-slate-400">
                        {deferredPublicInboxQuery || publicInboxStatusFilter !== "all"
                          ? "No public page conversations match this filter."
                          : "No public page conversations yet."}
                      </div>
                    ) : (
                      <div className="max-h-[34rem] overflow-y-auto">
                        {filteredPublicInboxConversations.map((conversation) => {
                          const isSelected = selectedPublicInboxSenderId === conversation.sender_id;
                          const attentionReasonLabel = getPublicInboxAttentionReasonLabel(conversation.attention_reason);
                          return (
                            <button
                              key={conversation.sender_id}
                              onClick={() => setSelectedPublicInboxSenderId(conversation.sender_id)}
                              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors ${
                                isSelected ? "bg-blue-50" : "hover:bg-slate-50"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-semibold text-slate-900">{conversation.participant_label}</p>
                                  <StatusBadge tone={getPublicInboxStatusTone(conversation.status)}>
                                    {getPublicInboxStatusLabel(conversation.status)}
                                  </StatusBadge>
                                  {conversation.needs_attention && <SelectionMarker className="text-rose-700" />}
                                </div>
                                <p className="mt-1 truncate font-mono text-[10px] text-blue-600">{conversation.sender_id}</p>
                                <p className="log-list-preview-2 mt-1 text-[13px] leading-5 text-slate-700">
                                  {conversation.last_message_text || "(no message body)"}
                                </p>
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500">
                                  <span>{conversation.last_message_type === "incoming" ? "visitor" : "bot"} · {conversation.message_count} msg</span>
                                  {conversation.registration_id && <span>{conversation.registration_id}</span>}
                                  {attentionReasonLabel && <span>{attentionReasonLabel}</span>}
                                </div>
                              </div>
                              <p className="shrink-0 whitespace-nowrap pl-2 text-[10px] text-slate-500">
                                {conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleString() : "-"}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 bg-slate-50">
                    {!activePublicInboxConversation ? (
                      <div className="flex h-full items-center justify-center px-8 py-16 text-center text-sm text-slate-400">
                        Select a public page conversation to inspect the thread and update follow-up status.
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[34rem] flex-col">
                        <div className="border-b border-slate-100 bg-white px-4 py-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-semibold text-slate-900">{activePublicInboxConversation.participant_label}</h3>
                                <StatusBadge tone={getPublicInboxStatusTone(activePublicInboxConversation.status)}>
                                  {getPublicInboxStatusLabel(activePublicInboxConversation.status)}
                                </StatusBadge>
                                {activePublicInboxConversation.needs_attention && (
                                  <StatusBadge tone="rose">
                                    {getPublicInboxAttentionReasonLabel(activePublicInboxConversation.attention_reason) || "Needs attention"}
                                  </StatusBadge>
                                )}
                              </div>
                              <p className="mt-1 break-all font-mono text-[11px] text-blue-600">{activePublicInboxConversation.sender_id}</p>
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                {activePublicInboxConversation.sender_phone && <span>{activePublicInboxConversation.sender_phone}</span>}
                                {activePublicInboxConversation.sender_email && <span>{activePublicInboxConversation.sender_email}</span>}
                                {activePublicInboxConversation.registration_id && <span>{activePublicInboxConversation.registration_id}</span>}
                                {activePublicInboxConversation.public_slug && <span>/events/{activePublicInboxConversation.public_slug}</span>}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => void fetchPublicInboxConversation(activePublicInboxConversation.sender_id, selectedEventId)}
                                className="rounded-lg p-2 transition-colors hover:bg-slate-100"
                                aria-label="Refresh conversation"
                              >
                                <RefreshCw className={`h-4 w-4 text-slate-400 ${publicInboxConversationLoading ? "animate-spin" : ""}`} />
                              </button>
                              {activePublicInboxConversation.public_slug && (
                                <a
                                  href={`/events/${encodeURIComponent(activePublicInboxConversation.public_slug)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex min-h-8 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Open Page
                                </a>
                              )}
                              {canManageRegistrations && activePublicInboxConversation.registration_id && (
                                <ActionButton
                                  tone="neutral"
                                  className="min-h-8 rounded-full px-3 py-1.5 text-[11px]"
                                  onClick={() => {
                                    setSelectedRegistrationId(activePublicInboxConversation.registration_id || "");
                                    handleNavigateToTab("registrations");
                                  }}
                                >
                                  <Users className="h-3.5 w-3.5" />
                                  Open Registration
                                </ActionButton>
                              )}
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            {(["open", "waiting-admin", "waiting-user", "resolved"] as PublicInboxConversationStatus[]).map((status) => (
                              <ActionButton
                                key={status}
                                tone={activePublicInboxConversation.status === status ? getPublicInboxStatusTone(status) : "neutral"}
                                className="min-h-8 rounded-full px-3 py-1.5 text-[11px]"
                                disabled={!canChangeRegistrationStatus || publicInboxStatusUpdating || activePublicInboxConversation.status === status}
                                onClick={() => void updatePublicInboxConversationStatus(status)}
                              >
                                {getPublicInboxStatusLabel(status)}
                              </ActionButton>
                            ))}
                          </div>
                          {!canChangeRegistrationStatus && (
                            <p className="mt-2 text-[11px] text-slate-500">
                              Viewer mode can inspect threads but cannot update conversation status.
                            </p>
                          )}
                        </div>

                        <div className="grid gap-3 border-b border-slate-100 bg-white px-4 py-3 md:grid-cols-3">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Last Incoming</p>
                            <p className="mt-1 text-[11px] text-slate-700">
                              {activePublicInboxConversation.last_incoming_at ? new Date(activePublicInboxConversation.last_incoming_at).toLocaleString() : "None yet"}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Last Outgoing</p>
                            <p className="mt-1 text-[11px] text-slate-700">
                              {activePublicInboxConversation.last_outgoing_at ? new Date(activePublicInboxConversation.last_outgoing_at).toLocaleString() : "None yet"}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Messages</p>
                            <p className="mt-1 text-[11px] text-slate-700">
                              {activePublicInboxConversation.message_count} total in this public thread
                            </p>
                          </div>
                        </div>

                        <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
                          {publicInboxConversationLoading && publicInboxConversationMessages.length === 0 ? (
                            <div className="flex h-full items-center justify-center py-12 text-center text-sm text-slate-400">
                              Loading conversation history...
                            </div>
                          ) : publicInboxConversationMessages.length === 0 ? (
                            <div className="flex h-full items-center justify-center py-12 text-center text-sm text-slate-400">
                              No messages in this conversation yet.
                            </div>
                          ) : (
                            publicInboxConversationMessages.map((message) => (
                              <ChatBubble
                                key={`${message.id || message.timestamp}-${message.type}`}
                                text={message.text}
                                type={message.type}
                                timestamp={message.timestamp}
                              />
                            ))
                          )}
                        </div>

                        <form className="border-t border-slate-100 bg-white px-4 py-4" onSubmit={handlePublicInboxReplySubmit}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Reply to Public Page</p>
                              <p className="mt-1 text-xs leading-5 text-slate-500">
                                This reply appears in the attendee's public event chat when they reopen or keep the page open.
                              </p>
                            </div>
                            <StatusBadge tone="neutral">Web chat</StatusBadge>
                          </div>
                          <div className="mt-3 flex flex-col gap-3">
                            <textarea
                              value={publicInboxReplyText}
                              onChange={(event) => setPublicInboxReplyText(event.target.value)}
                              rows={3}
                              placeholder="Type a reply for the attendee"
                              disabled={!canSendManualOverride || publicInboxReplySending}
                              className="min-h-[7rem] w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              style={{ fontFamily: "var(--font-edit)" }}
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              {!canSendManualOverride && (
                                <p className="text-xs text-slate-500">
                                  Viewer mode can inspect messages but cannot send replies.
                                </p>
                              )}
                              <button
                                type="submit"
                                disabled={!canSendManualOverride || publicInboxReplySending || !publicInboxReplyText.trim()}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {publicInboxReplySending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                Send Reply
                              </button>
                            </div>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          {activeTab === "logs" && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="border-b border-slate-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">Live Webhook Logs</h2>
                        {selectedEvent && (
                          <StatusBadge tone={getEventStatusTone(selectedEvent.effective_status)}>
                            {getEventStatusLabel(selectedEvent.effective_status)}
                          </StatusBadge>
                        )}
                      </div>
                      <StatusLine
                        className="mt-1"
                        items={[
                          `${messages.length}${logsHasMore ? "+" : ""} items`,
                          deferredLogListQuery ? `${filteredMessages.length} match` : null,
                          logsHasMore ? "older logs available" : null,
                        ]}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedEvent && (
                        <>
                          <HelpPopover label="Open reply guard details">
                            {eventOperatorGuard.body}
                          </HelpPopover>
                        </>
                      )}
                      <button
                        onClick={() => void handleLoadOlderLogs()}
                        disabled={!logsHasMore || logsLoadingMore || messages.length === 0}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {logsLoadingMore ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        Older
                      </button>
                      <button onClick={() => void fetchMessages(selectedEventId)} className="rounded-lg p-2 transition-colors hover:bg-slate-100">
                        <RefreshCw className="h-4 w-4 text-slate-400" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center">
                    <div className="relative min-w-0 flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={logListQuery}
                        onChange={(e) => setLogListQuery(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Search logs by sender, message, type, or trace detail"
                      />
                      {logListQuery && (
                        <button
                          onClick={() => setLogListQuery("")}
                          className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                          aria-label="Clear log search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      {selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open" && (
                        <span>Registration {getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}</span>
                      )}
                      <span>full message opens on the right</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 p-3 md:hidden">
                  {filteredMessages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                      {deferredLogListQuery ? "No logs match this search." : "No messages received yet."}
                    </div>
                  ) : (
                    filteredMessages.map((msg) => {
                      const lineTrace = parseLineTraceMessage(msg.text);
                      const auditMarker = lineTrace ? null : parseInternalLogMarker(msg.text);
                      const isSelected = selectedLogMessageId === msg.id;
                      const directionMeta = getLogDirectionMeta(msg.type);
                      return (
                        <div key={msg.id} id={getSearchTargetDomId("log", String(msg.id))}>
                          <button
                            onClick={() => setSelectedLogMessageId(msg.id)}
                            className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors ${
                              isSelected
                                ? "border-blue-200 bg-blue-50"
                                : isSearchFocused("log", String(msg.id))
                                ? "bg-blue-50"
                                : "hover:bg-slate-50"
                            } ${isSearchFocused("log", String(msg.id)) ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${directionMeta.className}`}>
                                {directionMeta.icon}
                                {directionMeta.label}
                              </span>
                              {msg.platform && <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{msg.platform}</span>}
                              {lineTrace && (
                                <span className="text-[11px] text-amber-700">
                                  Trace {formatTraceStatusLabel(lineTrace.status)}
                                </span>
                              )}
                              {auditMarker && (
                                <span className="text-[11px] text-slate-600">
                                  {auditMarker.actor} · {auditMarker.label}
                                </span>
                              )}
                              {isSelected && <SelectionMarker />}
                            </div>
                            <div className="mt-1.5 flex items-start justify-between gap-2">
                              <p className="chat-selectable log-list-preview-2 min-w-0 text-sm leading-5 text-slate-700">
                                {getLogMessageDisplayText(msg)}
                              </p>
                              <p className="shrink-0 text-[10px] text-slate-500">
                                {new Date(msg.timestamp).toLocaleString()}
                              </p>
                            </div>
                            <p className="mt-1 truncate font-mono text-[10px] text-blue-600">{msg.sender_id}</p>
                            {(msg.sender_name || msg.registration_id) && (
                              <p className="mt-0.5 truncate text-[10px] text-slate-500">
                                {msg.sender_name || "-"}{msg.registration_id ? ` • ${msg.registration_id}` : ""}
                              </p>
                            )}
                          </button>
                          {isSelected && (
                            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                              <p className="text-[11px] text-slate-600">
                                {directionMeta.label} via {msg.platform || "unknown"} · {new Date(msg.timestamp).toLocaleString()}
                              </p>
                              <p className="chat-selectable mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                                {lineTrace
                                  ? lineTrace.detail || formatTraceStatusLabel(lineTrace.status)
                                  : auditMarker
                                  ? auditMarker.marker === "manual-reply"
                                    ? auditMarker.detail
                                    : auditMarker.summary
                                  : msg.text}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="hidden overflow-x-auto md:block xl:hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                      <tr>
                        <th className="px-6 py-3">Timestamp</th>
                        <th className="px-6 py-3">Sender ID</th>
                        <th className="px-6 py-3">Message</th>
                        <th className="px-6 py-3">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredMessages.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                            {deferredLogListQuery ? "No logs match this search." : "No messages received yet."}
                          </td>
                        </tr>
                      ) : (
                        filteredMessages.map((msg) => {
                          const lineTrace = parseLineTraceMessage(msg.text);
                          const auditMarker = lineTrace ? null : parseInternalLogMarker(msg.text);
                          return (
                            <tr
                              key={msg.id}
                              id={getSearchTargetDomId("log", String(msg.id))}
                              onClick={() => setSelectedLogMessageId(msg.id)}
                              className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                                isSearchFocused("log", String(msg.id)) ? "bg-blue-50" : ""
                              }`}
                            >
                              <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                                {new Date(msg.timestamp).toLocaleString()}
                              </td>
                              <td className="px-6 py-4">
                                <p className="font-mono text-xs text-blue-600">{msg.sender_id}</p>
                                {(msg.sender_name || msg.registration_id) && (
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    {msg.sender_name || "-"}{msg.registration_id ? ` • ${msg.registration_id}` : ""}
                                  </p>
                                )}
                              </td>
                              <td className="px-6 py-4 max-w-md">
                                {lineTrace ? (
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">LINE</span>
                                      <span className="text-[11px] text-amber-700">Delivery Trace</span>
                                      <span className="text-[11px] font-semibold text-slate-600">
                                        {formatTraceStatusLabel(lineTrace.status)}
                                      </span>
                                    </div>
                                    <p className="chat-selectable text-sm text-slate-700 break-words">
                                      {lineTrace.detail || "-"}
                                    </p>
                                  </div>
                                ) : auditMarker ? (
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[11px] font-semibold text-slate-600">{auditMarker.actor}</span>
                                      <span className="text-[11px] text-slate-500">{auditMarker.label}</span>
                                    </div>
                                    <p className="chat-selectable text-sm text-slate-700 break-words">
                                      {auditMarker.marker === "manual-reply" ? auditMarker.detail : auditMarker.summary}
                                    </p>
                                  </div>
                                ) : (
                                  <span className="chat-selectable truncate block">{msg.text}</span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                  <span className={`inline-flex items-center gap-1 font-semibold ${getLogDirectionMeta(msg.type).className}`}>
                                    {getLogDirectionMeta(msg.type).icon}
                                    {getLogDirectionMeta(msg.type).label}
                                  </span>
                                  {msg.platform && <span className="font-medium uppercase tracking-[0.08em] text-slate-500">{msg.platform}</span>}
                                  {lineTrace && <span className="text-amber-700">Trace</span>}
                                  {auditMarker && <span className="text-slate-600">{auditMarker.label}</span>}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="hidden border-t border-slate-100 bg-slate-50 md:block xl:hidden">
                  {logInspectorPanel}
                </div>
                <div className="hidden xl:grid xl:min-h-[34rem] xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
                  <div className="min-w-0 border-r border-slate-100">
                    {filteredMessages.length === 0 ? (
                      <div className="flex h-full items-center justify-center px-6 py-16 text-center text-sm text-slate-400">
                        {deferredLogListQuery ? "No logs match this search." : "No messages received yet."}
                      </div>
                    ) : (
                      <div className="max-h-[34rem] overflow-y-auto">
                        {filteredMessages.map((msg) => {
                          const lineTrace = parseLineTraceMessage(msg.text);
                          const auditMarker = lineTrace ? null : parseInternalLogMarker(msg.text);
                          const isSelected = selectedLogMessageId === msg.id;
                          const directionMeta = getLogDirectionMeta(msg.type);
                          return (
                            <button
                              key={msg.id}
                              id={getSearchTargetDomId("log", String(msg.id))}
                              onClick={() => setSelectedLogMessageId(msg.id)}
                              className={`grid min-h-[5.1rem] w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 overflow-hidden border-b border-slate-100 px-4 py-2.5 text-left transition-colors ${
                                isSelected
                                  ? "bg-blue-50"
                                  : isSearchFocused("log", String(msg.id))
                                  ? "bg-blue-50"
                                  : "hover:bg-slate-50"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${directionMeta.className}`}>
                                    {directionMeta.icon}
                                    {directionMeta.label}
                                  </span>
                                  {msg.platform && <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">{msg.platform}</span>}
                                  {lineTrace && <span className="text-[10px] text-amber-700">Trace</span>}
                                  {auditMarker && <span className="text-[10px] text-slate-600">{auditMarker.actor}</span>}
                                  <p className="min-w-0 truncate text-[10px] font-mono text-blue-600">{msg.sender_id}</p>
                                </div>
                                {(msg.sender_name || msg.registration_id) && (
                                  <p className="mt-0.5 truncate text-[10px] text-slate-500">
                                    {msg.sender_name || "-"}{msg.registration_id ? ` • ${msg.registration_id}` : ""}
                                  </p>
                                )}
                                <p className="chat-selectable log-list-preview-2 mt-1 text-[13px] leading-5 text-slate-700">
                                  {getLogMessageDisplayText(msg)}
                                </p>
                              </div>
                              <p className="shrink-0 whitespace-nowrap pl-2 text-[10px] text-slate-500">
                                {new Date(msg.timestamp).toLocaleString()}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="log-inspector-surface min-w-0">
                    {logInspectorPanel}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <PageBanner tone="blue" icon={<SettingsIcon className="h-4 w-4" />}>
                AI defaults and webhook settings apply organization-wide by default. Channel credentials are now managed as shared workspace connections, then assigned explicitly to the selected event when needed.
              </PageBanner>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
                <div className="space-y-4 xl:col-span-8">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Bot className="w-5 h-5 text-blue-600" />
                          AI Defaults
                        </h3>
                        <p className="text-sm text-slate-500">Organization-wide prompt and baseline model, with an optional override for the selected event.</p>
                        <StatusLine
                          className="mt-1"
                          items={[
                            aiSettingsDirty ? "Unsaved changes" : "All changes saved",
                            llmModelsLoading ? "Syncing model list" : null,
                          ]}
                        />
                      </div>
                      <ActionButton
                        onClick={() => void saveAiSettings()}
                        disabled={saving}
                        tone="blue"
                        active
                        className="w-full text-sm sm:w-auto"
                      >
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save AI Policy
                      </ActionButton>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Organization Defaults</p>
                            <p className="mt-1 text-sm text-slate-500">Every event inherits these settings unless a specific override is enabled.</p>
                          </div>
                          <StatusLine items={["Applies to all events"]} />
                        </div>

                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase">Organization System Prompt</label>
                            <HelpPopover label="Open note for Organization System Prompt">
                              Organization-wide tone, safety rules, and escalation behavior belong here. Event-specific content should stay in Context.
                            </HelpPopover>
                          </div>
                          <textarea
                            value={settings.global_system_prompt}
                            onChange={(e) => setSettings({ ...settings, global_system_prompt: e.target.value })}
                            className="w-full h-40 rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            placeholder="Global operating rules for the bot across all events and channels."
                          />
                        </div>

                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase">Organization Default Model</label>
                            <HelpPopover label="Open note for Organization Default Model">
                              Keep one stable default model here unless an event has a real reason to override it.
                            </HelpPopover>
                          </div>
                          <select
                            value={settings.global_llm_model}
                            onChange={(e) => setSettings({ ...settings, global_llm_model: e.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="google/gemini-3-flash-preview">google/gemini-3-flash-preview (recommended)</option>
                            <option value="openrouter/auto">openrouter/auto</option>
                            {llmModels.map((model) => (
                              <option key={`global-${model.id}`} value={model.id}>
                                {model.id}
                                {model.context_length ? ` (${model.context_length.toLocaleString()} ctx)` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Selected Event Override</p>
                            <p className="mt-1 text-sm text-slate-500">
                              {selectedEvent
                                ? `${selectedEvent.name} can override the organization default model only when it truly needs different behavior.`
                                : "Select an event to manage overrides."}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={settings.llm_model ? "amber" : "neutral"}>
                              {settings.llm_model ? "Override active" : "Using org default"}
                            </StatusBadge>
                            {settings.llm_model && (
                              <ActionButton
                                onClick={() => setSettings({ ...settings, llm_model: "" })}
                                tone="neutral"
                                className="px-3 text-sm"
                              >
                                Reset to default
                              </ActionButton>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <label className="block text-xs font-bold text-slate-500 uppercase">Preset Override Model</label>
                              <HelpPopover label="Open note for Preset Override Model">
                                Set an event override only when this workspace truly needs different model behavior than the organization default.
                              </HelpPopover>
                            </div>
                            <select
                              value={settings.llm_model}
                              onChange={(e) => setSettings({ ...settings, llm_model: e.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">Use organization default model</option>
                              <option value="google/gemini-3-flash-preview">google/gemini-3-flash-preview</option>
                              <option value="openrouter/auto">openrouter/auto</option>
                              {llmModels.map((model) => (
                                <option key={`event-${model.id}`} value={model.id}>
                                  {model.id}
                                  {model.context_length ? ` (${model.context_length.toLocaleString()} ctx)` : ""}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <label className="block text-xs font-bold text-slate-500 uppercase">Advanced: Custom Model ID</label>
                              <HelpPopover label="Open note for Advanced Custom Model ID">
                                Leave this blank to inherit the organization default. When filled, only the selected event uses this specific model ID.
                              </HelpPopover>
                            </div>
                            <input
                              value={settings.llm_model}
                              onChange={(e) => setSettings({ ...settings, llm_model: e.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Paste a specific event model ID if needed."
                            />
                          </div>
                        </div>

                        <p className="text-xs text-slate-500">
                          This override is saved on the selected event only. Event-specific instructions still belong in Context or Event setup.
                        </p>
                      </div>

                      {llmModelsError && (
                        <p className="text-xs text-rose-600">{llmModelsError}</p>
                      )}
                      {settingsMessage && (
                        <p className={`text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                          {settingsMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Link2 className="w-5 h-5 text-blue-600" />
                          Workspace Channel Inventory
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          Configure connection credentials once here, then assign or move them into the selected event explicitly.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Configs</p>
                        <p className="mt-1 text-lg font-bold text-slate-900">{workspaceChannelCount}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Active</p>
                        <p className="mt-1 text-lg font-bold text-slate-900">{workspaceActiveChannelCount}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Platforms</p>
                        <p className="mt-1 text-lg font-bold text-slate-900">{workspaceChannelPlatformCount}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Events Wired</p>
                        <p className="mt-1 text-lg font-bold text-slate-900">{workspaceChannelEventCount}</p>
                      </div>
                    </div>

                    {workspaceChannelPreview.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                        {workspaceChannelCount === 0
                          ? "No channels configured anywhere in this workspace yet."
                          : "All configured channels currently belong to the selected event. Use Selected Event Channels below to manage them."}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {workspaceChannelPreview.map((channel) => {
                          const isSelected = setupSelectedChannelId === channel.id;
                          return (
                          <div
                            key={`workspace-${channel.id}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              focusSetupChannel(channel);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                focusSetupChannel(channel);
                              }
                            }}
                            className={`rounded-2xl border p-3 transition cursor-pointer ${
                              isSelected
                                ? "border-blue-200 bg-blue-50"
                                : "border-slate-200 bg-slate-50 hover:border-slate-300"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <ChannelPlatformLogo platform={channel.platform} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold leading-snug text-slate-900">{channel.display_name}</p>
                                  {isSelected && <SelectionMarker />}
                                </div>
                                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                                  {channel.platform_label || channel.platform}
                                </p>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {channel.event_id
                                    ? `Assigned to ${eventNameById.get(channel.event_id) || channel.event_id}`
                                    : "Currently unassigned"}
                                </p>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <ActionButton
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openChannelConfigDialog(channel);
                                    }}
                                    tone="blue"
                                    className="px-3 text-sm"
                                  >
                                    <PencilLine className="h-3.5 w-3.5" />
                                    Configure
                                  </ActionButton>
                                  <ActionButton
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleAssignChannelToSelectedEvent(channel);
                                    }}
                                    disabled={eventLoading || selectedEventChannelWritesLocked}
                                    tone="neutral"
                                    className="px-3 text-sm"
                                  >
                                    <Link2 className="h-3.5 w-3.5" />
                                    {channel.event_id ? "Move to Selected Event" : "Assign to Selected Event"}
                                  </ActionButton>
                                </div>
                              </div>
                            </div>
                          </div>
                        )})}
                      </div>
                    )}

                    {workspaceOtherEventChannels.length > workspaceChannelPreview.length && (
                      <p className="text-xs text-slate-500">
                        Showing {workspaceChannelPreview.length} of {workspaceOtherEventChannels.length} channels not currently assigned to the selected event.
                      </p>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Link2 className="w-5 h-5 text-blue-600" />
                          Selected Event Channels
                        </h3>
                        <StatusLine
                          className="mt-1"
                          items={[
                            `${visibleSelectedEventChannels.length} linked`,
                            selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : null,
                            selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open"
                              ? getRegistrationAvailabilityLabel(selectedEvent.registration_availability)
                              : null,
                          ]}
                        />
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels) && (
                          <p className="text-sm text-slate-500">These assignments currently apply to the selected event only. Use cards for quick status checks and routing control.</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels) && (
                          <ActionButton
                            onClick={() => openChannelConfigDialog()}
                            disabled={selectedEventChannelWritesLocked}
                            tone="blue"
                            active
                            className="px-3 text-sm"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            New Connection
                          </ActionButton>
                        )}
                        <CollapseIconButton
                          collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels)}
                          onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels)}
                        />
                      </div>
                    </div>

                    {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels) && (
                      <>
                        {selectedEvent && selectedEvent.registration_availability && selectedEvent.registration_availability !== "open" ? (
                          <InlineWarning tone="amber">
                            Channels remain connected, but closed-registration guardrails are active.
                          </InlineWarning>
                        ) : (
                          <InlineWarning tone={toBannerTone(eventOperatorGuard.tone)}>
                            {eventOperatorGuard.body}
                          </InlineWarning>
                        )}

                        {visibleSelectedEventChannels.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                            No channels assigned to this event yet. Use New Connection to create one, or assign an existing connection from Workspace Channel Inventory above.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                            {visibleSelectedEventChannels.map((channel) => {
                              const isSelected = setupSelectedChannel?.id === channel.id;
                              const isFocused = isSearchFocused("channel", channel.id);
                              const disableToggle = selectedEventChannelWritesLocked && !channel.is_active;
                              const tokenStatusMeta = getChannelTokenStatusMeta(channel);
                              const toggleLabel = disableToggle
                                ? "Locked"
                                : channel.is_active
                                ? "Disable"
                                : "Enable";
                              return (
                                <div
                                  key={channel.id}
                                  id={getSearchTargetDomId("channel", channel.id)}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => selectSetupChannel(channel)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      selectSetupChannel(channel);
                                    }
                                  }}
                                  className={`rounded-2xl border p-3 transition cursor-pointer ${
                                    isSelected
                                      ? "border-blue-200 bg-blue-50"
                                      : "border-slate-200 bg-slate-50 hover:border-slate-300"
                                  } ${isFocused ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                                >
                                  <div className="space-y-2.5">
                                    <div className="flex items-start gap-3">
                                      <ChannelPlatformLogo platform={channel.platform} />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-semibold leading-snug text-slate-900">{channel.display_name}</p>
                                          {isSelected && <SelectionMarker />}
                                        </div>
                                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                                          {channel.platform_label || channel.platform}
                                        </p>
                                        <p className="mt-1 text-[11px] font-mono text-slate-500 break-all">{channel.external_id}</p>
                                      </div>
                                    </div>
                                    <StatusLine
                                      items={[
                                        channel.connection_status ? `Connected ${channel.connection_status}` : "Connection incomplete",
                                        channel.is_active ? "Channel active" : "Channel inactive",
                                        <span className={`inline-flex items-center gap-1.5 ${tokenStatusMeta.className}`}>
                                          {tokenStatusMeta.icon}
                                          {tokenStatusMeta.label}
                                        </span>,
                                      ]}
                                    />
                                    {channel.missing_requirements && channel.missing_requirements.length > 0 && (
                                      <p className="text-xs text-amber-700">
                                        Missing: {channel.missing_requirements.join(", ")}
                                      </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                      <ActionButton
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openChannelConfigDialog(channel);
                                        }}
                                        tone="blue"
                                        className="px-3 text-sm"
                                      >
                                        <PencilLine className="h-3.5 w-3.5" />
                                        Configure
                                      </ActionButton>
                                      <ActionButton
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void handleUnassignChannelFromSelectedEvent(channel);
                                        }}
                                        disabled={eventLoading}
                                        tone="neutral"
                                        className="px-3 text-sm"
                                      >
                                        <Link2 className="h-3.5 w-3.5" />
                                        Remove from Event
                                      </ActionButton>
                                      <ActionButton
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void handleToggleChannel(channel);
                                        }}
                                        disabled={eventLoading || disableToggle}
                                        tone={disableToggle ? "neutral" : channel.is_active ? "amber" : "emerald"}
                                        className="px-3 text-sm"
                                      >
                                        <Power className="h-3.5 w-3.5" />
                                        {toggleLabel}
                                      </ActionButton>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {selectedEvent && selectedEventChannelWritesLocked && (
                          <p className="text-xs text-amber-700">
                            Archived, closed, or cancelled events cannot link or re-enable channels. You can still remove an assignment or disable an active channel if you want to stop replies entirely.
                          </p>
                        )}
                        {selectedEvent && !selectedEventChannelWritesLocked && selectedEvent.registration_availability && selectedEvent.registration_availability !== "open" && (
                          <p className="text-xs text-slate-500">
                            Channel wiring stays available, but this event currently responds with guardrails for <span className="font-semibold">{getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}</span> instead of accepting normal registrations.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-4 xl:col-span-4">
                  <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupWebhookConfig) ? "p-3 sm:p-3" : "space-y-4 p-4 sm:p-5"}`}>
                    <div className={`${isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupWebhookConfig) ? "mb-0" : "mb-4"} flex items-center justify-between gap-2`}>
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <SettingsIcon className="w-5 h-5 text-blue-600" />
                          Webhook & Sync
                        </h3>
                        {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupWebhookConfig) && (
                          <p className="text-sm text-slate-500">Organization-level endpoints live here. Selecting a channel card only changes which event assignment you are inspecting.</p>
                        )}
                      </div>
                      <CollapseIconButton
                        collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupWebhookConfig)}
                        onClick={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupWebhookConfig)}
                      />
                    </div>
                    {!isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupWebhookConfig) && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          {setupSelectedChannel ? (
                            <div className="space-y-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-start gap-3">
                                  <ChannelPlatformLogo platform={setupSelectedChannel.platform} className="h-11 w-11 rounded-2xl" />
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900">{setupSelectedChannel.display_name}</p>
                                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                                      {setupSelectedChannel.platform_label || setupSelectedChannel.platform}
                                    </p>
                                    <p className="mt-1 break-all text-xs font-mono text-slate-500">{setupSelectedChannel.external_id}</p>
                                  </div>
                                </div>
                                <ActionButton
                                  onClick={() => openChannelConfigDialog(setupSelectedChannel)}
                                  tone="blue"
                                  className="px-3 text-sm"
                                >
                                  <PencilLine className="h-3.5 w-3.5" />
                                  Configure
                                </ActionButton>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusLine
                                  items={[
                                    setupSelectedChannel.connection_status || "incomplete",
                                    setupSelectedChannel.is_active ? "active" : "inactive",
                                  ]}
                                />
                              </div>
                              {setupSelectedChannel.platform_description && (
                                <p className="text-xs text-slate-600">{setupSelectedChannel.platform_description}</p>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-slate-900">No channel selected</p>
                              <p className="text-xs text-slate-500">Assign the first event channel to load endpoint setup details here.</p>
                              <ActionButton
                                onClick={() => openChannelConfigDialog()}
                                tone="blue"
                                active
                                className="px-3 text-sm"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Assign Channel
                              </ActionButton>
                            </div>
                          )}
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                                Webhook Endpoint
                              </label>
                              <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                                <Link2 className="h-4 w-4 shrink-0 text-slate-400" />
                                <select
                                  value={selectedWebhookConfigKey}
                                  onChange={(e) => setSelectedWebhookConfigKey(e.target.value as WebhookConfigKey)}
                                  className="min-w-0 w-full bg-transparent text-sm font-medium outline-none"
                                >
                                  {setupWebhookItems.map((item) => (
                                    <option key={item.key} value={item.key}>
                                      {item.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <button
                              onClick={() => copyToClipboard(selectedWebhookConfigItem.value)}
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                              aria-label={`Copy ${selectedWebhookConfigItem.label}`}
                            >
                              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-400" />}
                              <span>Copy URL</span>
                            </button>
                          </div>
                          <div className="mt-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Selected Endpoint</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{selectedWebhookConfigItem.label}</p>
                          </div>
                          <textarea
                            readOnly
                            value={selectedWebhookConfigItem.value}
                            rows={4}
                            className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-mono leading-relaxed outline-none"
                          />
                          {selectedWebhookConfigItem.help ? (
                            <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600">
                              {selectedWebhookConfigItem.help}
                            </div>
                          ) : null}
                          {setupSelectedChannel?.platform === "web_chat" && (
                            <div className="mt-3 rounded-2xl border border-violet-100 bg-violet-50 p-3 space-y-2">
                              <p className="text-xs font-semibold text-violet-800">Web Chat Embed Snippet</p>
                              <pre className="overflow-x-auto rounded-lg bg-white border border-violet-100 p-3 text-[11px] leading-relaxed text-slate-700">
                                <code>{buildWebChatEmbedSnippet(appUrl, setupSelectedChannel.external_id)}</code>
                              </pre>
                              <div className="flex flex-wrap items-center gap-2">
                                <ActionButton
                                  onClick={() => copyToClipboard(buildWebChatEmbedSnippet(appUrl, setupSelectedChannel.external_id))}
                                  tone="violet"
                                >
                                  Copy Embed
                                </ActionButton>
                                <ActionButton
                                  onClick={() => copyToClipboard(`${appUrl}/api/webchat/config/${encodeURIComponent(setupSelectedChannel.external_id)}`)}
                                  tone="neutral"
                                >
                                  Copy Config URL
                                </ActionButton>
                              </div>
                            </div>
                          )}
                          <p className="mt-3 text-xs text-slate-500">
                            Endpoint list auto-filters by the selected channel platform.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <label className="block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Verify Token</label>
                            <StatusLine items={[webhookSettingsDirty ? "Unsaved" : "Saved"]} />
                          </div>
                          <div className="flex gap-2">
                            <input
                              value={settings.verify_token}
                              onChange={(e) => setSettings({ ...settings, verify_token: e.target.value })}
                              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <ActionButton
                              onClick={() => void saveWebhookSettings()}
                              tone="blue"
                              active
                              className="px-3"
                            >
                              <Save className="w-5 h-5" />
                              Save
                            </ActionButton>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              </div>
            </motion.div>
          )}
          {activeTab === "team" && (
            <motion.div
              key="team"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              {teamAccessPanel}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {channelConfigDialogOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-30 bg-slate-950/25 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeChannelConfigDialog}
            />
            <motion.aside
              className="app-overlay-surface fixed inset-y-0 right-0 z-40 flex w-[min(34rem,100vw)] flex-col border-l border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.2)]"
              initial={{ opacity: 0, x: 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.18 }}
            >
              <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Channel Config</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">
                      {editingChannelKey ? "Update Channel Connection" : "Create Channel Connection"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Save platform credentials once at workspace level. Event assignment is managed separately from the connection itself.
                    </p>
                  </div>
                  <button
                    onClick={closeChannelConfigDialog}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
                    aria-label="Close channel configuration"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
                <select
                  value={newChannelPlatform}
                  onChange={(e) => {
                    const platform = e.target.value as ChannelPlatform;
                    setNewChannelPlatform(platform);
                    setNewChannelConfig({});
                    if (platform === "line_oa") {
                      setNewPageId("");
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                >
                  <option value="facebook">Facebook</option>
                  <option value="line_oa">LINE OA</option>
                  <option value="instagram">Instagram</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="web_chat">Web Chat</option>
                </select>
                {selectedChannelPlatformDefinition && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 space-y-2">
                    <div className="flex items-start gap-3">
                      <ChannelPlatformLogo platform={selectedChannelPlatformDefinition.id} className="h-10 w-10 rounded-2xl" />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{selectedChannelPlatformDefinition.label}</p>
                        <p>{selectedChannelPlatformDefinition.description}</p>
                      </div>
                    </div>
                    <div className="space-y-1 text-xs text-slate-500">
                      {selectedChannelPlatformDefinition.notes.map((note) => (
                        <p key={`${selectedChannelPlatformDefinition.id}:${note}`}>{note}</p>
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  {editingChannel
                    ? editingChannel.event_id
                      ? <>Current assignment: <span className="font-semibold text-slate-800">{eventNameById.get(editingChannel.event_id) || editingChannel.event_id}</span>. Use Assign/Remove actions in Organization Setup to change routing.</>
                      : "Current assignment: unassigned. Use Assign to Selected Event when you want this connection to route into the active event."
                    : <>New connections are assigned to <span className="font-semibold text-slate-800">{selectedEvent?.name || "the selected event"}</span> as soon as you save them.</>}
                </div>
                <input
                  value={newPageName}
                  onChange={(e) => setNewPageName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Channel display name"
                />
                <input
                  value={newPageId}
                  onChange={(e) => setNewPageId(e.target.value)}
                  disabled={lineChannelIdAutoResolved}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                  placeholder={selectedChannelPlatformDefinition?.external_id_placeholder || "Channel external ID"}
                />
                {lineChannelIdAutoResolved && (
                  <p className="text-xs text-slate-500">
                    LINE Bot User ID (`U...`) is resolved automatically from the saved access token when you save this channel.
                  </p>
                )}
                {selectedChannelPlatformDefinition && (
                  <div className="flex justify-end">
                    <HelpPopover label={`Open note for ${selectedChannelPlatformDefinition.external_id_label}`}>
                      {selectedChannelPlatformDefinition.external_id_label}
                    </HelpPopover>
                  </div>
                )}
                {selectedChannelPlatformDefinition?.access_token_label && (
                  <>
                    <input
                      value={newPageAccessToken}
                      onChange={(e) => setNewPageAccessToken(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={selectedChannelPlatformDefinition.access_token_label || "Channel access token"}
                    />
                    {selectedChannelPlatformDefinition.access_token_help && (
                      <div className="flex justify-end">
                        <HelpPopover label={`Open note for ${selectedChannelPlatformDefinition.access_token_label}`}>
                          {selectedChannelPlatformDefinition.access_token_help}
                        </HelpPopover>
                      </div>
                    )}
                  </>
                )}
                {selectedChannelPlatformDefinition?.config_fields.map((field) => (
                  <div key={`${newChannelPlatform}:${field.key}`} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                        {field.label}
                        {field.required ? " Required" : ""}
                      </p>
                      {field.help ? (
                        <HelpPopover label={`Open note for ${field.label}`}>
                          {field.help}
                        </HelpPopover>
                      ) : null}
                    </div>
                    <input
                      value={newChannelConfig[field.key] || ""}
                      onChange={(e) => setNewChannelConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      type={field.secret ? "password" : "text"}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={field.placeholder || field.label}
                    />
                  </div>
                ))}
                {channelFormMissingRequirements.length > 0 && (
                  <p className="text-xs text-amber-700">
                    Missing before save: {channelFormMissingRequirements.join(", ")}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  Facebook, LINE OA, Instagram, WhatsApp, Telegram, and Web Chat are wired into live message handling right now.
                </p>
              </div>
              <div className="border-t border-slate-100 bg-white px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <ActionButton
                    onClick={closeChannelConfigDialog}
                    tone="neutral"
                  >
                    Cancel
                  </ActionButton>
                  <ActionButton
                    onClick={async () => {
                      const saved = await handleSaveChannel();
                      if (saved) {
                        closeChannelConfigDialog();
                      }
                    }}
                    disabled={
                      !selectedEventId
                      || (!lineChannelIdAutoResolved && !newPageId.trim())
                      || eventLoading
                      || (!editingChannelKey && selectedEventChannelWritesLocked)
                      || channelFormMissingRequirements.length > 0
                    }
                    tone="blue"
                    active
                    className="px-3"
                  >
                    {eventLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {editingChannelKey ? "Save Connection" : "Create + Assign"}
                  </ActionButton>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {canEditSettings && !isChatConsoleTab && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 hidden lg:block">
          <div className="mx-auto flex max-w-7xl justify-start px-6">
            <div className="pointer-events-auto flex items-end gap-2">
              {insightsPanelOpen && (
                <div className="app-floating-status w-[min(30rem,calc(100vw-10rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.12)] backdrop-blur">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Workspace Insights</p>
                  <StatusLine
                    className="mt-1"
                    items={[
                      selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : "No selected event",
                      hasAnyUnsavedSettings ? "Unsaved changes" : "Saved",
                      <>Model {activeLlmModel}</>,
                    ]}
                  />
                  <CompactStatRow
                    className="mt-2"
                    stats={[
                      { label: "Event tokens", value: formatCompactNumber(selectedEventUsage?.total_tokens || 0), tone: "blue" },
                      { label: "Total cost", value: formatUsdCost(overallLlmUsage?.estimated_cost_usd || 0), tone: "neutral" },
                    ]}
                  />
                </div>
              )}
              <ActionButton
                onClick={() => setInsightsPanelOpen((open) => !open)}
                tone={insightsPanelOpen ? "blue" : "neutral"}
                className="h-11 rounded-2xl px-3 text-sm"
              >
                <Activity className="h-4 w-4" />
                {insightsPanelOpen ? "Hide Insights" : "Insights"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {globalSearchOpen && (
          <motion.div
            className="fixed inset-0 z-30 bg-slate-950/25 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setGlobalSearchOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {globalSearchOpen && (
          <motion.aside
            className="app-overlay-surface fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-40 max-h-[min(80dvh,42rem)] overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.2)] sm:inset-x-auto sm:right-6 sm:w-[min(42rem,calc(100vw-3rem))]"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Global Search</p>
                  <div className="relative mt-3">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      ref={globalSearchInputRef}
                      value={globalSearchQuery}
                      onChange={(e) => setGlobalSearchQuery(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Search events, channels, attendees, documents, or logs"
                    />
                    {globalSearchQuery && (
                      <button
                        onClick={() => setGlobalSearchQuery("")}
                        className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                        aria-label="Clear global search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Events and channels search across the workspace. Attendees, documents, and logs follow the active event.
                  </p>
                </div>
                <button
                  onClick={() => setGlobalSearchOpen(false)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
                  aria-label="Close global search"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="max-h-[calc(min(80dvh,42rem)-7.5rem)] space-y-4 overflow-y-auto px-5 py-4">
              {!deferredGlobalSearchQuery ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  Start typing to search across events, current registrations, channels, documents, and logs.
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Events</p>
                      <StatusBadge tone="neutral">{globalEventResults.length}</StatusBadge>
                    </div>
                    {globalEventResults.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400">No event matches.</div>
                    ) : (
                      globalEventResults.map((event) => (
                        <button
                          key={event.id}
                          onClick={() => handleGlobalSearchSelect("event", event.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{event.name}</p>
                            <p className="mt-1 truncate text-xs text-slate-500">{event.slug}</p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                            {event.registration_availability && event.registration_availability !== "open" && event.effective_status !== "closed" && event.effective_status !== "cancelled" && event.effective_status !== "archived" && (
                              <StatusBadge tone={getRegistrationAvailabilityTone(event.registration_availability)}>
                                {getRegistrationAvailabilityLabel(event.registration_availability)}
                              </StatusBadge>
                            )}
                            <StatusBadge tone={getEventStatusTone(event.effective_status)}>
                              {getEventStatusLabel(event.effective_status)}
                            </StatusBadge>
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Registrations</p>
                      <StatusBadge tone="neutral">{globalRegistrationResults.length}</StatusBadge>
                    </div>
                    {globalRegistrationResults.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400">No attendee matches in the current event.</div>
                    ) : (
                      globalRegistrationResults.map((reg) => (
                        <button
                          key={reg.id}
                          onClick={() => handleGlobalSearchSelect("registration", reg.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{reg.first_name} {reg.last_name}</p>
                            <p className="mt-1 truncate font-mono text-xs text-blue-600">{reg.id}</p>
                          </div>
                          <StatusBadge tone={getRegistrationStatusTone(reg.status)}>{reg.status}</StatusBadge>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Channels</p>
                      <StatusBadge tone="neutral">{globalChannelResults.length}</StatusBadge>
                    </div>
                    {globalChannelResults.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400">No channel matches.</div>
                    ) : (
                      globalChannelResults.map((channel) => (
                        <button
                          key={channel.id}
                          onClick={() => handleGlobalSearchSelect("channel", channel.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{channel.display_name}</p>
                            <p className="mt-1 truncate text-xs text-slate-500">{channel.platform_label || channel.platform} • {channel.external_id}</p>
                          </div>
                          <StatusBadge tone={channel.is_active ? "emerald" : "neutral"}>{channel.is_active ? "active" : "inactive"}</StatusBadge>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Documents</p>
                      <StatusBadge tone="neutral">{globalDocumentResults.length}</StatusBadge>
                    </div>
                    {globalDocumentResults.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400">No document matches in this workspace.</div>
                    ) : (
                      globalDocumentResults.map((document) => (
                        <button
                          key={document.id}
                          onClick={() => handleGlobalSearchSelect("document", document.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{document.title}</p>
                            <p className="mt-1 truncate text-xs text-slate-500">{document.source_type} • {document.chunk_count || 0} chunks</p>
                          </div>
                          <StatusBadge tone={document.is_active ? "emerald" : "neutral"}>{document.is_active ? "active" : "disabled"}</StatusBadge>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Logs</p>
                      <StatusBadge tone="neutral">{globalLogResults.length}</StatusBadge>
                    </div>
                    {globalLogResults.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400">No log matches in this workspace.</div>
                    ) : (
                      globalLogResults.map((message) => (
                        <button
                          key={message.id}
                          onClick={() => handleGlobalSearchSelect("log", String(message.id))}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{message.type === "incoming" ? "Incoming Message" : "Outgoing Message"}</p>
                            <p className="mt-1 truncate text-xs text-slate-500">{message.sender_id}</p>
                          </div>
                          <StatusBadge tone={message.type === "incoming" ? "emerald" : "blue"}>{message.type}</StatusBadge>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {helpContent && !isChatConsoleTab && (
        <>
          <AnimatePresence>
            {helpOpen && (
              <motion.div
                className="fixed inset-0 z-30 bg-slate-950/20 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setHelpOpen(false)}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {helpOpen && (
              <motion.aside
                className="app-overlay-surface fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 max-h-[min(70dvh,34rem)] overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.2)] sm:inset-x-auto sm:right-6 sm:w-[min(30rem,calc(100vw-3rem))]"
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ duration: 0.18 }}
              >
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Help Overlay</p>
                      <h2 className="mt-1 text-lg font-semibold text-slate-900">{helpContent.title}</h2>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600">{helpContent.summary}</p>
                    </div>
                    <button
                      onClick={() => setHelpOpen(false)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
                      aria-label="Close help"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="max-h-[calc(min(70dvh,34rem)-9rem)] space-y-3 overflow-y-auto px-5 py-4">
                  {helpContent.points.map((point) => (
                    <div key={point.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">{point.label}</p>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">{point.body}</p>
                    </div>
                  ))}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          {!channelConfigDialogOpen && (
            <button
              onClick={() => setHelpOpen((open) => !open)}
              className={`fixed bottom-[calc(0.9rem+env(safe-area-inset-bottom))] right-3 z-40 inline-flex h-12 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold shadow-lg transition-all sm:right-6 ${
                helpOpen
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-blue-200 bg-white text-blue-700 hover:border-blue-300 hover:bg-blue-50"
              }`}
              aria-expanded={helpOpen}
              aria-label={helpOpen ? "Close help overlay" : "Open contextual help"}
            >
              {helpOpen ? <X className="h-4 w-4" /> : <CircleHelp className="h-4 w-4" />}
              <span className="hidden sm:inline">{helpOpen ? "Close Help" : "Help"}</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
