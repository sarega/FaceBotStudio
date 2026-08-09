import assert from "node:assert/strict";
import test from "node:test";
import { calculateOrderPricing } from "./commerce";

test("order pricing uses fixed-precision satang arithmetic and snapshots fee/tax inputs", () => {
  const pricing = calculateOrderPricing({
    seatPrices: [99.99, 0.01],
    feeEnabled: true,
    feeType: "percent",
    feeValue: 3,
    taxRatePercent: 7,
    paymentFeeValue: 2.5,
  });
  assert.equal(pricing.subtotal_amount, 100);
  assert.equal(pricing.platform_fee_amount, 3);
  assert.equal(pricing.payment_fee_amount, 2.5);
  assert.equal(pricing.tax_amount, 7.39);
  assert.equal(pricing.total_amount, 112.89);
  assert.match(pricing.tax_snapshot_json, /"rate_percent":7/);
});
