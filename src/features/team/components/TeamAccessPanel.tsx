import { useEffect, useState } from "react";
import { CalendarRange, RefreshCw, Save, Shield, Trash2, UserPlus } from "lucide-react";

import { ActionButton, StatusLine } from "../../../components/shared/AppUi";
import type { AuthUser, EventRecord, UserRole } from "../../../types";

const EVENT_SCOPED_ROLES: UserRole[] = ["operator", "cashier", "checker", "viewer"];

function roleLabel(role: UserRole) {
  return role === "cashier" ? "On-site Cashier" : role === "checker" ? "Gatekeeper" : role;
}

type TeamAccessPanelProps = {
  role: UserRole | undefined;
  authUser: AuthUser | null;
  teamLoading: boolean;
  teamUsers: AuthUser[];
  events: EventRecord[];
  teamMessage: string;
  canManageUsers: boolean;
  manageableRoles: readonly UserRole[];
  newUserDisplayName: string;
  onNewUserDisplayNameChange: (value: string) => void;
  newUserUsername: string;
  onNewUserUsernameChange: (value: string) => void;
  newUserPassword: string;
  onNewUserPasswordChange: (value: string) => void;
  newUserRole: UserRole;
  onNewUserRoleChange: (value: UserRole) => void;
  newUserEventIds: string[];
  onNewUserEventIdsChange: (value: string[]) => void;
  canManageTargetRole: (user: AuthUser) => boolean;
  canManageTargetAccess: (user: AuthUser) => boolean;
  canDeleteTeamUser: (user: AuthUser) => boolean;
  onRefresh: () => void | Promise<void>;
  onUserRoleChange: (userId: string, role: UserRole) => void | Promise<void>;
  onUserEventAccessChange: (userId: string, eventIds: string[]) => void | Promise<void>;
  onUserAccessToggle: (userId: string, nextIsActive: boolean) => void | Promise<void>;
  onDeleteUser: (user: AuthUser) => void | Promise<void>;
  onCreateUser: () => void | Promise<void>;
};

export function TeamAccessPanel({
  role,
  authUser,
  teamLoading,
  teamUsers,
  events,
  teamMessage,
  canManageUsers,
  manageableRoles,
  newUserDisplayName,
  onNewUserDisplayNameChange,
  newUserUsername,
  onNewUserUsernameChange,
  newUserPassword,
  onNewUserPasswordChange,
  newUserRole,
  onNewUserRoleChange,
  newUserEventIds,
  onNewUserEventIdsChange,
  canManageTargetRole,
  canManageTargetAccess,
  canDeleteTeamUser,
  onRefresh,
  onUserRoleChange,
  onUserEventAccessChange,
  onUserAccessToggle,
  onDeleteUser,
  onCreateUser,
}: TeamAccessPanelProps) {
  const [draftEventIds, setDraftEventIds] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setDraftEventIds(Object.fromEntries(teamUsers.map((user) => [user.id, user.assigned_event_ids || []])));
  }, [teamUsers]);

  const toggleEventId = (eventIds: string[], eventId: string) =>
    eventIds.includes(eventId) ? eventIds.filter((id) => id !== eventId) : [...eventIds, eventId];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Team Access
            </h2>
            <p className="mt-1 text-sm text-slate-500">Session-based admin access with roles stored in the database.</p>
            <p className="mt-2 text-xs text-amber-700">
              Delete removes the account permanently, revokes active sessions, and cannot be undone.
            </p>
          </div>
          <button
            onClick={() => void onRefresh()}
            disabled={teamLoading}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white transition-colors hover:bg-slate-50 disabled:opacity-50"
            title="Refresh users"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${teamLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.92fr)]">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Current Members</p>
              <p className="text-xs text-slate-500">Manage active accounts, roles, and emergency access changes.</p>
            </div>
            <span className="text-xs font-medium text-slate-500">{teamUsers.length} members</span>
          </div>
          <div className="space-y-3">
            {teamUsers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                No users loaded yet.
              </div>
            ) : (
              teamUsers.map((user) => (
                <div key={user.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{user.display_name}</p>
                      <p className="mt-1 text-xs text-slate-500">{user.username}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <StatusLine
                        items={[
                          user.is_active ? "active" : "disabled",
                          roleLabel(user.role),
                        ]}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div>
                      {canManageTargetRole(user) ? (
                        <select
                          value={user.role}
                          onChange={(event) => void onUserRoleChange(user.id, event.target.value as UserRole)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={teamLoading}
                        >
                          {manageableRoles
                            .filter((roleOption) => authUser?.role === "owner" || (roleOption !== "owner" && roleOption !== "admin"))
                            .map((roleOption) => (
                              <option key={roleOption} value={roleOption}>
                                {roleLabel(roleOption)}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-400">
                          Role change is restricted for this account.
                        </div>
                      )}
                    </div>
                    {(canManageTargetAccess(user) || canDeleteTeamUser(user)) && (
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <ActionButton
                          onClick={() => void onUserAccessToggle(user.id, !user.is_active)}
                          disabled={teamLoading}
                          tone={user.is_active ? "rose" : "emerald"}
                          className="text-sm"
                        >
                          {user.is_active ? "Remove Access" : "Restore Access"}
                        </ActionButton>
                        {canDeleteTeamUser(user) && (
                          <ActionButton
                            onClick={() => void onDeleteUser(user)}
                            disabled={teamLoading}
                            tone="rose"
                            className="text-sm"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete Member
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </div>

                  {EVENT_SCOPED_ROLES.includes(user.role) && (
                    <div className="rounded-xl border border-blue-100 bg-white p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <CalendarRange className="h-4 w-4 text-blue-600" />
                          <div>
                            <p className="text-xs font-semibold text-slate-800">Event access</p>
                            <p className="text-[11px] text-slate-500">
                              {(draftEventIds[user.id] || user.assigned_event_ids || []).length} selected Event(s)
                            </p>
                          </div>
                        </div>
                        {canManageTargetAccess(user) && (
                          <ActionButton
                            onClick={() => void onUserEventAccessChange(user.id, draftEventIds[user.id] || user.assigned_event_ids || [])}
                            disabled={teamLoading}
                            tone="blue"
                            className="text-xs"
                          >
                            <Save className="h-3.5 w-3.5" />
                            Save Event Access
                          </ActionButton>
                        )}
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {events.map((event) => {
                          const selected = (draftEventIds[user.id] || user.assigned_event_ids || []).includes(event.id);
                          return (
                            <label key={event.id} className="flex items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => setDraftEventIds((current) => ({
                                  ...current,
                                  [user.id]: toggleEventId(current[user.id] || user.assigned_event_ids || [], event.id),
                                }))}
                                disabled={!canManageTargetAccess(user) || teamLoading}
                                className="mt-0.5 accent-blue-600"
                              />
                              <span>{event.name}</span>
                            </label>
                          );
                        })}
                      </div>
                      {!events.length && <p className="mt-2 text-xs text-amber-700">No Event is available to assign.</p>}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {canManageUsers && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600" />
              <p className="text-sm font-semibold text-slate-900">Add Team Member</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">Create an account, then limit event-scoped roles to selected Events.</p>
            <div className="mt-3 space-y-2.5">
              <input
                value={newUserDisplayName}
                onChange={(event) => onNewUserDisplayNameChange(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Display name"
              />
              <input
                value={newUserUsername}
                onChange={(event) => onNewUserUsernameChange(event.target.value.toLowerCase())}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="username"
              />
              <input
                type="password"
                value={newUserPassword}
                onChange={(event) => onNewUserPasswordChange(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Temporary password"
              />
              <select
                value={newUserRole}
                onChange={(event) => onNewUserRoleChange(event.target.value as UserRole)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                {manageableRoles
                  .filter((roleOption) => roleOption !== "owner" && (role !== "admin" || roleOption !== "admin"))
                  .map((roleOption) => (
                    <option key={roleOption} value={roleOption}>
                      {roleLabel(roleOption)}
                    </option>
                  ))}
              </select>
              {EVENT_SCOPED_ROLES.includes(newUserRole) && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                  <p className="text-xs font-semibold text-slate-800">Event access</p>
                  <p className="mt-1 text-[11px] text-slate-500">เลือก Event ที่บัญชีนี้จะเข้าถึงได้เท่านั้น</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {events.map((event) => (
                      <label key={event.id} className="flex items-start gap-2 rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={newUserEventIds.includes(event.id)}
                          onChange={() => onNewUserEventIdsChange(toggleEventId(newUserEventIds, event.id))}
                          disabled={teamLoading}
                          className="mt-0.5 accent-blue-600"
                        />
                        <span>{event.name}</span>
                      </label>
                    ))}
                  </div>
                  {!events.length && <p className="mt-2 text-xs text-amber-700">No Event is available to assign.</p>}
                </div>
              )}
              <ActionButton
                onClick={() => void onCreateUser()}
                disabled={teamLoading || !newUserUsername.trim() || !newUserPassword || newUserPassword.length < 8 || (EVENT_SCOPED_ROLES.includes(newUserRole) && !newUserEventIds.length)}
                tone="blue"
                active
                className="w-full text-sm"
              >
                <UserPlus className="w-4 h-4" />
                Create User
              </ActionButton>
            </div>
            {teamMessage && (
              <p className={`mt-4 text-xs ${teamMessage.toLowerCase().includes("failed") || teamMessage.toLowerCase().includes("error") || teamMessage.toLowerCase().includes("exists") ? "text-rose-600" : "text-emerald-600"}`}>
                {teamMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
