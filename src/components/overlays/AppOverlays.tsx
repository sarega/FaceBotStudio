import { AnimatePresence, motion } from "motion/react";
import type { RefObject } from "react";
import {
  CircleHelp,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";

import {
  ActionButton,
  ChannelPlatformLogo,
  HelpPopover,
  InlineWarning,
  StatusBadge,
  type BadgeTone,
} from "../shared/AppUi";
import type {
  ChannelAccountRecord,
  ChannelPlatform,
  ChannelPlatformDefinition,
  EventDocumentRecord,
  EventRecord,
  Message,
} from "../../types";

type DirtyNavigationDialogState = {
  open: boolean;
  saving: boolean;
  error: string;
};

type GlobalRegistrationResult = {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
};

type HelpContent = {
  title: string;
  summary: string;
  points: Array<{
    label: string;
    body: string;
  }>;
} | null;

type AppOverlaysProps = {
  dirtyNavigationDialog: DirtyNavigationDialogState;
  dirtyNavigationTargetLabel: string;
  dirtyNavigationSectionLabels: string[];
  onCloseDirtyNavigationDialog: () => void;
  onLeaveDirtyNavigationWithoutSaving: () => void;
  onSaveDirtyNavigationAndLeave: () => void | Promise<void>;
  channelConfigDialogOpen: boolean;
  editingChannelKey: string;
  newChannelPlatform: ChannelPlatform;
  onNewChannelPlatformChange: (platform: ChannelPlatform) => void;
  selectedChannelPlatformDefinition: ChannelPlatformDefinition | null;
  editingChannel: ChannelAccountRecord | null;
  eventNameById: Map<string, string>;
  selectedEventName: string;
  onCloseChannelConfigDialog: () => void;
  newPageName: string;
  onNewPageNameChange: (value: string) => void;
  newPageId: string;
  onNewPageIdChange: (value: string) => void;
  lineChannelIdAutoResolved: boolean;
  newPageAccessToken: string;
  onNewPageAccessTokenChange: (value: string) => void;
  newChannelConfig: Record<string, string>;
  onNewChannelConfigFieldChange: (key: string, value: string) => void;
  channelFormMissingRequirements: string[];
  selectedEventId: string;
  eventLoading: boolean;
  selectedEventChannelWritesLocked: boolean;
  onSaveChannelAndClose: () => void | Promise<void>;
  globalSearchOpen: boolean;
  globalSearchInputRef: RefObject<HTMLInputElement | null>;
  globalSearchQuery: string;
  onGlobalSearchQueryChange: (value: string) => void;
  deferredGlobalSearchQuery: string;
  globalEventResults: EventRecord[];
  globalRegistrationResults: GlobalRegistrationResult[];
  globalChannelResults: ChannelAccountRecord[];
  globalDocumentResults: EventDocumentRecord[];
  globalLogResults: Message[];
  onGlobalSearchClose: () => void;
  onGlobalSearchSelect: (kind: "event" | "registration" | "channel" | "document" | "log", id: string) => void;
  getRegistrationAvailabilityTone: (status: EventRecord["registration_availability"]) => BadgeTone;
  getRegistrationAvailabilityLabel: (status: EventRecord["registration_availability"]) => string;
  getEventStatusTone: (status: EventRecord["effective_status"]) => BadgeTone;
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  getRegistrationStatusTone: (status: string | null | undefined) => BadgeTone;
  helpContent: HelpContent;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
  isChatConsoleTab: boolean;
};

export function AppOverlays({
  dirtyNavigationDialog,
  dirtyNavigationTargetLabel,
  dirtyNavigationSectionLabels,
  onCloseDirtyNavigationDialog,
  onLeaveDirtyNavigationWithoutSaving,
  onSaveDirtyNavigationAndLeave,
  channelConfigDialogOpen,
  editingChannelKey,
  newChannelPlatform,
  onNewChannelPlatformChange,
  selectedChannelPlatformDefinition,
  editingChannel,
  eventNameById,
  selectedEventName,
  onCloseChannelConfigDialog,
  newPageName,
  onNewPageNameChange,
  newPageId,
  onNewPageIdChange,
  lineChannelIdAutoResolved,
  newPageAccessToken,
  onNewPageAccessTokenChange,
  newChannelConfig,
  onNewChannelConfigFieldChange,
  channelFormMissingRequirements,
  selectedEventId,
  eventLoading,
  selectedEventChannelWritesLocked,
  onSaveChannelAndClose,
  globalSearchOpen,
  globalSearchInputRef,
  globalSearchQuery,
  onGlobalSearchQueryChange,
  deferredGlobalSearchQuery,
  globalEventResults,
  globalRegistrationResults,
  globalChannelResults,
  globalDocumentResults,
  globalLogResults,
  onGlobalSearchClose,
  onGlobalSearchSelect,
  getRegistrationAvailabilityTone,
  getRegistrationAvailabilityLabel,
  getEventStatusTone,
  getEventStatusLabel,
  getRegistrationStatusTone,
  helpContent,
  helpOpen,
  onHelpOpenChange,
  isChatConsoleTab,
}: AppOverlaysProps) {
  return (
    <>
      <AnimatePresence>
        {dirtyNavigationDialog.open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onCloseDirtyNavigationDialog}
            />
            <motion.div
              className="app-overlay-surface fixed inset-x-3 top-1/2 z-50 mx-auto w-[min(32rem,calc(100vw-1.5rem))] -translate-y-1/2 rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.22)]"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.18 }}
            >
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-600">Unsaved Changes</p>
                    <h2 className="mt-1 text-lg font-semibold text-slate-900">Save before you {dirtyNavigationTargetLabel}?</h2>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      You have unsaved changes in {dirtyNavigationSectionLabels.join(", ")}. You can save first, leave without saving, or stay here.
                    </p>
                  </div>
                  <button
                    onClick={onCloseDirtyNavigationDialog}
                    disabled={dirtyNavigationDialog.saving}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Close unsaved changes dialog"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  {dirtyNavigationSectionLabels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
                    >
                      {label}
                    </span>
                  ))}
                </div>
                {dirtyNavigationDialog.error && (
                  <InlineWarning tone="rose">
                    {dirtyNavigationDialog.error}
                  </InlineWarning>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
                <ActionButton
                  onClick={onCloseDirtyNavigationDialog}
                  tone="neutral"
                  disabled={dirtyNavigationDialog.saving}
                >
                  Stay Here
                </ActionButton>
                <ActionButton
                  onClick={onLeaveDirtyNavigationWithoutSaving}
                  tone="rose"
                  disabled={dirtyNavigationDialog.saving}
                >
                  Leave Without Saving
                </ActionButton>
                <ActionButton
                  onClick={() => void onSaveDirtyNavigationAndLeave()}
                  tone="blue"
                  active
                  disabled={dirtyNavigationDialog.saving}
                >
                  {dirtyNavigationDialog.saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save & Leave
                </ActionButton>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {channelConfigDialogOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-30 bg-slate-950/25 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onCloseChannelConfigDialog}
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
                    onClick={onCloseChannelConfigDialog}
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
                  onChange={(event) => onNewChannelPlatformChange(event.target.value as ChannelPlatform)}
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
                    : <>New connections are assigned to <span className="font-semibold text-slate-800">{selectedEventName || "the selected event"}</span> as soon as you save them.</>}
                </div>
                <input
                  value={newPageName}
                  onChange={(event) => onNewPageNameChange(event.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Channel display name"
                />
                <input
                  value={newPageId}
                  onChange={(event) => onNewPageIdChange(event.target.value)}
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
                      onChange={(event) => onNewPageAccessTokenChange(event.target.value)}
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
                      onChange={(event) => onNewChannelConfigFieldChange(field.key, event.target.value)}
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
                  <ActionButton onClick={onCloseChannelConfigDialog} tone="neutral">
                    Cancel
                  </ActionButton>
                  <ActionButton
                    onClick={() => void onSaveChannelAndClose()}
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

      <AnimatePresence>
        {globalSearchOpen && (
          <motion.div
            className="fixed inset-0 z-30 bg-slate-950/25 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onGlobalSearchClose}
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
                      onChange={(event) => onGlobalSearchQueryChange(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Search events, channels, attendees, documents, or logs"
                    />
                    {globalSearchQuery && (
                      <button
                        onClick={() => onGlobalSearchQueryChange("")}
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
                  onClick={onGlobalSearchClose}
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
                          onClick={() => onGlobalSearchSelect("event", event.id)}
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
                      globalRegistrationResults.map((registration) => (
                        <button
                          key={registration.id}
                          onClick={() => onGlobalSearchSelect("registration", registration.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{registration.first_name} {registration.last_name}</p>
                            <p className="mt-1 truncate font-mono text-xs text-blue-600">{registration.id}</p>
                          </div>
                          <StatusBadge tone={getRegistrationStatusTone(registration.status)}>{registration.status}</StatusBadge>
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
                          onClick={() => onGlobalSearchSelect("channel", channel.id)}
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
                          onClick={() => onGlobalSearchSelect("document", document.id)}
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
                          onClick={() => onGlobalSearchSelect("log", String(message.id))}
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
                onClick={() => onHelpOpenChange(false)}
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
                      onClick={() => onHelpOpenChange(false)}
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
              onClick={() => onHelpOpenChange(!helpOpen)}
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
    </>
  );
}
