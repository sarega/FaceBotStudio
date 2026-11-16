import sharp from "sharp";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { hashSessionToken } from "../auth";
import { SqliteAppDatabase } from "./sqliteAdapter";

test("paid booking HTTP covers group capacity, proof review and admission", { timeout: 25_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "facebot-paid-http-"));
  const database = join(directory, "test.db");
  const db = new SqliteAppDatabase(database);
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown> | undefined;
  try {
    await db.initialize();
    const event = await db.createEvent({ name: "HTTP Paid Workshop", organizer_id: "org_default" });
    await db.updateEvent(event.id, { status: "active" });
    await db.upsertSettings({ event_public_page_enabled: "1", event_public_slug: "http-paid-workshop", event_catalog_visible: "1", event_public_ticketing_mode: "external", event_public_external_ticket_url: "https://example.com/legacy", event_date: "", event_end_date: "" }, event.id);
    const [organizer] = await db.listOrganizerProfiles("org_default");
    await db.updateOrganizerFinancialProfileByOrganizerId(organizer.id, "org_default", {
      payment_status: "active", promptpay_id: "0812345678", promptpay_receiver_name: "Fixture Organizer",
    });
    await db.savePaidSettings(event.id, {
      organizationId: "org_default", version: 0, capacity: 2, holdMinutes: 15, cutoffMs: null, published: true,
      categories: [{ id: "adult", label: "Adult", unitMinor: 25000, quota: null }],
    });
    await db.upsertChannelAccount({
      platform: "facebook", external_id: "fixture-page", display_name: "Fixture Messenger page",
      organizer_id: "org_default", event_id: event.id, access_token: "fixture-page-token", is_active: true,
    });
    const reviewer = await db.createUser({
      username: "fixture-reviewer", display_name: "Fixture reviewer", password_hash: "fixture", role: "admin",
    });
    await db.createSession(reviewer.id, hashSessionToken("test-reviewer"), new Date(Date.now() + 3_600_000));
    const fixture = new Database(database);
    try {
      for (const token of ["test-owner", "test-other"]) {
        const email = `${token}@example.com`;
        const account = await db.createCustomerAccount({
          email, normalized_email: email, password_hash: "fixture", first_name: "Test", last_name: "Customer",
          phone: "", normalized_phone: "", accepted_terms_at: new Date(), accepted_privacy_at: new Date(),
        });
        fixture.prepare("UPDATE customer_accounts SET email_verified_at=CURRENT_TIMESTAMP,status='active' WHERE id=?").run(account.id);
        await db.createCustomerSession(account.id, hashSessionToken(token), new Date(Date.now() + 3_600_000));
      }
    } finally {
      fixture.close();
    }

    const socket = createServer().listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((done) => socket.close(() => done()));
    const origin = `http://127.0.0.1:${port}`;
    const server = fileURLToPath(new URL("../../server.ts", import.meta.url));
    child = spawn(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), server], {
      cwd: directory,
      env: {
        PATH: process.env.PATH, APP_RUNTIME: "web", NODE_ENV: "development", PORT: String(port),
        APP_URL: origin, DB_PATH: database, PUBLIC_UPLOADS_DIR: join(directory, "uploads"),
        CUSTOMER_APP_ENABLED: "1", PAID_REGISTRATION_PUBLIC_ENABLED: "1",
        FACEBOOK_APP_SECRET: "fixture-webhook-secret", PAID_PROOF_ENCRYPTION_KEY: "01".repeat(32),
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    exited = once(child, "exit");
    let ready = false;
    for (let attempt = 0; attempt < 60 && child.exitCode === null; attempt += 1) {
      const response = await fetch(`${origin}/api/health`).catch(() => undefined);
      if (response?.ok) { ready = true; break; }
      await delay(150);
    }
    assert.ok(ready, "local web server did not start");
    const prefix = `${origin}/api/public/events/http-paid-workshop`;
    assert.equal((await fetch(`${prefix}/paid-registration`)).status, 200);
    const publicCatalog = await (await fetch(`${origin}/api/public/events`)).json();
    const paidEntry = publicCatalog.events.find(({ slug }: { slug: string }) => slug === "http-paid-workshop");
    assert.equal(paidEntry.starting_price, 250);
    assert.equal(paidEntry.availability.external_ticket_url, "");
    assert.equal(paidEntry.availability.customer_checkout_enabled, false);
    const headers = (token: string) => ({
      Cookie: `fbs_customer_session=${token}; fbs_customer_csrf=fixture-csrf`, Origin: origin,
    });
    const body = JSON.stringify({
      pricing_version: 1, contact: { name: "Test Customer" },
      attendees: ["One", "Two"].map((name) => ({ category_id: "adult", first_name: name, last_name: "Guest" })),
    });
    const create = (key: string, csrf = "fixture-csrf") => fetch(`${prefix}/paid-bookings`, {
      method: "POST", body,
      headers: { ...headers("test-owner"), "Content-Type": "application/json", "Idempotency-Key": key, "x-csrf-token": csrf },
    });
    assert.equal((await create("group", "wrong")).status, 403);
    const placed = await create("group");
    assert.equal(placed.status, 201, await placed.clone().text());
    const booking = await placed.json();
    assert.equal(booking.total_due_minor, 50000);
    const listing = `${origin}/api/customer/paid-bookings?reference=${booking.reference}`;
    const ownList = await fetch(listing, { headers: headers("test-owner") });
    assert.equal(ownList.status, 200);
    assert.equal((await ownList.json()).bookings[0].id, booking.id);
    const otherList = await fetch(listing, { headers: headers("test-other") });
    assert.equal(otherList.status, 200);
    assert.deepEqual((await otherList.json()).bookings, []);
    assert.deepEqual(await (await create("group")).json(), booking);
    const overflow = await create("overflow");
    assert.equal(overflow.status, 409);
    assert.equal((await overflow.json()).error, "capacity_exhausted");
    const ownedPath = `${origin}/api/customer/paid-bookings/${event.id}/${booking.id}`;
    assert.equal((await fetch(ownedPath, { headers: headers("test-other") })).status, 404);
    const owned = await fetch(ownedPath, { headers: headers("test-owner") });
    assert.equal(owned.status, 200);
    const attendees = (await owned.json()).attendees;
    assert.equal(attendees.length, 2);
    const credentialPath = (attendeeId: string) => `${ownedPath}/attendees/${attendeeId}/credential`;
    assert.equal((await fetch(credentialPath(attendees[0].id), { headers: headers("test-owner") })).status, 404);
    const paymentQr = await fetch(`${ownedPath}/payment-qr`, { headers: headers("test-owner") });
    assert.equal(paymentQr.status, 200);
    assert.equal(paymentQr.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${ownedPath}/payment-qr`, { headers: headers("test-other") })).status, 404);
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const proof = (token: string, bytes: Buffer) => fetch(`${ownedPath}/proofs`, {
      method: "POST", body: Uint8Array.from(bytes),
      headers: {
        ...headers(token), "Content-Type": "application/octet-stream", "Idempotency-Key": "upload",
        "x-csrf-token": "fixture-csrf", "x-booking-version": "1", "x-claimed-minor": "50000",
        "x-claimed-transfer-at": new Date(0 + 1000).toISOString(), "x-payment-method": "promptpay",
        "x-proof-mime": "image/png",
      },
    });
    assert.equal((await proof("test-other", image)).status, 404);
    assert.equal((await proof("test-owner", Buffer.from("<svg/>"))).status, 415);
    const corrupt = Buffer.from(image);
    const idat = corrupt.indexOf("IDAT");
    corrupt[idat + 5] ^= 255;
    assert.equal((await proof("test-owner", corrupt)).status, 415);
    const accepted = await proof("test-owner", image);
    assert.equal(accepted.status, 202, await accepted.clone().text());
    const pending = await accepted.json();
    assert.equal(pending.status, "verification_pending");
    assert.deepEqual(await (await proof("test-owner", image)).json(), pending);
    const staffUrl = `${origin}/api/events/${event.id}/paid-registration/bookings/${booking.id}/proofs/${pending.attempt_id}`;
    assert.equal((await fetch(staffUrl, { headers: headers("test-owner") })).status, 401);
    const staffHeaders = {
      Cookie: "fbs_session=test-reviewer; fbs_csrf=staff-csrf", Origin: origin, "x-csrf-token": "staff-csrf",
    };
    const downloaded = await fetch(staffUrl, { headers: staffHeaders });
    assert.equal(downloaded.status, 200, await downloaded.clone().text());
    assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), image);
    const eventPrefix = `${origin}/api/events/${event.id}/paid-registration`;
    const queue = await fetch(`${eventPrefix}/review-queue`, { headers: staffHeaders });
    assert.equal(queue.status, 200);
    assert.equal((await queue.json()).reviews[0].attempt_id, pending.attempt_id);
    const verifiedTransferAt = new Date().toISOString();
    const approve = (receiver: string) => fetch(`${eventPrefix}/bookings/${booking.id}/review`, {
      method: "POST", headers: { ...staffHeaders, "Content-Type": "application/json", "Idempotency-Key": "verify" },
      body: JSON.stringify({
        decision: "approve", attempt_id: pending.attempt_id, version: pending.version, reason: "Matched fixture settlement",
        observed: { currency: "THB", amount_minor: 50000, paid_at: verifiedTransferAt, reference: "fixture-settlement", receiver_id: receiver },
      }),
    });
    const mismatch = await approve("0899999999");
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).error, "receiver_mismatch");
    const approval = await approve("0812345678");
    assert.equal(approval.status, 200, await approval.clone().text());
    const confirmed = await approval.json();
    assert.equal(confirmed.status, "confirmed");
    assert.deepEqual(await (await approve("0812345678")).json(), confirmed);
    const images = await Promise.all(attendees.map(({ id }: { id: string }) => fetch(credentialPath(id), { headers: headers("test-owner") })));
    assert.ok(images.every((qr) => qr.ok && qr.headers.get("content-type") === "image/png"));
    assert.notDeepEqual(Buffer.from(await images[0].arrayBuffer()), Buffer.from(await images[1].arrayBuffer()));
    assert.equal((await fetch(credentialPath(attendees[0].id), { headers: headers("test-other") })).status, 404);
    const ownerAccount = await db.getCustomerSessionWithAccount(hashSessionToken("test-owner"));
    const credential = await db.readPaidCredential(event.id, booking.id, attendees[0].id, ownerAccount!.account.id);
    assert.ok(credential);
    const scans = await Promise.all([1, 2].map(() => fetch(`${eventPrefix}/checkin`, {
      method: "POST", headers: { ...staffHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ credential }),
    })));
    assert.deepEqual(scans.map((scan) => scan.status).sort(), [200, 409]);
    const saveSettings = () => fetch(`${eventPrefix}/settings`, {
      method: "PATCH", headers: { ...staffHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1, capacity: 3, hold_minutes: 15, cutoff_ms: null, published: true,
        categories: [{ id: "adult", label: "Adult", unit_minor: 25000, quota: null }],
      }),
    });
    const saved = await saveSettings();
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await saved.json()).settings.version, 2);
    const stale = await saveSettings();
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, "version_conflict");
    const manualBooking = await db.createPaidBooking({
      eventId: event.id, customerId: ownerAccount!.account.id, key: "manual-booking", pricingVersion: 2,
      receiver: { id: "0812345678", name: "Fixture Organizer", profileVersion: 1 },
      contact: { name: "Test Customer" }, attendees: [{ categoryId: "adult", firstName: "Manual", lastName: "Guest" }],
    });
    const lookup = await fetch(`${eventPrefix}/review-queue?reference=${manualBooking.reference}`, { headers: staffHeaders });
    assert.equal(lookup.status, 200);
    const { reviews } = await lookup.json();
    assert.equal(reviews[0].booking_id, manualBooking.id);
    assert.equal(reviews[0].attempt_id, null);
    const manual = await fetch(`${eventPrefix}/bookings/${manualBooking.id}/review`, {
      method: "POST", headers: { ...staffHeaders, "Content-Type": "application/json", "Idempotency-Key": "manual-review" },
      body: JSON.stringify({
        decision: "approve", version: reviews[0].version, reason: "Matched fixture settlement without upload",
        observed: { currency: "THB", amount_minor: 25000, paid_at: new Date().toISOString(), reference: "manual-settlement", receiver_id: "0812345678" },
      }),
    });
    assert.equal(manual.status, 200, await manual.clone().text());
    assert.equal((await manual.json()).status, "confirmed");
    await db.savePaidSettings(event.id, {
      organizationId: "org_default", version: 2, capacity: 5, holdMinutes: 15, cutoffMs: null, published: true,
      categories: [{ id: "adult", label: "Adult", unitMinor: 25000, quota: null }],
    });
    const link = await fetch(`${origin}/api/customer/paid-bookings/${event.id}/messenger-link`, {
      method: "POST", headers: { ...headers("test-owner"), "x-csrf-token": "fixture-csrf" },
    });
    assert.equal(link.status, 201);
    const { command: linkCommand } = await link.json();
    const webhook = (text: string, mid: string, sender = "fixture-sender", signed = true) => {
      const raw = JSON.stringify({ object: "page", entry: [{ id: "fixture-page", messaging: [{
        sender: { id: sender }, recipient: { id: "fixture-page" }, timestamp: Date.now(), message: { mid, text },
      }] }] });
      const signature = createHmac("sha256", signed ? "fixture-webhook-secret" : "wrong").update(raw).digest("hex");
      return fetch(`${origin}/api/webhook`, {
        method: "POST", body: raw, headers: { "Content-Type": "application/json", "x-hub-signature-256": `sha256=${signature}` },
      });
    };
    const waitForReply = async (fragment: string, sender = "fixture-sender") => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const rows = await db.listNotificationDeliveries({ related_type: "facebook_outbound", limit: 30 });
        const reply = rows.find((row) => row.recipient === sender && String(JSON.parse(row.payload_json).text).includes(fragment));
        if (reply) return String(JSON.parse(reply.payload_json).text);
        await delay(75);
      }
      assert.fail(`Missing queued Messenger reply: ${fragment}`);
    };
    assert.equal((await webhook(linkCommand, "bad-link", "fixture-sender", false)).status, 401);
    assert.equal(await db.readPaidMessengerCustomer(event.id, "fixture-page", "fixture-sender"), undefined);
    assert.equal((await webhook(linkCommand, "link")).status, 200);
    await waitForReply("Booking account linked");
    assert.equal(await db.readPaidMessengerCustomer(event.id, "fixture-page", "fixture-sender"), ownerAccount!.account.id);
    assert.equal((await webhook(`paid status ${booking.reference}`, "unknown-status", "other-sender")).status, 200);
    await waitForReply("No booking found", "other-sender");
    assert.equal((await webhook("ขอจอง 2 คน หมวด adult ชื่อ หนึ่ง ทดสอบ และ สอง ทดสอบ", "draft")).status, 200);
    const quoteText = await waitForReply("ผู้เข้าร่วม 2 คน");
    const draftId = /ยืนยันจอง ([a-f0-9-]{36})/.exec(quoteText)?.[1];
    assert.ok(draftId);
    assert.equal((await webhook(`ยืนยันการจอง ${draftId}`, "confirm")).status, 200);
    await waitForReply("เลขอ้างอิง");
    assert.equal((await webhook(`ยืนยันจอง ${draftId}`, "confirm-replay")).status, 200);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const rows = await db.listNotificationDeliveries({ related_type: "facebook_outbound", limit: 30 });
      if (rows.filter((row) => String(JSON.parse(row.payload_json).text).includes("เลขอ้างอิง")).length === 2) break;
      if (attempt === 39) assert.fail("Missing reply to replayed confirmation");
      await delay(75);
    }
    assert.equal((await db.listOwnedPaidBookings(ownerAccount!.account.id, 10, 0)).length, 3);
    const response = await fetch(`${eventPrefix}/summary`, { headers: staffHeaders });
    assert.equal(response.status, 200);
    const { summary } = await response.json();
    assert.equal(summary.bookings, 3);
    assert.equal(summary.attendees, 5);
    assert.equal(summary.confirmed_bookings, 2);
    assert.equal(summary.confirmed_attendees, 3);
    assert.equal(summary.checked_in_attendees, 1);
    assert.equal(summary.held_attendees, 2);
    assert.equal(summary.available_attendees, 0);
    assert.equal(summary.accepted_minor, "75000");
    assert.equal(summary.unsettled_due_minor, "50000");
    const staffLookup = await fetch(`${eventPrefix}/bookings/by-reference/${manualBooking.reference}`, { headers: staffHeaders });
    assert.equal(staffLookup.status, 200);
    assert.equal((await staffLookup.json()).booking.id, manualBooking.id);
    assert.equal((await fetch(`${eventPrefix}/bookings/by-reference/${manualBooking.reference}`, { headers: headers("test-owner") })).status, 401);
    const refundRequest = () => fetch(`${eventPrefix}/bookings/${manualBooking.id}/manage`, {
      method: "POST", headers: { ...staffHeaders, "Content-Type": "application/json", "Idempotency-Key": "confirmed-refund" },
      body: JSON.stringify({ action: "refund", version: 2, reason: "Verified full bank refund", refund_reference: "refund-http-001" }),
    });
    const refunded = await refundRequest();
    assert.equal(refunded.status, 200, await refunded.clone().text());
    assert.equal((await refunded.json()).payment_status, "refunded");
    assert.equal((await (await refundRequest()).json()).payment_status, "refunded");
    const afterRefund = await fetch(`${eventPrefix}/bookings/by-reference/${manualBooking.reference}`, { headers: staffHeaders });
    assert.equal((await afterRefund.json()).booking.refunds.length, 1);
    await db.updateEvent(event.id, { status: "cancelled" });
    assert.equal((await fetch(credentialPath(attendees[0].id), { headers: headers("test-owner") })).status, 404);
    assert.equal((await fetch(`${prefix}/paid-registration`)).status, 404);
    assert.equal((await fetch(`${eventPrefix}/summary`, { headers: headers("test-owner") })).status, 401);
  } finally {
    if (child && child.exitCode === null) child.kill();
    await exited;
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
