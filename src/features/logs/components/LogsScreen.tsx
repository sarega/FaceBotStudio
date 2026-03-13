import type { ReactNode } from "react";
import {
  Download,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import {
  HelpPopover,
  SelectionMarker,
  StatusBadge,
  StatusLine,
  type BadgeTone,
} from "../../../components/shared/AppUi";
import type { EventRecord, Message } from "../../../types";

type LineTrace = {
  status: string;
  detail?: string | null;
};

type AuditMarker = {
  marker: string;
  actor: string;
  label: string;
  summary: string;
  detail: string;
};

type LogDirectionMeta = {
  label: string;
  className: string;
  icon: ReactNode;
};

type LogsScreenProps = {
  selectedEvent: EventRecord | null;
  getEventStatusTone: (status: EventRecord["effective_status"]) => BadgeTone;
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  messages: Message[];
  logsHasMore: boolean;
  deferredLogListQuery: string;
  filteredMessages: Message[];
  eventOperatorGuardBody: ReactNode;
  onLoadOlderLogs: () => unknown;
  logsLoadingMore: boolean;
  onRefreshMessages: () => unknown;
  logListQuery: string;
  onLogListQueryChange: (value: string) => void;
  getRegistrationAvailabilityLabel: (status: EventRecord["registration_availability"]) => string;
  parseLineTraceMessage: (text: string) => LineTrace | null;
  parseInternalLogMarker: (text: string) => AuditMarker | null;
  getLogDirectionMeta: (type: Message["type"]) => LogDirectionMeta;
  formatTraceStatusLabel: (status: string) => string;
  getLogMessageDisplayText: (message: Message) => string;
  selectedLogMessageId: number | undefined;
  onSelectLogMessage: (messageId: number | undefined) => void;
  getSearchTargetDomId: (kind: "log", id: string) => string;
  isSearchFocused: (kind: "log", id: string) => boolean;
  logInspectorPanel: ReactNode;
};

export function LogsScreen({
  selectedEvent,
  getEventStatusTone,
  getEventStatusLabel,
  messages,
  logsHasMore,
  deferredLogListQuery,
  filteredMessages,
  eventOperatorGuardBody,
  onLoadOlderLogs,
  logsLoadingMore,
  onRefreshMessages,
  logListQuery,
  onLogListQueryChange,
  getRegistrationAvailabilityLabel,
  parseLineTraceMessage,
  parseInternalLogMarker,
  getLogDirectionMeta,
  formatTraceStatusLabel,
  getLogMessageDisplayText,
  selectedLogMessageId,
  onSelectLogMessage,
  getSearchTargetDomId,
  isSearchFocused,
  logInspectorPanel,
}: LogsScreenProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Live Webhook Logs</h2>
              {selectedEvent && (
                <StatusBadge tone={getEventStatusTone(selectedEvent.effective_status)}>
                  {getEventStatusLabel(selectedEvent.effective_status)}
                </StatusBadge>
              )}
            </div>
            <StatusLine
              className="mt-1"
              items={[
                `${messages.length}${logsHasMore ? "+" : ""} items`,
                deferredLogListQuery ? `${filteredMessages.length} match` : null,
                logsHasMore ? "older logs available" : null,
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedEvent && (
              <HelpPopover label="Open reply guard details">
                {eventOperatorGuardBody}
              </HelpPopover>
            )}
            <button
              onClick={() => void onLoadOlderLogs()}
              disabled={!logsHasMore || logsLoadingMore || messages.length === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {logsLoadingMore ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Older
            </button>
            <button onClick={() => void onRefreshMessages()} className="rounded-lg p-2 transition-colors hover:bg-slate-100">
              <RefreshCw className="h-4 w-4 text-slate-400" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={logListQuery}
              onChange={(event) => onLogListQueryChange(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-xs outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search logs by sender, message, type, or trace detail"
            />
            {logListQuery && (
              <button
                onClick={() => onLogListQueryChange("")}
                className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                aria-label="Clear log search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            {selectedEvent?.registration_availability && selectedEvent.registration_availability !== "open" && (
              <span>Registration {getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}</span>
            )}
            <span>full message opens on the right</span>
          </div>
        </div>
      </div>

      <div className="space-y-2 p-3 md:hidden">
        {filteredMessages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            {deferredLogListQuery ? "No logs match this search." : "No messages received yet."}
          </div>
        ) : (
          filteredMessages.map((message) => {
            const lineTrace = parseLineTraceMessage(message.text);
            const auditMarker = lineTrace ? null : parseInternalLogMarker(message.text);
            const selected = selectedLogMessageId === message.id;
            const directionMeta = getLogDirectionMeta(message.type);
            return (
              <div key={message.id} id={getSearchTargetDomId("log", String(message.id))}>
                <button
                  onClick={() => onSelectLogMessage(message.id)}
                  className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? "border-blue-200 bg-blue-50"
                      : isSearchFocused("log", String(message.id))
                      ? "bg-blue-50"
                      : "hover:bg-slate-50"
                  } ${isSearchFocused("log", String(message.id)) ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${directionMeta.className}`}>
                      {directionMeta.icon}
                      {directionMeta.label}
                    </span>
                    {message.platform && <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{message.platform}</span>}
                    {lineTrace && (
                      <span className="text-[11px] text-amber-700">
                        Trace {formatTraceStatusLabel(lineTrace.status)}
                      </span>
                    )}
                    {auditMarker && (
                      <span className="text-[11px] text-slate-600">
                        {auditMarker.actor} · {auditMarker.label}
                      </span>
                    )}
                    {selected && <SelectionMarker />}
                  </div>
                  <div className="mt-1.5 flex items-start justify-between gap-2">
                    <p className="chat-selectable log-list-preview-2 min-w-0 text-sm leading-5 text-slate-700">
                      {getLogMessageDisplayText(message)}
                    </p>
                    <p className="shrink-0 text-[10px] text-slate-500">
                      {new Date(message.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <p className="mt-1 truncate font-mono text-[10px] text-blue-600">{message.sender_id}</p>
                  {(message.sender_name || message.registration_id) && (
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">
                      {message.sender_name || "-"}{message.registration_id ? ` • ${message.registration_id}` : ""}
                    </p>
                  )}
                </button>
                {selected && (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] text-slate-600">
                      {directionMeta.label} via {message.platform || "unknown"} · {new Date(message.timestamp).toLocaleString()}
                    </p>
                    <p className="chat-selectable mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                      {lineTrace
                        ? lineTrace.detail || formatTraceStatusLabel(lineTrace.status)
                        : auditMarker
                        ? auditMarker.marker === "manual-reply"
                          ? auditMarker.detail
                          : auditMarker.summary
                        : message.text}
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="hidden overflow-x-auto md:block xl:hidden">
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
              filteredMessages.map((message) => {
                const lineTrace = parseLineTraceMessage(message.text);
                const auditMarker = lineTrace ? null : parseInternalLogMarker(message.text);
                const directionMeta = getLogDirectionMeta(message.type);
                return (
                  <tr
                    key={message.id}
                    id={getSearchTargetDomId("log", String(message.id))}
                    onClick={() => onSelectLogMessage(message.id)}
                    className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                      isSearchFocused("log", String(message.id)) ? "bg-blue-50" : ""
                    }`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                      {new Date(message.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-mono text-xs text-blue-600">{message.sender_id}</p>
                      {(message.sender_name || message.registration_id) && (
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {message.sender_name || "-"}{message.registration_id ? ` • ${message.registration_id}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 max-w-md">
                      {lineTrace ? (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">LINE</span>
                            <span className="text-[11px] text-amber-700">Delivery Trace</span>
                            <span className="text-[11px] font-semibold text-slate-600">
                              {formatTraceStatusLabel(lineTrace.status)}
                            </span>
                          </div>
                          <p className="chat-selectable text-sm text-slate-700 break-words">
                            {lineTrace.detail || "-"}
                          </p>
                        </div>
                      ) : auditMarker ? (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-semibold text-slate-600">{auditMarker.actor}</span>
                            <span className="text-[11px] text-slate-500">{auditMarker.label}</span>
                          </div>
                          <p className="chat-selectable text-sm text-slate-700 break-words">
                            {auditMarker.marker === "manual-reply" ? auditMarker.detail : auditMarker.summary}
                          </p>
                        </div>
                      ) : (
                        <span className="chat-selectable truncate block">{message.text}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={`inline-flex items-center gap-1 font-semibold ${directionMeta.className}`}>
                          {directionMeta.icon}
                          {directionMeta.label}
                        </span>
                        {message.platform && <span className="font-medium uppercase tracking-[0.08em] text-slate-500">{message.platform}</span>}
                        {lineTrace && <span className="text-amber-700">Trace</span>}
                        {auditMarker && <span className="text-slate-600">{auditMarker.label}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="hidden border-t border-slate-100 bg-slate-50 md:block xl:hidden">
        {logInspectorPanel}
      </div>
      <div className="hidden xl:grid xl:min-h-[34rem] xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <div className="min-w-0 border-r border-slate-100">
          {filteredMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 py-16 text-center text-sm text-slate-400">
              {deferredLogListQuery ? "No logs match this search." : "No messages received yet."}
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto">
              {filteredMessages.map((message) => {
                const lineTrace = parseLineTraceMessage(message.text);
                const auditMarker = lineTrace ? null : parseInternalLogMarker(message.text);
                const selected = selectedLogMessageId === message.id;
                const directionMeta = getLogDirectionMeta(message.type);
                return (
                  <button
                    key={message.id}
                    id={getSearchTargetDomId("log", String(message.id))}
                    onClick={() => onSelectLogMessage(message.id)}
                    className={`grid min-h-[5.1rem] w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 overflow-hidden border-b border-slate-100 px-4 py-2.5 text-left transition-colors ${
                      selected
                        ? "bg-blue-50"
                        : isSearchFocused("log", String(message.id))
                        ? "bg-blue-50"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${directionMeta.className}`}>
                          {directionMeta.icon}
                          {directionMeta.label}
                        </span>
                        {message.platform && <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">{message.platform}</span>}
                        {lineTrace && <span className="text-[10px] text-amber-700">Trace</span>}
                        {auditMarker && <span className="text-[10px] text-slate-600">{auditMarker.actor}</span>}
                        <p className="min-w-0 truncate text-[10px] font-mono text-blue-600">{message.sender_id}</p>
                      </div>
                      {(message.sender_name || message.registration_id) && (
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">
                          {message.sender_name || "-"}{message.registration_id ? ` • ${message.registration_id}` : ""}
                        </p>
                      )}
                      <p className="chat-selectable log-list-preview-2 mt-1 text-[13px] leading-5 text-slate-700">
                        {getLogMessageDisplayText(message)}
                      </p>
                    </div>
                    <p className="shrink-0 whitespace-nowrap pl-2 text-[10px] text-slate-500">
                      {new Date(message.timestamp).toLocaleString()}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="log-inspector-surface min-w-0">
          {logInspectorPanel}
        </div>
      </div>
    </div>
  );
}
