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

test("admin scope and role changes persist together and do not affect owner", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Scoped admin event", organizer_id: "org_default" });
  const admin = await db.createUser({ username: "scope-admin", display_name: "Scope Admin", password_hash: "test", role: "admin" });
  assert.equal(admin.event_scope, "all");
  assert.equal(await db.updateUserPermissions(admin.id, "admin", "selected", [event.id]), true);
  assert.equal((await db.getUserById(admin.id))?.event_scope, "selected");
  assert.deepEqual(await db.listUserEventIds(admin.id), [event.id]);
  assert.equal(await db.updateUserPermissions(admin.id, "operator", "selected", []), true);
  assert.equal((await db.getUserById(admin.id))?.role, "operator");
  assert.deepEqual(await db.listUserEventIds(admin.id), []);
  await db.close();
});
