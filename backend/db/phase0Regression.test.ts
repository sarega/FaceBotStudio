import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteAppDatabase } from "./sqliteAdapter";

test("SQLite initialization upgrades a legacy registration schema before creating new indexes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "facebot-legacy-sqlite-"));
  const databasePath = join(directory, "bot.db");
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT, text TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, type TEXT);
    CREATE TABLE registrations (
      id TEXT PRIMARY KEY,
      sender_id TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      email TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'registered'
    );
  `);
  legacy.close();

  const db = new SqliteAppDatabase(databasePath);
  await db.initialize();
  await db.close();

  const upgraded = new Database(databasePath, { readonly: true });
  const columns = upgraded.prepare("PRAGMA table_info(registrations)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "customer_account_id"));
  assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_registrations_customer_account'").get());
  assert.ok(upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_registrations_event_timestamp'").get());
  upgraded.close();
  rmSync(directory, { recursive: true, force: true });
});

async function createRegistration(
  db: SqliteAppDatabase,
  eventId: string,
  firstName: string,
  lastName: string,
) {
  return db.createRegistration({
    sender_id: `${firstName}-${lastName}`,
    event_id: eventId,
    first_name: firstName,
    last_name: lastName,
    phone: "0812345678",
    email: `${firstName.toLowerCase()}@example.com`,
  });
}

test("guest registration preserves duplicate, cancellation, check-in, and event-scoped export behavior", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Registration regression test", organizer_id: "org_default" });
  const otherEvent = await db.createEvent({ name: "Other registration event", organizer_id: "org_default" });
  await db.updateEvent(event.id, { status: "active" });
  await db.updateEvent(otherEvent.id, { status: "active" });

  const created = await createRegistration(db, event.id, "Guest", "Attendee");
  assert.equal(created.statusCode, 200);
  const registrationId = String(created.content.id);
  assert.match(registrationId, /^REG-[0-9A-F]{16}$/);
  assert.equal((await db.getRegistrationById(registrationId))?.status, "registered");

  const duplicate = await createRegistration(db, event.id, "Guest", "Attendee");
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.content.duplicate_registration_id, registrationId);

  assert.equal(await db.checkInRegistration(registrationId), true);
  assert.equal((await db.getRegistrationById(registrationId))?.status, "checked-in");

  const cancelled = await db.cancelRegistration(registrationId);
  assert.equal(cancelled.statusCode, 200);
  assert.equal((await db.getRegistrationById(registrationId))?.status, "cancelled");
  assert.equal(await db.checkInRegistration(registrationId), false);

  const replacement = await createRegistration(db, event.id, "Guest", "Attendee");
  assert.equal(replacement.statusCode, 200);
  const replacementId = String(replacement.content.id);
  assert.notEqual(replacementId, registrationId);

  const other = await createRegistration(db, otherEvent.id, "Other", "Event");
  assert.equal(other.statusCode, 200);

  const eventExport = await db.exportRegistrations(event.id);
  assert.deepEqual(new Set(eventExport.map((row) => row.id)), new Set([registrationId, replacementId]));
  assert.ok(eventExport.every((row) => row.event_id === event.id));
  assert.equal((await db.exportRegistrations(otherEvent.id)).length, 1);
});

test("guest registration capacity blocks new attendees until a registration is cancelled", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Registration capacity test", organizer_id: "org_default" });
  await db.updateEvent(event.id, { status: "active" });
  await db.upsertSettings({ reg_limit: "1", reg_unique_name: "1" }, event.id);

  const first = await createRegistration(db, event.id, "First", "Guest");
  assert.equal(first.statusCode, 200);

  const full = await createRegistration(db, event.id, "Second", "Guest");
  assert.equal(full.statusCode, 400);
  assert.equal(full.content.error, "Registration limit reached");

  const firstId = String(first.content.id);
  assert.equal((await db.cancelRegistration(firstId)).statusCode, 200);

  const reopened = await createRegistration(db, event.id, "Second", "Guest");
  assert.equal(reopened.statusCode, 200);
});

test("registration counts are aggregated by event without loading registration rows", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Registration count test", organizer_id: "org_default" });
  await db.updateEvent(event.id, { status: "active" });

  const first = await createRegistration(db, event.id, "Count", "Registered");
  const second = await createRegistration(db, event.id, "Count", "CheckedIn");
  const third = await createRegistration(db, event.id, "Count", "Cancelled");
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(third.statusCode, 200);
  assert.equal(await db.checkInRegistration(String(second.content.id)), true);
  assert.equal((await db.cancelRegistration(String(third.content.id))).statusCode, 200);

  assert.deepEqual(await db.getRegistrationCountsByEvent(event.id), [{
    event_id: event.id,
    total: 3,
    registered: 1,
    cancelled: 1,
    checked_in: 1,
  }]);

  const activity = await db.getRegistrationActivityByDay(event.id);
  assert.deepEqual(activity, [{
    date: new Date().toISOString().slice(0, 10),
    registrations: 3,
    checked_in: 1,
  }]);

  const matchingRows = await db.searchRegistrations({
    eventIds: [event.id],
    query: "Count CheckedIn",
    limit: 10,
  });
  assert.deepEqual(matchingRows.map((row) => row.id), [String(second.content.id)]);
  const allMatchingRows = await db.searchRegistrations({ eventIds: [event.id], limit: 10 });
  assert.deepEqual(
    (await db.searchRegistrations({ eventIds: [event.id], limit: 1, offset: 1 })).map((row) => row.id),
    allMatchingRows.slice(1, 2).map((row) => row.id),
  );
  assert.deepEqual(await db.searchRegistrations({ eventIds: [event.id], query: "%", limit: 10 }), []);
  assert.deepEqual(await db.searchRegistrations({ eventIds: [], query: "Count", limit: 10 }), []);
});
