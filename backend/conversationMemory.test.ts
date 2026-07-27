import assert from "node:assert/strict";
import test from "node:test";
import { filterRowsAfterContextUpdate } from "./conversationMemory";

test("excludes prompt history from before the current context revision without deleting logs", () => {
  const rows = [
    { id: 1, timestamp: "2026-07-27 09:00:00" },
    { id: 2, timestamp: "2026-07-27 10:00:00" },
  ];
  assert.deepEqual(
    filterRowsAfterContextUpdate(rows, "2026-07-27 09:30:00").map((row) => row.id),
    [2],
  );
  assert.equal(rows.length, 2);
});
