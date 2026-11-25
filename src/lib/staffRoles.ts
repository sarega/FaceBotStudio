export const ALL_USER_ROLES = ["owner", "admin", "operator", "cashier", "checker", "viewer", "logistics"] as const;
export type UserRole = (typeof ALL_USER_ROLES)[number];

export function isEventAssignedRole(role: UserRole) {
  return role !== "owner" && role !== "admin";
}
