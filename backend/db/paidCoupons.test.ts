import assert from "node:assert/strict";
import test from "node:test";
import { couponAvailabilityStatus, applyCoupon, couponDiscount, normalizeCouponCode, validateCoupon } from "./paidCoupons";

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

test("server distinguishes coupon not found, disabled, future, expired and active", () => {
  const now=1794900000000;
  assert.equal(couponAvailabilityStatus({enabled:1},now),"active");
  assert.equal(couponAvailabilityStatus({enabled:"1",starts_ms:String(now-1000),ends_ms:String(now+1000)},now),"active");
  assert.equal(couponAvailabilityStatus({enabled:0},now),"disabled");
  assert.equal(couponAvailabilityStatus({enabled:1,starts_ms:now+1000},now),"scheduled");
  assert.equal(couponAvailabilityStatus({enabled:1,ends_ms:now},now),"expired");
  assert.equal(couponAvailabilityStatus({enabled:1,max_uses:10,uses:10},now),"exhausted");
  const missing=applyCoupon("event","customer","EXAMPLE",10000);
  missing.next();
  assert.throws(()=>missing.next([]),/coupon_not_found/);
});
