export type EventSnapshot = {
  id: string; name: string; status: string; availability: string;
  total: number; active: number; cancelled: number; checkedIn: number; remaining: number | null;
  recentUtcDate?: string; recentUtcCount?: number;
};
export type Diagnostics = { failedDeliveries: number; pendingDeliveries: number; failedAgentActions: number; samplesTruncated: boolean };

export function bangkokSchedule(now: Date, configuredTime = "08:00") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (part: string) => parts.find((value) => value.type === part)?.value || "00";
  const dateKey = [get("year"), get("month"), get("day")].join("-");
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(configuredTime) ? configuredTime : "08:00";
  const [hour, minute] = time.split(":").map(Number);
  return { dateKey, due: minutes >= hour * 60 + minute && minutes < hour * 60 + minute + 120, time };
}

export function reportText(dateKey: string, events: EventSnapshot[], diagnostics: Diagnostics | null) {
  const lines = [
    "📋 FaceBotStudio · รายงานประจำวันที่ " + dateKey,
    "เวลาอ้างอิง: Asia/Bangkok · รายงานจากฐานข้อมูล",
    "อีเวนต์ที่ติดตาม: " + events.length,
  ];
  if (!events.length) lines.push("ไม่พบ Event ที่อยู่ในสถานะดำเนินงานตามขอบเขตการแจ้งเตือน");
  for (const e of events) {
    lines.push("", "• " + e.name.slice(0, 100) + " (" + e.id + ")",
      "สถานะ: " + e.status + " · ลงทะเบียน: " + e.availability,
      "ลงทะเบียนทั้งหมด " + e.total + " · ยังใช้งาน " + e.active + " · ยกเลิก " + e.cancelled + " · เช็กอิน " + e.checkedIn,
      "ที่นั่งคงเหลือ: " + (e.remaining == null ? "ไม่จำกัด" : e.remaining));
    if (e.recentUtcDate) lines.push("ลงทะเบียนวันที่ " + e.recentUtcDate + " (UTC): " + (e.recentUtcCount || 0));
    if (e.availability === "invalid") lines.push("⚠️ กำหนดเวลาเปิดลงทะเบียนไม่ถูกต้อง");
    if (e.availability === "full") lines.push("ℹ️ ที่นั่งเต็ม");
  }
  if (diagnostics) {
    lines.push("", "🔎 บันทึกปัญหาล่าสุด (24 ชม.)",
      "การส่งแจ้งเตือนล้มเหลว: " + diagnostics.failedDeliveries,
      "การแจ้งเตือนค้างส่ง: " + diagnostics.pendingDeliveries,
      "Admin Agent ทำงานล้มเหลว: " + diagnostics.failedAgentActions,
      diagnostics.samplesTruncated
        ? "ตรวจจากรายการล่าสุดบางส่วน จำนวนจริงอาจมากกว่า"
        : "ตรวจเฉพาะเหตุการณ์ที่บันทึกไว้ ไม่ใช่การตรวจทุก error ของเซิร์ฟเวอร์");
  }
  lines.push("", "ถามรายละเอียดเพิ่มเติมในแชต Admin Agent นี้ได้");
  return lines.join("\n").slice(0, 3900);
}

export function criticalIssues(events: EventSnapshot[], diagnostics: Diagnostics) {
  const issues = events.filter(e => e.availability === "invalid")
    .map(e => "• " + e.name.slice(0, 80) + ": ช่วงเวลาลงทะเบียนไม่ถูกต้อง (" + e.id + ")");
  if (diagnostics.failedDeliveries) issues.push("• การแจ้งเตือนล้มเหลว " + diagnostics.failedDeliveries + " รายการใน 24 ชม.");
  if (diagnostics.failedAgentActions) issues.push("• Admin Agent ล้มเหลว " + diagnostics.failedAgentActions + " ครั้งใน 24 ชม.");
  return issues;
}
