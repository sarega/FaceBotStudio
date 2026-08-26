import { motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  RefreshCw,
  Save,
  Send,
} from "lucide-react";

import { EmailHtmlEditor } from "../../../components/EmailHtmlEditor";
import {
  ActionButton,
  HelpPopover,
  StatusBadge,
  StatusLine,
  type BadgeTone,
} from "../../../components/shared/AppUi";
import {
  EMAIL_TEMPLATE_DEFAULTS,
  EMAIL_TEMPLATE_KIND_OPTIONS,
  type EmailTemplateKind,
} from "../../../lib/emailTemplateCatalog";
import type { AdminEmailStatusResponse, Settings } from "../../../types";

type EventEmailBroadcastPreview = {
  update_summary: string;
  subject: string;
  provider_ready: boolean;
  provider_error: string | null;
  total_registrations: number;
  active_registrations: number;
  cancelled_registrations: number;
  eligible_recipients: number;
  missing_email_registrations: number;
  duplicate_email_registrations: number;
  attachment: {
    format: string;
    one_per_recipient: boolean;
  };
};

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type EventMailScreenProps = {
  settings: Settings;
  apiFetch: ApiFetch;
  onSettingsChange: (nextSettings: Settings) => void;
  emailReadinessTone: BadgeTone;
  emailReadinessLabel: string;
  emailStatus: AdminEmailStatusResponse | null;
  emailStatusLoading: boolean;
  eventMailDirty: boolean;
  onSaveEventMailSettings: () => Promise<boolean>;
  saving: boolean;
  eventMessage: string;
  settingsMessage: string;
  onFetchEmailStatus: (eventId: string) => unknown;
  selectedEventId: string;
  emailTestAddress: string;
  onEmailTestAddressChange: (value: string) => void;
  onSendTestEmail: () => unknown;
  emailTestSending: boolean;
  emailTestMessage: string;
  emailTemplateDefinition: {
    label: string;
    description: string;
    supportedTokens: string[];
  };
  emailTemplateDirty: boolean;
  selectedEmailTemplateKind: EmailTemplateKind;
  onSelectedEmailTemplateKindChange: (kind: EmailTemplateKind) => void;
  isEmailTemplateKindDirty: (kind: EmailTemplateKind) => boolean;
  hasCustomEmailTemplateOverride: (settings: Settings, kind: EmailTemplateKind) => boolean;
  selectedEmailTemplateDirty: boolean;
  selectedEmailTemplateIsCustom: boolean;
  resetEmailTemplateToDefault: (settings: Settings, kind: EmailTemplateKind) => Settings;
  selectedEmailTemplateSubject: string;
  selectedEmailTemplateHtml: string;
  selectedEmailTemplateText: string;
  renderedEmailPreviewHtml: string;
  renderedEmailPreviewSubject: string;
  renderedEmailPreviewText: string;
  updateEmailTemplateValue: (
    settings: Settings,
    kind: EmailTemplateKind,
    field: "subject" | "html" | "text",
    value: string,
  ) => Settings;
};

export function EventMailScreen({
  settings,
  apiFetch,
  onSettingsChange,
  emailReadinessTone,
  emailReadinessLabel,
  emailStatus,
  emailStatusLoading,
  eventMailDirty,
  onSaveEventMailSettings,
  saving,
  eventMessage,
  settingsMessage,
  onFetchEmailStatus,
  selectedEventId,
  emailTestAddress,
  onEmailTestAddressChange,
  onSendTestEmail,
  emailTestSending,
  emailTestMessage,
  emailTemplateDefinition,
  emailTemplateDirty,
  selectedEmailTemplateKind,
  onSelectedEmailTemplateKindChange,
  isEmailTemplateKindDirty,
  hasCustomEmailTemplateOverride,
  selectedEmailTemplateDirty,
  selectedEmailTemplateIsCustom,
  resetEmailTemplateToDefault,
  selectedEmailTemplateSubject,
  selectedEmailTemplateHtml,
  selectedEmailTemplateText,
  renderedEmailPreviewHtml,
  renderedEmailPreviewSubject,
  renderedEmailPreviewText,
  updateEmailTemplateValue,
}: EventMailScreenProps) {
  const panelClass = "rounded-[1.5rem] border border-slate-200 bg-slate-50 p-3.5 sm:p-4";
  const insetCardClass = "rounded-xl border border-slate-200 bg-white px-3 py-3";
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastPreview, setBroadcastPreview] = useState<EventEmailBroadcastPreview | null>(null);
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState("");

  useEffect(() => {
    setBroadcastMessage("");
    setBroadcastPreview(null);
    setBroadcastResult("");
  }, [selectedEventId]);

  const ensureMailSettingsSaved = async () => {
    if (!eventMailDirty) return true;
    return onSaveEventMailSettings();
  };

  const readApiError = async (response: Response, fallback: string) => {
    const data = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok) {
      throw new Error(typeof data.error === "string" && data.error.trim() ? data.error : fallback);
    }
    return data;
  };

  const handleBroadcastPreview = async () => {
    const updateSummary = broadcastMessage.trim();
    if (!selectedEventId || !updateSummary) {
      setBroadcastResult("Enter an update message before previewing.");
      return;
    }

    setBroadcastBusy(true);
    setBroadcastResult("");
    try {
      const saved = await ensureMailSettingsSaved();
      if (!saved) {
        setBroadcastResult("Save Mail failed. Fix the settings and try again.");
        return;
      }
      const response = await apiFetch("/api/admin/email/broadcast/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: selectedEventId, update_summary: updateSummary }),
      });
      const data = await readApiError(response, "Failed to preview recipients.");
      setBroadcastPreview(data as EventEmailBroadcastPreview);
      setBroadcastResult("");
    } catch (error) {
      setBroadcastPreview(null);
      setBroadcastResult(error instanceof Error ? error.message : "Failed to preview recipients.");
    } finally {
      setBroadcastBusy(false);
    }
  };

  const handleBroadcastSend = async () => {
    const updateSummary = broadcastMessage.trim();
    if (!selectedEventId || !broadcastPreview || broadcastPreview.update_summary !== updateSummary) {
      setBroadcastResult("Preview the current update message before sending.");
      return;
    }
    if (eventMailDirty) {
      setBroadcastResult("Save Mail and preview recipients again before sending.");
      return;
    }
    if (!broadcastPreview.provider_ready) {
      setBroadcastResult(broadcastPreview.provider_error || "Email provider is not ready.");
      return;
    }
    if (broadcastPreview.eligible_recipients < 1) {
      setBroadcastResult("There are no eligible recipients to send to.");
      return;
    }
    if (!window.confirm(`Send this update to ${broadcastPreview.eligible_recipients} eligible registration(s), with one PNG ticket attached to each email?`)) {
      return;
    }

    setBroadcastBusy(true);
    setBroadcastResult("");
    try {
      const response = await apiFetch("/api/admin/email/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: selectedEventId,
          update_summary: updateSummary,
          confirm: true,
        }),
      });
      const data = await readApiError(response, "Failed to queue the email broadcast.");
      const queued = Number(data.queued || 0);
      const alreadyQueued = Number(data.already_queued || 0);
      const failed = Number(data.failed || 0);
      setBroadcastResult(`Queued ${queued} email(s) with PNG tickets${alreadyQueued ? `; ${alreadyQueued} already queued` : ""}${failed ? `; ${failed} failed to prepare` : ""}.`);
      setBroadcastPreview(null);
    } catch (error) {
      setBroadcastResult(error instanceof Error ? error.message : "Failed to queue the email broadcast.");
    } finally {
      setBroadcastBusy(false);
    }
  };

  return (
    <motion.div
      key="mail"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-3 sm:space-y-4"
    >
      <div className="rounded-[1.75rem] border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Send className="h-5 w-5 text-blue-600" />
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
                emailStatus?.provider ? `Provider ${emailStatus.provider}` : "Provider resend",
                eventMailDirty ? "Unsaved changes" : "All changes saved",
              ]}
            />
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            <ActionButton
              onClick={() => void onSaveEventMailSettings()}
              disabled={saving}
              tone="blue"
              active
              className="w-full text-sm sm:w-auto sm:shrink-0"
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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
      </div>

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(18rem,20rem)_minmax(0,1fr)] lg:gap-4">
        <div className="space-y-3">
          <div className={panelClass}>
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
                onClick={() => void onFetchEmailStatus(selectedEventId)}
                disabled={!selectedEventId || emailStatusLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${emailStatusLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            <label className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                checked={settings.confirmation_email_enabled === "1"}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    confirmation_email_enabled: event.target.checked ? "1" : "0",
                  })}
              />
              Enable registration confirmation email
            </label>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div className={insetCardClass}>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Sender</p>
                <p className="mt-1 break-all text-xs text-slate-700">{emailStatus?.fromAddress || "Not set"}</p>
              </div>
              <div className={insetCardClass}>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Reply-To</p>
                <p className="mt-1 break-all text-xs text-slate-700">{emailStatus?.replyToAddress || "Not set"}</p>
              </div>
              <div className={insetCardClass}>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Provider</p>
                <p className="mt-1 text-xs text-slate-700">{emailStatus?.provider || "resend"}</p>
              </div>
              <div className={insetCardClass}>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">App URL</p>
                <p className="mt-1 break-all text-xs text-slate-700">{emailStatus?.appUrl || "Not set"}</p>
              </div>
            </div>
            {emailStatus?.errorMessage && <p className="mt-3 text-xs text-rose-600">{emailStatus.errorMessage}</p>}
            {emailStatus?.missingFields?.length ? (
              <p className="mt-2 text-[11px] text-amber-700">
                Missing: {emailStatus.missingFields.join(", ")}
              </p>
            ) : null}
          </div>

          <div className={panelClass}>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">Send Test Email</p>
              <HelpPopover label="Open note for Send Test Email">
                Sends the currently selected mail type with the selected event&apos;s sample data and current sender configuration.
              </HelpPopover>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Destination</label>
                <input
                  type="email"
                  value={emailTestAddress}
                  onChange={(event) => onEmailTestAddressChange(event.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={() => void onSendTestEmail()}
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
                <p className="mt-1">{new Date(emailStatus.lastTestResult.attemptedAt).toLocaleString()}</p>
                {emailStatus.lastTestResult.error && (
                  <p className="mt-1 text-rose-600">{emailStatus.lastTestResult.error}</p>
                )}
              </div>
            )}
          </div>

          <div className={`${panelClass} border-blue-200 bg-blue-50/50`}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">Send Event Update</p>
              <StatusBadge tone="blue">PNG ticket attached</StatusBadge>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              Uses the saved Event Update template. Each active registration with a valid email receives a separate email with that registration&apos;s PNG ticket attached.
            </p>
            <label className="mt-4 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              Update message
            </label>
            <textarea
              value={broadcastMessage}
              onChange={(event) => {
                setBroadcastMessage(event.target.value);
                setBroadcastPreview(null);
                setBroadcastResult("");
              }}
              rows={6}
              placeholder="Write the event update to send to all eligible registrants..."
              className="mt-1 w-full rounded-[1.25rem] border border-blue-100 bg-white px-3 py-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleBroadcastPreview()}
                disabled={!selectedEventId || !broadcastMessage.trim() || broadcastBusy}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {broadcastBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Preview Recipients
              </button>
              <button
                type="button"
                onClick={() => void handleBroadcastSend()}
                disabled={
                  !selectedEventId
                  || !broadcastPreview
                  || broadcastPreview.update_summary !== broadcastMessage.trim()
                  || broadcastPreview.eligible_recipients < 1
                  || broadcastBusy
                  || eventMailDirty
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {broadcastBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send to Eligible Recipients
              </button>
            </div>
            {broadcastPreview && (
              <div className="mt-3 rounded-xl border border-blue-100 bg-white px-3 py-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Ready to send</p>
                <p className="mt-1">Subject: {broadcastPreview.subject}</p>
                <p className="mt-1">
                  {broadcastPreview.eligible_recipients} eligible · {broadcastPreview.active_registrations} active · {broadcastPreview.cancelled_registrations} cancelled · {broadcastPreview.missing_email_registrations} without valid email
                </p>
                <p className="mt-1">One {broadcastPreview.attachment.format.toUpperCase()} ticket attachment per email.</p>
                {!broadcastPreview.provider_ready && (
                  <p className="mt-1 text-rose-600">{broadcastPreview.provider_error || "Email provider is not ready."}</p>
                )}
              </div>
            )}
            {broadcastResult && (
              <p className={`mt-3 text-xs ${broadcastResult.toLowerCase().includes("failed") || broadcastResult.toLowerCase().includes("error") ? "text-rose-600" : "text-slate-600"}`}>
                {broadcastResult}
              </p>
            )}
          </div>

          <div className={panelClass}>
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
                    onClick={() => onSelectedEmailTemplateKindChange(option.kind)}
                    className={`flex w-full items-start gap-3 rounded-[1.25rem] border px-3 py-3 text-left transition ${
                      selected
                        ? "border-blue-200 bg-blue-50"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                        selected ? "bg-blue-500" : dirty ? "bg-amber-400" : "bg-slate-200"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`text-sm font-semibold ${selected ? "text-blue-700" : "text-slate-900"}`}>{option.label}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                            custom ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {custom ? "custom" : "default"}
                        </span>
                        {dirty && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                            edited
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">{emailTemplateDefinition.label} Template</p>
                  <HelpPopover label={`Open note for ${emailTemplateDefinition.label} template`}>
                    <p>{emailTemplateDefinition.description}</p>
                    <p className="mt-2 font-semibold text-slate-800">Supported tokens</p>
                    <p className="mt-1 break-words">
                      {emailTemplateDefinition.supportedTokens.map((token) => `{{${token}}}`).join(", ")}
                    </p>
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
                  onClick={() => onSettingsChange(resetEmailTemplateToDefault(settings, selectedEmailTemplateKind))}
                  disabled={!selectedEmailTemplateIsCustom}
                  tone="neutral"
                  className="w-full text-sm sm:w-auto"
                >
                  Reset to Default
                </ActionButton>
              </div>
            </div>
            <div className="mt-4 space-y-3 sm:space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Subject</label>
                <input
                  value={selectedEmailTemplateSubject}
                  onChange={(event) =>
                    onSettingsChange(
                      updateEmailTemplateValue(settings, selectedEmailTemplateKind, "subject", event.target.value),
                    )}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <EmailHtmlEditor
                value={selectedEmailTemplateHtml}
                renderedPreviewHtml={renderedEmailPreviewHtml}
                supportedTokens={emailTemplateDefinition.supportedTokens}
                onChange={(nextHtml) =>
                  onSettingsChange(
                    updateEmailTemplateValue(settings, selectedEmailTemplateKind, "html", nextHtml),
                  )}
              />
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Plain Text Body</label>
                <textarea
                  value={selectedEmailTemplateText}
                  onChange={(event) =>
                    onSettingsChange(
                      updateEmailTemplateValue(settings, selectedEmailTemplateKind, "text", event.target.value),
                    )}
                  rows={10}
                  className="w-full rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Rendered Subject</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{renderedEmailPreviewSubject}</p>
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Rendered Text Preview</p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-600">
              {renderedEmailPreviewText}
            </pre>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
