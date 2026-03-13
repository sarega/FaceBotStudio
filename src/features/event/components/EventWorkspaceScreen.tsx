import {
  useState,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  Activity,
  AlertCircle,
  Archive,
  ArchiveRestore,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Link2,
  Lock,
  MessageSquare,
  Phone,
  Plus,
  Power,
  QrCode,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from "lucide-react";

import {
  ActionButton,
  CompactStatRow,
  HelpPopover,
  InlineActionsMenu,
  InlineWarning,
  MenuActionItem,
  PageBanner,
  PublicContactActionLink,
  StatusBadge,
  StatusLine,
  type BadgeTone,
} from "../../../components/shared/AppUi";
import {
  PUBLIC_SUMMARY_MAX_CHARS,
  resolveEnglishPublicSlug,
  sanitizeEnglishSlugInput,
  truncatePublicSummary,
} from "../../../lib/publicEventPage";
import type {
  AdminEmailStatusResponse,
  EventRecord,
  EventStatus,
  Settings,
} from "../../../types";

type EventWorkspaceView = "setup" | "public";

type TimingInfo = {
  eventCloseLabel: string;
  nowLabel: string;
  registrationLabel: string;
  timeZone: string;
  eventDateLabel: string;
  startLabel: string;
  endLabel: string;
  registrationStatus: string;
  eventScheduleStatus: string;
};

type EventLocationSummary = {
  title: string;
  address: string;
  addressLine: string;
  travelInfo: string;
};

type RegistrationCapacityInfo = {
  limit: number | null;
  isFull: boolean;
};

type MutableEventStatus = Exclude<EventStatus, "closed">;

type EventStatusToggle = {
  nextStatus: MutableEventStatus;
  disabled: boolean;
  tone: ComponentProps<typeof ActionButton>["tone"];
  label: string;
};

type EventWorkspaceScreenProps = {
  eventWorkspaceView: EventWorkspaceView;
  selectedEvent: EventRecord | null;
  getEventStatusTone: (status: EventRecord["effective_status"]) => BadgeTone;
  getEventStatusLabel: (status: EventRecord["effective_status"] | EventRecord["status"]) => string;
  getRegistrationAvailabilityLabel: (status: EventRecord["registration_availability"]) => string;
  eventSetupDirty: boolean;
  saveEventDetails: () => unknown;
  saving: boolean;
  handleUpdateEvent: (changes: {
    status?: MutableEventStatus;
    name?: string;
    successMessage?: string;
    silent?: boolean;
  }) => unknown;
  eventStatusToggle: EventStatusToggle;
  eventLoading: boolean;
  handleCloneEvent: () => unknown;
  handleDeleteEvent: () => unknown;
  timingInfo: TimingInfo;
  eventMessage: string;
  settingsMessage: string;
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  handleEventDateChange: (value: string) => void;
  eventLocationSummary: EventLocationSummary;
  resolvedEventMapUrl: string;
  eventMapIsGenerated: boolean;
  eventMapEmbedUrl: string;
  registrationCapacity: RegistrationCapacityInfo;
  activeAttendeeCount: number;
  handleNavigateToTab: (tabId: string) => void;
  emailReadinessLabel: string;
  emailStatus: AdminEmailStatusResponse | null;
  publicPageEnabled: boolean;
  publicRegistrationEnabled: boolean;
  publicShowSeatAvailability: boolean;
  publicBotEnabled: boolean;
  publicPrivacyEnabled: boolean;
  publicContactEnabled: boolean;
  eventPublicDirty: boolean;
  saveEventPublicPage: () => unknown;
  publicPosterFileInputRef: RefObject<HTMLInputElement | null>;
  handlePublicPosterFileUpload: (file: File | null) => unknown;
  publicPosterUploading: boolean;
  publicPagePosterUrl: string;
  selectedEventId: string;
  publicPagePreviewPath: string;
  publicPageAutoSummary: string;
  publicPageSummaryCharCount: number;
  publicTicketRecoveryMode: string;
  publicContactHasContent: boolean;
  publicPageAbsoluteUrl: string;
  copyPublicPageUrlToClipboard: () => unknown;
  publicPageLinkCopied: boolean;
  handleDownloadPublicPageQrPng: () => void;
  publicPageQrDataUrl: string;
  handleDownloadPublicPageQrSvg: () => void;
  publicPageQrSvgMarkup: string;
  publicPageQrError: string;
  publicPageSummary: string;
  attendeeLocationLabel: string;
  initialSettings: Pick<
    Settings,
    | "event_public_cta_label"
    | "event_public_privacy_label"
    | "event_public_privacy_text"
    | "event_public_success_message"
  >;
  publicContactIntro: string;
  publicContactMessengerHref: string;
  publicContactLineHref: string;
  publicContactPhoneHref: string;
  eventWorkspacePanel: ReactNode;
};

export function EventWorkspaceScreen({
  eventWorkspaceView,
  selectedEvent,
  getEventStatusTone,
  getEventStatusLabel,
  getRegistrationAvailabilityLabel,
  eventSetupDirty,
  saveEventDetails,
  saving,
  handleUpdateEvent,
  eventStatusToggle,
  eventLoading,
  handleCloneEvent,
  handleDeleteEvent,
  timingInfo,
  eventMessage,
  settingsMessage,
  settings,
  setSettings,
  handleEventDateChange,
  eventLocationSummary,
  resolvedEventMapUrl,
  eventMapIsGenerated,
  eventMapEmbedUrl,
  registrationCapacity,
  activeAttendeeCount,
  handleNavigateToTab,
  emailReadinessLabel,
  emailStatus,
  publicPageEnabled,
  publicRegistrationEnabled,
  publicShowSeatAvailability,
  publicBotEnabled,
  publicPrivacyEnabled,
  publicContactEnabled,
  eventPublicDirty,
  saveEventPublicPage,
  publicPosterFileInputRef,
  handlePublicPosterFileUpload,
  publicPosterUploading,
  publicPagePosterUrl,
  selectedEventId,
  publicPagePreviewPath,
  publicPageAutoSummary,
  publicPageSummaryCharCount,
  publicTicketRecoveryMode,
  publicContactHasContent,
  publicPageAbsoluteUrl,
  copyPublicPageUrlToClipboard,
  publicPageLinkCopied,
  handleDownloadPublicPageQrPng,
  publicPageQrDataUrl,
  handleDownloadPublicPageQrSvg,
  publicPageQrSvgMarkup,
  publicPageQrError,
  publicPageSummary,
  attendeeLocationLabel,
  initialSettings,
  publicContactIntro,
  publicContactMessengerHref,
  publicContactLineHref,
  publicContactPhoneHref,
  eventWorkspacePanel,
}: EventWorkspaceScreenProps) {
  const [mobileWorkspaceBrowserOpen, setMobileWorkspaceBrowserOpen] = useState(false);

  return (
    <div className="space-y-4 overflow-x-hidden">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="min-w-0 space-y-4 xl:col-span-7">
          {eventWorkspaceView === "setup" ? (
            <>
              <div className="surface-panel rounded-2xl p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="flex items-center gap-2 text-lg font-semibold">
                        <Bot className="h-5 w-5 text-blue-600" />
                        Event Information
                      </h3>
                      <HelpPopover label="Open note for Event Information">
                        Core event identity, timing, and venue details live here. Keep the canonical schedule and location clean so public page, chat, tickets, and email all render the same source of truth.
                      </HelpPopover>
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
                      {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save Event Setup
                    </ActionButton>
                    <ActionButton
                      onClick={() => void handleUpdateEvent({ status: eventStatusToggle.nextStatus })}
                      disabled={eventStatusToggle.disabled}
                      tone={eventStatusToggle.tone}
                      active={eventStatusToggle.nextStatus === "active"}
                      className="w-full text-sm sm:w-auto sm:shrink-0"
                    >
                      {eventLoading
                        ? <RefreshCw className="h-4 w-4 animate-spin" />
                        : eventStatusToggle.nextStatus === "active"
                        ? <Power className="h-4 w-4" />
                        : <Activity className="h-4 w-4" />}
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
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Event Name</label>
                    <input
                      value={settings.event_name}
                      onChange={(event) => setSettings({ ...settings, event_name: event.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. AI Innovation Summit 2026"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Event Starts</label>
                        <input
                          type="datetime-local"
                          value={settings.event_date}
                          onChange={(event) => handleEventDateChange(event.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Event Ends (Optional)</label>
                        <input
                          type="datetime-local"
                          value={settings.event_end_date}
                          onChange={(event) => setSettings({ ...settings, event_end_date: event.target.value })}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Event Ends auto-fills to 2 hours later after you set Event Starts. Adjust it if the session runs longer.
                    </p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Description</label>
                    <textarea
                      value={settings.event_description}
                      onChange={(event) => setSettings({ ...settings, event_description: event.target.value })}
                      rows={6}
                      className="min-h-[9rem] w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="What is this event about?"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Time Zone</label>
                    <input
                      value={settings.event_timezone}
                      onChange={(event) => setSettings({ ...settings, event_timezone: event.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. Asia/Bangkok"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <div className="border-t border-slate-200 pt-4">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">Location Details</h4>
                          <p className="mt-1 text-xs text-slate-500">Venue, room, map link, and travel guidance.</p>
                        </div>
                        <HelpPopover label="Open note for Location Details">
                          Separate venue name, room detail, address, map URL, and travel instructions so attendee-facing previews stay consistent across ticket delivery, public page, bot answers, and mail templates.
                        </HelpPopover>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Venue Name</label>
                          <input
                            value={settings.event_venue_name}
                            onChange={(event) => setSettings({ ...settings, event_venue_name: event.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Dhakbwan Resort"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Room / Floor / Hall</label>
                          <input
                            value={settings.event_room_detail}
                            onChange={(event) => setSettings({ ...settings, event_room_detail: event.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Main Hall, 3rd Floor"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Address / Location</label>
                          <input
                            value={settings.event_location}
                            onChange={(event) => setSettings({ ...settings, event_location: event.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Tech Plaza, Bangkok"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Google Maps URL</label>
                          <input
                            value={settings.event_map_url}
                            onChange={(event) => setSettings({ ...settings, event_map_url: event.target.value })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="https://maps.app.goo.gl/..."
                          />
                          <p className="mt-1 text-[11px] text-slate-500">
                            Leave blank to auto-generate a Google Maps search link from Venue Name and Address.
                          </p>
                        </div>

                        <div className="md:col-span-2">
                          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Travel Instructions</label>
                          <textarea
                            value={settings.event_travel}
                            onChange={(event) => setSettings({ ...settings, event_travel: event.target.value })}
                            rows={4}
                            className="min-h-[6.5rem] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="How to get there?"
                          />
                        </div>

                        <div className="surface-frame md:col-span-2 rounded-2xl p-4">
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

                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
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
                            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Travel Info</p>
                              <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{eventLocationSummary.travelInfo}</p>
                            </div>
                          )}

                          {resolvedEventMapUrl && (
                            <div className="surface-tile mt-3 rounded-xl px-3 py-2 text-xs text-slate-600">
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

              <div className="surface-panel rounded-2xl p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="flex items-center gap-2 text-lg font-semibold">
                        <Activity className="h-5 w-5 text-blue-600" />
                        Registration Rules
                      </h3>
                      <HelpPopover label="Open note for Registration Rules">
                        Registration availability depends on the event time zone, registration open/close range, event window, and capacity guardrails. Use this section to define exactly when attendees can register and how duplicate handling should behave.
                      </HelpPopover>
                    </div>
                    <StatusLine
                      className="mt-1"
                      items={[
                        <>Window {timingInfo.registrationLabel}</>,
                        registrationCapacity.limit === null ? "Unlimited capacity" : `Capacity ${activeAttendeeCount}/${registrationCapacity.limit}`,
                        settings.reg_unique_name !== "0" ? "Duplicate guard on" : "Duplicate guard off",
                      ]}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Max Capacity</label>
                    <input
                      type="number"
                      value={settings.reg_limit}
                      onChange={(event) => setSettings({ ...settings, reg_limit: event.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Open Date</label>
                    <input
                      type="datetime-local"
                      value={settings.reg_start}
                      onChange={(event) => setSettings({ ...settings, reg_start: event.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Close Date</label>
                    <input
                      type="datetime-local"
                      value={settings.reg_end}
                      onChange={(event) => setSettings({ ...settings, reg_end: event.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                  <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span>
                    Auto-suggested to 17:00 on the day before the event so registration does not stay open into the event itself.
                  </span>
                </div>
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Duplicate Name Guard</p>
                        <p className="mt-1 text-xs text-slate-500">One ticket per full name, if enabled.</p>
                      </div>
                      <HelpPopover label="Open note for Duplicate Name Guard">
                        When enabled, the event blocks a second registration with the same first and last name. Phone number and email address can still repeat, which is useful for family or shared-contact flows.
                      </HelpPopover>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={settings.reg_unique_name !== "0"}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            reg_unique_name: event.target.checked ? "1" : "0",
                          })}
                      />
                      One ticket per full name
                    </label>
                  </div>
                </div>
                <CompactStatRow
                  className="mt-4 rounded-2xl px-4 py-3"
                  stats={[
                    { label: "Current", value: timingInfo.nowLabel },
                    { label: "Time Zone", value: timingInfo.timeZone },
                    { label: "Opens", value: timingInfo.startLabel },
                    { label: "Closes", value: timingInfo.endLabel },
                  ]}
                />
                <div className="surface-dashed mt-4 rounded-2xl border border-dashed px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Transactional Mail</p>
                        <p className="mt-1 text-xs text-slate-500">Mail templates now live in the dedicated workspace.</p>
                      </div>
                      <HelpPopover label="Open note for Transactional Mail">
                        Registration confirmation, ticket delivery, and future event update templates are edited in the Mail workspace so messaging can evolve independently from registration rules and event setup.
                      </HelpPopover>
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
                  <CompactStatRow
                    className="mt-4 rounded-2xl px-4 py-3"
                    stats={[
                      {
                        label: "Registration Email",
                        value: settings.confirmation_email_enabled === "1" ? "On" : "Off",
                        tone: settings.confirmation_email_enabled === "1" ? "emerald" : "neutral",
                      },
                      { label: "Readiness", value: emailReadinessLabel },
                    ]}
                  />
                  <p className="mt-3 break-all text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-700">Sender:</span>{" "}
                    {emailStatus?.fromAddress || "Not set"}
                  </p>
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
              <div className="surface-panel rounded-2xl p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="flex items-center gap-2 text-lg font-semibold">
                        <Eye className="h-5 w-5 text-blue-600" />
                        Public Event Page
                      </h3>
                      <HelpPopover label="Open note for Public Event Page">
                        This workspace stages the public-facing route: poster, summary, registration form, ticket recovery, privacy note, contact options, and help chat. Keep attendee-facing language here instead of mixing it into internal event operations.
                      </HelpPopover>
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
                      onClick={() => window.open(publicPagePreviewPath, "_blank", "noopener,noreferrer")}
                      disabled={!publicPageEnabled}
                      tone="neutral"
                      className="w-full text-sm sm:w-auto sm:shrink-0"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open Public Page
                    </ActionButton>
                    <ActionButton
                      onClick={() => void saveEventPublicPage()}
                      disabled={saving}
                      tone="blue"
                      active
                      className="w-full text-sm sm:w-auto sm:shrink-0"
                    >
                      {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2 border-t border-slate-200 pt-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">Page Controls</h4>
                        <p className="mt-1 text-xs text-slate-500">Publishing, attendee flow, privacy, support, and recovery behavior.</p>
                      </div>
                      <HelpPopover label="Open note for Page Controls">
                        Use these toggles to stage the public route separately from internal event operations. You can enable the page itself, registration flow, seat visibility, support chat, privacy note, and contact options independently.
                      </HelpPopover>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="md:col-span-2 flex flex-wrap gap-2">
                        <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={publicPageEnabled}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                event_public_page_enabled: event.target.checked ? "1" : "0",
                              })}
                          />
                          Public page enabled
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={publicRegistrationEnabled}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                event_public_registration_enabled: event.target.checked ? "1" : "0",
                              })}
                          />
                          Inline registration
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={publicShowSeatAvailability}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                event_public_show_seat_availability: event.target.checked ? "1" : "0",
                              })}
                          />
                          Show seat counts
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={publicBotEnabled}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                event_public_bot_enabled: event.target.checked ? "1" : "0",
                              })}
                          />
                          Bot help
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={publicPrivacyEnabled}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                event_public_privacy_enabled: event.target.checked ? "1" : "0",
                              })}
                          />
                          Privacy note
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={publicContactEnabled}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                event_public_contact_enabled: event.target.checked ? "1" : "0",
                              })}
                          />
                          Contact options
                        </label>
                      </div>

                      <div className="md:col-span-2 border-t border-slate-200 pt-4">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <h5 className="text-sm font-semibold text-slate-900">Poster, Link & QR</h5>
                            <p className="mt-1 text-xs text-slate-500">Graphic assets and shareable public links live together here.</p>
                          </div>
                          <HelpPopover label="Open note for Poster, Link, and QR">
                            Keep the poster, public slug, full link, and QR asset in one workflow because these are the main publish outputs for the public route. This is the fastest place to prepare something that can be shared on chat, print, or signage.
                          </HelpPopover>
                        </div>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Poster Image URL</label>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                value={settings.event_public_poster_url}
                                onChange={(event) => setSettings({ ...settings, event_public_poster_url: event.target.value })}
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
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
                                tone="blue"
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

                          <div className="surface-frame overflow-hidden rounded-2xl">
                            {publicPagePosterUrl ? (
                              <img
                                src={publicPagePosterUrl}
                                alt={settings.event_name || selectedEvent?.name || "Event poster"}
                                className="aspect-[800/1132] w-full object-cover"
                              />
                            ) : (
                              <div className="flex aspect-[800/1132] w-full flex-col items-center justify-center gap-3 px-4 text-center text-slate-400">
                                <Eye className="h-7 w-7" />
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Poster Preview</p>
                                  <p className="mt-1 text-[11px] text-slate-500">Recommended size 800 x 1132 px</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                          <div className="space-y-4">
                            <div>
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <label className="block text-xs font-bold uppercase text-slate-500">Public Slug</label>
                                <HelpPopover label="Open note for Public Slug">
                                  Use lowercase English letters, numbers, and hyphens only. Keep it short and stable so the public URL is easy to share and print.
                                </HelpPopover>
                              </div>
                              <input
                                value={settings.event_public_slug}
                                onChange={(event) => setSettings({ ...settings, event_public_slug: sanitizeEnglishSlugInput(event.target.value) })}
                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={publicPagePreviewPath || "event-page"}
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
                                    })}
                                  tone="neutral"
                                  className="px-3 text-xs"
                                >
                                  Generate English Slug
                                </ActionButton>
                                <span className="text-[11px] text-slate-500">
                                  Target route: <span className="font-mono text-slate-700">{publicPagePreviewPath}</span>
                                </span>
                              </div>
                            </div>

                            <div className="surface-frame rounded-2xl px-4 py-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Full Public URL</p>
                                  <p className="mt-2 break-all font-mono text-xs leading-6 text-slate-700">{publicPageAbsoluteUrl}</p>
                                </div>
                                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-blue-600 shadow-sm">
                                  <QrCode className="h-5 w-5" />
                                </span>
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
                          </div>

                          <div className="surface-frame rounded-2xl px-4 py-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">QR Preview</p>
                            <div className="mt-3 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
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
                      </div>

                      <div className="md:col-span-2 border-t border-slate-200 pt-4">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <h5 className="text-sm font-semibold text-slate-900">Public Page Copy</h5>
                            <p className="mt-1 text-xs text-slate-500">Editable attendee-facing text and behavior settings.</p>
                          </div>
                          <HelpPopover label="Open note for Public Page Copy">
                            These fields control the wording and optional modules that appear lower on the public page. The snapshot below is read-only, so keep actual edits here and use the preview only to sanity-check the stack.
                          </HelpPopover>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Primary CTA Label</label>
                            <input
                              value={settings.event_public_cta_label}
                              onChange={(event) => setSettings({ ...settings, event_public_cta_label: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Register Now"
                            />
                          </div>

                          <div>
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <label className="block text-xs font-bold uppercase text-slate-500">Ticket Recovery Mode</label>
                              <HelpPopover label="Open note for Ticket Recovery Mode">
                                Shared Contact works best for free or community events where one phone or email may represent several attendees. Verified Recovery is for stricter paid-event flows where release should depend on OTP or order/reference checks later.
                              </HelpPopover>
                            </div>
                            <select
                              value={settings.event_public_ticket_recovery_mode}
                              onChange={(event) => setSettings({ ...settings, event_public_ticket_recovery_mode: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="shared_contact">Shared Contact (free/community events)</option>
                              <option value="verified_contact">Verified Recovery (paid events, future OTP/reference flow)</option>
                            </select>
                            <p className="mt-1 text-[11px] leading-5 text-slate-500">
                              {publicTicketRecoveryMode === "verified_contact"
                                ? "Prepared for stricter verification."
                                : "Best for shared-contact registrations."}
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <label className="block text-xs font-bold uppercase text-slate-500">Public Summary</label>
                              <HelpPopover label="Open note for Public Summary">
                                This is the short attendee-facing overview shown near the top of the public page. If you leave it blank, the system derives a tighter summary from the event description automatically.
                              </HelpPopover>
                            </div>
                            <textarea
                              value={settings.event_public_summary}
                              onChange={(event) => setSettings({ ...settings, event_public_summary: truncatePublicSummary(event.target.value) })}
                              rows={4}
                              className="min-h-[7rem] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500"
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
                                  ? `${publicPageSummaryCharCount}/${PUBLIC_SUMMARY_MAX_CHARS} characters in custom summary`
                                  : `Auto summary stays within ${PUBLIC_SUMMARY_MAX_CHARS} characters`}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500">
                              Auto preview: <span className="text-slate-700">{publicPageAutoSummary || "Add an event description first."}</span>
                            </p>
                          </div>

                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Success Message</label>
                            <textarea
                              value={settings.event_public_success_message}
                              onChange={(event) => setSettings({ ...settings, event_public_success_message: event.target.value })}
                              rows={3}
                              className="min-h-[5.5rem] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Registration complete. Save your ticket image to your phone now."
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Privacy Label</label>
                            <input
                              value={settings.event_public_privacy_label}
                              onChange={(event) => setSettings({ ...settings, event_public_privacy_label: event.target.value })}
                              disabled={!publicPrivacyEnabled}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="Privacy"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Privacy Notice Text</label>
                            <textarea
                              value={settings.event_public_privacy_text}
                              onChange={(event) => setSettings({ ...settings, event_public_privacy_text: event.target.value })}
                              disabled={!publicPrivacyEnabled}
                              rows={4}
                              className="min-h-[7rem] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="Explain how attendee data is used, retained, and deleted on request."
                            />
                          </div>
                        </div>
                      </div>

                      <div className="md:col-span-2 border-t border-slate-200 pt-4">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <h5 className="text-sm font-semibold text-slate-900">Help & Contact</h5>
                            <p className="mt-1 text-xs text-slate-500">Fallback human support links and hours.</p>
                          </div>
                          <HelpPopover label="Open note for Help and Contact">
                            Show fallback contact methods when attendees need a human instead of web chat. Use this for Messenger, LINE, phone, and operating hours so urgent support has a clear path.
                          </HelpPopover>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Contact Intro</label>
                            <textarea
                              value={settings.event_public_contact_intro}
                              onChange={(event) => setSettings({ ...settings, event_public_contact_intro: event.target.value })}
                              disabled={!publicContactEnabled}
                              rows={3}
                              className="min-h-[5.5rem] w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="Need help from our team? Use one of these contact options."
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Messenger URL</label>
                            <input
                              value={settings.event_public_contact_messenger_url}
                              onChange={(event) => setSettings({ ...settings, event_public_contact_messenger_url: event.target.value })}
                              disabled={!publicContactEnabled}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="https://m.me/yourpage"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">LINE URL</label>
                            <input
                              value={settings.event_public_contact_line_url}
                              onChange={(event) => setSettings({ ...settings, event_public_contact_line_url: event.target.value })}
                              disabled={!publicContactEnabled}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="https://lin.ee/youraccount"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Phone</label>
                            <input
                              value={settings.event_public_contact_phone}
                              onChange={(event) => setSettings({ ...settings, event_public_contact_phone: event.target.value })}
                              disabled={!publicContactEnabled}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="+66 8x xxx xxxx"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Support Hours</label>
                            <input
                              value={settings.event_public_contact_hours}
                              onChange={(event) => setSettings({ ...settings, event_public_contact_hours: event.target.value })}
                              disabled={!publicContactEnabled}
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="Mon-Sat, 09:00-18:00"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="md:col-span-2 border-t border-slate-200 pt-4">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <h5 className="text-sm font-semibold text-slate-900">Attendee Flow Snapshot</h5>
                            <p className="mt-1 text-xs text-slate-500">Read-only compact preview of how the public page content stacks.</p>
                          </div>
                          <HelpPopover label="Open note for Attendee Flow Snapshot">
                            This snapshot is only for hierarchy and wording checks. It should feel lighter than the edit controls above. When you need the real attendee-facing route, use the public page link in the publish section instead.
                          </HelpPopover>
                        </div>

                        <div className="surface-frame rounded-[24px] p-4 sm:p-5">
                          <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge tone={publicPageEnabled ? "emerald" : "neutral"}>
                                {publicPageEnabled ? "Public page enabled" : "Draft mode"}
                              </StatusBadge>
                              {selectedEvent?.registration_availability && (
                                <StatusBadge tone={selectedEvent.registration_availability === "open" ? "blue" : "amber"}>
                                  {getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}
                                </StatusBadge>
                              )}
                              {publicPagePosterUrl && (
                                <StatusBadge tone="blue">
                                  Poster ready
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
                              <p className="mt-2 text-[11px] text-slate-500">
                                Compact setup preview only. For the actual attendee-facing route, use <span className="font-semibold text-slate-700">Open Public Page</span>.
                              </p>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div className="surface-tile rounded-2xl px-4 py-3">
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Date & Time</p>
                                <p className="mt-1 text-sm text-slate-800">{timingInfo.eventDateLabel}</p>
                              </div>
                              <div className="surface-tile rounded-2xl px-4 py-3">
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Location</p>
                                <p className="mt-1 text-sm text-slate-800">{attendeeLocationLabel || "Venue details"}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm">
                                {settings.event_public_cta_label.trim() || initialSettings.event_public_cta_label}
                              </span>
                              {publicPrivacyEnabled && (
                                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                                  <Lock className="mr-1.5 h-3.5 w-3.5" />
                                  {settings.event_public_privacy_label.trim() || initialSettings.event_public_privacy_label}
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

                            <div className="border-t border-slate-200 pt-4">
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
                                <div className="surface-tile rounded-2xl px-4 py-3 text-sm text-slate-500">First name</div>
                                <div className="surface-tile rounded-2xl px-4 py-3 text-sm text-slate-500">Last name</div>
                                <div className="surface-tile rounded-2xl px-4 py-3 text-sm text-slate-500">Phone</div>
                                <div className="surface-tile rounded-2xl px-4 py-3 text-sm text-slate-500">Email</div>
                              </div>

                              <div className="surface-dashed mt-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50 px-4 py-4">
                                <p className="text-sm font-semibold text-blue-900">Success state</p>
                                <p className="mt-1 text-sm leading-6 text-blue-800">
                                  {settings.event_public_success_message.trim() || initialSettings.event_public_success_message}
                                </p>
                              </div>

                              <div className="mt-4 border-t border-slate-200 pt-3">
                                <p className="text-sm font-semibold text-slate-900">Ticket recovery</p>
                                <p className="mt-1 text-xs leading-5 text-slate-600">
                                  {publicTicketRecoveryMode === "verified_contact"
                                    ? "Verified recovery mode. Paid events can plug OTP or order-reference verification into this slot later."
                                    : "Shared-contact mode. If one phone or email is used for multiple attendees, the public page will ask for the attendee name before releasing a ticket."}
                                </p>
                              </div>

                              {publicPrivacyEnabled && (
                                <div className="mt-4 border-t border-slate-200 pt-3">
                                  <p className="text-sm font-semibold text-slate-900">
                                    {settings.event_public_privacy_label.trim() || initialSettings.event_public_privacy_label}
                                  </p>
                                  <p className="mt-1 text-xs leading-5 text-slate-500">
                                    {settings.event_public_privacy_text.trim() || initialSettings.event_public_privacy_text}
                                  </p>
                                </div>
                              )}

                              {publicContactEnabled && publicContactHasContent && (
                                <div className="mt-4 border-t border-slate-200 pt-3">
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
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="xl:hidden">
          <ActionButton
            onClick={() => setMobileWorkspaceBrowserOpen((open) => !open)}
            tone="neutral"
            active={mobileWorkspaceBrowserOpen}
            className="rounded-full px-3 py-2 text-sm"
            aria-expanded={mobileWorkspaceBrowserOpen}
            aria-controls="mobile-workspace-browser"
          >
            {mobileWorkspaceBrowserOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {mobileWorkspaceBrowserOpen ? "Hide Workspace Browser" : "Open Workspace Browser"}
          </ActionButton>
          {mobileWorkspaceBrowserOpen && (
            <div id="mobile-workspace-browser" className="mt-3 min-w-0">
              {eventWorkspacePanel}
            </div>
          )}
        </div>

        <div className="hidden min-w-0 space-y-3 xl:col-span-5 xl:self-start xl:block">
          {eventWorkspacePanel}
        </div>
      </div>
    </div>
  );
}
