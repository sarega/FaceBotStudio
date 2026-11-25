export const registrationReportTitles = {
  accounting: ["สรุปยอดสำหรับบัญชี", "Registration accounting"],
  followup: ["ติดตามการชำระ", "Payment follow-up"],
  coupons: ["คูปองและแขก VIP", "Coupons and VIP guests"],
  attendees: ["รายชื่อและอาหาร", "Attendee and meal roster"],
  active_roster: ["รายชื่อยืนยันแล้ว + รอชำระ/รอตรวจ", "Confirmed + awaiting payment/review"],
} as const;

export type ReportKind = keyof typeof registrationReportTitles;
export function isRegistrationReportKind(value: unknown): value is ReportKind {
  return typeof value === "string" && Object.hasOwn(registrationReportTitles, value);
}

export const registrationRosterCsvTitles = {
  active: ["ยืนยันแล้ว + รอชำระ/รอตรวจ (CSV)", "Confirmed + awaiting payment/review (CSV)"],
  confirmed: ["ลงทะเบียนแล้ว / ยืนยันแล้ว (CSV)", "Registered / confirmed (CSV)"],
  pending: ["รอชำระ / รอตรวจ (CSV)", "Awaiting payment / review (CSV)"],
} as const;

export type RosterCsvKind = keyof typeof registrationRosterCsvTitles;
export function isRosterCsvKind(value: unknown): value is RosterCsvKind {
  return typeof value === "string" && Object.hasOwn(registrationRosterCsvTitles, value);
}
