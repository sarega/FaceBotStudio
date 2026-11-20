import assert from "node:assert/strict";
import test from "node:test";
import { SqliteAppDatabase } from "./sqliteAdapter";
import { PostgresAppDatabase } from "./postgresAdapter";
import type { AppDatabase } from "./types";

async function checkStaffEmailLinks(db: AppDatabase) {
  await db.initialize();
  try {
    const event = await db.createEvent({ name: "Staff event", organizer_id: "org_default" });
    const invite = await db.createUser({
      username: "staff-invite", display_name: "New Staff", password_hash: "initial",
      role: "operator", assigned_event_ids: [event.id], invite_email: "staff@example.com",
    });
    const legacy = await db.createUser({
      username: "staff-legacy", display_name: "Existing Staff", password_hash: "legacy", role: "admin",
    });
    assert.equal(invite.staff_email_purpose, "invite");
    assert.equal(legacy.staff_email, null);
    assert.deepEqual(await db.listUserEventIds(invite.id), [event.id]);

    const now = "2026-11-20T00:00:00.000Z";
    const later = "2026-11-21T00:00:00.000Z";
    assert.equal(await db.stageStaffEmail(invite.id, "staff@example.com", "verify", "wrong", later, now), false);
    assert.equal(await db.stageStaffEmail(invite.id, "staff@example.com", "invite", "invite", later, now), true);
    assert.equal(await db.stageStaffEmail(invite.id, "staff@example.com", "invite", "resend", later, now), false);
    assert.equal(await db.consumeStaffEmail("invite", later, null, "new-password"), null);
    assert.equal(await db.consumeStaffEmail("invite", now, invite.id, null), null);
    await db.setUserActive(invite.id, false);
    assert.equal(await db.consumeStaffEmail("invite", now, null, "new-password"), null);
    await db.setUserActive(invite.id, true);
    assert.equal(await db.consumeStaffEmail("invite", now, null, "new-password"), null);
    assert.equal(await db.stageStaffEmail(invite.id, "staff@example.com", "invite", "resent", later, now), true);
    const accepted = await Promise.all([
      db.consumeStaffEmail("resent", now, null, "new-password"),
      db.consumeStaffEmail("resent", now, null, "new-password"),
    ]);
    assert.deepEqual(accepted.filter(Boolean), [invite.id]);
    assert.equal(await db.getUserPasswordHash(invite.username), "new-password");
    assert.equal((await db.getUserById(invite.id))?.staff_email, "staff@example.com");

    assert.equal(await db.stageStaffEmail(legacy.id, "legacy@example.com", "verify", "verify", later, now), true);
    assert.equal(await db.consumeStaffEmail("verify", now, invite.id, null), null);
    assert.equal(await db.consumeStaffEmail("verify", now, null, "new-password"), null);
    assert.equal(await db.consumeStaffEmail("verify", now, legacy.id, null), legacy.id);
    assert.equal(await db.getUserPasswordHash(legacy.username), "legacy");
    assert.equal((await db.getUserById(legacy.id))?.staff_email, "legacy@example.com");
  } finally {
    await db.close();
  }
}

test("SQLite staff email links respect purpose, expiry, account status and single use", async () => {
  await checkStaffEmailLinks(new SqliteAppDatabase(":memory:"));
});

const postgresUrl = process.env.STAFF_TEST_POSTGRES_URL;
test("PostgreSQL staff email links respect purpose, expiry, account status and single use", { skip: !postgresUrl }, async () => {
  assert.ok(postgresUrl && new URL(postgresUrl).pathname === "/staff_email_test", "Use a disposable staff_email_test database");
  await checkStaffEmailLinks(new PostgresAppDatabase(postgresUrl));
});
