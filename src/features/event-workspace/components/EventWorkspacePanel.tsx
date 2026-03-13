import { CalendarRange, ChevronDown, Plus, RefreshCw, Search, X } from "lucide-react";

import { ActionButton, SelectionMarker, StatusBadge, StatusLine, type BadgeTone } from "../../../components/shared/AppUi";
import type { EventRecord, EventStatus } from "../../../types";

type EventWorkspaceSort = "event_start_desc" | "name_asc" | "modified_desc";
type EventWorkspaceFilter = "all" | EventStatus;

type EventWorkspaceCounts = {
  all: number;
  active: number;
  pending: number;
  inactive: number;
  closed: number;
  cancelled: number;
  archived: number;
};

type EventWorkspaceFilterOption = {
  id: EventWorkspaceFilter;
  label: string;
  count: number;
};

type HistoryEventGroup = {
  key: string;
  label: string;
  events: EventRecord[];
};

type EventWorkspacePanelProps = {
  collapsed: boolean;
  eventCreateOpen: boolean;
  onToggleEventCreate: () => void;
  onRefresh: () => unknown;
  eventLoading: boolean;
  newEventName: string;
  onNewEventNameChange: (value: string) => void;
  onCreateEvent: () => unknown;
  eventListQuery: string;
  onEventListQueryChange: (value: string) => void;
  eventWorkspaceSort: EventWorkspaceSort;
  onEventWorkspaceSortChange: (value: EventWorkspaceSort) => void;
  eventWorkspaceFilterOptions: EventWorkspaceFilterOption[];
  eventWorkspaceFilter: EventWorkspaceFilter;
  onEventWorkspaceFilterChange: (value: EventWorkspaceFilter) => void;
  filteredEventWorkspaceEvents: EventRecord[];
  eventWorkspaceCounts: EventWorkspaceCounts;
  deferredEventListQuery: string;
  filteredWorkingEvents: EventRecord[];
  filteredInactiveEvents: EventRecord[];
  filteredArchivedEvents: EventRecord[];
  recentHistoricalEvents: EventRecord[];
  historyEventGroups: HistoryEventGroup[];
  liveWorkspaceHeading: string;
  inactiveWorkspaceHeading: string;
  archivedWorkspaceHeading: string;
  historyWorkspaceHeading: string;
  selectedEventId: string;
  isSearchFocused: (id: string) => boolean;
  onSelectEvent: (eventId: string) => unknown;
  eventHistoryOpenKeys: string[];
  onToggleEventHistoryGroup: (key: string) => void;
  getSearchTargetDomId: (id: string) => string;
  formatEventWorkspaceDateLabel: (value: string | null | undefined) => string;
  getEventStatusTone: (status: EventRecord["effective_status"]) => BadgeTone;
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  getRegistrationAvailabilityLabel: (status: EventRecord["registration_availability"]) => string;
};

function EventWorkspaceRow({
  event,
  selected,
  searchFocused,
  onSelect,
  getSearchTargetDomId,
  formatEventWorkspaceDateLabel,
  getEventStatusTone,
  getEventStatusLabel,
  getRegistrationAvailabilityLabel,
}: {
  event: EventRecord;
  selected: boolean;
  searchFocused: boolean;
  onSelect: () => unknown;
  getSearchTargetDomId: (id: string) => string;
  formatEventWorkspaceDateLabel: (value: string | null | undefined) => string;
  getEventStatusTone: (status: EventRecord["effective_status"]) => BadgeTone;
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  getRegistrationAvailabilityLabel: (status: EventRecord["registration_availability"]) => string;
}) {
  const lastUpdatedLabel = formatEventWorkspaceDateLabel(event.updated_at || event.created_at);
  const showAvailabilityBadge =
    event.registration_availability
    && event.registration_availability !== "open"
    && event.effective_status !== "closed"
    && event.effective_status !== "cancelled"
    && event.effective_status !== "archived";

  return (
    <button
      id={getSearchTargetDomId(event.id)}
      onClick={() => void onSelect()}
      className="w-full overflow-hidden rounded-2xl text-left"
    >
      <div
        className={`${selected ? "border-blue-200 bg-blue-50 shadow-sm" : "border-slate-200 bg-slate-50 hover:bg-slate-100"} ${
          searchFocused ? "ring-2 ring-blue-200 ring-offset-2" : ""
        } rounded-2xl border px-3 py-3 transition-colors sm:px-4`.trim()}
      >
        <div className="grid min-h-[5.75rem] grid-cols-[4.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-start">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            {event.poster_url ? (
              <img
                src={event.poster_url}
                alt={`${event.name} poster`}
                className="h-[5.75rem] w-full object-cover sm:h-24"
                loading="lazy"
              />
            ) : (
              <div className="flex h-[5.75rem] w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-slate-100 via-white to-slate-200 text-slate-400 sm:h-24">
                <CalendarRange className="h-4 w-4" />
                <span className="text-[9px] font-semibold uppercase tracking-[0.16em]">No Poster</span>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 sm:hidden">
              <StatusBadge tone={getEventStatusTone(event.effective_status)}>
                {getEventStatusLabel(event.effective_status)}
              </StatusBadge>
              {selected && <SelectionMarker />}
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-slate-900 sm:mt-0">{event.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-2">
                <span className="font-mono">{event.slug}</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="text-slate-300">•</span>
                <span>Updated {lastUpdatedLabel}</span>
              </span>
            </div>
            <StatusLine
              className="mt-1"
              items={[
                showAvailabilityBadge ? <>Registration {getRegistrationAvailabilityLabel(event.registration_availability)}</> : null,
                event.is_default ? "Default workspace" : null,
              ]}
            />
          </div>
          <div className="hidden min-w-0 flex-wrap items-center gap-2 sm:flex sm:justify-end sm:pl-2">
            <StatusBadge tone={getEventStatusTone(event.effective_status)}>
              {getEventStatusLabel(event.effective_status)}
            </StatusBadge>
            {selected && <SelectionMarker />}
          </div>
        </div>
      </div>
    </button>
  );
}

export function EventWorkspacePanel({
  collapsed,
  eventCreateOpen,
  onToggleEventCreate,
  onRefresh,
  eventLoading,
  newEventName,
  onNewEventNameChange,
  onCreateEvent,
  eventListQuery,
  onEventListQueryChange,
  eventWorkspaceSort,
  onEventWorkspaceSortChange,
  eventWorkspaceFilterOptions,
  eventWorkspaceFilter,
  onEventWorkspaceFilterChange,
  filteredEventWorkspaceEvents,
  eventWorkspaceCounts,
  deferredEventListQuery,
  filteredWorkingEvents,
  filteredInactiveEvents,
  filteredArchivedEvents,
  recentHistoricalEvents,
  historyEventGroups,
  liveWorkspaceHeading,
  inactiveWorkspaceHeading,
  archivedWorkspaceHeading,
  historyWorkspaceHeading,
  selectedEventId,
  isSearchFocused,
  onSelectEvent,
  eventHistoryOpenKeys,
  onToggleEventHistoryGroup,
  getSearchTargetDomId,
  formatEventWorkspaceDateLabel,
  getEventStatusTone,
  getEventStatusLabel,
  getRegistrationAvailabilityLabel,
}: EventWorkspacePanelProps) {
  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${
        collapsed
          ? "p-3 sm:p-3"
          : "flex flex-col space-y-4 p-4 sm:p-5 xl:h-[calc(100dvh-10rem)] xl:min-h-[42rem]"
      }`}
    >
      <div className={`flex justify-between gap-3 ${collapsed ? "items-center" : "items-start"}`}>
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <CalendarRange className="w-5 h-5 text-blue-600" />
            Event Workspace
          </h3>
          <p className="text-sm text-slate-500">Create, switch, and manage the lifecycle of event workspaces.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ActionButton
            onClick={onToggleEventCreate}
            tone="blue"
            active={eventCreateOpen}
            className="text-sm shadow-[0_10px_24px_rgba(37,99,235,0.12)]"
          >
            <Plus className="h-4 w-4" />
            {eventCreateOpen ? "Close" : "New Event"}
          </ActionButton>
          <button
            onClick={() => void onRefresh()}
            disabled={eventLoading}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
            title="Refresh events"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${eventLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {eventCreateOpen && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={newEventName}
              onChange={(event) => onNewEventNameChange(event.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="New event name"
            />
            <ActionButton
              onClick={() => void onCreateEvent()}
              disabled={!newEventName.trim() || eventLoading}
              tone="blue"
              active
              className="w-full text-sm sm:w-auto"
            >
              Create Event
            </ActionButton>
          </div>
        </div>
      )}

      <div className={collapsed ? "space-y-3" : "space-y-3 xl:flex-shrink-0"}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={eventListQuery}
              onChange={(event) => onEventListQueryChange(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search events by name, slug, or status"
            />
            {eventListQuery && (
              <button
                onClick={() => onEventListQueryChange("")}
                className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                aria-label="Clear event search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="sm:w-56">
            <select
              value={eventWorkspaceSort}
              onChange={(event) => onEventWorkspaceSortChange(event.target.value as EventWorkspaceSort)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Sort events"
            >
              <option value="event_start_desc">Event Start</option>
              <option value="name_asc">Alphabetical</option>
              <option value="modified_desc">Modified Time</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {eventWorkspaceFilterOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onEventWorkspaceFilterChange(option.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                eventWorkspaceFilter === option.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>{option.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  eventWorkspaceFilter === option.id ? "bg-white/15 text-white" : "bg-white text-slate-500"
                }`}
              >
                {option.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>{filteredEventWorkspaceEvents.length} matching events</span>
          <span className="text-slate-300">•</span>
          <span>{eventWorkspaceCounts.active + eventWorkspaceCounts.pending} active queue</span>
          <span className="text-slate-300">•</span>
          <span>{eventWorkspaceCounts.inactive} inactive</span>
          <span className="text-slate-300">•</span>
          <span>{eventWorkspaceCounts.archived} archived</span>
          <span className="text-slate-300">•</span>
          <span>{eventWorkspaceCounts.closed + eventWorkspaceCounts.cancelled} in history</span>
        </div>
      </div>

      <div className={collapsed ? "space-y-5" : "min-h-0 flex-1 space-y-5 overflow-y-auto pr-1"}>
        {filteredEventWorkspaceEvents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
            {deferredEventListQuery
              ? "No events match this search."
              : eventWorkspaceFilter === "all"
              ? "No event workspaces yet."
              : "No events for this lifecycle yet."}
          </div>
        ) : (
          <>
            {filteredWorkingEvents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-700">{liveWorkspaceHeading}</p>
                  <span className="text-xs font-medium text-slate-500">{filteredWorkingEvents.length} events</span>
                </div>
                <div className="space-y-2">
                  {filteredWorkingEvents.map((event) => (
                    <EventWorkspaceRow
                      key={event.id}
                      event={event}
                      selected={selectedEventId === event.id}
                      searchFocused={isSearchFocused(event.id)}
                      onSelect={() => onSelectEvent(event.id)}
                      getSearchTargetDomId={getSearchTargetDomId}
                      formatEventWorkspaceDateLabel={formatEventWorkspaceDateLabel}
                      getEventStatusTone={getEventStatusTone}
                      getEventStatusLabel={getEventStatusLabel}
                      getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
                    />
                  ))}
                </div>
              </div>
            )}

            {filteredInactiveEvents.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-700">{inactiveWorkspaceHeading}</p>
                  <span className="text-xs font-medium text-slate-500">{filteredInactiveEvents.length} events</span>
                </div>
                <div className="space-y-2">
                  {filteredInactiveEvents.map((event) => (
                    <EventWorkspaceRow
                      key={event.id}
                      event={event}
                      selected={selectedEventId === event.id}
                      searchFocused={isSearchFocused(event.id)}
                      onSelect={() => onSelectEvent(event.id)}
                      getSearchTargetDomId={getSearchTargetDomId}
                      formatEventWorkspaceDateLabel={formatEventWorkspaceDateLabel}
                      getEventStatusTone={getEventStatusTone}
                      getEventStatusLabel={getEventStatusLabel}
                      getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
                    />
                  ))}
                </div>
              </div>
            )}

            {filteredArchivedEvents.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-700">{archivedWorkspaceHeading}</p>
                  <span className="text-xs font-medium text-slate-500">{filteredArchivedEvents.length} events</span>
                </div>
                <div className="space-y-2">
                  {filteredArchivedEvents.map((event) => (
                    <EventWorkspaceRow
                      key={event.id}
                      event={event}
                      selected={selectedEventId === event.id}
                      searchFocused={isSearchFocused(event.id)}
                      onSelect={() => onSelectEvent(event.id)}
                      getSearchTargetDomId={getSearchTargetDomId}
                      formatEventWorkspaceDateLabel={formatEventWorkspaceDateLabel}
                      getEventStatusTone={getEventStatusTone}
                      getEventStatusLabel={getEventStatusLabel}
                      getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
                    />
                  ))}
                </div>
              </div>
            )}

            {recentHistoricalEvents.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-700">{historyWorkspaceHeading}</p>
                  <span className="text-xs font-medium text-slate-500">{recentHistoricalEvents.length} events</span>
                </div>
                <div className="space-y-2">
                  {recentHistoricalEvents.map((event) => (
                    <EventWorkspaceRow
                      key={event.id}
                      event={event}
                      selected={selectedEventId === event.id}
                      searchFocused={isSearchFocused(event.id)}
                      onSelect={() => onSelectEvent(event.id)}
                      getSearchTargetDomId={getSearchTargetDomId}
                      formatEventWorkspaceDateLabel={formatEventWorkspaceDateLabel}
                      getEventStatusTone={getEventStatusTone}
                      getEventStatusLabel={getEventStatusLabel}
                      getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
                    />
                  ))}
                </div>
              </div>
            )}

            {historyEventGroups.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-700">History by Month</p>
                  <span className="text-xs font-medium text-slate-500">{historyEventGroups.length} groups</span>
                </div>
                <div className="space-y-2">
                  {historyEventGroups.map((group) => {
                    const open = Boolean(deferredEventListQuery) || eventHistoryOpenKeys.includes(group.key);
                    return (
                      <div key={group.key} className="rounded-2xl border border-slate-200 bg-slate-50">
                        <button
                          type="button"
                          onClick={() => onToggleEventHistoryGroup(group.key)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-700">{group.label}</p>
                            <p className="text-xs text-slate-500">{group.events.length} events</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-500">{group.events.length} events</span>
                            {!deferredEventListQuery && (
                              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
                            )}
                          </div>
                        </button>
                        {open && (
                          <div className="space-y-2 border-t border-slate-200 p-2">
                            {group.events.map((event) => (
                              <EventWorkspaceRow
                                key={event.id}
                                event={event}
                                selected={selectedEventId === event.id}
                                searchFocused={isSearchFocused(event.id)}
                                onSelect={() => onSelectEvent(event.id)}
                                getSearchTargetDomId={getSearchTargetDomId}
                                formatEventWorkspaceDateLabel={formatEventWorkspaceDateLabel}
                                getEventStatusTone={getEventStatusTone}
                                getEventStatusLabel={getEventStatusLabel}
                                getRegistrationAvailabilityLabel={getRegistrationAvailabilityLabel}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
