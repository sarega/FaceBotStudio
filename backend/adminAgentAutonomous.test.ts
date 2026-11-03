import test from "node:test";
import assert from "node:assert/strict";
import { bangkokSchedule, criticalIssues, reportText } from "./adminAgentAutonomous";

test("Bangkok 08:00 schedule", () => {
  assert.equal(bangkokSchedule(new Date("2026-11-03T00:59:00Z")).due, false);
  assert.deepEqual(bangkokSchedule(new Date("2026-11-03T01:00:00Z")), { dateKey: "2026-11-03", due: true, time: "08:00" });
  assert.equal(bangkokSchedule(new Date("2026-11-02T18:00:00Z")).dateKey, "2026-11-03");
  assert.equal(bangkokSchedule(new Date("2026-11-03T03:00:00Z")).due, false); // Outside 2-hour catch-up window
  assert.equal(bangkokSchedule(new Date("2026-11-03T01:00:00Z"), "bad").time, "08:00");
});
test("daily report and alert analyzer", () => {
  const events = [{ id: "evt1", name: "Example", status: "active", availability: "invalid", total: 10, active: 8, cancelled: 2, checkedIn: 1, remaining: 12 }];
  const diagnostics = { failedDeliveries: 2, pendingDeliveries: 1, failedAgentActions: 0, samplesTruncated: false };
  assert.equal(criticalIssues(events, diagnostics).length, 2);
  const report = reportText("2026-11-03", events, diagnostics);
  assert.match(report, /Example/);
  assert.match(report, /ล้มเหลว: 2/);
});
