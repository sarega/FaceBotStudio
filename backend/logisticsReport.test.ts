import assert from "node:assert/strict";
import test from "node:test";
import { buildLogisticsReportHtml } from "./logisticsReport";

const options = {
  language: "th" as const,
  eventName: "ทดสอบ & โรงแรม",
  fontCss: "",
  escape: (text: unknown) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
};

test("the room report keeps each room's guest list under its own heading", () => {
  const guest = { bookingId: "booking-secret", bookingState: "confirmed", checkedIn: false, category: "",
    accommodation: "yes" as const, preference: "", single: false, needsGuardianReview: false };
  const report = buildLogisticsReportHtml({ ...options, kind: "rooms", plan: {
    version: 1,
    rooms: [
      { id: "room-a", number: "401", locked: false, slots: ["a", "b", null, null, null] },
      { id: "room-b", number: "", locked: false, slots: ["c"] },
    ],
    guests: [{ ...guest, id: "a", name: "แขก A" }, { ...guest, id: "b", name: "แขก B" }, { ...guest, id: "c", name: "แขก C" }],
  } });
  assert.match(report, /<article><h2>ห้อง 401<\/h2>[\s\S]*?<li>แขก A<\/li><li>แขก B<\/li><li>ว่าง<\/li>/);
  assert.match(report, /<article><h2>ห้องที่ 2 · รอเลขห้อง<\/h2>[\s\S]*?<li>แขก C<\/li>/);
  assert.match(report, /ทดสอบ &amp; โรงแรม/);
  assert.doesNotMatch(report, /booking-secret|room-a/);
});

test("the carpool report groups passengers by car and lists waiting riders separately", () => {
  const attendee = { reference: "booking-secret", bookingState: "confirmed", checkedIn: false, answer: "" };
  const report = buildLogisticsReportHtml({ ...options, kind: "carpool", plan: {
    version: 1, roles: {}, cars: [{ driverId: "d", seats: 3, pickup: "Lobby <B>", passengers: ["p"] }],
    attendees: [
      { ...attendee, id: "d", name: "คนขับ", defaultRole: "driver" },
      { ...attendee, id: "p", name: "ผู้โดยสาร", defaultRole: "passenger" },
      { ...attendee, id: "w", name: "แขกรอรถ", defaultRole: "passenger" },
      { ...attendee, id: "i", name: "แขกเดินทางเอง", defaultRole: "independent" },
    ],
  } });
  assert.match(report, /รถคันที่ 1 · คนขับ คนขับ[\s\S]*ว่าง 2 · จุดนัดพบ Lobby &lt;B&gt;[\s\S]*<li>ผู้โดยสาร<\/li>/);
  assert.match(report, /ผู้โดยสารที่ยังไม่ได้จัดรถ[\s\S]*<li>แขกรอรถ<\/li>/);
  assert.doesNotMatch(report, /booking-secret|แขกเดินทางเอง/);
});
