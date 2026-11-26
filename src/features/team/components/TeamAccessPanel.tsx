import { useEffect, useState } from "react";
import { CalendarRange, RefreshCw, Save, Shield, Trash2, UserPlus } from "lucide-react";

import { ActionButton, StatusLine } from "../../../components/shared/AppUi";
import type { AuthUser, EventRecord, UserRole } from "../../../types";
import { isEventAssignedRole } from "../../../lib/staffRoles";

function roleLabel(role: UserRole) {
  if (role === "logistics") return "Room & Transport Coordinator (ผู้จัดห้องและรถ)";
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
  newUserEmail: string;
  onNewUserEmailChange: (value: string) => void;
  newUserRole: UserRole;
  onNewUserRoleChange: (value: UserRole) => void;
  newUserEventIds: string[];
  onNewUserEventIdsChange: (value: string[]) => void;
  canManageTargetRole: (user: AuthUser) => boolean;
  canManageTargetAccess: (user: AuthUser) => boolean;
  canDeleteTeamUser: (user: AuthUser) => boolean;
  onRefresh: () => void | Promise<void>;
  onUserPermissionsChange: (userId: string, role: UserRole, scope: "all" | "selected", eventIds: string[]) => void | Promise<void>;
  onUserRoleChange: (userId: string, role: UserRole) => void | Promise<void>;
  onUserEventAccessChange: (userId: string, eventIds: string[]) => void | Promise<void>;
  onUserAccessToggle: (userId: string, nextIsActive: boolean) => void | Promise<void>;
  onDeleteUser: (user: AuthUser) => void | Promise<void>;
  onResendInvite: (userId: string) => void | Promise<void>;
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
  newUserEmail,
  onNewUserEmailChange,
  newUserRole,
  onNewUserRoleChange,
  newUserEventIds,
  onNewUserEventIdsChange,
  canManageTargetRole,
  canManageTargetAccess,
  canDeleteTeamUser,
  onRefresh,
  onUserRoleChange,
  onUserPermissionsChange,
  onUserEventAccessChange,
  onUserAccessToggle,
  onDeleteUser,
  onCreateUser,
  onResendInvite,
}: TeamAccessPanelProps) {
  const [draftRoles, setDraftRoles] = useState<Record<string, UserRole>>({});
  const [draftScopes, setDraftScopes] = useState<Record<string, "all" | "selected">>({});
  const [draftEventIds, setDraftEventIds] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setDraftRoles(Object.fromEntries(teamUsers.map(user => [user.id, user.role])));
    setDraftScopes(Object.fromEntries(teamUsers.map(user => [user.id, user.role === "admin" && user.event_scope !== "selected" ? "all" : "selected"])));
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
              User & Permission Manager
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
        {teamMessage && <p role="status" className="mt-3 text-sm text-slate-800">{teamMessage}</p>}
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
              teamUsers.map((user) => {
                const ownerEditing = role === "owner" && canManageTargetRole(user);
                const draftRole = draftRoles[user.id] || user.role;
                const draftScope = draftRole === "admin" ? draftScopes[user.id] || "all" : "selected";
                return (
                <div key={user.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{user.display_name}</p>
                      <p className="mt-1 text-xs text-slate-500">{user.username}</p>
                      <p className="mt-1 break-all text-sm text-slate-700">
                        {user.staff_email ? `${user.staff_email} · Verified` : user.pending_invite_email || "Email unverified"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <StatusLine
                        items={[
                          user.is_active ? (user.pending_invite_email ? "invited" : "active") : "disabled",
                          roleLabel(user.role),
                        ]}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div>
                      {canManageTargetRole(user) ? (
                        <select
                          aria-label="Account role"
                          value={ownerEditing ? draftRole : user.role}
                          onChange={(event) => { const next = event.target.value as UserRole; if (ownerEditing) { setDraftRoles(current => ({ ...current, [user.id]: next })); if (next !== "admin") setDraftScopes(current => ({ ...current, [user.id]: "selected" })); } else void onUserRoleChange(user.id, next); }}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={teamLoading}
                        >
                          {manageableRoles
                            .filter((roleOption) => roleOption !== "owner" && (authUser?.role === "owner" || roleOption !== "admin"))
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
                        {user.is_active && user.pending_invite_email && canManageTargetAccess(user) && (
                          <ActionButton onClick={() => void onResendInvite(user.id)} disabled={teamLoading} tone="neutral">
                            Resend invitation
                          </ActionButton>
                        )}
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

                  {(ownerEditing || isEventAssignedRole(user.role)) && (
                    <div className="rounded-xl border border-blue-100 bg-white p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <CalendarRange className="h-4 w-4 text-blue-600" />
                          <div>
                            <p className="text-xs font-semibold text-slate-800">Event access</p>
                            <p className="text-[11px] text-slate-500">
                              {draftScope === "all" && ownerEditing ? "All Events" : `${(draftEventIds[user.id] || user.assigned_event_ids || []).length} selected Event(s)`}
                            </p>
                          </div>
                        </div>
                        {canManageTargetAccess(user) && (
                          <ActionButton
                            onClick={() => void (ownerEditing ? onUserPermissionsChange(user.id, draftRole, draftScope, draftEventIds[user.id] || []) : onUserEventAccessChange(user.id, draftEventIds[user.id] || user.assigned_event_ids || []))}
                            disabled={teamLoading}
                            tone="blue"
                            className="text-xs"
                          >
                            <Save className="h-3.5 w-3.5" />
                            {ownerEditing ? "Save Role & Access" : "Save Event Access"}
                          </ActionButton>
                        )}
                      </div>
                      {ownerEditing && draftRole === "admin" && <select aria-label="Admin event scope" className="mt-3 w-full rounded-lg border p-2 text-sm" value={draftScope} onChange={event => setDraftScopes(current => ({ ...current, [user.id]: event.target.value as "all" | "selected" }))}><option value="all">All Events</option><option value="selected">Selected Events Only</option></select>}
                      {(!ownerEditing || draftScope === "selected") && <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                      </div>}
                      {!events.length && <p className="mt-2 text-xs text-amber-700">No Event is available to assign.</p>}
                    </div>
                  )}
                </div>
              ); })
            )}
          </div>
        </div>

        {canManageUsers && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600" />
              <p className="text-sm font-semibold text-slate-900">Add Team Member</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">Invite a staff member and choose which events they can access.</p>
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
                type="email"
                aria-label="Staff email"
                autoComplete="off"
                value={newUserEmail}
                onChange={(event) => onNewUserEmailChange(event.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Staff email"
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
              {isEventAssignedRole(newUserRole) && (
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
                disabled={teamLoading || !newUserUsername.trim() || !newUserEmail.trim() || (isEventAssignedRole(newUserRole) && !newUserEventIds.length)}
                tone="blue"
                active
                className="w-full text-sm"
              >
                <UserPlus className="w-4 h-4" />
                Send invitation
              </ActionButton>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
