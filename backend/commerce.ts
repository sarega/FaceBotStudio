export type FeeType = "fixed" | "percent";

export type OrderPricingInput = {
  seatPrices: number[];
  feeEnabled: boolean;
  feeType: FeeType;
  feeValue: number;
  taxRatePercent: number;
  paymentFeeValue: number;
};

export type OrderPricing = {
  subtotal_amount: number;
  platform_fee_amount: number;
  payment_fee_amount: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  fee_rule_version: string;
  tax_snapshot_json: string;
};

function minor(value: number) {
  return Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 100));
}

function amount(value: number) {
  return Math.round(value) / 100;
}

export function calculateOrderPricing(input: OrderPricingInput): OrderPricing {
  const subtotal = input.seatPrices.reduce((sum, price) => sum + minor(price), 0);
  const feeValue = Math.max(0, Number(input.feeValue) || 0);
  const fee = input.feeEnabled
    ? input.feeType === "fixed"
      ? minor(feeValue)
      : Math.round(subtotal * Math.min(100, feeValue) / 100)
    : 0;
  const paymentFee = minor(Math.max(0, Number(input.paymentFeeValue) || 0));
  const taxRate = Math.max(0, Math.min(100, Number(input.taxRatePercent) || 0));
  const tax = Math.round((subtotal + fee + paymentFee) * taxRate / 100);
  const total = subtotal + fee + paymentFee + tax;
  return {
    subtotal_amount: amount(subtotal),
    platform_fee_amount: amount(fee),
    payment_fee_amount: amount(paymentFee),
    tax_amount: amount(tax),
    discount_amount: 0,
    total_amount: amount(total),
    fee_rule_version: `v1:${input.feeType}:${feeValue}:${taxRate}`,
    tax_snapshot_json: JSON.stringify({ rate_percent: taxRate, taxable_minor: subtotal + fee + paymentFee, tax_minor: tax }),
  };
}

export function parseMoney(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
}

export function parseFeeType(value: unknown): FeeType {
  return String(value || "").trim().toLowerCase() === "fixed" ? "fixed" : "percent";
}
