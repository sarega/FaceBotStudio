import type { ChangeEvent, ReactNode, RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Code,
  ImagePlus,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  MonitorCog,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { ChatBubble } from "../../../components/ChatBubble";
import {
  ActionButton,
  AdminAgentDashboardMeter,
  AdminAgentDashboardMiniStat,
  HelpPopover,
  InlineActionsMenu,
  MenuActionItem,
  StatusBadge,
  StatusLine,
  type BadgeTone,
} from "../../../components/shared/AppUi";
import type { EventRecord, Settings } from "../../../types";

type AdminAgentImageAttachment = {
  id: string;
  url: string;
  absolute_url?: string;
  name?: string;
};

type PendingAdminAgentImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

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

type AdminAgentCommandTemplate = {
  id: string;
  label: string;
  command: string;
  note: string;
};

type AdminAgentDashboardEventSummary = {
  updated_at: string;
  slug: string;
  is_default: boolean;
};

type AdminAgentDashboardResponse = {
  summary: {
    total_events: number;
    active_events: number;
    pending_events: number;
    inactive_events: number;
    history_events: number;
    total_registrations: number;
    selected_event_registrations: number;
    selected_event_registered: number;
    selected_event_checked_in: number;
    selected_event_cancelled: number;
  };
};

type AgentConsoleScreenProps = {
  isAgentMobileFocusMode: boolean;
  adminAgentGuardBody: ReactNode;
  adminAgentGuardLabel: string;
  adminAgentDashboardOpen: boolean;
  onAdminAgentDashboardOpenChange: (open: boolean) => void;
  onFetchAdminAgentDashboard: (eventId: string) => unknown;
  selectedEventId: string;
  adminAgentDashboardLoading: boolean;
  agentMobileFocusMode: boolean;
  onAgentMobileFocusModeChange: (nextValue: boolean) => void;
  onClearAdminAgentChat: () => unknown;
  settings: Settings;
  activeAgentMessageCount: number;
  selectedEvent: EventRecord | null;
  getEventStatusTone: (status: EventRecord["effective_status"]) => BadgeTone;
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  adminAgentDashboard: AdminAgentDashboardResponse | null;
  selectedAdminAgentDashboardEvent: AdminAgentDashboardEventSummary | null;
  formatEventWorkspaceDateLabel: (value: string) => string;
  adminAgentDashboardError: string;
  onOpenWorkspace: () => void;
  applyAdminAgentCommand: (command: string) => void;
  adminAgentMessages: AdminAgentChatMessage[];
  adminAgentTyping: boolean;
  adminAgentScrollRef: RefObject<HTMLDivElement | null>;
  adminAgentBottomRef: RefObject<HTMLDivElement | null>;
  formatAdminActionLabel: (actionName: string) => string;
  adminCommandPaletteRef: RefObject<HTMLDivElement | null>;
  adminCommandPaletteOpen: boolean;
  adminCommandPaletteQuery: string;
  onAdminCommandPaletteQueryChange: (value: string) => void;
  adminCommandPaletteSearchInputRef: RefObject<HTMLInputElement | null>;
  filteredAdminCommandTemplates: AdminAgentCommandTemplate[];
  onApplyAdminCommandTemplate: (template: AdminAgentCommandTemplate) => void;
  closeAdminCommandPalette: () => void;
  adminAgentInputRef: RefObject<HTMLInputElement | null>;
  adminAgentImageInputRef: RefObject<HTMLInputElement | null>;
  onAdminAgentImageSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  adminAgentPendingImages: PendingAdminAgentImageAttachment[];
  adminAgentAttachmentError: string;
  onRemoveAdminAgentPendingImage: (attachmentId: string) => void;
  onClearAdminAgentPendingImages: () => void;
  adminAgentImageQuickTemplates: AdminAgentCommandTemplate[];
  onToggleAdminCommandPalette: () => void;
  adminAgentInputText: string;
  onAdminAgentInputTextChange: (value: string) => void;
  onAdminAgentSend: () => unknown;
  adminAgentConsoleQuickTemplates: AdminAgentCommandTemplate[];
};

export function AgentConsoleScreen({
  isAgentMobileFocusMode,
  adminAgentGuardBody,
  adminAgentGuardLabel,
  adminAgentDashboardOpen,
  onAdminAgentDashboardOpenChange,
  onFetchAdminAgentDashboard,
  selectedEventId,
  adminAgentDashboardLoading,
  agentMobileFocusMode,
  onAgentMobileFocusModeChange,
  onClearAdminAgentChat,
  settings,
  activeAgentMessageCount,
  selectedEvent,
  getEventStatusTone,
  getEventStatusLabel,
  adminAgentDashboard,
  selectedAdminAgentDashboardEvent,
  formatEventWorkspaceDateLabel,
  adminAgentDashboardError,
  onOpenWorkspace,
  applyAdminAgentCommand,
  adminAgentMessages,
  adminAgentTyping,
  adminAgentScrollRef,
  adminAgentBottomRef,
  formatAdminActionLabel,
  adminCommandPaletteRef,
  adminCommandPaletteOpen,
  adminCommandPaletteQuery,
  onAdminCommandPaletteQueryChange,
  adminCommandPaletteSearchInputRef,
  filteredAdminCommandTemplates,
  onApplyAdminCommandTemplate,
  closeAdminCommandPalette,
  adminAgentInputRef,
  adminAgentImageInputRef,
  onAdminAgentImageSelection,
  adminAgentPendingImages,
  adminAgentAttachmentError,
  onRemoveAdminAgentPendingImage,
  onClearAdminAgentPendingImages,
  adminAgentImageQuickTemplates,
  onToggleAdminCommandPalette,
  adminAgentInputText,
  onAdminAgentInputTextChange,
  onAdminAgentSend,
  adminAgentConsoleQuickTemplates,
}: AgentConsoleScreenProps) {
  return (
    <div
      className={`agent-console-shell flex h-full min-h-0 flex-col overflow-hidden bg-white ${
        isAgentMobileFocusMode
          ? "rounded-none border-0 shadow-none sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm"
          : "rounded-2xl border border-slate-200 shadow-sm"
      }`}
    >
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
                  onClick={() => onAdminAgentDashboardOpenChange(!adminAgentDashboardOpen)}
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
                  onClick={() => void onFetchAdminAgentDashboard(selectedEventId)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-slate-700"
                  aria-label="Refresh agent dashboard"
                  title="Refresh dashboard"
                >
                  <RefreshCw className={`h-4 w-4 ${adminAgentDashboardLoading ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => onAgentMobileFocusModeChange(!agentMobileFocusMode)}
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
                    onClick={onClearAdminAgentChat}
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
                  onClick={() => onAdminAgentDashboardOpenChange(false)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:border-violet-300 hover:text-violet-700"
                >
                  Hide
                </button>
                {selectedEventId && (
                  <button
                    type="button"
                    onClick={onOpenWorkspace}
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
                <AdminAgentDashboardMiniStat label="events" value={adminAgentDashboard?.summary.total_events ?? "..."} />
                <AdminAgentDashboardMiniStat label="live" value={adminAgentDashboard?.summary.active_events ?? "..."} tone="emerald" />
                <AdminAgentDashboardMiniStat label="pending" value={adminAgentDashboard?.summary.pending_events ?? "..."} tone="amber" />
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
              <p className="max-w-xs text-sm">
                Ask the agent to create or update events, change status or context, manage registrations, message users, or search across the system within the enabled policy scope.
              </p>
              <p className="text-xs">
                CLI shortcuts: <span className="font-medium">list events</span>, <span className="font-medium">list events status:pending</span>, <span className="font-medium">/event evt_xxx get_event_overview</span>
              </p>
            </div>
          </div>
        )}
        {adminAgentMessages.map((message, index) => (
          <div key={`${message.timestamp}-${index}`} className="space-y-1">
            {message.text.trim() && (
              <ChatBubble
                text={message.text}
                type={message.role === "user" ? "outgoing" : "incoming"}
                timestamp={message.timestamp}
              />
            )}
            {Array.isArray(message.attachments) && message.attachments.length > 0 && (
              <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`flex max-w-[75%] flex-wrap gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  {message.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.absolute_url || attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="agent-inline-asset inline-block overflow-hidden rounded-2xl border border-slate-200 bg-white p-1"
                    >
                      <img
                        src={attachment.absolute_url || attachment.url}
                        alt={attachment.name || "Attached image"}
                        className="h-24 w-24 rounded-xl object-cover sm:h-28 sm:w-28"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {message.role === "agent" && (message.ticketPngUrl || message.ticketSvgUrl || message.csvDownloadUrl) && (
              <div className="ml-2 space-y-2 pb-1">
                {message.ticketPngUrl && (
                  <a
                    href={message.ticketPngUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="agent-inline-asset inline-block rounded-xl border border-slate-200 bg-white p-1"
                  >
                    <img
                      src={message.ticketPngUrl}
                      alt="Ticket preview"
                      className="max-h-56 w-auto rounded-lg"
                      loading="lazy"
                    />
                  </a>
                )}
                {!message.ticketPngUrl && message.ticketSvgUrl && (
                  <a
                    href={message.ticketSvgUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="agent-inline-asset inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700"
                  >
                    Open ticket (SVG)
                  </a>
                )}
                {message.csvDownloadUrl && (
                  <a
                    href={message.csvDownloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="agent-inline-asset inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-blue-700"
                  >
                    Download CSV
                  </a>
                )}
              </div>
            )}
            {message.role === "agent" && message.actionName && (
              <StatusLine
                className="ml-2 pb-2"
                items={[
                  formatAdminActionLabel(message.actionName),
                  message.actionSource || "llm",
                ]}
              />
            )}
          </div>
        ))}

        {adminAgentTyping && (
          <div className="mb-4 flex justify-start">
            <div className="agent-typing-bubble flex gap-1 rounded-2xl rounded-bl-none border border-slate-100 bg-white px-4 py-3">
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:0.2s]" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:0.4s]" />
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
                    onChange={(event) => onAdminCommandPaletteQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const firstTemplate = filteredAdminCommandTemplates[0];
                        if (firstTemplate) {
                          onApplyAdminCommandTemplate(firstTemplate);
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
                      onClick={() => onAdminCommandPaletteQueryChange("")}
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
                      onClick={() => onApplyAdminCommandTemplate(template)}
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

          <input
            ref={adminAgentImageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={onAdminAgentImageSelection}
          />

          {(adminAgentPendingImages.length > 0 || adminAgentAttachmentError) && (
            <div className="mb-2 space-y-2">
              {adminAgentPendingImages.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {adminAgentPendingImages.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="agent-inline-asset flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-2"
                      >
                        <img
                          src={attachment.previewUrl}
                          alt={attachment.file.name}
                          className="h-10 w-10 rounded-xl object-cover"
                        />
                        <div className="min-w-0">
                          <p className="max-w-28 truncate text-xs font-medium text-slate-800">{attachment.file.name}</p>
                          <p className="text-[10px] text-slate-500">{Math.max(1, Math.round(attachment.file.size / 1024))} KB</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveAdminAgentPendingImage(attachment.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-700"
                          aria-label={`Remove ${attachment.file.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {adminAgentPendingImages.length > 1 && (
                      <button
                        type="button"
                        onClick={onClearAdminAgentPendingImages}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600 transition hover:border-rose-300 hover:text-rose-700"
                      >
                        Clear Images
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {adminAgentImageQuickTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => onApplyAdminCommandTemplate(template)}
                        className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {adminAgentAttachmentError && <p className="text-xs text-rose-600">{adminAgentAttachmentError}</p>}
            </div>
          )}

          <div className="flex gap-2 lg:pr-16">
            <ActionButton
              onClick={onToggleAdminCommandPalette}
              tone="neutral"
              className="px-2.5"
              aria-label={adminCommandPaletteOpen ? "Close command palette" : "Open command palette"}
              title="Command Palette (Ctrl/Cmd + Shift + P)"
            >
              <Code className="h-4 w-4" />
            </ActionButton>
            <ActionButton
              onClick={() => adminAgentImageInputRef.current?.click()}
              tone="neutral"
              className="px-2.5"
              disabled={adminAgentTyping || adminAgentPendingImages.length >= 4}
              aria-label="Attach image"
              title="Attach image"
            >
              <ImagePlus className="h-4 w-4" />
            </ActionButton>
            <input
              ref={adminAgentInputRef}
              type="text"
              value={adminAgentInputText}
              onChange={(event) => onAdminAgentInputTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void onAdminAgentSend();
                }
              }}
              placeholder="Ask Admin Agent or type a CLI command like list events status:pending"
              className="agent-command-input flex-1 rounded-xl border-none bg-slate-100 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500"
            />
            <ActionButton
              onClick={() => void onAdminAgentSend()}
              disabled={(!adminAgentInputText.trim() && adminAgentPendingImages.length === 0) || adminAgentTyping || settings.admin_agent_enabled !== "1"}
              tone="violet"
              active
              className="px-3"
            >
              <Send className="h-5 w-5" />
            </ActionButton>
          </div>
          <div className="mt-2 sm:hidden">
            <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex w-max gap-2 px-1">
                {adminAgentConsoleQuickTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => onApplyAdminCommandTemplate(template)}
                    className="agent-preset-chip shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                  >
                    {template.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onToggleAdminCommandPalette}
                  className="agent-preset-chip shrink-0 rounded-full border border-dashed border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
                >
                  More
                </button>
              </div>
            </div>
          </div>
          <div className="mt-2 hidden flex-wrap gap-2 sm:flex">
            {adminAgentConsoleQuickTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onApplyAdminCommandTemplate(template)}
                className="agent-preset-chip rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 sm:px-3 sm:py-1.5 sm:text-xs"
              >
                {template.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
