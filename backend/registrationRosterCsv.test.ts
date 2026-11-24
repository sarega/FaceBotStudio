import assert from "node:assert/strict";
import test from "node:test";
import type { RegistrationRow } from "./db/types";
import { buildRegistrationRosterCsv } from "./registrationRosterCsv";

test("team CSV filters and deduplicates active registrations across exports", () => {
  const legacy: RegistrationRow = {
    id: "legacy-secret", sender_id: "chat-secret", first_name: "Mali", last_name: "Test",
    phone: "+66 81 234 5678", email: "", status: "registered", timestamp: "2026-11-23T00:00:00Z",
  };
  const paid = [
    { first_name: "Mali", last_name: "Test", booking_state: "confirmed", attendee_phone: "0812345678",
      category_label: "เด็ก", unit_minor: 170000, answers: { food: "มังสวิรัติ" }, booking_reference: "booking-secret" },
    { first_name: "mali", last_name: "test", booking_state: "awaiting_payment", attendee_phone: "0812345678" },
    { first_name: "Mali", last_name: "Test", booking_state: "awaiting_payment", attendee_phone: "0899999999" },
    { first_name: "Pending", last_name: "Guest", booking_state: "verification_pending",
      unit_minor: 0, booking_email: "booker@example.com", customer_email: "account@example.com",
      booking_answers: { food: "=1+1" } },
    { first_name: "Exception", booking_state: "payment_exception" },
    { first_name: "Flagged", booking_state: "confirmed", price_flagged: true, customer_id: "flagged-account", booked_ms: 2 },
    { first_name: "Flagged", booking_state: "confirmed", customer_id: "flagged-account", booked_ms: 1 },
    { first_name: "Expired", booking_state: "expired" },
    { first_name: "Cancelled", booking_state: "cancelled" },
    { first_name: "Removed", booking_state: "confirmed", cancelled_ms: 1 },
    { first_name: "Refunded", booking_state: "confirmed", payment_state: "refunded" },
  ];
  const cancelledLegacy = { ...legacy, first_name: "Old", status: "cancelled" as const };
  const active = buildRegistrationRosterCsv([legacy, cancelledLegacy], paid, "active", "th");
  assert.equal(active.count, 4);
  assert.ok(active.csv.startsWith('\uFEFF"ชื่อ","นามสกุล","สถานะ","ประเภทบัตร","ราคาต่อคน (บาท)","อาหาร","โทรศัพท์","อีเมล"'));
  assert.match(active.csv, /"Mali","Test","ยืนยันแล้ว","เด็ก","1700\.00","มังสวิรัติ","0812345678"/);
  assert.match(active.csv, /"0\.00","'=1\+1","","booker@example\.com"/);
  assert.doesNotMatch(active.csv, /secret|Expired|Cancelled|Removed|Refunded|Flagged|Old|account@example/);

  const confirmed = buildRegistrationRosterCsv([legacy], paid, "confirmed", "en");
  const pending = buildRegistrationRosterCsv([legacy], paid, "pending", "en");
  assert.equal(confirmed.count, 1);
  assert.equal(pending.count, 3);
  assert.doesNotMatch(pending.csv, /0812345678/);
  assert.match(pending.csv, /0899999999/);
  assert.match(pending.csv, /Slip under review/);
  assert.match(pending.csv, /Payment needs review/);
  assert.equal(buildRegistrationRosterCsv([], [], "active", "en").csv.split("\n").length, 1);
});
