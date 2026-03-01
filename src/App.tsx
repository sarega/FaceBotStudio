import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
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
} from "lucide-react";
import { getChatResponse } from "./services/gemini";
import { ChatBubble } from "./components/ChatBubble";
import { Ticket } from "./components/Ticket";
import { AuthUser, ChannelAccountRecord, ChannelPlatform, ChannelPlatformDefinition, EmbeddingPreviewResponse, EventDocumentChunkRecord, EventDocumentRecord, EventRecord, EventStatus, Message, RetrievalDebugResponse, Settings, UserRole } from "./types";

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

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

const MANAGEABLE_ROLES: UserRole[] = ["owner", "admin", "operator", "checker", "viewer"];
const THEME_STORAGE_KEY = "facebotstudio-theme";

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

export default function App() {
  const [activeTab, setActiveTab] = useState<"event" | "design" | "test" | "logs" | "settings" | "registrations">("event");
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
  const [searchId, setSearchId] = useState("");
  const [checkinStatus, setCheckinStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [checkinErrorMessage, setCheckinErrorMessage] = useState("");
  const [statusUpdateLoading, setStatusUpdateLoading] = useState(false);
  const [statusUpdateMessage, setStatusUpdateMessage] = useState("");
  const [deleteRegistrationLoading, setDeleteRegistrationLoading] = useState(false);
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [llmModelsLoading, setLlmModelsLoading] = useState(false);
  const [llmModelsError, setLlmModelsError] = useState("");
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerStarting, setScannerStarting] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [lastScannedValue, setLastScannedValue] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const scannerCooldownRef = useRef(false);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedEventIdRef = useRef("");
  selectedEventIdRef.current = selectedEventId;

  const role = authUser?.role;
  const canEditSettings = role === "owner" || role === "admin";
  const canRunTest = role === "owner" || role === "admin" || role === "operator";
  const canViewLogs = role === "owner" || role === "admin" || role === "operator" || role === "viewer";
  const canManageRegistrations = role === "owner" || role === "admin" || role === "operator" || role === "checker";
  const canChangeRegistrationStatus = role === "owner" || role === "admin" || role === "operator";
  const canManageKnowledge = role === "owner" || role === "admin" || role === "operator";
  const canManageUsers = role === "owner" || role === "admin";
  const canChangeRoles = role === "owner" || role === "admin";
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

  const selectedRegistration = registrations.find((reg) => reg.id === selectedRegistrationId) || null;
  const selectedDocumentForChunks = documents.find((document) => document.id === selectedDocumentForChunksId) || null;
  const registeredCount = registrations.filter((reg) => reg.status === "registered").length;
  const cancelledCount = registrations.filter((reg) => reg.status === "cancelled").length;
  const checkedInCount = registrations.filter((reg) => reg.status === "checked-in").length;
  const canUseQrScanner =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    Boolean((window as any).BarcodeDetector);
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
  const selectorEvents = (() => {
    const base = workingEvents.length > 0 ? [...workingEvents] : [...events];
    if (selectedEvent && !base.some((event) => event.id === selectedEvent.id)) {
      base.unshift(selectedEvent);
    }
    return base;
  })();

  const apiFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init);
    if (res.status === 401) {
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
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;

    void loadAppData();
  }, [authStatus, role]);

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
      ]);
    }, 10000);

    return () => clearInterval(interval);
  }, [authStatus, selectedEventId, canRunTest, canViewLogs]);

  useEffect(() => {
    setEditingEventName(selectedEvent?.name || "");
  }, [selectedEvent?.id, selectedEvent?.name]);

  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      ...getBlankEventScopedSettings(),
    }));
    setMessages([]);
    setRegistrations([]);
    setSelectedRegistrationId("");
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
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "registrations") {
      stopQrScanner();
    }
  }, [activeTab]);

  useEffect(() => {
    const allowedTabs = [
      ...(canEditSettings ? ["event"] : []),
      ...(canEditSettings ? ["design"] : []),
      ...(canRunTest ? ["test"] : []),
      "registrations",
      ...(canViewLogs ? ["logs"] : []),
      ...(canEditSettings ? ["settings"] : []),
    ] as Array<"event" | "design" | "test" | "logs" | "settings" | "registrations">;

    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0] || "registrations");
    }
  }, [activeTab, canEditSettings, canRunTest, canViewLogs]);

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
      const res = await apiFetch("/api/registrations/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: normalizedId }),
      });
      if (res.ok) {
        setCheckinStatus("success");
        setSearchId(normalizedId);
        setSelectedRegistrationId(normalizedId);
        void fetchRegistrations(selectedEventId);
        setTimeout(() => {
          setCheckinStatus("idle");
          setCheckinErrorMessage("");
          if (options?.clearInputOnSuccess !== false) {
            setSearchId("");
          }
        }, 3000);
        return true;
      } else {
        const data = await res.json().catch(() => ({}));
        setCheckinStatus("error");
        setCheckinErrorMessage(data?.error || "Failed to check in attendee");
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

    const BarcodeDetectorCtor = (window as any).BarcodeDetector;
    if (!BarcodeDetectorCtor || !navigator.mediaDevices?.getUserMedia) {
      setScannerError("QR scanner is not supported in this browser. Use manual check-in instead.");
      return;
    }

    setScannerStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      cameraStreamRef.current = stream;
      if (!videoRef.current) {
        throw new Error("Video preview is not ready");
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      let detector: any;
      try {
        detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });
      } catch {
        detector = new BarcodeDetectorCtor();
      }

      scannerCooldownRef.current = false;
      scanIntervalRef.current = window.setInterval(async () => {
        if (!videoRef.current || scanBusyRef.current || scannerCooldownRef.current) return;
        if (videoRef.current.readyState < 2) return;

        scanBusyRef.current = true;
        try {
          const barcodes = await detector.detect(videoRef.current);
          const rawValue = String(barcodes?.[0]?.rawValue || "").trim();
          if (!rawValue) return;

          const registrationId = extractRegistrationId(rawValue);
          setLastScannedValue(rawValue);
          if (!registrationId) return;

          scannerCooldownRef.current = true;
          setSearchId(registrationId);
          const ok = await handleCheckinById(registrationId, { clearInputOnSuccess: false });
          if (ok) {
            stopQrScanner();
          } else {
            window.setTimeout(() => {
              scannerCooldownRef.current = false;
            }, 1500);
          }
        } catch (err) {
          console.error("QR detection error", err);
        } finally {
          scanBusyRef.current = false;
        }
      }, 450);

      setScannerActive(true);
    } catch (err) {
      console.error("Failed to start QR scanner", err);
      setScannerError(err instanceof Error ? err.message : "Failed to start camera");
      stopQrScanner();
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Bot className="text-white w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-xl tracking-tight">FB Bot Studio</h1>
              {selectedEvent && (
                <p className="text-[11px] text-slate-500 hidden md:block truncate max-w-[16rem] lg:max-w-[22rem] xl:max-w-[28rem]">
                  {getEventStatusLabel(selectedEvent.effective_status)} event:{" "}
                  <span className="font-semibold text-slate-700">{selectedEvent.name}</span>
                </p>
              )}
            </div>
            <div className="hidden lg:flex items-center gap-2 ml-3 min-w-0">
              <CalendarRange className="w-4 h-4 text-slate-400" />
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                disabled={!selectorEvents.length || eventLoading}
                className="min-w-[15rem] max-w-[22rem] bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              >
                {selectorEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name} ({getEventStatusLabel(event.effective_status)})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
            {[
              ...(canEditSettings ? [{ id: "event", icon: CalendarRange, label: "Event" }] : []),
              ...(canEditSettings ? [{ id: "design", icon: Code, label: "Context" }] : []),
              ...(canRunTest ? [{ id: "test", icon: MessageSquare, label: "Test" }] : []),
              { id: "registrations", icon: Users, label: "Registrations" },
              ...(canViewLogs ? [{ id: "logs", icon: Activity, label: "Logs" }] : []),
              ...(canEditSettings ? [{ id: "settings", icon: SettingsIcon, label: "Setup" }] : []),
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as "event" | "design" | "test" | "registrations" | "logs" | "settings")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id 
                    ? "bg-white text-blue-600 shadow-sm" 
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
                <MonitorCog className="w-4 h-4 text-slate-500" />
                <select
                  value={themeMode}
                  onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
                  className="bg-transparent text-xs font-semibold text-slate-600 outline-none"
                  aria-label="Theme mode"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System</option>
                </select>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold leading-none">{authUser?.display_name || authUser?.username}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">{authUser?.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
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
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Bot className="w-5 h-5 text-blue-600" />
                          Event Information
                        </h3>
                        <p className="text-sm text-slate-500">Core event details for the selected workspace.</p>
                      </div>
                      <button
                        onClick={() => void saveEventDetails()}
                        disabled={saving}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                      >
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Event Setup
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                          className="w-full h-24 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                          placeholder="What is this event about?"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Travel Instructions</label>
                        <textarea
                          value={settings.event_travel}
                          onChange={(e) => setSettings({ ...settings, event_travel: e.target.value })}
                          className="w-full h-20 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                          placeholder="How to get there?"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-3 mb-6">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Activity className="w-5 h-5 text-blue-600" />
                        Registration Rules
                      </h3>
                      <div className="flex items-center gap-2">
                        {selectedEvent && (
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getEventStatusBadgeClass(selectedEvent.effective_status)}`}>
                            {getEventStatusLabel(selectedEvent.effective_status)}
                          </span>
                        )}
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          timingInfo.registrationStatus === "open"
                            ? "bg-emerald-100 text-emerald-700"
                            : timingInfo.registrationStatus === "not_started"
                            ? "bg-amber-100 text-amber-700"
                            : timingInfo.registrationStatus === "invalid"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-rose-100 text-rose-700"
                        }`}>
                          {timingInfo.registrationLabel}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                    <p className="mt-4 text-xs text-slate-500">
                      Registration rules are event-scoped. The system derives the effective event state from both the manual status and the event date.
                    </p>
                    <div className="mt-3 rounded-2xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-600 space-y-1">
                      <p><span className="font-semibold text-slate-800">Current system time</span>: {timingInfo.nowLabel} ({timingInfo.timeZone})</p>
                      <p><span className="font-semibold text-slate-800">Event date interpreted as</span>: {timingInfo.eventDateLabel}</p>
                      <p><span className="font-semibold text-slate-800">Registration opens</span>: {timingInfo.startLabel}</p>
                      <p><span className="font-semibold text-slate-800">Registration closes</span>: {timingInfo.endLabel}</p>
                      {timingInfo.registrationStatus === "invalid" && (
                        <p className="text-orange-700">
                          Close Date is earlier than Open Date. Fix the range first; otherwise registration will stay unavailable.
                        </p>
                      )}
                    </div>
                    {settingsMessage && (
                      <p className={`mt-3 text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                        {settingsMessage}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
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

                    <div className="space-y-2">
                      {workingEvents.map((event) => (
                        <button
                          key={event.id}
                          onClick={() => setSelectedEventId(event.id)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                            selectedEventId === event.id
                              ? "border-blue-200 bg-blue-50"
                              : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold">{event.name}</p>
                              <p className="text-[10px] text-slate-500 font-mono">{event.slug}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {event.is_default && (
                                <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700">
                                  default
                                </span>
                              )}
                              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getEventStatusBadgeClass(event.effective_status)}`}>
                                {getEventStatusLabel(event.effective_status)}
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                      {workingEvents.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                          No active or pending events yet.
                        </div>
                      )}
                    </div>

                    {closedEvents.length > 0 && (
                      <div className="border-t border-slate-100 pt-5 space-y-2">
                        <p className="text-sm font-semibold text-slate-700">Closed Events</p>
                        {closedEvents.map((event) => (
                          <button
                            key={event.id}
                            onClick={() => setSelectedEventId(event.id)}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                              selectedEventId === event.id
                                ? "border-slate-300 bg-slate-100"
                                : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-700">{event.name}</p>
                                <p className="text-[10px] text-slate-500 font-mono">{event.slug}</p>
                              </div>
                              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getEventStatusBadgeClass(event.effective_status)}`}>
                                {getEventStatusLabel(event.effective_status)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {cancelledEvents.length > 0 && (
                      <div className="border-t border-slate-100 pt-5 space-y-2">
                        <p className="text-sm font-semibold text-slate-700">Cancelled Events</p>
                        {cancelledEvents.map((event) => (
                          <button
                            key={event.id}
                            onClick={() => setSelectedEventId(event.id)}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                              selectedEventId === event.id
                                ? "border-rose-200 bg-rose-50"
                                : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-700">{event.name}</p>
                                <p className="text-[10px] text-slate-500 font-mono">{event.slug}</p>
                              </div>
                              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getEventStatusBadgeClass(event.effective_status)}`}>
                                {getEventStatusLabel(event.effective_status)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="border-t border-slate-100 pt-5 space-y-3">
                      <p className="text-sm font-semibold">Selected Event Details</p>
                      <input
                        value={editingEventName}
                        onChange={(e) => setEditingEventName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Event name"
                        disabled={!selectedEvent}
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          onClick={() => void handleUpdateEvent()}
                          disabled={!selectedEvent || !editingEventName.trim() || editingEventName.trim() === selectedEvent?.name || eventLoading}
                          className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                        >
                          Save Event Name
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          onClick={() => void handleUpdateEvent("pending")}
                          disabled={!selectedEvent || selectedEvent.is_default || selectedEvent.status === "pending" || eventLoading}
                          className="rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                        >
                          Set Pending
                        </button>
                        <button
                          onClick={() => void handleUpdateEvent("active")}
                          disabled={!selectedEvent || selectedEvent.status === "active" || eventLoading}
                          className="rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                        >
                          Launch Event
                        </button>
                        <button
                          onClick={() => void handleUpdateEvent("cancelled")}
                          disabled={!selectedEvent || selectedEvent.is_default || selectedEvent.status === "cancelled" || eventLoading}
                          className="rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                        >
                          Cancel Event
                        </button>
                      </div>
                      {selectedEvent && (
                        <p className="text-xs text-slate-500">
                          Manual status: <code>{selectedEvent.status}</code>. Effective status now: <code>{selectedEvent.effective_status}</code>.
                          {selectedEvent.effective_status === "closed" ? ` This event is automatically closed because its event date (${timingInfo.eventDateLabel}) is already in the past compared with current system time (${timingInfo.nowLabel}).` : ""}
                        </p>
                      )}
                    </div>

                    <div className="border-t border-slate-100 pt-5 space-y-3">
                      <p className="text-sm font-semibold">Create New Event</p>
                      <input
                        value={newEventName}
                        onChange={(e) => setNewEventName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="New event name"
                      />
                      <button
                        onClick={() => void handleCreateEvent()}
                        disabled={!newEventName.trim() || eventLoading}
                        className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                      >
                        Create Event
                      </button>
                    </div>

                    {eventMessage && (
                      <p className={`text-xs ${eventMessage.toLowerCase().includes("failed") || eventMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                        {eventMessage}
                      </p>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="text-lg font-semibold mb-3">Event Status Logic</h3>
                    <div className="space-y-3 text-sm text-slate-600">
                      <p><span className="font-semibold text-slate-800">Pending</span>: event is being prepared. Bot should say registration is not launched yet.</p>
                      <p><span className="font-semibold text-slate-800">Active</span>: event is live, but registration still follows open/close rules.</p>
                      <p><span className="font-semibold text-slate-800">Closed</span>: event date has already passed. System closes it automatically.</p>
                      <p><span className="font-semibold text-slate-800">Cancelled</span>: event is cancelled and bot should explain that clearly.</p>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
                    <h3 className="text-blue-800 font-semibold mb-2 flex items-center gap-2">
                      <Code className="w-5 h-5" />
                      Event Context Lives Separately
                    </h3>
                    <p className="text-sm text-blue-700 leading-relaxed">
                      Event information and registration rules live in this tab. Event-specific knowledge, FAQ, and attached documents belong in the <span className="font-semibold">Context</span> tab.
                    </p>
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
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="mb-4 space-y-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold">Event Context</h2>
                        <p className="text-sm text-slate-500">Per-event context, FAQ, and source text that guide responses for the selected event.</p>
                      </div>
                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <button
                          onClick={() => void handleResetEventKnowledge(false)}
                          disabled={knowledgeResetting || saving || !selectedEventId || !canManageKnowledge}
                          className="flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                        >
                          {knowledgeResetting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                          Clear Knowledge Docs
                        </button>
                        <button
                          onClick={() => void handleResetEventKnowledge(true)}
                          disabled={knowledgeResetting || saving || !selectedEventId || !canManageKnowledge}
                          className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-700 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                        >
                          {knowledgeResetting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                          Reset All Knowledge
                        </button>
                        <button
                          onClick={() => void saveEventContext()}
                          disabled={saving || !canManageKnowledge}
                          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                        >
                          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          Save Event Context
                        </button>
                      </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        Use <span className="font-semibold">Clear Knowledge Docs</span> to wipe attached documents, chunks, and embedding state while keeping the text in Event Context. Use <span className="font-semibold">Reset All Knowledge</span> only when you want a completely blank event knowledge layer.
                      </p>
                    </div>
                    <textarea
                      value={settings.context}
                      onChange={(e) => setSettings({ ...settings, context: e.target.value })}
                      className="w-full h-80 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-sm resize-none"
                      placeholder="Event-specific FAQ, speaker details, agenda, venue notes, policies, etc."
                    />
                    <div className="mt-4 rounded-2xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800">
                      <p className="font-semibold mb-1">How the bot uses this tab</p>
                      <p>
                        The selected event now has two knowledge layers: this free-form event context, plus structured documents below. Active documents are already used by the bot through simple retrieval. Vector search and embeddings can be added later without moving this content model again.
                      </p>
                    </div>
                    <div className="mt-3 rounded-2xl bg-rose-50 border border-rose-100 p-4 text-sm text-rose-700">
                      <p className="font-semibold mb-1">Need a clean reset?</p>
                      <p>
                        You can now clear only the structured knowledge documents, or reset the entire event knowledge layer including the free-form context.
                      </p>
                    </div>
                    {settingsMessage && (
                      <p className={`mt-3 text-xs ${settingsMessage.toLowerCase().includes("failed") || settingsMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                        {settingsMessage}
                      </p>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold">Knowledge Documents</h3>
                        <p className="text-sm text-slate-500">Attach reusable notes, FAQ fragments, policy text, URLs, or import text-based files into the selected event.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          ref={documentFileInputRef}
                          type="file"
                          accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.xml,text/plain,text/markdown,text/csv,application/json,application/xml,text/html"
                          className="hidden"
                          onChange={(e) => void handleImportDocumentFile(e.target.files?.[0] || null)}
                        />
                        <button
                          onClick={() => documentFileInputRef.current?.click()}
                          disabled={documentsLoading}
                          className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-sm font-medium disabled:opacity-50"
                        >
                          Import File
                        </button>
                        {editingDocumentId && (
                          <button
                            onClick={resetDocumentForm}
                            className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-sm font-medium"
                          >
                            Cancel Edit
                          </button>
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

                    <div className="mt-4 flex items-center gap-3">
                      <button
                        onClick={() => void handleSaveDocument()}
                        disabled={!selectedEventId || documentsLoading || !documentTitle.trim() || !documentContent.trim()}
                        className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                      >
                        {documentsLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {editingDocumentId ? "Update Document" : "Save Document"}
                      </button>
                      <p className="text-xs text-slate-500">
                        Text-based imports are chunked on the server after save, so this same document store can grow into full RAG later.
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
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold">Attached Documents</h3>
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

                    <div className="space-y-3">
                      {documents.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                          No documents attached to this event yet.
                        </div>
                      )}
                      {documents.map((document) => (
                        <div key={document.id} className="rounded-2xl border border-slate-200 p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 truncate">{document.title}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider">
                                <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-1">{document.source_type}</span>
                                <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-1">
                                  {document.chunk_count || 0} chunks
                                </span>
                                <span className={`rounded-full px-2 py-1 ${document.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                                  {document.is_active ? "active" : "inactive"}
                                </span>
                                <span className={`rounded-full px-2 py-1 ${
                                  document.embedding_status === "ready"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : document.embedding_status === "failed"
                                    ? "bg-rose-100 text-rose-700"
                                    : document.embedding_status === "skipped"
                                    ? "bg-slate-200 text-slate-600"
                                    : "bg-amber-100 text-amber-700"
                                }`}>
                                  embedding {document.embedding_status || "pending"}
                                </span>
                              </div>
                            </div>
                          </div>
                          {document.source_url && (
                            <a
                              href={document.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open source URL
                            </a>
                          )}
                          <p className="text-sm text-slate-600 whitespace-pre-wrap">
                            {document.content.length > 280 ? `${document.content.slice(0, 280)}...` : document.content}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => loadDocumentIntoForm(document)}
                              className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-xs font-semibold"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setSelectedDocumentForChunksId(document.id)}
                              className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                                selectedDocumentForChunksId === document.id
                                  ? "bg-blue-600 text-white"
                                  : "bg-blue-50 hover:bg-blue-100 text-blue-700"
                              }`}
                            >
                              View Chunks
                            </button>
                            <button
                              onClick={() => void handleDocumentStatusToggle(document.id, document.is_active)}
                              disabled={documentsLoading}
                              className={`rounded-xl px-3 py-2 text-xs font-semibold ${document.is_active ? "bg-amber-50 hover:bg-amber-100 text-amber-700" : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700"} disabled:opacity-50`}
                            >
                              {document.is_active ? "Disable" : "Enable"}
                            </button>
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
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider">
                            <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-1">{selectedDocumentForChunks.source_type}</span>
                            <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-1">{selectedDocumentForChunks.chunk_count || 0} chunks</span>
                            <span className={`rounded-full px-2 py-1 ${selectedDocumentForChunks.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                              {selectedDocumentForChunks.is_active ? "active" : "inactive"}
                            </span>
                            <span className={`rounded-full px-2 py-1 ${
                              selectedDocumentForChunks.embedding_status === "ready"
                                ? "bg-emerald-100 text-emerald-700"
                                : selectedDocumentForChunks.embedding_status === "failed"
                                ? "bg-rose-100 text-rose-700"
                                : selectedDocumentForChunks.embedding_status === "skipped"
                                ? "bg-slate-200 text-slate-600"
                                : "bg-amber-100 text-amber-700"
                            }`}>
                              embedding {selectedDocumentForChunks.embedding_status || "pending"}
                            </span>
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
                          <button
                            onClick={() => void handleEnqueueEmbedding(selectedDocumentForChunks.id, selectedEventId)}
                            disabled={embeddingPreviewLoading || embeddingEnqueueLoading}
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
                          >
                            {(embeddingPreviewLoading || embeddingEnqueueLoading) ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4" />
                            )}
                            Queue Embedding
                          </button>
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
                                <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold">
                                  {embeddingPreview?.embedding_model || "text-embedding-3-small"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Document status</span>
                                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                  embeddingPreview?.document.embedding_status === "ready"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : embeddingPreview?.document.embedding_status === "failed"
                                    ? "bg-rose-100 text-rose-700"
                                    : embeddingPreview?.document.embedding_status === "skipped"
                                    ? "bg-slate-200 text-slate-600"
                                    : "bg-amber-100 text-amber-700"
                                }`}>
                                  {embeddingPreview?.document.embedding_status || selectedDocumentForChunks.embedding_status || "pending"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Document content hash</span>
                                <span className="text-xs font-mono text-slate-500 truncate max-w-[14rem] text-right">
                                  {embeddingPreview?.document.content_hash || selectedDocumentForChunks.content_hash || "-"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-slate-600">Chunk count</span>
                                <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold">
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
                                    <span className="rounded-full bg-slate-900 text-white px-2 py-1">chunk {chunk.chunk_index + 1}</span>
                                    <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1">{chunk.char_count || chunk.content.length} chars</span>
                                    <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1">~{chunk.token_estimate || 0} tokens</span>
                                    <span className={`rounded-full px-2 py-1 ${
                                      chunk.embedding_status === "ready"
                                        ? "bg-emerald-100 text-emerald-700"
                                        : chunk.embedding_status === "failed"
                                        ? "bg-rose-100 text-rose-700"
                                        : chunk.embedding_status === "skipped"
                                        ? "bg-slate-200 text-slate-600"
                                        : "bg-amber-100 text-amber-700"
                                    }`}>
                                      {chunk.embedding_status || "pending"}
                                    </span>
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
                            <button
                              onClick={() => void fetchRetrievalDebug()}
                              disabled={!selectedEventId || retrievalLoading || !retrievalQuery.trim()}
                              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                            >
                              {retrievalLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                              Analyze Retrieval
                            </button>
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
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${retrievalDebug?.layers.global_system_prompt_present ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                                {retrievalDebug?.layers.global_system_prompt_present ? `${retrievalDebug.layers.global_system_prompt_chars} chars` : "empty"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-600">Event context</span>
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${retrievalDebug?.layers.event_context_present ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"}`}>
                                {retrievalDebug?.layers.event_context_present ? `${retrievalDebug.layers.event_context_chars} chars` : "empty"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-600">Active documents</span>
                              <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold">
                                {retrievalDebug?.layers.active_document_count ?? documents.filter((document) => document.is_active).length}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-600">Active chunks</span>
                              <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1 text-xs font-semibold">
                                {retrievalDebug?.layers.active_chunk_count ?? documentChunks.length}
                              </span>
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
                              <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-1 text-xs font-semibold">
                                {retrievalDebug.matches.length} matches
                              </span>
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
                                    <span className="rounded-full bg-slate-900 text-white px-2 py-1">#{match.rank}</span>
                                    <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-1">score {match.score}</span>
                                    <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1">{match.source_type}</span>
                                    <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-1">chunk {match.chunk_index + 1}</span>
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

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600 shadow-sm">
                    <h3 className="font-semibold text-slate-900 mb-2">Retrieval behavior right now</h3>
                    <div className="space-y-2">
                      <p><span className="font-semibold">Global</span>: system prompt lives in <span className="font-semibold">Setup</span> and applies to every event.</p>
                      <p><span className="font-semibold">Event</span>: context and documents stay attached to the selected event only.</p>
                      <p><span className="font-semibold">Current</span>: the bot ranks active document chunks against the incoming message and injects the best matches into the prompt.</p>
                      <p><span className="font-semibold">Current</span>: text-based file import already feeds the same chunk store after save.</p>
                      <p><span className="font-semibold">Later</span>: replace simple chunk matching with embeddings/vector search without changing the event workspace model.</p>
                    </div>
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
              className="h-[calc(100vh-200px)] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Bot className="text-blue-600 w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Bot Simulator</h3>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Active</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setTestMessages([])}
                  className="text-xs text-slate-400 hover:text-slate-600 font-medium"
                >
                  Clear Chat
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-2 bg-slate-50/30">
                {testMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                    <MessageSquare className="w-12 h-12" />
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

              <div className="p-4 border-t border-slate-100">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleTestSend()}
                    placeholder="Type a message..."
                    className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button
                    onClick={handleTestSend}
                    disabled={!inputText.trim() || isTyping}
                    className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl transition-all disabled:opacity-50"
                  >
                    <Send className="w-5 h-5" />
                  </button>
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
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-lg font-semibold">Registered Attendees</h2>
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-md uppercase tracking-wider border border-blue-100">
                            {settings.event_name || "Untitled Event"}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500">Manage, preview tickets, and export event registrations. Click a row to open the ticket panel.</p>
                      </div>
                      <a 
                        href={`/api/registrations/export?event_id=${encodeURIComponent(selectedEventId)}`}
                        className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                      >
                        <Download className="w-4 h-4" />
                        Export CSV
                      </a>
                    </div>
                    <div className="overflow-x-auto">
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
                          {registrations.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                                No registrations yet.
                              </td>
                            </tr>
                          ) : (
                            registrations.map((reg) => (
                              <tr
                                key={reg.id}
                                onClick={() => setSelectedRegistrationId(reg.id)}
                                className={`registration-row hover:bg-slate-50 transition-colors cursor-pointer ${
                                  selectedRegistrationId === reg.id ? "registration-row-selected bg-blue-50" : ""
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
                                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter ${
                                    reg.status === "checked-in" ? "bg-emerald-100 text-emerald-700" : 
                                    reg.status === "cancelled" ? "bg-slate-200 text-slate-500" :
                                    "bg-blue-100 text-blue-700"
                                  }`}>
                                    {reg.status}
                                  </span>
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
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-base font-semibold flex items-center gap-2">
                          <Activity className="w-4 h-4 text-blue-600" />
                          Event Stats
                        </h3>
                        <p className="text-xs text-slate-500">Live totals for the selected event.</p>
                      </div>
                      <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wider">
                        {registrations.length} total
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3">
                        <p className="text-lg font-bold text-blue-700">{registeredCount}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Registered</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-lg font-bold text-slate-700">{cancelledCount}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cancelled</p>
                      </div>
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
                        <p className="text-lg font-bold text-emerald-700">{checkedInCount}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Checked In</p>
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
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          selectedRegistration.status === "checked-in"
                            ? "bg-emerald-100 text-emerald-700"
                            : selectedRegistration.status === "cancelled"
                            ? "bg-slate-200 text-slate-600"
                            : "bg-blue-100 text-blue-700"
                        }`}>
                          {selectedRegistration.status}
                        </span>
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

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <a
                            href={selectedTicketPngUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 text-sm font-semibold transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                            Open PNG Ticket
                          </a>
                          <a
                            href={selectedTicketPngUrl}
                            download={`${selectedRegistration.id}.png`}
                            className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-sm font-semibold transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            Download PNG
                          </a>
                          <a
                            href={selectedTicketSvgUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-sm font-semibold transition-colors sm:col-span-2"
                          >
                            <QrCode className="w-4 h-4" />
                            Open SVG Preview (fallback)
                          </a>
                        </div>

                        {canChangeRegistrationStatus && (
                        <div className="border-t border-slate-100 pt-4">
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Admin Status Override</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {(["registered", "checked-in", "cancelled"] as RegistrationStatus[]).map((statusOption) => {
                              const active = selectedRegistration.status === statusOption;
                              return (
                                <button
                                  key={statusOption}
                                  onClick={() => updateRegistrationStatus(selectedRegistration.id, statusOption)}
                                  disabled={statusUpdateLoading}
                                  className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all ${
                                    active
                                      ? statusOption === "checked-in"
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                        : statusOption === "cancelled"
                                        ? "bg-slate-100 text-slate-700 border-slate-300"
                                        : "bg-blue-50 text-blue-700 border-blue-200"
                                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                  } disabled:opacity-60`}
                                >
                                  {statusOption}
                                </button>
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

                        {canChangeRegistrationStatus && (
                          <div className="border-t border-slate-100 pt-4">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Danger Zone</p>
                            <button
                              onClick={() => void deleteRegistration(selectedRegistration.id)}
                              disabled={deleteRegistrationLoading}
                              className="inline-flex items-center gap-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
                            >
                              {deleteRegistrationLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                              Delete Registration
                            </button>
                            <p className="mt-2 text-xs text-slate-500">
                              This permanently removes the attendee record from the registration list.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {canManageRegistrations && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <QrCode className="w-5 h-5 text-blue-600" />
                      Admin Check-in
                    </h3>
                    <p className="text-sm text-slate-500 mb-4">Enter Registration ID manually or scan QR to check in attendees at the door.</p>
                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={searchId}
                          onChange={(e) => setSearchId(e.target.value.toUpperCase())}
                          onKeyDown={(e) => e.key === "Enter" && handleCheckin()}
                          placeholder="REG-XXXXXX"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <button
                        onClick={handleCheckin}
                        disabled={!searchId || checkinStatus === "loading"}
                        className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                          checkinStatus === "success" 
                            ? "bg-emerald-500 text-white" 
                            : checkinStatus === "error"
                            ? "bg-rose-500 text-white"
                            : "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                        }`}
                      >
                        {checkinStatus === "loading" && <RefreshCw className="w-4 h-4 animate-spin" />}
                        {checkinStatus === "success" && <CheckCircle2 className="w-4 h-4" />}
                        {checkinStatus === "error" && <AlertCircle className="w-4 h-4" />}
                        {checkinStatus === "success" ? "Checked In!" : checkinStatus === "error" ? "Check-in Failed" : "Check In Attendee"}
                      </button>
                      {checkinStatus === "error" && checkinErrorMessage && (
                        <p className="text-xs text-rose-600">{checkinErrorMessage}</p>
                      )}
                    </div>
                  </div>
                  )}

                  {canManageRegistrations && (
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Camera className="w-5 h-5 text-blue-600" />
                          QR Scanner Check-in
                        </h3>
                        <p className="text-sm text-slate-500">
                          Use your camera to scan attendee QR codes directly from this page.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={startQrScanner}
                          disabled={!canUseQrScanner || scannerActive || scannerStarting}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
                        >
                          {scannerStarting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                          Start
                        </button>
                        <button
                          onClick={stopQrScanner}
                          disabled={!scannerActive && !scannerStarting}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                        >
                          <Square className="w-3.5 h-3.5" />
                          Stop
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-950">
                      <div className="aspect-video relative">
                        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
                        {!scannerActive && !scannerStarting && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-2 p-4 text-center">
                            <Camera className="w-8 h-8 opacity-70" />
                            <p className="text-xs">
                              {canUseQrScanner
                                ? "Tap Start to open camera and scan a QR code."
                                : "This browser does not support camera QR scanning. Use manual check-in or Chrome/Edge on mobile."}
                            </p>
                          </div>
                        )}
                        {scannerStarting && (
                          <div className="absolute inset-0 flex items-center justify-center text-white">
                            <RefreshCw className="w-5 h-5 animate-spin" />
                          </div>
                        )}
                        {scannerActive && (
                          <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-28 border-2 border-blue-300/90 rounded-2xl shadow-[0_0_0_9999px_rgba(15,23,42,0.28)] pointer-events-none" />
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
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Live Webhook Logs</h2>
                    <p className="text-sm text-slate-500">Inbound messages plus delivery traces from active channels.</p>
                  </div>
                  <button onClick={() => void fetchMessages(selectedEventId)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                    <RefreshCw className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
                <div className="overflow-x-auto">
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
                      {messages.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                            No messages received yet.
                          </td>
                        </tr>
                      ) : (
                        messages.map((msg) => {
                          const lineTrace = parseLineTraceMessage(msg.text);
                          return (
                            <tr key={msg.id} className="hover:bg-slate-50/50 transition-colors">
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
                                      <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-50 text-green-700 border border-green-100">
                                        LINE
                                      </span>
                                      <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-100">
                                        Delivery Trace
                                      </span>
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
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter ${
                                  lineTrace
                                    ? "bg-amber-100 text-amber-700"
                                    : msg.type === "incoming"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-blue-100 text-blue-700"
                                }`}>
                                  {lineTrace ? "trace" : msg.type}
                                </span>
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
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Bot className="w-5 h-5 text-blue-600" />
                          AI Settings
                        </h3>
                        <p className="text-sm text-slate-500">Global prompt and model policy for the organization, with optional event-level override.</p>
                      </div>
                      <button
                        onClick={() => void saveAiSettings()}
                        disabled={saving}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                      >
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save AI Settings
                      </button>
                    </div>
                    <div className="space-y-5">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Global System Prompt</label>
                        <textarea
                          value={settings.global_system_prompt}
                          onChange={(e) => setSettings({ ...settings, global_system_prompt: e.target.value })}
                          className="w-full h-40 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                          placeholder="Global operating rules for the bot across all events and channels."
                        />
                        <p className="mt-2 text-xs text-slate-500">
                          Use this for organization-wide tone, safety rules, escalation behavior, and response format. Event-specific content belongs in the <span className="font-semibold">Context</span> tab.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Global Default Model</label>
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
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Selected Event Model Override</label>
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
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Custom Model ID</label>
                        <input
                          value={settings.llm_model}
                          onChange={(e) => setSettings({ ...settings, llm_model: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Leave blank to use the global default. Or set a specific event model ID."
                        />
                        <p className="mt-2 text-xs text-slate-500">
                          This override applies only to the currently selected event. Channel-specific overrides can be added later without changing this structure.
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

                  <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
                    <h3 className="text-blue-800 font-semibold mb-2 flex items-center gap-2">
                      <Code className="w-5 h-5" />
                      Config Split
                    </h3>
                    <div className="space-y-2 text-sm text-blue-700">
                      <p><span className="font-semibold">Event tab</span>: event information, registration rules, lifecycle.</p>
                      <p><span className="font-semibold">Context tab</span>: event-specific FAQ, source text, and attached event documents.</p>
                      <p><span className="font-semibold">Setup tab</span>: system prompt, model policy, channels, team, webhook, and workspace administration.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                    <div>
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Link2 className="w-5 h-5 text-blue-600" />
                        Channels
                      </h3>
                      <p className="text-sm text-slate-500">Map channel accounts to the selected event so inbound chat lands in the right workspace.</p>
                    </div>

                    <div className="space-y-2">
                      {selectedEventChannels.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                          No channels linked to this event yet.
                        </div>
                      ) : (
                        selectedEventChannels.map((channel) => (
                          <div key={channel.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold">{channel.display_name}</p>
                                  <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700">
                                    {channel.platform_label || channel.platform}
                                  </span>
                                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    channel.connection_status === "ready"
                                      ? "bg-emerald-100 text-emerald-700"
                                      : channel.connection_status === "partial"
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-rose-100 text-rose-700"
                                  }`}>
                                    {channel.connection_status || "incomplete"}
                                  </span>
                                </div>
                                <p className="text-xs font-mono text-slate-500">{channel.external_id}</p>
                                {channel.platform_description && (
                                  <p className="mt-1 text-xs text-slate-500">{channel.platform_description}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  channel.platform === "web_chat"
                                    ? "bg-violet-100 text-violet-700"
                                    : channel.has_access_token
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}>
                                  {channel.platform === "web_chat"
                                    ? "no token needed"
                                    : channel.has_access_token
                                    ? "saved token"
                                    : channel.platform === "facebook"
                                    ? "env fallback"
                                    : "no token"}
                                </span>
                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  channel.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                                }`}>
                                  {channel.is_active ? "active" : "inactive"}
                                </span>
                              </div>
                            </div>
                            {channel.missing_requirements && channel.missing_requirements.length > 0 && (
                              <p className="text-xs text-amber-700">
                                Missing: {channel.missing_requirements.join(", ")}
                              </p>
                            )}
                            {channel.config_summary && channel.config_summary.length > 0 && (
                              <div className="flex flex-wrap gap-2 text-[11px]">
                                {channel.config_summary.map((item) => (
                                  <span key={`${channel.id}:${item.key}`} className="rounded-full bg-white border border-slate-200 px-2 py-1 text-slate-600">
                                    {item.label}: {item.value}
                                  </span>
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
                                  <button
                                    onClick={() => copyToClipboard(buildWebChatEmbedSnippet(appUrl, channel.external_id))}
                                    className="rounded-xl bg-violet-100 hover:bg-violet-200 text-violet-700 px-3 py-2 text-xs font-semibold"
                                  >
                                    Copy Embed Snippet
                                  </button>
                                  <button
                                    onClick={() => copyToClipboard(`${appUrl}/api/webchat/config/${encodeURIComponent(channel.external_id)}`)}
                                    className="rounded-xl bg-white hover:bg-violet-100 text-violet-700 border border-violet-200 px-3 py-2 text-xs font-semibold"
                                  >
                                    Copy Config URL
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                onClick={() => loadChannelIntoForm(channel)}
                                className="rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-2 text-xs font-semibold"
                              >
                                Edit Channel
                              </button>
                              <button
                                onClick={() => void handleToggleChannel(channel)}
                                disabled={eventLoading || (selectedEventChannelWritesLocked && !channel.is_active)}
                                className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                              >
                                {selectedEventChannelWritesLocked && !channel.is_active
                                  ? "Locked by Event Status"
                                  : channel.is_active
                                  ? "Disable Channel"
                                  : "Enable Channel"}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="border-t border-slate-100 pt-5 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">{editingChannelKey ? "Edit Channel" : "Link Channel to Selected Event"}</p>
                        {editingChannelKey && (
                          <button
                            onClick={resetChannelForm}
                            className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 text-xs font-semibold"
                          >
                            Cancel Edit
                          </button>
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
                        <p className="text-xs text-slate-500">
                          {selectedChannelPlatformDefinition.external_id_label}
                        </p>
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
                            <p className="text-xs text-slate-500">
                              {selectedChannelPlatformDefinition.access_token_help}
                            </p>
                          )}
                        </>
                      )}
                      {selectedChannelPlatformDefinition?.config_fields.map((field) => (
                        <div key={`${newChannelPlatform}:${field.key}`} className="space-y-1">
                          <input
                            value={newChannelConfig[field.key] || ""}
                            onChange={(e) => setNewChannelConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                            type={field.secret ? "password" : "text"}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder={field.placeholder || field.label}
                          />
                          <p className="text-xs text-slate-500">
                            {field.label}{field.required ? " (required)" : ""}{field.help ? ` - ${field.help}` : ""}
                          </p>
                        </div>
                      ))}
                      <button
                        onClick={() => void handleSaveChannel()}
                        disabled={!selectedEventId || !newPageId.trim() || eventLoading || selectedEventChannelWritesLocked || channelFormMissingRequirements.length > 0}
                        className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                      >
                        {editingChannelKey ? "Update Channel" : "Link Channel to Event"}
                      </button>
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

                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Bot className="w-5 h-5 text-blue-600" />
                        Channel & Platform Notes
                      </h3>
                      <button
                        onClick={fetchLlmModels}
                        disabled={llmModelsLoading}
                        className="p-2 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                        title="Refresh model list"
                      >
                        <RefreshCw className={`w-4 h-4 text-slate-500 ${llmModelsLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm text-slate-600">
                        One event can eventually map to multiple platforms such as Facebook, LINE OA, WhatsApp, and Telegram. This Setup page is now structured so channel credentials stay here while event content stays under the selected event workspace.
                      </p>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 space-y-2">
                        <p><span className="font-semibold text-slate-800">Current</span>: Facebook Page routing with optional page-level access token.</p>
                        <p><span className="font-semibold text-slate-800">Current</span>: LINE OA webhook + reply groundwork is now wired in, using channel access token and channel secret from the selected event mapping.</p>
                        <p><span className="font-semibold text-slate-800">Current</span>: Instagram messaging now has its own webhook + outbound text/image path, routed by Instagram business account ID.</p>
                        <p><span className="font-semibold text-slate-800">Current</span>: WhatsApp Cloud API messaging now has webhook + outbound text/image handling, routed by phone number ID.</p>
                        <p><span className="font-semibold text-slate-800">Current</span>: Telegram bot messaging now has webhook + outbound text/image handling, routed by bot key in the webhook path.</p>
                        <p><span className="font-semibold text-slate-800">Current</span>: Web Chat groundwork is wired in through a public widget config endpoint and message endpoint, scoped to the selected event.</p>
                        <p><span className="font-semibold text-slate-800">Current</span>: platform-specific channel setup fields remain available for future channel extensions.</p>
                        <p><span className="font-semibold text-slate-800">Next</span>: wire live adapters one platform at a time without moving event context out of the event workspace.</p>
                        <p><span className="font-semibold text-slate-800">Current</span>: documents and knowledge stay attached to the event, not to individual pages, so one event can answer consistently across channels.</p>
                      </div>
                      <p className="text-xs text-slate-500">
                        OpenRouter credentials stay server-side in <code>OPENROUTER_API_KEY</code>. Per-channel secrets should also remain server-side and never be embedded in the client.
                      </p>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <SettingsIcon className="w-5 h-5 text-blue-600" />
                      Webhook Configuration
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Facebook Callback URL</label>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            value={webhookUrl}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button 
                            onClick={() => copyToClipboard(webhookUrl)}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">LINE Callback URL</label>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            value={lineWebhookUrl}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button
                            onClick={() => copyToClipboard(lineWebhookUrl)}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          For LINE OA, save `Channel Access Token` as the channel access token, and put `Channel Secret` in the platform-specific config fields under Channels.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Instagram Callback URL</label>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            value={instagramWebhookUrl}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button
                            onClick={() => copyToClipboard(instagramWebhookUrl)}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          For Instagram, use the Instagram business account ID as the channel external ID, save the page-linked Meta token as the access token, and point the webhook callback here.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">WhatsApp Callback URL</label>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            value={whatsappWebhookUrl}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button
                            onClick={() => copyToClipboard(whatsappWebhookUrl)}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          For WhatsApp, use the `Phone Number ID` as the channel external ID, save the Cloud API token as the access token, and keep `Business Account ID` in the platform-specific config field.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telegram Callback URL</label>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            value={telegramWebhookUrl}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button
                            onClick={() => copyToClipboard(telegramWebhookUrl)}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Replace <code>{"{botKey}"}</code> with the Telegram channel external ID. Save the bot token as the access token and, if used, put the webhook secret in the platform-specific config field.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Web Chat Config URL</label>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            value={webChatConfigUrl}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button
                            onClick={() => copyToClipboard(webChatConfigUrl)}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Replace <code>{"{widgetKey}"}</code> with the <code>Web Chat</code> channel external ID to load the public widget config.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Web Chat Message URL</label>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            value={webChatMessageUrl}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button
                            onClick={() => copyToClipboard(webChatMessageUrl)}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          POST `widget_key`, `sender_id`, and `text` to this endpoint from your embedded site widget.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Verify Token</label>
                        <div className="flex gap-2">
                          <input
                            value={settings.verify_token}
                            onChange={(e) => setSettings({ ...settings, verify_token: e.target.value })}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button 
                            onClick={() => void saveWebhookSettings()}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            <Save className="w-5 h-5 text-blue-600" />
                          </button>
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
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold">{user.display_name}</p>
                                  <p className="text-xs text-slate-500">{user.username}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    user.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                                  }`}>
                                    {user.is_active ? "active" : "disabled"}
                                  </span>
                                  <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700">
                                    {user.role}
                                  </span>
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

                              {canManageTargetAccess(user) && (
                                <div className="flex justify-end">
                                  <button
                                    onClick={() => handleUserAccessToggle(user.id, !user.is_active)}
                                    disabled={teamLoading}
                                    className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                                      user.is_active
                                        ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                    } disabled:opacity-50`}
                                  >
                                    {user.is_active ? "Remove Access" : "Restore Access"}
                                  </button>
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
                          <button
                            onClick={handleCreateUser}
                            disabled={teamLoading || !newUserUsername.trim() || !newUserPassword || newUserPassword.length < 8}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                          >
                            <UserPlus className="w-4 h-4" />
                            Create User
                          </button>
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
    </div>
  );
}
