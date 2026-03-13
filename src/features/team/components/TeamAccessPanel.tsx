import { RefreshCw, Shield, Trash2, UserPlus } from "lucide-react";

import { ActionButton, StatusLine } from "../../../components/shared/AppUi";
import type { AuthUser, UserRole } from "../../../types";

type TeamAccessPanelProps = {
  role: UserRole | undefined;
  authUser: AuthUser | null;
  teamLoading: boolean;
  teamUsers: AuthUser[];
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
  canManageTargetRole: (user: AuthUser) => boolean;
  canManageTargetAccess: (user: AuthUser) => boolean;
  canDeleteTeamUser: (user: AuthUser) => boolean;
  onRefresh: () => void | Promise<void>;
  onUserRoleChange: (userId: string, role: UserRole) => void | Promise<void>;
  onUserAccessToggle: (userId: string, nextIsActive: boolean) => void | Promise<void>;
  onDeleteUser: (user: AuthUser) => void | Promise<void>;
  onCreateUser: () => void | Promise<void>;
};

export function TeamAccessPanel({
  role,
  authUser,
  teamLoading,
  teamUsers,
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
  canManageTargetRole,
  canManageTargetAccess,
  canDeleteTeamUser,
  onRefresh,
  onUserRoleChange,
  onUserAccessToggle,
  onDeleteUser,
  onCreateUser,
}: TeamAccessPanelProps) {
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
                          user.role,
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
                                {roleOption}
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
            <p className="mt-1 text-xs text-slate-500">Create a new admin workspace account with a role and temporary password.</p>
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
                      {roleOption}
                    </option>
                  ))}
              </select>
              <ActionButton
                onClick={() => void onCreateUser()}
                disabled={teamLoading || !newUserUsername.trim() || !newUserPassword || newUserPassword.length < 8}
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
