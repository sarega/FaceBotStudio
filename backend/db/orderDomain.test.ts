import assert from "node:assert/strict";
import test from "node:test";

import { hashPassword } from "../auth";
import { SqliteAppDatabase } from "./sqliteAdapter";

test("customer order holds multiple seats, records proof, and issues tickets after verification", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Customer checkout test", organizer_id: "org_default" });
  const account = await db.createCustomerAccount({
    email: "buyer@example.com",
    normalized_email: "buyer@example.com",
    password_hash: hashPassword("correct horse battery staple"),
    first_name: "Buyer",
    last_name: "Example",
    phone: "0812345678",
    normalized_phone: "0812345678",
    accepted_terms_at: new Date(),
    accepted_privacy_at: new Date(),
  });
  const performance = await db.upsertDirectPerformance({ event_id: event.id, code: "MAIN", title: "Main show", starts_at: "2026-08-22T18:30:00+07:00" });
  const seats = await db.importDirectSeats(event.id, performance.id, [
    { zone: "VIP", row_label: "A", seat_label: "01", face_value: 100 },
    { zone: "VIP", row_label: "A", seat_label: "02", face_value: 200 },
  ]);

  const first = await db.createDirectOrder({
    event_id: event.id,
    performance_id: performance.id,
    seat_ids: seats.map((seat) => seat.id),
    customer_account_id: account.id,
    buyer_name: "Buyer Example",
    phone: "0812345678",
    email: "buyer@example.com",
    subtotal_amount: 300,
    platform_fee_amount: 9,
    payment_fee_amount: 2.5,
    tax_amount: 21.81,
    total_amount: 333.31,
    tax_snapshot_json: JSON.stringify({ rate_percent: 7 }),
    hold_minutes: 15,
    source: "public",
  });
  const firstOrder = "order" in first ? first.order : undefined;
  assert.ok(firstOrder);
  assert.equal(firstOrder.status, "pending_payment");
  assert.equal(firstOrder.tickets.length, 2);
  assert.ok(firstOrder.tickets.every((ticket) => ticket.status === "held"));
  assert.ok(firstOrder.hold_expires_at);

  const duplicate = await db.createDirectOrder({
    event_id: event.id,
    performance_id: performance.id,
    seat_ids: [seats[0].id],
    buyer_name: "Second Buyer",
    phone: "0811111111",
    email: "second@example.com",
    subtotal_amount: 100,
    total_amount: 100,
  });
  assert.equal(duplicate.error, "seat_unavailable");

  const withProof = await db.submitDirectOrderPaymentProof(firstOrder.id, {
    payment_proof_mime: "image/png",
    payment_proof_base64: "c2xpcA==",
    payment_reference: "PP-001",
  });
  assert.equal(withProof?.status, "payment_submitted");
  assert.equal(withProof?.payment_proof_mime, "image/png");

  const paid = await db.updateDirectOrderPayment(firstOrder.id, {
    payment_status: "verified",
    payment_reference: "PP-001",
    verified_by_user_id: "usr_admin",
  });
  assert.equal(paid?.status, "paid");
  assert.ok(paid?.tickets.every((ticket) => ticket.status === "issued" && ticket.payment_status === "verified"));
  assert.ok((await db.listDirectSeats(event.id, performance.id)).every((seat) => seat.status === "issued"));

  assert.equal(await db.unlinkDirectOrderFromCustomer(firstOrder.id, account.id), true);
  assert.equal((await db.getDirectOrderById(firstOrder.id))?.customer_account_id, null);
  assert.ok((await db.getDirectOrderById(firstOrder.id))?.tickets.every((ticket) => ticket.customer_account_id === null));
  assert.deepEqual(await db.resetDirectPerformance(event.id, performance.id), { tickets: 0, seats: 0, orders: 1, blocked: true });
});
