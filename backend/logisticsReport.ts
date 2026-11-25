import { attendeeCarpoolRole, type PaidCarpoolPlan } from "./carpoolPlan";
import type { PaidRoomingPlan } from "./db/paidRegistration";

type ReportPlan = { kind: "rooms"; plan: PaidRoomingPlan } | { kind: "carpool"; plan: PaidCarpoolPlan };

export function buildLogisticsReportHtml({ kind, plan, language, eventName, fontCss, escape }: ReportPlan & {
  language: "th" | "en";
  eventName: string;
  fontCss: string;
  escape: (value: unknown) => string;
}) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const title = kind === "rooms" ? t("ผังการจัดห้องพัก", "Room assignments") : t("แผนรถร่วมเดินทาง", "Carpool plan");
  const boxes = (cards: string[]) => cards.length
    ? `<div class="cards">${cards.join("")}</div>`
    : `<p>${t("ยังไม่มีรายการที่จัดไว้", "No assignments yet.")}</p>`;
  // Repeat the heading for long lists so a large room or car fits across pages.
  const cards = (heading: string, detail: string, names: string[]) => {
    const result: string[] = [];
    const perCard = 18;
    for (let start = 0; start < Math.max(1, names.length); start += perCard) {
      result.push(`<article><h2>${escape(heading)}${start ? t(" (ต่อ)", " (continued)") : ""}</h2>
        ${detail ? `<p>${escape(detail)}</p>` : ""}
        ${names.length ? `<ol start="${start + 1}">${names.slice(start, start + perCard).map(name => `<li>${escape(name)}</li>`).join("")}</ol>`
          : `<p>${t("ยังไม่มีผู้โดยสาร", "No passengers assigned.")}</p>`}</article>`);
    }
    return result;
  };

  let summary: string;
  let body: string;
  if (kind === "rooms") {
    const guestNames = new Map(plan.guests.map(guest => [guest.id, guest.name]));
    const assigned = new Set(plan.rooms.flatMap(room => room.slots.filter(id => id && guestNames.has(id))));
    summary = t(`${plan.rooms.length} ห้อง · จัดแล้ว ${assigned.size} คน · รอจัด ${plan.guests.length - assigned.size} คน`,
      `${plan.rooms.length} rooms · ${assigned.size} assigned · ${plan.guests.length - assigned.size} unassigned`);
    body = boxes(plan.rooms.flatMap((room, index) => {
      const beds = room.slots.length;
      const heading = room.number ? t(`ห้อง ${room.number}`, `Room ${room.number}`)
        : t(`ห้องที่ ${index + 1} · รอเลขห้อง`, `Room ${index + 1} · number pending`);
      const names = room.slots.map(id => id ? guestNames.get(id) ?? t("ตรวจสอบชื่อผู้พัก", "Check guest record") : t("ว่าง", "Vacant"));
      return cards(heading, t(`${beds} เตียง`, `${beds} beds`), names);
    }));
  } else {
    const byId = new Map(plan.attendees.map(attendee => [attendee.id, attendee.name]));
    const assigned = new Set(plan.cars.flatMap(car => car.passengers));
    const waiting = plan.attendees.filter(attendee =>
      attendeeCarpoolRole(attendee, plan.roles) === "passenger" && !assigned.has(attendee.id));
    summary = t(`${plan.cars.length} คัน · จัดรถแล้ว ${assigned.size} คน · รอรถ ${waiting.length} คน`,
      `${plan.cars.length} cars · ${assigned.size} passengers assigned · ${waiting.length} waiting`);
    body = boxes(plan.cars.flatMap((car, index) => {
      const driver = byId.get(car.driverId) ?? t("ตรวจสอบชื่อคนขับ", "Check driver record");
      const vacant = car.seats - car.passengers.length;
      const seats = t(`ที่นั่งผู้โดยสาร ${car.seats} · ว่าง ${vacant}`, `${car.seats} passenger seats · ${vacant} open`);
      const detail = car.pickup ? `${seats} · ${t("จุดนัดพบ", "Pickup")} ${car.pickup}` : seats;
      const passengers = car.passengers.map(id => byId.get(id) ?? t("ตรวจสอบชื่อผู้โดยสาร", "Check passenger record"));
      return cards(t(`รถคันที่ ${index + 1} · คนขับ ${driver}`, `Car ${index + 1} · Driver ${driver}`), detail, passengers);
    }));
    if (waiting.length) {
      body += boxes(cards(t("ผู้โดยสารที่ยังไม่ได้จัดรถ", "Unassigned passengers"), "", waiting.map(attendee => attendee.name)));
    }
  }

  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${title}</title><style>
    ${fontCss}
    @page { size: A4; margin: 13mm; }
    body { font: 11pt "Noto Sans Thai", sans-serif; color: #17253a; }
    header { border-bottom: 2pt solid #286192; margin-bottom: 12pt; padding-bottom: 8pt; }
    h1 { font-size: 20pt; margin: 0 0 4pt; }
    h2 { font-size: 11pt; margin: 0; background: #e8f0fa; border-bottom: 1pt solid #a9c0d8; padding: 6pt 8pt; }
    p { margin: 3pt 0; }
    .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8pt; align-items: start; margin-bottom: 8pt; }
    article { border: 1pt solid #a9c0d8; border-radius: 5pt; break-inside: avoid; overflow-wrap: anywhere; }
    article p { padding: 1pt 8pt; font-size: 10pt; }
    ol { margin: 6pt 8pt 7pt 26pt; padding: 0; }
    li { padding-bottom: 2pt; }
  </style></head><body><header><h1>${title}</h1><p>${escape(eventName)}</p><p>${escape(summary)}</p></header>${body}</body></html>`;
}
