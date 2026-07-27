import assert from "node:assert/strict";
import test from "node:test";
import { composeContextFromEditor, splitContextForEditor } from "./contextEditor";

const gate = '[[PROMO_GATE {"id":"fan","code":"SAFE10","label":"Fan","requirement":"image_checklist"}]]';

test("editing visible context does not accumulate hidden separator lines", () => {
  let stored = composeContextFromEditor("line one\nline two", [gate]);
  for (let index = 0; index < 4; index += 1) {
    const current = splitContextForEditor(stored);
    stored = composeContextFromEditor(current.visibleContext.replace("\nline two", ""), current.gateLines);
  }
  assert.equal(splitContextForEditor(stored).visibleContext, "line one");
});

test("deleting all visible text clears hidden gates too", () => {
  const stored = composeContextFromEditor("", [gate]);
  const result = splitContextForEditor(stored);
  assert.equal(result.visibleContext, "");
  assert.deepEqual(result.gateLines, []);
});

test("preserves intentional trailing newlines without moving the cursor value", () => {
  const visible = "line one\n\n";
  const stored = composeContextFromEditor(visible, [gate]);
  assert.equal(splitContextForEditor(stored).visibleContext, visible);
});
