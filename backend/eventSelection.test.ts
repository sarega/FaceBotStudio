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

test("event selection replies in the latest customer's language", () => {
  assert.match(buildEventSelectionPrompt(events, "Which event can I join?"), /^Please choose/);
  assert.doesNotMatch(buildEventSelectionPrompt(events, "Which event can I join?"), /กรุณาเลือกงาน/);
  assert.match(buildEventSelectionPrompt(events, "จะไปงานไหนได้บ้าง"), /^กรุณาเลือกงาน/);
  assert.doesNotMatch(buildEventSelectionPrompt(events, "จะไปงานไหนได้บ้าง"), /Please choose/);
  assert.match(buildEventSelectionPrompt(events, "イベントを変更したい"), /^お問い合わせのイベント/);
  assert.match(buildEventSelectionPrompt(events, "¿Qué eventos hay?"), /^Elija el evento/);
  assert.match(buildEventSelectionPrompt(events, "请选择活动"), /^请选择/);
  assert.match(buildEventSelectionPrompt(events, "행사를 선택"), /^문의하실/);
});

test("selected event language follows the latest message, not the event title", () => {
  assert.equal(buildEventSelectedMessage("งานไทย", "Please select event 1"), "งานไทย selected. Please send your question.");
  assert.match(buildEventSelectedMessage("English Summit", "เลือกงานนี้"), /^เลือก English Summit แล้ว/);
  assert.match(buildEventSelectedMessage("งานไทย", "1"), /selected/);
});
