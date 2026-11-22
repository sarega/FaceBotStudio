import type { AppLanguage } from "../../../lib/i18n";

export type RosterStatus = "confirmed" | "registered" | "checked-in" | "awaiting_payment" | "verification_pending" | "expired" | "cancelled" | "payment_exception";

const labels: Record<RosterStatus, Record<AppLanguage, string>> = {
  registered: { th: "ลงทะเบียนแล้ว", en: "Registered" },
  confirmed: { th: "ยืนยันแล้ว", en: "Confirmed" },
  "checked-in": { th: "เช็กอินแล้ว", en: "Checked in" },
  awaiting_payment: { th: "รอชำระ", en: "Awaiting payment" },
  verification_pending: { th: "รอตรวจสลิป", en: "Slip under review" },
  expired: { th: "หมดอายุ", en: "Expired" },
  cancelled: { th: "ยกเลิก", en: "Cancelled" },
  payment_exception: { th: "ต้องตรวจสอบ", en: "Needs follow-up" },
};

export function getRosterStatus(state: string, checkedIn = false): RosterStatus {
  if (state === "cancelled" || state === "expired") return state;
  if (checkedIn || state === "checked-in") return "checked-in";
  return Object.hasOwn(labels, state) ? state as RosterStatus : "payment_exception";
}

export function rosterStatusLabel(status: RosterStatus, language: AppLanguage) {
  return labels[status][language];
}

export function RegistrationStatusTag({ status, language }: { status: RosterStatus; language: AppLanguage }) {
  return <span data-registration-status={status} className="registration-status-tag">
    {rosterStatusLabel(status, language)}
  </span>;
}
