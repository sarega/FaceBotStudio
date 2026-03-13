import { useDeferredValue, useState, useEffect, useRef, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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
  CircleHelp,
  Eye,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  PencilLine,
  Power,
  Phone,
  ImagePlus,
  X,
} from "lucide-react";
import { getAdminAgentResponse, getChatResponse, type ChatPart } from "./services/gemini";
import { AppOverlays } from "./components/overlays/AppOverlays";
import { ChatBubble } from "./components/ChatBubble";
import { EmailHtmlEditor } from "./components/EmailHtmlEditor";
import { Ticket } from "./components/Ticket";
import { AdminWorkspaceFrame } from "./components/layout/AdminWorkspaceFrame";
import { AdminWorkspaceHeader } from "./components/layout/AdminWorkspaceHeader";
import { AdminWorkspaceSidebar } from "./components/layout/AdminWorkspaceSidebar";
import { WorkspaceInsightsDock } from "./components/layout/WorkspaceInsightsDock";
import {
  ActionButton,
  AdminAgentDashboardMeter,
  AdminAgentDashboardMiniStat,
  ChannelPlatformLogo,
  CollapseIconButton,
  CompactStatRow,
  CopyField,
  HelpPopover,
  InlineActionsMenu,
  InlineWarning,
  InspectorSection,
  MenuActionItem,
  MenuActionLink,
  PageBanner,
  PublicContactActionLink,
  SelectionMarker,
  StatusBadge,
  StatusLine,
} from "./components/shared/AppUi";
import { LoadingScreen } from "./components/shared/LoadingScreen";
import { AuthScreen } from "./features/auth/components/AuthScreen";
import { AgentConsoleScreen } from "./features/agent/components/AgentConsoleScreen";
import { AgentSetupScreen } from "./features/agent/components/AgentSetupScreen";
import { CheckinAccessRoute } from "./features/checkin/components/CheckinAccessRoute";
import { CheckinScreen } from "./features/checkin/components/CheckinScreen";
import { ContextScreen } from "./features/context/components/ContextScreen";
import { EventWorkspaceScreen } from "./features/event/components/EventWorkspaceScreen";
import { EventWorkspacePanel } from "./features/event-workspace/components/EventWorkspacePanel";
import { EventMailScreen } from "./features/mail/components/EventMailScreen";
import { PublicInboxScreen } from "./features/inbox/components/PublicInboxScreen";
import { LogsScreen } from "./features/logs/components/LogsScreen";
import { PublicEventPage as PublicEventPageScreen } from "./features/public-event/components/PublicEventPage";
import { RegistrationsScreen } from "./features/registrations/components/RegistrationsScreen";
import { SettingsScreen } from "./features/settings/components/SettingsScreen";
import { TestConsoleScreen } from "./features/test/components/TestConsoleScreen";
import { TeamAccessPanel } from "./features/team/components/TeamAccessPanel";
import { AdminEmailStatusResponse, AdminEmailTestResponse, AuthUser, ChannelAccountRecord, ChannelPlatform, ChannelPlatformDefinition, CheckinAccessSession, CheckinSessionRecord, EmbeddingPreviewResponse, EventDocumentChunkRecord, EventDocumentRecord, EventRecord, EventStatus, ImageAttachment, LlmUsageSummary, Message, PublicEventChatHistoryResponse, PublicEventChatResponse, PublicEventPageResponse, PublicEventRegistrationResponse, PublicInboxConversationDetailResponse, PublicInboxConversationStatus, PublicInboxConversationSummary, PublicInboxReplyResponse, RetrievalDebugResponse, Settings, UserRole } from "./types";
import { EMAIL_TEMPLATE_DEFAULTS, EMAIL_TEMPLATE_KIND_OPTIONS, getEmailTemplateSettingKey, replaceEmailTemplateTokens, type EmailTemplateKind } from "./lib/emailTemplateCatalog";
import { buildEventLocationSummary, buildGoogleMapsEmbedUrl, formatEventLocationCompact, resolveEventMapUrl } from "./lib/eventLocation";
import { PUBLIC_SUMMARY_MAX_CHARS, countPublicSummaryChars, resolveEnglishPublicSlug, resolvePublicSummary, sanitizeEnglishSlugInput, truncatePublicSummary } from "./lib/publicEventPage";

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
  attachments: ImageAttachment[];
  serverMessageId?: number;
};

const PUBLIC_PAGE_QR_SIZE = 960;
const PUBLIC_PAGE_QR_MARGIN = 2;

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
type DirtyNavigationSectionId = "event" | "mail" | "context" | "setup" | "agent";

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
  attachments?: AdminAgentImageAttachment[];
  actionName?: string;
  actionSource?: "llm" | "rule";
  ticketPngUrl?: string;
  ticketSvgUrl?: string;
  csvDownloadUrl?: string;
};

type AdminAgentImageAttachment = {
  id: string;
  kind: "image";
  url: string;
  absolute_url?: string;
  mime_type?: string;
  name?: string;
  size_bytes?: number;
};

type PendingAdminAgentImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type PendingPublicChatImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type PendingTestImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type AdminAgentCommandTemplate = {
  id: string;
  label: string;
  command: string;
  note: string;
  keywords: string[];
  autoSendWithPendingImages?: boolean;
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
    id: "image-replace-poster",
    label: "Replace Current Poster",
    command: "Replace the current poster for this event with the attached image and update event_public_poster_url to use it immediately.",
    note: "Swap the poster for the currently selected event.",
    keywords: ["image", "poster", "replace", "current", "cover"],
    autoSendWithPendingImages: true,
  },
  {
    id: "image-extract-details",
    label: "Extract Poster Details Only",
    command: "Read the attached poster and summarize a draft event title, date, time, venue, room, and short description without creating or updating any event yet.",
    note: "Extract poster information only. Do not create or edit an event.",
    keywords: ["image", "poster", "extract", "details", "ocr", "summary"],
    autoSendWithPendingImages: true,
  },
  {
    id: "image-use-as-poster",
    label: "Use Attached Image as Poster",
    command: "Use the most recently attached image as the poster for this event and update event_public_poster_url right away.",
    note: "Apply the attached image as the current event poster immediately.",
    keywords: ["image", "poster", "cover", "attached"],
    autoSendWithPendingImages: true,
  },
  {
    id: "image-create-event",
    label: "Create Event From Poster",
    command: "Create a new event draft from the attached poster. Extract the event name, date, time, venue, and readable details from the image, then use that image as the poster. If key details are unclear, ask me a short follow-up question.",
    note: "Have the agent read the poster and create an event draft automatically.",
    keywords: ["image", "poster", "create", "event", "extract", "ocr"],
    autoSendWithPendingImages: true,
  },
  {
    id: "list-events",
    label: "List All Events",
    command: "list events",
    note: "List every event available under the current policy scope.",
    keywords: ["event", "list", "all", "workspace"],
  },
  {
    id: "list-events-operational",
    label: "List Operational Events",
    command: "list events type:operational",
    note: "Show only active, pending, and inactive events.",
    keywords: ["event", "operational", "active", "pending", "inactive", "workspace"],
  },
  {
    id: "list-events-pending",
    label: "List Pending Events",
    command: "list events status:pending",
    note: "Show only events that have not started yet.",
    keywords: ["event", "pending", "upcoming"],
  },
  {
    id: "list-events-history",
    label: "List History Events",
    command: "list events type:history",
    note: "Show closed, cancelled, and archived events.",
    keywords: ["event", "history", "closed", "cancelled", "archived"],
  },
  {
    id: "find-event",
    label: "Find Event",
    command: 'find_event query="Clearing Day 2"',
    note: "Search for an event by part of its name.",
    keywords: ["event", "find", "search"],
  },
  {
    id: "event-overview",
    label: "Event Overview",
    command: "get_event_overview",
    note: "Review event status, schedule, venue, rules, and registration totals.",
    keywords: ["overview", "status", "summary"],
  },
  {
    id: "search-system",
    label: "Search System",
    command: 'search_system query="Sukhumvit"',
    note: "Search across the full system and all events.",
    keywords: ["global", "search", "cross", "system"],
  },
  {
    id: "list-registrations",
    label: "List Registrations",
    command: "list_registrations limit=50",
    note: "List the latest registrations for the current event.",
    keywords: ["registration", "list", "attendees"],
  },
  {
    id: "list-registrations-offset",
    label: "List More (Offset)",
    command: "list_registrations limit=50 offset=50",
    note: "Load the next page of registrations from the prior result set.",
    keywords: ["offset", "pagination", "more"],
  },
  {
    id: "count-registrations",
    label: "Count Registrations",
    command: "count_registrations",
    note: "Count registrations in total and by status.",
    keywords: ["count", "totals"],
  },
  {
    id: "find-registration-name",
    label: "Find By Name",
    command: 'find_registration full_name="John Smith"',
    note: "Find a registration by attendee full name.",
    keywords: ["find", "name", "registration"],
  },
  {
    id: "find-registration-id",
    label: "Find By Registration ID",
    command: "find_registration registration_id=REG-XXXXXX",
    note: "Find a registration by registration ID.",
    keywords: ["reg", "id", "lookup"],
  },
  {
    id: "create-registration",
    label: "Create Registration",
    command: 'create_registration first_name="John" last_name="Smith" phone="0890000000" email="john@example.com"',
    note: "Create a new attendee registration.",
    keywords: ["create", "register", "new attendee"],
  },
  {
    id: "set-registration-status",
    label: "Set Registration Status",
    command: "set_registration_status registration_id=REG-XXXXXX status=checked-in",
    note: "Change the status of a registration.",
    keywords: ["status", "checkin", "cancel"],
  },
  {
    id: "timeline",
    label: "Registration Timeline",
    command: "get_registration_timeline registration_id=REG-XXXXXX",
    note: "View the registration's chat and action history.",
    keywords: ["timeline", "history", "chat"],
  },
  {
    id: "view-ticket",
    label: "View Ticket (Admin)",
    command: "view_ticket registration_id=REG-XXXXXX",
    note: "Preview a ticket for admin use without sending it to the user.",
    keywords: ["ticket", "preview", "admin"],
  },
  {
    id: "resend-ticket",
    label: "Resend Ticket To User",
    command: "resend_ticket registration_id=REG-XXXXXX sender_id=USER_SENDER_ID",
    note: "Resend the ticket through the user's original channel.",
    keywords: ["ticket", "resend", "send user"],
  },
  {
    id: "resend-email",
    label: "Resend Email",
    command: "resend_email registration_id=REG-XXXXXX",
    note: "Resend the confirmation email.",
    keywords: ["email", "resend"],
  },
  {
    id: "export-csv",
    label: "Export CSV",
    command: "export_registrations_csv",
    note: "Export the full registration list as CSV.",
    keywords: ["csv", "export", "excel", "file"],
  },
  {
    id: "send-message",
    label: "Send Message To Sender",
    command: 'send_message_to_sender sender_id=USER_SENDER_ID message="Your ticket has been resent."',
    note: "Send a manual message to the user.",
    keywords: ["message", "sender", "manual"],
  },
  {
    id: "retry-bot",
    label: "Retry Bot",
    command: "retry_bot sender_id=USER_SENDER_ID",
    note: "Resume the bot in the existing thread.",
    keywords: ["retry", "stuck", "resume"],
  },
  {
    id: "update-event-status",
    label: "Update Event Status",
    command: "update_event_status status=active",
    note: "Change the event status, for example active, inactive, pending, or cancelled.",
    keywords: ["event", "status", "active", "inactive"],
  },
  {
    id: "update-event-context",
    label: "Update Event Context",
    command: 'update_event_context mode=replace context="Updated event details..."',
    note: "Update the event context text.",
    keywords: ["context", "update", "event", "details"],
  },
  {
    id: "event-override",
    label: "Cross-Event Scope",
    command: "/event evt_xxx get_event_overview",
    note: "Run a command against a different event by specifying its event ID.",
    keywords: ["event", "override", "scope", "cross-event"],
  },
];
const ADMIN_AGENT_CONSOLE_QUICK_TEMPLATE_IDS = [
  "list-events",
  "list-events-operational",
  "list-events-pending",
  "list-events-history",
  "event-overview",
] as const;
const ADMIN_AGENT_IMAGE_QUICK_TEMPLATE_IDS = [
  "image-replace-poster",
  "image-extract-details",
  "image-use-as-poster",
  "image-create-event",
] as const;
const DIRTY_NAVIGATION_SECTION_LABELS: Record<DirtyNavigationSectionId, string> = {
  event: "Event",
  mail: "Mail",
  context: "Context",
  setup: "Setup",
  agent: "Agent",
};
const APP_TAB_LABELS: Record<AppTab, string> = {
  event: "Event",
  mail: "Mail",
  design: "Context",
  test: "Test",
  agent: "Agent",
  logs: "Logs",
  settings: "Setup",
  team: "Team",
  registrations: "Registrations",
  checkin: "Check-in",
  inbox: "Inbox",
};

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
const ADMIN_AGENT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const ADMIN_AGENT_ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PUBLIC_CHAT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const PUBLIC_CHAT_ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
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

function normalizeImageAttachments(value: unknown) {
  if (!Array.isArray(value)) return [] as ImageAttachment[];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const attachment = item as Record<string, unknown>;
      const url = typeof attachment.url === "string" ? attachment.url.trim() : "";
      if (!url) return null;
      return {
        id: typeof attachment.id === "string" ? attachment.id : undefined,
        kind: "image" as const,
        url,
        absolute_url: typeof attachment.absolute_url === "string" && attachment.absolute_url.trim() ? attachment.absolute_url : null,
        mime_type: typeof attachment.mime_type === "string" && attachment.mime_type.trim() ? attachment.mime_type : null,
        name: typeof attachment.name === "string" && attachment.name.trim() ? attachment.name : null,
        size_bytes: Number.isFinite(Number(attachment.size_bytes)) ? Number(attachment.size_bytes) : null,
      } satisfies ImageAttachment;
    })
    .filter(Boolean) as ImageAttachment[];
}

function extractImageAttachmentsFromParts(
  parts: Array<{ image?: unknown } | null | undefined>,
) {
  return normalizeImageAttachments(
    parts
      .map((part) => part?.image || null)
      .filter(Boolean),
  );
}

function createPublicChatMessage(
  role: PublicChatMessage["role"],
  text: string,
  options?: {
    mapUrl?: string;
    tickets?: PublicEventChatResponse["tickets"];
    attachments?: ImageAttachment[];
    timestamp?: string;
    serverMessageId?: number;
  },
): PublicChatMessage {
  const timestamp = options?.timestamp || new Date().toISOString();
  return {
    id: `${role}:${timestamp}:${Math.random().toString(36).slice(2, 10)}`,
    role,
    text,
    timestamp,
    mapUrl: options?.mapUrl || "",
    tickets: Array.isArray(options?.tickets) ? options?.tickets : [],
    attachments: normalizeImageAttachments(options?.attachments),
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
    const attachments = normalizeImageAttachments(row.attachments);
    const attachmentSignature = attachments.map((attachment) => attachment.url).join("|");
    const alreadyExists = next.some((message) =>
      (typeof rowId === "number" && typeof message.serverMessageId === "number" && message.serverMessageId === rowId)
      || (
        message.role === role
        && message.text.trim() === text.trim()
        && message.attachments.map((attachment) => attachment.url).join("|") === attachmentSignature
        && Math.abs(new Date(message.timestamp).getTime() - new Date(timestamp).getTime()) < 15_000
      ),
    );
    if (alreadyExists) continue;
    next.push(createPublicChatMessage(role, text, {
      attachments,
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
          attachments: normalizeImageAttachments(row.attachments),
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
          const attachments = Array.isArray(row.attachments)
            ? row.attachments
                .filter((attachment) => attachment && typeof attachment === "object")
                .map((attachment) => {
                  const value = attachment as Record<string, unknown>;
                  const url = typeof value.url === "string" ? value.url : "";
                  if (!url) return null;
                  return {
                    id: typeof value.id === "string" ? value.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                    kind: "image" as const,
                    url,
                    absolute_url: typeof value.absolute_url === "string" ? value.absolute_url : "",
                    mime_type: typeof value.mime_type === "string" ? value.mime_type : "",
                    name: typeof value.name === "string" ? value.name : "",
                    size_bytes: Number.isFinite(Number(value.size_bytes)) ? Number(value.size_bytes) : undefined,
                  } satisfies AdminAgentImageAttachment;
                })
                .filter(Boolean) as AdminAgentImageAttachment[]
            : [];
          if (!role || !timestamp || (!text && attachments.length === 0)) return null;
          const actionSource = row.actionSource === "rule" ? "rule" : "llm";
          const ticketPngUrl = typeof row.ticketPngUrl === "string" ? row.ticketPngUrl : "";
          const ticketSvgUrl = typeof row.ticketSvgUrl === "string" ? row.ticketSvgUrl : "";
          const csvDownloadUrl = typeof row.csvDownloadUrl === "string" ? row.csvDownloadUrl : "";
          return {
            role,
            text,
            timestamp,
            attachments,
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

const RECOMMENDED_ADMIN_AGENT_PROMPT = [
  "You are an internal Admin Operations Agent for Meetrix.",
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
        ? truncatePublicSummary(data.event_public_summary)
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
  const [publicChatPendingImages, setPublicChatPendingImages] = useState<PendingPublicChatImageAttachment[]>([]);
  const publicChatBodyRef = useRef<HTMLDivElement | null>(null);
  const publicChatFileInputRef = useRef<HTMLInputElement | null>(null);
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
  const [testMessages, setTestMessages] = useState<{ role: "user" | "model", parts: ChatPart[], timestamp: string }[]>([]);
  const [inputText, setInputText] = useState("");
  const [testPendingImages, setTestPendingImages] = useState<PendingTestImageAttachment[]>([]);
  const [testAttachmentError, setTestAttachmentError] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [adminAgentMessages, setAdminAgentMessages] = useState<AdminAgentChatMessage[]>([]);
  const [adminAgentInputText, setAdminAgentInputText] = useState("");
  const [adminAgentPendingImages, setAdminAgentPendingImages] = useState<PendingAdminAgentImageAttachment[]>([]);
  const [adminAgentAttachmentError, setAdminAgentAttachmentError] = useState("");
  const [adminCommandPaletteOpen, setAdminCommandPaletteOpen] = useState(false);
  const [adminCommandPaletteQuery, setAdminCommandPaletteQuery] = useState("");
  const [adminAgentTyping, setAdminAgentTyping] = useState(false);
  const [adminAgentDashboard, setAdminAgentDashboard] = useState<AdminAgentDashboardResponse | null>(null);
  const [adminAgentDashboardLoading, setAdminAgentDashboardLoading] = useState(false);
  const [adminAgentDashboardError, setAdminAgentDashboardError] = useState("");
  const [adminAgentDashboardOpen, setAdminAgentDashboardOpen] = useState(false);
  const [dirtyNavigationDialog, setDirtyNavigationDialog] = useState<{
    open: boolean;
    nextTab: AppTab | null;
    nextEventId: string;
    dirtySections: DirtyNavigationSectionId[];
    saving: boolean;
    error: string;
  }>({
    open: false,
    nextTab: null,
    nextEventId: "",
    dirtySections: [],
    saving: false,
    error: "",
  });
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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
  const adminAgentImageInputRef = useRef<HTMLInputElement | null>(null);
  const testImageInputRef = useRef<HTMLInputElement | null>(null);
  const publicChatPendingImagesRef = useRef<PendingPublicChatImageAttachment[]>([]);
  const adminCommandPaletteRef = useRef<HTMLDivElement | null>(null);
  const adminCommandPaletteSearchInputRef = useRef<HTMLInputElement | null>(null);
  const adminAgentHistoryLoadedKeyRef = useRef("");
  const adminAgentPendingImagesRef = useRef<PendingAdminAgentImageAttachment[]>([]);
  const testPendingImagesRef = useRef<PendingTestImageAttachment[]>([]);
  const dirtyNavigationActionRef = useRef<null | (() => void)>(null);
  const desktopNotifyBootstrappedRef = useRef(false);
  const desktopNotifyLastAuditIdRef = useRef(0);
  selectedEventIdRef.current = selectedEventId;
  selectedPublicInboxSenderIdRef.current = selectedPublicInboxSenderId;
  publicChatLastMessageIdRef.current = publicChatLastMessageId;
  settingsRef.current = settings;
  adminAgentPendingImagesRef.current = adminAgentPendingImages;
  publicChatPendingImagesRef.current = publicChatPendingImages;
  testPendingImagesRef.current = testPendingImages;

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
  const adminAgentQuickTemplateIds = [...ADMIN_AGENT_CONSOLE_QUICK_TEMPLATE_IDS];
  const adminAgentConsoleQuickTemplates = adminAgentQuickTemplateIds
    .map((id) => ADMIN_AGENT_COMMAND_TEMPLATES.find((template) => template.id === id) || null)
    .filter((template): template is AdminAgentCommandTemplate => Boolean(template));
  const adminAgentImageQuickTemplates = ADMIN_AGENT_IMAGE_QUICK_TEMPLATE_IDS
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
  const effectiveSidebarCollapsed = sidebarCollapsed;
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
  const publicPageSummaryCharCount = countPublicSummaryChars(settings.event_public_summary);
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
  const publicRouteEventStatusTone: BadgeTone = publicEventPage
    ? getEventStatusTone(publicEventPage.event.status)
    : "neutral";
  const publicRouteEventStatusLabel = publicEventPage
    ? getEventStatusLabel(publicEventPage.event.status)
    : "";
  const publicRouteAvailabilityTone = getRegistrationAvailabilityTone(publicEventPage?.event.registration_availability);
  const publicRouteAvailabilityLabel = getRegistrationAvailabilityLabel(publicEventPage?.event.registration_availability);
  const publicRouteMessengerHref = publicEventPage ? normalizeExternalHref(publicEventPage.contact.messenger_url) : "";
  const publicRouteLineHref = publicEventPage ? normalizeExternalHref(publicEventPage.contact.line_url) : "";
  const publicRoutePhoneHref = publicEventPage ? normalizePhoneHref(publicEventPage.contact.phone) : "";
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
      attachments: normalizeImageAttachments(row.attachments),
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
    return () => {
      adminAgentPendingImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      publicChatPendingImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      testPendingImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

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
      setPublicChatPendingImages((current) => {
        current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return [];
      });
      return;
    }

    setPublicChatOpen(false);
    setPublicChatInput("");
    setPublicChatSending(false);
    setPublicChatError("");
    setPublicChatPendingImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
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
    setMobileSidebarOpen(false);
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

      const rawItems = Array.isArray(data)
        ? data
        : Array.isArray((data as Record<string, unknown>)?.items)
        ? (data as Record<string, unknown>).items as unknown[]
        : [];
      const items = rawItems
        .map((item) => normalizePublicInboxMessage(item))
        .filter(Boolean) as Message[];
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
  const dirtyNavigationSectionLabels = dirtyNavigationDialog.dirtySections.map((section) => DIRTY_NAVIGATION_SECTION_LABELS[section]);
  const dirtyNavigationTargetLabel =
    dirtyNavigationDialog.nextEventId && dirtyNavigationDialog.nextEventId !== selectedEventId
      ? "switch workspaces"
      : dirtyNavigationDialog.nextTab && dirtyNavigationDialog.nextTab !== activeTab
      ? `open ${APP_TAB_LABELS[dirtyNavigationDialog.nextTab]}`
      : "leave this page";

  const getDirtyNavigationSections = ({
    nextTab,
    nextEventId,
  }: {
    nextTab?: AppTab;
    nextEventId?: string;
  } = {}) => {
    const dirtySections = new Set<DirtyNavigationSectionId>();
    const eventSwitching = typeof nextEventId === "string" && nextEventId !== selectedEventId;

    if (eventSwitching) {
      if (eventWorkspaceDirty) dirtySections.add("event");
      if (eventMailDirty) dirtySections.add("mail");
      if (eventContextDirty) dirtySections.add("context");
      if (workspaceSetupDirty) dirtySections.add("setup");
      if (agentSettingsDirty) dirtySections.add("agent");
    } else if (nextTab && nextTab !== activeTab) {
      if (activeTab === "event" && eventWorkspaceDirty) dirtySections.add("event");
      if (activeTab === "mail" && eventMailDirty) dirtySections.add("mail");
      if (activeTab === "design" && eventContextDirty) dirtySections.add("context");
      if (activeTab === "settings" && workspaceSetupDirty) dirtySections.add("setup");
      if (activeTab === "agent" && agentSettingsDirty) dirtySections.add("agent");
    }

    return Array.from(dirtySections);
  };

  const closeDirtyNavigationDialog = () => {
    if (dirtyNavigationDialog.saving) return;
    dirtyNavigationActionRef.current = null;
    setDirtyNavigationDialog({
      open: false,
      nextTab: null,
      nextEventId: "",
      dirtySections: [],
      saving: false,
      error: "",
    });
  };

  const requestDirtyNavigationGuard = ({
    nextTab,
    nextEventId,
    onProceed,
  }: {
    nextTab?: AppTab;
    nextEventId?: string;
    onProceed: () => void;
  }) => {
    const dirtySections = getDirtyNavigationSections({ nextTab, nextEventId });
    if (dirtySections.length === 0) {
      onProceed();
      return true;
    }

    dirtyNavigationActionRef.current = onProceed;
    setDirtyNavigationDialog({
      open: true,
      nextTab: nextTab || null,
      nextEventId: nextEventId || "",
      dirtySections,
      saving: false,
      error: "",
    });
    return false;
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
    return requestDirtyNavigationGuard({
      nextTab,
      onProceed: () => {
        setActiveTab(nextTab);
        if (nextTab === "agent") {
          forceScrollAdminAgentToBottom();
        }
        setSetupMenuOpen(false);
        setOperationsMenuOpen(false);
        setAgentWorkspaceMenuOpen(false);
      },
    });
  };

  const handleOpenEventWorkspaceView = (nextView: EventWorkspaceView) => {
    return requestDirtyNavigationGuard({
      nextTab: "event",
      onProceed: () => {
        setActiveTab("event");
        setEventWorkspaceView(nextView);
        setEventWorkspaceMenuOpen(false);
        clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
        setSetupMenuOpen(false);
        clearMenuCloseTimer(setupMenuCloseTimerRef);
        setOperationsMenuOpen(false);
        clearMenuCloseTimer(operationsMenuCloseTimerRef);
        setAgentWorkspaceMenuOpen(false);
        clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
      },
    });
  };

  const handleToggleSidebarCollapsed = () => {
    setEventWorkspaceMenuOpen(false);
    setOperationsMenuOpen(false);
    setSetupMenuOpen(false);
    setAgentWorkspaceMenuOpen(false);
    clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
    clearMenuCloseTimer(operationsMenuCloseTimerRef);
    clearMenuCloseTimer(setupMenuCloseTimerRef);
    clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
    setUserMenuOpen(false);
    setSidebarCollapsed((current) => !current);
  };

  const handleToggleMobileSidebar = () => {
    setMobileSidebarOpen((current) => !current);
  };

  const handleCloseMobileSidebar = () => {
    setMobileSidebarOpen(false);
  };

  const handleSelectEvent = (nextEventId: string) => {
    if (!nextEventId || nextEventId === selectedEventId) return true;
    return requestDirtyNavigationGuard({
      nextEventId,
      onProceed: () => {
        setSelectedEventId(nextEventId);
      },
    });
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
      return false;
    }
    if (timingInfo.eventScheduleStatus === "invalid") {
      setSettingsMessage("Event end time must be later than or equal to the event start time");
      return false;
    }

    const saved = await saveSettingsSubset([...EVENT_SETUP_SETTINGS_KEYS], "Event setup saved");
    if (!saved) return false;

    const nextEventName = settings.event_name.trim();
    if (selectedEvent && nextEventName && nextEventName !== selectedEvent.name) {
      const synced = await handleUpdateEvent({
        name: nextEventName,
        silent: true,
      });
      if (!synced) return false;
    } else {
      await fetchEvents();
    }
    return true;
  };

  const saveEventMailSettings = async () => {
    return saveSettingsSubset([...EVENT_MAIL_SETTINGS_KEYS], "Mail settings saved");
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
    return saved;
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

  const clearPublicChatPendingImages = () => {
    setPublicChatPendingImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    if (publicChatFileInputRef.current) {
      publicChatFileInputRef.current.value = "";
    }
  };

  const removePublicChatPendingImage = (id: string) => {
    setPublicChatPendingImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  };

  const handlePublicChatImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const nextAttachments: PendingPublicChatImageAttachment[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (!PUBLIC_CHAT_ALLOWED_IMAGE_TYPES.has(file.type)) {
        errors.push(`${file.name}: PNG, JPG, or WebP only`);
        continue;
      }
      if (file.size > PUBLIC_CHAT_IMAGE_MAX_BYTES) {
        errors.push(`${file.name}: max 6 MB`);
        continue;
      }
      nextAttachments.push({
        id: `public-img:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setPublicChatPendingImages((current) => {
      const remainingSlots = Math.max(0, 4 - current.length);
      if (remainingSlots <= 0) {
        nextAttachments.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return current;
      }
      const accepted = nextAttachments.slice(0, remainingSlots);
      const rejected = nextAttachments.slice(remainingSlots);
      rejected.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      if (nextAttachments.length > remainingSlots) {
        errors.push("Up to 4 images per message");
      }
      return [...current, ...accepted];
    });

    setPublicChatError(errors.join(" · "));
    event.target.value = "";
  };

  const uploadPublicChatImageAttachment = async (file: File): Promise<ImageAttachment> => {
    if (!publicEventSlug) {
      throw new Error("Public event page is not selected");
    }
    const res = await apiFetch(`/api/public/events/${encodeURIComponent(publicEventSlug)}/chat/attachments/image`, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "x-upload-filename": encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || "Failed to upload image");
    }
    const attachment = (data as { attachment?: Record<string, unknown> }).attachment || {};
    const url = typeof attachment.url === "string" ? attachment.url : "";
    if (!url) {
      throw new Error("Image upload did not return a URL");
    }
    return {
      id: typeof attachment.id === "string" ? attachment.id : undefined,
      kind: "image",
      url,
      absolute_url: typeof attachment.absolute_url === "string" ? attachment.absolute_url : null,
      mime_type: typeof attachment.mime_type === "string" ? attachment.mime_type : file.type,
      name: typeof attachment.name === "string" ? attachment.name : file.name,
      size_bytes: Number.isFinite(Number(attachment.size_bytes)) ? Number(attachment.size_bytes) : file.size,
    };
  };

  const handlePublicChatSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!publicEventSlug || !publicEventPage || !publicEventPage.support.bot_enabled) return;

    const trimmed = publicChatInput.trim();
    if (!trimmed && publicChatPendingImages.length === 0) return;

    const senderId = publicChatSenderId || getOrCreatePublicEventChatSenderId(publicEventSlug);
    if (!publicChatSenderId && senderId) {
      setPublicChatSenderId(senderId);
    }

    setPublicChatError("");
    setPublicChatSending(true);

    try {
      const uploadedAttachments = publicChatPendingImages.length > 0
        ? await Promise.all(publicChatPendingImages.map((item) => uploadPublicChatImageAttachment(item.file)))
        : [];
      setPublicChatMessages((current) => [
        ...current,
        createPublicChatMessage("user", trimmed, {
          attachments: uploadedAttachments,
        }),
      ]);
      setPublicChatInput("");
      clearPublicChatPendingImages();

      const res = await apiFetch(`/api/public/events/${encodeURIComponent(publicEventSlug)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_id: senderId,
          text: trimmed,
          attachments: uploadedAttachments,
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

  const saveDirtyNavigationSections = async (sections: DirtyNavigationSectionId[]) => {
    for (const section of sections) {
      if (section === "event") {
        if (eventSetupDirty) {
          const savedSetup = await saveEventDetails();
          if (!savedSetup) return false;
        }
        if (eventPublicDirty) {
          const savedPublic = await saveEventPublicPage();
          if (!savedPublic) return false;
        }
        continue;
      }
      if (section === "mail") {
        if (eventMailDirty) {
          const savedMail = await saveEventMailSettings();
          if (!savedMail) return false;
        }
        continue;
      }
      if (section === "context") {
        if (eventContextDirty) {
          const savedContext = await saveEventContext();
          if (!savedContext) return false;
        }
        continue;
      }
      if (section === "setup") {
        if (aiSettingsDirty) {
          const savedAi = await saveAiSettings();
          if (!savedAi) return false;
        }
        if (webhookSettingsDirty) {
          const savedWebhook = await saveWebhookSettings();
          if (!savedWebhook) return false;
        }
        continue;
      }
      if (section === "agent" && agentSettingsDirty) {
        const savedAgent = await saveAgentSettings();
        if (!savedAgent) return false;
      }
    }

    return true;
  };

  const handleDirtyNavigationSaveAndLeave = async () => {
    if (dirtyNavigationDialog.saving || dirtyNavigationDialog.dirtySections.length === 0) return;
    setDirtyNavigationDialog((current) => ({ ...current, saving: true, error: "" }));
    const saved = await saveDirtyNavigationSections(dirtyNavigationDialog.dirtySections);
    if (!saved) {
      setDirtyNavigationDialog((current) => ({
        ...current,
        saving: false,
        error: "Save failed. Fix the issue above before leaving, or leave without saving.",
      }));
      return;
    }

    const onProceed = dirtyNavigationActionRef.current;
    dirtyNavigationActionRef.current = null;
    setDirtyNavigationDialog({
      open: false,
      nextTab: null,
      nextEventId: "",
      dirtySections: [],
      saving: false,
      error: "",
    });
    onProceed?.();
  };

  const handleDirtyNavigationLeaveWithoutSaving = () => {
    if (dirtyNavigationDialog.saving) return;
    const onProceed = dirtyNavigationActionRef.current;
    dirtyNavigationActionRef.current = null;
    setDirtyNavigationDialog({
      open: false,
      nextTab: null,
      nextEventId: "",
      dirtySections: [],
      saving: false,
      error: "",
    });
    onProceed?.();
  };

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

  const clearTestPendingImages = () => {
    setTestPendingImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    setTestAttachmentError("");
    if (testImageInputRef.current) {
      testImageInputRef.current.value = "";
    }
  };

  const removeTestPendingImage = (id: string) => {
    setTestPendingImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  };

  const handleTestImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const nextAttachments: PendingTestImageAttachment[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (!ADMIN_AGENT_ALLOWED_IMAGE_TYPES.has(file.type)) {
        errors.push(`${file.name}: PNG, JPG, or WebP only`);
        continue;
      }
      if (file.size > ADMIN_AGENT_IMAGE_MAX_BYTES) {
        errors.push(`${file.name}: max 6 MB`);
        continue;
      }
      nextAttachments.push({
        id: `test-img:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setTestPendingImages((current) => {
      const remainingSlots = Math.max(0, 4 - current.length);
      if (remainingSlots <= 0) {
        nextAttachments.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return current;
      }
      const accepted = nextAttachments.slice(0, remainingSlots);
      const rejected = nextAttachments.slice(remainingSlots);
      rejected.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      if (nextAttachments.length > remainingSlots) {
        errors.push("Up to 4 images per message");
      }
      return [...current, ...accepted];
    });

    setTestAttachmentError(errors.join(" · "));
    event.target.value = "";
  };

  const uploadTestImageAttachment = async (file: File): Promise<ImageAttachment> => {
    const params = new URLSearchParams();
    params.set("event_id", selectedEventId || "");
    const res = await apiFetch(`/api/llm/attachments/image?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "x-upload-filename": encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || "Failed to upload image");
    }
    const attachment = (data as { attachment?: Record<string, unknown> }).attachment || {};
    const url = typeof attachment.url === "string" ? attachment.url : "";
    if (!url) {
      throw new Error("Image upload did not return a URL");
    }
    return {
      id: typeof attachment.id === "string" ? attachment.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "image",
      url,
      absolute_url: typeof attachment.absolute_url === "string" ? attachment.absolute_url : null,
      mime_type: typeof attachment.mime_type === "string" ? attachment.mime_type : file.type,
      name: typeof attachment.name === "string" ? attachment.name : file.name,
      size_bytes: Number.isFinite(Number(attachment.size_bytes)) ? Number(attachment.size_bytes) : file.size,
    };
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
    const outgoingText = inputText.trim();
    const pendingImages = testPendingImages.slice();
    if (!outgoingText && pendingImages.length === 0) return;

    setIsTyping(true);
    setTestAttachmentError("");

    try {
      const uploadedAttachments = pendingImages.length > 0
        ? await Promise.all(pendingImages.map((item) => uploadTestImageAttachment(item.file)))
        : [];
      const userMsg = {
        role: "user" as const,
        parts: [
          ...(outgoingText ? [{ text: outgoingText }] : []),
          ...uploadedAttachments.map((image) => ({ image })),
        ],
        timestamp: new Date().toISOString(),
      };
      setTestMessages(prev => [...prev, userMsg]);
      setInputText("");
      clearTestPendingImages();

      const history = testMessages.map(m => ({
        role: m.role,
        parts: m.parts
      }));
      
      const response = await getChatResponse(outgoingText, settings, history, selectedEventId, uploadedAttachments);
      
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
      const message = err instanceof Error ? err.message : "Failed to get response from OpenRouter.";
      setTestMessages(prev => [...prev, { role: "model", parts: [{ text: `Error: ${message}` }], timestamp: new Date().toISOString() }]);
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
    if (
      template.autoSendWithPendingImages
      && adminAgentPendingImages.length > 0
      && !adminAgentTyping
      && !adminAgentInputText.trim()
    ) {
      void handleAdminAgentSend(template.command);
      return;
    }
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

  const clearAdminAgentPendingImages = () => {
    setAdminAgentPendingImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    setAdminAgentAttachmentError("");
    if (adminAgentImageInputRef.current) {
      adminAgentImageInputRef.current.value = "";
    }
  };

  const removeAdminAgentPendingImage = (id: string) => {
    setAdminAgentPendingImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  };

  const handleAdminAgentImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const nextAttachments: PendingAdminAgentImageAttachment[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (!ADMIN_AGENT_ALLOWED_IMAGE_TYPES.has(file.type)) {
        errors.push(`${file.name}: PNG, JPG, or WebP only`);
        continue;
      }
      if (file.size > ADMIN_AGENT_IMAGE_MAX_BYTES) {
        errors.push(`${file.name}: max 6 MB`);
        continue;
      }
      nextAttachments.push({
        id: `img:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setAdminAgentPendingImages((current) => {
      const remainingSlots = Math.max(0, 4 - current.length);
      if (remainingSlots <= 0) {
        nextAttachments.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return current;
      }
      const accepted = nextAttachments.slice(0, remainingSlots);
      const rejected = nextAttachments.slice(remainingSlots);
      rejected.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      if (nextAttachments.length > remainingSlots) {
        errors.push("Up to 4 images per message");
      }
      return [...current, ...accepted];
    });

    setAdminAgentAttachmentError(errors.join(" · "));
    event.target.value = "";
  };

  const uploadAdminAgentImageAttachment = async (file: File): Promise<AdminAgentImageAttachment> => {
    const params = new URLSearchParams();
    params.set("event_id", selectedEventId || "");
    const res = await apiFetch(`/api/admin-agent/attachments/image?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "x-upload-filename": encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || "Failed to upload image");
    }
    const attachment = (data as { attachment?: Record<string, unknown> }).attachment || {};
    const url = typeof attachment.url === "string" ? attachment.url : "";
    if (!url) {
      throw new Error("Image upload did not return a URL");
    }
    return {
      id: typeof attachment.id === "string" ? attachment.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "image",
      url,
      absolute_url: typeof attachment.absolute_url === "string" ? attachment.absolute_url : "",
      mime_type: typeof attachment.mime_type === "string" ? attachment.mime_type : file.type,
      name: typeof attachment.name === "string" ? attachment.name : file.name,
      size_bytes: Number.isFinite(Number(attachment.size_bytes)) ? Number(attachment.size_bytes) : file.size,
    };
  };

  const buildAdminAgentHistoryParts = (message: AdminAgentChatMessage) => {
    const parts: Array<{
      text?: string;
      image?: AdminAgentImageAttachment;
    }> = [];
    const normalizedText = message.role === "agent" && message.actionName
      ? `[${message.actionName}] ${message.text}`
      : message.text;
    if (normalizedText.trim()) {
      parts.push({ text: normalizedText });
    }
    if (message.role === "user" && Array.isArray(message.attachments)) {
      for (const attachment of message.attachments) {
        parts.push({ image: attachment });
      }
    }
    return parts;
  };

  const handleAdminAgentSend = async (overrideMessage?: string) => {
    const outgoingText = typeof overrideMessage === "string" && overrideMessage.trim()
      ? overrideMessage.trim()
      : adminAgentInputText.trim();
    if (!outgoingText && adminAgentPendingImages.length === 0) return;
    const pendingImages = adminAgentPendingImages.slice();
    closeAdminCommandPalette();
    setAdminAgentTyping(true);
    setAdminAgentAttachmentError("");

    try {
      const uploadedAttachments = pendingImages.length > 0
        ? await Promise.all(pendingImages.map((item) => uploadAdminAgentImageAttachment(item.file)))
        : [];

      const userMsg: AdminAgentChatMessage = {
        role: "user",
        text: outgoingText,
        timestamp: new Date().toISOString(),
        attachments: uploadedAttachments,
      };
      const history = adminAgentMessages.map((msg) => ({
        role: msg.role === "user" ? "user" as const : "model" as const,
        parts: buildAdminAgentHistoryParts(msg),
      }));

      setAdminAgentMessages((prev) => [...prev, userMsg]);
      setAdminAgentInputText("");
      clearAdminAgentPendingImages();

      const response = await getAdminAgentResponse(outgoingText, settings, history, selectedEventId, uploadedAttachments);
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
        const resultEventId = response.result && typeof response.result === "object" && typeof response.result.event_id === "string"
          ? response.result.event_id.trim()
          : "";
        const actionEventId = String(
          (response.action.name === "create_event" ? resultEventId : "")
          || response.event_id
          || resultEventId
          || selectedEventId
          || "",
        ).trim() || selectedEventId;
        const shouldSwitchToCreatedEvent =
          response.action.name === "create_event"
          && actionEventId
          && actionEventId !== selectedEventId;
        if (shouldSwitchToCreatedEvent) {
          setSelectedEventId(actionEventId);
        }
        void fetchAdminAgentDashboard(actionEventId || selectedEventId, { silent: true });
        if (actionEventId && !shouldSwitchToCreatedEvent) {
          void Promise.all([
            fetchSettings(actionEventId),
            fetchMessages(actionEventId),
            fetchRegistrations(actionEventId),
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
      requestDirtyNavigationGuard({
        nextTab: "event",
        nextEventId: id,
        onProceed: () => {
          setEventListQuery(event?.slug || event?.name || "");
          setSelectedEventId(id);
          setActiveTab("event");
          focusSearchTarget("event", id);
        },
      });
    }
    if (kind === "registration") {
      const registration = registrations.find((item) => item.id === id);
      requestDirtyNavigationGuard({
        nextTab: "registrations",
        onProceed: () => {
          setRegistrationListQuery(registration?.id || "");
          setActiveTab("registrations");
          setSelectedRegistrationId(id);
          focusSearchTarget("registration", id);
        },
      });
    }
    if (kind === "channel") {
      const channel = channels.find((item) => item.id === id);
      requestDirtyNavigationGuard({
        nextTab: "settings",
        onProceed: () => {
          if (channel) {
            selectSetupChannel(channel);
            loadChannelIntoForm(channel);
            setChannelConfigDialogOpen(true);
          }
          setActiveTab("settings");
          focusSearchTarget("channel", id);
        },
      });
    }
    if (kind === "document") {
      const document = documents.find((item) => item.id === id);
      requestDirtyNavigationGuard({
        nextTab: "design",
        onProceed: () => {
          setDocumentListQuery(document?.title || "");
          setActiveTab("design");
          selectDocumentForChunks(id);
        },
      });
    }
    if (kind === "log") {
      const message = messages.find((item) => String(item.id) === id);
      requestDirtyNavigationGuard({
        nextTab: "logs",
        onProceed: () => {
          setLogListQuery(message?.sender_id || message?.text || "");
          setActiveTab("logs");
          focusSearchTarget("log", id);
        },
      });
    }
    setGlobalSearchOpen(false);
    setGlobalSearchQuery("");
  };

  if (checkinAccessMode) {
    return (
      <CheckinAccessRoute
        initializing={authStatus === "checking"}
        loading={checkinAccessLoading}
        session={checkinAccessSession}
        errorMessage={checkinAccessError}
        eventStatusTone={checkinAccessSession ? getEventStatusTone(checkinAccessSession.event_status) : "neutral"}
        eventStatusLabel={checkinAccessSession ? getEventStatusLabel(checkinAccessSession.event_status) : ""}
        canUseQrScanner={canUseQrScanner}
        scannerActive={scannerActive}
        scannerStarting={scannerStarting}
        scannerError={scannerError}
        videoRef={videoRef}
        lastScannedValue={lastScannedValue}
        onStartScanner={startQrScanner}
        onStopScanner={stopQrScanner}
        searchId={searchId}
        onSearchIdChange={(value) => setSearchId(value.toUpperCase())}
        onCheckin={handleCheckin}
        checkinStatus={checkinStatus}
        checkinErrorMessage={checkinErrorMessage}
        latestResultLabel={latestResultLabel}
        latestCheckinRegistration={latestCheckinRegistration}
        latestResultToneClass={latestResultToneClass}
      />
    );
  }

  if (!isPublicEventRoute && authStatus === "checking") {
    return <LoadingScreen />;
  }

  if (!isPublicEventRoute && authStatus === "unauthenticated") {
    return (
      <AuthScreen
        errorMessage={authError}
        username={loginUsername}
        password={loginPassword}
        submitting={loginSubmitting}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLogin}
      />
    );
  }

  if (!isPublicEventRoute && loading) {
    return <LoadingScreen />;
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
    <TeamAccessPanel
      role={role}
      authUser={authUser}
      teamLoading={teamLoading}
      teamUsers={teamUsers}
      teamMessage={teamMessage}
      canManageUsers={canManageUsers}
      manageableRoles={MANAGEABLE_ROLES}
      newUserDisplayName={newUserDisplayName}
      onNewUserDisplayNameChange={setNewUserDisplayName}
      newUserUsername={newUserUsername}
      onNewUserUsernameChange={setNewUserUsername}
      newUserPassword={newUserPassword}
      onNewUserPasswordChange={setNewUserPassword}
      newUserRole={newUserRole}
      onNewUserRoleChange={setNewUserRole}
      canManageTargetRole={canManageTargetRole}
      canManageTargetAccess={canManageTargetAccess}
      canDeleteTeamUser={canDeleteTeamUser}
      onRefresh={fetchTeamUsers}
      onUserRoleChange={handleUserRoleChange}
      onUserAccessToggle={handleUserAccessToggle}
      onDeleteUser={handleDeleteUser}
      onCreateUser={handleCreateUser}
    />
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
                {Array.isArray(threadMessage.attachments) && threadMessage.attachments.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {threadMessage.attachments.map((attachment) => (
                      <a
                        key={`${threadMessage.id}:${attachment.url}`}
                        href={attachment.absolute_url || attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block overflow-hidden rounded-xl border border-slate-200 bg-white"
                      >
                        <img
                          src={attachment.absolute_url || attachment.url}
                          alt={attachment.name || "Attached image"}
                          className="h-28 w-full object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const isChatConsoleTab = activeTab === "test" || (activeTab === "agent" && agentWorkspaceView === "console");

  if (isPublicEventRoute) {
    return (
      <PublicEventPageScreen
        page={publicEventPage}
        loading={publicEventLoading}
        errorMessage={publicEventError}
        eventStatusTone={publicRouteEventStatusTone}
        eventStatusLabel={publicRouteEventStatusLabel}
        availabilityTone={publicRouteAvailabilityTone}
        availabilityLabel={publicRouteAvailabilityLabel}
        mapEmbedUrl={publicRouteMapEmbedUrl}
        messengerHref={publicRouteMessengerHref}
        lineHref={publicRouteLineHref}
        phoneHref={publicRoutePhoneHref}
        registrationForm={publicRegistrationForm}
        onRegistrationFieldChange={handlePublicRegistrationFieldChange}
        registrationSubmitting={publicRegistrationSubmitting}
        registrationError={publicRegistrationError}
        registrationResult={publicRegistrationResult}
        onRegistrationSubmit={handlePublicRegistrationSubmit}
        onResetRegistrationFlow={resetPublicRegistrationFlow}
        ticketLookupForm={publicTicketLookupForm}
        onTicketLookupFieldChange={handlePublicTicketLookupFieldChange}
        ticketLookupSubmitting={publicTicketLookupSubmitting}
        ticketLookupError={publicTicketLookupError}
        onTicketLookupSubmit={handlePublicTicketLookupSubmit}
        privacyOpen={publicPrivacyOpen}
        onPrivacyOpenChange={setPublicPrivacyOpen}
        chatOpen={publicChatOpen}
        onChatOpenChange={setPublicChatOpen}
        chatInput={publicChatInput}
        onChatInputChange={setPublicChatInput}
        chatPendingImages={publicChatPendingImages}
        chatFileInputRef={publicChatFileInputRef}
        chatBodyRef={publicChatBodyRef}
        chatMessages={publicChatMessages}
        chatSending={publicChatSending}
        chatError={publicChatError}
        onChatImageSelect={handlePublicChatImageSelection}
        onChatRemoveImage={removePublicChatPendingImage}
        onChatSubmit={handlePublicChatSubmit}
        onChatInputKeyDown={handlePublicChatInputKeyDown}
      />
    );
  }

  return (
    <>
      <AdminWorkspaceFrame
        isChatConsoleTab={isChatConsoleTab}
        isAgentMobileFocusMode={isAgentMobileFocusMode}
        canEditSettings={canEditSettings}
        header={(
          <AdminWorkspaceHeader
            isAgentMobileFocusMode={isAgentMobileFocusMode}
            sidebarCollapsed={effectiveSidebarCollapsed}
            onToggleSidebarCollapsed={handleToggleSidebarCollapsed}
            mobileSidebarOpen={mobileSidebarOpen}
            onToggleMobileSidebar={handleToggleMobileSidebar}
            selectedEvent={selectedEvent}
            getEventStatusTone={getEventStatusTone}
            getEventStatusLabel={getEventStatusLabel}
            getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
            selectedEventAvailableInSelector={selectedEventAvailableInSelector}
            selectedEventId={selectedEventId}
            selectorEvents={selectorEvents}
            selectorPlaceholderLabel={selectorPlaceholderLabel}
            eventLoading={eventLoading}
            onSelectEvent={handleSelectEvent}
            searchShortcutLabel={searchShortcutLabel}
            globalSearchOpen={globalSearchOpen}
            setGlobalSearchOpen={setGlobalSearchOpen}
          />
        )}
        sidebar={(
          <AdminWorkspaceSidebar
            isAgentMobileFocusMode={isAgentMobileFocusMode}
            collapsed={effectiveSidebarCollapsed}
            mobileOpen={mobileSidebarOpen}
            onCloseMobileSidebar={handleCloseMobileSidebar}
            userMenuRef={userMenuRef}
            userMenuOpen={userMenuOpen}
            setUserMenuOpen={setUserMenuOpen}
            authUser={authUser}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
            onLogout={handleLogout}
            selectedEvent={selectedEvent}
            getEventStatusTone={getEventStatusTone}
            getEventStatusLabel={getEventStatusLabel}
            getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
            primaryTabs={primaryTabs}
            activeTab={activeTab}
            hoverDropdownEnabled={hoverDropdownEnabled}
            eventWorkspaceTabs={eventWorkspaceTabs}
            selectedEventWorkspaceTab={selectedEventWorkspaceTab}
            eventWorkspaceView={eventWorkspaceView}
            eventWorkspaceMenuRef={eventWorkspaceMenuRef}
            eventWorkspaceMenuOpen={eventWorkspaceMenuOpen}
            setEventWorkspaceMenuOpen={setEventWorkspaceMenuOpen}
            eventWorkspaceDirty={eventWorkspaceDirty}
            eventSetupDirty={eventSetupDirty}
            eventPublicDirty={eventPublicDirty}
            setupMenuRef={setupMenuRef}
            setupMenuOpen={setupMenuOpen}
            setSetupMenuOpen={setSetupMenuOpen}
            selectedSetupTab={selectedSetupTab}
            setupTabs={setupTabs}
            isSetupTab={isSetupTab}
            workspaceSetupDirty={workspaceSetupDirty}
            operationsMenuRef={operationsMenuRef}
            operationsMenuOpen={operationsMenuOpen}
            setOperationsMenuOpen={setOperationsMenuOpen}
            operationsTabs={operationsTabs}
            isOperationsTab={isOperationsTab}
            agentWorkspaceMenuRef={agentWorkspaceMenuRef}
            agentWorkspaceMenuOpen={agentWorkspaceMenuOpen}
            setAgentWorkspaceMenuOpen={setAgentWorkspaceMenuOpen}
            agentWorkspaceTabs={agentWorkspaceTabs}
            agentWorkspaceView={agentWorkspaceView}
            setAgentWorkspaceView={setAgentWorkspaceView}
            agentSettingsDirty={agentSettingsDirty}
            eventMailDirty={eventMailDirty}
            eventContextDirty={eventContextDirty}
            eventWorkspaceMenuCloseTimerRef={eventWorkspaceMenuCloseTimerRef}
            setupMenuCloseTimerRef={setupMenuCloseTimerRef}
            operationsMenuCloseTimerRef={operationsMenuCloseTimerRef}
            agentWorkspaceMenuCloseTimerRef={agentWorkspaceMenuCloseTimerRef}
            clearMenuCloseTimer={clearMenuCloseTimer}
            scheduleEventWorkspaceMenuClose={scheduleEventWorkspaceMenuClose}
            scheduleSetupMenuClose={scheduleSetupMenuClose}
            scheduleOperationsMenuClose={scheduleOperationsMenuClose}
            scheduleAgentWorkspaceMenuClose={scheduleAgentWorkspaceMenuClose}
            onNavigateToTab={handleNavigateToTab}
            onOpenEventWorkspaceView={handleOpenEventWorkspaceView}
            onForceScrollAdminAgentToBottom={forceScrollAdminAgentToBottom}
          />
        )}
        dock={(
          <WorkspaceInsightsDock
            visible={canEditSettings && !isChatConsoleTab}
            open={insightsPanelOpen}
            onToggle={() => setInsightsPanelOpen((open) => !open)}
            selectedEventStatusLabel={selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : "No selected event"}
            hasAnyUnsavedSettings={hasAnyUnsavedSettings}
            activeLlmModel={activeLlmModel}
            eventTokens={formatCompactNumber(selectedEventUsage?.total_tokens || 0)}
            totalCost={formatUsdCost(overallLlmUsage?.estimated_cost_usd || 0)}
          />
        )}
      >
        <AnimatePresence mode="wait">
          {activeTab === "event" && (
            <EventWorkspaceScreen
              eventWorkspaceView={eventWorkspaceView}
              selectedEvent={selectedEvent}
              getEventStatusTone={getEventStatusTone}
              getEventStatusLabel={getEventStatusLabel}
              getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
              eventSetupDirty={eventSetupDirty}
              saveEventDetails={saveEventDetails}
              saving={saving}
              handleUpdateEvent={handleUpdateEvent}
              eventStatusToggle={eventStatusToggle}
              eventLoading={eventLoading}
              handleCloneEvent={handleCloneEvent}
              handleDeleteEvent={handleDeleteEvent}
              timingInfo={timingInfo}
              eventMessage={eventMessage}
              settingsMessage={settingsMessage}
              settings={settings}
              setSettings={setSettings}
              handleEventDateChange={handleEventDateChange}
              eventLocationSummary={eventLocationSummary}
              resolvedEventMapUrl={resolvedEventMapUrl}
              eventMapIsGenerated={eventMapIsGenerated}
              eventMapEmbedUrl={eventMapEmbedUrl}
              registrationCapacity={registrationCapacity}
              activeAttendeeCount={activeAttendeeCount}
              handleNavigateToTab={handleNavigateToTab}
              emailReadinessLabel={emailReadinessLabel}
              emailStatus={emailStatus}
              publicPageEnabled={publicPageEnabled}
              publicRegistrationEnabled={publicRegistrationEnabled}
              publicShowSeatAvailability={publicShowSeatAvailability}
              publicBotEnabled={publicBotEnabled}
              publicPrivacyEnabled={publicPrivacyEnabled}
              publicContactEnabled={publicContactEnabled}
              eventPublicDirty={eventPublicDirty}
              saveEventPublicPage={saveEventPublicPage}
              publicPosterFileInputRef={publicPosterFileInputRef}
              handlePublicPosterFileUpload={handlePublicPosterFileUpload}
              publicPosterUploading={publicPosterUploading}
              publicPagePosterUrl={publicPagePosterUrl}
              selectedEventId={selectedEventId}
              publicPagePreviewPath={publicPagePreviewPath}
              publicPageAutoSummary={publicPageAutoSummary}
              publicPageSummaryCharCount={publicPageSummaryCharCount}
              publicTicketRecoveryMode={publicTicketRecoveryMode}
              publicContactHasContent={publicContactHasContent}
              publicPageAbsoluteUrl={publicPageAbsoluteUrl}
              copyPublicPageUrlToClipboard={copyPublicPageUrlToClipboard}
              publicPageLinkCopied={publicPageLinkCopied}
              handleDownloadPublicPageQrPng={handleDownloadPublicPageQrPng}
              publicPageQrDataUrl={publicPageQrDataUrl}
              handleDownloadPublicPageQrSvg={handleDownloadPublicPageQrSvg}
              publicPageQrSvgMarkup={publicPageQrSvgMarkup}
              publicPageQrError={publicPageQrError}
              publicPageSummary={publicPageSummary}
              attendeeLocationLabel={attendeeLocationLabel}
              initialSettings={{
                event_public_cta_label: INITIAL_SETTINGS.event_public_cta_label,
                event_public_privacy_label: INITIAL_SETTINGS.event_public_privacy_label,
                event_public_privacy_text: INITIAL_SETTINGS.event_public_privacy_text,
                event_public_success_message: INITIAL_SETTINGS.event_public_success_message,
              }}
              publicContactIntro={publicContactIntro}
              publicContactMessengerHref={publicContactMessengerHref}
              publicContactLineHref={publicContactLineHref}
              publicContactPhoneHref={publicContactPhoneHref}
              eventWorkspacePanel={(
                <EventWorkspacePanel
                  collapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels)}
                  eventCreateOpen={eventCreateOpen}
                  onToggleEventCreate={() => setEventCreateOpen((current) => !current)}
                  onRefresh={() => Promise.all([fetchEvents(), fetchChannels()])}
                  eventLoading={eventLoading}
                  newEventName={newEventName}
                  onNewEventNameChange={setNewEventName}
                  onCreateEvent={handleCreateEvent}
                  eventListQuery={eventListQuery}
                  onEventListQueryChange={setEventListQuery}
                  eventWorkspaceSort={eventWorkspaceSort}
                  onEventWorkspaceSortChange={setEventWorkspaceSort}
                  eventWorkspaceFilterOptions={eventWorkspaceFilterOptions}
                  eventWorkspaceFilter={eventWorkspaceFilter}
                  onEventWorkspaceFilterChange={setEventWorkspaceFilter}
                  filteredEventWorkspaceEvents={filteredEventWorkspaceEvents}
                  eventWorkspaceCounts={eventWorkspaceCounts}
                  deferredEventListQuery={deferredEventListQuery}
                  filteredWorkingEvents={filteredWorkingEvents}
                  filteredInactiveEvents={filteredInactiveEvents}
                  filteredArchivedEvents={filteredArchivedEvents}
                  recentHistoricalEvents={recentHistoricalEvents}
                  historyEventGroups={historyEventGroups}
                  liveWorkspaceHeading={liveWorkspaceHeading}
                  inactiveWorkspaceHeading={inactiveWorkspaceHeading}
                  archivedWorkspaceHeading={archivedWorkspaceHeading}
                  historyWorkspaceHeading={historyWorkspaceHeading}
                  selectedEventId={selectedEventId}
                  isSearchFocused={(id) => isSearchFocused("event", id)}
                  onSelectEvent={handleSelectEvent}
                  eventHistoryOpenKeys={eventHistoryOpenKeys}
                  onToggleEventHistoryGroup={(key) =>
                    setEventHistoryOpenKeys((current) =>
                      current.includes(key)
                        ? current.filter((item) => item !== key)
                        : [...current, key],
                    )
                  }
                  getSearchTargetDomId={(id) => getSearchTargetDomId("event", id)}
                  formatEventWorkspaceDateLabel={formatEventWorkspaceDateLabel}
                  getEventStatusTone={getEventStatusTone}
                  getEventStatusLabel={getEventStatusLabel}
                  getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
                />
              )}
            />
          )}

          {activeTab === "mail" && (
            <EventMailScreen
              settings={settings}
              onSettingsChange={setSettings}
              emailReadinessTone={emailReadinessTone}
              emailReadinessLabel={emailReadinessLabel}
              emailStatus={emailStatus}
              emailStatusLoading={emailStatusLoading}
              eventMailDirty={eventMailDirty}
              onSaveEventMailSettings={saveEventMailSettings}
              saving={saving}
              eventMessage={eventMessage}
              settingsMessage={settingsMessage}
              onFetchEmailStatus={fetchEmailStatus}
              selectedEventId={selectedEventId}
              emailTestAddress={emailTestAddress}
              onEmailTestAddressChange={setEmailTestAddress}
              onSendTestEmail={handleSendTestEmail}
              emailTestSending={emailTestSending}
              emailTestMessage={emailTestMessage}
              emailTemplateDefinition={emailTemplateDefinition}
              emailTemplateDirty={emailTemplateDirty}
              selectedEmailTemplateKind={selectedEmailTemplateKind}
              onSelectedEmailTemplateKindChange={setSelectedEmailTemplateKind}
              isEmailTemplateKindDirty={isEmailTemplateKindDirty}
              hasCustomEmailTemplateOverride={hasCustomEmailTemplateOverride}
              selectedEmailTemplateDirty={selectedEmailTemplateDirty}
              selectedEmailTemplateIsCustom={selectedEmailTemplateIsCustom}
              resetEmailTemplateToDefault={resetEmailTemplateToDefault}
              selectedEmailTemplateSubject={selectedEmailTemplateSubject}
              selectedEmailTemplateHtml={selectedEmailTemplateHtml}
              selectedEmailTemplateText={selectedEmailTemplateText}
              renderedEmailPreviewHtml={renderedEmailPreviewHtml}
              renderedEmailPreviewSubject={renderedEmailPreviewSubject}
              renderedEmailPreviewText={renderedEmailPreviewText}
              updateEmailTemplateValue={updateEmailTemplateValue}
            />
          )}

          {activeTab === "design" && (
            <ContextScreen
              selectedEvent={selectedEvent}
              getEventStatusTone={getEventStatusTone}
              getEventStatusLabel={getEventStatusLabel}
              eventContextDirty={eventContextDirty}
              eventCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent)}
              onToggleEventCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEvent)}
              onSaveEventContext={saveEventContext}
              saving={saving}
              canManageKnowledge={canManageKnowledge}
              knowledgeActionsRef={knowledgeActionsRef}
              knowledgeActionsOpen={knowledgeActionsOpen}
              onKnowledgeActionsOpenChange={setKnowledgeActionsOpen}
              knowledgeResetting={knowledgeResetting}
              selectedEventId={selectedEventId}
              onResetEventKnowledge={handleResetEventKnowledge}
              settings={settings}
              onSettingsChange={setSettings}
              settingsMessage={settingsMessage}
              knowledgeDocumentsCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments)}
              onToggleKnowledgeDocumentsCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextKnowledgeDocuments)}
              documentFileInputRef={documentFileInputRef}
              onImportDocumentFile={handleImportDocumentFile}
              documentsLoading={documentsLoading}
              editingDocumentId={editingDocumentId}
              onResetDocumentForm={resetDocumentForm}
              documentTitle={documentTitle}
              onDocumentTitleChange={setDocumentTitle}
              documentSourceType={documentSourceType}
              onDocumentSourceTypeChange={setDocumentSourceType}
              documentSourceUrl={documentSourceUrl}
              onDocumentSourceUrlChange={setDocumentSourceUrl}
              documentContent={documentContent}
              onDocumentContentChange={setDocumentContent}
              onSaveDocument={handleSaveDocument}
              documentsMessage={documentsMessage}
              attachedDocumentsCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments)}
              onToggleAttachedDocumentsCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextAttachedDocuments)}
              filteredDocuments={filteredDocuments}
              deferredDocumentListQuery={deferredDocumentListQuery}
              documentListQuery={documentListQuery}
              onDocumentListQueryChange={setDocumentListQuery}
              onRefreshDocuments={fetchDocuments}
              isContextDocumentCollapsed={isContextDocumentCollapsed}
              onToggleContextDocumentCollapsed={toggleContextDocumentCollapsed}
              selectedDocumentForChunksId={selectedDocumentForChunksId}
              onSelectDocumentForChunks={selectDocumentForChunks}
              getSearchTargetDomId={getSearchTargetDomId}
              isSearchFocused={isSearchFocused}
              onLoadDocumentIntoForm={loadDocumentIntoForm}
              onDocumentStatusToggle={handleDocumentStatusToggle}
              chunkInspectorCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector)}
              onToggleChunkInspectorCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextChunkInspector)}
              selectedDocumentForChunks={selectedDocumentForChunks}
              onFetchDocumentChunks={fetchDocumentChunks}
              documentChunksLoading={documentChunksLoading}
              documentChunks={documentChunks}
              embeddingPreviewCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview)}
              onToggleEmbeddingPreviewCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextEmbeddingPreview)}
              embeddingPreviewLoading={embeddingPreviewLoading}
              embeddingEnqueueLoading={embeddingEnqueueLoading}
              onEnqueueEmbedding={handleEnqueueEmbedding}
              onFetchEmbeddingPreview={fetchEmbeddingPreview}
              embeddingPreview={embeddingPreview}
              embeddingPreviewMessage={embeddingPreviewMessage}
              retrievalDebugCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug)}
              onToggleRetrievalDebugCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextRetrievalDebug)}
              retrievalQuery={retrievalQuery}
              onRetrievalQueryChange={setRetrievalQuery}
              retrievalLoading={retrievalLoading}
              onFetchRetrievalDebug={fetchRetrievalDebug}
              retrievalDebug={retrievalDebug}
              retrievalMessage={retrievalMessage}
              activeDocumentCount={documents.filter((document) => document.is_active).length}
              llmUsageCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextLlmUsage)}
              onToggleLlmUsageCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.contextLlmUsage)}
              onFetchLlmUsageSummary={fetchLlmUsageSummary}
              llmUsageLoading={llmUsageLoading}
              activeLlmModel={activeLlmModel}
              selectedEventUsage={selectedEventUsage}
              overallLlmUsage={overallLlmUsage}
              llmUsageSummary={llmUsageSummary}
              llmUsageError={llmUsageError}
              formatCompactNumber={formatCompactNumber}
              formatUsdCost={formatUsdCost}
            />
          )}

          {activeTab === "test" && (
            <TestConsoleScreen
              testMessages={testMessages}
              eventOperatorGuard={eventOperatorGuard}
              selectedEventStatusLabel={selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : null}
              selectedRegistrationAvailabilityLabel={
                selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open"
                  ? getRegistrationAvailabilityLabel(selectedEvent.registration_availability)
                  : null
              }
              isTyping={isTyping}
              extractImageAttachmentsFromParts={extractImageAttachmentsFromParts}
              registrations={registrations}
              eventName={settings.event_name}
              attendeeLocationLabel={attendeeLocationLabel}
              eventDateLabel={timingInfo.eventDateLabel}
              resolvedEventMapUrl={resolvedEventMapUrl}
              testImageInputRef={testImageInputRef}
              onTestImageSelection={handleTestImageSelection}
              testPendingImages={testPendingImages}
              testAttachmentError={testAttachmentError}
              onRemoveTestPendingImage={removeTestPendingImage}
              onClearTestPendingImages={clearTestPendingImages}
              inputText={inputText}
              onInputTextChange={setInputText}
              onTestSend={handleTestSend}
              onClearMessages={() => setTestMessages([])}
            />
          )}

          {activeTab === "agent" && (
            agentWorkspaceView === "console" ? (
              <AgentConsoleScreen
                isAgentMobileFocusMode={isAgentMobileFocusMode}
                adminAgentGuardBody={adminAgentGuardBody}
                adminAgentGuardLabel={adminAgentGuardLabel}
                adminAgentDashboardOpen={adminAgentDashboardOpen}
                onAdminAgentDashboardOpenChange={setAdminAgentDashboardOpen}
                onFetchAdminAgentDashboard={fetchAdminAgentDashboard}
                selectedEventId={selectedEventId}
                adminAgentDashboardLoading={adminAgentDashboardLoading}
                agentMobileFocusMode={agentMobileFocusMode}
                onAgentMobileFocusModeChange={setAgentMobileFocusMode}
                onClearAdminAgentChat={handleAdminAgentClearChat}
                settings={settings}
                activeAgentMessageCount={activeAgentMessageCount}
                selectedEvent={selectedEvent}
                getEventStatusTone={getEventStatusTone}
                getEventStatusLabel={getEventStatusLabel}
                adminAgentDashboard={adminAgentDashboard}
                selectedAdminAgentDashboardEvent={selectedAdminAgentDashboardEvent}
                formatEventWorkspaceDateLabel={formatEventWorkspaceDateLabel}
                adminAgentDashboardError={adminAgentDashboardError}
                onOpenWorkspace={() => {
                  setEventWorkspaceView("setup");
                  setActiveTab("event");
                }}
                applyAdminAgentCommand={applyAdminAgentCommand}
                adminAgentMessages={adminAgentMessages}
                adminAgentTyping={adminAgentTyping}
                adminAgentScrollRef={adminAgentScrollRef}
                adminAgentBottomRef={adminAgentBottomRef}
                formatAdminActionLabel={formatAdminActionLabel}
                adminCommandPaletteRef={adminCommandPaletteRef}
                adminCommandPaletteOpen={adminCommandPaletteOpen}
                adminCommandPaletteQuery={adminCommandPaletteQuery}
                onAdminCommandPaletteQueryChange={setAdminCommandPaletteQuery}
                adminCommandPaletteSearchInputRef={adminCommandPaletteSearchInputRef}
                filteredAdminCommandTemplates={filteredAdminCommandTemplates}
                onApplyAdminCommandTemplate={handleApplyAdminCommandTemplate}
                closeAdminCommandPalette={closeAdminCommandPalette}
                adminAgentInputRef={adminAgentInputRef}
                adminAgentImageInputRef={adminAgentImageInputRef}
                onAdminAgentImageSelection={handleAdminAgentImageSelection}
                adminAgentPendingImages={adminAgentPendingImages}
                adminAgentAttachmentError={adminAgentAttachmentError}
                onRemoveAdminAgentPendingImage={removeAdminAgentPendingImage}
                onClearAdminAgentPendingImages={clearAdminAgentPendingImages}
                adminAgentImageQuickTemplates={adminAgentImageQuickTemplates}
                onToggleAdminCommandPalette={handleToggleAdminCommandPalette}
                adminAgentInputText={adminAgentInputText}
                onAdminAgentInputTextChange={setAdminAgentInputText}
                onAdminAgentSend={handleAdminAgentSend}
                adminAgentConsoleQuickTemplates={adminAgentConsoleQuickTemplates}
              />
            ) : (
              <AgentSetupScreen
                onSaveAgentSettings={saveAgentSettings}
                saving={saving}
                canEditSettings={canEditSettings}
                settings={settings}
                onSettingsChange={setSettings}
                agentRuntimeCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime)}
                onToggleAgentRuntimeCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentRuntime)}
                recommendedAdminAgentPrompt={RECOMMENDED_ADMIN_AGENT_PROMPT}
                desktopNotifyEnabled={desktopNotifyEnabled}
                onDesktopNotifyEnabledChange={setDesktopNotifyEnabled}
                desktopNotificationSupported={desktopNotificationSupported}
                desktopNotifyPermission={desktopNotifyPermission}
                desktopNotifyPermissionLabel={desktopNotifyPermissionLabel}
                onRequestDesktopNotificationPermission={requestDesktopNotificationPermission}
                selectedEventId={selectedEventId}
                agentExternalChannelCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel)}
                onToggleAgentExternalChannelCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.agentExternalChannel)}
                adminAgentTelegramWebhookUrl={adminAgentTelegramWebhookUrl}
                adminAgentTelegramSetWebhookUrl={adminAgentTelegramSetWebhookUrl}
                onCopyToClipboard={copyToClipboard}
                settingsMessage={settingsMessage}
              />
            )
          )}

          {activeTab === "registrations" && (
            <motion.div
              key="registrations"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <RegistrationsScreen
                filteredRegistrations={filteredRegistrations}
                registrationAvailability={registrationAvailability}
                registrationCapacity={registrationCapacity}
                activeAttendeeCount={activeAttendeeCount}
                selectedEventId={selectedEventId}
                registrationListQuery={registrationListQuery}
                onRegistrationListQueryChange={setRegistrationListQuery}
                deferredRegistrationListQuery={deferredRegistrationListQuery}
                visibleRegistrations={visibleRegistrations}
                selectedRegistrationId={selectedRegistrationId}
                onSelectRegistration={setSelectedRegistrationId}
                getSearchTargetDomId={getSearchTargetDomId}
                isSearchFocused={isSearchFocused}
                getRegistrationStatusTone={getRegistrationStatusTone}
                hasMoreRegistrations={hasMoreRegistrations}
                onLoadMoreRegistrations={() => setRegistrationVisibleCount((count) => count + 120)}
                registrationsCount={registrations.length}
                registeredCount={registeredCount}
                checkedInCount={checkedInCount}
                cancelledCount={cancelledCount}
                checkInRate={checkInRate}
                selectedRegistration={selectedRegistration}
                selectedTicketPreview={selectedRegistration ? (
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
                ) : null}
                selectedTicketPngUrl={selectedTicketPngUrl}
                selectedTicketSvgUrl={selectedTicketSvgUrl}
                canChangeRegistrationStatus={canChangeRegistrationStatus}
                onDeleteRegistration={deleteRegistration}
                deleteRegistrationLoading={deleteRegistrationLoading}
                onUpdateRegistrationStatus={updateRegistrationStatus}
                statusUpdateLoading={statusUpdateLoading}
                statusUpdateMessage={statusUpdateMessage}
              />
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
              <CheckinScreen
                selectedEvent={selectedEvent}
                getEventStatusLabel={getEventStatusLabel}
                getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
                checkinOperatorGuardTone={toBannerTone(checkinOperatorGuard.tone)}
                registeredCount={registeredCount}
                cancelledCount={cancelledCount}
                checkedInCount={checkedInCount}
                checkInRate={checkInRate}
                canUseQrScanner={canUseQrScanner}
                scannerActive={scannerActive}
                scannerStarting={scannerStarting}
                startQrScanner={startQrScanner}
                stopQrScanner={stopQrScanner}
                videoRef={videoRef}
                lastScannedValue={lastScannedValue}
                scannerError={scannerError}
                searchId={searchId}
                onSearchIdChange={setSearchId}
                onSearchIdKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleCheckin();
                  }
                }}
                onManualCheckin={handleCheckin}
                checkinStatus={checkinStatus}
                checkinErrorMessage={checkinErrorMessage}
                latestResultLabel={latestResultLabel}
                latestCheckinRegistration={latestCheckinRegistration}
                latestResultToneClass={latestResultToneClass}
                checkinAccessMode={checkinAccessMode}
                onOpenRegistrations={() => handleNavigateToTab("registrations")}
                canManageCheckinAccess={canManageCheckinAccess}
                checkinSessionLabel={checkinSessionLabel}
                onCheckinSessionLabelChange={setCheckinSessionLabel}
                checkinSessionHours={checkinSessionHours}
                onCheckinSessionHoursChange={setCheckinSessionHours}
                onCreateCheckinSession={handleCreateCheckinSession}
                checkinSessionCreating={checkinSessionCreating}
                selectedEventId={selectedEventId}
                selectedEventCheckinLocked={selectedEventCheckinLocked}
                checkinSessionMessage={checkinSessionMessage}
                checkinSessionReveal={checkinSessionReveal}
                onCopyCheckinSessionUrl={() => copyToClipboard(checkinSessionReveal?.url || "")}
                copied={copied}
                checkinSessions={checkinSessions}
                onRefreshCheckinSessions={() => fetchCheckinSessions(selectedEventId)}
                checkinSessionsLoading={checkinSessionsLoading}
                getCheckinSessionTone={getCheckinSessionTone}
                onRevokeCheckinSession={handleRevokeCheckinSession}
                checkinSessionRevokingId={checkinSessionRevokingId}
              />
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
              <PublicInboxScreen
                counts={publicInboxCounts}
                totalConversationCount={publicInboxConversations.length}
                deferredQuery={deferredPublicInboxQuery}
                filteredConversations={filteredPublicInboxConversations}
                selectedEventName={selectedEvent ? selectedEvent.name : null}
                loading={publicInboxLoading}
                selectedEventId={selectedEventId}
                onRefreshConversations={() => fetchPublicInboxConversations(selectedEventId)}
                searchQuery={publicInboxSearchQuery}
                onSearchQueryChange={setPublicInboxSearchQuery}
                statusFilter={publicInboxStatusFilter}
                onStatusFilterChange={setPublicInboxStatusFilter}
                message={publicInboxMessage}
                selectedSenderId={selectedPublicInboxSenderId}
                onSelectConversation={setSelectedPublicInboxSenderId}
                getAttentionReasonLabel={getPublicInboxAttentionReasonLabel}
                getStatusTone={getPublicInboxStatusTone}
                getStatusLabel={getPublicInboxStatusLabel}
                activeConversation={activePublicInboxConversation}
                conversationLoading={publicInboxConversationLoading}
                onRefreshConversation={fetchPublicInboxConversation}
                canManageRegistrations={canManageRegistrations}
                onOpenRegistration={(registrationId) => {
                  setSelectedRegistrationId(registrationId);
                  handleNavigateToTab("registrations");
                }}
                canChangeConversationStatus={canChangeRegistrationStatus}
                statusUpdating={publicInboxStatusUpdating}
                onUpdateConversationStatus={updatePublicInboxConversationStatus}
                conversationMessages={publicInboxConversationMessages}
                replyText={publicInboxReplyText}
                onReplyTextChange={setPublicInboxReplyText}
                canSendManualOverride={canSendManualOverride}
                replySending={publicInboxReplySending}
                onReplySubmit={handlePublicInboxReplySubmit}
              />
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
              <LogsScreen
                selectedEvent={selectedEvent}
                getEventStatusTone={getEventStatusTone}
                getEventStatusLabel={getEventStatusLabel}
                messages={messages}
                logsHasMore={logsHasMore}
                deferredLogListQuery={deferredLogListQuery}
                filteredMessages={filteredMessages}
                eventOperatorGuardBody={eventOperatorGuard.body}
                onLoadOlderLogs={handleLoadOlderLogs}
                logsLoadingMore={logsLoadingMore}
                onRefreshMessages={() => fetchMessages(selectedEventId)}
                logListQuery={logListQuery}
                onLogListQueryChange={setLogListQuery}
                getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
                parseLineTraceMessage={parseLineTraceMessage}
                parseInternalLogMarker={parseInternalLogMarker}
                getLogDirectionMeta={getLogDirectionMeta}
                formatTraceStatusLabel={formatTraceStatusLabel}
                getLogMessageDisplayText={getLogMessageDisplayText}
                selectedLogMessageId={selectedLogMessageId}
                onSelectLogMessage={setSelectedLogMessageId}
                getSearchTargetDomId={getSearchTargetDomId}
                isSearchFocused={isSearchFocused}
                logInspectorPanel={logInspectorPanel}
              />
            </motion.div>
          )}

          {activeTab === "settings" && (
            <SettingsScreen
              settings={settings}
              onSettingsChange={setSettings}
              aiSettingsDirty={aiSettingsDirty}
              llmModelsLoading={llmModelsLoading}
              onSaveAiSettings={saveAiSettings}
              saving={saving}
              llmModels={llmModels}
              selectedEvent={selectedEvent}
              settingsMessage={settingsMessage}
              llmModelsError={llmModelsError}
              workspaceChannelCount={workspaceChannelCount}
              workspaceActiveChannelCount={workspaceActiveChannelCount}
              workspaceChannelPlatformCount={workspaceChannelPlatformCount}
              workspaceChannelEventCount={workspaceChannelEventCount}
              workspaceChannelPreview={workspaceChannelPreview}
              workspaceOtherEventChannels={workspaceOtherEventChannels}
              setupSelectedChannelId={setupSelectedChannelId}
              eventNameById={eventNameById}
              onFocusSetupChannel={focusSetupChannel}
              onOpenChannelConfigDialog={openChannelConfigDialog}
              onAssignChannelToSelectedEvent={handleAssignChannelToSelectedEvent}
              eventLoading={eventLoading}
              selectedEventChannelWritesLocked={selectedEventChannelWritesLocked}
              visibleSelectedEventChannels={visibleSelectedEventChannels}
              getEventStatusLabel={getEventStatusLabel}
              getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
              channelsCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels)}
              onToggleChannelsCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupChannels)}
              eventOperatorGuardTone={toBannerTone(eventOperatorGuard.tone)}
              eventOperatorGuardBody={eventOperatorGuard.body}
              setupSelectedChannel={setupSelectedChannel}
              onSelectSetupChannel={selectSetupChannel}
              getSearchTargetDomId={getSearchTargetDomId}
              isSearchFocused={isSearchFocused}
              getChannelTokenStatusMeta={getChannelTokenStatusMeta}
              onUnassignChannelFromSelectedEvent={handleUnassignChannelFromSelectedEvent}
              onToggleChannel={handleToggleChannel}
              webhookConfigCollapsed={isSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupWebhookConfig)}
              onToggleWebhookConfigCollapsed={() => toggleSectionCollapsed(COLLAPSIBLE_SECTION_KEYS.setupWebhookConfig)}
              selectedWebhookConfigKey={selectedWebhookConfigKey}
              onSelectedWebhookConfigKeyChange={(key) => setSelectedWebhookConfigKey(key as WebhookConfigKey)}
              setupWebhookItems={setupWebhookItems}
              selectedWebhookConfigItem={selectedWebhookConfigItem}
              copied={copied}
              onCopyToClipboard={copyToClipboard}
              buildWebChatEmbedSnippet={buildWebChatEmbedSnippet}
              appUrl={appUrl}
              webhookSettingsDirty={webhookSettingsDirty}
              onSaveWebhookSettings={saveWebhookSettings}
            />
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
      </AdminWorkspaceFrame>

      <AppOverlays
        dirtyNavigationDialog={dirtyNavigationDialog}
        dirtyNavigationTargetLabel={dirtyNavigationTargetLabel}
        dirtyNavigationSectionLabels={dirtyNavigationSectionLabels}
        onCloseDirtyNavigationDialog={closeDirtyNavigationDialog}
        onLeaveDirtyNavigationWithoutSaving={handleDirtyNavigationLeaveWithoutSaving}
        onSaveDirtyNavigationAndLeave={handleDirtyNavigationSaveAndLeave}
        channelConfigDialogOpen={channelConfigDialogOpen}
        editingChannelKey={editingChannelKey}
        newChannelPlatform={newChannelPlatform}
        onNewChannelPlatformChange={(platform) => {
          setNewChannelPlatform(platform);
          setNewChannelConfig({});
          if (platform === "line_oa") {
            setNewPageId("");
          }
        }}
        selectedChannelPlatformDefinition={selectedChannelPlatformDefinition}
        editingChannel={editingChannel}
        eventNameById={eventNameById}
        selectedEventName={selectedEvent?.name || ""}
        onCloseChannelConfigDialog={closeChannelConfigDialog}
        newPageName={newPageName}
        onNewPageNameChange={setNewPageName}
        newPageId={newPageId}
        onNewPageIdChange={setNewPageId}
        lineChannelIdAutoResolved={lineChannelIdAutoResolved}
        newPageAccessToken={newPageAccessToken}
        onNewPageAccessTokenChange={setNewPageAccessToken}
        newChannelConfig={newChannelConfig}
        onNewChannelConfigFieldChange={(key, value) => setNewChannelConfig((prev) => ({ ...prev, [key]: value }))}
        channelFormMissingRequirements={channelFormMissingRequirements}
        selectedEventId={selectedEventId}
        eventLoading={eventLoading}
        selectedEventChannelWritesLocked={selectedEventChannelWritesLocked}
        onSaveChannelAndClose={async () => {
          const saved = await handleSaveChannel();
          if (saved) {
            closeChannelConfigDialog();
          }
        }}
        globalSearchOpen={globalSearchOpen}
        globalSearchInputRef={globalSearchInputRef}
        globalSearchQuery={globalSearchQuery}
        onGlobalSearchQueryChange={setGlobalSearchQuery}
        deferredGlobalSearchQuery={deferredGlobalSearchQuery}
        globalEventResults={globalEventResults}
        globalRegistrationResults={globalRegistrationResults}
        globalChannelResults={globalChannelResults}
        globalDocumentResults={globalDocumentResults}
        globalLogResults={globalLogResults}
        onGlobalSearchClose={() => setGlobalSearchOpen(false)}
        onGlobalSearchSelect={handleGlobalSearchSelect}
        getRegistrationAvailabilityTone={getRegistrationAvailabilityTone}
        getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
        getEventStatusTone={getEventStatusTone}
        getEventStatusLabel={getEventStatusLabel}
        getRegistrationStatusTone={getRegistrationStatusTone}
        helpContent={helpContent}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        isChatConsoleTab={isChatConsoleTab}
      />
    </>
  );
}
