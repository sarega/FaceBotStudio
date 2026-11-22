import assert from "node:assert/strict";
import test from "node:test";
import { parsePaidSlipVision, thaiTransferInput, thaiTransferTime } from "./paidSlipFields";

test("slip reading preserves satang, Thai names, and Bangkok local time", () => {
  const input = "2025-11-21T23:40:12";
  const fields = parsePaidSlipVision(JSON.stringify({ amount_minor: 340025, transfer_at: input, payer_name: " สมใจ ทดสอบ " }));
  assert.deepEqual(fields, { amountMinor: 340025, transferAt: input, payerName: "สมใจ ทดสอบ" });
  assert.equal(new Date(thaiTransferTime(input)).toISOString(), "2025-11-21T16:40:12.000Z");
  assert.equal(thaiTransferInput(thaiTransferTime(input)), input);
});

test("missing and invalid slip fields are left blank", () => {
  const fields = parsePaidSlipVision('{"amount_minor":"50000","transfer_at":"2025-02-30T21:05","payer_name":"name\u005cnother"}');
  assert.deepEqual(fields, { amountMinor: null, transferAt: null, payerName: null });
  assert.equal(parsePaidSlipVision("unreadable response"), null);
  assert.equal(thaiTransferTime("2025-11-21T23:40"), thaiTransferTime("2025-11-21T23:40:00"));
});
