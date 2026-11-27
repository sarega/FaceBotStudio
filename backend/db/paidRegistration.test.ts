import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolvePaidDeadline, type PaidBookingInput } from "./paidRegistration";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAppDatabase } from "./sqliteAdapter";

test("paid deadline supports timed holds, optional caps and a shared fixed cutoff", () => {
  const now = Date.UTC(2026, 10, 18);
  const minute = 60_000;
  const cutoff = now + 7 * 24 * 60 * minute;
  assert.equal(resolvePaidDeadline({ hold_minutes: 30 }, now), now + 30 * minute);
  assert.equal(resolvePaidDeadline({ hold_minutes: 1440, cutoff_ms: now + minute }, now), now + minute);
  assert.equal(resolvePaidDeadline({ hold_minutes: 30, cutoff_ms: cutoff, deadline_mode: "fixed" }, now), cutoff);
  assert.equal(resolvePaidDeadline({ hold_minutes: 30, cutoff_ms: cutoff, deadline_mode: "fixed" }, cutoff + minute), cutoff);
});

test("the review queue orders slip submissions before pagination in both directions", async () => {
  process.env.PAID_PROOF_ENCRYPTION_KEY = "01".repeat(32);
  const directory = mkdtempSync(join(tmpdir(), "facebot-review-"));
  const file = join(directory, "test.db");
  const db = new SqliteAppDatabase(file);
  const fixture = new Database(file);
  try {
    await db.initialize();
    const organizationId = "org_default";
    const event = await db.createEvent({ name: "Slip review order", organizer_id: organizationId });
    await db.updateEvent(event.id, { status: "active" });
    const customer = await db.createCustomerAccount({
      email: "review@example.com", normalized_email: "review@example.com", password_hash: "fixture",
      first_name: "Test", last_name: "Buyer", phone: "", normalized_phone: "", accepted_terms_at: new Date(), accepted_privacy_at: new Date(),
    });
    const settings = await db.savePaidSettings(event.id, {
      organizationId, version: 0, capacity: 22, holdMinutes: 15, cutoffMs: null, published: true,
      paymentMode: "external_manual", categories: [{ id: "adult", label: "Adult", unitMinor: 25000, quota: null }],
    });
    const attemptIds: string[] = [];
    let unpaidBookingId = "";
    const setSubmissionTime = fixture.prepare("UPDATE paid_payment_attempts SET created_ms=? WHERE id=?");
    const now = Date.now();
    for (let index = 0; index < 22; index++) {
      const booking = await db.createPaidBooking({
        eventId: event.id, customerId: customer.id, key: `booking-${index}`, pricingVersion: Number(settings.version),
        contact: { name: "Test Buyer" }, attendees: [{ categoryId: "adult", firstName: "Guest", lastName: String(index) }],
      });
      if (index === 21) {
        unpaidBookingId = booking.id;
        break;
      }
      const proof = await db.submitPaidProof({
        eventId: event.id, bookingId: booking.id, customerId: customer.id, key: `proof-${index}`, version: 1,
        method: "bank_transfer", claimedMinor: 25000, claimedTransferMs: Date.now(), reference: null,
        mime: "image/png", content: Buffer.from(`proof ${index}`),
      });
      setSubmissionTime.run(now - index * 1_000, proof.attempt_id);
      attemptIds.push(proof.attempt_id);
    }
    for (const sort of ["desc", "asc"] as const) {
      const expected = sort === "desc" ? attemptIds : [...attemptIds].reverse();
      const firstPage = await db.listPaidReviewQueue(event.id, organizationId, 0, undefined, sort);
      const secondPage = await db.listPaidReviewQueue(event.id, organizationId, 20, undefined, sort);
      assert.deepEqual(firstPage.map((row) => row.attempt_id), expected);
      assert.deepEqual(secondPage.map((row) => row.attempt_id), [expected[20], null]);
      assert.deepEqual(firstPage.map((row) => row.attendee_names), expected.map((id) => [`Guest ${attemptIds.indexOf(id)}`]));
      assert.deepEqual(secondPage[1].attendee_names, ["Guest 21"]);
      assert.equal(secondPage[1].customer_first_name, "Test");
    }
    assert.deepEqual((await db.listOwnedPaidBookings(customer.id, 20, 0, "", false, true)).map((row) => row.id), [unpaidBookingId]);
    assert.equal(await db.deleteUnverifiedCustomerAccount(customer.id), false);
    const staffProof = {
      eventId: event.id, bookingId: unpaidBookingId, version: 1, key: "staff-proof", method: "bank_transfer" as const,
      claimedMinor: 25000, claimedTransferMs: Date.now(), reference: null, mime: "image/png" as const, content: Buffer.from("staff proof"),
    };
    await assert.rejects(db.submitPaidProof({ ...staffProof, staff: { organizationId: "other", actorId: "wrong-admin" } }), /event_not_found/);
    const staffInput = { ...staffProof, staff: { organizationId, actorId: "admin-uploader" } };
    const staffReceipt = await db.submitPaidProof(staffInput);
    assert.equal(staffReceipt.status, "verification_pending");
    assert.deepEqual(await db.submitPaidProof(staffInput), staffReceipt);
    assert.equal((await db.listPaidReviewQueue(event.id, organizationId, 0, undefined, "desc"))[0].booking_id, unpaidBookingId);
    assert.deepEqual(await db.listOwnedPaidBookings(customer.id, 20, 0, "", false, true), []);
    assert.equal(fixture.prepare("SELECT actor FROM paid_audit_events WHERE booking_id=? AND action='staff_submit_proof'").pluck().get(unpaidBookingId), "admin-uploader");
  } finally {
    fixture.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function raceGroups(file: string, command: PaidBookingInput) {
  const adapterUrl = new URL("./sqliteAdapter.ts", import.meta.url).href;
  const source = `
    import { SqliteAppDatabase } from ${JSON.stringify(adapterUrl)};
    const db = new SqliteAppDatabase(process.argv[1]);
    process.once("message", async (input) => {
      try {
        await db.createPaidBooking(input);
        process.send("booked");
      } catch (error) {
        process.send(error.code || "unexpected");
      } finally {
        await db.close();
        process.disconnect();
      }
    });
    process.send("ready");
  `;
  const children = Array.from({ length: 2 }, () => spawn(process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", source, file],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] },
  ));
  const exited = children.map((child) => once(child, "exit"));
  try {
    await Promise.all(children.map(async (child) => {
      const [message] = await once(child, "message", { signal: AbortSignal.timeout(10_000) });
      assert.equal(message, "ready");
    }));
    const outcomes = children.map((child) => once(child, "message", { signal: AbortSignal.timeout(10_000) }));
    children.forEach((child, index) => child.send({ ...command, key: `race-${index}` }));
    return (await Promise.all(outcomes)).map(([message]) => message).sort();
  } finally {
    children.forEach((child) => { if (child.exitCode === null) child.kill(); });
    await Promise.all(exited);
  }
}

test("paid groups reserve capacity, replay safely, and expire once", async () => {
  process.env.PAID_PROOF_ENCRYPTION_KEY = "01".repeat(32);
  const directory = mkdtempSync(join(tmpdir(), "facebot-paid-"));
  const file = join(directory, "test.db");
  const db = new SqliteAppDatabase(file);
  const second = new SqliteAppDatabase(file);
  const fixture = new Database(file);
  try {
    await db.initialize();
    await second.initialize();
    const event = await db.createEvent({ name: "Paid workshop", organizer_id: "org_default" });
    await db.updateEvent(event.id, { status: "active" });
    const customer = await db.createCustomerAccount({
      email: "paid@example.com", normalized_email: "paid@example.com", password_hash: "fixture",
      first_name: "A", last_name: "B", phone: "", normalized_phone: "", accepted_terms_at: new Date(), accepted_privacy_at: new Date(),
    });
    const settings = {
      organizationId: "org_default", version: 0, capacity: 3, holdMinutes: 15, cutoffMs: null, published: true,
      categories: [{ id: "adult", label: "Adult", unitMinor: 25000, quota: 2 }],
    };
    await assert.rejects(db.savePaidSettings(event.id, { ...settings, organizationId: "other" }), /event_not_found/);
    await db.savePaidSettings(event.id, settings);
    await assert.rejects(second.savePaidSettings(event.id, settings), /version_conflict/);
    assert.throws(() => fixture.prepare("INSERT INTO registrations (id,event_id,first_name,last_name) VALUES ('LEGACY',?,'Legacy','Guest')").run(event.id), /paid_registration_required/);
    const command = {
      eventId: event.id, customerId: customer.id, key: "accept-quote", pricingVersion: 1,
      contact: { name: "Buyer" },
      receiver: { id: "0812345678", name: "Organizer", profileVersion: 1 },
      attendees: [
        { categoryId: "adult", firstName: "One", lastName: "Guest" },
        { categoryId: "adult", firstName: "Two", lastName: "Guest" },
      ],
    };
    assert.deepEqual(await db.readPaidCatalog(event.id), {
      pricing_version: 1, fields: [], categories: [{ id: "adult", label: "Adult", unit_minor: 25000, accommodation_discount_minor: 0 }],
    });
    const receipt = await db.createPaidBooking(command);
    const unconfirmedRooming = (await db.paidRoomingPlan(event.id, "org_default"))!;
    assert.deepEqual(unconfirmedRooming.guests.map(({ name, bookingState }) => [name, bookingState]), [
      ["One Guest", "awaiting_payment"], ["Two Guest", "awaiting_payment"],
    ]);
    const reservedRooms = [{
      id: "draft-room", number: "", locked: false, slots: [...unconfirmedRooming.guests.map(({ id }) => id), null, null],
    }];
    assert.deepEqual((await db.paidRoomingPlan(event.id, "org_default", { version: 0, rooms: reservedRooms }))?.rooms, reservedRooms);

    const adminA=await db.createUser({username:"notif-admin-a",display_name:"Notification Admin A",
      password_hash:"fixture",role:"admin"});
    const adminB=await db.createUser({username:"notif-admin-b",display_name:"Notification Admin B",
      password_hash:"fixture",role:"admin"});
    const eventActivity=await db.readPaidEventSummary(event.id,"org_default",true);
    const notificationId=String((eventActivity!.activity as Array<{id:string}>)[0].id);
    assert.deepEqual(await db.getAdminNotificationState("org_default",adminA.id,event.id),
      {time:0,readIds:[],dismissedIds:[],unreadIds:[],deletedIds:[],imported:false});
    const migrated=await db.mutateAdminNotificationState("org_default",adminA.id,event.id,
      {action:"import",time:10,ids:[notificationId],archivedIds:[notificationId]});
    assert.equal(migrated.time,10);
    assert.deepEqual(migrated.readIds,[notificationId]);
    assert.deepEqual(migrated.dismissedIds,[notificationId]);
    await second.mutateAdminNotificationState("org_default",adminA.id,event.id,
      {action:"import",time:999999999,ids:[],archivedIds:[]});
    assert.deepEqual(await second.getAdminNotificationState("org_default",adminA.id,event.id),migrated,
      "a second device must not replay legacy storage after first import");
    assert.deepEqual(await second.getAdminNotificationState("org_default",adminB.id,event.id),
      {time:0,readIds:[],dismissedIds:[],unreadIds:[],deletedIds:[],imported:false},
      "another admin must not inherit the first admin's read state");
    const restoredNotification=await second.mutateAdminNotificationState("org_default",adminA.id,event.id,
      {action:"restore",ids:[notificationId]});
    assert.deepEqual(restoredNotification.dismissedIds,[]);
    const reArchived=await db.mutateAdminNotificationState("org_default",adminA.id,event.id,
      {action:"archive",ids:[notificationId]});
    assert.deepEqual(reArchived.dismissedIds,[notificationId]);
    assert.deepEqual((await second.getAdminNotificationState("org_default",adminA.id,event.id)).dismissedIds,
      [notificationId],"archive on one device must be immediately readable from another");
    assert.deepEqual((await db.mutateAdminNotificationState("org_default",adminA.id,event.id,
      {action:"restore_all"})).dismissedIds,[]);
    assert.deepEqual((await db.mutateAdminNotificationState("org_default",adminA.id,event.id,
      {action:"archive",ids:["invalid-event-notification"]})).dismissedIds,[],
      "foreign or forged audit IDs must never be written");
    const allRead=await second.mutateAdminNotificationState("org_default",adminA.id,event.id,
      {action:"read_all"});
    assert.ok(allRead.time>0,"read all must persist a server-calculated audit high-water mark");
    assert.equal((await db.getAdminNotificationState("org_default",adminA.id,event.id)).time,allRead.time);
    assert.ok((await db.readPaidEventSummary(event.id,"org_default",true))!.activity,
      "read/archive actions must not remove the original booking audit event");
    const paidRoster=await db.listPaidAttendeeRoster(event.id,"org_default");
    assert.equal(paidRoster.length,2,"paid roster must contain one row for each person in one booking");
    assert.deepEqual(paidRoster.map(p=>p.first_name).sort(),["One","Two"]);
    assert.equal(paidRoster[0].booking_id,receipt.id);
    assert.equal(paidRoster[0].booking_reference,receipt.reference);
    assert.equal(paidRoster[0].customer_email,"paid@example.com");
    assert.equal(paidRoster[0].booking_state,"awaiting_payment");
    await assert.rejects(db.listPaidAttendeeRoster(event.id,"some_other_organizer"),/event_not_found/);
    const orgBookings=await db.listOrganizationPaidBookings("org_default");
    const orgEntry=orgBookings.find((booking)=>booking.booking_id===receipt.id);
    assert.ok(orgEntry,"real paid bookings must appear in organizer-wide reporting");
    assert.equal(orgEntry.event_name,"Paid workshop");
    assert.equal(orgEntry.customer_email,"paid@example.com");
    assert.equal(orgEntry.customer_id,customer.id);
    assert.equal(orgEntry.attendee_count,2);
    assert.equal(orgEntry.total_minor,50000);
    assert.equal(orgEntry.state,"awaiting_payment");
    assert.deepEqual(await db.listOrganizationPaidBookings("other_organizer"),[],
      "organizer queries cannot read another organizer's bookings");

    fixture.prepare("UPDATE customer_accounts SET status='active',email_verified_at=CURRENT_TIMESTAMP WHERE id=?").run(customer.id);
    await db.createPaidMessengerLinkToken(event.id, customer.id, "hash-one");
    assert.equal(await second.exchangePaidMessengerLinkToken(event.id, "page", "sender", "hash-one"), true);
    assert.equal(await second.exchangePaidMessengerLinkToken(event.id, "page", "sender", "hash-one"), true);
    assert.equal(await second.exchangePaidMessengerLinkToken(event.id, "other-page", "other-sender", "hash-one"), false);
    assert.equal(await db.readPaidMessengerCustomer(event.id, "page", "sender"), customer.id);
    assert.equal((await db.readPaidMessengerStatus(event.id, "page", "sender", receipt.reference))?.state, "awaiting_payment");
    assert.equal(await db.readPaidMessengerStatus(event.id, "page", "unknown-sender", receipt.reference), undefined);
    assert.equal(await db.readPaidMessengerStatus(event.id, "other-page", "sender", receipt.reference), undefined);
    assert.equal(await db.readPaidMessengerCustomer(event.id, "other-page", "sender"), undefined);
    await db.unlinkPaidMessenger(event.id, customer.id);
    assert.equal(await db.readPaidMessengerCustomer(event.id, "page", "sender"), undefined);
    assert.equal(await db.exchangePaidMessengerLinkToken(event.id, "page", "sender", "hash-one"), false);
    assert.equal(await second.readOwnedPaidBooking(event.id, receipt.id, "other-customer"), undefined);
    const owned = await second.readOwnedPaidBooking(event.id, receipt.id, customer.id);
    assert.equal(owned?.state, "awaiting_payment");
    assert.equal((await db.listOwnedPaidBookings(customer.id, 20, 0))[0]?.id, receipt.id);
    assert.deepEqual(await second.listOwnedPaidBookings("other-customer", 20, 0), []);
    assert.equal((owned?.attendees as unknown[]).length, 2);
    assert.equal(receipt.totalMinor, 50000);
    assert.deepEqual(await second.createPaidBooking(command), receipt);
    await assert.rejects(second.createPaidBooking({ ...command, contact: { name: "Changed" } }), /idempotency_conflict/);
    await assert.rejects(second.createPaidBooking({ ...command, key: "another-group" }), /attendee_already_registered/);
    const otherBooker = await db.createCustomerAccount({
      email: "paid-other@example.com", normalized_email: "paid-other@example.com", password_hash: "fixture",
      first_name: "Other", last_name: "Buyer", phone: "", normalized_phone: "", accepted_terms_at: new Date(), accepted_privacy_at: new Date(),
    });
    const firstGuest = command.attendees[0];
    const matchingGuest = { ...firstGuest, firstName: " one  ", lastName: "GUEST" };
    await assert.rejects(second.createPaidBooking({
      ...command, key: "other-booker", customerId: otherBooker.id,
      contact: { name: "Other Buyer" }, attendees: [matchingGuest],
    }), /attendee_already_registered/);
    await assert.rejects(second.createPaidBooking({
      ...command, key: "repeat-in-group", attendees: [firstGuest, matchingGuest],
    }), /duplicate_attendee_in_booking/);
    await assert.rejects(second.createPaidBooking({
      ...command, key: "one-guest", attendees: [{ ...firstGuest, firstName: "Three" }],
    }), /capacity_exhausted/);
    await assert.rejects(db.savePaidSettings(event.id, { ...settings, version: 1, capacity: 1 }), /capacity_in_use/);
    fixture.prepare("UPDATE paid_bookings SET created_ms=1,due_ms=2 WHERE id=?").run(receipt.id);
    assert.deepEqual(await db.listDuePaidEvents(Date.now()), [event.id]);
    assert.equal(await second.expirePaidBookings(event.id), 1);
    assert.equal(await db.expirePaidBookings(event.id), 0);
    const expiredRooming = (await second.paidRoomingPlan(event.id, "org_default"))!;
    assert.deepEqual(expiredRooming.guests.map(({ bookingState }) => bookingState), ["expired", "expired"]);
    assert.deepEqual(expiredRooming.rooms, reservedRooms);

    assert.deepEqual(await raceGroups(file, command), ["attendee_already_registered", "booked"]);
    await assert.rejects(db.reinstateOwnedPaidBooking(event.id, receipt.id, customer.id), /attendee_already_registered/);
    assert.equal((fixture.prepare("SELECT COUNT(*) AS count FROM paid_attendees a JOIN paid_bookings b ON b.id=a.booking_id WHERE b.state='awaiting_payment'").get() as { count: number }).count, 2);
    assert.equal((await db.listOwnedPaidBookings(customer.id, 20, 0)).length, 2);
    const bookings = await db.listOwnedPaidBookings(customer.id, 20, 0);
    const active = bookings.find((booking) => booking.status === "awaiting_payment")!;
    assert.deepEqual(active.attendee_names, ["One Guest","Two Guest"]);
    const proof = {
      eventId: event.id, bookingId: String(active.id), customerId: customer.id, key: "slip", version: 1,
      method: "promptpay" as const, claimedMinor: 50000, claimedTransferMs: Date.now(), reference: null,
      mime: "image/png" as const, content: Buffer.from("repository-level proof fixture"),
    };
    await assert.rejects(db.submitPaidProof({ ...proof, customerId: "other" }), /booking_not_found/);
    await assert.rejects(db.submitPaidProof({ ...proof, bookingId: receipt.id }), /hold_expired/);
    const submitted = await db.submitPaidProof(proof);
    assert.equal(submitted.status, "verification_pending");
    const reviewRooming = (await db.paidRoomingPlan(event.id, "org_default"))!;
    assert.deepEqual(reviewRooming.guests.filter(guest => guest.bookingId === active.id).map(guest => guest.bookingState),
      ["verification_pending", "verification_pending"]);

    const [queued] = await db.listPaidReviewQueue(event.id, "org_default", 0);
    assert.equal(queued.attempt_id, submitted.attempt_id);
    assert.equal(queued.attendee_count, 2);
    assert.deepEqual(queued.attendee_names, ["One Guest", "Two Guest"]);
    const reviewAttendees = queued.attendees as { name: string; category_label: string; unit_minor: number }[];
    assert.deepEqual(reviewAttendees.map(({ name, category_label, unit_minor }) => [name, category_label, unit_minor]), [
      ["One Guest", "Adult", 25000],
      ["Two Guest", "Adult", 25000],
    ]);
    assert.equal(queued.receiver_last_four, "5678");
    assert.ok(!("receiver_id" in queued) && !("content" in queued));
    await assert.rejects(db.listPaidReviewQueue(event.id, "other", 0), /event_not_found/);
    assert.deepEqual(await second.submitPaidProof(proof), submitted);
    await assert.rejects(second.submitPaidProof({ ...proof, claimedMinor: 49000 }), /idempotency_conflict/);
    const originalWindow = fixture.prepare("SELECT created_ms,due_ms FROM paid_bookings WHERE id=?").get(active.id) as { created_ms: number; due_ms: number };
    fixture.prepare("UPDATE paid_bookings SET created_ms=1,due_ms=2 WHERE id=?").run(active.id);
    assert.equal(await second.expirePaidBookings(event.id), 0);
    fixture.prepare("UPDATE paid_bookings SET created_ms=?,due_ms=? WHERE id=?").run(originalWindow.created_ms, originalWindow.due_ms, active.id);
    assert.equal((await db.readOwnedPaidBooking(event.id, String(active.id), customer.id))?.payment_state, "proof_submitted");
    assert.equal(fixture.prepare("SELECT COUNT(*) AS count FROM paid_proofs").pluck().get(), 1);
    const ciphertext = fixture.prepare("SELECT content FROM paid_proofs").pluck().get();
    assert.ok(Buffer.isBuffer(ciphertext) && !ciphertext.includes(proof.content));
    assert.deepEqual((await db.readPaidProof(event.id, String(active.id), submitted.attempt_id, "org_default"))?.content, proof.content);
    assert.equal(await db.readPaidProof(event.id, String(active.id), submitted.attempt_id, "other"), undefined);
    const countCredentials = () => fixture.prepare("SELECT COUNT(*) FROM paid_credentials").pluck().get();
    assert.equal(countCredentials(), 0);
    const review = {
      eventId: event.id, bookingId: String(active.id), attemptId: submitted.attempt_id,
      organizationId: "org_default", reviewerId: "test-reviewer", key: "approve", version: 2,
      decision: "approve" as const, reason: "Matched against test bank statement",
      observed: { amountMinor: 49999, transferMs: originalWindow.created_ms, reference: "bank-ref", receiverNamespace: "0812345678" },
    };
    await assert.rejects(second.reviewPaidProof({ ...review, organizationId: "other" }), /event_not_found/);
    await assert.rejects(db.reviewPaidProof({ ...review, observed: { ...review.observed, receiverNamespace: "0899999999" } }), /receiver_mismatch/);
    const underpaid = await db.reviewPaidProof(review);
    assert.equal(underpaid.payment_status, "underpaid");
    assert.equal(countCredentials(), 0);
    const approval = { ...review, key: "exact", version: 3, observed: { ...review.observed, amountMinor: 50000 } };
    // Retention must never delete a pending-review slip, even if both
    // timestamps are old enough to qualify for an otherwise finished booking.
    fixture.prepare("UPDATE paid_proofs SET created_ms=1 WHERE attempt_id=?").run(submitted.attempt_id);
    fixture.prepare("UPDATE paid_bookings SET updated_ms=1 WHERE id=?").run(active.id);
    assert.equal(await db.purgeExpiredPaidProofImages(Date.now() - 180 * 86_400_000, 200), 0);
    assert.ok(await db.readPaidProof(event.id, String(active.id), submitted.attempt_id, "org_default"));
    const confirmed = await db.reviewPaidProof(approval);
    assert.equal(confirmed.status, "confirmed");
    await assert.rejects(second.createPaidBooking({
      ...command, key: "after-confirmation", customerId: otherBooker.id, attendees: [matchingGuest],
    }), /attendee_already_registered/);
    const confirmedRooming = (await db.paidRoomingPlan(event.id, "org_default"))!;
    assert.deepEqual(confirmedRooming.guests.filter(guest => guest.bookingId === active.id).map(guest => guest.bookingState),
      ["confirmed", "confirmed"]);

    // Simulate 181-day-old completed booking and uploaded evidence.
    fixture.prepare("UPDATE paid_proofs SET created_ms=1 WHERE attempt_id=?").run(submitted.attempt_id);
    fixture.prepare("UPDATE paid_bookings SET updated_ms=1 WHERE id=?").run(active.id);
    const checksumBefore = fixture.prepare("SELECT checksum FROM paid_proofs WHERE attempt_id=?")
      .pluck().get(submitted.attempt_id);
    assert.equal(await db.purgeExpiredPaidProofImages(Date.now() - 180 * 86_400_000, 200), 1);
    assert.equal(await db.purgeExpiredPaidProofImages(Date.now() - 180 * 86_400_000, 200), 0);
    const agedProof = fixture.prepare("SELECT content,deleted_ms,checksum FROM paid_proofs WHERE attempt_id=?")
      .get(submitted.attempt_id) as { content: Buffer | null; deleted_ms: number; checksum: string };
    assert.equal(agedProof.content, null);
    assert.ok(agedProof.deleted_ms > 0);
    assert.equal(agedProof.checksum, checksumBefore);
    assert.equal(await db.readPaidProof(event.id, String(active.id), submitted.attempt_id, "org_default"), undefined);
    assert.deepEqual(await db.listPaidReviewQueue(event.id, "org_default", 0), []);
    assert.deepEqual(await second.reviewPaidProof(approval), confirmed);
    await assert.rejects(second.reviewPaidProof({ ...approval, key: "again" }), /state_conflict/);
    assert.equal(countCredentials(), 2);
    const deliveries = await db.listNotificationDeliveries({ related_type: "paid_booking", related_id: String(active.id) });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].kind, "paid_booking.confirmed");
    const confirmedBooking = await db.readOwnedPaidBooking(event.id, String(active.id), customer.id);
    const [first, secondAttendee] = confirmedBooking?.attendees as { id: string }[];
    const credential = await db.readPaidCredential(event.id, String(active.id), first.id, customer.id);
    assert.ok(credential);
    assert.notEqual(await db.readPaidCredential(event.id, String(active.id), secondAttendee.id, customer.id), credential);
    assert.equal(await db.readPaidCredential(event.id, String(active.id), first.id, "other-customer"), undefined);
    assert.equal(await db.checkInPaidCredential(event.id, "fbs-paid:invalid", "checker"), undefined);
    const otherEvent = await db.createEvent({ name: "Other event", organizer_id: "org_default" });
    await db.updateEvent(otherEvent.id, { status: "active" });
    assert.equal(await db.checkInPaidCredential(otherEvent.id, credential, "checker"), undefined);
    assert.equal((await db.checkInPaidCredential(event.id, credential, "checker"))?.already_checked_in, false);
    assert.equal((await second.checkInPaidCredential(event.id, credential, "checker"))?.already_checked_in, true);
    fixture.prepare("UPDATE paid_credentials SET revoked_ms=1 WHERE attendee_id=?").run(first.id);
    assert.equal(await db.checkInPaidCredential(event.id, credential, "checker"), undefined);
    await db.savePaidSettings(otherEvent.id, settings);
    const manualBooking = await db.createPaidBooking({ ...command, eventId: otherEvent.id });
    const manualReview = {
      ...approval, eventId: otherEvent.id, bookingId: manualBooking.id, attemptId: undefined, version: 1,
      observed: { ...approval.observed, transferMs: Date.now() },
    };
    await assert.rejects(db.reviewPaidProof(manualReview), /duplicate_reference_or_proof/);
    assert.equal((await db.readOwnedPaidBooking(otherEvent.id, manualBooking.id, customer.id))?.state, "awaiting_payment");
    const manualConfirmed = await db.reviewPaidProof({
      ...manualReview, observed: { ...manualReview.observed, reference: "manual-bank-ref" },
    });
    assert.equal(manualConfirmed.status, "confirmed");
    assert.equal(fixture.prepare("SELECT method FROM paid_payment_attempts WHERE booking_id=?").pluck().get(manualBooking.id), "manual");
    // A paid settlement must not be accepted again through legacy Direct Ticketing.
    const directEvent = await db.createEvent({ name: "Separate direct checkout event", organizer_id: "org_default" });
    fixture.prepare("INSERT INTO event_performances (id,event_id,code,title,starts_at) VALUES (?,?,?,?,?)")
      .run("cross-performance", directEvent.id, "cross", "Cross-domain settlement test", "2026-12-01T12:00:00Z");
    fixture.prepare("INSERT INTO direct_seats (id,event_id,performance_id,zone,row_label,seat_label) VALUES (?,?,?,?,?,?)")
      .run("cross-seat", directEvent.id, "cross-performance", "A", "1", "1");
    fixture.prepare("INSERT INTO direct_tickets (id,event_id,performance_id,seat_id,ticket_class,payment_status,status) VALUES (?,?,?,?,?,?,?)")
      .run("cross-ticket", directEvent.id, "cross-performance", "cross-seat", "Adult", "awaiting_payment", "held");
    fixture.prepare("INSERT INTO direct_orders (id,event_id,performance_id,status) VALUES (?,?,?,?)")
      .run("cross-order", directEvent.id, "cross-performance", "pending_payment");
    await assert.rejects(db.updateDirectTicketPayment("cross-ticket", {
      payment_status: "verified", payment_reference: " manual-bank-ref ",
    }), /duplicate_reference_or_proof/);
    await assert.rejects(db.updateDirectOrderPayment("cross-order", {
      payment_status: "verified", payment_reference: "manual-bank-ref",
    }), /duplicate_reference_or_proof/);
    assert.equal(fixture.prepare("SELECT status FROM direct_tickets WHERE id='cross-ticket'").pluck().get(), "held");
    assert.equal(fixture.prepare("SELECT status FROM direct_orders WHERE id='cross-order'").pluck().get(), "pending_payment");
    // The reverse direction also fails closed: a Direct Ticketing settlement cannot confirm a new paid booking.
    assert.equal((await db.updateDirectTicketPayment("cross-ticket", {
      payment_status: "verified", payment_reference: "DIRECT-BANK-REF",
    }))?.payment_status, "verified");
    const crossPaidEvent = await db.createEvent({ name: "Cross-system paid event", organizer_id: "org_default" });
    await db.updateEvent(crossPaidEvent.id, { status: "active" });
    await db.savePaidSettings(crossPaidEvent.id, settings);
    const crossPaidBooking = await db.createPaidBooking({ ...command, eventId: crossPaidEvent.id });
    await assert.rejects(db.reviewPaidProof({
      ...manualReview, eventId: crossPaidEvent.id, bookingId: crossPaidBooking.id, key: "direct-ref-reuse",
      observed: { ...manualReview.observed, transferMs: Date.now(), reference: "direct-bank-ref" },
    }), /duplicate_reference_or_proof/);
    assert.equal((await db.readOwnedPaidBooking(crossPaidEvent.id, crossPaidBooking.id, customer.id))?.state, "awaiting_payment");

    const reusedProof = await db.submitPaidProof({
      ...proof, eventId: crossPaidEvent.id, bookingId: crossPaidBooking.id, key: "reused-slip", version: 1,
    });
    await assert.rejects(db.reviewPaidProof({
      ...manualReview, eventId: crossPaidEvent.id, bookingId: crossPaidBooking.id, key: "approve-reused-slip",
      attemptId: reusedProof.attempt_id, version: reusedProof.version, observed: undefined,
    }), /duplicate_reference_or_proof/);

    const operationsEvent = await db.createEvent({ name: "Admin operations fixture", organizer_id: "org_default" });
    await db.updateEvent(operationsEvent.id, { status: "active" });
    await db.savePaidSettings(operationsEvent.id, settings);
    const operationsBooking = await db.createPaidBooking({ ...command, eventId: operationsEvent.id, key: "admin-hold" });
    const common = { eventId: operationsEvent.id, bookingId: operationsBooking.id,
      organizationId: "org_default", actorId: "reviewer", reason: "Customer requested" };
    assert.equal((await db.readPaidAdminBooking(operationsEvent.id, "org_default", operationsBooking.reference))?.state, "awaiting_payment");
    await assert.rejects(db.readPaidAdminBooking(operationsEvent.id, "other", operationsBooking.reference), /event_not_found/);
    const extended = await db.managePaidBooking({ ...common, action: "extend", key: "extend-hold",
      version: 1, holdMinutes: 120 });
    assert.equal(extended.status, "awaiting_payment");
    assert.deepEqual(await db.managePaidBooking({ ...common, action: "extend", key: "extend-hold",
      version: 1, holdMinutes: 120 }), extended);
    await assert.rejects(db.managePaidBooking({ ...common, action: "extend", key: "conflicting",
      version: 1, holdMinutes: 120 }), /version_conflict/);
    fixture.prepare("UPDATE paid_bookings SET created_ms=1,due_ms=2 WHERE id=?").run(operationsBooking.id);
    assert.equal(await db.expirePaidBookings(operationsEvent.id), 1);
    const restored = await db.managePaidBooking({ ...common, action: "reinstate", key: "reinstate",
      version: 3, holdMinutes: 60 });
    assert.equal(restored.status, "awaiting_payment");
    const cancelled = await db.managePaidBooking({ ...common, action: "cancel", key: "cancel",
      version: 4 });
    assert.equal(cancelled.status, "cancelled");
    assert.equal((await db.readPaidEventSummary(operationsEvent.id, "org_default"))?.held_attendees, 0);
    // Opt-in, idempotent reminder for 24h+ holds that are nearing the payment deadline.
    await db.savePaidSettings(operationsEvent.id, {
      ...settings, version: 1, holdMinutes: 48 * 60,
    });
    const reminderBooking = await db.createPaidBooking({
      ...command, eventId: operationsEvent.id, pricingVersion: 2, key: "reminder-booking",
    });
    const reminderNow = Date.now();
    fixture.prepare("UPDATE paid_bookings SET created_ms=?,due_ms=? WHERE id=?")
      .run(reminderNow - 25 * 60 * 60_000, reminderNow + 23 * 60 * 60_000, reminderBooking.id);
    const oldReminderFlag = process.env.PAID_REGISTRATION_REMINDERS_ENABLED;
    try {
      delete process.env.PAID_REGISTRATION_REMINDERS_ENABLED;
      await db.expirePaidBookings(operationsEvent.id);
      assert.equal((await db.listNotificationDeliveries({
        related_type: "paid_booking", related_id: reminderBooking.id,
      })).length, 0);
      process.env.PAID_REGISTRATION_REMINDERS_ENABLED = "1";
      await db.expirePaidBookings(operationsEvent.id);
      await db.expirePaidBookings(operationsEvent.id);
      const reminders = await db.listNotificationDeliveries({
        related_type: "paid_booking", related_id: reminderBooking.id,
      });
      assert.equal(reminders.length, 1);
      assert.equal(reminders[0].kind, "paid_booking.payment_reminder");
    } finally {
      if (oldReminderFlag === undefined) delete process.env.PAID_REGISTRATION_REMINDERS_ENABLED;
      else process.env.PAID_REGISTRATION_REMINDERS_ENABLED = oldReminderFlag;
    }
    const refundRecord = {
      eventId: otherEvent.id, bookingId: manualBooking.id, organizationId: "org_default",
      actorId: "reviewer", key: "refund-paid", version: 2, action: "refund" as const,
      reason: "Full bank refund verified", refundReference: "refund-external-001",
    };
    const refund = await db.managePaidBooking(refundRecord);
    assert.equal(refund.status, "cancelled");
    assert.equal(refund.payment_status, "refunded");
    assert.deepEqual(await db.managePaidBooking(refundRecord), refund);
    assert.equal(fixture.prepare("SELECT COUNT(*) FROM paid_refunds WHERE booking_id=?").pluck().get(manualBooking.id), 1);
    assert.equal(fixture.prepare("SELECT COUNT(*) FROM paid_credentials WHERE booking_id=? AND revoked_ms IS NULL").pluck().get(manualBooking.id), 0);

    // Internal paid event: book and manually confirm an external payment without any PromptPay receiver.
    const externalEvent = await db.createEvent({ name: "Private external payment seminar", organizer_id: "org_default" });
    await db.updateEvent(externalEvent.id, { status: "active" });
    const externalSettings = await db.savePaidSettings(externalEvent.id, {
      ...settings, paymentMode: "external_manual",
      categories: [
        ...settings.categories,
        { id: "child_free", label: "เด็ก 1–3 ปี / Free child", unitMinor: 0, quota: null },
      ],
    });
    assert.equal(externalSettings.payment_mode, "external_manual");
    assert.equal((await db.readPaidMode(externalEvent.id))?.paymentMode, "external_manual");
    const externalBooking = await db.createPaidBooking({ ...command, eventId: externalEvent.id, key: "external-booking", receiver: undefined,
      pricingVersion: Number(externalSettings.version),
      attendees: [...command.attendees,
        { categoryId: "child_free", firstName: "Tiny", lastName: "Guest" }],
    });
    assert.equal(externalBooking.totalMinor, 50000);
    const freeAttendees = (await db.readOwnedPaidBooking(externalEvent.id, externalBooking.id, customer.id))?.attendees as
      { first_name: string; unit_minor: number }[];
    assert.equal(freeAttendees.length, 3);
    assert.equal(freeAttendees.find((row) => row.first_name === "Tiny")?.unit_minor, 0);
    assert.equal((await db.readOwnedPaidBooking(externalEvent.id, externalBooking.id, customer.id))?.payment_mode, "external_manual");
    const externalQueue = await db.listPaidReviewQueue(externalEvent.id, "org_default", 0, externalBooking.reference);
    assert.equal(externalQueue[0]?.payment_mode, "external_manual");
    const unfilteredExternalQueue = await db.listPaidReviewQueue(externalEvent.id, "org_default", 0);
    assert.equal(unfilteredExternalQueue.some((row) => row.booking_reference === externalBooking.reference), true);
    const externalReview = await db.reviewPaidProof({
      ...manualReview, eventId: externalEvent.id, bookingId: externalBooking.id, key: "external-review", version: 1,
      observed: { ...manualReview.observed, amountMinor: externalBooking.totalMinor, transferMs: Date.now(),
        receiverNamespace: "EXTERNAL_MANUAL", reference: "external-receipt-001" },
    });
    assert.equal(externalReview.status, "confirmed");
    assert.equal(fixture.prepare("SELECT COUNT(*) FROM paid_credentials WHERE booking_id=?").pluck().get(externalBooking.id), 3);
    await assert.rejects(db.reviewPaidProof({
      ...manualReview, eventId: externalEvent.id, bookingId: externalBooking.id, key: "external-retry", version: 1,
      observed: { ...manualReview.observed, amountMinor: externalBooking.totalMinor, transferMs: Date.now(),
        receiverNamespace: "EXTERNAL_MANUAL", reference: "external-receipt-001" },
    }), /state_conflict/);

    // Customer recovery: a 24-hour hold can be restored by its owner without
    // duplicating attendees or charging twice. Other customers cannot reopen it.
    const recoveryEvent = await db.createEvent({ name: "Recovery workshop", organizer_id: "org_default" });
    await db.updateEvent(recoveryEvent.id, { status: "active" });
    const recoverySettings = await db.savePaidSettings(recoveryEvent.id, {
      ...settings, holdMinutes: 1440,
      categories: settings.categories.map((category) => ({ ...category, quota: 3 })),
    });
    const recovering = await db.createPaidBooking({
      ...command, eventId: recoveryEvent.id, key: "recovery", pricingVersion: Number(recoverySettings.version),
    });
    assert.ok(recovering.dueMs - Date.now() > 23 * 60 * 60_000);
    fixture.prepare("UPDATE paid_bookings SET created_ms=1,due_ms=2 WHERE id=?").run(recovering.id);
    assert.equal((await db.readOwnedPaidBooking(recoveryEvent.id, recovering.id, customer.id))?.state, "expired");
    await assert.rejects(db.reinstateOwnedPaidBooking(recoveryEvent.id, recovering.id, "other-customer"), /booking_not_found/);
    const reopened = await second.reinstateOwnedPaidBooking(recoveryEvent.id, recovering.id, customer.id);
    assert.equal(reopened.status, "awaiting_payment");
    assert.equal(reopened.payment_status, "unpaid");
    assert.ok(Date.parse(reopened.due_at) - Date.now() > 23 * 60 * 60_000);
    await assert.rejects(db.reinstateOwnedPaidBooking(recoveryEvent.id, recovering.id, customer.id), /state_conflict/);
    const reopenedDetail = await db.readOwnedPaidBooking(recoveryEvent.id, recovering.id, customer.id);
    assert.equal((reopenedDetail?.attendees as unknown[]).length, 2);
    const additional = await db.createPaidBooking({
      ...command, eventId: recoveryEvent.id, key: "extra-attendee",
      pricingVersion: Number(recoverySettings.version), attendees: [{ ...firstGuest, firstName: "Extra" }],
    });
    assert.notEqual(additional.id, recovering.id);
    assert.equal((await db.listOwnedPaidBookings(customer.id, 20, 0))
      .filter(row => row.event_id === recoveryEvent.id).length, 2);

    const messengerEvent = await db.createEvent({ name: "Messenger workshop", organizer_id: "org_default" });
    await db.updateEvent(messengerEvent.id, { status: "active" });
    await db.savePaidSettings(messengerEvent.id, settings);
    await db.createPaidMessengerLinkToken(messengerEvent.id, customer.id, "messenger-fixture");
    assert.equal(await db.exchangePaidMessengerLinkToken(messengerEvent.id, "page", "sender", "messenger-fixture"), true);
    const draftInput = {
      eventId: messengerEvent.id, pageId: "page", senderId: "sender", messageKey: "message-1", attendees: command.attendees,
    };
    const quote = await db.createPaidMessengerDraft(draftInput);
    assert.equal(quote.totalMinor, 50000);
    assert.deepEqual(await second.createPaidMessengerDraft(draftInput), quote);
    assert.equal(fixture.prepare("SELECT COUNT(*) FROM paid_bookings WHERE event_id=?").pluck().get(messengerEvent.id), 0);
    const confirm = { ...draftInput, draftId: quote.id, receiver: command.receiver, language: "th" as const, inboundMs: Date.now() };
    await assert.rejects(db.confirmPaidMessengerDraft({ ...confirm, senderId: "other" }), /messenger_link_required/);
    const messengerBooking = await db.confirmPaidMessengerDraft(confirm);
    assert.deepEqual(await second.confirmPaidMessengerDraft(confirm), messengerBooking);
    assert.equal(fixture.prepare("SELECT COUNT(*) FROM paid_bookings WHERE event_id=?").pluck().get(messengerEvent.id), 1);
    await db.reviewPaidProof({
      ...manualReview, eventId: messengerEvent.id, bookingId: messengerBooking.id,
      observed: { ...manualReview.observed, transferMs: Date.now(), reference: "messenger-bank-ref" },
    });
    const messengerDeliveries = await db.listNotificationDeliveries({ related_type: "paid_booking", related_id: messengerBooking.id });
    assert.deepEqual(messengerDeliveries.map(({ kind }) => kind).sort(), ["paid_booking.confirmed", "paid_booking.messenger_confirmed"]);
    const delivery = messengerDeliveries.find(({ channel }) => channel === "facebook");
    assert.equal(JSON.parse(delivery!.payload_json).language, "th");
    const seminar = await db.createEvent({ name: "Residential seminar", organizer_id: "org_default" });
    await db.updateEvent(seminar.id, { status: "active" });
    await db.savePaidSettings(seminar.id, {
      ...settings, fields: [
        { key: "arrival", scope: "booking", required: true },
        { key: "accommodation", scope: "attendee", required: true },
      ],
    });
    const seminarCommand = { ...command, eventId: seminar.id };
    await assert.rejects(db.createPaidBooking(seminarCommand), /invalid_seminar_answers/);
    const withAnswers = {
      ...seminarCommand, answers: { arrival: "2026-11-18" },
      attendees: command.attendees.map((attendee) => ({ ...attendee, answers: { accommodation: "no" } })),
    };
    await assert.rejects(db.createPaidBooking({ ...withAnswers, answers: { arrival: "2026-02-31" } }), /invalid_seminar_answers/);
    await assert.rejects(db.createPaidBooking({ ...withAnswers, answers: { arrival: "2026-11-18", food: "extra" } }), /invalid_seminar_answers/);
    const seminarBooking = await db.createPaidBooking(withAnswers);
    assert.deepEqual(await second.createPaidBooking(withAnswers), seminarBooking);
    const stored = fixture.prepare("SELECT contact_json FROM paid_bookings WHERE id=?").pluck().get(seminarBooking.id);
    assert.deepEqual(JSON.parse(String(stored)).answers, [{ key: "arrival", label: "Arrival date", value: "2026-11-18" }]);
    // Accommodation discounts are configured per category and calculated per attendee.
    // The server, not the browser, sets the final prices in booking and invoice.
    const discountEvent = await db.createEvent({ name: "Accommodation pricing", organizer_id: "org_default" });
    await db.updateEvent(discountEvent.id, { status: "active" });
    const discountCategories = [
      { id: "adult", label: "Adult", unitMinor: 340000, accommodationDiscountMinor: 80000, quota: null },
      { id: "child", label: "Child", unitMinor: 170000, accommodationDiscountMinor: 40000, quota: null },
    ];
    await assert.rejects(db.savePaidSettings(discountEvent.id, {
      ...settings, categories: discountCategories,
      fields: [{ key: "accommodation", scope: "booking", required: true }],
    }), /invalid_pricing_config/);
    await assert.rejects(db.savePaidSettings(discountEvent.id, {
      ...settings, categories: [{ ...discountCategories[0], accommodationDiscountMinor: 400000 }],
      fields: [{ key: "accommodation", scope: "attendee", required: true }],
    }), /invalid_accommodation_discount/);
    const discountSettings = await db.savePaidSettings(discountEvent.id, {
      ...settings, capacity: 6, categories: discountCategories,
      fields: [{ key: "accommodation", scope: "attendee", required: true }],
    });
    assert.equal((discountSettings.categories as unknown[]).length, 2);
    assert.equal((discountSettings.categories as { id: string; accommodation_discount_minor: number }[])
      .find((category) => category.id === "adult")?.accommodation_discount_minor, 80000);
    const discountCatalog = await db.readPaidCatalog(discountEvent.id);
    assert.equal(discountCatalog?.categories.find((category) => category.id === "child")?.accommodation_discount_minor, 40000);
    const priceInput = {
      ...command, eventId: discountEvent.id, key: "discount-booking",
      attendees: [
        { categoryId: "adult", firstName: "Adult", lastName: "Without", answers: { accommodation: "no" } },
        { categoryId: "child", firstName: "Child", lastName: "With", answers: { accommodation: "yes" } },
      ],
    };
    const discounted = await db.createPaidBooking(priceInput);
    assert.equal(discounted.totalMinor, 260000 + 170000);
    const priceDetails = await db.readOwnedPaidBooking(discountEvent.id, discounted.id, customer.id);
    assert.deepEqual((priceDetails?.attendees as { unit_minor: number }[]).map((a) => a.unit_minor),
      [260000, 170000]);
    await assert.rejects(db.createPaidBooking({
      ...priceInput, key: "missing-choice",
      attendees: priceInput.attendees.map((attendee) => ({ ...attendee, lastName: "Missing Choice", answers: {} })),
    }), /invalid_seminar_answers/);

    const defaultsEvent = await db.createEvent({name:"Seminar selection defaults",organizer_id:"org_default"});
    await db.updateEvent(defaultsEvent.id,{status:"active"});
    await db.savePaidSettings(defaultsEvent.id,{
      ...settings,capacity:10,categories:[{id:"adult",label:"Adult",unitMinor:340000,
        accommodationDiscountMinor:80000,quota:null}],
      fields:[
        {key:"accommodation",scope:"attendee",required:true,defaultValue:"yes"},
        {key:"food",scope:"attendee",required:true,options:["Vegetarian","Non-vegetarian"],
          defaultValue:"Vegetarian"},
      ],
    });
    const defaultsCatalog=await db.readPaidCatalog(defaultsEvent.id);
    assert.deepEqual(defaultsCatalog?.fields,[
      {key:"accommodation",scope:"attendee",required:true,defaultValue:"yes"},
      {key:"food",scope:"attendee",required:true,defaultValue:"Vegetarian",
        options:["Vegetarian","Non-vegetarian"]},
    ]);
    assert.deepEqual((await db.readPaidSettings(defaultsEvent.id))?.fields,defaultsCatalog?.fields);
    const defaultsCommand={...command,eventId:defaultsEvent.id,key:"selected-defaults",
      attendees:[{categoryId:"adult",firstName:"Default",lastName:"Choice",
        answers:{accommodation:"yes",food:"Vegetarian"}}]};
    const defaultBooking=await db.createPaidBooking(defaultsCommand);
    assert.equal(defaultBooking.totalMinor,340000);
    const seminarRoster=await db.listPaidAttendeeRoster(defaultsEvent.id,"org_default");
    assert.equal(seminarRoster.length,1);
    assert.deepEqual(seminarRoster[0].answers,{accommodation:"yes",food:"Vegetarian"});
    const personId=String(seminarRoster[0].attendee_id);
    const editBase={eventId:defaultsEvent.id,bookingId:defaultBooking.id,organizationId:"org_default",actorId:"staff",reason:"Test field edit",attendeeId:personId,answerKey:"food" as const};
    const changed=await db.managePaidBooking({...editBase,key:"edit-food",version:defaultBooking.version,action:"edit_registration_answer",answerValue:"Non-vegetarian"});
    assert.equal(((await db.listPaidAttendeeRoster(defaultsEvent.id,"org_default"))[0].answers as Record<string,string>).food,"Non-vegetarian");
    const locked=await db.managePaidBooking({...editBase,key:"lock-food",version:changed.version,action:"set_registration_field_lock",fieldLocked:true});
    await assert.rejects(db.managePaidBooking({...editBase,key:"blocked-edit",version:locked.version,action:"edit_registration_answer",answerValue:"Vegetarian"}),/registration_field_locked/);
    await assert.rejects(db.readOwnedPaidBooking(defaultsEvent.id,defaultBooking.id,customer.id,{key:"food",attendeeId:personId,value:"Vegetarian"}),/registration_field_locked/);
    const unlocked=await db.managePaidBooking({...editBase,key:"unlock-food",version:locked.version,action:"set_registration_field_lock",fieldLocked:false});
    await db.managePaidBooking({...editBase,key:"restore-food",version:unlocked.version,action:"edit_registration_answer",answerValue:"Vegetarian"});
    assert.equal((await db.readOwnedPaidBooking(defaultsEvent.id,defaultBooking.id,customer.id))?.total_minor,340000);

    const noHotel=await db.createPaidBooking({...defaultsCommand,key:"declines-room",
      attendees:[{...defaultsCommand.attendees[0],firstName:"No Hotel",
        answers:{accommodation:"no",food:"Non-vegetarian"}}]});
    assert.equal(noHotel.totalMinor,260000);
    await assert.rejects(db.createPaidBooking({...defaultsCommand,key:"invalid-food",
      attendees:[{...defaultsCommand.attendees[0],firstName:"Invalid Food",answers:{accommodation:"yes",food:"Other"}}]}),
      /invalid_seminar_answers/);

    const couponEvent = await db.createEvent({ name: "Coupon test", organizer_id: "org_default" });
    await db.updateEvent(couponEvent.id, { status: "active" });
    await db.upsertSettings({ reg_unique_name: "0" }, couponEvent.id);
    await db.savePaidSettings(couponEvent.id, {
      ...settings, capacity: 12, categories: [{id:"adult",label:"Adult",unitMinor:340000,quota:null}],
      paymentMode:"external_manual",
    });
    const couponRules = [
      {code:"SPECIAL20",kind:"percent" as const,value_minor:2000,max_uses:2,per_customer_limit:2,
       starts_ms:null,ends_ms:null,enabled:true},
      {code:"THB100",kind:"fixed" as const,value_minor:10000,max_uses:null,per_customer_limit:null,
       starts_ms:null,ends_ms:null,enabled:true},
      {code:"FREE100",kind:"free" as const,value_minor:0,max_uses:1,per_customer_limit:1,
       starts_ms:null,ends_ms:null,enabled:true},
    ];
    for (const rule of couponRules) await db.savePaidCoupon(couponEvent.id,rule);
    await db.savePaidCoupon(couponEvent.id,{...couponRules[0],code:"UNUSED"});
    assert.equal(await db.deletePaidCoupon(couponEvent.id,"unused"),true);
    assert.equal(await db.deletePaidCoupon(couponEvent.id,"unused"),false);
    await db.savePaidCoupon(couponEvent.id,{...couponRules[0],max_uses:2});
    assert.equal((await db.listPaidCoupons(couponEvent.id)).length,3);
    const couponQuote=await db.quotePaidCoupon(couponEvent.id,customer.id,"special20",340000);
    assert.equal(couponQuote.discount_minor,68000);
    assert.equal(couponQuote.total_minor,272000);
    const couponInput = {...command,eventId:couponEvent.id,receiver:undefined,
      attendees:[{categoryId:"adult",firstName:"Coupon",lastName:"Guest"}]};
    const twenty=await db.createPaidBooking({...couponInput,key:"coupon-20",couponCode:"SPECIAL20"});
    assert.equal(twenty.totalMinor,272000);
    assert.equal(twenty.discountMinor,68000);
    await assert.rejects(db.deletePaidCoupon(couponEvent.id,"SPECIAL20"),/coupon_has_history/);
    assert.equal(((await db.readOwnedPaidBooking(couponEvent.id,twenty.id,customer.id))?.coupon as { code: string } | undefined)?.code,"SPECIAL20");
    assert.deepEqual(await db.createPaidBooking({...couponInput,key:"coupon-20",couponCode:"SPECIAL20"}),twenty);
    const fixed=await db.createPaidBooking({...couponInput,key:"coupon-fixed",couponCode:"THB100"});
    assert.equal(fixed.totalMinor,330000);
    const free=await db.createPaidBooking({...couponInput,key:"coupon-free",couponCode:"FREE100"});
    assert.equal(free.totalMinor,0);
    assert.equal(free.state,"confirmed");
    const zeroBooking=fixture.prepare("SELECT total_minor,payment_state FROM paid_bookings WHERE id=?")
      .get(free.id) as {total_minor:number;payment_state:string};
    assert.deepEqual(zeroBooking,{total_minor:0,payment_state:"verified"});
    assert.equal(fixture.prepare("SELECT COUNT(*) FROM paid_credentials WHERE booking_id=?").pluck().get(free.id),1);
    assert.ok((await db.listNotificationDeliveries({related_type:"paid_booking",related_id:free.id}))
      .some(entry=>entry.kind==="paid_booking.confirmed"));
    await assert.rejects(db.createPaidBooking({...couponInput,key:"coupon-free-again",couponCode:"FREE100"}),
      /coupon_exhausted/);
    await db.createPaidBooking({...couponInput,key:"coupon-20-second",couponCode:"SPECIAL20"});
    await assert.rejects(db.createPaidBooking({...couponInput,key:"coupon-20-third",couponCode:"SPECIAL20"}),
      /coupon_exhausted/);
    fixture.prepare("UPDATE paid_bookings SET state='expired',created_ms=1,due_ms=2 WHERE id=?").run(twenty.id);
    const released=await db.createPaidBooking({...couponInput,key:"coupon-20-released",couponCode:"SPECIAL20"});
    assert.equal(released.totalMinor,272000);
    assert.equal((await db.listPaidCoupons(couponEvent.id)).find(c=>c.code==="SPECIAL20")?.uses,2);
    await assert.rejects(db.reinstateOwnedPaidBooking(couponEvent.id,twenty.id,customer.id),
      /coupon_exhausted/);
    assert.deepEqual(fixture.prepare("SELECT action FROM paid_audit_events WHERE booking_id=? ORDER BY occurred_ms").all(receipt.id), [
      { action: "create" }, { action: "expire" },
    ]);
  } finally {
    fixture.close();
    await second.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("carpool maps booking answers by attendee and excludes cancellations", async () => {
  const db = new SqliteAppDatabase(":memory:");
  try {
    await db.initialize();
    const organizationId = "org_default";
    const event = await db.createEvent({ name: "Carpool workshop", organizer_id: organizationId });
    await db.updateEvent(event.id, { status: "active" });
    const customer = await db.createCustomerAccount({
      email: "carpool@example.com", normalized_email: "carpool@example.com", password_hash: "fixture",
      first_name: "Buyer", last_name: "Guest", phone: "", normalized_phone: "",
      accepted_terms_at: new Date(), accepted_privacy_at: new Date(),
    });
    await db.savePaidSettings(event.id, {
      organizationId, version: 0, capacity: 8, holdMinutes: 30, cutoffMs: null, published: true,
      categories: [{ id: "adult", label: "Adult", unitMinor: 25000, quota: null }],
      fields: [{ key: "transport", scope: "booking", required: true }],
    });
    async function book(key: string, transport: string, names: string[]) {
      return db.createPaidBooking({
        eventId: event.id, customerId: customer.id, key, pricingVersion: 1,
        contact: { name: "Buyer" }, receiver: { id: "0812345678", name: "Organizer", profileVersion: 1 },
        answers: { transport },
        attendees: names.map(firstName => ({ categoryId: "adult", firstName, lastName: "Guest" })),
      });
    }
    await book("carpool-driver", "มีรถและรับผู้โดยสาร", ["Driver", "Companion"]);
    const passengerBooking = await book("carpool-passenger", "ต้องการติดรถ", ["Passenger"]);
    await book("carpool-independent", "Self-arranged", ["Independent"]);
    const plan = (await db.paidCarpoolPlan(event.id, organizationId))!;
    assert.deepEqual(Object.fromEntries(plan.attendees.map(attendee => [attendee.name, attendee.defaultRole])), {
      "Driver Guest": "driver",
      "Companion Guest": "unspecified",
      "Passenger Guest": "passenger",
      "Independent Guest": "independent",
    });
    assert.ok(plan.attendees.every(attendee => attendee.bookingState === "awaiting_payment"));
    const driver = plan.attendees.find(attendee => attendee.defaultRole === "driver")!;
    const passenger = plan.attendees.find(attendee => attendee.defaultRole === "passenger")!;
    const car = { driverId: driver.id, seats: 1, pickup: "Station", passengers: [passenger.id] };
    const van = {driverId:"shared-van1",kind:"shared" as const,label:"Van 1",driverName:"External driver",seats:10,pickup:"Lobby",departure:"07:00",note:"Meet early",passengers:[]};
    await db.paidCarpoolPlan(event.id, organizationId, { version: 0, cars: [car,van], roles: {} });
    const withVan=(await db.paidCarpoolPlan(event.id,organizationId))!;
    assert.deepEqual(withVan.cars.find(c=>c.kind==="shared"),van);
    await db.paidCarpoolPlan(event.id,organizationId,{version:withVan.version,cars:[{...car,passengers:[]},{...van,passengers:[passenger.id]}],roles:{}});
    await db.cancelOwnedPaidBooking(event.id, passengerBooking.id, customer.id);
    const afterCancel = (await db.paidCarpoolPlan(event.id, organizationId))!;
    assert.ok(!afterCancel.attendees.some(attendee => attendee.id === passenger.id));
    assert.deepEqual(afterCancel.cars, [{ ...car, passengers: [] },van]);
    await assert.rejects(db.paidCarpoolPlan(event.id, "another-org"), /event_not_found/);
  } finally {
    db.close();
  }
});

test("incorrect verified slip can be revoked and reused on its rightful booking", async()=>{
 process.env.PAID_PROOF_ENCRYPTION_KEY="01".repeat(32);
 const db=new SqliteAppDatabase(":memory:");
 try{
  await db.initialize();
  const organizationId="org_default";
  const event=await db.createEvent({name:"Slip correction",organizer_id:organizationId});
  await db.updateEvent(event.id,{status:"active"});
  const customer=await db.createCustomerAccount({email:"correction@example.com",normalized_email:"correction@example.com",password_hash:"fixture",first_name:"Buyer",last_name:"Guest",phone:"",normalized_phone:"",accepted_terms_at:new Date(),accepted_privacy_at:new Date()});
  await db.savePaidSettings(event.id,{organizationId,version:0,capacity:4,holdMinutes:30,cutoffMs:null,published:true,categories:[{id:"adult",label:"Adult",unitMinor:25000,quota:null}]});
  const base={eventId:event.id,customerId:customer.id,pricingVersion:1,contact:{name:"Buyer"},receiver:{id:"0812345678",name:"Organizer",profileVersion:1}};
  const a=await db.createPaidBooking({...base,key:"wrong",attendees:[{categoryId:"adult",firstName:"Wrong",lastName:"Guest"}]});
  const b=await db.createPaidBooking({...base,key:"right",attendees:[{categoryId:"adult",firstName:"Right",lastName:"Guest"}]});
  const proof={eventId:event.id,customerId:customer.id,method:"promptpay" as const,claimedMinor:25000,claimedTransferMs:Date.now(),reference:"TRANSFER-ONE",mime:"image/png" as const,content:Buffer.from("rightful slip fixture")};
  const slip=await db.submitPaidProof({...proof,bookingId:a.id,key:"wrong-slip",version:1});
  const approve={eventId:event.id,organizationId,reviewerId:"staff",decision:"approve" as const,reason:"Bank verified"};
  const confirmed=await db.reviewPaidProof({...approve,bookingId:a.id,attemptId:slip.attempt_id,version:slip.version,key:"approve-wrong"});
  const detail=await db.readOwnedPaidBooking(event.id,a.id,customer.id);
  const attendee=(detail!.attendees as {id:string}[])[0];
  const oldQr=await db.readPaidCredential(event.id,a.id,attendee.id,customer.id);
  assert.ok(oldQr);
  const correctionBase={eventId:event.id,bookingId:a.id,organizationId,actorId:"staff",reason:"Verified actual transfer"};
  const price=await db.managePaidBooking({...correctionBase,key:"raise-price",version:confirmed.version,action:"correct_price",attendeeId:attendee.id,unitMinor:31000});
  const corrected=await db.managePaidBooking({...correctionBase,key:"fix-amount",version:price.version,action:"correct_slip_amount",attemptId:slip.attempt_id,slipAmountMinor:31000});
  assert.equal(corrected.balance_due_minor,0);
  assert.equal(await db.readPaidCredential(event.id,a.id,attendee.id,customer.id),oldQr);
  assert.deepEqual((await db.readPaidProof(event.id,a.id,slip.attempt_id,organizationId))?.content,proof.content);
  const revoke={eventId:event.id,bookingId:a.id,organizationId,actorId:"staff",key:"revoke",version:corrected.version,action:"revoke_slip" as const,reason:"Wrong booking",holdMinutes:1440,attemptId:slip.attempt_id};
  const flagged=await db.managePaidBooking({...revoke,action:"flag_price",key:"flag-before-revoke",attendeeId:attendee.id});
  revoke.version=flagged.version;
  const result=await db.managePaidBooking(revoke);
  assert.equal(result.status,"awaiting_payment");
  assert.equal(result.payment_status,"unpaid");
  assert.deepEqual(await db.managePaidBooking(revoke),result);
  assert.equal(await db.readPaidCredential(event.id,a.id,attendee.id,customer.id),undefined);
  assert.equal(await db.readPaidProof(event.id,a.id,slip.attempt_id,organizationId),undefined);
  const right=await db.submitPaidProof({...proof,bookingId:b.id,key:"right-slip",version:1});
  assert.equal((await db.reviewPaidProof({...approve,bookingId:b.id,attemptId:right.attempt_id,version:right.version,key:"approve-right"})).status,"confirmed");
  const roster=(await db.listPaidAttendeeRoster(event.id,organizationId));
  assert.equal(roster.find(row=>row.attendee_id===attendee.id)?.payment_warning,true);
  const cleared=await db.managePaidBooking({...revoke,action:"clear_price_flag",key:"clear-after-revoke",version:result.version,attendeeId:attendee.id});
  const replacement=await db.submitPaidProof({...proof,bookingId:a.id,key:"replacement-slip",version:cleared.version,reference:"TRANSFER-TWO",content:Buffer.from("replacement fixture")});
  assert.equal((await db.reviewPaidProof({...approve,bookingId:a.id,attemptId:replacement.attempt_id,version:replacement.version,key:"approve-replacement"})).status,"confirmed");
  const newQr=await db.readPaidCredential(event.id,a.id,attendee.id,customer.id);
  assert.ok(newQr && newQr!==oldQr);
 }finally{db.close();}
});

test("confirmed room downgrade preserves evidence and settles surplus independently",async()=>{
 process.env.PAID_PROOF_ENCRYPTION_KEY="01".repeat(32);
 const db=new SqliteAppDatabase(":memory:");
 try{
  await db.initialize();
  const organizationId="org_default";
  const event=await db.createEvent({name:"Room adjustment",organizer_id:organizationId});
  await db.updateEvent(event.id,{status:"active"});
  const customer=await db.createCustomerAccount({email:"room-change@example.com",normalized_email:"room-change@example.com",password_hash:"fixture",first_name:"Buyer",last_name:"Guest",phone:"",normalized_phone:"",accepted_terms_at:new Date(),accepted_privacy_at:new Date()});
  await db.savePaidSettings(event.id,{organizationId,version:0,capacity:4,holdMinutes:30,cutoffMs:null,published:true,categories:[{id:"adult",label:"Adult",unitMinor:340000,quota:null}],fields:[{key:"room_preference",scope:"attendee",required:true,options:["Single","Twin"],surcharge:{option:"Single",minor:130000}}]});
  const booking=await db.createPaidBooking({eventId:event.id,customerId:customer.id,pricingVersion:1,key:"room-booking",contact:{name:"Buyer"},receiver:{id:"0812345678",name:"Organizer",profileVersion:1},attendees:[{categoryId:"adult",firstName:"Room",lastName:"Guest",answers:{room_preference:"Single"}}]});
  assert.equal(booking.totalMinor,470000);
  const proof=Buffer.from("room adjustment fixture");
  const slip=await db.submitPaidProof({eventId:event.id,customerId:customer.id,bookingId:booking.id,key:"room-slip",version:1,method:"promptpay",claimedMinor:470000,claimedTransferMs:Date.now(),reference:"ROOM-TRANSFER",mime:"image/png",content:proof});
  const confirmed=await db.reviewPaidProof({eventId:event.id,organizationId,bookingId:booking.id,attemptId:slip.attempt_id,version:slip.version,key:"room-confirm",reviewerId:"staff",decision:"approve",reason:"Verified"});
  const guest=(await db.paidRoomingPlan(event.id,organizationId))!.guests[0];
  assert.equal(guest.single,true);
  const qr=await db.readPaidCredential(event.id,booking.id,guest.id,customer.id);
  const base={eventId:event.id,organizationId,bookingId:booking.id,actorId:"staff",reason:"Room change"};
  const adjusted=await db.managePaidBooking({...base,key:"room-downgrade",version:confirmed.version,action:"adjust_room",attendeeId:guest.id,answerKey:"room_preference",answerValue:"Twin",unitMinor:340000});
  assert.equal(adjusted.total_minor,340000);
  assert.equal(adjusted.balance_due_minor,0);
  assert.equal((await db.paidRoomingPlan(event.id,organizationId))!.guests[0].single,false);
  assert.equal(await db.readPaidCredential(event.id,booking.id,guest.id,customer.id),qr);
  assert.deepEqual((await db.readPaidProof(event.id,booking.id,slip.attempt_id,organizationId))?.content,proof);
  const before=await db.readPaidEventSummary(event.id,organizationId);
  assert.equal(String(before?.refund_pending_minor),"130000");
  assert.equal(String(before?.gross_received_minor),"470000");
  assert.equal(String(before?.current_booking_minor),"340000");
  assert.equal(String(before?.additional_due_minor),"0");
  const settlement={...base,key:"van-payment",version:adjusted.version,action:"settle_surplus" as const,settlementKind:"external" as const,settlementMinor:130000,refundReference:"VAN-001"};
  const done=await db.managePaidBooking(settlement);
  assert.deepEqual(await db.managePaidBooking(settlement),done);
  await assert.rejects(db.managePaidBooking({...settlement,key:"extra",version:done.version,refundReference:"VAN-002"}),/amount_exceeds_surplus/);
  assert.equal(await db.readPaidCredential(event.id,booking.id,guest.id,customer.id),qr);
  const roster=await db.listPaidAttendeeRoster(event.id,organizationId,10000,true);
  assert.equal(Number(roster[0].verified_cash_minor),470000);
  assert.equal(Number(roster[0].external_allocated_minor),130000);
  assert.equal(Number(roster[0].balance_due_minor),0);
  const after=await db.readPaidEventSummary(event.id,organizationId);
  assert.equal(String(after?.refund_pending_minor),"0");
  assert.equal(String(after?.net_received_minor),"340000");
  const raised=await db.managePaidBooking({...base,key:"price-up",version:done.version,action:"correct_price",attendeeId:guest.id,unitMinor:470000});
  assert.equal(raised.balance_due_minor,130000);
  const due=await db.readPaidEventSummary(event.id,organizationId);
  assert.equal(String(due?.additional_due_minor),"130000");
  assert.equal(String(due?.new_booking_due_minor),"0");
  const lowered=await db.managePaidBooking({...base,key:"price-down",version:raised.version,action:"correct_price",attendeeId:guest.id,unitMinor:340000});
  assert.equal(lowered.balance_due_minor,0);

 }finally{await db.close();}
});
