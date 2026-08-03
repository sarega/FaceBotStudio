import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Link2,
  Play,
  QrCode,
  RefreshCw,
  Search,
  Shield,
  Square,
  Trash2,
} from "lucide-react";

import {
  ActionButton,
  CompactStatRow,
  CopyField,
  InlineActionsMenu,
  MenuActionItem,
  PageBanner,
  StatusBadge,
  StatusLine,
  type BadgeTone,
  type BannerTone,
} from "../../../components/shared/AppUi";
import { translate, type AppLanguage } from "../../../lib/i18n";
import type { CheckinSessionRecord, EventRecord } from "../../../types";

type RegistrationRecord = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  timestamp: string;
  status: string;
  direct_ticket?: {
    ticket_class: string;
    performance: string;
    seat: string;
  };
};

type CheckinScreenProps = {
  language: AppLanguage;
  selectedEvent: EventRecord | null;
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  getRegistrationAvailabilityLabel: (status: EventRecord["registration_availability"]) => string;
  checkinOperatorGuardTone: BannerTone;
  registeredCount: number;
  cancelledCount: number;
  checkedInCount: number;
  checkInRate: number;
  canUseQrScanner: boolean;
  scannerActive: boolean;
  scannerStarting: boolean;
  startQrScanner: () => unknown;
  stopQrScanner: () => unknown;
  videoRef: RefObject<HTMLVideoElement | null>;
  lastScannedValue: string;
  scannerError: string;
  searchId: string;
  onSearchIdChange: (value: string) => void;
  onSearchIdKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onManualCheckin: () => unknown;
  checkinStatus: "idle" | "loading" | "success" | "error";
  checkinErrorMessage: string;
  latestResultLabel: string;
  latestCheckinRegistration: RegistrationRecord | null;
  latestResultToneClass: string;
  checkinAccessMode: boolean;
  onOpenRegistrations: () => unknown;
  canManageCheckinAccess: boolean;
  checkinSessionLabel: string;
  onCheckinSessionLabelChange: (value: string) => void;
  checkinSessionHours: string;
  onCheckinSessionHoursChange: (value: string) => void;
  onCreateCheckinSession: () => unknown;
  checkinSessionCreating: boolean;
  selectedEventId: string;
  selectedEventCheckinLocked: boolean;
  checkinSessionMessage: string;
  checkinSessionReveal: { token: string; url: string; id: string } | null;
  onCopyCheckinSessionUrl: () => unknown;
  copied: boolean;
  checkinSessions: CheckinSessionRecord[];
  onRefreshCheckinSessions: () => unknown;
  checkinSessionsLoading: boolean;
  getCheckinSessionTone: (session: CheckinSessionRecord) => BadgeTone;
  onRevokeCheckinSession: (sessionId: string) => unknown;
  checkinSessionRevokingId: string;
};

export function CheckinScreen({
  language,
  selectedEvent,
  getEventStatusLabel,
  getRegistrationAvailabilityLabel,
  checkinOperatorGuardTone,
  registeredCount,
  cancelledCount,
  checkedInCount,
  checkInRate,
  canUseQrScanner,
  scannerActive,
  scannerStarting,
  startQrScanner,
  stopQrScanner,
  videoRef,
  lastScannedValue,
  scannerError,
  searchId,
  onSearchIdChange,
  onSearchIdKeyDown,
  onManualCheckin,
  checkinStatus,
  checkinErrorMessage,
  latestResultLabel,
  latestCheckinRegistration,
  latestResultToneClass,
  checkinAccessMode,
  onOpenRegistrations,
  canManageCheckinAccess,
  checkinSessionLabel,
  onCheckinSessionLabelChange,
  checkinSessionHours,
  onCheckinSessionHoursChange,
  onCreateCheckinSession,
  checkinSessionCreating,
  selectedEventId,
  selectedEventCheckinLocked,
  checkinSessionMessage,
  checkinSessionReveal,
  onCopyCheckinSessionUrl,
  copied,
  checkinSessions,
  onRefreshCheckinSessions,
  checkinSessionsLoading,
  getCheckinSessionTone,
  onRevokeCheckinSession,
  checkinSessionRevokingId,
}: CheckinScreenProps) {
  const t = (key: string, fallback: string) => translate(language, `checkin.${key}`, fallback);
  const formatDate = (value: string) => new Date(value).toLocaleString(language === "th" ? "th-TH" : undefined);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <QrCode className="w-5 h-5 text-blue-600" />
                {t("mode", "Check-in Mode")}
              </h2>
              <p className="text-sm text-slate-500">
                {t("modeHint", "Mobile-first check-in flow for staff at the door. Use manual ID entry or scan a QR code.")}
              </p>
            </div>
          </div>

          <div className="mb-4">
            <PageBanner tone={checkinOperatorGuardTone} icon={<QrCode className="h-4 w-4" />}>
              {t("doorModeActive", "Door mode active")} · {selectedEvent ? getEventStatusLabel(selectedEvent.effective_status) : t("noEventSelected", "No event selected")}
              {selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open"
                ? ` · ${getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}`
                : ""}
              {selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open"
                ? ` · ${t("existingAttendeesCanCheckIn", "Existing attendees can still check in")}`
                : ""}
            </PageBanner>
          </div>

          <CompactStatRow
            stats={[
              { label: t("registered", "Registered"), value: registeredCount, tone: "blue" },
              { label: t("cancelled", "Cancelled"), value: cancelledCount, tone: "neutral" },
              { label: t("checkedIn", "Checked in"), value: checkedInCount, tone: "emerald" },
              { label: t("checkInRate", "Check-in rate"), value: `${checkInRate}%`, tone: "neutral" },
            ]}
          />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Camera className="w-5 h-5 text-blue-600" />
                {t("qrScanner", "QR Scanner")}
              </h3>
              <p className="text-sm text-slate-500">
                {t("qrScannerHint", "Open the camera and scan attendee QR codes continuously.")}
              </p>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
              <ActionButton
                onClick={() => void startQrScanner()}
                disabled={!canUseQrScanner || scannerActive || scannerStarting}
                tone="blue"
                active
                className="w-full text-sm"
              >
                {scannerStarting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {t("startCamera", "Start Camera")}
              </ActionButton>
              <ActionButton
                onClick={() => void stopQrScanner()}
                disabled={!scannerActive && !scannerStarting}
                tone="neutral"
                className="w-full text-sm"
              >
                <Square className="w-4 h-4" />
                {t("stop", "Stop")}
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
                      ? t("cameraPermissionHint", "Tap Start Camera to request permission and begin scanning.")
                      : t("cameraUnsupported", "This browser does not support camera access. Use manual check-in instead.")}
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
              {t("lastScan", "Last scan")}: <span className="font-mono">{lastScannedValue}</span>
            </p>
          )}
          {scannerError && <p className="mt-2 text-xs text-rose-600">{scannerError}</p>}
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-600" />
            {t("manualCheckin", "Manual Check-in")}
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            {t("manualCheckinHint", "Enter the registration ID manually if the QR code cannot be scanned.")}
          </p>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchId}
                onChange={(event) => onSearchIdChange(event.target.value.toUpperCase())}
                onKeyDown={onSearchIdKeyDown}
                placeholder="REG-XXXXXX"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-base font-mono outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <ActionButton
              onClick={() => void onManualCheckin()}
              disabled={!searchId || checkinStatus === "loading"}
              tone={checkinStatus === "success" ? "emerald" : checkinStatus === "error" ? "rose" : "blue"}
              active
              className="w-full text-sm"
            >
              {checkinStatus === "loading" && <RefreshCw className="w-4 h-4 animate-spin" />}
              {checkinStatus === "success" && <CheckCircle2 className="w-4 h-4" />}
              {checkinStatus === "error" && <AlertCircle className="w-4 h-4" />}
              {checkinStatus === "success" ? t("checkedInBang", "Checked In!") : checkinStatus === "error" ? t("checkinFailed", "Check-in Failed") : t("checkInAttendee", "Check In Attendee")}
            </ActionButton>
            {checkinStatus === "error" && checkinErrorMessage && (
              <p className="text-xs text-rose-600">{checkinErrorMessage}</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-lg font-semibold">{t("latestResult", "Latest Result")}</h3>
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
              {t("noAttendeeCheckedIn", "No attendee checked in yet in this session.")}
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
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{latestCheckinRegistration.direct_ticket ? t("ticketPerformance", "Ticket / Performance") : t("phone", "Phone")}</p>
                  <p className="text-slate-700">{latestCheckinRegistration.direct_ticket ? `${latestCheckinRegistration.direct_ticket.ticket_class} · ${latestCheckinRegistration.direct_ticket.performance}` : latestCheckinRegistration.phone || "-"}</p>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{latestCheckinRegistration.direct_ticket ? t("seat", "Seat") : t("email", "Email")}</p>
                  <p className="text-slate-700 break-all">{latestCheckinRegistration.direct_ticket?.seat || latestCheckinRegistration.email || "-"}</p>
                </div>
              </div>
              {!checkinAccessMode && !latestCheckinRegistration.direct_ticket && (
                <ActionButton
                  onClick={() => void onOpenRegistrations()}
                  tone="neutral"
                  className="w-full text-sm"
                >
                  {t("openRegistration", "Open Full Registration Record")}
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
                {t("checkinAccess", "Check-in Access")}
              </h3>
              <p className="text-sm text-slate-500">
                {t("checkinAccessHint", "Generate a mobile-friendly check-in link for staff without giving them full admin access.")}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{t("sessionLabel", "Session Label")}</label>
                <input
                  type="text"
                  value={checkinSessionLabel}
                  onChange={(event) => onCheckinSessionLabelChange(event.target.value)}
                  placeholder="Front Desk A"
                  className="w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{t("hours", "Hours")}</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={checkinSessionHours}
                  onChange={(event) => onCheckinSessionHoursChange(event.target.value)}
                  className="w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <ActionButton
              onClick={() => void onCreateCheckinSession()}
              disabled={checkinSessionCreating || !selectedEventId || selectedEventCheckinLocked}
              tone="blue"
              active
              className="w-full text-sm sm:w-auto"
            >
              {checkinSessionCreating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {t("generateLink", "Generate Check-in Link")}
            </ActionButton>

            {checkinSessionMessage && (
              <p className={`text-xs ${checkinSessionMessage.toLowerCase().includes("failed") || checkinSessionMessage.toLowerCase().includes("required") ? "text-rose-600" : "text-emerald-600"}`}>
                {checkinSessionMessage}
              </p>
            )}

            {checkinSessionReveal && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-blue-700">{t("newLink", "New check-in link")}</p>
                <CopyField
                  label={t("accessUrl", "Access URL")}
                  value={checkinSessionReveal.url}
                  onCopy={() => void onCopyCheckinSessionUrl()}
                  copied={copied}
                  help={t("accessUrlHint", "The raw token is shown once. Share this URL only with staff who need scanner-only access.")}
                />
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("activeRecentLinks", "Active and recent check-in links")}</p>
                <button
                  onClick={() => void onRefreshCheckinSessions()}
                  className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <RefreshCw aria-label={t("refreshSessions", "Refresh check-in links")} className={`w-4 h-4 text-slate-400 ${checkinSessionsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              {checkinSessions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                  {t("noLinks", "No check-in links created for this event yet.")}
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
                            {session.revoked_at ? t("revoked", "revoked") : session.is_active ? t("active", "active") : t("expired", "expired")}
                          </StatusBadge>
                          {!session.revoked_at && (
                            <InlineActionsMenu label={t("manageAccess", "Manage Access")} tone="neutral">
                              <MenuActionItem
                                onClick={() => void onRevokeCheckinSession(session.id)}
                                disabled={checkinSessionRevokingId === session.id}
                                tone="rose"
                              >
                                {checkinSessionRevokingId === session.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                <span className="font-medium">{t("revokeLink", "Revoke Link")}</span>
                              </MenuActionItem>
                            </InlineActionsMenu>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{t("expires", "Expires")}</p>
                          <p className="mt-1 text-[11px] text-slate-700">{formatDate(session.expires_at)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{t("lastUsed", "Last Used")}</p>
                          <p className="mt-1 text-[11px] text-slate-700">{session.last_used_at ? formatDate(session.last_used_at) : t("never", "never")}</p>
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
  );
}
