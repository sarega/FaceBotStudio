import assert from "node:assert/strict";
import test from "node:test";
import { couponDiscount, normalizeCouponCode, validateCoupon } from "./paidCoupons";

test("coupon math uses exact integer minor units and caps fixed/free discounts", () => {
  assert.equal(couponDiscount("percent", 2000, 340000), 68000);
  assert.equal(couponDiscount("percent", 3333, 101), 33);
  assert.equal(couponDiscount("percent", 10000, 340000), 340000);
  assert.equal(couponDiscount("fixed", 50000, 25000), 25000);
  assert.equal(couponDiscount("fixed", 12000, 340000), 12000);
  assert.equal(couponDiscount("free", 0, 340000), 340000);
});
test("coupon configuration normalizes names and rejects invalid rules", () => {
  const base = {code:" special20 ",kind:"percent" as const,value_minor:2000,
    max_uses:100,per_customer_limit:1,starts_ms:null,ends_ms:null,enabled:true};
  assert.equal(normalizeCouponCode(base.code),"SPECIAL20");
  assert.equal(validateCoupon(base).code,"SPECIAL20");
  assert.throws(()=>validateCoupon({...base,value_minor:10001}),/invalid_coupon/);
  assert.throws(()=>validateCoupon({...base,code:"??"}),/invalid_coupon/);
  assert.throws(()=>validateCoupon({...base,max_uses:0}),/invalid_coupon/);
  assert.throws(()=>validateCoupon({...base,starts_ms:200,ends_ms:100}),/invalid_coupon/);
});
