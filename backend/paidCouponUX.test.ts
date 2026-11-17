import assert from "node:assert/strict";
import test from "node:test";
import { couponErrorMessage } from "../src/features/public-event/components/PaidRegistrationPanel";

test("coupon feedback distinguishes expired, limits, stale pricing and server faults", () => {
  for (const code of ["coupon_unavailable", "coupon_exhausted", "coupon_invalid", "quote_stale",
    "invalid_seminar_answers", "CUSTOMER_NOT_AUTHENTICATED", "coupon_quote_failed",
    "CSRF validation failed", "CSRF token validation failed"]) {
    const thai = couponErrorMessage(code, "th");
    const english = couponErrorMessage(code, "en");
    assert.ok(thai.length > 16, code);
    assert.ok(english.length > 16, code);
    assert.notEqual(thai, english);
    assert.ok(!thai.includes("Coupon could not be applied"));
  }
  assert.match(couponErrorMessage("some_unexpected_error", "en"), /some_unexpected_error/);
});
