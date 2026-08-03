import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminAgentOutreachIdentityKeys,
  isAdminAgentCancellation,
  isAdminAgentConfirmation,
  normalizeAdminAgentOutreachDraft,
} from "./adminAgentOutreach";

test("normalizes a conversational outreach setup and rejects unsafe asset links", () => {
  const result = normalizeAdminAgentOutreachDraft({
    campaign_name: "Manohra Press",
    objective: "Earn editorial coverage",
    targets: [{ name: "Arts Desk", facebook_page_url: "https://facebook.com/arts", source_url: "https://example.com/arts" }],
    assets: [{ name: "Press kit", url: "https://example.com/kit.pdf" }],
  }, "evt_demo");

  assert.ok(result.draft);
  assert.equal(result.draft.event_id, "evt_demo");
  assert.equal(result.draft.targets[0]?.name, "Arts Desk");
  assert.match(result.draft.targets[0]?.notes || "", /Source: https:\/\/example.com\/arts/);
  assert.equal(result.errors.length, 0);

  const unsafe = normalizeAdminAgentOutreachDraft({
    campaign_name: "Unsafe",
    assets: [{ name: "Kit", url: "javascript:alert(1)" }],
  }, "evt_demo");
  assert.equal(unsafe.draft, null);
  assert.match(unsafe.errors.join(" "), /http/);
});

test("requires an explicit confirmation and exposes stable identity keys", () => {
  assert.equal(isAdminAgentConfirmation("ยืนยันครับ"), true);
  assert.equal(isAdminAgentConfirmation("ไม่ยืนยัน"), false);
  assert.equal(isAdminAgentCancellation("ยกเลิก"), true);
  assert.deepEqual(
    getAdminAgentOutreachIdentityKeys({ facebook_page_url: "https://facebook.com/arts", email: "ARTS@EXAMPLE.COM" }),
    ["page_url:https://facebook.com/arts", "email:arts@example.com"],
  );
});
