import assert from "node:assert/strict";
import test from "node:test";

import { SqliteAppDatabase } from "./sqliteAdapter";

test("user preferences persist per account", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const user = await db.createUser({
    username: "preference-test",
    display_name: "Preference Test",
    password_hash: "not-used",
    role: "viewer",
  });

  assert.equal(await db.getUserPreferences(user.id), undefined);
  await db.upsertUserPreferences(user.id, { language: "th", timezone: "Asia/Bangkok" });
  assert.deepEqual(
    { ...(await db.getUserPreferences(user.id)), updated_at: undefined },
    { user_id: user.id, language: "th", timezone: "Asia/Bangkok", updated_at: undefined },
  );
});
