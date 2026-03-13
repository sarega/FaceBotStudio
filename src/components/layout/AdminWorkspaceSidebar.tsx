import type { ReactNode, RefObject } from "react";
import {
  Bot,
  CalendarRange,
  ChevronDown,
  LogOut,
  MonitorCog,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { StatusBadge, type BadgeTone } from "../shared/AppUi";
import type { AuthUser, EventRecord } from "../../types";

type ThemeMode = "light" | "dark" | "system";
type AppTab = "event" | "mail" | "design" | "test" | "agent" | "logs" | "settings" | "team" | "registrations" | "checkin" | "inbox";
type EventWorkspaceView = "setup" | "public";
type AgentWorkspaceView = "console" | "setup";
type TimerRef = { current: number | null };
type BooleanStateSetter = (value: boolean | ((current: boolean) => boolean)) => void;
type ThemeModeSetter = (value: ThemeMode) => void;
type AgentWorkspaceViewSetter = (value: AgentWorkspaceView) => void;

type HeaderTab = {
  id: AppTab;
  icon: LucideIcon;
  label: string;
};

type EventWorkspaceTab = {
  id: EventWorkspaceView;
  icon: LucideIcon;
  label: string;
  description: string;
};

type AgentWorkspaceTab = {
  id: AgentWorkspaceView;
  icon: LucideIcon;
  label: string;
  description: string;
};

type AdminWorkspaceSidebarProps = {
  isAgentMobileFocusMode: boolean;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobileSidebar: () => void;
  userMenuRef: RefObject<HTMLDivElement | null>;
  userMenuOpen: boolean;
  setUserMenuOpen: BooleanStateSetter;
  authUser: AuthUser | null;
  themeMode: ThemeMode;
  setThemeMode: ThemeModeSetter;
  onLogout: () => void | Promise<void>;
  selectedEvent: EventRecord | null;
  getEventStatusTone: (status: EventRecord["effective_status"]) => BadgeTone;
  getEventStatusLabel: (status: EventRecord["effective_status"]) => string;
  getRegistrationAvailabilityLabel: (status: EventRecord["registration_availability"]) => string;
  primaryTabs: HeaderTab[];
  activeTab: AppTab;
  hoverDropdownEnabled: boolean;
  eventWorkspaceTabs: EventWorkspaceTab[];
  selectedEventWorkspaceTab: EventWorkspaceTab;
  eventWorkspaceView: EventWorkspaceView;
  eventWorkspaceMenuRef: RefObject<HTMLDivElement | null>;
  eventWorkspaceMenuOpen: boolean;
  setEventWorkspaceMenuOpen: BooleanStateSetter;
  eventWorkspaceDirty: boolean;
  eventSetupDirty: boolean;
  eventPublicDirty: boolean;
  setupMenuRef: RefObject<HTMLDivElement | null>;
  setupMenuOpen: boolean;
  setSetupMenuOpen: BooleanStateSetter;
  selectedSetupTab: HeaderTab | null;
  setupTabs: HeaderTab[];
  isSetupTab: boolean;
  workspaceSetupDirty: boolean;
  operationsMenuRef: RefObject<HTMLDivElement | null>;
  operationsMenuOpen: boolean;
  setOperationsMenuOpen: BooleanStateSetter;
  operationsTabs: HeaderTab[];
  isOperationsTab: boolean;
  agentWorkspaceMenuRef: RefObject<HTMLDivElement | null>;
  agentWorkspaceMenuOpen: boolean;
  setAgentWorkspaceMenuOpen: BooleanStateSetter;
  agentWorkspaceTabs: AgentWorkspaceTab[];
  agentWorkspaceView: AgentWorkspaceView;
  setAgentWorkspaceView: AgentWorkspaceViewSetter;
  agentSettingsDirty: boolean;
  eventMailDirty: boolean;
  eventContextDirty: boolean;
  eventWorkspaceMenuCloseTimerRef: TimerRef;
  setupMenuCloseTimerRef: TimerRef;
  operationsMenuCloseTimerRef: TimerRef;
  agentWorkspaceMenuCloseTimerRef: TimerRef;
  clearMenuCloseTimer: (timerRef: TimerRef) => void;
  scheduleEventWorkspaceMenuClose: () => void;
  scheduleSetupMenuClose: () => void;
  scheduleOperationsMenuClose: () => void;
  scheduleAgentWorkspaceMenuClose: () => void;
  onNavigateToTab: (tab: AppTab) => boolean;
  onOpenEventWorkspaceView: (view: EventWorkspaceView) => boolean;
  onForceScrollAdminAgentToBottom: () => void;
};

type SidebarActionButtonProps = {
  collapsed: boolean;
  active: boolean;
  icon: LucideIcon;
  label: string;
  subtitle?: string;
  indicator?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
};

function SidebarActionButton({
  collapsed,
  active,
  icon: Icon,
  label,
  subtitle,
  indicator = false,
  trailing,
  onClick,
}: SidebarActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`group relative flex w-full items-center gap-2.5 text-left transition-colors ${
        active
          ? "bg-blue-50 text-blue-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      } ${collapsed ? "mx-auto h-11 w-11 justify-center rounded-[1.2rem] px-0 py-0" : "rounded-[1.2rem] px-2 py-2"}`}
    >
      <span className={`flex shrink-0 items-center justify-center ${
        collapsed ? "h-9 w-9 rounded-xl" : "h-9 w-9 rounded-xl"
      } ${active ? "text-blue-600" : "text-slate-500 group-hover:text-blue-600"}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{label}</p>
            {indicator && <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />}
          </div>
          {subtitle && <p className="truncate text-[10px] text-slate-500">{subtitle}</p>}
        </div>
      )}
      {collapsed && indicator && (
        <span
          className={`absolute right-0.5 top-0.5 h-2 w-2 rounded-full ${
            active ? "bg-amber-500" : "bg-amber-400"
          }`}
          aria-hidden
        />
      )}
      {!collapsed && trailing}
    </button>
  );
}

function SidebarMenuPanel({
  collapsed,
  open,
  children,
}: {
  collapsed: boolean;
  open: boolean;
  children: ReactNode;
}) {
  if (!open) return null;

  if (collapsed) {
    return (
      <div className="app-overlay-surface absolute left-[calc(100%+0.25rem)] top-0 z-50 w-72 rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_22px_60px_rgba(15,23,42,0.18)]">
        <div className="space-y-1">{children}</div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-1.5">
      {children}
    </div>
  );
}

function SidebarMenuItem({
  active,
  icon: Icon,
  label,
  description,
  indicator = false,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  description?: string;
  indicator?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-2.5 rounded-[1.1rem] px-2.5 py-2 text-left transition-colors ${
        active
          ? "bg-blue-50 text-blue-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
        active ? "text-blue-600" : "text-slate-500 group-hover:text-blue-600"
      }`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{label}</p>
          {indicator && <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />}
        </div>
        {description && <p className={`truncate text-[10px] ${active ? "text-blue-600/75" : "text-slate-500 group-hover:text-slate-600"}`}>{description}</p>}
      </div>
    </button>
  );
}

export function AdminWorkspaceSidebar({
  isAgentMobileFocusMode,
  collapsed,
  mobileOpen,
  onCloseMobileSidebar,
  userMenuRef,
  userMenuOpen,
  setUserMenuOpen,
  authUser,
  themeMode,
  setThemeMode,
  onLogout,
  selectedEvent,
  getEventStatusTone,
  getEventStatusLabel,
  getRegistrationAvailabilityLabel,
  primaryTabs,
  activeTab,
  hoverDropdownEnabled,
  eventWorkspaceTabs,
  selectedEventWorkspaceTab,
  eventWorkspaceView,
  eventWorkspaceMenuRef,
  eventWorkspaceMenuOpen,
  setEventWorkspaceMenuOpen,
  eventWorkspaceDirty,
  eventSetupDirty,
  eventPublicDirty,
  setupMenuRef,
  setupMenuOpen,
  setSetupMenuOpen,
  selectedSetupTab,
  setupTabs,
  isSetupTab,
  workspaceSetupDirty,
  operationsMenuRef,
  operationsMenuOpen,
  setOperationsMenuOpen,
  operationsTabs,
  isOperationsTab,
  agentWorkspaceMenuRef,
  agentWorkspaceMenuOpen,
  setAgentWorkspaceMenuOpen,
  agentWorkspaceTabs,
  agentWorkspaceView,
  setAgentWorkspaceView,
  agentSettingsDirty,
  eventMailDirty,
  eventContextDirty,
  eventWorkspaceMenuCloseTimerRef,
  setupMenuCloseTimerRef,
  operationsMenuCloseTimerRef,
  agentWorkspaceMenuCloseTimerRef,
  clearMenuCloseTimer,
  scheduleEventWorkspaceMenuClose,
  scheduleSetupMenuClose,
  scheduleOperationsMenuClose,
  scheduleAgentWorkspaceMenuClose,
  onNavigateToTab,
  onOpenEventWorkspaceView,
  onForceScrollAdminAgentToBottom,
}: AdminWorkspaceSidebarProps) {
  const allowHoverFlyout = collapsed && hoverDropdownEnabled;
  const selectedAgentWorkspaceTab = agentWorkspaceTabs.find((tab) => tab.id === agentWorkspaceView) || agentWorkspaceTabs[0];

  const closeSiblingMenus = (except?: "event" | "setup" | "operations" | "agent") => {
    if (except !== "event") {
      setEventWorkspaceMenuOpen(false);
      clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
    }
    if (except !== "setup") {
      setSetupMenuOpen(false);
      clearMenuCloseTimer(setupMenuCloseTimerRef);
    }
    if (except !== "operations") {
      setOperationsMenuOpen(false);
      clearMenuCloseTimer(operationsMenuCloseTimerRef);
    }
    if (except !== "agent") {
      setAgentWorkspaceMenuOpen(false);
      clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
    }
  };

  const handleCloseMobileAfterAction = (succeeded: boolean) => {
    if (succeeded) {
      onCloseMobileSidebar();
    }
  };

  const handleNavigate = (tab: AppTab) => {
    handleCloseMobileAfterAction(onNavigateToTab(tab));
  };

  const handleOpenEventView = (view: EventWorkspaceView) => {
    handleCloseMobileAfterAction(onOpenEventWorkspaceView(view));
  };

  const handleOpenAgentView = (view: AgentWorkspaceView) => {
    if (!onNavigateToTab("agent")) return;
    setAgentWorkspaceView(view);
    setAgentWorkspaceMenuOpen(false);
    clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
    if (view === "console") {
      onForceScrollAdminAgentToBottom();
    }
    onCloseMobileSidebar();
  };

  const handleEventButtonToggle = () => {
    closeSiblingMenus("event");
    if (allowHoverFlyout) {
      setEventWorkspaceMenuOpen(true);
      return;
    }
    setEventWorkspaceMenuOpen((open) => !open);
  };

  const handleAgentButtonToggle = () => {
    closeSiblingMenus("agent");
    if (allowHoverFlyout) {
      setAgentWorkspaceMenuOpen(true);
      return;
    }
    setAgentWorkspaceMenuOpen((open) => !open);
  };

  const handleOperationsButtonToggle = () => {
    closeSiblingMenus("operations");
    if (allowHoverFlyout) {
      setOperationsMenuOpen(true);
      return;
    }
    setOperationsMenuOpen((open) => !open);
  };

  const handleSetupButtonToggle = () => {
    closeSiblingMenus("setup");
    if (allowHoverFlyout) {
      setSetupMenuOpen(true);
      return;
    }
    setSetupMenuOpen((open) => !open);
  };

  const sidebarContent = (
    <div className={`flex h-full flex-col gap-2.5 ${collapsed ? "px-1.5 py-2.5" : "px-3 py-3"}`}>
      <div className="flex items-center justify-between lg:hidden">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)]">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Navigation</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobileSidebar}
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
          aria-label="Close navigation"
        >
          <X className="h-4.5 w-4.5" />
        </button>
      </div>

      {!collapsed && selectedEvent && (
        <div className="workspace-rail-card rounded-[1.25rem] px-3 py-2 text-white shadow-[0_22px_44px_rgba(15,23,42,0.2)]">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Active workspace</p>
          <p className="mt-1 line-clamp-2 text-[0.9rem] font-semibold leading-5">{selectedEvent.name}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StatusBadge tone={getEventStatusTone(selectedEvent.effective_status)} className="border-white/10 bg-white/10 text-white">
              {getEventStatusLabel(selectedEvent.effective_status)}
            </StatusBadge>
            {selectedEvent.registration_availability !== "open" && (
              <StatusBadge
                tone={selectedEvent.registration_availability === "full" ? "rose" : "amber"}
                className="border-white/10 bg-white/10 text-white"
              >
                {getRegistrationAvailabilityLabel(selectedEvent.registration_availability)}
              </StatusBadge>
            )}
          </div>
        </div>
      )}

      <nav className={`min-h-0 flex-1 ${collapsed ? "overflow-visible pr-0" : "overflow-y-auto pr-1"}`}>
        <div className="space-y-2">
          {primaryTabs.map((tab) => {
            if (tab.id === "event") {
              return (
                <div
                  key={tab.id}
                  className="relative"
                  ref={eventWorkspaceMenuRef}
                  onMouseEnter={() => {
                    if (!allowHoverFlyout) return;
                    clearMenuCloseTimer(eventWorkspaceMenuCloseTimerRef);
                    closeSiblingMenus("event");
                    setEventWorkspaceMenuOpen(true);
                  }}
                  onMouseLeave={allowHoverFlyout ? scheduleEventWorkspaceMenuClose : undefined}
                >
                  <SidebarActionButton
                    collapsed={collapsed}
                    active={activeTab === "event" || eventWorkspaceMenuOpen}
                    icon={selectedEventWorkspaceTab.icon}
                    label="Event Workspace"
                    subtitle={selectedEventWorkspaceTab.label}
                    indicator={eventWorkspaceDirty}
                    trailing={
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${eventWorkspaceMenuOpen ? "rotate-180" : ""}`} />
                    }
                    onClick={handleEventButtonToggle}
                  />
                  <SidebarMenuPanel collapsed={collapsed} open={eventWorkspaceMenuOpen}>
                    {eventWorkspaceTabs.map((eventViewTab) => (
                      <SidebarMenuItem
                        key={eventViewTab.id}
                        active={activeTab === "event" && eventWorkspaceView === eventViewTab.id}
                        icon={eventViewTab.icon}
                        label={eventViewTab.label}
                        description={eventViewTab.description}
                        indicator={(eventViewTab.id === "setup" && eventSetupDirty) || (eventViewTab.id === "public" && eventPublicDirty)}
                        onClick={() => handleOpenEventView(eventViewTab.id)}
                      />
                    ))}
                  </SidebarMenuPanel>
                </div>
              );
            }

            if (tab.id === "agent") {
              return (
                <div
                  key={tab.id}
                  className="relative"
                  ref={agentWorkspaceMenuRef}
                  onMouseEnter={() => {
                    if (!allowHoverFlyout) return;
                    clearMenuCloseTimer(agentWorkspaceMenuCloseTimerRef);
                    closeSiblingMenus("agent");
                    setAgentWorkspaceMenuOpen(true);
                  }}
                  onMouseLeave={allowHoverFlyout ? scheduleAgentWorkspaceMenuClose : undefined}
                >
                  <SidebarActionButton
                    collapsed={collapsed}
                    active={activeTab === "agent" || agentWorkspaceMenuOpen}
                    icon={selectedAgentWorkspaceTab.icon}
                    label="Agent"
                    subtitle={selectedAgentWorkspaceTab?.label || "Agent Chat"}
                    indicator={agentSettingsDirty}
                    trailing={
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${agentWorkspaceMenuOpen ? "rotate-180" : ""}`} />
                    }
                    onClick={handleAgentButtonToggle}
                  />
                  <SidebarMenuPanel collapsed={collapsed} open={agentWorkspaceMenuOpen}>
                    {agentWorkspaceTabs.map((agentViewTab) => (
                      <SidebarMenuItem
                        key={agentViewTab.id}
                        active={activeTab === "agent" && agentWorkspaceView === agentViewTab.id}
                        icon={agentViewTab.icon}
                        label={agentViewTab.label}
                        description={agentViewTab.description}
                        onClick={() => handleOpenAgentView(agentViewTab.id)}
                      />
                    ))}
                  </SidebarMenuPanel>
                </div>
              );
            }

            return (
              <SidebarActionButton
                key={tab.id}
                collapsed={collapsed}
                active={activeTab === tab.id}
                icon={tab.icon}
                label={tab.label}
                indicator={(tab.id === "mail" && eventMailDirty) || (tab.id === "design" && eventContextDirty)}
                onClick={() => handleNavigate(tab.id)}
              />
            );
          })}

          {operationsTabs.length > 0 && (
            <div
              className="relative"
              ref={operationsMenuRef}
              onMouseEnter={() => {
                if (!allowHoverFlyout) return;
                clearMenuCloseTimer(operationsMenuCloseTimerRef);
                closeSiblingMenus("operations");
                setOperationsMenuOpen(true);
              }}
              onMouseLeave={allowHoverFlyout ? scheduleOperationsMenuClose : undefined}
            >
              <SidebarActionButton
                collapsed={collapsed}
                active={isOperationsTab || operationsMenuOpen}
                icon={Users}
                label="Operations"
                subtitle="Regs, inbox, check-in, logs"
                trailing={
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${operationsMenuOpen ? "rotate-180" : ""}`} />
                }
                onClick={handleOperationsButtonToggle}
              />
              <SidebarMenuPanel collapsed={collapsed} open={operationsMenuOpen}>
                {operationsTabs.map((tab) => (
                  <SidebarMenuItem
                    key={tab.id}
                    active={activeTab === tab.id}
                    icon={tab.icon}
                    label={tab.label}
                    onClick={() => handleNavigate(tab.id)}
                  />
                ))}
              </SidebarMenuPanel>
            </div>
          )}

          {setupTabs.length > 0 && selectedSetupTab && (
            <div
              className="relative"
              ref={setupMenuRef}
              onMouseEnter={() => {
                if (!allowHoverFlyout) return;
                clearMenuCloseTimer(setupMenuCloseTimerRef);
                closeSiblingMenus("setup");
                setSetupMenuOpen(true);
              }}
              onMouseLeave={allowHoverFlyout ? scheduleSetupMenuClose : undefined}
            >
              <SidebarActionButton
                collapsed={collapsed}
                active={isSetupTab || setupMenuOpen}
                icon={selectedSetupTab.icon}
                label="Workspace Setup"
                subtitle="Organization settings"
                indicator={workspaceSetupDirty}
                trailing={
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${setupMenuOpen ? "rotate-180" : ""}`} />
                }
                onClick={handleSetupButtonToggle}
              />
              <SidebarMenuPanel collapsed={collapsed} open={setupMenuOpen}>
                {setupTabs.map((tab) => (
                  <SidebarMenuItem
                    key={tab.id}
                    active={activeTab === tab.id}
                    icon={tab.icon}
                    label={tab.label}
                    indicator={tab.id === "settings" && workspaceSetupDirty}
                    onClick={() => handleNavigate(tab.id)}
                  />
                ))}
              </SidebarMenuPanel>
            </div>
          )}
        </div>
      </nav>

      <div className="relative z-20 mt-auto" ref={userMenuRef}>
        <button
          type="button"
          onClick={() => setUserMenuOpen((open) => !open)}
          className={`workspace-rail-user w-full border border-slate-200 shadow-[0_18px_35px_rgba(15,23,42,0.08)] transition-colors hover:border-slate-300 ${
            collapsed
              ? "mx-auto flex h-11 w-11 items-center justify-center rounded-[1.35rem] px-0 py-0"
              : "flex items-center gap-2.5 rounded-[1.5rem] px-2.5 py-2.5"
          }`}
          aria-expanded={userMenuOpen}
          aria-haspopup="menu"
          aria-label="Open user menu"
        >
          <span className={`flex shrink-0 items-center justify-center bg-slate-100 text-slate-600 ${
            collapsed ? "h-9 w-9 rounded-xl" : "h-10 w-10 rounded-xl"
          }`}>
            <User className="h-4 w-4" />
          </span>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-semibold text-slate-900">{authUser?.display_name || authUser?.username}</p>
                <p className="mt-0.5 truncate text-[11px] uppercase tracking-[0.18em] text-slate-500">{authUser?.role}</p>
              </div>
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
            </>
          )}
        </button>

        {userMenuOpen && (
          <div
            className={`app-overlay-surface absolute z-50 rounded-[1.75rem] border border-slate-200 bg-white p-3 shadow-[0_24px_60px_rgba(15,23,42,0.18)] ${
              collapsed
                ? "left-[calc(100%+0.75rem)] bottom-0 w-72"
                : "bottom-full left-0 right-0 mb-2"
            }`}
          >
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="truncate text-sm font-semibold text-slate-900">{authUser?.display_name || authUser?.username}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">{authUser?.role}</p>
            </div>
            <div className="mt-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                <MonitorCog className="h-3.5 w-3.5" />
                Theme
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
                {([
                  { id: "light", label: "Light" },
                  { id: "dark", label: "Dark" },
                  { id: "system", label: "System" },
                ] as Array<{ id: ThemeMode; label: string }>).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      setThemeMode(mode.id);
                      setUserMenuOpen(false);
                    }}
                    className={`rounded-xl px-2 py-2 text-xs font-semibold transition-colors ${
                      themeMode === mode.id
                        ? "bg-white text-blue-600 shadow-sm"
                        : "text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(false);
                onCloseMobileSidebar();
                void onLogout();
              }}
              className="mt-3 flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              role="menuitem"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (isAgentMobileFocusMode) {
    return (
      <aside className={`hidden shrink-0 border-r border-slate-200 lg:relative lg:z-20 lg:flex ${collapsed ? "lg:w-[4.75rem]" : "lg:w-[16rem]"}`}>
        <div className="workspace-rail-surface h-full w-full overflow-visible">
          {sidebarContent}
        </div>
      </aside>
    );
  }

  return (
    <>
      <aside className={`hidden shrink-0 border-r border-slate-200 lg:relative lg:z-20 lg:flex ${collapsed ? "lg:w-[4.75rem]" : "lg:w-[16rem]"}`}>
        <div className="workspace-rail-surface h-full w-full overflow-visible">
          {sidebarContent}
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            onClick={onCloseMobileSidebar}
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
            aria-label="Close navigation drawer"
          />
          <div className="absolute inset-y-0 left-0 w-[min(22rem,calc(100vw-1rem))] p-2">
            <div className="workspace-rail-surface h-full overflow-hidden rounded-[2rem] border border-slate-200 shadow-[0_26px_70px_rgba(15,23,42,0.22)]">
              {sidebarContent}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
