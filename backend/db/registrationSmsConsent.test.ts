import assert from "node:assert/strict";
import test from "node:test";

import { SqliteAppDatabase } from "./sqliteAdapter";

test("SMS consent can be granted and withdrawn for a registration", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "SMS consent test", organizer_id: "org_default" });
  await db.updateEvent(event.id, { status: "active" });
  const created = await db.createRegistration({
    sender_id: "psid-1", event_id: event.id, first_name: "SMS", last_name: "Test", phone: "0812345678",
  });
  assert.equal(created.statusCode, 200);
  const id = String(created.content.id);
  assert.equal(await db.setRegistrationSmsConsent(id, true, "chat"), true);
  assert.ok((await db.getRegistrationById(id))?.sms_opt_in_at);
  assert.equal((await db.getRegistrationById(id))?.sms_opt_out_at, null);
  assert.equal(await db.setRegistrationSmsConsent(id, false, "admin"), true);
  assert.ok((await db.getRegistrationById(id))?.sms_opt_out_at);
});
