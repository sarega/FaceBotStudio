export function parsePaidMessengerCommand(text: string) {
  const normalized = text.trim();
  if (/^(paid prices|ราคาจอง)$/i.test(normalized)) {
    return { action: "prices" as const, thai: normalized === "ราคาจอง" };
  }
  const draft = /^(paid book|จองแบบชำระเงิน)\s+([^\n]+)$/i.exec(normalized);
  if (draft) {
    const attendees = draft[2].split(";").map((entry) => entry.split("|").map((part) => part.trim()));
    if (attendees.length <= 100 && attendees.every((parts) => parts.length === 3 && /^[\w-]{1,128}$/.test(parts[0]) &&
        parts[1].length > 0 && parts[1].length <= 180 && parts[2].length > 0 && parts[2].length <= 180)) {
      return { action: "draft" as const, thai: draft[1] === "จองแบบชำระเงิน",
        attendees: attendees.map(([categoryId, firstName, lastName]) => ({ categoryId, firstName, lastName })) };
    }
    return { action: "help" as const, thai: draft[1] === "จองแบบชำระเงิน" };
  }
  const confirm = /^(paid confirm|confirm (?:my |the )?booking|ยืนยันจอง|ยืนยันการจอง)\s+([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(normalized);
  if (confirm) return { action: "confirm" as const, thai: /[ก-๙]/.test(confirm[1]), draftId: confirm[2].toLowerCase() };
  const status = /^(paid status|สถานะจอง|paid proof|ส่งสลิปจอง|paid qr|คิวอาร์จอง)\s+([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(normalized);
  if (status) {
    const command = status[1].toLowerCase();
    const action = ["paid proof", "ส่งสลิปจอง"].includes(command) ? "proof" as const
      : ["paid qr", "คิวอาร์จอง"].includes(command) ? "qr" as const : "status" as const;
    return { action, thai: /[ก-๙]/.test(command), reference: status[2].toLowerCase() };
  }
  // Parse only declarations with a category and explicit names. Ambiguous requests get a clarification.
  const english = /^(?:(?:i(?:'d| would) like to|please|can i) )?(?:book|reserve) (\d{1,3}) (?:places?|spots?|seats?) (?:in|under) ([\w-]{1,128}) for (.+?)[.!?]?$/i.exec(normalized);
  const thai = /^(?:ขอ|อยาก)?จอง(?:ที่)?\s*(\d{1,3})\s*(?:คน|ที่)\s*หมวด\s*([\w-]{1,128})\s*(?:ชื่อ|รายชื่อ)\s*(.+?)[.!?]?$/u.exec(normalized);
  const request = english ?? thai;
  if (request) {
    const names = request[3].split(/\s*(?:,|;| และ | and )\s*/iu);
    const attendees = names.map((name) => {
      const parts = name.trim().split(/\s+/u);
      return { categoryId: request[2], firstName: parts[0], lastName: parts.slice(1).join(" ") };
    });
    if (attendees.length === Number(request[1]) && attendees.length <= 100 && attendees.every(({ firstName, lastName }) =>
      firstName && firstName.length <= 180 && lastName && lastName.length <= 180 &&
      /^[\p{L}\p{M}.'’ -]+$/u.test(`${firstName} ${lastName}`))) {
      return { action: "draft" as const, thai: Boolean(thai), natural: true, attendees };
    }
    return { action: "help" as const, thai: Boolean(thai), natural: true };
  }
  if (/^(?:(?:i(?:'d| would) like to|please|can i) )?(?:book|reserve)(?:\s|$)/i.test(normalized) ||
      /^(?:ขอ|อยาก)?จอง(?:ที่|เข้าร่วม|\s|$)/u.test(normalized)) {
    return { action: "help" as const, thai: /[ก-๙]/.test(normalized), natural: true };
  }
  return undefined;
}

const stateLabels: Record<string, [string, string]> = {
  awaiting_payment: ["รอชำระเงิน", "Awaiting payment"],
  verification_pending: ["รอตรวจสอบการชำระเงิน", "Payment pending verification"],
  confirmed: ["ยืนยันการจองแล้ว", "Booking confirmed"],
  expired: ["หมดเวลาชำระ", "Payment deadline expired"],
  cancelled: ["ยกเลิกแล้ว", "Cancelled"],
  payment_exception: ["รายการอยู่ระหว่างตรวจสอบ", "Payment under investigation"],
};

export function paidMessengerStatusText(
  booking: { state: string; totalMinor: number; dueMs: number },
  thai: boolean,
  timeZone: string,
) {
  const amount = new Intl.NumberFormat(thai ? "th-TH" : "en-TH", { currency: "THB", style: "currency" }).format(booking.totalMinor / 100);
  const label = stateLabels[booking.state]?.[thai ? 0 : 1] ?? (thai ? "สถานะไม่พร้อมใช้งาน" : "Status unavailable");
  if (booking.state !== "awaiting_payment") return label;
  const due = new Intl.DateTimeFormat(thai ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(booking.dueMs);
  return thai ? `${label} ${amount} ชำระภายใน ${due} (${timeZone})` : `${label}: ${amount}. Pay by ${due} (${timeZone}).`;
}
