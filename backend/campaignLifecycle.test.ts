import test from "node:test";
import assert from "node:assert/strict";
import { getEventState, getEffectiveEventStatus } from "./datetime";
const now = new Date("2026-11-26T05:00:00Z");
const settings = { event_timezone: "Asia/Bangkok", event_date: "2026-11-01T10:00", event_end_date: "" };
test("campaign and recurring events remain active without an end date", () => {
  for (const event_type of ["campaign", "recurring"]) {
    const input = { ...settings, event_type };
    assert.equal(getEventState(input, now).eventLifecycle, "ongoing");
    assert.equal(getEffectiveEventStatus("active", input, now), "active");
    assert.equal(getEffectiveEventStatus("inactive", input, now), "inactive");
  }
});
test("single event retains existing automatic closure", () => {
  assert.equal(getEffectiveEventStatus("active", settings, now), "closed");
});
test("campaign explicit end and manual status are respected", () => {
  const input = { ...settings, event_type: "campaign" };
  assert.equal(getEffectiveEventStatus("active", { ...input, event_end_date: "2026-11-25T10:00" }, now), "closed");
  assert.equal(getEffectiveEventStatus("cancelled", input, now), "cancelled");
  assert.equal(getEventState({ ...input, event_date: "", event_end_date: "" }, now).eventLifecycle, "ongoing");
});
