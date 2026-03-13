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
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Handshake,
  Link2,
  Lock,
  MessageSquare,
  Mic2,
  Phone,
  Plus,
  Power,
  QrCode,
  RefreshCw,
  Save,
  Sparkles,
  Send,
  Trash2,
  Upload,
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
import {
  parsePublicSponsorEntries,
  resolvePublicBrandMode,
  serializePublicSponsorEntries,
  type PublicSponsorEntry,
} from "../../../lib/publicEventPageBranding";
import {
  PUBLIC_EVENT_SECTION_CATALOG,
  parsePublicEventSections,
  parsePublicSpeakerEntries,
  serializePublicEventSections,
  serializePublicSpeakerEntries,
  type PublicEventSectionConfig,
  type PublicEventSectionId,
  type PublicSpeakerEntry,
} from "../../../lib/publicEventPageLayout";
import type {
  AdminEmailStatusResponse,
  EventRecord,
  EventStatus,
  OrganizerProfileRecord,
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
  handlePublicEventMediaUpload: (file: File, kind: "speaker_photo" | "sponsor_logo") => Promise<string | null>;
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
  organizerProfile: OrganizerProfileRecord | null;
  initialSettings: Pick<
    Settings,
    | "event_public_brand_label"
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

type PublicEventMediaUploadKind = "speaker_photo" | "sponsor_logo";

type UploadableImageFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  previewAlt: string;
  uploading: boolean;
  onChange: (value: string) => void;
  onUploadFile: (file: File) => void;
};

function UploadableImageField({
  label,
  value,
  placeholder,
  previewAlt,
  uploading,
  onChange,
  onUploadFile,
}: UploadableImageFieldProps) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase text-slate-500">{label}</label>
      <div className="space-y-3">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={placeholder}
        />

        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 ${
              uploading ? "cursor-wait opacity-70" : "cursor-pointer"
            }`}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                event.currentTarget.value = "";
                if (file) {
                  onUploadFile(file);
                }
              }}
            />
            {uploading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? "Uploading..." : "Upload Image"}
          </label>

          {value ? (
            <ActionButton onClick={() => onChange("")} tone="neutral" className="px-3 text-xs">
              Clear
            </ActionButton>
          ) : null}
        </div>

        {value ? (
          <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3">
            <div className="flex h-24 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
              <img
                key={value}
                src={value}
                alt={previewAlt}
                className="h-full w-full object-contain"
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            </div>
            <p className="mt-2 truncate text-[11px] text-slate-500">{value}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type SponsorEditorRowProps = {
  entry: PublicSponsorEntry;
  index: number;
  uploading: boolean;
  onChange: (field: keyof PublicSponsorEntry, value: string) => void;
  onUploadFile: (file: File) => void;
  onRemove: () => void;
};

function SponsorEditorRow({ entry, index, uploading, onChange, onUploadFile, onRemove }: SponsorEditorRowProps) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Sponsor {index + 1}</p>
          <p className="mt-1 text-xs text-slate-500">Name or logo is enough to render a sponsor card on the public page.</p>
        </div>
        <ActionButton onClick={onRemove} tone="rose" className="px-3 text-xs">
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </ActionButton>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Sponsor Name</label>
          <input
            value={entry.name}
            onChange={(event) => onChange("name", event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Brand A"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Tier</label>
          <input
            value={entry.tier}
            onChange={(event) => onChange("tier", event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="main, partner, community"
          />
        </div>

        <UploadableImageField
          label="Logo URL"
          value={entry.logoUrl}
          placeholder="/uploads/sponsors/brand-a.png"
          previewAlt={`${entry.name || `Sponsor ${index + 1}`} logo`}
          uploading={uploading}
          onChange={(value) => onChange("logoUrl", value)}
          onUploadFile={onUploadFile}
        />

        <div>
          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Link URL</label>
          <input
            value={entry.linkUrl}
            onChange={(event) => onChange("linkUrl", event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="https://example.com"
          />
        </div>
      </div>
    </div>
  );
}

type SpeakerEditorRowProps = {
  entry: PublicSpeakerEntry;
  index: number;
  uploading: boolean;
  onChange: (field: keyof PublicSpeakerEntry, value: string) => void;
  onUploadFile: (file: File) => void;
  onRemove: () => void;
};

function SpeakerEditorRow({ entry, index, uploading, onChange, onUploadFile, onRemove }: SpeakerEditorRowProps) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Speaker {index + 1}</p>
          <p className="mt-1 text-xs text-slate-500">A simple profile card with name, role, company, photo, and short bio.</p>
        </div>
        <ActionButton onClick={onRemove} tone="rose" className="px-3 text-xs">
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </ActionButton>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Name</label>
          <input
            value={entry.name}
            onChange={(event) => onChange("name", event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Speaker name"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Role / Title</label>
          <input
            value={entry.title}
            onChange={(event) => onChange("title", event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="CEO, Keynote speaker"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Company / Organization</label>
          <input
            value={entry.company}
            onChange={(event) => onChange("company", event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Meetrix"
          />
        </div>

        <UploadableImageField
          label="Photo URL"
          value={entry.photoUrl}
          placeholder="/uploads/speakers/jane-doe.jpg"
          previewAlt={entry.name || `Speaker ${index + 1}`}
          uploading={uploading}
          onChange={(value) => onChange("photoUrl", value)}
          onUploadFile={onUploadFile}
        />

        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Bio</label>
          <textarea
            value={entry.bio}
            onChange={(event) => onChange("bio", event.target.value)}
            rows={4}
            className="min-h-[7rem] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Short bio or why this speaker matters for the event."
          />
        </div>
      </div>
    </div>
  );
}

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
  handlePublicEventMediaUpload,
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
  organizerProfile,
  initialSettings,
  publicContactIntro,
  publicContactMessengerHref,
  publicContactLineHref,
  publicContactPhoneHref,
  eventWorkspacePanel,
}: EventWorkspaceScreenProps) {
  const [mobileWorkspaceBrowserOpen, setMobileWorkspaceBrowserOpen] = useState(false);
  const [publicMediaUploadKey, setPublicMediaUploadKey] = useState("");
  const publicBrandMode = resolvePublicBrandMode(settings.event_public_brand_mode);
  const publicBrandVisible = publicBrandMode !== "hidden";
  const publicBrandLabel = settings.event_public_brand_label.trim() || initialSettings.event_public_brand_label;
  const publicSectionEntries = parsePublicEventSections(settings.event_public_sections_json);
  const publicSpeakerEntries = parsePublicSpeakerEntries(settings.event_public_speakers_json, { preserveEmpty: true });
  const publicSponsorEntries = parsePublicSponsorEntries(settings.event_public_sponsors_json, { preserveEmpty: true });
  const organizerVisible = Boolean(
    settings.event_public_organizer_name.trim()
    || settings.event_public_organizer_logo_url.trim()
    || settings.event_public_organizer_description.trim()
    || settings.event_public_organizer_contact_text.trim(),
  );
  const publicBrandModeLabel = publicBrandMode === "full" ? "Full" : publicBrandMode === "hidden" ? "Hidden" : "Subtle";
  const activeMainSectionLabels = publicSectionEntries
    .filter((section) => section.enabled)
    .map((section) => PUBLIC_EVENT_SECTION_CATALOG.find((item) => item.id === section.id)?.label || section.id);

  const updatePublicSponsorEntries = (updater: (entries: PublicSponsorEntry[]) => PublicSponsorEntry[]) => {
    setSettings((current) => ({
      ...current,
      event_public_sponsors_json: serializePublicSponsorEntries(
        updater(parsePublicSponsorEntries(current.event_public_sponsors_json, { preserveEmpty: true })),
        { preserveEmpty: true },
      ),
    }));
  };
  const updatePublicSpeakerEntries = (updater: (entries: PublicSpeakerEntry[]) => PublicSpeakerEntry[]) => {
    setSettings((current) => ({
      ...current,
      event_public_speakers_json: serializePublicSpeakerEntries(
        updater(parsePublicSpeakerEntries(current.event_public_speakers_json, { preserveEmpty: true })),
        { preserveEmpty: true },
      ),
    }));
  };
  const updatePublicSectionEntries = (updater: (entries: PublicEventSectionConfig[]) => PublicEventSectionConfig[]) => {
    setSettings((current) => ({
      ...current,
      event_public_sections_json: serializePublicEventSections(
        updater(parsePublicEventSections(current.event_public_sections_json)).map((entry, index) => ({
          ...entry,
          order: (index + 1) * 10,
        })),
      ),
    }));
  };
  const uploadPublicEventMediaForField = async ({
    file,
    kind,
    uploadKey,
    applyUrl,
  }: {
    file: File;
    kind: PublicEventMediaUploadKind;
    uploadKey: string;
    applyUrl: (url: string) => void;
  }) => {
    setPublicMediaUploadKey(uploadKey);
    try {
      const uploadedUrl = await handlePublicEventMediaUpload(file, kind);
      if (uploadedUrl) {
        applyUrl(uploadedUrl);
      }
    } finally {
      setPublicMediaUploadKey((current) => (current === uploadKey ? "" : current));
    }
  };

  return (
    <div className="space-y-4 overflow-x-hidden">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 xl:items-start">
        <div className="min-w-0 space-y-4 xl:col-span-7 xl:self-start">
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
                          publicBrandVisible ? `Brand ${publicBrandModeLabel.toLowerCase()}` : "Brand hidden",
                          organizerVisible ? "Organizer info on" : "Organizer info off",
                          publicSpeakerEntries.length > 0 ? `${publicSpeakerEntries.length} speakers` : "Speakers off",
                          publicSponsorEntries.length > 0 ? `${publicSponsorEntries.length} sponsors` : "Sponsors off",
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
                            <h5 className="text-sm font-semibold text-slate-900">Page Sections</h5>
                            <p className="mt-1 text-xs text-slate-500">Reorder and toggle the sections that appear in the main content column.</p>
                          </div>
                          <HelpPopover label="Open note for Page Sections">
                            Hero, sticky brand pane, footer branding, and the registration sidebar stay fixed. Only the main reading column is reorderable here.
                          </HelpPopover>
                        </div>

                        <div className="space-y-3">
                          {publicSectionEntries.map((section, index) => {
                            const meta = PUBLIC_EVENT_SECTION_CATALOG.find((item) => item.id === section.id);
                            return (
                              <div
                                key={section.id}
                                className="flex flex-col gap-3 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-slate-900">{meta?.label || section.id}</p>
                                    <StatusBadge tone={section.enabled ? "emerald" : "neutral"}>
                                      {section.enabled ? "shown" : "hidden"}
                                    </StatusBadge>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-500">{meta?.description || "Section"}</p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                      checked={section.enabled}
                                      onChange={(event) =>
                                        updatePublicSectionEntries((entries) =>
                                          entries.map((current) =>
                                            current.id === section.id ? { ...current, enabled: event.target.checked } : current,
                                          ),
                                        )}
                                    />
                                    Enabled
                                  </label>
                                  <ActionButton
                                    onClick={() =>
                                      updatePublicSectionEntries((entries) => {
                                        const next = [...entries];
                                        if (index === 0) return next;
                                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                        return next;
                                      })}
                                    disabled={index === 0}
                                    tone="neutral"
                                    className="px-3 text-xs"
                                  >
                                    <ChevronUp className="h-3.5 w-3.5" />
                                    Up
                                  </ActionButton>
                                  <ActionButton
                                    onClick={() =>
                                      updatePublicSectionEntries((entries) => {
                                        const next = [...entries];
                                        if (index >= next.length - 1) return next;
                                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                                        return next;
                                      })}
                                    disabled={index >= publicSectionEntries.length - 1}
                                    tone="neutral"
                                    className="px-3 text-xs"
                                  >
                                    <ChevronDown className="h-3.5 w-3.5" />
                                    Down
                                  </ActionButton>
                                </div>
                              </div>
                            );
                          })}
                        </div>
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
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,22rem)]">
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                              <div>
                                <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Poster Image URL</label>
                                <div className="flex flex-col gap-2">
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
                                    className="w-full px-3 text-xs sm:w-auto"
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
                                </div>
                                <p className="mt-2 text-[11px] text-slate-500">
                                  Target route: <span className="font-mono text-slate-700">{publicPagePreviewPath}</span>
                                </p>
                              </div>
                            </div>

                            <div className="surface-frame rounded-2xl px-4 py-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Full Public URL</p>
                                  <p className="mt-2 break-all font-mono text-xs leading-6 text-slate-700">{publicPageAbsoluteUrl}</p>
                                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                                    Use the full link for chat or email, then export the QR asset for posters, printouts, or signage.
                                  </p>
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

                          <div className="surface-frame rounded-2xl p-3">
                            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_8.75rem]">
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Poster Preview</p>
                                <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
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

                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">QR Preview</p>
                                <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                                  {publicPageQrDataUrl ? (
                                    <img
                                      src={publicPageQrDataUrl}
                                      alt={`QR code for ${publicPageAbsoluteUrl}`}
                                      className="mx-auto w-full max-w-[7rem]"
                                    />
                                  ) : (
                                    <div className="flex aspect-square w-full items-center justify-center rounded-[1rem] bg-slate-50 text-slate-400">
                                      <RefreshCw className="h-5 w-5 animate-spin" />
                                    </div>
                                  )}
                                </div>
                                <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                  Scan to register
                                </p>
                              </div>
                            </div>
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
                            <h5 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                              <Sparkles className="h-4 w-4 text-blue-600" />
                              Platform Branding
                            </h5>
                            <p className="mt-1 text-xs text-slate-500">Sticky header pane plus lightweight footer attribution.</p>
                          </div>
                          <HelpPopover label="Open note for Platform Branding">
                            This branding layer should stay persistent enough to build platform recall, but always remain secondary to the event identity and registration CTA.
                          </HelpPopover>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Brand Mode</label>
                            <select
                              value={publicBrandMode}
                              onChange={(event) => setSettings({ ...settings, event_public_brand_mode: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="hidden">Hidden</option>
                              <option value="subtle">Subtle</option>
                              <option value="full">Full</option>
                            </select>
                            <p className="mt-1 text-[11px] leading-5 text-slate-500">
                              {publicBrandMode === "full"
                                ? "Shows logo/label plus optional footer and utility links."
                                : publicBrandMode === "hidden"
                                ? "Removes the sticky brand pane and footer attribution."
                                : "Shows a compact sticky pane and quiet footer mention."}
                            </p>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Brand Label</label>
                            <input
                              value={settings.event_public_brand_label}
                              onChange={(event) => setSettings({ ...settings, event_public_brand_label: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder={initialSettings.event_public_brand_label}
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Brand Logo URL</label>
                            <input
                              value={settings.event_public_brand_logo_url}
                              onChange={(event) => setSettings({ ...settings, event_public_brand_logo_url: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="/uploads/brands/meetrix-wordmark.png"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">About URL</label>
                            <input
                              value={settings.event_public_brand_about_url}
                              onChange={(event) => setSettings({ ...settings, event_public_brand_about_url: event.target.value })}
                              disabled={publicBrandMode !== "full"}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="https://meetrix.io/about"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Privacy URL</label>
                            <input
                              value={settings.event_public_brand_privacy_url}
                              onChange={(event) => setSettings({ ...settings, event_public_brand_privacy_url: event.target.value })}
                              disabled={publicBrandMode !== "full"}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="https://meetrix.io/privacy"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Contact URL</label>
                            <input
                              value={settings.event_public_brand_contact_url}
                              onChange={(event) => setSettings({ ...settings, event_public_brand_contact_url: event.target.value })}
                              disabled={publicBrandMode !== "full"}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="https://meetrix.io/contact"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="md:col-span-2 border-t border-slate-200 pt-4">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <h5 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                              <Building2 className="h-4 w-4 text-blue-600" />
                              Organizer Info
                            </h5>
                            <p className="mt-1 text-xs text-slate-500">
                              Shared organizer profile used across events under the same organizer.
                            </p>
                          </div>
                          <HelpPopover label="Open note for Organizer Info">
                            This no longer saves per event. Updating it here refreshes the organizer card for all events under the same organizer context.
                          </HelpPopover>
                        </div>

                        {organizerProfile && (
                          <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                            <p className="font-semibold text-slate-800">
                              {organizerProfile.organization_name || settings.event_public_organizer_name.trim() || "Current organizer"}
                            </p>
                            <p className="mt-1">
                              Source: {organizerProfile.public_profile_source.replace(/_/g, " ")}
                              {" · "}
                              Verification: {organizerProfile.verification_status.replace(/_/g, " ")}
                            </p>
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Organizer Name</label>
                            <input
                              value={settings.event_public_organizer_name}
                              onChange={(event) => setSettings({ ...settings, event_public_organizer_name: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Meetrix Events"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Organizer Logo URL</label>
                            <input
                              value={settings.event_public_organizer_logo_url}
                              onChange={(event) => setSettings({ ...settings, event_public_organizer_logo_url: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="/uploads/organizers/meetrix-logo.png"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Organizer Description</label>
                            <textarea
                              value={settings.event_public_organizer_description}
                              onChange={(event) => setSettings({ ...settings, event_public_organizer_description: event.target.value })}
                              rows={4}
                              className="min-h-[7rem] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Short organizer profile, mission, or event context."
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Website URL</label>
                            <input
                              value={settings.event_public_organizer_website_url}
                              onChange={(event) => setSettings({ ...settings, event_public_organizer_website_url: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="https://example.com"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Facebook URL</label>
                            <input
                              value={settings.event_public_organizer_facebook_url}
                              onChange={(event) => setSettings({ ...settings, event_public_organizer_facebook_url: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="https://facebook.com/yourpage"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">LINE URL</label>
                            <input
                              value={settings.event_public_organizer_line_url}
                              onChange={(event) => setSettings({ ...settings, event_public_organizer_line_url: event.target.value })}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="https://lin.ee/youraccount"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Contact Text</label>
                            <textarea
                              value={settings.event_public_organizer_contact_text}
                              onChange={(event) => setSettings({ ...settings, event_public_organizer_contact_text: event.target.value })}
                              rows={3}
                              className="min-h-[5.5rem] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Support email, contact person, or lightweight organizer note."
                            />
                          </div>
                        </div>
                      </div>

                      <div className="md:col-span-2 border-t border-slate-200 pt-4">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <h5 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                              <Mic2 className="h-4 w-4 text-blue-600" />
                              Speakers
                            </h5>
                            <p className="mt-1 text-xs text-slate-500">Structured speaker cards for the public page.</p>
                          </div>
                          <HelpPopover label="Open note for Speakers">
                            Keep speaker cards concise. This first phase is card-based only, not a full agenda or track system.
                          </HelpPopover>
                        </div>

                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {publicSpeakerEntries.length > 0
                                  ? `${publicSpeakerEntries.length} speaker${publicSpeakerEntries.length === 1 ? "" : "s"} ready`
                                  : "No speakers added yet"}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                Speaker cards appear only when the Speakers section is enabled in Page Sections.
                              </p>
                            </div>
                            <ActionButton
                              onClick={() =>
                                updatePublicSpeakerEntries((entries) => [
                                  ...entries,
                                  { name: "", title: "", company: "", photoUrl: "", bio: "" },
                                ])}
                              tone="blue"
                              className="px-3 text-xs"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add Speaker
                            </ActionButton>
                          </div>

                          {publicSpeakerEntries.length > 0 ? (
                            <div className="space-y-3">
                              {publicSpeakerEntries.map((entry, index) => (
                                <SpeakerEditorRow
                                  key={`speaker:${index}`}
                                  entry={entry}
                                  index={index}
                                  uploading={publicMediaUploadKey === `speaker:${index}`}
                                  onChange={(field, value) =>
                                    updatePublicSpeakerEntries((entries) =>
                                      entries.map((current, currentIndex) =>
                                        currentIndex === index ? { ...current, [field]: value } : current,
                                      ),
                                    )}
                                  onUploadFile={(file) =>
                                    void uploadPublicEventMediaForField({
                                      file,
                                      kind: "speaker_photo",
                                      uploadKey: `speaker:${index}`,
                                      applyUrl: (uploadedUrl) =>
                                        updatePublicSpeakerEntries((entries) =>
                                          entries.map((current, currentIndex) =>
                                            currentIndex === index ? { ...current, photoUrl: uploadedUrl } : current,
                                          ),
                                        ),
                                    })}
                                  onRemove={() =>
                                    updatePublicSpeakerEntries((entries) =>
                                      entries.filter((_, currentIndex) => currentIndex !== index),
                                    )}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                              Add speaker rows to render profile cards in the main content column.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="md:col-span-2 border-t border-slate-200 pt-4">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div>
                            <h5 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                              <Handshake className="h-4 w-4 text-blue-600" />
                              Sponsors & Partners
                            </h5>
                            <p className="mt-1 text-xs text-slate-500">Logo grid data stored in event settings but edited as structured rows here.</p>
                          </div>
                          <HelpPopover label="Open note for Sponsors and Partners">
                            Sponsor cards should stay logo-first and clean. This is not a gallery treatment, so keep copy short and prefer contain-safe logos.
                          </HelpPopover>
                        </div>

                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {publicSponsorEntries.length > 0
                                  ? `${publicSponsorEntries.length} sponsor${publicSponsorEntries.length === 1 ? "" : "s"} ready`
                                  : "No sponsors added yet"}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                Leave tier blank for a simple logo grid. Use tier values when you want grouped sections such as main or partner.
                              </p>
                            </div>
                            <ActionButton
                              onClick={() =>
                                updatePublicSponsorEntries((entries) => [
                                  ...entries,
                                  { name: "", tier: "", logoUrl: "", linkUrl: "" },
                                ])}
                              tone="blue"
                              className="px-3 text-xs"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add Sponsor
                            </ActionButton>
                          </div>

                          {publicSponsorEntries.length > 0 ? (
                            <div className="space-y-3">
                              {publicSponsorEntries.map((entry, index) => (
                                <SponsorEditorRow
                                  key={`sponsor:${index}`}
                                  entry={entry}
                                  index={index}
                                  uploading={publicMediaUploadKey === `sponsor:${index}`}
                                  onChange={(field, value) =>
                                    updatePublicSponsorEntries((entries) =>
                                      entries.map((current, currentIndex) =>
                                        currentIndex === index ? { ...current, [field]: value } : current,
                                      ),
                                    )}
                                  onUploadFile={(file) =>
                                    void uploadPublicEventMediaForField({
                                      file,
                                      kind: "sponsor_logo",
                                      uploadKey: `sponsor:${index}`,
                                      applyUrl: (uploadedUrl) =>
                                        updatePublicSponsorEntries((entries) =>
                                          entries.map((current, currentIndex) =>
                                            currentIndex === index ? { ...current, logoUrl: uploadedUrl } : current,
                                          ),
                                        ),
                                    })}
                                  onRemove={() =>
                                    updatePublicSponsorEntries((entries) =>
                                      entries.filter((_, currentIndex) => currentIndex !== index),
                                    )}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                              Add sponsor rows to render a logo grid or tiered sponsor blocks on the public page.
                            </div>
                          )}
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
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Main Column Order</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {activeMainSectionLabels.map((label) => (
                                  <span
                                    key={label}
                                    className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600"
                                  >
                                    {label}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {publicBrandVisible && (
                              <div className="rounded-[1.5rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.08),_transparent_55%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.96))] px-4 py-4 shadow-sm">
                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-700">Sticky brand pane</p>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">
                                      {publicBrandMode === "full"
                                        ? publicBrandLabel
                                        : `Event page by ${publicBrandLabel}`}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {publicBrandMode === "full"
                                        ? "Persistent platform identity with optional utility links."
                                        : "Compact attribution that stays visible while attendees scroll."}
                                    </p>
                                  </div>
                                  <StatusBadge tone="blue">{publicBrandModeLabel}</StatusBadge>
                                </div>
                              </div>
                            )}

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

                              {organizerVisible && publicSectionEntries.some((section) => section.id === "organizer" && section.enabled) && (
                                <div className="mt-4 border-t border-slate-200 pt-3">
                                  <p className="text-sm font-semibold text-slate-900">Organizer Info</p>
                                  <p className="mt-1 text-xs leading-5 text-slate-500">
                                    {settings.event_public_organizer_name.trim() || "Organizer name"}
                                  </p>
                                  {(settings.event_public_organizer_description.trim() || settings.event_public_organizer_contact_text.trim()) && (
                                    <p className="mt-2 text-xs leading-5 text-slate-500">
                                      {settings.event_public_organizer_description.trim() || settings.event_public_organizer_contact_text.trim()}
                                    </p>
                                  )}
                                </div>
                              )}

                              {publicSectionEntries.some((section) => section.id === "countdown" && section.enabled) && (
                                <div className="mt-4 border-t border-slate-200 pt-3">
                                  <p className="text-sm font-semibold text-slate-900">Countdown</p>
                                  <p className="mt-1 text-xs leading-5 text-slate-500">
                                    Countdown to {timingInfo.startLabel} in {timingInfo.timeZone}
                                  </p>
                                </div>
                              )}

                              {publicSpeakerEntries.length > 0 && publicSectionEntries.some((section) => section.id === "speakers" && section.enabled) && (
                                <div className="mt-4 border-t border-slate-200 pt-3">
                                  <p className="text-sm font-semibold text-slate-900">Speakers</p>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {publicSpeakerEntries.map((entry, index) => (
                                      <span
                                        key={`${entry.name}:${entry.photoUrl}:${index}`}
                                        className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600"
                                      >
                                        {entry.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {publicSponsorEntries.length > 0 && publicSectionEntries.some((section) => section.id === "sponsors" && section.enabled) && (
                                <div className="mt-4 border-t border-slate-200 pt-3">
                                  <p className="text-sm font-semibold text-slate-900">Sponsors & Partners</p>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {publicSponsorEntries.map((entry, index) => (
                                      <span
                                        key={`${entry.name}:${entry.logoUrl}:${index}`}
                                        className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600"
                                      >
                                        {entry.name || `Sponsor ${index + 1}`}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {publicBrandVisible && (
                                <div className="mt-4 border-t border-slate-200 pt-3">
                                  <p className="text-sm font-semibold text-slate-900">Footer Branding</p>
                                  <p className="mt-1 text-xs leading-5 text-slate-500">
                                    {publicBrandMode === "full"
                                      ? `${publicBrandLabel} with footer utility links`
                                      : `Event page and registration by ${publicBrandLabel}`}
                                  </p>
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
