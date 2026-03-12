import type { RefObject } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Play,
  QrCode,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";

import { ActionButton, type BadgeTone, StatusBadge, StatusLine } from "../../../components/shared/AppUi";
import { LoadingScreen } from "../../../components/shared/LoadingScreen";
import type { CheckinAccessSession } from "../../../types";

type CheckinRegistration = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
};

type CheckinAccessRouteProps = {
  initializing: boolean;
  loading: boolean;
  session: CheckinAccessSession | null;
  errorMessage: string;
  eventStatusTone: BadgeTone;
  eventStatusLabel: string;
  canUseQrScanner: boolean;
  scannerActive: boolean;
  scannerStarting: boolean;
  scannerError: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  lastScannedValue: string;
  onStartScanner: () => void | Promise<void>;
  onStopScanner: () => void;
  searchId: string;
  onSearchIdChange: (value: string) => void;
  onCheckin: () => void | Promise<void>;
  checkinStatus: "idle" | "loading" | "success" | "error";
  checkinErrorMessage: string;
  latestResultLabel: string;
  latestCheckinRegistration: CheckinRegistration | null;
  latestResultToneClass: string;
};

export function CheckinAccessRoute({
  initializing,
  loading,
  session,
  errorMessage,
  eventStatusTone,
  eventStatusLabel,
  canUseQrScanner,
  scannerActive,
  scannerStarting,
  scannerError,
  videoRef,
  lastScannedValue,
  onStartScanner,
  onStopScanner,
  searchId,
  onSearchIdChange,
  onCheckin,
  checkinStatus,
  checkinErrorMessage,
  latestResultLabel,
  latestCheckinRegistration,
  latestResultToneClass,
}: CheckinAccessRouteProps) {
  if (initializing || loading) {
    return <LoadingScreen fullHeightClass="min-h-dvh" />;
  }

  if (!session) {
    return (
      <div className="min-h-dvh bg-slate-50 text-slate-900 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-sm space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Check-in link unavailable</h1>
            <p className="text-sm text-slate-500 mt-2">
              {errorMessage || "This check-in session is invalid, expired, or has already been revoked."}
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
                <h1 className="truncate text-lg font-bold">{session.event_name}</h1>
                <p className="truncate text-xs text-slate-500">
                  Check-in session: <span className="font-semibold text-slate-700">{session.label}</span>
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <StatusBadge tone={eventStatusTone}>
              {eventStatusLabel}
            </StatusBadge>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Expires</p>
              <p className="mt-1 text-xs font-semibold text-slate-900">{new Date(session.expires_at).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:gap-6 sm:py-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Event Status</p>
            <p className="mt-2 text-lg font-semibold text-blue-900 capitalize">{session.event_status}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Last Used</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {session.last_used_at ? new Date(session.last_used_at).toLocaleString() : "Not used yet"}
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
                onClick={() => void onStartScanner()}
                disabled={!canUseQrScanner || scannerActive || scannerStarting}
                tone="blue"
                active
                className="min-w-0 flex-1 text-sm sm:w-auto sm:flex-none"
              >
                {scannerStarting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start Camera
              </ActionButton>
              <ActionButton
                onClick={onStopScanner}
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
                onChange={(event) => onSearchIdChange(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void onCheckin()}
                placeholder="REG-XXXXXX"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-base font-mono outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <ActionButton
              onClick={() => void onCheckin()}
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
