import type { PaidCommand, PaidRow } from "./paidRegistration";
import { PaidBookingError } from "./paidRegistration";

const q = (sql: string, ...params: (string | number | null)[]) => ({ sql, params });
export type CouponKind = "percent" | "fixed" | "free";
export type CouponInput = {
  code: string; kind: CouponKind; value_minor: number; max_uses: number | null;
  per_customer_limit: number | null; starts_ms: number | null; ends_ms: number | null; enabled: boolean;
};
const codePattern = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
export function normalizeCouponCode(code: string) { return code.trim().toUpperCase(); }
export function validateCoupon(input: CouponInput): CouponInput {
  const code = normalizeCouponCode(input.code);
  if (!codePattern.test(code) ||
    !["percent", "fixed", "free"].includes(input.kind) ||
    !Number.isSafeInteger(input.value_minor) || input.value_minor < 0 || input.value_minor > 2_147_483_647 ||
    (input.kind === "percent" && (input.value_minor < 1 || input.value_minor > 10000)) ||
    (input.kind === "fixed" && input.value_minor < 1) ||
    (input.kind === "free" && input.value_minor !== 0) ||
    (input.max_uses != null && (!Number.isSafeInteger(input.max_uses) || input.max_uses < 1 || input.max_uses > 2_147_483_647)) ||
    (input.per_customer_limit != null && (!Number.isSafeInteger(input.per_customer_limit) || input.per_customer_limit < 1 || input.per_customer_limit > 2_147_483_647)) ||
    (input.starts_ms != null && (!Number.isSafeInteger(input.starts_ms) || input.starts_ms < 1)) ||
    (input.ends_ms != null && (!Number.isSafeInteger(input.ends_ms) || input.ends_ms < 1)) ||
    (input.starts_ms != null && input.ends_ms != null && input.starts_ms >= input.ends_ms) ||
    typeof input.enabled !== "boolean") throw new PaidBookingError("invalid_coupon");
  return {...input,code};
}
export function couponDiscount(kind: CouponKind, value: number, subtotal: number): number {
  return kind === "free" ? subtotal : kind === "percent" ? Number((BigInt(subtotal) * BigInt(value)) / 10000n) :
    Math.min(subtotal, value);
}
export function* listCoupons(eventId: string): PaidCommand<PaidRow[]> {
  return yield q(`SELECT c.*, (SELECT COUNT(*) FROM paid_coupon_redemptions r
    JOIN paid_bookings b ON b.id=r.booking_id WHERE r.event_id=c.event_id AND r.code=c.code
    AND (b.state IN ('confirmed','verification_pending') OR
    (b.state='awaiting_payment' AND b.due_ms>?))) AS uses
    FROM paid_coupons c WHERE c.event_id=? ORDER BY c.created_ms DESC`, Date.now(), eventId);
}
export function* upsertCoupon(eventId: string, input: CouponInput): PaidCommand<PaidRow> {
  const c = validateCoupon(input);
  const now = Date.now();
  yield q(`INSERT INTO paid_coupons
   (event_id,code,kind,value_minor,max_uses,per_customer_limit,starts_ms,ends_ms,enabled,created_ms,updated_ms)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(event_id,code) DO UPDATE SET kind=excluded.kind,value_minor=excluded.value_minor,
   max_uses=excluded.max_uses,per_customer_limit=excluded.per_customer_limit,
   starts_ms=excluded.starts_ms,ends_ms=excluded.ends_ms,enabled=excluded.enabled,updated_ms=excluded.updated_ms`,
   eventId,c.code,c.kind,c.value_minor,c.max_uses,c.per_customer_limit,c.starts_ms,c.ends_ms,Number(c.enabled),now,now);
  const [result] = yield q("SELECT * FROM paid_coupons WHERE event_id=? AND code=?",eventId,c.code);
  return result;
}
/** Only unused coupons may be deleted; redemptions are a permanent financial audit trail. */
export function* deleteCoupon(eventId: string, codeRaw: string): PaidCommand<boolean> {
  const code = normalizeCouponCode(codeRaw);
  if (!codePattern.test(code)) throw new PaidBookingError("coupon_invalid");
  const [history] = yield q("SELECT COUNT(*) AS count FROM paid_coupon_redemptions WHERE event_id=? AND code=?",
    eventId, code);
  if (Number(history.count) > 0) throw new PaidBookingError("coupon_has_history");
  const removed = yield q("DELETE FROM paid_coupons WHERE event_id=? AND code=? RETURNING code",eventId,code);
  return removed.length > 0;
}
export function* applyCoupon(eventId: string,customerId: string,codeRaw: string,subtotal: number):
  PaidCommand<{code:string;kind:CouponKind;discount_minor:number;total_minor:number}> {
  const code = normalizeCouponCode(codeRaw);
  if (!codePattern.test(code)) throw new PaidBookingError("coupon_invalid");
  const [c] = yield q("SELECT * FROM paid_coupons WHERE event_id=? AND code=?",eventId,code);
  const now = Date.now();
  if (!c || c.enabled !== 1 || (c.starts_ms != null && Number(c.starts_ms)>now) ||
    (c.ends_ms != null && Number(c.ends_ms)<=now)) throw new PaidBookingError("coupon_unavailable");
  const [used] = yield q(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN r.customer_id=? THEN 1 ELSE 0 END),0) AS personal
    FROM paid_coupon_redemptions r JOIN paid_bookings b ON b.id=r.booking_id
    WHERE r.event_id=? AND r.code=? AND (b.state IN ('confirmed','verification_pending') OR
    (b.state='awaiting_payment' AND b.due_ms>?))`,customerId,eventId,code,now);
  if ((c.max_uses != null && Number(used.total)>=Number(c.max_uses)) ||
      (c.per_customer_limit != null && Number(used.personal)>=Number(c.per_customer_limit))) {
    throw new PaidBookingError("coupon_exhausted");
  }
  const discount = couponDiscount(c.kind as CouponKind,Number(c.value_minor),subtotal);
  return {code,kind:c.kind as CouponKind,discount_minor:discount,total_minor:subtotal-discount};
}
export function* recordCouponRedemption(eventId:string, code:string, bookingId:string,
  customerId:string, subtotal:number, discount:number): PaidCommand<void> {
  yield q(`INSERT INTO paid_coupon_redemptions
    (event_id,code,booking_id,customer_id,discount_minor,subtotal_minor,created_ms)
    VALUES (?,?,?,?,?,?,?)`,eventId,code,bookingId,customerId,discount,subtotal,Date.now());
}
