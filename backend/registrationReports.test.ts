import assert from "node:assert/strict";
import test from "node:test";
import { buildRegistrationReportHtml } from "./registrationReports";
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
  assert.match(report("attendees"), /Vegetarian 2/);
  assert.match(report("attendees"), /Not yet confirmed<\/h2><p>1 attendees · Unspecified 1/);
});
