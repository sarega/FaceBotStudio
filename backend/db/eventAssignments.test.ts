import assert from "node:assert/strict";
import test from "node:test";

import { SqliteAppDatabase } from "./sqliteAdapter";

test("event-scoped accounts keep only explicit Event assignments", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();

  const firstEvent = await db.createEvent({ name: "Assigned Event", organizer_id: "org_default" });
  const secondEvent = await db.createEvent({ name: "Unassigned Event", organizer_id: "org_default" });
  const checker = await db.createUser({
    username: "event-checker",
    display_name: "Event Checker",
    password_hash: "not-used",
    role: "checker",
    assigned_event_ids: [firstEvent.id],
  });

  assert.deepEqual(await db.listUserEventIds(checker.id), [firstEvent.id]);
  assert.equal(await db.isUserAssignedToEvent(checker.id, firstEvent.id), true);
  assert.equal(await db.isUserAssignedToEvent(checker.id, secondEvent.id), false);

  const laterEvent = await db.createEvent({ name: "Later Event", organizer_id: "org_default" });
  assert.equal(await db.isUserAssignedToEvent(checker.id, laterEvent.id), false);

  await db.setUserEventAssignments(checker.id, [secondEvent.id]);
  assert.deepEqual(await db.listUserEventIds(checker.id), [secondEvent.id]);
  assert.equal(await db.isUserAssignedToEvent(checker.id, firstEvent.id), false);
  assert.equal(await db.isUserAssignedToEvent(checker.id, secondEvent.id), true);

  await db.close();
});
