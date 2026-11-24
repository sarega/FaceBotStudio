import type { UserRole } from "../types";

export const STAFF_PREVIEW_ROLES = ["admin", "operator", "cashier", "checker", "viewer"] as const satisfies readonly UserRole[];
export type StaffPreviewRole = typeof STAFF_PREVIEW_ROLES[number];
export type PreviewRole = StaffPreviewRole | "user";

export const ROLE_PREVIEW_HEADER = "x-meetrix-preview-role";
export const ROLE_PREVIEW_EVENT_HEADER = "x-meetrix-preview-event";

export function isStaffPreviewRole(value: unknown): value is StaffPreviewRole {
  return STAFF_PREVIEW_ROLES.some(role => role === value);
}

export function readRolePreview(location: Pick<Location, "pathname" | "search">) {
  const params = new URLSearchParams(location.pathname === "/" ? location.search : "");
  const value = params.get("view_as");
  const role: PreviewRole | null = isStaffPreviewRole(value) || value === "user" ? value : null;
  return { role, eventId: params.get("preview_event") || "" };
}
