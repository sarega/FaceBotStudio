import assert from "node:assert/strict";
import test from "node:test";
import { buildRegistrationReportHtml } from "./registrationReports";
import { buildRegistrationRosterCsv } from "./registrationRosterCsv";
import type { RegistrationRow } from "./db/types";
import type { ReportKind } from "../src/lib/registrationReportKinds";

const snapshot = {
  booking_id: "booking-1", booking_reference: "booking-reference-1", report_booking_state: "confirmed",
  booking_state: "confirmed", booking_total_minor: 1_000_00, verified_cash_minor: 500_00,
  coupon_discount_minor: 100_00, coupon_code: "EXAMPLE",
};

const paid = [
  { ...snapshot, first_name: "Mali", last_name: "Tester", category_label: "VIP", answers: { food: "Vegetarian" } },
  { ...snapshot, first_name: "Boon", last_name: "Tester", category_label: "Standard", booking_answers: { food: "มังสวิรัติ" } },
  { ...snapshot, first_name: "Removed", cancelled_ms: 1, booking_state: "cancelled" },
  { ...snapshot, booking_id: "booking-2", booking_reference: "booking-reference-2", report_booking_state: "verification_pending",
    booking_state: "verification_pending", booking_total_minor: 500_00, verified_cash_minor: 0,
    coupon_discount_minor: 0, coupon_code: null, report_pending_proofs: 1, first_name: "Slip holder" },
];

function report(kind: ReportKind) {
  return buildRegistrationReportHtml({
    kind, language: "en", eventName: "<Fixture>", generatedAt: Date.parse("2026-11-24T01:00:00Z"),
    paid, legacy: [], fontCss: "", escape: value => String(value ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  });
}

test("registration PDFs count financial amounts once per booking and keep attendee details", () => {
  const accounting = report("accounting");
  assert.match(accounting, /Bookings<strong>2<\/strong>/);
  assert.match(accounting, /Coupon discounts<strong>THB\s*100\.00<\/strong>/);
  assert.match(accounting, /Verified receipts<strong>THB\s*500\.00<\/strong>/);
  assert.match(accounting, /&lt;Fixture&gt;/);
  const followup = report("followup");
  assert.match(followup, /Additional amount due<\/h2><p>1 bookings/);
  assert.match(followup, /Slip awaiting review<\/h2><p>1 bookings/);
  assert.match(report("coupons"), /Mali Tester · VIP/);
  assert.match(report("coupons"), /Boon Tester · Standard/);
  assert.doesNotMatch(report("coupons"), /Removed/);
  const meals=report("attendees");
  assert.match(meals, /Vegetarian<\/h2><strong>2<\/strong>/);
  assert.match(meals, /Unspecified<\/h2><strong>1<\/strong>/);
  assert.match(meals, /Non-vegetarian<\/h2><strong>0<\/strong>/);
  assert.match(meals, /Mali Tester/);
  assert.match(meals, /Slip holder/);
  assert.doesNotMatch(meals, /booking-reference-|Removed/);
  assert.match(meals, /A4 portrait/);
});

test("active PDF and CSV use the same roster, including unpaid bookings", () => {
  const roster = [
    ...paid,
    { first_name: "Awaiting guest", booking_state: "awaiting_payment", attendee_phone: "0812345678", unit_minor: 170000 },
    { first_name: "Needs review", booking_state: "payment_exception" },
    { first_name: "Cancelled guest", booking_state: "cancelled" },
    { first_name: "Expired guest", booking_state: "expired" },
    { first_name: "Refunded guest", booking_state: "confirmed", payment_state: "refunded" },
    { first_name: "Flagged guest", booking_state: "confirmed", price_flagged: true },
    { first_name: "Awaiting guest", booking_state: "awaiting_payment", attendee_phone: "0812345678" },
  ];
  const legacy: RegistrationRow[] = [
    { id: "free-attendee", sender_id: "", first_name: "Free guest", last_name: "", email: "", phone: "",
      status: "registered", timestamp: "2026-11-23T00:00:00Z" },
  ];
  const csv = buildRegistrationRosterCsv(legacy, roster, "active", "en");
  const pdf = buildRegistrationReportHtml({
    kind: "active_roster", language: "en", eventName: "Fixture", generatedAt: 0,
    paid: roster, legacy, fontCss: "", escape: value => String(value ?? ""),
  });
  assert.equal(csv.count, 6);
  assert.match(pdf, /6 attendees · confirmed, awaiting payment and under review/);
  assert.match(pdf, /Total booking value<strong>THB\s*1,500\.00<\/strong>/);
  assert.match(pdf, /Verified payments<strong>THB\s*500\.00<\/strong>/);
  assert.match(pdf, /Total outstanding<strong>THB\s*1,000\.00<\/strong>/);
  for (const name of ["Mali", "Boon", "Slip holder", "Awaiting guest", "Needs review", "Free guest"]) {
    assert.ok(csv.csv.includes(name));
    assert.ok(pdf.includes(name));
  }
  assert.match(pdf, /Awaiting guest<\/td><td>—<\/td><td>Awaiting payment<\/td>/);
  assert.match(pdf, /1700\.00/);
  assert.match(pdf, /0812345678/);
  assert.equal(pdf.split("Awaiting guest").length - 1, 1);
  for (const name of ["Cancelled guest", "Expired guest", "Refunded guest", "Removed", "Flagged guest"]) {
    assert.ok(!csv.csv.includes(name));
    assert.ok(!pdf.includes(name));
  }
});
