import assert from "node:assert/strict";
import test from "node:test";

import { SqliteAppDatabase } from "./sqliteAdapter";

test("direct seats cannot issue two active tickets and rejected payment releases the seat", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Direct ticket test", organizer_id: "org_default" });
  const performance = await db.upsertDirectPerformance({
    event_id: event.id,
    code: "R1",
    title: "Round 1",
    starts_at: "2026-08-22T18:30:00+07:00",
  });
  const [seat] = await db.importDirectSeats(event.id, performance.id, [
    { zone: "VIP", row_label: "A", seat_label: "01", ticket_class: "Premium", face_value: 2500 },
  ]);
  assert.equal(seat.ticket_class, "Premium");

  const first = await db.createDirectTicket({
    event_id: event.id, performance_id: performance.id, seat_id: seat.id,
    ticket_class: "VIP", holder_name: "First guest", payment_required: true,
  });
  assert.ok(first.ticket);
  assert.equal(first.ticket?.status, "held");

  const duplicate = await db.createDirectTicket({
    event_id: event.id, performance_id: performance.id, seat_id: seat.id,
    ticket_class: "VIP", payment_required: false,
  });
  assert.equal(duplicate.error, "seat_unavailable");

  const rejected = await db.updateDirectTicketPayment(first.ticket!.id, { payment_status: "rejected" });
  assert.equal(rejected?.status, "voided");
  assert.equal((await db.listDirectSeats(event.id, performance.id))[0].status, "available");

  const replacement = await db.createDirectTicket({
    event_id: event.id, performance_id: performance.id, seat_id: seat.id,
    ticket_class: "VIP", payment_required: false,
  });
  assert.equal(replacement.ticket?.status, "issued");
  const checkedIn = await db.checkInDirectTicket(replacement.ticket!.id);
  assert.equal(checkedIn.ticket?.status, "checked_in");
  const reissued = await db.reissueDirectTicket(replacement.ticket!.id);
  assert.ok(reissued);
  assert.notEqual(reissued?.id, replacement.ticket?.id);
  assert.equal((await db.checkInDirectTicket(replacement.ticket!.id)).ticket?.status, "voided");
  assert.equal((await db.checkInDirectTicket(reissued!.id)).ticket?.status, "checked_in");
  assert.equal((await db.voidDirectTicket(reissued!.id))?.status, "voided");
  assert.equal((await db.listDirectSeats(event.id, performance.id))[0].status, "available");
});

test("payment proof waits for review and one bank reference cannot issue two tickets", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Payment review test", organizer_id: "org_default" });
  const performance = await db.upsertDirectPerformance({ event_id: event.id, code: "R1", title: "Round 1", starts_at: "2026-08-22T18:30:00+07:00" });
  const seats = await db.importDirectSeats(event.id, performance.id, [
    { zone: "VIP", row_label: "A", seat_label: "01", face_value: 2500 },
    { zone: "VIP", row_label: "A", seat_label: "02", face_value: 2500 },
  ]);
  const first = await db.createDirectTicket({ event_id: event.id, performance_id: performance.id, seat_id: seats[0].id, ticket_class: "VIP", payment_required: true, source: "public" });
  assert.ok(first.ticket);
  const proof = await db.submitDirectTicketPaymentProof(first.ticket!.id, { payment_proof_mime: "image/png", payment_proof_base64: "c2xpcA==" });
  assert.equal(proof?.payment_status, "proof_submitted");
  assert.equal(proof?.status, "held");
  const issued = await db.updateDirectTicketPayment(first.ticket!.id, { payment_status: "verified", payment_reference: "BANK-001" });
  assert.equal(issued?.status, "issued");

  const second = await db.createDirectTicket({ event_id: event.id, performance_id: performance.id, seat_id: seats[1].id, ticket_class: "VIP", payment_required: true });
  assert.ok(second.ticket);
  await assert.rejects(() => db.updateDirectTicketPayment(second.ticket!.id, { payment_status: "verified", payment_reference: "BANK-001" }), /unique/i);
});

test("expired direct-ticket holds release their seat", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Hold expiry test", organizer_id: "org_default" });
  const performance = await db.upsertDirectPerformance({ event_id: event.id, code: "R1", title: "Round 1", starts_at: "2026-08-22T18:30:00+07:00" });
  const [seat] = await db.importDirectSeats(event.id, performance.id, [{ zone: "VIP", row_label: "A", seat_label: "01" }]);
  const held = await db.createDirectTicket({ event_id: event.id, performance_id: performance.id, seat_id: seat.id, ticket_class: "VIP", payment_required: true });
  const sqlite = db as unknown as { db: { prepare: (sql: string) => { run: (...params: unknown[]) => unknown } } };
  sqlite.db.prepare("UPDATE direct_tickets SET hold_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(held.ticket!.id);
  assert.equal(await db.releaseExpiredDirectTicketHolds(event.id), 1);
  assert.equal((await db.getDirectTicketById(held.ticket!.id))?.payment_status, "expired");
  assert.equal((await db.listDirectSeats(event.id, performance.id))[0].status, "available");
});

test("resetting a performance removes its test tickets and seats", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Reset test", organizer_id: "org_default" });
  const performance = await db.upsertDirectPerformance({ event_id: event.id, code: "R1", title: "Round 1", starts_at: "2026-08-22T18:30:00+07:00" });
  const [seat] = await db.importDirectSeats(event.id, performance.id, [{ zone: "VIP", row_label: "A", seat_label: "01" }]);
  const ticket = await db.createDirectTicket({ event_id: event.id, performance_id: performance.id, seat_id: seat.id, ticket_class: "VIP", payment_required: false });
  assert.ok(ticket.ticket);
  assert.deepEqual(await db.resetDirectPerformance(event.id, performance.id), { tickets: 1, seats: 1 });
  assert.equal((await db.listDirectSeats(event.id, performance.id)).length, 0);
  assert.equal((await db.listDirectTickets(event.id)).length, 0);
  assert.equal((await db.listDirectPerformances(event.id)).length, 1);
});

test("editing updates a performance and deleting protects performances with tickets", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Edit and delete test", organizer_id: "org_default" });
  const performance = await db.upsertDirectPerformance({ event_id: event.id, code: "R1", title: "Round 1", starts_at: "2026-08-22T18:30:00+07:00" });
  const updated = await db.upsertDirectPerformance({ event_id: event.id, code: "R1", title: "Round 1 updated", starts_at: "2026-08-22T19:30:00+07:00" });
  assert.equal(updated.id, performance.id);
  assert.equal(updated.title, "Round 1 updated");
  assert.equal((await db.listDirectPerformances(event.id)).length, 1);

  const [seat] = await db.importDirectSeats(event.id, performance.id, [{ zone: "VIP", row_label: "A", seat_label: "01" }]);
  assert.deepEqual(await db.deleteDirectPerformance(event.id, performance.id), { status: "deleted", tickets: 0, seats: 1 });
  assert.equal((await db.listDirectPerformances(event.id)).length, 0);
  assert.equal((await db.listDirectSeats(event.id, performance.id)).length, 0);

  const protectedPerformance = await db.upsertDirectPerformance({ event_id: event.id, code: "R2", title: "Round 2", starts_at: "2026-08-23T18:30:00+07:00" });
  const [protectedSeat] = await db.importDirectSeats(event.id, protectedPerformance.id, [{ zone: "VIP", row_label: "A", seat_label: "01" }]);
  const ticket = await db.createDirectTicket({ event_id: event.id, performance_id: protectedPerformance.id, seat_id: protectedSeat.id, ticket_class: "VIP", payment_required: false });
  assert.ok(ticket.ticket);
  assert.deepEqual(await db.deleteDirectPerformance(event.id, protectedPerformance.id), { status: "blocked", tickets: 1, seats: 1 });
  assert.equal((await db.listDirectPerformances(event.id)).length, 1);
  assert.equal((await db.listDirectSeats(event.id, protectedPerformance.id)).length, 1);
});

test("seat-map statuses keep non-allocation seats unavailable and protect active tickets during rescan", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Seat map status test", organizer_id: "org_default" });
  const performance = await db.upsertDirectPerformance({ event_id: event.id, code: "R1", title: "Round 1", starts_at: "2026-08-22T18:30:00+07:00" });
  const seats = await db.importDirectSeats(event.id, performance.id, [
    { zone: "ZONE 1", row_label: "A", seat_label: "1", face_value: 100, allocation_status: "allocated", source_status: "blocked" },
    { zone: "ZONE 1", row_label: "A", seat_label: "2", face_value: 800, allocation_status: "not_allocated", source_status: "available" },
    { zone: "ZONE 1", row_label: "A", seat_label: "3", face_value: 100, allocation_status: "allocated", source_status: "blocked" },
  ]);
  const ticket = await db.createDirectTicket({ event_id: event.id, performance_id: performance.id, seat_id: seats[0].id, ticket_class: "VIP", payment_required: false });
  assert.ok(ticket.ticket);

  await db.importDirectSeats(event.id, performance.id, [
    { zone: "ZONE 1", row_label: "A", seat_label: "1", face_value: 999, allocation_status: "not_allocated", source_status: "available" },
  ], { replaceMissing: true });
  const refreshed = await db.listDirectSeats(event.id, performance.id);
  const active = refreshed.find((seat) => seat.seat_label === "1");
  const removed = refreshed.filter((seat) => ["2", "3"].includes(seat.seat_label));
  assert.equal(active?.status, "issued");
  assert.equal(active?.allocation_status, "allocated");
  assert.equal(active?.face_value, 100);
  assert.equal(removed.length, 2);
  assert.ok(removed.every((seat) => seat.status === "voided" && seat.allocation_status === "not_allocated"));
});

test("seat rescans preserve an existing spatial layout unless replacement is explicit", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Spatial layout test", organizer_id: "org_default" });
  const performance = await db.upsertDirectPerformance({ event_id: event.id, code: "R1", title: "Round 1", starts_at: "2026-08-22T18:30:00+07:00" });
  await db.importDirectSeats(event.id, performance.id, [
    { zone: "ZONE 3", row_label: "J", seat_label: "23", x: 10, y: 20 },
    { zone: "ZONE 3", row_label: "J", seat_label: "24" },
  ]);

  await db.importDirectSeats(event.id, performance.id, [
    { zone: "ZONE 3", row_label: "J", seat_label: "23", x: 99, y: 98 },
    { zone: "ZONE 3", row_label: "J", seat_label: "24", x: 30, y: 40 },
  ]);
  let refreshed = await db.listDirectSeats(event.id, performance.id);
  assert.equal(refreshed.find((seat) => seat.seat_label === "23")?.x, 10);
  assert.equal(refreshed.find((seat) => seat.seat_label === "23")?.y, 20);
  assert.equal(refreshed.find((seat) => seat.seat_label === "24")?.x, 30);
  assert.equal(refreshed.find((seat) => seat.seat_label === "24")?.y, 40);

  await db.importDirectSeats(event.id, performance.id, [
    { zone: "ZONE 3", row_label: "J", seat_label: "23", x: 99, y: 98 },
  ], { replaceLayout: true });
  refreshed = await db.listDirectSeats(event.id, performance.id);
  assert.equal(refreshed.find((seat) => seat.seat_label === "23")?.x, 99);
  assert.equal(refreshed.find((seat) => seat.seat_label === "23")?.y, 98);
});
