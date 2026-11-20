import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { PostgresAppDatabase } from "./postgresAdapter";
import { runPostgresMigrations } from "./migrate";

const url = process.env.PAID_TEST_POSTGRES_URL;

test("PostgreSQL paid migrations preserve legacy rows and serialize group holds, review and check-in", { skip: !url, timeout: 30_000 }, async () => {
  assert.ok(url && /\/paid_registration_test(?:\?|$)/.test(url), "Use a disposable paid_registration_test database");
  process.env.PAID_PROOF_ENCRYPTION_KEY = "12".repeat(32);
  const fixture = new Pool({ connectionString: url });
  const db = new PostgresAppDatabase(url);
  const other = new PostgresAppDatabase(url);
  try {
    assert.equal((await fixture.query("SELECT to_regclass('public.schema_migrations') AS present")).rows[0].present, null);
    await fixture.query("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    const migrations = new URL("./migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((name) => /^0[0-3]\d_/.test(name)).sort()) {
      await fixture.query(await readFile(new URL(name, migrations), "utf8"));
      await fixture.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
    }
    await fixture.query("INSERT INTO organizations(id,name,slug) VALUES ('org_default','Default','default')");
    await fixture.query("INSERT INTO events(id,name,slug,organizer_id) VALUES ('legacy_fixture','Legacy','legacy-fixture','org_default')");
    await fixture.query("INSERT INTO registrations(id,sender_id,event_id,first_name,last_name,phone) VALUES ('REG-OLD','legacy','legacy_fixture','Legacy','Guest','0812345678')");
    await Promise.all([db.initialize(), runPostgresMigrations(fixture)]);
    assert.equal((await fixture.query("SELECT first_name FROM registrations WHERE id='REG-OLD'")).rows[0].first_name, "Legacy");
    assert.equal(await db.readPaidMode("legacy_fixture"), undefined);
    await assert.rejects(db.savePaidSettings("legacy_fixture", {
      organizationId: "org_default", version: 0, capacity: 2, holdMinutes: 10, cutoffMs: null, published: true, categories: [],
    }), /legacy_enrollment_exists/);

    const event = await db.createEvent({ name: "Paid PG fixture", organizer_id: "org_default" });
    await db.updateEvent(event.id, { status: "active" });
    const customer = await db.createCustomerAccount({
      email: "paid-pg@example.com", normalized_email: "paid-pg@example.com", password_hash: "fixture",
      first_name: "A", last_name: "B", phone: "", normalized_phone: "", accepted_terms_at: new Date(), accepted_privacy_at: new Date(),
    });
    await db.savePaidSettings(event.id, {
      organizationId: "org_default", version: 0, capacity: 2, holdMinutes: 10, cutoffMs: null, published: true,
      categories: [{ id: "adult", label: "Adult", unitMinor: 25000, quota: 2 }],
    });
    const input = {
      eventId: event.id, customerId: customer.id, key: "group", pricingVersion: 1, contact: { name: "Fixture" },
      receiver: { id: "0812345678", name: "Organizer", profileVersion: 1 },
      attendees: ["One", "Two"].map((firstName) => ({ firstName, lastName: "Guest", categoryId: "adult" })),
    };
    const contenders = await Promise.allSettled([db.createPaidBooking(input), other.createPaidBooking({ ...input, key: "other" })]);
    const accepted = contenders.find((result) => result.status === "fulfilled");
    const refused = contenders.find((result) => result.status === "rejected");
    assert.ok(accepted && refused);
    assert.match(String(refused.reason), /capacity_exhausted/);
    const booking = accepted.value;
    const detail = await db.readOwnedPaidBooking(event.id, booking.id, customer.id);
    const [first] = detail?.attendees as { id: string }[];
    assert.equal(await db.readPaidCredential(event.id, booking.id, first.id, customer.id), undefined);
    const proof = await db.submitPaidProof({
      eventId: event.id, bookingId: booking.id, customerId: customer.id, key: "proof", version: 1,
      method: "promptpay", claimedMinor: 50000, claimedTransferMs: Date.now(), reference: null,
      mime: "image/png", content: Buffer.from("PG proof fixture"),
    });
    const evidence = await other.readPaidProof(event.id, booking.id, proof.attempt_id, "org_default");
    assert.equal(evidence?.content.toString(), "PG proof fixture");
    const approval = {
      eventId: event.id, bookingId: booking.id, attemptId: proof.attempt_id, organizationId: "org_default",
      reviewerId: "reviewer", key: "review", version: 2, decision: "approve" as const, reason: "Fixture bank settlement",
      observed: { amountMinor: 50000, transferMs: Date.now(), reference: "pg-transfer", receiverNamespace: "0812345678" },
    };
    const reviewed = await Promise.all([db.reviewPaidProof(approval), other.reviewPaidProof(approval)]);
    assert.deepEqual(reviewed[0], reviewed[1]);
    assert.equal(reviewed[0].status, "confirmed");
    const credential = await db.readPaidCredential(event.id, booking.id, first.id, customer.id);
    assert.ok(credential);
    const scans = await Promise.all([db.checkInPaidCredential(event.id, credential, "a"), other.checkInPaidCredential(event.id, credential, "b")]);
    assert.deepEqual(scans.map((scan) => scan?.already_checked_in).sort(), [false, true]);
    assert.equal((await db.listNotificationDeliveries({ related_type: "paid_booking", related_id: booking.id })).length, 1);
    assert.equal((await db.readPaidEventSummary(event.id, "org_default"))?.accepted_minor, "50000");
    const report = await db.readPaidRegistrationReport(event.id, "org_default");
    assert.equal(report?.confirmed_attendees, 2);
    const reportDays = report?.by_day as Array<{ registrations: number; checked_in: number }>;
    assert.equal(reportDays.reduce((sum, day) => sum + day.registrations, 0), 2);
    assert.equal(reportDays.reduce((sum, day) => sum + day.checked_in, 0), 1);
    await assert.rejects(db.readPaidRegistrationReport(event.id, "other-org"), /event_not_found/);
    const candidates = await Promise.all(["Cross-event settlement A", "Cross-event settlement B"].map(async (name) => {
      const candidate = await db.createEvent({ name, organizer_id: "org_default" });
      await db.updateEvent(candidate.id, { status: "active" });
      await db.savePaidSettings(candidate.id, {
        organizationId: "org_default", version: 0, capacity: 1, holdMinutes: 10, cutoffMs: null, published: true,
        categories: [{ id: "adult", label: "Adult", unitMinor: 25000, quota: null }],
      });
      return db.createPaidBooking({ ...input, eventId: candidate.id, attendees: input.attendees.slice(0, 1) }).then((receipt) => ({ candidate, receipt }));
    }));
    const crossEvent = await Promise.allSettled(candidates.map(({ candidate, receipt }, index) =>
      (index === 0 ? db : other).reviewPaidProof({
        ...approval, eventId: candidate.id, bookingId: receipt.id, attemptId: undefined, version: 1,
        observed: { ...approval.observed, amountMinor: 25000, transferMs: Date.now(), reference: "cross-event-reference" },
      }),
    ));
    assert.equal(crossEvent.filter(({ status }) => status === "fulfilled").length, 1);
    const duplicate = crossEvent.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.ok(duplicate && /duplicate_reference_or_proof/.test(String(duplicate.reason)));
    assert.equal((await fixture.query("SELECT COUNT(*)::int AS count FROM paid_payment_attempts WHERE trusted_reference='CROSS-EVENT-REFERENCE'")).rows[0].count, 1);
    await db.updateEvent(event.id, { status: "cancelled" });
    assert.equal(await other.readPaidCredential(event.id, booking.id, first.id, customer.id), undefined);
    assert.equal(await db.checkInPaidCredential(event.id, credential, "a"), undefined);
  } finally {
    await Promise.all([db.close(), other.close(), fixture.end()]);
  }
});

test("PostgreSQL paid schema initializes from an empty database", {
  skip: !process.env.PAID_TEST_POSTGRES_FRESH_URL, timeout: 30_000,
}, async () => {
  const freshUrl = process.env.PAID_TEST_POSTGRES_FRESH_URL;
  assert.ok(freshUrl && /\/paid_registration_fresh_test(?:\?|$)/.test(freshUrl), "Use a disposable paid_registration_fresh_test database");
  const db = new PostgresAppDatabase(freshUrl);
  const fixture = new Pool({ connectionString: freshUrl });
  try {
    assert.equal((await fixture.query("SELECT to_regclass('public.schema_migrations') AS present")).rows[0].present, null);
    await db.initialize();
    const migrations = (await readdir(new URL("./migrations/", import.meta.url)))
      .filter((name) => name.endsWith(".sql")).sort();
    await runPostgresMigrations(fixture);
    const applied = await fixture.query<{ name: string }>("SELECT name FROM schema_migrations");
    assert.deepEqual(applied.rows.map(({ name }) => name).sort(), migrations);
    assert.ok(await db.getEventById("evt_default"));
  } finally {
    await Promise.all([db.close(), fixture.end()]);
  }
});
