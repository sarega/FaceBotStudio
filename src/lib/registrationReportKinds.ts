export const registrationReportTitles = {
  accounting: ["สรุปยอดสำหรับบัญชี", "Registration accounting"],
  followup: ["ติดตามการชำระ", "Payment follow-up"],
  coupons: ["คูปองและแขก VIP", "Coupons and VIP guests"],
  attendees: ["รายชื่อและอาหาร", "Attendee and meal roster"],
} as const;

export type ReportKind = keyof typeof registrationReportTitles;
export function isRegistrationReportKind(value: unknown): value is ReportKind {
  return typeof value === "string" && Object.hasOwn(registrationReportTitles, value);
}
