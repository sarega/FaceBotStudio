import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExternalHref } from "./externalHref";

test("normalizes web links and rejects executable URL schemes", () => {
  assert.equal(normalizeExternalHref("tickets.example/show"), "https://tickets.example/show");
  assert.equal(normalizeExternalHref("https://tickets.example/show"), "https://tickets.example/show");
  assert.equal(normalizeExternalHref("javascript:alert(1)"), "");
  assert.equal(normalizeExternalHref("data:text/html,hello"), "");
  assert.equal(normalizeExternalHref("mailto:help@example.com"), "");
});
