import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
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

    const attendee = await db.createCustomerAccount({
      email: "member@example.com", normalized_email: "member@example.com", password_hash: "original-password",
      first_name: "Member", last_name: "Example", phone: "", normalized_phone: "",
      accepted_terms_at: new Date(), accepted_privacy_at: new Date(),
    });
    await db.verifyCustomerAccountEmail(attendee.id);
    const dual = await db.createUser({
      username: "dual-account", display_name: "Dual Account", password_hash: "initial",
      invite_email: attendee.normalized_email, role: "admin",
    });
    assert.equal(await db.stageStaffEmail(dual.id, attendee.normalized_email, "invite", "dual-token", later, now), true);
    assert.equal(await db.getUserByStaffEmail(attendee.email), undefined);
    assert.equal(await db.getPendingStaffInviteEmail("dual-token", now), attendee.email);
    assert.equal(await db.consumeStaffEmail("dual-token", now, null, "separate-password"), null);
    assert.equal(await db.consumeStaffEmail("dual-token", now, null, null, { id: attendee.id, passwordHash: "stale-hash" }), null);
    const proof = { id: attendee.id, passwordHash: attendee.password_hash };
    assert.equal(await db.consumeStaffEmail("dual-token", now, null, null, proof), dual.id);
    assert.equal((await db.getUserByStaffEmail(" MEMBER@EXAMPLE.COM "))?.id, dual.id);
    assert.equal((await db.getUserByStaffCustomerAccount(attendee.id))?.id, dual.id);
    assert.equal((await db.getCustomerAccountById(attendee.id))?.password_hash, "original-password");
    const expires = new Date(Date.now() + 600_000);
    await db.createSession(dual.id, "valid-staff-session", expires, proof);
    assert.equal((await db.getSessionWithUser("valid-staff-session"))?.user.id, dual.id);
    assert.equal(await db.updateCustomerPasswordHash(attendee.id, "changed-password"), true);
    assert.equal(await db.updateCustomerPasswordHash(attendee.id, "stale-rehash", "original-password"), false);
    await assert.rejects(db.createSession(dual.id, "stale-staff-session", expires, proof), /staff_login_state_changed/);
    await db.setCustomerAccountStatus(attendee.id, "disabled");
    assert.equal(await db.getSessionWithUser("valid-staff-session"), undefined);
  } finally {
    await db.close();
  }
}

test("SQLite staff email links respect purpose, expiry, account status and single use", async () => {
  await checkStaffEmailLinks(new SqliteAppDatabase(":memory:"));
});

test("migration links an already accepted invitation to the verified attendee account", async () => {
  const directory = mkdtempSync(join(tmpdir(), "meetrix-staff-upgrade-"));
  const file = join(directory, "legacy.db");
  const prior = new SqliteAppDatabase(file);
  const upgraded = new SqliteAppDatabase(file);
  try {
    await prior.initialize();
    const invited = await prior.createUser({ username: "activated", display_name: "Activated admin",
      role: "admin", password_hash: "separate-staff-password", invite_email: "same@example.com" });
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 60_000).toISOString();
    await prior.stageStaffEmail(invited.id, "same@example.com", "invite", "accepted-token", later, now);
    assert.equal(await prior.consumeStaffEmail("accepted-token", now, null, "separate-staff-password"), invited.id);
    await prior.recordAuditLog({ actor_user_id: invited.id, action: "auth.staff_invite_accepted", target_type: "user", target_id: invited.id });
    const account = await prior.createCustomerAccount({
      email: "same@example.com", normalized_email: "same@example.com", password_hash: "existing-account-password",
      first_name: "Same", last_name: "Example", phone: "", normalized_phone: "",
      accepted_terms_at: new Date(), accepted_privacy_at: new Date(),
    });
    await prior.verifyCustomerAccountEmail(account.id);
    const schema = new Database(file);
    try {
      schema.exec("DROP INDEX users_staff_customer_account_unique; ALTER TABLE users DROP COLUMN staff_customer_account_id;");
    } finally { schema.close(); }
    await upgraded.initialize();
    assert.equal((await upgraded.getUserByStaffCustomerAccount(account.id))?.id, invited.id);
    assert.equal((await upgraded.getCustomerAccountById(account.id))?.password_hash, "existing-account-password");
  } finally {
    await Promise.all([prior.close(), upgraded.close()]);
    rmSync(directory, { recursive: true, force: true });
  }
});

const postgresUrl = process.env.STAFF_TEST_POSTGRES_URL;
test("PostgreSQL staff email links respect purpose, expiry, account status and single use", { skip: !postgresUrl }, async () => {
  assert.ok(postgresUrl && new URL(postgresUrl).pathname === "/staff_email_test", "Use a disposable staff_email_test database");
  await checkStaffEmailLinks(new PostgresAppDatabase(postgresUrl));
});
