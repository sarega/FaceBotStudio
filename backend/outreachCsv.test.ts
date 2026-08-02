import assert from "node:assert/strict";
import test from "node:test";

import { parseOutreachCsv } from "./outreachCsv";

test("outreach CSV parser keeps quoted commas and normalizes headers", () => {
  const rows = parseOutreachCsv('\uFEFFName,Email,Notes\n"Arts Desk","desk@example.com","Ask, then follow up"\n');
  assert.deepEqual(rows, [{ name: "Arts Desk", email: "desk@example.com", notes: "Ask, then follow up" }]);
});
