import { useDeferredValue, useState, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { 
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
  MonitorCog,
  Trash2,
  ChevronDown,
  CircleHelp,
  Eye,
  PencilLine,
  Power,
  X,
} from "lucide-react";
import { getChatResponse } from "./services/gemini";
import { ChatBubble } from "./components/ChatBubble";
import { Ticket } from "./components/Ticket";
import { AuthUser, ChannelAccountRecord, ChannelPlatform, ChannelPlatformDefinition, CheckinAccessSession, CheckinSessionRecord, EmbeddingPreviewResponse, EventDocumentChunkRecord, EventDocumentRecord, EventRecord, EventStatus, LlmUsageSummary, Message, RetrievalDebugResponse, Settings, UserRole } from "./types";

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

type RegistrationStatus = "registered" | "cancelled" | "checked-in";
type RegistrationWindowUiState = "open" | "not_started" | "closed" | "invalid";
type ThemeMode = "light" | "dark" | "system";
type AppTab = "event" | "design" | "test" | "logs" | "settings" | "registrations" | "checkin";
type BadgeTone = "neutral" | "blue" | "emerald" | "amber" | "rose" | "violet";
type ActionTone = BadgeTone;

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
        body: "Manual status still matters, but the effective status can auto-close once the event date is already in the past.",
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
        body: "Link channels to the selected event so incoming messages land in the correct workspace. Keep status badges green before going live.",
      },
      {
        label: "Model overrides",
        body: "Only set an event-level model override when one event truly needs different behavior. Otherwise keep the global default simple.",
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

const MANAGEABLE_ROLES: UserRole[] = ["owner", "admin", "operator", "checker", "viewer"];
const THEME_STORAGE_KEY = "facebotstudio-theme";
const INITIAL_CHECKIN_TOKEN =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("checkin_token")?.trim() || ""
    : "";

function getStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
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

const DEFAULT_TIMEZONE = "Asia/Bangkok";

function parseLineTraceMessage(text: string) {
  const match = String(text || "").match(/^\[line:([a-z-]+)\]\s*(.*)$/i);
  if (!match) return null;

  return {
    status: match[1].toLowerCase(),
    detail: match[2] || "",
  };
}

function formatTraceStatusLabel(status: string) {
  return status
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function describeEventTiming(settings: Settings) {
  const timeZone = normalizeTimeZoneForUi(settings.event_timezone);
  const now = new Date();
  const start = zonedDateTimeToUtcForUi(settings.reg_start || "", timeZone);
  const end = zonedDateTimeToUtcForUi(settings.reg_end || "", timeZone);
  const eventDate = zonedDateTimeToUtcForUi(settings.event_date || "", timeZone);

  let registrationStatus: RegistrationWindowUiState = "open";
  if (start && end && end.getTime() < start.getTime()) {
    registrationStatus = "invalid";
  } else if (start && now < start) {
    registrationStatus = "not_started";
  } else if (end && now > end) {
    registrationStatus = "closed";
  }

  const eventLifecycle = !eventDate
    ? "unscheduled"
    : now.getTime() < eventDate.getTime()
    ? "upcoming"
    : "past";

  return {
    timeZone,
    now,
    nowLabel: formatInTimeZoneForUi(now, timeZone),
    start,
    end,
    eventDate,
    startLabel: start ? formatInTimeZoneForUi(start, timeZone) : "-",
    endLabel: end ? formatInTimeZoneForUi(end, timeZone) : "-",
    eventDateLabel: eventDate ? formatInTimeZoneForUi(eventDate, timeZone) : "-",
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
    case "closed":
      return "closed";
    case "cancelled":
      return "cancelled";
    default:
      return status;
  }
}

function getEventStatusBadgeClass(status: EventStatus) {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700";
    case "pending":
      return "bg-amber-100 text-amber-700";
    case "closed":
      return "bg-slate-200 text-slate-600";
    case "cancelled":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-slate-200 text-slate-600";
  }
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

function getCheckinSessionTone(session: CheckinSessionRecord): BadgeTone {
  if (session.revoked_at) return "neutral";
  return session.is_active ? "emerald" : "amber";
}

function getUserAccessTone(isActive: boolean): BadgeTone {
  return isActive ? "emerald" : "neutral";
}

function getTokenStatusTone(channel: ChannelAccountRecord): BadgeTone {
  if (channel.platform === "web_chat") return "violet";
  if (channel.has_access_token) return "blue";
  return "amber";
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

function HelpPopover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="relative shrink-0" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-7 items-center justify-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 transition-colors hover:bg-slate-50"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
      >
        <CircleHelp className="h-3.5 w-3.5" />
        <span>Notes</span>
      </button>
      {open && (
        <div className="app-overlay-surface absolute right-0 top-full z-20 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-xl">
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
}: {
  label: string;
  tone?: ActionTone;
  children: ReactNode;
  className?: string;
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
        className={`min-w-[3.75rem] px-3 text-sm ${className.includes("w-full") ? "w-full justify-center" : ""}`.trim()}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </ActionButton>
      {open && (
        <div
          className="app-overlay-surface absolute right-0 top-full z-20 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"
          onClickCapture={(event) => {
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

const INITIAL_SETTINGS: Settings = {
  context: "",
  llm_model: "",
  global_system_prompt: "You are a helpful assistant for an event registration system. Be polite, concise, and operationally accurate.",
  global_llm_model: "google/gemini-3-flash-preview",
  verify_token: "",
  event_name: "",
  event_timezone: DEFAULT_TIMEZONE,
  event_location: "",
  event_map_url: "",
  event_date: "",
  event_description: "",
  event_travel: "",
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
    event_location: "",
    event_map_url: "",
    event_date: "",
    event_description: "",
    event_travel: "",
    reg_limit: "200",
    reg_start: "",
    reg_end: "",
  } satisfies Pick<
    Settings,
    | "context"
    | "llm_model"
    | "event_name"
    | "event_timezone"
    | "event_location"
    | "event_map_url"
    | "event_date"
    | "event_description"
    | "event_travel"
    | "reg_limit"
    | "reg_start"
    | "reg_end"
  >;
}

function buildSettingsFromResponse(previous: Settings, data: Partial<Settings> | Record<string, unknown>) {
  return {
    context: typeof data.context === "string" ? data.context : "",
    llm_model: typeof data.llm_model === "string" ? data.llm_model : "",
    global_system_prompt:
      typeof data.global_system_prompt === "string" ? data.global_system_prompt : previous.global_system_prompt,
    global_llm_model:
      typeof data.global_llm_model === "string" ? data.global_llm_model : previous.global_llm_model,
    verify_token: typeof data.verify_token === "string" ? data.verify_token : previous.verify_token,
    event_name: typeof data.event_name === "string" ? data.event_name : "",
    event_timezone: normalizeTimeZoneForUi(
      typeof data.event_timezone === "string" ? data.event_timezone : DEFAULT_TIMEZONE,
    ),
    event_location: typeof data.event_location === "string" ? data.event_location : "",
    event_map_url: typeof data.event_map_url === "string" ? data.event_map_url : "",
    event_date: normalizeDateTimeLocalValue(typeof data.event_date === "string" ? data.event_date : ""),
    event_description: typeof data.event_description === "string" ? data.event_description : "",
    event_travel: typeof data.event_travel === "string" ? data.event_travel : "",
    reg_limit:
      typeof data.reg_limit === "string" && data.reg_limit.trim() ? data.reg_limit.trim() : INITIAL_SETTINGS.reg_limit,
    reg_start: normalizeDateTimeLocalValue(typeof data.reg_start === "string" ? data.reg_start : ""),
    reg_end: normalizeDateTimeLocalValue(typeof data.reg_end === "string" ? data.reg_end : ""),
  } satisfies Settings;
}

function normalizeSearchQuery(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
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

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("event");
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [channels, setChannels] = useState<ChannelAccountRecord[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventLoading, setEventLoading] = useState(false);
  const [eventMessage, setEventMessage] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [editingEventName, setEditingEventName] = useState("");
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
  const [copied, setCopied] = useState(false);
  const [selectedWebhookConfigKey, setSelectedWebhookConfigKey] = useState<WebhookConfigKey>("facebook");
  const [searchId, setSearchId] = useState("");
  const [checkinAccessToken] = useState(INITIAL_CHECKIN_TOKEN);
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
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [eventListQuery, setEventListQuery] = useState("");
  const [channelListQuery, setChannelListQuery] = useState("");
  const [registrationListQuery, setRegistrationListQuery] = useState("");
  const [documentListQuery, setDocumentListQuery] = useState("");
  const [logListQuery, setLogListQuery] = useState("");
  const [channelDetailsOpenIds, setChannelDetailsOpenIds] = useState<string[]>([]);
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
  const [operationsMenuOpen, setOperationsMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [knowledgeActionsOpen, setKnowledgeActionsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [registrationVisibleCount, setRegistrationVisibleCount] = useState(120);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const scannerCooldownRef = useRef(false);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedEventIdRef = useRef("");
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const qrReaderRef = useRef<BrowserQRCodeReader | null>(null);
  const operationsMenuRef = useRef<HTMLDivElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const knowledgeActionsRef = useRef<HTMLDivElement | null>(null);
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const searchFocusTimeoutRef = useRef<number | null>(null);
  selectedEventIdRef.current = selectedEventId;

  const checkinAccessMode = Boolean(checkinAccessToken);
  const role = authUser?.role;
  const canEditSettings = role === "owner" || role === "admin";
  const canRunTest = role === "owner" || role === "admin" || role === "operator";
  const canViewLogs = role === "owner" || role === "admin" || role === "operator" || role === "viewer";
  const canManageRegistrations = role === "owner" || role === "admin" || role === "operator" || role === "checker";
  const canChangeRegistrationStatus = role === "owner" || role === "admin" || role === "operator";
  const canManageKnowledge = role === "owner" || role === "admin" || role === "operator";
  const canManageUsers = role === "owner" || role === "admin";
  const canChangeRoles = role === "owner" || role === "admin";
  const canManageCheckinAccess = role === "owner" || role === "admin" || role === "operator";
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
  const deferredChannelListQuery = useDeferredValue(normalizeSearchQuery(channelListQuery));
  const deferredRegistrationListQuery = useDeferredValue(normalizeSearchQuery(registrationListQuery));
  const deferredDocumentListQuery = useDeferredValue(normalizeSearchQuery(documentListQuery));
  const deferredLogListQuery = useDeferredValue(normalizeSearchQuery(logListQuery));

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
  const activeAttendeeCount = registrations.filter((reg) => reg.status !== "cancelled").length;
  const checkInRate = activeAttendeeCount > 0 ? Math.round((checkedInCount / activeAttendeeCount) * 100) : 0;
  const canUseQrScanner =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);
  const searchShortcutLabel =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      ? "Cmd K"
      : "Ctrl K";
  const isOperationsTab = activeTab === "registrations" || activeTab === "checkin" || activeTab === "logs";
  const primaryTabs = [
    ...(canEditSettings ? [{ id: "event" as const, icon: CalendarRange, label: "Event" }] : []),
    ...(canEditSettings ? [{ id: "design" as const, icon: Code, label: "Context" }] : []),
    ...(canRunTest ? [{ id: "test" as const, icon: MessageSquare, label: "Test" }] : []),
    ...(canEditSettings ? [{ id: "settings" as const, icon: SettingsIcon, label: "Setup" }] : []),
  ];
  const operationsTabs = [
    ...(canManageRegistrations ? [{ id: "registrations" as const, icon: Users, label: "Registrations" }] : []),
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
  const selectedEvent = events.find((event) => event.id === selectedEventId) || null;
  const selectedEventChannels = channels.filter((channel) => channel.event_id === selectedEventId);
  const selectedChannelPlatformDefinition = channelPlatformDefinitions.find((definition) => definition.id === newChannelPlatform) || null;
  const editingChannel = channels.find((channel) => `${channel.platform}:${channel.external_id}` === editingChannelKey) || null;
  const channelFormMissingRequirements = (() => {
    if (!selectedChannelPlatformDefinition) return [];
    const missing: string[] = [];
    const hasAccessToken = Boolean(newPageAccessToken.trim() || editingChannel?.has_access_token || (newChannelPlatform === "facebook"));
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
    selectedEvent?.effective_status === "closed" || selectedEvent?.effective_status === "cancelled";
  const workingEvents = events.filter((event) => event.effective_status === "active" || event.effective_status === "pending");
  const closedEvents = events.filter((event) => event.effective_status === "closed");
  const cancelledEvents = events.filter((event) => event.effective_status === "cancelled");
  const filteredWorkingEvents = workingEvents.filter((event) =>
    matchesSearchQuery(deferredEventListQuery, [event.name, event.slug, getEventStatusLabel(event.effective_status)]),
  );
  const filteredClosedEvents = closedEvents.filter((event) =>
    matchesSearchQuery(deferredEventListQuery, [event.name, event.slug, getEventStatusLabel(event.effective_status)]),
  );
  const filteredCancelledEvents = cancelledEvents.filter((event) =>
    matchesSearchQuery(deferredEventListQuery, [event.name, event.slug, getEventStatusLabel(event.effective_status)]),
  );
  const selectorEvents = (() => {
    const base = workingEvents.length > 0 ? [...workingEvents] : [...events];
    if (selectedEvent && !base.some((event) => event.id === selectedEvent.id)) {
      base.unshift(selectedEvent);
    }
    return base;
  })();
  const eventStatusToggle = (() => {
    if (!selectedEvent) {
      return {
        label: "LIVE!",
        nextStatus: "active" as const,
        tone: "emerald" as ActionTone,
        disabled: true,
      };
    }
    if (selectedEvent.status === "active") {
      return {
        label: "Back to Pending",
        nextStatus: "pending" as const,
        tone: "amber" as ActionTone,
        disabled: selectedEvent.is_default || eventLoading,
      };
    }
    if (selectedEvent.status === "cancelled") {
      return {
        label: "Restore Pending",
        nextStatus: "pending" as const,
        tone: "blue" as ActionTone,
        disabled: selectedEvent.is_default || eventLoading,
      };
    }
    return {
      label: "LIVE!",
      nextStatus: "active" as const,
      tone: "emerald" as ActionTone,
      disabled: eventLoading,
    };
  })();
  const filteredSelectedEventChannels = selectedEventChannels.filter((channel) =>
    matchesSearchQuery(deferredChannelListQuery, [
      channel.display_name,
      channel.external_id,
      channel.platform_label,
      channel.platform,
      channel.connection_status,
      channel.platform_description,
      ...(channel.config_summary?.flatMap((item) => [item.label, item.value]) || []),
    ]),
  );
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
      message.text,
      message.type,
      parseLineTraceMessage(message.text)?.status,
      parseLineTraceMessage(message.text)?.detail,
    ]),
  );
  const globalEventResults = deferredGlobalSearchQuery
    ? events.filter((event) =>
        matchesSearchQuery(deferredGlobalSearchQuery, [event.name, event.slug, getEventStatusLabel(event.effective_status)]),
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

  const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init);
    if (res.status === 401 && !checkinAccessMode) {
      setAuthStatus("unauthenticated");
      setAuthUser(null);
      setLoading(false);
      stopQrScanner();
    }
    return res;
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

  const fetchCheckinAccessSession = async (token = checkinAccessToken) => {
    if (!token) return null;
    setCheckinAccessLoading(true);
    setCheckinAccessError("");
    try {
      const res = await fetch(`/api/checkin-access/session?token=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load check-in session");
      }
      const session = data?.session as CheckinAccessSession;
      setCheckinAccessSession(session);
      setSelectedEventId(session?.event_id || "");
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load check-in session";
      setCheckinAccessError(message);
      setCheckinAccessSession(null);
      return null;
    } finally {
      setCheckinAccessLoading(false);
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
      const firstWorking = rows.find((event) => event.effective_status === "active") || rows.find((event) => event.effective_status === "pending");
      setSelectedEventId((prev) => prev && rows.some((event) => event.id === prev) ? prev : firstWorking?.id || rows[0]?.id || "");
      setEditingEventName((prev) => prev || firstWorking?.name || rows[0]?.name || "");
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
    let cancelled = false;
    if (checkinAccessMode) {
      setLoading(false);
      setAuthStatus("unauthenticated");
      void fetchCheckinAccessSession();
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const user = await fetchCurrentUser();
        if (cancelled) return;
        setAuthUser(user);
        setAuthStatus("authenticated");
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
  }, [checkinAccessMode]);

  useEffect(() => {
    if (checkinAccessMode || authStatus !== "authenticated") return;

    void loadAppData();
  }, [authStatus, role, checkinAccessMode]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !selectedEventId) return;

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
  }, [authStatus, selectedEventId, canRunTest, canViewLogs, canManageCheckinAccess, canEditSettings]);

  useEffect(() => {
    setEditingEventName(selectedEvent?.name || "");
  }, [selectedEvent?.id, selectedEvent?.name]);

  useEffect(() => {
    setRegistrationVisibleCount(120);
  }, [selectedEventId, deferredRegistrationListQuery]);

  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      ...getBlankEventScopedSettings(),
    }));
    setMessages([]);
    setRegistrations([]);
    setSelectedRegistrationId("");
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
    setOperationsMenuOpen(false);
    setUserMenuOpen(false);
    setKnowledgeActionsOpen(false);
    setGlobalSearchOpen(false);
    setHelpOpen(false);
  }, [activeTab]);

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
    const allowedTabs = [
      ...(canEditSettings ? ["event"] : []),
      ...(canEditSettings ? ["design"] : []),
      ...(canRunTest ? ["test"] : []),
      ...(canManageRegistrations ? (canEditSettings ? ["registrations", "checkin"] : ["checkin", "registrations"]) : []),
      ...(canViewLogs ? ["logs"] : []),
      ...(canEditSettings ? ["settings"] : []),
    ] as AppTab[];

    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0] || "checkin");
    }
  }, [activeTab, canEditSettings, canRunTest, canViewLogs, canManageRegistrations]);

  const extractRegistrationId = (rawValue: string) => {
    const text = String(rawValue || "").trim().toUpperCase();
    const match = text.match(/REG-[A-Z0-9]+/);
    return match?.[0] || "";
  };

  const fetchSettings = async (eventId = selectedEventId) => {
    if (!eventId) {
      setSettings((prev) => ({
        ...prev,
        ...getBlankEventScopedSettings(),
      }));
      return;
    }

    try {
      const res = await apiFetch(`/api/settings?event_id=${encodeURIComponent(eventId)}`);
      if (!res.ok) {
        throw new Error("Failed to fetch settings");
      }
      const data = await res.json();
      if (selectedEventIdRef.current !== eventId) return;
      setSettings((prev) => buildSettingsFromResponse(prev, data));
    } catch (err) {
      console.error("Failed to fetch settings", err);
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
      setEmbeddingPreviewMessage(
        (data as any)?.queued
          ? "Embedding job queued"
          : "Embedding processed inline because Redis queue was unavailable",
      );
      return true;
    } catch (err) {
      console.error("Failed to queue embedding job", err);
      setEmbeddingPreviewMessage(err instanceof Error ? err.message : "Failed to queue embedding job");
      return false;
    } finally {
      setEmbeddingEnqueueLoading(false);
    }
  };

  const fetchMessages = async (eventId = selectedEventId) => {
    try {
      const res = await apiFetch(`/api/messages?event_id=${encodeURIComponent(eventId)}`);
      if (!res.ok) {
        throw new Error("Failed to fetch messages");
      }
      const data = await res.json();
      if (selectedEventIdRef.current !== eventId) return;
      setMessages(data);
    } catch (err) {
      console.error("Failed to fetch messages", err);
    }
  };

  const normalizeSettingsForSave = (source: Settings): Settings => ({
    ...source,
    event_date: normalizeDateTimeLocalValue(source.event_date),
    reg_start: normalizeDateTimeLocalValue(source.reg_start),
    reg_end: normalizeDateTimeLocalValue(source.reg_end),
  });

  const saveSettingsSubset = async (keys: Array<keyof Settings>, successLabel: string) => {
    setSaving(true);
    setSettingsMessage("");
    try {
      const normalized = normalizeSettingsForSave(settings);
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

    const saved = await saveSettingsSubset([
      "event_name",
      "event_timezone",
      "event_location",
      "event_map_url",
      "event_date",
      "event_description",
      "event_travel",
      "reg_limit",
      "reg_start",
      "reg_end",
    ], "Event setup saved");

    if (saved) {
      await fetchEvents();
    }
  };

  const saveEventContext = async () => saveSettingsSubset(["context"], "Event context saved");

  const saveAiSettings = async () => saveSettingsSubset([
    "global_system_prompt",
    "global_llm_model",
    "llm_model",
  ], "AI settings saved");

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
        body: JSON.stringify({ is_active: !isActive }),
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
      const requestBody = checkinAccessMode
        ? { id: normalizedId, token: checkinAccessToken }
        : { id: normalizedId };
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
      void fetchRegistrations(selectedEventId);
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
      await fetchRegistrations(selectedEventId);
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
            void fetchRegistrations(selectedEventId);
          } else if (call.name === "cancelRegistration") {
            const { registration_id } = call.args as any;
            const res = await apiFetch("/api/registrations/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: registration_id }),
            });
            const result = await res.json();

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
            
            const followUp = await getChatResponse("Registration " + registration_id + " has been cancelled.", settings, [...history, newModelMsg, funcResponseMsg], selectedEventId);
            setTestMessages(prev => [...prev, { role: "model", parts: followUp.candidates[0].content.parts, timestamp: new Date().toISOString() }]);
            void fetchRegistrations(selectedEventId);
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

      setAuthUser(data.user as AuthUser);
      setAuthStatus("authenticated");
      setLoginPassword("");
      setTeamMessage("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Failed to login");
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("Failed to logout", err);
    } finally {
      setAuthStatus("unauthenticated");
      setAuthUser(null);
      setMessages([]);
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

  const handleUpdateEvent = async (status?: "pending" | "active" | "cancelled") => {
    if (!selectedEventId || !selectedEvent) return;
    const payload: Record<string, unknown> = {};
    if (editingEventName.trim() && editingEventName.trim() !== selectedEvent.name) {
      payload.name = editingEventName.trim();
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
      setEventMessage("Event updated");
      window.setTimeout(() => setEventMessage(""), 2500);
    } catch (err) {
      setEventMessage(err instanceof Error ? err.message : "Failed to update event");
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
          event_id: selectedEventId,
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
    if (!selectedEventId) return;
    const externalId = newPageId.trim();
    const displayName = newPageName.trim();
    const accessToken = newPageAccessToken.trim();
    if (!externalId) {
      setEventMessage(selectedChannelPlatformDefinition?.external_id_label || "Channel external ID is required");
      return;
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
          event_id: selectedEventId,
          access_token: accessToken,
          config: newChannelConfig,
          is_active: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save channel");
      }
      await fetchChannels();
      setEventMessage(editingChannelKey ? "Channel updated" : "Channel linked");
      resetChannelForm();
      window.setTimeout(() => setEventMessage(""), 2500);
    } catch (err) {
      setEventMessage(err instanceof Error ? err.message : "Failed to save channel");
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

  const toggleChannelDetails = (channelId: string) => {
    setChannelDetailsOpenIds((current) =>
      current.includes(channelId) ? current.filter((id) => id !== channelId) : [...current, channelId],
    );
  };

  const handleGlobalSearchSelect = (kind: GlobalSearchResultKind, id: string) => {
    if (kind === "event") {
      const event = events.find((item) => item.id === id);
      setEventListQuery(event?.slug || event?.name || "");
      setSelectedEventId(id);
      setActiveTab("event");
      focusSearchTarget("event", id);
    }
    if (kind === "registration") {
      const registration = registrations.find((item) => item.id === id);
      setRegistrationListQuery(registration?.id || "");
      setActiveTab("registrations");
      setSelectedRegistrationId(id);
      focusSearchTarget("registration", id);
    }
    if (kind === "channel") {
      const channel = channels.find((item) => item.id === id);
      if (channel?.event_id) {
        setSelectedEventId(channel.event_id);
      }
      if (channel) {
        setChannelListQuery(channel.external_id || channel.display_name || "");
        loadChannelIntoForm(channel);
        setChannelDetailsOpenIds((current) => (current.includes(channel.id) ? current : [...current, channel.id]));
      }
      setActiveTab("settings");
      focusSearchTarget("channel", id);
    }
    if (kind === "document") {
      const document = documents.find((item) => item.id === id);
      setDocumentListQuery(document?.title || "");
      setActiveTab("design");
      selectDocumentForChunks(id);
    }
    if (kind === "log") {
      const message = messages.find((item) => String(item.id) === id);
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
              <StatusBadge tone={checkinAccessSession.event_status === "active" ? "emerald" : checkinAccessSession.event_status === "pending" ? "amber" : "neutral"}>
                {checkinAccessSession.event_status}
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
                <p className="text-xs text-slate-500">The most recently scanned or checked-in attendee.</p>
              </div>
              {latestCheckinRegistration && (
                <StatusBadge tone={getRegistrationStatusTone(latestCheckinRegistration.status)}>
                  {latestCheckinRegistration.status}
                </StatusBadge>
              )}
            </div>

            {!latestCheckinRegistration ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                No attendee checked in yet in this session.
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
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

  if (authStatus === "checking") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
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

  if (loading) {
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
  const selectedWebhookConfigItem =
    webhookConfigItems.find((item) => item.key === selectedWebhookConfigKey) || webhookConfigItems[0];

  return (
    <div className="app-shell min-h-dvh bg-slate-50 text-slate-900 font-sans">
      <header className="app-header-surface sticky top-0 z-20 border-b border-slate-200 bg-white backdrop-blur">
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
                    <StatusBadge
                      tone={selectedEvent.effective_status === "active" ? "emerald" : selectedEvent.effective_status === "pending" ? "amber" : selectedEvent.effective_status === "cancelled" ? "rose" : "neutral"}
                      className="inline-flex"
                    >
                      {getEventStatusLabel(selectedEvent.effective_status)}
                    </StatusBadge>
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
                Active event
              </label>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 lg:w-[min(32rem,100%)]">
                <CalendarRange className="h-4 w-4 shrink-0 text-slate-400" />
                <select
                  id="event-selector"
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  disabled={!selectorEvents.length || eventLoading}
                  className="min-w-0 w-full truncate bg-transparent text-sm font-medium outline-none disabled:opacity-60"
                >
                  {selectorEvents.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name} ({getEventStatusLabel(event.effective_status)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <div className="app-toolbar-surface grid flex-1 grid-flow-col auto-cols-fr gap-1 rounded-xl bg-slate-100 p-1 sm:flex sm:flex-wrap sm:gap-1 sm:rounded-2xl">
              {primaryTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-all sm:min-h-9 sm:rounded-xl sm:px-2.5 ${
                    activeTab === tab.id
                      ? "bg-white text-blue-600 shadow-sm"
                      : "text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                  }`}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                >
                  <tab.icon className="h-4 w-4 shrink-0" />
                  <span className="sr-only sm:not-sr-only sm:truncate">{tab.label}</span>
                </button>
              ))}
              {operationsTabs.length > 0 && (
                <div className="relative min-w-0" ref={operationsMenuRef}>
                  <button
                    onClick={() => setOperationsMenuOpen((open) => !open)}
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
                    <div className="app-overlay-surface absolute right-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                      {operationsTabs.map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => {
                            setActiveTab(tab.id);
                            setOperationsMenuOpen(false);
                          }}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                            activeTab === tab.id
                              ? "bg-blue-50 text-blue-700"
                              : "text-slate-600 hover:bg-slate-50"
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

      <main className={`max-w-7xl mx-auto px-3 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-6 lg:px-6 lg:py-8 ${canEditSettings ? "lg:pb-28" : ""}`}>
        <AnimatePresence mode="wait">
          {activeTab === "event" && (
            <motion.div
              key="event"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
                    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Bot className="w-5 h-5 text-blue-600" />
                          Event Information
                        </h3>
                        <p className="text-sm text-slate-500">Core event details for the selected workspace.</p>
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
                          onClick={() => void handleUpdateEvent(eventStatusToggle.nextStatus)}
                          disabled={eventStatusToggle.disabled}
                          tone={eventStatusToggle.tone}
                          active={eventStatusToggle.nextStatus === "active"}
                          className="w-full text-sm sm:w-auto sm:shrink-0"
                        >
                          {eventLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : eventStatusToggle.nextStatus === "active" ? <Power className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                          {eventStatusToggle.label}
                        </ActionButton>
                      </div>
                    </div>

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

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Location</label>
                        <input
                          value={settings.event_location}
                          onChange={(e) => setSettings({ ...settings, event_location: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g. Tech Plaza, Bangkok"
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

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Google Maps URL</label>
                        <input
                          value={settings.event_map_url}
                          onChange={(e) => setSettings({ ...settings, event_map_url: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="https://maps.app.goo.gl/..."
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Event Date & Time</label>
                        <input
                          type="datetime-local"
                          value={settings.event_date}
                          onChange={(e) => setSettings({ ...settings, event_date: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
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

                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Travel Instructions</label>
                        <textarea
                          value={settings.event_travel}
                          onChange={(e) => setSettings({ ...settings, event_travel: e.target.value })}
                          rows={5}
                          className="w-full min-h-[7.5rem] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-y"
                          placeholder="How to get there?"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
                    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start justify-between gap-3 sm:block">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Activity className="w-5 h-5 text-blue-600" />
                          Registration Rules
                        </h3>
                        <div className="sm:hidden">
                          <HelpPopover label="Open note for Registration Rules">
                            Registration availability depends on the event time zone, the open and close range, and the event date itself.
                          </HelpPopover>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedEvent && (
                          <StatusBadge tone={selectedEvent.effective_status === "active" ? "emerald" : selectedEvent.effective_status === "pending" ? "amber" : selectedEvent.effective_status === "cancelled" ? "rose" : "neutral"}>
                            {getEventStatusLabel(selectedEvent.effective_status)}
                          </StatusBadge>
                        )}
                        <StatusBadge tone={getRegistrationWindowTone(timingInfo.registrationStatus)}>
                          {timingInfo.registrationLabel}
                        </StatusBadge>
                        <div className="hidden sm:block">
                          <HelpPopover label="Open note for Registration Rules">
                            Registration availability depends on the event time zone, the open and close range, and the event date itself.
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
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Current Time</p>
                        <p className="mt-1 text-xs text-slate-700">{timingInfo.nowLabel}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{timingInfo.timeZone}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Event Date</p>
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
                    {timingInfo.registrationStatus === "invalid" && (
                      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-700">
                        Close Date is earlier than Open Date. Fix the range first; otherwise registration will stay unavailable.
                      </div>
                    )}
                    {settingsMessage && (
                      <p className={`mt-3 text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                        {settingsMessage}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <CalendarRange className="w-5 h-5 text-blue-600" />
                          Event Workspace
                        </h3>
                        <p className="text-sm text-slate-500">Create, switch, and manage the lifecycle of event workspaces.</p>
                      </div>
                      <button
                        onClick={() => void Promise.all([fetchEvents(), fetchChannels()])}
                        disabled={eventLoading}
                        className="p-2 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                        title="Refresh events"
                      >
                        <RefreshCw className={`w-4 h-4 text-slate-500 ${eventLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>

                    <div className="relative">
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

                    <div className="space-y-2">
                      {filteredWorkingEvents.map((event) => (
                        <button
                          key={event.id}
                          id={getSearchTargetDomId("event", event.id)}
                          onClick={() => setSelectedEventId(event.id)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                            selectedEventId === event.id
                              ? "border-blue-200 bg-blue-50"
                              : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                          } ${isSearchFocused("event", event.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">{event.name}</p>
                              <p className="text-[10px] text-slate-500 font-mono">{event.slug}</p>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {event.is_default && (
                                <StatusBadge tone="neutral">
                                  default
                                </StatusBadge>
                              )}
                              <StatusBadge tone={event.effective_status === "active" ? "emerald" : event.effective_status === "pending" ? "amber" : event.effective_status === "cancelled" ? "rose" : "neutral"}>
                                {getEventStatusLabel(event.effective_status)}
                              </StatusBadge>
                            </div>
                          </div>
                        </button>
                      ))}
                      {filteredWorkingEvents.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                          {deferredEventListQuery ? "No active or pending events match this search." : "No active or pending events yet."}
                        </div>
                      )}
                    </div>

                    {filteredClosedEvents.length > 0 && (
                      <div className="border-t border-slate-100 pt-5 space-y-2">
                        <p className="text-sm font-semibold text-slate-700">Closed Events</p>
                        {filteredClosedEvents.map((event) => (
                          <button
                            key={event.id}
                            id={getSearchTargetDomId("event", event.id)}
                            onClick={() => setSelectedEventId(event.id)}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                              selectedEventId === event.id
                                ? "border-slate-300 bg-slate-100"
                                : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                            } ${isSearchFocused("event", event.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-700">{event.name}</p>
                                <p className="text-[10px] text-slate-500 font-mono">{event.slug}</p>
                              </div>
                              <StatusBadge tone="neutral">
                                {getEventStatusLabel(event.effective_status)}
                              </StatusBadge>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {filteredCancelledEvents.length > 0 && (
                      <div className="border-t border-slate-100 pt-5 space-y-2">
                        <p className="text-sm font-semibold text-slate-700">Cancelled Events</p>
                        {filteredCancelledEvents.map((event) => (
                          <button
                            key={event.id}
                            id={getSearchTargetDomId("event", event.id)}
                            onClick={() => setSelectedEventId(event.id)}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                              selectedEventId === event.id
                                ? "border-rose-200 bg-rose-50"
                                : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                            } ${isSearchFocused("event", event.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-700">{event.name}</p>
                                <p className="text-[10px] text-slate-500 font-mono">{event.slug}</p>
                              </div>
                              <StatusBadge tone="rose">
                                {getEventStatusLabel(event.effective_status)}
                              </StatusBadge>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="border-t border-slate-100 pt-5 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">Selected Event Details</p>
                        {selectedEvent && (
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={selectedEvent.status === "active" ? "emerald" : selectedEvent.status === "pending" ? "amber" : selectedEvent.status === "cancelled" ? "rose" : "neutral"}>
                              manual {selectedEvent.status}
                            </StatusBadge>
                            <StatusBadge tone={selectedEvent.effective_status === "active" ? "emerald" : selectedEvent.effective_status === "pending" ? "amber" : selectedEvent.effective_status === "cancelled" ? "rose" : "neutral"}>
                              effective {selectedEvent.effective_status}
                            </StatusBadge>
                          </div>
                        )}
                      </div>
                      <input
                        value={editingEventName}
                        onChange={(e) => setEditingEventName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Event name"
                        disabled={!selectedEvent}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <ActionButton
                          onClick={() => void handleUpdateEvent()}
                          disabled={!selectedEvent || !editingEventName.trim() || editingEventName.trim() === selectedEvent?.name || eventLoading}
                          tone="blue"
                          active
                          className="min-w-0 flex-1 text-sm sm:flex-none"
                        >
                          Save Event Name
                        </ActionButton>
                        {!selectedEvent?.is_default && selectedEvent?.status !== "cancelled" && (
                          <InlineActionsMenu label="Actions" tone="neutral">
                            <MenuActionItem
                              onClick={() => void handleUpdateEvent("cancelled")}
                              disabled={!selectedEvent || eventLoading}
                              tone="rose"
                            >
                              <AlertCircle className="h-3.5 w-3.5" />
                              <span className="font-medium">Cancel Event</span>
                            </MenuActionItem>
                          </InlineActionsMenu>
                        )}
                      </div>
                      {selectedEvent?.effective_status === "closed" && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                          This event is closed automatically because its event date ({timingInfo.eventDateLabel}) is already in the past compared with current system time ({timingInfo.nowLabel}).
                        </div>
                      )}
                    </div>

                    <div className="border-t border-slate-100 pt-5 space-y-3">
                      <p className="text-sm font-semibold">Create New Event</p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          value={newEventName}
                          onChange={(e) => setNewEventName(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="New event name"
                        />
                        <ActionButton
                          onClick={() => void handleCreateEvent()}
                          disabled={!newEventName.trim() || eventLoading}
                          tone="neutral"
                          active
                          className="w-full text-sm sm:w-auto"
                        >
                          Create Event
                        </ActionButton>
                      </div>
                    </div>

                    {eventMessage && (
                      <p className={`text-xs ${eventMessage.toLowerCase().includes("failed") || eventMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                        {eventMessage}
                      </p>
                    )}
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
              className="space-y-6"
            >
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
                    <div className="mb-4 space-y-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <h2 className="text-lg font-semibold">Event Context</h2>
                          <p className="text-sm text-slate-500">Per-event FAQ, source text, and response guidance for the selected workspace.</p>
                        </div>
                        <div className="flex w-full items-stretch gap-2 sm:w-auto lg:justify-end">
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
                        </div>
                      </div>
                    </div>
                    <textarea
                      value={settings.context}
                      onChange={(e) => setSettings({ ...settings, context: e.target.value })}
                      className="w-full h-80 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-sm resize-none"
                      placeholder="Event-specific FAQ, speaker details, agenda, venue notes, policies, etc."
                    />
                    {settingsMessage && (
                      <p className={`mt-3 text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                        {settingsMessage}
                      </p>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">Knowledge Documents</h3>
                        <p className="text-sm text-slate-500">Attach reusable notes, FAQ fragments, policy text, URLs, or import text-based files into the selected event.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
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
                      </div>
                    </div>

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
                          value={documentContent}
                          onChange={(e) => setDocumentContent(e.target.value)}
                          className="w-full h-56 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm resize-none"
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
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold">Attached Documents</h3>
                          <StatusBadge tone="neutral">{filteredDocuments.length}</StatusBadge>
                        </div>
                        <p className="text-sm text-slate-500">Only active documents are used during retrieval.</p>
                      </div>
                      <button
                        onClick={() => void fetchDocuments(selectedEventId)}
                        disabled={documentsLoading || !selectedEventId}
                        className="p-2 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                        title="Refresh documents"
                      >
                        <RefreshCw className={`w-4 h-4 text-slate-500 ${documentsLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>

                    <div className="mb-4 relative">
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
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                          {deferredDocumentListQuery ? "No documents match this search." : "No documents attached to this event yet."}
                        </div>
                      )}
                      {filteredDocuments.map((document) => (
                        <div
                          key={document.id}
                          id={getSearchTargetDomId("document", document.id)}
                          className={`rounded-2xl border p-4 space-y-3 ${
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
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <StatusBadge tone="neutral">{document.source_type}</StatusBadge>
                                <StatusBadge tone="blue">
                                  {document.chunk_count || 0} chunks
                                </StatusBadge>
                                <StatusBadge tone={document.is_active ? "emerald" : "neutral"}>
                                  {document.is_active ? "active" : "inactive"}
                                </StatusBadge>
                                <StatusBadge tone={getDocumentEmbeddingTone(document.embedding_status)}>
                                  embedding {document.embedding_status || "pending"}
                                </StatusBadge>
                                {selectedDocumentForChunksId === document.id && <StatusBadge tone="blue">selected</StatusBadge>}
                              </div>
                            </div>
                          </div>
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
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600 shadow-sm">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">Chunk Inspector</h3>
                        <p className="text-xs text-slate-500">
                          Preview the exact chunks available for retrieval from the selected document.
                        </p>
                      </div>
                      {selectedDocumentForChunks && (
                        <button
                          onClick={() => void fetchDocumentChunks(selectedDocumentForChunks.id, selectedEventId)}
                          disabled={documentChunksLoading}
                          className="p-2 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                          title="Refresh chunks"
                        >
                          <RefreshCw className={`w-4 h-4 text-slate-500 ${documentChunksLoading ? "animate-spin" : ""}`} />
                        </button>
                      )}
                    </div>

                    {!selectedDocumentForChunks ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-500 mb-4">
                        Select a document to inspect its chunks.
                      </div>
                    ) : (
                      <div className="space-y-3 mb-4">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="font-semibold text-slate-900">{selectedDocumentForChunks.title}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <StatusBadge tone="neutral">{selectedDocumentForChunks.source_type}</StatusBadge>
                            <StatusBadge tone="blue">{selectedDocumentForChunks.chunk_count || 0} chunks</StatusBadge>
                            <StatusBadge tone={selectedDocumentForChunks.is_active ? "emerald" : "neutral"}>
                              {selectedDocumentForChunks.is_active ? "active" : "inactive"}
                            </StatusBadge>
                            <StatusBadge tone={getDocumentEmbeddingTone(selectedDocumentForChunks.embedding_status)}>
                              embedding {selectedDocumentForChunks.embedding_status || "pending"}
                            </StatusBadge>
                          </div>
                        </div>

                        <div className="space-y-2 max-h-[24rem] overflow-y-auto pr-1">
                          {documentChunksLoading && (
                            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
                              Loading chunks...
                            </div>
                          )}
                          {!documentChunksLoading && documentChunks.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-500">
                              No chunks generated for this document yet.
                            </div>
                          )}
                          {!documentChunksLoading && documentChunks.map((chunk) => (
                            <div key={chunk.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                                Chunk {chunk.chunk_index + 1}
                              </p>
                              <p className="text-sm text-slate-700 whitespace-pre-wrap">{chunk.content}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600 shadow-sm">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">Embedding Preview</h3>
                        <p className="text-xs text-slate-500">
                          Vector-ready metadata and hook payload for the selected document.
                        </p>
                      </div>
                      {selectedDocumentForChunks && (
                        <div className="flex items-center gap-2">
                          <ActionButton
                            onClick={() => void handleEnqueueEmbedding(selectedDocumentForChunks.id, selectedEventId)}
                            disabled={embeddingPreviewLoading || embeddingEnqueueLoading}
                            tone="neutral"
                            active
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
                            className="p-2 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                            title="Refresh embedding preview"
                          >
                            <RefreshCw className={`w-4 h-4 text-slate-500 ${embeddingPreviewLoading ? "animate-spin" : ""}`} />
                          </button>
                        </div>
                      )}
                    </div>

                    {!selectedDocumentForChunks ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-500">
                        Select a document to inspect its vector-ready metadata.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Document Embedding State</p>
                            <div className="space-y-2 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Embedding model</span>
                                <StatusBadge tone="neutral">
                                  {embeddingPreview?.embedding_model || "text-embedding-3-small"}
                                </StatusBadge>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Document status</span>
                                <StatusBadge tone={getDocumentEmbeddingTone(embeddingPreview?.document.embedding_status || selectedDocumentForChunks.embedding_status)}>
                                  {embeddingPreview?.document.embedding_status || selectedDocumentForChunks.embedding_status || "pending"}
                                </StatusBadge>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Document content hash</span>
                                <span className="text-xs font-mono text-slate-500 truncate max-w-[14rem] text-right">
                                  {embeddingPreview?.document.content_hash || selectedDocumentForChunks.content_hash || "-"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Chunk count</span>
                                <StatusBadge tone="neutral">
                                  {embeddingPreview?.chunks.length ?? selectedDocumentForChunks.chunk_count ?? 0}
                                </StatusBadge>
                              </div>
                            </div>
                            {embeddingPreviewMessage && (
                              <p className={`mt-3 text-xs ${embeddingPreviewMessage.toLowerCase().includes("failed") || embeddingPreviewMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-slate-500"}`}>
                                {embeddingPreviewMessage}
                              </p>
                            )}
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Chunk Metadata</p>
                            <div className="space-y-2 max-h-[14rem] overflow-y-auto pr-1">
                              {embeddingPreviewLoading && (
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                                  Loading embedding preview...
                                </div>
                              )}
                              {!embeddingPreviewLoading && !embeddingPreview?.chunks.length && (
                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                                  No chunks available for embedding yet.
                                </div>
                              )}
                              {!embeddingPreviewLoading && embeddingPreview?.chunks.map((chunk) => (
                                <div key={chunk.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                  <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] uppercase tracking-wider">
                                    <StatusBadge tone="neutral" className="border-slate-900 bg-slate-900 text-white">chunk {chunk.chunk_index + 1}</StatusBadge>
                                    <StatusBadge tone="neutral">{chunk.char_count || chunk.content.length} chars</StatusBadge>
                                    <StatusBadge tone="neutral">~{chunk.token_estimate || 0} tokens</StatusBadge>
                                    <StatusBadge tone={getDocumentEmbeddingTone(chunk.embedding_status)}>
                                      {chunk.embedding_status || "pending"}
                                    </StatusBadge>
                                  </div>
                                  <p className="text-xs font-mono text-slate-500 break-all">{chunk.content_hash || "-"}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Embedding Hook Payload</p>
                          <div className="max-h-[22rem] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <pre className="whitespace-pre-wrap text-xs text-slate-700 font-mono">
                              {embeddingPreview ? JSON.stringify(embeddingPreview.payload, null, 2) : "Select a document to preview the embedding payload."}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600 shadow-sm">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h3 className="font-semibold text-slate-900">Retrieval Debug</h3>
                        <p className="text-xs text-slate-500">
                          Inspect which event chunks this workspace would send into the prompt for a specific question.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr,0.9fr] gap-4">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                            Test Query
                          </label>
                          <textarea
                            value={retrievalQuery}
                            onChange={(e) => setRetrievalQuery(e.target.value)}
                            rows={3}
                            placeholder="Example: งานนี้จัดที่ไหน เดินทางยังไง และเปิดลงทะเบียนถึงวันไหน"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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

                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                            Prompt Layers
                          </p>
                          <div className="space-y-2 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-600">Global system prompt</span>
                              <StatusBadge tone={retrievalDebug?.layers.global_system_prompt_present ? "emerald" : "neutral"}>
                                {retrievalDebug?.layers.global_system_prompt_present ? `${retrievalDebug.layers.global_system_prompt_chars} chars` : "empty"}
                              </StatusBadge>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-600">Event context</span>
                              <StatusBadge tone={retrievalDebug?.layers.event_context_present ? "blue" : "neutral"}>
                                {retrievalDebug?.layers.event_context_present ? `${retrievalDebug.layers.event_context_chars} chars` : "empty"}
                              </StatusBadge>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-600">Active documents</span>
                              <StatusBadge tone="neutral">
                                {retrievalDebug?.layers.active_document_count ?? documents.filter((document) => document.is_active).length}
                              </StatusBadge>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-600">Active chunks</span>
                              <StatusBadge tone="neutral">
                                {retrievalDebug?.layers.active_chunk_count ?? documentChunks.length}
                              </StatusBadge>
                            </div>
                          </div>
                        </div>
                      </div>

                      {retrievalDebug && (
                        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr,0.9fr] gap-4">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Matched Chunks</p>
                                <p className="text-xs text-slate-500">Top ranked event chunks for this query.</p>
                              </div>
                              <StatusBadge tone="blue">
                                {retrievalDebug.matches.length} matches
                              </StatusBadge>
                            </div>

                            <div className="space-y-3 max-h-[26rem] overflow-y-auto pr-1">
                              {retrievalDebug.matches.length === 0 && (
                                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
                                  No ranked chunks for this query. The bot will answer from global rules and event context only.
                                </div>
                              )}
                              {retrievalDebug.matches.map((match) => (
                                <div key={`${match.document_id}:${match.chunk_index}:${match.rank}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                  <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px] uppercase tracking-wider">
                                    <StatusBadge tone="neutral" className="border-slate-900 bg-slate-900 text-white">#{match.rank}</StatusBadge>
                                    <StatusBadge tone="blue">score {match.score}</StatusBadge>
                                    <StatusBadge tone="neutral">{match.source_type}</StatusBadge>
                                    <StatusBadge tone="neutral">chunk {match.chunk_index + 1}</StatusBadge>
                                  </div>
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
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                              Injected Knowledge Context
                            </p>
                            <div className="max-h-[26rem] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
                              <pre className="whitespace-pre-wrap text-xs text-slate-700 font-mono">
                                {retrievalDebug.composed_knowledge_context || "No knowledge context was composed for this query."}
                              </pre>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Activity className="w-5 h-5 text-blue-600" />
                          LLM Usage
                        </h3>
                        <p className="text-sm text-slate-500">Track token burn and estimated spend per event before turning this into credits.</p>
                      </div>
                      <button
                        onClick={() => void fetchLlmUsageSummary(selectedEventId)}
                        disabled={llmUsageLoading}
                        className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                        title="Refresh LLM usage"
                      >
                        <RefreshCw className={`h-4 w-4 ${llmUsageLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>

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

                    <div className="mt-4 grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Top Models In Event</p>
                          <StatusBadge tone="neutral">{llmUsageSummary?.selected_event_models.length || 0}</StatusBadge>
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
                          <StatusBadge tone="neutral">{llmUsageSummary?.overall_models.length || 0}</StatusBadge>
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
              className="flex min-h-[calc(100dvh-12rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:min-h-[calc(100dvh-11rem)] lg:min-h-[calc(100dvh-17rem)] lg:max-h-[calc(100dvh-17rem)]"
            >
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-3 sm:p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100">
                    <Bot className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Bot Simulator</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Active</span>
                      <StatusBadge tone="neutral">{testMessages.length} msgs</StatusBadge>
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

              <div className="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-2 sm:p-6">
                {testMessages.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center space-y-4 text-center opacity-40">
                    <MessageSquare className="h-10 w-10" />
                    <p className="text-sm max-w-xs">Start a conversation to test your bot's custom context.</p>
                  </div>
                )}
                {testMessages.map((msg, i) => {
                  const text = msg.parts.find(p => p.text)?.text;
                  const funcCall = msg.parts.find(p => p.functionCall)?.functionCall;
                  const funcResp = msg.parts.find(p => p.functionResponse)?.functionResponse;

                  if (funcCall) return null; // Don't show raw function calls
                  if (funcResp) {
                    const data = funcResp.response.content;
                    const reg = registrations.find(r => r.id === data.id);
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
                          eventLocation={settings.event_location}
                          eventDate={settings.event_date}
                          eventMapUrl={settings.event_map_url}
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

              <div className="border-t border-slate-100 p-3 sm:p-4 lg:px-6 lg:pb-9 lg:pt-4">
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

          {activeTab === "registrations" && (
            <motion.div
              key="registrations"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <h2 className="text-lg font-semibold">Registered Attendees</h2>
                          <StatusBadge tone="neutral">{filteredRegistrations.length}</StatusBadge>
                        </div>
                        <p className="text-sm text-slate-500">
                          Search fast, then progressively load more rows when this event gets large.
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
                    <div className="border-b border-slate-100 px-4 py-3 sm:px-6">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          value={registrationListQuery}
                          onChange={(e) => setRegistrationListQuery(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
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
                    <div className="max-h-[34rem] space-y-3 overflow-y-auto p-4 md:hidden">
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
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                              selectedRegistrationId === reg.id
                                ? "border-blue-200 bg-blue-50"
                                : "border-slate-200 bg-white hover:bg-slate-50"
                            } ${isSearchFocused("registration", reg.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-slate-900">{reg.first_name} {reg.last_name}</p>
                                <p className="mt-1 font-mono text-xs font-bold text-blue-600">{reg.id}</p>
                                <p className="mt-1 truncate text-[11px] text-slate-500">
                                  {reg.phone || reg.email || "No contact info"}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                <StatusBadge tone={getRegistrationStatusTone(reg.status)}>{reg.status}</StatusBadge>
                                {selectedRegistrationId === reg.id && <StatusBadge tone="blue">selected</StatusBadge>}
                              </div>
                            </div>
                            <p className="mt-2 text-[11px] text-slate-500">{new Date(reg.timestamp).toLocaleString()}</p>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="hidden max-h-[46rem] overflow-auto md:block">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                          <tr>
                            <th className="px-6 py-3">ID</th>
                            <th className="px-6 py-3">Name</th>
                            <th className="px-6 py-3">Contact</th>
                            <th className="px-6 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredRegistrations.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
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
                                <td className="px-6 py-4 font-mono text-xs font-bold text-blue-600">
                                  {reg.id}
                                </td>
                                <td className="px-6 py-4">
                                  <p className="font-medium">{reg.first_name} {reg.last_name}</p>
                                  <p className="text-[10px] text-slate-400">{new Date(reg.timestamp).toLocaleString()}</p>
                                </td>
                                <td className="px-6 py-4">
                                  <p className="text-xs">{reg.phone}</p>
                                  <p className="text-[10px] text-slate-400">{reg.email}</p>
                                </td>
                                <td className="px-6 py-4">
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
                    <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
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

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold flex items-center gap-2">
                          <Activity className="w-4 h-4 text-blue-600" />
                          Event Stats
                        </h3>
                        <p className="hidden text-xs text-slate-500 sm:block">Glanceable live totals for this event.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Total</p>
                        <p className="mt-1 text-base font-bold text-slate-900">{registrations.length}</p>
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">Registered</p>
                        <p className="mt-1 text-base font-bold text-blue-700">{registeredCount}</p>
                      </div>
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-600">Checked In</p>
                        <p className="mt-1 text-base font-bold text-emerald-700">{checkedInCount}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Cancelled</p>
                        <p className="mt-1 text-base font-bold text-slate-700">{cancelledCount}</p>
                      </div>
                      <div className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600">Check-in Rate</p>
                        <p className="mt-1 text-base font-bold text-violet-700">{checkInRate}%</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-lg font-semibold">Selected Ticket</h3>
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
                      <div className="space-y-4">
                        <div className="max-h-[30rem] overflow-auto rounded-2xl bg-slate-50 p-2">
                          <Ticket
                            registrationId={selectedRegistration.id}
                            firstName={selectedRegistration.first_name}
                            lastName={selectedRegistration.last_name}
                            phone={selectedRegistration.phone}
                            email={selectedRegistration.email}
                            timestamp={selectedRegistration.timestamp}
                            eventName={settings.event_name}
                            eventLocation={settings.event_location}
                            eventDate={settings.event_date}
                            eventMapUrl={settings.event_map_url}
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
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
                        <div className="border-t border-slate-100 pt-4">
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
              className="space-y-6"
            >
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
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
                      <StatusBadge tone="neutral">
                        Door Flow
                      </StatusBadge>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-lg font-bold text-blue-700">{registeredCount}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Registered</p>
                          </div>
                          <span className="rounded-lg bg-slate-100 p-2 text-blue-600">
                            <UserPlus className="w-4 h-4" />
                          </span>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-lg font-bold text-slate-700">{cancelledCount}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cancelled</p>
                          </div>
                          <span className="rounded-lg bg-slate-100 p-2 text-slate-500">
                            <AlertCircle className="w-4 h-4" />
                          </span>
                        </div>
                      </div>
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-lg font-bold text-emerald-700">{checkedInCount}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Checked In</p>
                          </div>
                          <span className="rounded-lg bg-slate-100 p-2 text-emerald-600">
                            <CheckCircle2 className="w-4 h-4" />
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Users className="w-3.5 h-3.5 text-slate-500" />
                        <span className="font-medium">Check-in rate</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-900">{checkInRate}%</p>
                        <p className="text-[10px] text-slate-500">of active attendees</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
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

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
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

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <h3 className="text-lg font-semibold">Latest Result</h3>
                        <p className="text-xs text-slate-500">The most recently scanned or checked-in attendee.</p>
                      </div>
                      {latestCheckinRegistration && (
                        <StatusBadge tone={getRegistrationStatusTone(latestCheckinRegistration.status)}>
                          {latestCheckinRegistration.status}
                        </StatusBadge>
                      )}
                    </div>

                    {!latestCheckinRegistration ? (
                      <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                        No attendee checked in yet in this session.
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
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
                            onClick={() => setActiveTab("registrations")}
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
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
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
                        disabled={checkinSessionCreating || !selectedEventId || selectedEventChannelWritesLocked}
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
                              <div key={session.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
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
          {activeTab === "logs" && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 p-5 sm:p-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">Live Webhook Logs</h2>
                      <StatusBadge tone="neutral">{filteredMessages.length} items</StatusBadge>
                    </div>
                    <p className="text-sm text-slate-500">Inbound messages plus delivery traces from active channels.</p>
                  </div>
                  <button onClick={() => void fetchMessages(selectedEventId)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                    <RefreshCw className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
                <div className="border-b border-slate-100 px-4 py-3 sm:px-6">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={logListQuery}
                      onChange={(e) => setLogListQuery(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
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
                </div>
                <div className="space-y-3 p-4 md:hidden">
                  {filteredMessages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                      {deferredLogListQuery ? "No logs match this search." : "No messages received yet."}
                    </div>
                  ) : (
                    filteredMessages.map((msg) => {
                      const lineTrace = parseLineTraceMessage(msg.text);
                      return (
                        <div
                          key={msg.id}
                          id={getSearchTargetDomId("log", String(msg.id))}
                          className={`rounded-2xl border border-slate-200 bg-white p-4 space-y-3 ${
                            isSearchFocused("log", String(msg.id)) ? "ring-2 ring-blue-200 ring-offset-2" : ""
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">{lineTrace ? "Delivery Trace" : msg.type === "incoming" ? "Incoming Message" : "Outgoing Message"}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {lineTrace && <StatusBadge tone="emerald">line</StatusBadge>}
                              <StatusBadge tone={lineTrace ? "amber" : msg.type === "incoming" ? "emerald" : "blue"}>
                                {lineTrace ? "trace" : msg.type}
                              </StatusBadge>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Sender</p>
                              <p className="mt-1 break-all font-mono text-[11px] text-blue-600">{msg.sender_id}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Time</p>
                              <p className="mt-1 text-[11px] text-slate-700">{new Date(msg.timestamp).toLocaleString()}</p>
                            </div>
                          </div>
                          {lineTrace ? (
                            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Trace Status</p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">{formatTraceStatusLabel(lineTrace.status)}</p>
                              <p className="mt-2 text-sm break-words text-slate-700">{lineTrace.detail || "-"}</p>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Message</p>
                              <p className="mt-2 text-sm break-words text-slate-700">{msg.text}</p>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="hidden overflow-x-auto md:block">
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
                          return (
                            <tr
                              key={msg.id}
                              id={getSearchTargetDomId("log", String(msg.id))}
                              className={`transition-colors hover:bg-slate-50 ${
                                isSearchFocused("log", String(msg.id)) ? "bg-blue-50" : ""
                              }`}
                            >
                              <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                                {new Date(msg.timestamp).toLocaleString()}
                              </td>
                              <td className="px-6 py-4 font-mono text-xs text-blue-600">
                                {msg.sender_id}
                              </td>
                              <td className="px-6 py-4 max-w-md">
                                {lineTrace ? (
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <StatusBadge tone="emerald">LINE</StatusBadge>
                                      <StatusBadge tone="amber">Delivery Trace</StatusBadge>
                                      <span className="text-[11px] font-semibold text-slate-600">
                                        {formatTraceStatusLabel(lineTrace.status)}
                                      </span>
                                    </div>
                                    <p className="text-sm text-slate-700 break-words">
                                      {lineTrace.detail || "-"}
                                    </p>
                                  </div>
                                ) : (
                                  <span className="truncate block">{msg.text}</span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                <StatusBadge tone={lineTrace ? "amber" : msg.type === "incoming" ? "emerald" : "blue"}>
                                  {lineTrace ? "trace" : msg.type}
                                </StatusBadge>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
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
              className="space-y-8"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
                    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Bot className="w-5 h-5 text-blue-600" />
                          AI Settings
                        </h3>
                        <p className="text-sm text-slate-500">Global prompt and model policy for the organization, with optional event-level override.</p>
                        {llmModelsLoading && (
                          <div className="mt-2">
                            <StatusBadge tone="blue">syncing model list</StatusBadge>
                          </div>
                        )}
                      </div>
                      <ActionButton
                        onClick={() => void saveAiSettings()}
                        disabled={saving}
                        tone="blue"
                        active
                        className="w-full text-sm sm:w-auto"
                      >
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save AI Settings
                      </ActionButton>
                    </div>
                    <div className="space-y-5">
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="block text-xs font-bold text-slate-500 uppercase">Global System Prompt</label>
                          <HelpPopover label="Open note for Global System Prompt">
                            Organization-wide tone, safety rules, and escalation behavior belong here. Event-specific content should stay in Context.
                          </HelpPopover>
                        </div>
                        <textarea
                          value={settings.global_system_prompt}
                          onChange={(e) => setSettings({ ...settings, global_system_prompt: e.target.value })}
                          className="w-full h-40 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                          placeholder="Global operating rules for the bot across all events and channels."
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase">Global Default Model</label>
                            <HelpPopover label="Open note for Global Default Model">
                              Keep one stable default model here unless an event has a real reason to override it.
                            </HelpPopover>
                          </div>
                          <select
                            value={settings.global_llm_model}
                            onChange={(e) => setSettings({ ...settings, global_llm_model: e.target.value })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
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

                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase">Selected Event Model Override</label>
                            <HelpPopover label="Open note for Selected Event Model Override">
                              Set an event override only when this workspace truly needs different model behavior than the global default.
                            </HelpPopover>
                          </div>
                          <select
                            value={settings.llm_model}
                            onChange={(e) => setSettings({ ...settings, llm_model: e.target.value })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Use global default model</option>
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
                      </div>

                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="block text-xs font-bold text-slate-500 uppercase">Custom Model ID</label>
                          <HelpPopover label="Open note for Custom Model ID">
                            Leave this blank to inherit the global default. When filled, only the selected event uses this specific model ID.
                          </HelpPopover>
                        </div>
                        <input
                          value={settings.llm_model}
                          onChange={(e) => setSettings({ ...settings, llm_model: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Leave blank to use the global default. Or set a specific event model ID."
                        />
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

                </div>

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5 sm:p-6">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Link2 className="w-5 h-5 text-blue-600" />
                          Channels
                        </h3>
                        <StatusBadge tone="neutral">{filteredSelectedEventChannels.length}</StatusBadge>
                      </div>
                      <p className="text-sm text-slate-500">Compact channel list for the selected event. Open details only when needed.</p>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={channelListQuery}
                        onChange={(e) => setChannelListQuery(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Search channels by name, platform, ID, or status"
                      />
                      {channelListQuery && (
                        <button
                          onClick={() => setChannelListQuery("")}
                          className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                          aria-label="Clear channel search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {filteredSelectedEventChannels.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                          {deferredChannelListQuery ? "No channels match this search." : "No channels linked to this event yet."}
                        </div>
                      ) : (
                        filteredSelectedEventChannels.map((channel) => (
                          <div
                            key={channel.id}
                            id={getSearchTargetDomId("channel", channel.id)}
                            className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3 ${
                              isSearchFocused("channel", channel.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""
                            }`}
                          >
                            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                              <button
                                onClick={() => toggleChannelDetails(channel.id)}
                                className="min-w-0 text-left"
                                aria-expanded={channelDetailsOpenIds.includes(channel.id)}
                              >
                                <p className="text-sm font-semibold text-slate-900">{channel.display_name}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <StatusBadge tone="neutral">
                                    {channel.platform_label || channel.platform}
                                  </StatusBadge>
                                  <StatusBadge tone={getConnectionStatusTone(channel.connection_status)}>
                                    {channel.connection_status || "incomplete"}
                                  </StatusBadge>
                                  <StatusBadge tone={getTokenStatusTone(channel)}>
                                    {channel.platform === "web_chat"
                                      ? "no token needed"
                                      : channel.has_access_token
                                      ? "saved token"
                                      : channel.platform === "facebook"
                                      ? "env fallback"
                                      : "no token"}
                                  </StatusBadge>
                                  <StatusBadge tone={channel.is_active ? "emerald" : "neutral"}>
                                    {channel.is_active ? "active" : "inactive"}
                                  </StatusBadge>
                                  {selectedEventChannelWritesLocked && !channel.is_active && <StatusBadge tone="neutral">locked</StatusBadge>}
                                </div>
                                <p className="mt-2 text-xs font-mono text-slate-500">{channel.external_id}</p>
                              </button>
                              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap xl:justify-end">
                                <ActionButton
                                  onClick={() => loadChannelIntoForm(channel)}
                                  tone="blue"
                                  className="px-3 text-sm"
                                >
                                  <PencilLine className="h-3.5 w-3.5" />
                                  Edit
                                </ActionButton>
                                <InlineActionsMenu
                                  label="Actions"
                                  tone={channel.is_active ? "amber" : "neutral"}
                                >
                                  <MenuActionItem
                                    onClick={() => toggleChannelDetails(channel.id)}
                                    tone="neutral"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    <span className="font-medium">
                                      {channelDetailsOpenIds.includes(channel.id) ? "Hide Details" : "Show Details"}
                                    </span>
                                  </MenuActionItem>
                                  <MenuActionItem
                                    onClick={() => void handleToggleChannel(channel)}
                                    disabled={eventLoading || (selectedEventChannelWritesLocked && !channel.is_active)}
                                    tone={selectedEventChannelWritesLocked && !channel.is_active ? "neutral" : channel.is_active ? "amber" : "emerald"}
                                    className="mt-1"
                                  >
                                    <Power className="h-3.5 w-3.5" />
                                    <span className="font-medium">
                                      {selectedEventChannelWritesLocked && !channel.is_active
                                        ? "Locked by Event Status"
                                        : channel.is_active
                                        ? "Disable Channel"
                                        : "Enable Channel"}
                                    </span>
                                  </MenuActionItem>
                                </InlineActionsMenu>
                              </div>
                            </div>
                            {channel.missing_requirements && channel.missing_requirements.length > 0 && (
                              <p className="text-xs text-amber-700">
                                Missing: {channel.missing_requirements.join(", ")}
                              </p>
                            )}
                            {channelDetailsOpenIds.includes(channel.id) && (
                              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                                {channel.platform_description && (
                                  <p className="text-xs text-slate-500">{channel.platform_description}</p>
                                )}
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">External ID</p>
                                    <p className="mt-1 break-all text-[11px] text-slate-700">{channel.external_id}</p>
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Updated</p>
                                    <p className="mt-1 text-[11px] text-slate-700">{new Date(channel.updated_at).toLocaleString()}</p>
                                  </div>
                                </div>
                                {channel.config_summary && channel.config_summary.length > 0 && (
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {channel.config_summary.map((item) => (
                                      <div key={`${channel.id}:${item.key}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                                        <p className="mt-1 break-all text-[11px] text-slate-700">{item.value}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {channel.secret_config_fields_present && channel.secret_config_fields_present.length > 0 && (
                                  <p className="text-[11px] text-slate-500">
                                    Stored secret fields: {channel.secret_config_fields_present.join(", ")}
                                  </p>
                                )}
                                {channel.platform === "web_chat" && (
                                  <div className="rounded-xl border border-violet-100 bg-violet-50 p-3 space-y-2">
                                    <p className="text-xs font-semibold text-violet-800">Embed Snippet</p>
                                    <pre className="overflow-x-auto rounded-lg bg-white border border-violet-100 p-3 text-[11px] leading-relaxed text-slate-700">
                                      <code>{buildWebChatEmbedSnippet(appUrl, channel.external_id)}</code>
                                    </pre>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <ActionButton
                                        onClick={() => copyToClipboard(buildWebChatEmbedSnippet(appUrl, channel.external_id))}
                                        tone="violet"
                                      >
                                        Copy Embed Snippet
                                      </ActionButton>
                                      <ActionButton
                                        onClick={() => copyToClipboard(`${appUrl}/api/webchat/config/${encodeURIComponent(channel.external_id)}`)}
                                        tone="neutral"
                                      >
                                        Copy Config URL
                                      </ActionButton>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="border-t border-slate-100 pt-5 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">{editingChannelKey ? "Edit Channel" : "Link Channel to Selected Event"}</p>
                        {editingChannelKey && (
                          <ActionButton
                            onClick={resetChannelForm}
                            tone="neutral"
                          >
                            Cancel Edit
                          </ActionButton>
                        )}
                      </div>
                      <select
                        value={newChannelPlatform}
                        onChange={(e) => {
                          const platform = e.target.value as ChannelPlatform;
                          setNewChannelPlatform(platform);
                          setNewChannelConfig({});
                        }}
                        disabled={Boolean(editingChannelKey)}
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
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 space-y-2">
                          <p className="font-semibold text-slate-800">{selectedChannelPlatformDefinition.label}</p>
                          <p>{selectedChannelPlatformDefinition.description}</p>
                          <div className="space-y-1 text-xs text-slate-500">
                            {selectedChannelPlatformDefinition.notes.map((note) => (
                              <p key={`${selectedChannelPlatformDefinition.id}:${note}`}>{note}</p>
                            ))}
                          </div>
                        </div>
                      )}
                      <input
                        value={newPageName}
                        onChange={(e) => setNewPageName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Channel display name"
                      />
                      <input
                        value={newPageId}
                        onChange={(e) => setNewPageId(e.target.value)}
                        disabled={Boolean(editingChannelKey)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                        placeholder={selectedChannelPlatformDefinition?.external_id_placeholder || "Channel external ID"}
                      />
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
                      <ActionButton
                        onClick={() => void handleSaveChannel()}
                        disabled={!selectedEventId || !newPageId.trim() || eventLoading || selectedEventChannelWritesLocked || channelFormMissingRequirements.length > 0}
                        tone="blue"
                        active
                        className="w-full text-sm"
                      >
                        {editingChannelKey ? "Update Channel" : "Link Channel to Event"}
                      </ActionButton>
                      {channelFormMissingRequirements.length > 0 && (
                        <p className="text-xs text-amber-700">
                          Missing before save: {channelFormMissingRequirements.join(", ")}
                        </p>
                      )}
                      {selectedEvent && selectedEventChannelWritesLocked && (
                        <p className="text-xs text-amber-700">
                          Closed or cancelled events cannot link or re-enable channels. You can still disable an active channel if you want to stop replies entirely.
                        </p>
                      )}
                      <p className="text-xs text-slate-500">
                        Facebook, LINE OA, Instagram, WhatsApp, Telegram, and Web Chat are wired into live message handling right now.
                      </p>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm sm:p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <SettingsIcon className="w-5 h-5 text-blue-600" />
                      Webhook Configuration
                    </h3>
                    <div className="space-y-4">
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
                                {webhookConfigItems.map((item) => (
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
                        <p className="mt-3 text-xs text-slate-500">
                          Select one endpoint at a time to keep the card readable. Copy always uses the full URL.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-[0.18em] mb-2">Verify Token</label>
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
                  </div>

                  {(role === "owner" || role === "admin") && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold flex items-center gap-2">
                            <Shield className="w-5 h-5 text-blue-600" />
                            Team Access
                          </h3>
                          <p className="text-sm text-slate-500">Session-based admin access with roles stored in the database.</p>
                          <p className="mt-2 text-xs text-amber-700">
                            Delete removes the account permanently, revokes active sessions, and cannot be undone.
                          </p>
                        </div>
                        <button
                          onClick={fetchTeamUsers}
                          disabled={teamLoading}
                          className="p-2 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                          title="Refresh users"
                        >
                          <RefreshCw className={`w-4 h-4 text-slate-500 ${teamLoading ? "animate-spin" : ""}`} />
                        </button>
                      </div>

                      <div className="space-y-2">
                        {teamUsers.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                            No users loaded yet.
                          </div>
                        ) : (
                          teamUsers.map((user) => (
                            <div key={user.id} className="rounded-2xl border border-slate-200 p-3 bg-slate-50 space-y-2">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="text-sm font-semibold">{user.display_name}</p>
                                  <p className="text-xs text-slate-500">{user.username}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge tone={getUserAccessTone(user.is_active)}>
                                    {user.is_active ? "active" : "disabled"}
                                  </StatusBadge>
                                  <StatusBadge tone="blue">
                                    {user.role}
                                  </StatusBadge>
                                </div>
                              </div>

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
                                <p className="text-xs text-slate-400">Role change is restricted for this account.</p>
                              )}

                              {(canManageTargetAccess(user) || canDeleteTeamUser(user)) && (
                                <div className="flex flex-wrap justify-end gap-2">
                                  <ActionButton
                                    onClick={() => handleUserAccessToggle(user.id, !user.is_active)}
                                    disabled={teamLoading}
                                    tone={user.is_active ? "rose" : "emerald"}
                                  >
                                    {user.is_active ? "Remove Access" : "Restore Access"}
                                  </ActionButton>
                                  {canDeleteTeamUser(user) && (
                                    <ActionButton
                                      onClick={() => void handleDeleteUser(user)}
                                      disabled={teamLoading}
                                      tone="rose"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                      Delete Member
                                    </ActionButton>
                                  )}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                      {canManageUsers && (
                        <div className="border-t border-slate-100 pt-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <UserPlus className="w-4 h-4 text-blue-600" />
                            <p className="text-sm font-semibold">Add Team Member</p>
                          </div>
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
                      )}

                      {teamMessage && (
                        <p className={`text-xs ${teamMessage.toLowerCase().includes("failed") || teamMessage.toLowerCase().includes("error") || teamMessage.toLowerCase().includes("exists") ? "text-rose-600" : "text-emerald-600"}`}>
                          {teamMessage}
                        </p>
                      )}
                    </div>
                  )}

                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {canEditSettings && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 hidden lg:block">
          <div className="mx-auto flex max-w-7xl justify-start px-6">
            <div className="app-floating-status pointer-events-auto flex w-fit max-w-[min(30rem,calc(100vw-8.5rem))] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-[0_20px_50px_rgba(15,23,42,0.12)] backdrop-blur">
              <StatusBadge tone={selectedEvent?.effective_status === "active" ? "emerald" : selectedEvent?.effective_status === "pending" ? "amber" : selectedEvent?.effective_status === "cancelled" ? "rose" : "neutral"}>
                {selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : "No Event"}
              </StatusBadge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-900">
                  {selectedEvent?.name || "No selected event"}
                </p>
                <p className="truncate text-[10px] text-slate-500">
                  OpenRouter • {activeLlmModel}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Event Usage</p>
                <p className="mt-1 text-xs font-semibold text-slate-900">
                  {formatCompactNumber(selectedEventUsage?.total_tokens || 0)} tk
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Total Cost</p>
                <p className="mt-1 text-xs font-semibold text-slate-900">
                  {formatUsdCost(overallLlmUsage?.estimated_cost_usd || 0)}
                </p>
              </div>
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
                          <StatusBadge tone={event.effective_status === "active" ? "emerald" : event.effective_status === "pending" ? "amber" : event.effective_status === "cancelled" ? "rose" : "neutral"}>
                            {getEventStatusLabel(event.effective_status)}
                          </StatusBadge>
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

      {helpContent && (
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
        </>
      )}
    </div>
  );
}
