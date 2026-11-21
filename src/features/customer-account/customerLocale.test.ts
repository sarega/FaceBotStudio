import assert from "node:assert/strict";
import test from "node:test";
import { customerErrorCopy, formatCustomerDate } from "./customerLocale";

test("customer dates follow the selected language and use Thailand time", () => {
  const deadline = "2026-11-25T17:00:00Z";
  assert.match(formatCustomerDate(deadline, "en"), /26 Nov 2026.*00:00/);
  assert.doesNotMatch(formatCustomerDate(deadline, "en"), /[ก-๙]/);
  assert.match(formatCustomerDate(deadline, "th"), /26.*2569.*00:00/);
  assert.equal(formatCustomerDate("invalid", "en"), "");
});

test("customer feedback keeps specific translated errors and falls back to localized copy", () => {
  const fallback: [string, string] = ["ทำรายการไม่สำเร็จ", "Request failed"];
  const missing = new Error("CUSTOMER_APP_DISABLED", { cause: "Record not found" });
  assert.deepEqual(customerErrorCopy(missing, fallback), ["ไม่พบรายการนี้", "Record not found."]);
  assert.equal(customerErrorCopy(new Error("unknown"), fallback), fallback);
});
