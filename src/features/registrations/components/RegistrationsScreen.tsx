import type { ReactNode } from "react";
import {
  Activity,
  Download,
  ExternalLink,
  QrCode,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import {
  ActionButton,
  InlineActionsMenu,
  MenuActionItem,
  MenuActionLink,
  SelectionMarker,
  StatusBadge,
  StatusLine,
  type BadgeTone,
} from "../../../components/shared/AppUi";

type RegistrationStatus = "registered" | "cancelled" | "checked-in";

type RegistrationRecord = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  timestamp: string;
  status: string;
};

type RegistrationAvailabilitySummary = {
  label: string;
  helper: string;
  tone: BadgeTone;
};

type RegistrationCapacitySummary = {
  limit: number | null;
  remaining: number;
  fillPercent: number;
  isFull: boolean;
};

type RegistrationsScreenProps = {
  filteredRegistrations: RegistrationRecord[];
  registrationAvailability: RegistrationAvailabilitySummary;
  registrationCapacity: RegistrationCapacitySummary;
  activeAttendeeCount: number;
  selectedEventId: string;
  registrationListQuery: string;
  onRegistrationListQueryChange: (value: string) => void;
  deferredRegistrationListQuery: string;
  visibleRegistrations: RegistrationRecord[];
  selectedRegistrationId: string;
  onSelectRegistration: (registrationId: string) => void;
  getSearchTargetDomId: (kind: "registration", id: string) => string;
  isSearchFocused: (kind: "registration", id: string) => boolean;
  getRegistrationStatusTone: (status: string) => BadgeTone;
  hasMoreRegistrations: boolean;
  onLoadMoreRegistrations: () => void;
  registrationsCount: number;
  registeredCount: number;
  checkedInCount: number;
  cancelledCount: number;
  checkInRate: number;
  selectedRegistration: RegistrationRecord | null;
  selectedTicketPreview: ReactNode;
  selectedTicketPngUrl: string;
  selectedTicketSvgUrl: string;
  canChangeRegistrationStatus: boolean;
  onDeleteRegistration: (registrationId: string) => unknown;
  deleteRegistrationLoading: boolean;
  onUpdateRegistrationStatus: (registrationId: string, status: RegistrationStatus) => unknown;
  statusUpdateLoading: boolean;
  statusUpdateMessage: string;
};

export function RegistrationsScreen({
  filteredRegistrations,
  registrationAvailability,
  registrationCapacity,
  activeAttendeeCount,
  selectedEventId,
  registrationListQuery,
  onRegistrationListQueryChange,
  deferredRegistrationListQuery,
  visibleRegistrations,
  selectedRegistrationId,
  onSelectRegistration,
  getSearchTargetDomId,
  isSearchFocused,
  getRegistrationStatusTone,
  hasMoreRegistrations,
  onLoadMoreRegistrations,
  registrationsCount,
  registeredCount,
  checkedInCount,
  cancelledCount,
  checkInRate,
  selectedRegistration,
  selectedTicketPreview,
  selectedTicketPngUrl,
  selectedTicketSvgUrl,
  canChangeRegistrationStatus,
  onDeleteRegistration,
  deleteRegistrationLoading,
  onUpdateRegistrationStatus,
  statusUpdateLoading,
  statusUpdateMessage,
}: RegistrationsScreenProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,23rem)]">
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Registered Attendees</h2>
              <StatusLine
                className="mt-0.5"
                items={[
                  `${filteredRegistrations.length} results`,
                  registrationAvailability.label,
                ]}
              />
              <p className="text-xs text-slate-500">
                {registrationCapacity.limit === null
                  ? `${activeAttendeeCount} active attendees. Search fast, then progressively load more rows when this event gets large.`
                  : registrationCapacity.remaining === 0
                  ? `Capacity is full. ${activeAttendeeCount} of ${registrationCapacity.limit} seats are occupied, so new registrations are blocked.`
                  : `${activeAttendeeCount} of ${registrationCapacity.limit} seats filled. ${registrationCapacity.remaining} seats remaining before registration closes for capacity.`}
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
          <div className="border-b border-slate-100 px-3 py-2.5 sm:px-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={registrationListQuery}
                onChange={(event) => onRegistrationListQueryChange(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search by name, registration ID, phone, or email"
              />
              {registrationListQuery && (
                <button
                  onClick={() => onRegistrationListQueryChange("")}
                  className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                  aria-label="Clear registration search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto p-3 md:hidden">
            {filteredRegistrations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                {deferredRegistrationListQuery ? "No attendees match this search." : "No registrations yet."}
              </div>
            ) : (
              visibleRegistrations.map((registration) => (
                <button
                  key={registration.id}
                  id={getSearchTargetDomId("registration", registration.id)}
                  onClick={() => onSelectRegistration(registration.id)}
                  className={`w-full rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                    selectedRegistrationId === registration.id
                      ? "border-blue-200 bg-blue-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  } ${isSearchFocused("registration", registration.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{registration.first_name} {registration.last_name}</p>
                      <p className="mt-0.5 font-mono text-[11px] font-bold text-blue-600">{registration.id}</p>
                      <p className="mt-0.5 truncate text-[10px] text-slate-500">
                        {registration.phone || registration.email || "No contact info"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <StatusBadge tone={getRegistrationStatusTone(registration.status)}>{registration.status}</StatusBadge>
                      {selectedRegistrationId === registration.id && <SelectionMarker />}
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">{new Date(registration.timestamp).toLocaleString()}</p>
                </button>
              ))
            )}
          </div>
          <div className="hidden max-h-[38rem] overflow-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                  <th className="px-4 py-2.5">ID</th>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRegistrations.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-400 italic">
                      {deferredRegistrationListQuery ? "No attendees match this search." : "No registrations yet."}
                    </td>
                  </tr>
                ) : (
                  visibleRegistrations.map((registration) => (
                    <tr
                      key={registration.id}
                      id={getSearchTargetDomId("registration", registration.id)}
                      onClick={() => onSelectRegistration(registration.id)}
                      className={`registration-row hover:bg-slate-50 transition-colors cursor-pointer ${
                        selectedRegistrationId === registration.id ? "registration-row-selected bg-blue-50" : ""
                      } ${
                        isSearchFocused("registration", registration.id) ? "bg-blue-50" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 font-mono text-[11px] font-bold text-blue-600">
                        {registration.id}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-medium">{registration.first_name} {registration.last_name}</p>
                        <p className="text-[10px] text-slate-400">{new Date(registration.timestamp).toLocaleString()}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-[11px]">{registration.phone}</p>
                        <p className="text-[10px] text-slate-400">{registration.email}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge tone={getRegistrationStatusTone(registration.status)}>
                          {registration.status}
                        </StatusBadge>
                        {selectedRegistrationId === registration.id && (
                          <p className="mt-1 text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Selected</p>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-2.5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <p>
              Showing {visibleRegistrations.length} of {filteredRegistrations.length} attendees
            </p>
            {hasMoreRegistrations && (
              <ActionButton
                onClick={onLoadMoreRegistrations}
                tone="neutral"
                className="w-full text-sm sm:w-auto"
              >
                Load 120 More
              </ActionButton>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" />
                Event Stats
              </h3>
              <p className="hidden text-xs text-slate-500 sm:block">Glanceable live totals for this event.</p>
            </div>
            <StatusBadge tone={registrationAvailability.tone}>{registrationAvailability.label}</StatusBadge>
          </div>
          <div className="space-y-2.5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Seat Capacity</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {registrationCapacity.limit === null ? activeAttendeeCount : `${activeAttendeeCount}/${registrationCapacity.limit}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {registrationCapacity.limit === null
                      ? "No hard capacity limit is configured for this event."
                      : registrationCapacity.remaining === 0
                      ? "No seats remaining. Registration now stops at capacity."
                      : `${registrationCapacity.remaining} seats remain before registration auto-closes for capacity.`}
                  </p>
                </div>
                {registrationCapacity.limit !== null && (
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Filled</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{registrationCapacity.fillPercent}%</p>
                  </div>
                )}
              </div>
              {registrationCapacity.limit !== null && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      registrationCapacity.isFull ? "bg-rose-500" : "bg-blue-600"
                    }`}
                    style={{ width: `${registrationCapacity.fillPercent}%` }}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Total</p>
                <p className="mt-1 text-base font-bold text-slate-900">{registrationsCount}</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">Registered</p>
                <p className="mt-1 text-base font-bold text-blue-700">{registeredCount}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-600">Checked</p>
                <p className="mt-1 text-base font-bold text-emerald-700">{checkedInCount}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Cancelled</p>
                <p className="mt-1 text-base font-bold text-slate-700">{cancelledCount}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Check-in Rate</p>
                <p className="mt-1 text-xs text-slate-500">{registrationAvailability.helper}</p>
              </div>
              <p className="text-lg font-bold text-violet-700">{checkInRate}%</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold">Selected Ticket</h3>
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
            <div className="space-y-3">
              <div className="max-h-[23rem] overflow-auto rounded-2xl bg-slate-50 p-1.5">
                {selectedTicketPreview}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <a
                  href={selectedTicketPngUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-blue-600 bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)] transition-colors sm:flex-none"
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
                      onClick={() => void onDeleteRegistration(selectedRegistration.id)}
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
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Admin Status Override</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(["registered", "checked-in", "cancelled"] as RegistrationStatus[]).map((statusOption) => {
                      const active = selectedRegistration.status === statusOption;
                      return (
                        <ActionButton
                          key={statusOption}
                          onClick={() => void onUpdateRegistrationStatus(selectedRegistration.id, statusOption)}
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
  );
}
