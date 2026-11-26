export const ALL_USER_ROLES = ["owner", "admin", "operator", "cashier", "checker", "viewer", "logistics"] as const;
export type UserRole = (typeof ALL_USER_ROLES)[number];

export function isEventAssignedRole(role: UserRole) {
  return role !== "owner" && role !== "admin";
}
export function isEventScopedUser(user: { role: UserRole; event_scope?: "all" | "selected" }) {
  return isEventAssignedRole(user.role) || (user.role === "admin" && user.event_scope === "selected");
}
