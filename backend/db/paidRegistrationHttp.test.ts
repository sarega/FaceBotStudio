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
    const staffCreateHeaders = {
      Cookie: "fbs_session=test-reviewer; fbs_csrf=staff-csrf", Origin: origin,
      "x-csrf-token": "staff-csrf", "Content-Type": "application/json",
    };
    const freeCreated = await fetch(origin + "/api/events", {
      method: "POST", headers: staffCreateHeaders,
      body: JSON.stringify({ name:"Web only internal session", registration_mode:"free",
        web_page_enabled:true,open_registration_now:true }),
    });
    assert.equal(freeCreated.status, 201, await freeCreated.clone().text());
    const freeEvent = await freeCreated.json();
    assert.equal((await db.getEventById(freeEvent.id))?.status, "active");
    const freeSettings = await db.getSettingsMap(freeEvent.id);
    assert.equal(freeSettings.event_public_page_enabled, "1");
    assert.equal(freeSettings.event_public_registration_enabled, "1");
    assert.equal(freeSettings.event_catalog_visible, "0");
    assert.equal(freeSettings.event_public_bot_enabled, "1");
    const freePublic = await fetch(origin + "/api/public/events/" + freeEvent.slug);
    assert.equal(freePublic.status, 200);
    assert.equal((await freePublic.json()).event.registration_enabled, true);
    const allCatalogEntries = await (await fetch(origin + "/api/public/events")).json();
    assert.equal(allCatalogEntries.events.some(({ slug }: { slug: string }) => slug === freeEvent.slug), false);
    const oldFree = await db.createEvent({ name:"Existing web-only session",organizer_id:"org_default" });
    assert.equal((await db.getEventById(oldFree.id))?.status, "pending");
    const enabled = await fetch(origin + "/api/events/" + oldFree.id + "/enable-web-registration", {
      method:"POST",headers:staffCreateHeaders,
    });
    assert.equal(enabled.status, 200, await enabled.clone().text());
    assert.equal((await db.getEventById(oldFree.id))?.status, "active");
    assert.equal((await db.getSettingsMap(oldFree.id)).event_public_page_enabled, "1");
    const paidCreated = await fetch(origin + "/api/events", {
      method:"POST",headers:staffCreateHeaders,
      body:JSON.stringify({ name:"Private paid retreat", registration_mode:"paid",
        web_page_enabled:true,open_registration_now:true,price_thb:2500,capacity:25 }),
    });
    assert.equal(paidCreated.status, 201, await paidCreated.clone().text());
    const paidEvent = await paidCreated.json();
    const paidDraft = await db.readPaidSettings(paidEvent.id);
    assert.equal(Number(paidDraft?.published), 0);
    assert.equal((paidDraft?.categories as Array<{unit_minor:number}>)[0]?.unit_minor,250000);
    assert.equal((await fetch(origin + "/api/events/" + paidEvent.id + "/enable-web-registration", {
      method:"POST",headers:staffCreateHeaders,
    })).status,409);
    assert.equal((await db.getSettingsMap(paidEvent.id)).event_public_registration_enabled, "0");
    const newExternal = await fetch(origin + "/api/events", {
      method:"POST",headers:staffCreateHeaders,
      body:JSON.stringify({ name:"Internal manual paid signup",registration_mode:"paid",
        payment_mode:"external_manual",web_page_enabled:true,open_registration_now:true,
        price_thb:650,capacity:15 }),
    });
    assert.equal(newExternal.status,201,await newExternal.clone().text());
    const newExternalEvent = await newExternal.json();
    const newExternalSettings = await db.readPaidSettings(newExternalEvent.id);
    assert.equal(newExternalSettings?.payment_mode,"external_manual");
    assert.equal(Number(newExternalSettings?.published),1);
    assert.equal((await fetch(origin + "/api/public/events/" + newExternalEvent.slug + "/paid-registration")).status,200);
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
    // Customer recovery over HTTP must be scoped to the owner, and must
    // produce a 24-hour renewed invoice without blocking later registrations.
    assert.equal(Number(newExternalSettings?.hold_minutes), 1440);
    const recoveryPrefix = origin + "/api/public/events/" + newExternalEvent.slug + "/paid-bookings";
    const recoveryBody = JSON.stringify({ pricing_version: Number(newExternalSettings?.version),
      contact: { name: "Returning attendee" },
      attendees: [{ category_id: "general", first_name: "Return", last_name: "Guest" }] });
    const recoveryCreate = await fetch(recoveryPrefix, {
      method: "POST",
      headers: { ...headers("test-owner"), "Content-Type": "application/json",
        "x-csrf-token": "fixture-csrf", "Idempotency-Key": "return-1" },
      body: recoveryBody,
    });
    assert.equal(recoveryCreate.status, 201, await recoveryCreate.clone().text());
    const recoveryBooking = await recoveryCreate.json();
    const recoveryPath = origin + "/api/customer/paid-bookings/" + newExternalEvent.id +
      "/" + recoveryBooking.id;
    const recoveryFixture = new Database(database);
    try {
      recoveryFixture.prepare("UPDATE paid_bookings SET created_ms=1,due_ms=2 WHERE id=?")
        .run(recoveryBooking.id);
    } finally {
      recoveryFixture.close();
    }
    assert.equal((await fetch(recoveryPath, { headers: headers("test-owner") })
      .then(r => r.json())).status, "expired");
    assert.equal((await fetch(recoveryPath + "/reinstate", {
      method: "POST", headers: { ...headers("test-other"), "x-csrf-token": "fixture-csrf" },
    })).status, 404);
    const recoveryRestored = await fetch(recoveryPath + "/reinstate", {
      method: "POST", headers: { ...headers("test-owner"), "x-csrf-token": "fixture-csrf" },
    });
    assert.equal(recoveryRestored.status, 200, await recoveryRestored.clone().text());
    const recoveryStatus = await recoveryRestored.json();
    assert.equal(recoveryStatus.status, "awaiting_payment");
    assert.ok(Date.parse(recoveryStatus.due_at) - Date.now() > 23 * 60 * 60_000);
    assert.equal((await fetch(recoveryPath + "/reinstate", {
      method: "POST", headers: { ...headers("test-owner"), "x-csrf-token": "fixture-csrf" },
    })).status, 409);
    const bookingMore = await fetch(recoveryPrefix, {
      method: "POST",
      headers: { ...headers("test-owner"), "Content-Type": "application/json",
        "x-csrf-token": "fixture-csrf", "Idempotency-Key": "return-2" },
      body: recoveryBody,
    });
    assert.equal(bookingMore.status, 201, await bookingMore.clone().text());
    assert.notEqual((await bookingMore.json()).id, recoveryBooking.id);
    const externalPrefix = origin + "/api/events/" + paidEvent.id + "/paid-registration";
    const fixedCutoff = Date.now() + 7 * 86_400_000;
    const publishExternal = await fetch(externalPrefix + "/settings", {
      method: "PATCH", headers: staffCreateHeaders,
      body: JSON.stringify({ version: 1, capacity: 25, hold_minutes: 30, cutoff_ms: fixedCutoff, deadline_mode: "fixed",
        published: true, payment_mode: "external_manual",
        categories: [{ id: "general", label: "General", unit_minor: 250000, quota: null }] }),
    });
    assert.equal(publishExternal.status, 200, await publishExternal.clone().text());
    assert.equal((await publishExternal.json()).settings.payment_mode, "external_manual");
    assert.equal((await db.readPaidMode(paidEvent.id))?.paymentMode, "external_manual");
    const readinessExternal = await (await fetch(externalPrefix + "/readiness", { headers: staffCreateHeaders })).json();
    assert.equal(readinessExternal.paid_ready, true);
    assert.equal(readinessExternal.payment_mode, "external_manual");
    const externalPublic = origin + "/api/public/events/" + paidEvent.slug;
    assert.equal((await fetch(externalPublic + "/paid-registration")).status, 200);
    const externalPlaced = await fetch(externalPublic + "/paid-bookings", {
      method:"POST", headers: { ...headers("test-owner"), "Content-Type": "application/json",
        "Idempotency-Key": "external-http", "x-csrf-token": "fixture-csrf" },
      body:JSON.stringify({ pricing_version:2, contact:{ name:"External Participant" },
        attendees:[{ category_id:"general", first_name:"External", last_name:"Guest" }] }),
    });
    assert.equal(externalPlaced.status, 201, await externalPlaced.clone().text());
    const externalBooking = await externalPlaced.json();
    assert.equal(Date.parse(externalBooking.due_at), fixedCutoff);
    assert.equal(await db.readPaidPaymentInstructions(paidEvent.id, externalBooking.id,
      (await db.getCustomerSessionWithAccount(hashSessionToken("test-owner")))!.account.id), undefined);
    const externalQueue = await fetch(externalPrefix + "/review-queue?reference=" + externalBooking.reference,
      { headers: staffCreateHeaders });
    assert.equal(externalQueue.status, 200);
    assert.equal((await externalQueue.json()).reviews[0].payment_mode, "external_manual");
    const qrFixture = await sharp({create:{width:150,height:150,channels:3,background:"#ffffff"}})
      .png().toBuffer();
    const displayUrl = externalPrefix + "/payment-display";
    const qrUpload = await fetch(displayUrl + "/qr",{
      method:"POST",headers:{...staffCreateHeaders,"Content-Type":"application/octet-stream"},body:qrFixture,
    });
    assert.equal(qrUpload.status,200,await qrUpload.clone().text());
    const qrUploaded = await qrUpload.json();
    assert.equal(typeof qrUploaded.qr_png_base64,"string");
    assert.equal(Buffer.from(qrUploaded.qr_png_base64,"base64").subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal((await fetch(displayUrl,{headers:headers("test-owner")})).status,401);
    const detailsSave = await fetch(displayUrl,{
      method:"PUT",headers:staffCreateHeaders,
      body:JSON.stringify({bank_name:"Example Bank",account_name:"Recipient Example",
        account_number:"123-4-56789-0"}),
    });
    assert.equal(detailsSave.status,200,await detailsSave.clone().text());
    const savedDisplay=await detailsSave.json();
    assert.equal(savedDisplay.account_name,"Recipient Example");
    assert.equal(savedDisplay.qr_png_base64,qrUploaded.qr_png_base64);
    const privatePayment=origin+"/api/customer/paid-bookings/"+paidEvent.id+"/"+externalBooking.id+"/payment-display";
    const customerDisplay=await fetch(privatePayment,{headers:headers("test-owner")});
    assert.equal(customerDisplay.status,200,await customerDisplay.clone().text());
    assert.equal((await customerDisplay.json()).account_number,"123-4-56789-0");
    assert.equal((await fetch(privatePayment,{headers:headers("test-other")})).status,404);
    const invalidUpload=await fetch(displayUrl+"/qr",{
      method:"POST",headers:{...staffCreateHeaders,"Content-Type":"application/octet-stream"},body:"not an image",
    });
    assert.equal(invalidUpload.status,415);
    assert.equal((await fetch(displayUrl,{headers:staffCreateHeaders}).then(r=>r.json())).qr_png_base64,
      qrUploaded.qr_png_base64);
    // External/manual booking must accept an encrypted bank-transfer slip,
    // queue it for staff review, then issue credentials only after bank verification.
    const externalProofBooked = await fetch(externalPublic + "/paid-bookings", {
      method: "POST", headers: { ...headers("test-owner"), "Content-Type": "application/json",
        "Idempotency-Key": "external-slip-booking", "x-csrf-token": "fixture-csrf" },
      body: JSON.stringify({ pricing_version: 2, contact: { name: "Bank Transfer Test" },
        attendees: [{ category_id: "general", first_name: "Paid", last_name: "Externally" }] }),
    });
    assert.equal(externalProofBooked.status, 201, await externalProofBooked.clone().text());
    const externalSlipBooking = await externalProofBooked.json();
    const externalOwnedPath = origin + "/api/customer/paid-bookings/" + paidEvent.id + "/" + externalSlipBooking.id;
    assert.equal((await fetch(externalOwnedPath, { headers: headers("test-other") })).status, 404);
    const paymentDisplay = await fetch(externalOwnedPath + "/payment-display", { headers: headers("test-owner") });
    assert.equal(paymentDisplay.status, 200);
    assert.equal((await paymentDisplay.json()).account_number, "123-4-56789-0");
    const externalProof = await fetch(externalOwnedPath + "/proofs", {
      method: "POST", body: Uint8Array.from(qrFixture),
      headers: { ...headers("test-owner"), "Content-Type": "application/octet-stream",
        "Idempotency-Key": "external-slip-proof", "x-csrf-token": "fixture-csrf",
        "x-booking-version": "1", "x-claimed-minor": "250000",
        "x-claimed-transfer-at": new Date().toISOString(), "x-payment-method": "bank_transfer",
        "x-proof-mime": "image/png", "x-payment-reference": "external-slip-test" },
    });
    assert.equal(externalProof.status, 202, await externalProof.clone().text());
    const externalReceipt = await externalProof.json();
    assert.equal(externalReceipt.status, "verification_pending");
    assert.equal((await fetch(externalOwnedPath, { headers: headers("test-owner") }).then(r => r.json())).status,
      "verification_pending");
    const externalQueueAfterUpload = await fetch(externalPrefix + "/review-queue?reference=" +
      externalSlipBooking.reference, { headers: staffCreateHeaders });
    assert.equal(externalQueueAfterUpload.status, 200);
    const externalReviews = (await externalQueueAfterUpload.json()).reviews;
    assert.equal(externalReviews[0].attempt_id, externalReceipt.attempt_id);
    assert.equal(externalReviews[0].event_id,paidEvent.id);
    assert.equal(externalReviews[0].event_name,paidEvent.name);
    assert.equal(externalReviews[0].customer_email,"test-owner@example.com");
    assert.equal(externalReviews[0].customer_first_name,"Test");
    assert.equal(externalReviews[0].customer_last_name,"Customer");
    assert.ok(externalReviews[0].booking_created_ms>0);
    assert.equal(externalReviews[0].booking_reference,externalSlipBooking.reference);
    const customerDashboard=await fetch(origin+"/api/admin/customers?limit=500",{
      headers:staffCreateHeaders,
    });
    assert.equal(customerDashboard.status,200,await customerDashboard.clone().text());
    const dashboardData=await customerDashboard.json();
    assert.ok(dashboardData.summary.bookings>0);
    assert.ok(dashboardData.summary.awaiting_review>0);
    const dashboardBooking=dashboardData.customers.flatMap(
      (row:{paid_bookings:Array<{booking_id:string;event_id:string;customer_id:string}>})=>
        row.paid_bookings).find((row:{booking_id:string})=>row.booking_id===externalSlipBooking.id);
    assert.ok(dashboardBooking);
    assert.equal(dashboardBooking.event_id,paidEvent.id);
    assert.equal(dashboardBooking.customer_id,externalReviews[0].customer_id);
    const deniedExport=await fetch(origin+"/api/admin/customers/paid-bookings.csv");
    assert.equal(deniedExport.status,401);
    const exportResponse=await fetch(origin+"/api/admin/customers/paid-bookings.csv",{
      headers:staffCreateHeaders,
    });
    assert.equal(exportResponse.status,200,await exportResponse.clone().text());
    assert.match(exportResponse.headers.get("content-type")||"",/text\/csv/);
    const csvBytes=new Uint8Array(await exportResponse.arrayBuffer());
    assert.deepEqual([...csvBytes.slice(0,3)],[0xef,0xbb,0xbf]);
    const exportedCsv=new TextDecoder().decode(csvBytes);
    assert.ok(exportedCsv.includes("event_id"));
    assert.ok(exportedCsv.includes("customer_email"));
    assert.ok(exportedCsv.includes("booking_reference"));
    assert.ok(exportedCsv.includes("slip_uploaded_at"));
    assert.ok(exportedCsv.includes(externalSlipBooking.reference));
    assert.ok(exportedCsv.includes("test-owner@example.com"));

    const reviewedProof = await fetch(externalPrefix + "/bookings/" + externalSlipBooking.id +
      "/proofs/" + externalReceipt.attempt_id, { headers: staffCreateHeaders });
    assert.equal(reviewedProof.status, 200);
    // Evidence may be recompressed losslessly; compare decoded image pixels.
    assert.deepEqual(
      await sharp(Buffer.from(await reviewedProof.arrayBuffer())).ensureAlpha().raw().toBuffer(),
      await sharp(qrFixture).ensureAlpha().raw().toBuffer(),
    );
    const approvedExternalSlip = await fetch(externalPrefix + "/bookings/" + externalSlipBooking.id + "/review", {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "external-slip-review" },
      body: JSON.stringify({ decision: "approve", attempt_id: externalReceipt.attempt_id,
        version: externalReceipt.version, reason: "Verified transfer against bank records",
        observed: { amount_minor: 250000, currency: "THB",
          paid_at: new Date().toISOString(), reference: "SLIP-"+externalReceipt.attempt_id,
          receiver_id: "EXTERNAL_MANUAL" } }),
    });
    assert.equal(approvedExternalSlip.status, 200, await approvedExternalSlip.clone().text());
    assert.equal((await approvedExternalSlip.json()).status, "confirmed");
    const externalConfirmed = await fetch(externalOwnedPath, { headers: headers("test-owner") });
    const externalConfirmedDetail = await externalConfirmed.json();
    assert.equal(externalConfirmedDetail.status, "confirmed");
    const externalCredential = await fetch(externalOwnedPath + "/attendees/" +
      externalConfirmedDetail.attendees[0].id + "/credential", { headers: headers("test-owner") });
    assert.equal(externalCredential.status, 200);
    assert.equal(externalCredential.headers.get("content-type"), "image/png");
    const confirmationDeliveries = await db.listNotificationDeliveries({ related_type: "paid_booking", limit: 30 });
    assert.ok(confirmationDeliveries.some((row) =>
      row.kind === "paid_booking.confirmed" && row.related_id === externalSlipBooking.id),
      "external bank verification must enqueue the confirmation email");
    const externalApproval = await fetch(externalPrefix + "/bookings/" + externalBooking.id + "/review", {
      method:"POST", headers:{ ...staffCreateHeaders, "Idempotency-Key":"external-http-review" },
      body:JSON.stringify({ decision:"approve", version:1, reason:"Organizer confirmed payment externally",
        observed:{ amount_minor:250000,currency:"THB",paid_at:new Date().toISOString(),
          reference:"external-http-001",receiver_id:"EXTERNAL_MANUAL" } }),
    });
    assert.equal(externalApproval.status, 200, await externalApproval.clone().text());
    assert.equal((await externalApproval.json()).status, "confirmed");
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
    const listedBooking = (await ownList.json()).bookings[0];
    assert.equal(listedBooking.id, booking.id);
    assert.equal(listedBooking.status, "awaiting_payment");
    assert.equal(listedBooking.event_slug, "http-paid-workshop");
    assert.equal((await fetch(`${origin}/api/public/events/${listedBooking.event_slug}`)).status, 200);
    const confirmedListing = listing + "&confirmed=1";
    const fetchConfirmed = async () => (await (await fetch(confirmedListing, { headers: headers("test-owner") })).json()).bookings;
    assert.deepEqual(await fetchConfirmed(), []);
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
    assert.deepEqual(
      await sharp(Buffer.from(await downloaded.arrayBuffer())).ensureAlpha().raw().toBuffer(),
      await sharp(image).ensureAlpha().raw().toBuffer(),
    );
    const eventPrefix = `${origin}/api/events/${event.id}/paid-registration`;
    const readinessResponse = await fetch(eventPrefix + "/readiness", { headers: staffHeaders });
    assert.equal(readinessResponse.status, 200);
    const readiness = await readinessResponse.json();
    assert.equal(readiness.paid_ready, true);
    assert.equal(readiness.checks.paid_published, true);
    assert.equal(readiness.checks.slip_encryption_ready, true);
    assert.equal(readiness.checks.event_chat_enabled, true);
    assert.equal((await fetch(eventPrefix + "/readiness", { headers: headers("test-owner") })).status, 401);
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
    assert.equal((await fetchConfirmed())[0].id, booking.id);
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
    assert.equal((await db.listOwnedPaidBookings(ownerAccount!.account.id, 10, 0)).length, 7);
    const response = await fetch(`${eventPrefix}/summary`, { headers: staffHeaders });
    assert.equal(response.status, 200);
    const { summary } = await response.json();
    assert.equal(summary.bookings, 3);
    assert.equal(summary.attendees, 5);
    const attendeeRosterResponse=await fetch(eventPrefix+"/attendees",{headers:staffHeaders});
    assert.equal(attendeeRosterResponse.status,200);
    const attendeeRoster=await attendeeRosterResponse.json();
    assert.equal(attendeeRoster.attendees.length,5);
    const legacyRosterEvent=await db.createEvent({
      name:"Free Legacy Registration Event",organizer_id:"org_default",
    });
    const legacyFixture=new Database(database);
    legacyFixture.prepare("INSERT INTO registrations (id,event_id,first_name,last_name) VALUES (?,?,?,?)")
      .run("REG-LEGACY-EXPORT",legacyRosterEvent.id,"Legacy","Guest");
    legacyFixture.close();
    const globalRoster=await fetch(origin+"/api/admin/customers/attendee-roster.csv",
      {headers:staffHeaders});
    assert.equal(globalRoster.status,200,await globalRoster.clone().text());
    const globalCsv=await globalRoster.text();
    assert.match(globalCsv,/booking_reference/);
    assert.match(globalCsv,/event_name/);
    assert.match(globalCsv,/customer_email/);
    assert.match(globalCsv,/food_preference/);
    assert.match(globalCsv,/Free Legacy Registration Event/);
    assert.match(globalCsv,/Legacy/);
    assert.match(globalCsv,/Guest/);
    assert.match(globalCsv,/legacy_registration/);
    assert.match(globalCsv,/paid_booking/);
    for(const person of attendeeRoster.attendees){
      assert.ok(globalCsv.includes(person.first_name));
      assert.ok(globalCsv.includes(person.last_name));
    }
    const unauthorizedGlobal=await fetch(origin+"/api/admin/customers/attendee-roster.csv");
    assert.equal(unauthorizedGlobal.status,401);

    assert.equal(attendeeRoster.summary.attendees,5);
    assert.equal(attendeeRoster.attendees.filter((person:{booking_id:string})=>
      person.booking_id===booking.id).length,2);
    assert.equal(attendeeRoster.attendees[0].customer_email,"test-owner@example.com");
    const deniedRoster=await fetch(eventPrefix+"/attendees");
    assert.equal(deniedRoster.status,401);
    const excelExport=await fetch(origin+"/api/registrations/export?event_id="+event.id,
      {headers:staffHeaders});
    assert.equal(excelExport.status,200);
    const excelBytes=new Uint8Array(await excelExport.arrayBuffer());
    assert.deepEqual([...excelBytes.slice(0,3)],[0xef,0xbb,0xbf]);
    const excelCsv=new TextDecoder().decode(excelBytes);
    assert.match(excelCsv,/booking_reference/);
    assert.match(excelCsv,/customer_email/);
    assert.match(excelCsv,/food_preference/);
    assert.match(excelCsv,/accommodation_needed/);
    assert.match(excelCsv,/paid_booking/);
    for(const person of attendeeRoster.attendees){
      assert.ok(excelCsv.includes(person.first_name));
      assert.ok(excelCsv.includes(person.last_name));
    }

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
    // Coupons API: admin-only management, customer quote, one-use complimentary
    // booking, credentials, and no payment proof required.
    // Regression: internal event.slug and public Event Settings slug can differ.
    // The coupon Admin link must resolve through the public-event resolver.
    const slugProbe = await db.createEvent({name:"Coupon Internal Route",organizer_id:"org_default"});
    assert.notEqual(slugProbe.slug,"correct-coupon-public-route");
    await db.updateEvent(slugProbe.id,{status:"active"});
    await db.upsertSettings({event_public_page_enabled:"1",
      event_public_slug:"correct-coupon-public-route"},slugProbe.id);
    const probeCoupons=await fetch(origin+"/api/events/"+slugProbe.id+
      "/paid-registration/coupons",{headers:staffCreateHeaders});
    assert.equal(probeCoupons.status,200);
    const probeInfo=await probeCoupons.json();
    assert.equal(probeInfo.event_id,slugProbe.id);
    assert.equal(probeInfo.event_slug,"correct-coupon-public-route");
    assert.equal(probeInfo.public_page_enabled,true);
    const probePage=await fetch(origin+"/api/public/events/"+probeInfo.event_slug);
    assert.equal(probePage.status,200);
    assert.equal((await probePage.json()).event.id,slugProbe.id);
    assert.equal((await fetch(origin+"/api/public/events/"+slugProbe.slug)).status,404);
    await db.upsertSettings({event_public_page_enabled:"0"},slugProbe.id);
    const unpublishedProbe=await fetch(origin+"/api/events/"+slugProbe.id+
      "/paid-registration/coupons",{headers:staffCreateHeaders});
    assert.equal((await unpublishedProbe.json()).public_page_enabled,false);
    // Coupon lookup should validate the actual code independently from the
    // Accommodation answer. Preview uses current base price until answered;
    // final booking submission still requires every configured required answer.
    const pricingEvent=await db.createEvent({name:"Coupon with accommodation",organizer_id:"org_default"});
    await db.updateEvent(pricingEvent.id,{status:"active"});
    await db.upsertSettings({
      event_public_page_enabled:"1",event_public_slug:"coupon-accommodation-test",
    },pricingEvent.id);
    const pricingConfig=await db.savePaidSettings(pricingEvent.id,{
      organizationId:"org_default",version:0,capacity:20,holdMinutes:1440,cutoffMs:null,
      published:true,paymentMode:"external_manual",
      categories:[{id:"adult",label:"Adult",unitMinor:340000,
        accommodationDiscountMinor:80000,quota:null}],
      fields:[{key:"accommodation",scope:"attendee",required:true}],
    });
    await db.savePaidCoupon(pricingEvent.id,{
      code:"YOGISUPPORT",kind:"percent",value_minor:10000,max_uses:10,
      per_customer_limit:5,starts_ms:null,ends_ms:null,enabled:true,
    });
    const pricingUrl=origin+"/api/public/events/coupon-accommodation-test";
    const pricingBody={
      pricing_version:Number(pricingConfig.version),coupon_code:"YOGISUPPORT",
      attendees:[{category_id:"adult",first_name:"First",last_name:"Person"}],
    };
    const pricingRequest=async(body:object)=>fetch(pricingUrl+"/paid-registration/coupon-preview",{
      method:"POST",headers:{...headers("test-owner"),"Content-Type":"application/json",
        "x-csrf-token":"fixture-csrf"},body:JSON.stringify(body),
    });
    const basePreview=await pricingRequest(pricingBody);
    assert.equal(basePreview.status,200,await basePreview.clone().text());
    const baseQuote=await basePreview.json();
    assert.equal(baseQuote.provisional,true);
    assert.equal(baseQuote.subtotal_minor,340000);
    assert.equal(baseQuote.discount_minor,340000);
    assert.equal(baseQuote.total_minor,0);
    const reducedPreview=await pricingRequest({...pricingBody,
      attendees:[{category_id:"adult",answers:{accommodation:"no"}}]});
    assert.equal(reducedPreview.status,200,await reducedPreview.clone().text());
    const reducedQuote=await reducedPreview.json();
    assert.equal(reducedQuote.provisional,false);
    assert.equal(reducedQuote.subtotal_minor,260000);
    assert.equal(reducedQuote.discount_minor,260000);
    const wrongFormat=await pricingRequest({...pricingBody,coupon_code:"?"});
    assert.equal(wrongFormat.status,422);
    assert.equal((await wrongFormat.json()).error,"coupon_invalid");
    const unknownCode=await pricingRequest({...pricingBody,coupon_code:"NOTAREALCODE"});
    assert.equal(unknownCode.status,422);
    assert.equal((await unknownCode.json()).error,"coupon_not_found");
    const incompleteBooking=await fetch(pricingUrl+"/paid-bookings",{
      method:"POST",headers:{...headers("test-owner"),"Content-Type":"application/json",
        "x-csrf-token":"fixture-csrf","Idempotency-Key":"coupon-accommodation-incomplete"},
      body:JSON.stringify({...pricingBody,contact:{name:"First Person"}}),
    });
    assert.notEqual(incompleteBooking.status,201,
      "A provisional coupon preview must not bypass required booking answers");
    const couponAdminPath=origin+"/api/events/"+newExternalEvent.id+"/paid-registration/coupons";
    const couponDraft={code:"TEMPDELETE",kind:"fixed",value_minor:500,
      max_uses:1,per_customer_limit:1,starts_ms:null,ends_ms:null,enabled:true};
    assert.equal((await fetch(couponAdminPath,{method:"PUT",headers:staffCreateHeaders,
      body:JSON.stringify(couponDraft)})).status,200);
    assert.equal((await fetch(couponAdminPath+"/TEMPDELETE",{method:"DELETE",
      headers:headers("test-owner")})).status,403);
    const deletedDraft=await fetch(couponAdminPath+"/TEMPDELETE",{method:"DELETE",
      headers:staffCreateHeaders});
    assert.equal(deletedDraft.status,200,await deletedDraft.clone().text());
    assert.equal((await deletedDraft.json()).deleted,true);
    assert.equal((await fetch(couponAdminPath+"/TEMPDELETE",{method:"DELETE",
      headers:staffCreateHeaders})).status,404);
    const couponRule={code:"TESTFREE",kind:"free",value_minor:0,max_uses:1,
      per_customer_limit:1,starts_ms:null,ends_ms:null,enabled:true};
    const forbidden=await fetch(couponAdminPath,{headers:headers("test-owner")});
    assert.equal(forbidden.status,401);
    const couponSaved=await fetch(couponAdminPath,{method:"PUT",headers:staffCreateHeaders,
      body:JSON.stringify(couponRule)});
    assert.equal(couponSaved.status,200,await couponSaved.clone().text());
    const couponsResponse=await fetch(couponAdminPath,{headers:staffCreateHeaders});
    assert.equal(couponsResponse.status,200);
    const couponInfo=await couponsResponse.json();
    assert.equal(couponInfo.coupons[0].code,"TESTFREE");
    assert.equal(couponInfo.event_id,newExternalEvent.id);
    assert.equal(couponInfo.event_slug,newExternalEvent.slug);
    assert.equal(couponInfo.coupons[0].availability,"active");
    const couponPage=origin+"/api/public/events/"+newExternalEvent.slug;
    const couponPayload={pricing_version:Number(newExternalSettings?.version),
      coupon_code:"testfree",
      attendees:[{category_id:"general",first_name:"Coupon",last_name:"Guest"}]};
    const preview=await fetch(couponPage+"/paid-registration/coupon-preview",{
      method:"POST",headers:{...headers("test-owner"),"Content-Type":"application/json",
        "x-csrf-token":"fixture-csrf"},body:JSON.stringify(couponPayload),
    });
    assert.equal(preview.status,200,await preview.clone().text());
    const quote=await preview.json();
    assert.equal(quote.subtotal_minor,65000);
    assert.equal(quote.discount_minor,65000);
    assert.equal(quote.total_minor,0);
    const noSuchCoupon=await fetch(couponPage+"/paid-registration/coupon-preview",{
      method:"POST",headers:{...headers("test-owner"),"Content-Type":"application/json",
        "x-csrf-token":"fixture-csrf"},
      body:JSON.stringify({...couponPayload,coupon_code:"DOESNOTEXIST"}),
    });
    assert.equal(noSuchCoupon.status,422);
    assert.equal((await noSuchCoupon.json()).error,"coupon_not_found");
    const freeBookingResponse=await fetch(couponPage+"/paid-bookings",{
      method:"POST",headers:{...headers("test-owner"),"Content-Type":"application/json",
        "x-csrf-token":"fixture-csrf","Idempotency-Key":"coupon-free-http"},
      body:JSON.stringify({...couponPayload,contact:{name:"Coupon Test"}}),
    });
    assert.equal(freeBookingResponse.status,201,await freeBookingResponse.clone().text());
    const freeBooking=await freeBookingResponse.json();
    assert.equal(freeBooking.total_due_minor,0);
    assert.equal(freeBooking.status,"confirmed");
    const ownerFreeUrl=origin+"/api/customer/paid-bookings/"+newExternalEvent.id+"/"+freeBooking.id;
    const ownerFree=await fetch(ownerFreeUrl,{headers:headers("test-owner")});
    assert.equal(ownerFree.status,200);
    const freeDetails=await ownerFree.json();
    assert.equal(freeDetails.payment_state,"verified");
    assert.equal(freeDetails.coupon.code,"TESTFREE");
    assert.equal(freeDetails.coupon.discount_minor,65000);
    const ticket=await fetch(ownerFreeUrl+"/attendees/"+freeDetails.attendees[0].id+
      "/credential",{headers:headers("test-owner")});
    assert.equal(ticket.status,200);
    const freeEmailQueue=await db.listNotificationDeliveries({
      related_type:"paid_booking",related_id:freeBooking.id});
    assert.ok(freeEmailQueue.some(row=>row.kind==="paid_booking.confirmed"));
    const overLimit=await fetch(couponPage+"/paid-bookings",{
      method:"POST",headers:{...headers("test-owner"),"Content-Type":"application/json",
        "x-csrf-token":"fixture-csrf","Idempotency-Key":"coupon-free-http-2"},
      body:JSON.stringify({...couponPayload,contact:{name:"Coupon Test"}}),
    });
    assert.equal(overLimit.status,409,await overLimit.clone().text());
    assert.equal((await overLimit.json()).error,"coupon_exhausted");
    const afterCoupon=await fetch(couponAdminPath,{headers:staffCreateHeaders});
    assert.equal((await afterCoupon.json()).coupons[0].uses,1);
    const historicalDelete=await fetch(couponAdminPath+"/TESTFREE",{method:"DELETE",
      headers:staffCreateHeaders});
    assert.equal(historicalDelete.status,409);
    assert.equal((await historicalDelete.json()).error,"coupon_has_history");
    const disabled=await fetch(couponAdminPath,{method:"PUT",headers:staffCreateHeaders,
      body:JSON.stringify({...couponRule,enabled:false})});
    assert.equal(disabled.status,200);
    assert.equal((await disabled.json()).coupon.enabled,0);
    const disabledQuote=await fetch(couponPage+"/paid-registration/coupon-preview",{
      method:"POST",headers:{...headers("test-owner"),"Content-Type":"application/json",
        "x-csrf-token":"fixture-csrf"},body:JSON.stringify(couponPayload),
    });
    assert.equal(disabledQuote.status,422);
    assert.equal((await disabledQuote.json()).error,"coupon_disabled");
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
