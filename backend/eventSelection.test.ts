import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEventSelectedMessage,
  buildEventSelectionPrompt,
  isChangeEventCommand,
  matchEventSelection,
} from "./eventSelection";

const events = [
  { id: "evt_1", name: "งานไทย" },
  { id: "evt_2", name: "English Summit" },
];

test("matches bilingual event selection and renders bilingual prompts", () => {
  assert.equal(matchEventSelection("2", events)?.id, "evt_2");
  assert.equal(matchEventSelection("งาน 1", events)?.id, "evt_1");
  assert.equal(matchEventSelection("english summit", events)?.id, "evt_2");
  assert.equal(isChangeEventCommand("เปลี่ยนงาน"), true);
  assert.equal(isChangeEventCommand("change event"), true);
  assert.match(buildEventSelectionPrompt(events), /กรุณาเลือกงาน/);
  assert.match(buildEventSelectionPrompt(events), /Please choose/);
  assert.match(buildEventSelectedMessage("งานไทย"), /selected/);
});
