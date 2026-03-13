import {
  Bot,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Menu,
  Search,
  X,
} from "lucide-react";

import { StatusBadge, type BadgeTone } from "../shared/AppUi";
import type { EventRecord } from "../../types";

type BooleanStateSetter = (value: boolean | ((current: boolean) => boolean)) => void;

type AdminWorkspaceHeaderProps = {
  isAgentMobileFocusMode: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebarCollapsed: () => void;
  mobileSidebarOpen: boolean;
  onToggleMobileSidebar: () => void;
  selectedEvent: EventRecord | null;
  getEventStatusTone: (status: EventRecord["effective_status"]) => BadgeTone;
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  getRegistrationAvailabilityLabel: (status: EventRecord["registration_availability"]) => string;
  selectedEventAvailableInSelector: boolean;
  selectedEventId: string;
  selectorEvents: EventRecord[];
  selectorPlaceholderLabel: string;
  eventLoading: boolean;
  onSelectEvent: (eventId: string) => boolean;
  searchShortcutLabel: string;
  globalSearchOpen: boolean;
  setGlobalSearchOpen: BooleanStateSetter;
};

export function AdminWorkspaceHeader({
  isAgentMobileFocusMode,
  sidebarCollapsed,
  onToggleSidebarCollapsed,
  mobileSidebarOpen,
  onToggleMobileSidebar,
  selectedEvent,
  getEventStatusTone,
  getEventStatusLabel,
  getRegistrationAvailabilityLabel,
  selectedEventAvailableInSelector,
  selectedEventId,
  selectorEvents,
  selectorPlaceholderLabel,
  eventLoading,
  onSelectEvent,
  searchShortcutLabel,
  globalSearchOpen,
  setGlobalSearchOpen,
}: AdminWorkspaceHeaderProps) {
  return (
    <header
      className={`app-header-surface sticky top-0 z-30 border-b border-slate-200 backdrop-blur-xl ${
        isAgentMobileFocusMode ? "hidden lg:block" : ""
      }`}
    >
      <div className="mx-auto max-w-7xl px-3 py-1 sm:px-4 lg:px-6">
        <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center">
          <div className="flex w-full items-center justify-between gap-2 lg:w-auto lg:min-w-[10.75rem]">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                onClick={onToggleMobileSidebar}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
                aria-label={mobileSidebarOpen ? "Close navigation" : "Open navigation"}
                aria-expanded={mobileSidebarOpen}
              >
                {mobileSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={onToggleSidebarCollapsed}
                className="hidden h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 lg:inline-flex"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </button>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 shadow-[0_10px_20px_rgba(37,99,235,0.18)]">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[1.02rem] font-bold tracking-tight text-slate-900">
                  FB Bot Studio
                </p>
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {selectedEvent && (
                <div className="hidden items-center gap-1.5 xl:flex">
                  <StatusBadge tone={getEventStatusTone(selectedEvent.effective_status)}>
                    {getEventStatusLabel(selectedEvent.effective_status)}
                  </StatusBadge>
                  {selectedEvent.registration_availability !== "open" && (
                    <StatusBadge
                      tone={selectedEvent.registration_availability === "full" ? "rose" : "amber"}
                    >
                      {getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}
                    </StatusBadge>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setGlobalSearchOpen(true)}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-colors lg:hidden ${
                  globalSearchOpen
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
                aria-label="Open global search"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setGlobalSearchOpen(true)}
            className={`group hidden min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors lg:flex lg:max-w-[22rem] ${
              globalSearchOpen
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"
            }`}
            aria-label="Open global search"
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${
              globalSearchOpen ? "bg-white text-blue-600" : "bg-white text-slate-500"
            }`}>
              <Search className="h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-none text-slate-900">
              Search events, registrations
            </p>
            <span className="hidden rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 lg:inline-flex">
              {searchShortcutLabel}
            </span>
          </button>

          <div className="lg:w-[min(21rem,100%)] lg:max-w-[21rem]">
            <label htmlFor="event-selector" className="sr-only">
              Workspace switcher
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white text-slate-500">
                <CalendarRange className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <select
                  id="event-selector"
                  value={selectedEventAvailableInSelector ? selectedEventId : ""}
                  onChange={(event) => {
                    if (!onSelectEvent(event.target.value)) {
                      event.currentTarget.value = selectedEventId;
                    }
                  }}
                  disabled={!selectorEvents.length || eventLoading}
                  className="min-w-0 w-full truncate bg-transparent text-sm font-semibold leading-none text-slate-900 outline-none disabled:opacity-60"
                >
                  <option value="" disabled>
                    {selectorPlaceholderLabel}
                  </option>
                  {selectorEvents.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name} ({getEventStatusLabel(event.effective_status)}
                      {event.registration_availability && event.registration_availability !== "open"
                        ? ` • ${getRegistrationAvailabilityLabel(event.registration_availability)}`
                        : ""}
                      )
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
