import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPromoGateInstruction,
  evaluatePromoGate,
  historyHasShowQuestion,
  parsePromoGates,
  sanitizeProtectedPromoCodes,
} from "./promoGate";

const context = [
  "ข้อมูลกิจกรรม",
  '[[PROMO_GATE {"id":"student-day","code":"STUDENT22DAY","label":"รอบเสาร์ 14:00","requirement":"selection"}]]',
  '[[PROMO_GATE {"id":"fan","code":"MANOHRA10","label":"ส่วนลดแฟนเพจ 10%","requirement":"image_checklist"}]]',
].join("\n");

test("removes protected codes from model context", () => {
  const parsed = parsePromoGates(context);
  const prompt = `${parsed.safeContext}\n${buildPromoGateInstruction(parsed.gates)}`;
  assert.equal(prompt.includes("STUDENT22DAY"), false);
  assert.equal(prompt.includes("MANOHRA10"), false);
  assert.equal(parsed.gates.length, 2);
});

test("requires a current image and complete checklist for fan promotion", () => {
  const fan = parsePromoGates(context).gates.find((gate) => gate.id === "fan");
  assert.equal(evaluatePromoGate(fan, {}, false).approved, false);
  assert.equal(evaluatePromoGate(fan, { followed_page: true, shared_public: true, tagged_friend: false }, true).approved, false);
  assert.equal(evaluatePromoGate(fan, { followed_page: true, shared_public: true, tagged_friend: true }, true).approved, true);
});

test("rejects an expired promotion", () => {
  const fan = {
    ...parsePromoGates(context).gates.find((gate) => gate.id === "fan")!,
    expires_at: "2026-08-01T23:59:59+07:00",
  };
  assert.equal(
    evaluatePromoGate(
      fan,
      { followed_page: true, shared_public: true, tagged_friend: true },
      true,
      false,
      new Date("2026-08-02T00:00:00+07:00"),
    ).approved,
    false,
  );
});

test("requires the bot to ask for a show before releasing a student code", () => {
  const student = parsePromoGates(context).gates.find((gate) => gate.id === "student-day");
  assert.equal(evaluatePromoGate(student, {}, false, false).approved, false);
  assert.equal(evaluatePromoGate(student, {}, false, true).approved, true);
  assert.equal(historyHasShowQuestion(["ต้องการชมรอบไหนคะ"]), true);
});

test("blocks direct code leakage but permits an issued code", () => {
  const gates = parsePromoGates(context).gates;
  assert.equal(sanitizeProtectedPromoCodes("ใช้ manohra10", gates), "ใช้ [รหัสถูกป้องกัน]");
  assert.equal(sanitizeProtectedPromoCodes("ใช้ MANOHRA10", gates, ["MANOHRA10"]), "ใช้ MANOHRA10");
});
