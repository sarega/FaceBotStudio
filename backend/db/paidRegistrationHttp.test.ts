import sharp from "sharp";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { hashPassword, hashSessionToken } from "../auth";
import { draftRoomingPlan, moveRoomingGuest } from "../roomingPlan";
import type { PaidRoomingPlan } from "./paidRegistration";
import { SqliteAppDatabase } from "./sqliteAdapter";
import { ROLE_PREVIEW_EVENT_HEADER, ROLE_PREVIEW_HEADER, STAFF_PREVIEW_ROLES } from "../../src/lib/rolePreview";

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
    const owner = await db.createUser({
      username: "fixture-owner", display_name: "Fixture owner", password_hash: "fixture", role: "owner",
    });
    await db.createSession(owner.id, hashSessionToken("test-staff-owner"), new Date(Date.now() + 3_600_000));
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
    const sentEmail = join(directory, "sent-email.jsonl");
    const mockVision = join(directory, "mock-slip-vision.cjs");
    writeFileSync(mockVision, `
      const fetch = globalThis.fetch;
      const { appendFileSync } = require("node:fs");
      globalThis.fetch = (input, options) => {
        if (String(input) === "https://api.resend.com/emails") {
          appendFileSync(${JSON.stringify(sentEmail)}, options.body + "\\n");
          return Promise.resolve(Response.json({ id: "fixture-email" }));
        }
        if (String(input) !== "https://openrouter.ai/api/v1/chat/completions") return fetch(input, options);
        const request = JSON.parse(options.body);
        if (request.provider?.zdr !== true || request.provider?.data_collection !== "deny" ||
            !request.messages[0].content[1].image_url.url.startsWith("data:image/")) {
          return Promise.resolve(Response.json({}, { status: 400 }));
        }
        return Promise.resolve(Response.json({ choices: [{ message: { content: JSON.stringify({
          amount_minor: 50000, transfer_at: "2025-11-21T13:45:12", payer_name: "สมใจ ทดสอบ",
        }) } }] }));
      };
    `);
    child = spawn(process.execPath, ["--require", mockVision, "--import", resolve("node_modules/tsx/dist/loader.mjs"), server], {
      cwd: directory,
      env: {
        PATH: process.env.PATH, APP_RUNTIME: "web", NODE_ENV: "development", PORT: String(port),
        APP_URL: origin, DB_PATH: database, PUBLIC_UPLOADS_DIR: join(directory, "uploads"),
        CUSTOMER_APP_ENABLED: "1", PAID_REGISTRATION_PUBLIC_ENABLED: "1",
        RESEND_API_KEY: "fixture", EMAIL_FROM: "tickets@example.com", EMAIL_REPLY_TO: "help@example.com",
        OPENROUTER_API_KEY: "mock-key", FACEBOOK_APP_SECRET: "fixture-webhook-secret", PAID_PROOF_ENCRYPTION_KEY: "01".repeat(32),
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
    const profileUrl = origin + "/api/auth/profile";
    const patchProfile = (input: object, headers: Record<string, string>) =>
      fetch(profileUrl, { method: "PATCH", headers, body: JSON.stringify(input) });
    const ownerHeaders = { ...staffCreateHeaders, Cookie: "fbs_session=test-staff-owner; fbs_csrf=staff-csrf" };
    const previewHeaders = { ...ownerHeaders, [ROLE_PREVIEW_HEADER]: "operator", [ROLE_PREVIEW_EVENT_HEADER]: event.id };
    for (const role of STAFF_PREVIEW_ROLES) {
      const preview = await fetch(origin + "/api/auth/me", { headers: { ...previewHeaders, [ROLE_PREVIEW_HEADER]: role } });
      assert.equal(preview.status, 200);
      assert.equal((await preview.json()).user.role, role);
      assert.match(preview.headers.get("Cache-Control") ?? "", /no-store/);
    }
    assert.equal((await fetch(origin + "/api/auth/me", {
      headers: { ...staffCreateHeaders, [ROLE_PREVIEW_HEADER]: "operator" },
    })).status, 403);
    assert.equal((await fetch(origin + "/api/auth/me", { headers: { [ROLE_PREVIEW_HEADER]: "admin" } })).status, 401);
    const assignedEvents = await fetch(origin + "/api/events", { headers: previewHeaders });
    assert.deepEqual((await assignedEvents.json()).map(({ id }: { id: string }) => id), [event.id]);
    assert.equal((await fetch(origin + "/api/auth/users", { headers: previewHeaders })).status, 403);
    assert.equal((await fetch(origin + "/api/auth/users", {
      headers: { ...previewHeaders, [ROLE_PREVIEW_HEADER]: "admin" },
    })).status, 200);
    assert.equal((await patchProfile({ display_name: "Changed in preview" }, previewHeaders)).status, 403);
    assert.equal((await db.getUserById(owner.id))?.display_name, "Fixture owner");
    const originalSession = await fetch(origin + "/api/auth/me", { headers: ownerHeaders });
    assert.equal((await originalSession.json()).user.role, "owner");
    const profilePayload = { display_name: "  ผู้ดูแลทีม  ", id: "another-user", username: "changed", role: "owner" };
    assert.equal((await patchProfile(profilePayload, { "Content-Type": "application/json" })).status, 401);
    assert.equal((await patchProfile(profilePayload, { ...staffCreateHeaders, "x-csrf-token": "wrong" })).status, 403);
    assert.equal((await patchProfile({ display_name: " " }, staffCreateHeaders)).status, 400);
    const profileResponse = await patchProfile(profilePayload, staffCreateHeaders);
    assert.equal(profileResponse.status, 200, await profileResponse.clone().text());
    const { user: profile } = await profileResponse.json();
    assert.equal(profile.id, reviewer.id);
    assert.equal(profile.display_name, "ผู้ดูแลทีม");
    assert.equal(profile.username, reviewer.username);
    assert.equal(profile.role, "admin");
    assert.equal((await db.getUserById(reviewer.id))?.display_name, "ผู้ดูแลทีม");
    const freeCreated = await fetch(origin + "/api/events", {
      method: "POST", headers: staffCreateHeaders,
      body: JSON.stringify({ name:"Web only internal session", registration_mode:"free",
        web_page_enabled:true,open_registration_now:true }),
    });
    assert.equal(freeCreated.status, 201, await freeCreated.clone().text());
    const freeEvent = await freeCreated.json();
    assert.equal((await fetch(origin + "/api/settings?event_id=" + event.id, { headers: previewHeaders })).status, 200);
    assert.equal((await fetch(origin + "/api/settings?event_id=" + freeEvent.id, { headers: previewHeaders })).status, 403);
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
    const recoveryBookingInput = { pricing_version: Number(newExternalSettings?.version),
      contact: { name: "Returning attendee" },
      attendees: [{ category_id: "general", first_name: "Return", last_name: "Guest" }] };
    const recoveryCreate = await fetch(recoveryPrefix, {
      method: "POST",
      headers: { ...headers("test-owner"), "Content-Type": "application/json",
        "x-csrf-token": "fixture-csrf", "Idempotency-Key": "return-1" },
      body: JSON.stringify(recoveryBookingInput),
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
      body: JSON.stringify({ ...recoveryBookingInput,
        attendees: [{ ...recoveryBookingInput.attendees[0], first_name: "Additional" }],
      }),
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
        "x-claimed-transfer-at": "2023-11-23T00:32:00.000Z", "x-payment-method": "bank_transfer",
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
        version: externalReceipt.version, reason: "Verified transfer against bank records" }),
    });
    assert.equal(approvedExternalSlip.status, 200, await approvedExternalSlip.clone().text());
    assert.equal((await approvedExternalSlip.json()).status, "confirmed");
    const submittedAt = Number(externalReviews[0].created_ms);
    const quickApprovalRows = await db.listDailyPaidTransfers(paidEvent.id, "org_default", submittedAt, submittedAt + 1);
    const quickApproval = quickApprovalRows.find(row => row.attempt_id === externalReceipt.attempt_id);
    assert.equal(quickApproval?.status, "verified");
    assert.equal(Number(quickApproval?.amount_minor), 250000);
    assert.equal(quickApproval?.transfer_ms, null);
    const externalConfirmed = await fetch(externalOwnedPath, { headers: headers("test-owner") });
    const externalConfirmedDetail = await externalConfirmed.json();
    assert.equal(externalConfirmedDetail.status, "confirmed");
    const phoneManageUrl = externalPrefix + "/bookings/" + externalSlipBooking.id + "/manage";
    const attendeePhoneChange = { action: "set_attendee_phone", reason: "Update attendee contact",
      version: externalConfirmedDetail.version, attendee_id: externalConfirmedDetail.attendees[0].id, attendee_phone: "+66 81 234 5678" };
    const phoneManage = (body: object, key: string) => fetch(phoneManageUrl, {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": key }, body: JSON.stringify(body),
    });
    assert.equal((await phoneManage({ ...attendeePhoneChange, attendee_phone: "not a phone" }, "invalid-attendee-phone")).status, 400);
    assert.equal((await phoneManage(attendeePhoneChange, "set-attendee-phone")).status, 200);
    const phoneUpdated = await (await fetch(externalOwnedPath, { headers: headers("test-owner") })).json();
    assert.equal(phoneUpdated.attendees[0].phone, "+66 81 234 5678");
    assert.equal(phoneUpdated.registrant_phone, externalConfirmedDetail.registrant_phone);
    assert.equal(phoneUpdated.total_due_minor, externalConfirmedDetail.total_due_minor);
    assert.equal(phoneUpdated.status, "confirmed");
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
    const groupInput = (names: string[]) => JSON.stringify({
      pricing_version: 1, contact: { name: "Test Customer" },
      attendees: names.map((name, index) => ({ category_id: "adult", first_name: name, last_name: "Guest",
        ...(index === 0 && { phone: "0812345678" }) })),
    });
    const create = (key: string, csrf = "fixture-csrf", token = "test-owner", requestBody = groupInput(["One", "Two"])) => fetch(`${prefix}/paid-bookings`, {
      method: "POST", body: requestBody,
      headers: { ...headers(token), "Content-Type": "application/json", "Idempotency-Key": key, "x-csrf-token": csrf },
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
    const duplicate = await create("duplicate-attendees", "fixture-csrf", "test-other");
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { error: "attendee_already_registered" });
    const overflow = await create("overflow", "fixture-csrf", "test-owner", groupInput(["Three", "Four"]));
    assert.equal(overflow.status, 409);
    assert.equal((await overflow.json()).error, "capacity_exhausted");
    const ownedPath = `${origin}/api/customer/paid-bookings/${event.id}/${booking.id}`;
    assert.equal((await fetch(ownedPath, { headers: headers("test-other") })).status, 404);
    const owned = await fetch(ownedPath, { headers: headers("test-owner") });
    assert.equal(owned.status, 200);
    const attendees = (await owned.json()).attendees;
    assert.equal(attendees.length, 2);
    assert.equal(attendees[0].phone, "0812345678");
    assert.ok(!attendees[1].phone);
    const editAttendeePhone = (token: string, value: string) => fetch(ownedPath + "/preferences", {
      method: "PATCH", headers: { ...headers(token), "Content-Type": "application/json", "x-csrf-token": "fixture-csrf" },
      body: JSON.stringify({ key: "personal_phone", attendee_id: attendees[0].id, value }),
    });
    assert.equal((await editAttendeePhone("test-other", "0899999999")).status, 404);
    assert.equal((await editAttendeePhone("test-owner", "0899999999")).status, 204);
    assert.equal((await db.listPaidAttendeeRoster(event.id, "org_default")).find(row => row.attendee_id === attendees[0].id)?.attendee_phone, "0899999999");
    assert.equal((await editAttendeePhone("test-owner", "")).status, 204);
    const credentialPath = (attendeeId: string) => `${ownedPath}/attendees/${attendeeId}/credential`;
    assert.equal((await fetch(credentialPath(attendees[0].id), { headers: headers("test-owner") })).status, 404);
    const paymentQr = await fetch(`${ownedPath}/payment-qr`, { headers: headers("test-owner") });
    assert.equal(paymentQr.status, 200);
    assert.equal(paymentQr.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${ownedPath}/payment-qr`, { headers: headers("test-other") })).status, 404);
    const image = await sharp({ create: { width: 96, height: 144, channels: 3, background: "#dce8f5" } }).png().toBuffer();
    const disabledAnalysis = await fetch(`${ownedPath}/proof-analysis`, {
      method: "POST", body: Uint8Array.from(image),
      headers: { ...headers("test-owner"), "Content-Type": "application/octet-stream", "x-csrf-token": "fixture-csrf" },
    });
    assert.equal(disabledAnalysis.status, 404);
    const proof = (token: string, bytes: Buffer) => fetch(`${ownedPath}/proofs`, {
      method: "POST", body: Uint8Array.from(bytes),
      headers: {
        ...headers(token), "Content-Type": "application/octet-stream", "Idempotency-Key": "upload",
        "x-csrf-token": "fixture-csrf", "x-booking-version": "1", "x-claimed-minor": "50000",
        "x-claimed-transfer-at": new Date(0 + 1000).toISOString(), "x-payment-method": "promptpay",
        "x-claimed-payer-name": encodeURIComponent("สมใจ ทดสอบ"),
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
    const notificationPath=origin+"/api/events/"+event.id+"/admin-notifications/state";
    const notificationAudit=(await (await fetch(eventPrefix+"/summary?activity=1",{
      headers:staffHeaders,
    })).json()).summary.activity as Array<{id:string}>;
    assert.ok(notificationAudit.length);
    const notificationId=notificationAudit[0].id;
    assert.equal((await fetch(notificationPath)).status,401,"customer cannot see admin notification state");
    const initialNotification=await (await fetch(notificationPath,{headers:staffHeaders})).json();
    assert.deepEqual(initialNotification.state,{time:0,readIds:[],dismissedIds:[],unreadIds:[],deletedIds:[],imported:false});
    const notificationPost=async(body:Record<string,unknown>)=>fetch(notificationPath,{
      method:"POST",headers:{...staffHeaders,"Content-Type":"application/json"},
      body:JSON.stringify(body),
    });
    assert.equal((await notificationPost({action:"import",time:10,ids:[notificationId],
      archivedIds:[notificationId]})).status,200);
    const synchronized=(await (await fetch(notificationPath,{headers:staffHeaders})).json()).state;
    assert.deepEqual(synchronized.readIds,[notificationId]);
    assert.deepEqual(synchronized.dismissedIds,[notificationId]);
    assert.equal((await notificationPost({action:"restore",ids:[notificationId]})).status,200);
    assert.deepEqual((await (await fetch(notificationPath,{headers:staffHeaders})).json()).state.dismissedIds,[]);
    assert.equal((await notificationPost({action:"archive",ids:[notificationId]})).status,200);
    assert.deepEqual((await (await fetch(notificationPath,{headers:staffHeaders})).json()).state.dismissedIds,
      [notificationId],"a second browser GET sees the first browser's archive");
    assert.equal((await notificationPost({action:"restore_all"})).status,200);
    assert.equal((await notificationPost({action:"archive",ids:["foreign-id"]})).status,200);
    assert.deepEqual((await (await fetch(notificationPath,{headers:staffHeaders})).json()).state.dismissedIds,[]);
    assert.equal((await notificationPost({action:"import",time:999999999,ids:[],
      archivedIds:[notificationId]})).status,200);
    assert.deepEqual((await (await fetch(notificationPath,{headers:staffHeaders})).json()).state.readIds,
      [notificationId],"legacy migration can run only once");
    assert.equal((await notificationPost({action:"unknown"})).status,400);
    assert.equal((await notificationPost({action:"archive",ids:["x".repeat(200)]})).status,400);

    const selectedIds = notificationAudit.slice(0, 2).map((item) => item.id);
    const setNotificationAction = async (action: string, ids: string[] = selectedIds) => {
      const response = await notificationPost({ action, ids });
      assert.equal(response.status, 200);
      return (await response.json()).state;
    };
    await setNotificationAction("read_all");
    assert.deepEqual((await setNotificationAction("unread")).unreadIds.sort(), selectedIds.slice().sort());
    assert.deepEqual((await setNotificationAction("read", selectedIds.slice(0, 1))).unreadIds, selectedIds.slice(1));
    assert.deepEqual((await setNotificationAction("read_all")).unreadIds, []);
    await setNotificationAction("archive", [notificationId]);
    const trashed = await setNotificationAction("delete", [...selectedIds, "foreign-id"]);
    assert.deepEqual(trashed.deletedIds.sort(), selectedIds.slice().sort());
    assert.deepEqual(trashed.dismissedIds, [notificationId]);
    const recovered = await setNotificationAction("restore_deleted");
    assert.deepEqual(recovered.deletedIds, []);
    assert.deepEqual(recovered.dismissedIds, [notificationId]);
    await setNotificationAction("restore_all");

    const readinessResponse = await fetch(eventPrefix + "/readiness", { headers: staffHeaders });
    assert.equal(readinessResponse.status, 200);
    const readiness = await readinessResponse.json();
    assert.equal(readiness.paid_ready, true);
    assert.equal(readiness.checks.paid_published, true);
    assert.equal(readiness.checks.slip_encryption_ready, true);
    assert.equal(readiness.checks.event_chat_enabled, true);
    assert.equal((await fetch(eventPrefix + "/readiness", { headers: headers("test-owner") })).status, 401);
    const activityResponse = await fetch(eventPrefix + "/summary?activity=1", { headers: staffHeaders });
    assert.equal(activityResponse.status, 200);
    const { summary: activitySummary } = await activityResponse.json();
    assert.equal(activitySummary.pending_review_bookings, 1);
    const pageOneResponse=await fetch(eventPrefix+"/summary?activity=1&activity_limit=1&activity_offset=0",
      {headers:staffHeaders});
    assert.equal(pageOneResponse.status,200);
    const pageOne=(await pageOneResponse.json()).summary;
    assert.equal(pageOne.activity.length,1);
    assert.equal(pageOne.activity_has_more,true);
    assert.equal(pageOne.activity_next_offset,1);
    const pageTwoResponse=await fetch(eventPrefix+"/summary?activity=1&activity_limit=1&activity_offset=1",
      {headers:staffHeaders});
    assert.equal(pageTwoResponse.status,200);
    const pageTwo=(await pageTwoResponse.json()).summary;
    assert.equal(pageTwo.activity.length,1);
    assert.notEqual(pageOne.activity[0].id,pageTwo.activity[0].id);
    assert.equal((await fetch(eventPrefix+"/summary?activity=1&activity_offset=-1",
      {headers:staffHeaders})).status,400);

    const slipNotification = activitySummary.activity.find((item: { action: string }) => item.action === "submit_proof");
    assert.equal(slipNotification.booking_state, "verification_pending");
    assert.equal(Number(slipNotification.total_minor), 50000);
    assert.equal(Number(slipNotification.attendee_count), 2);
    assert.ok(slipNotification.first_name);
    assert.equal(activitySummary.pending_slip_minor, "50000");
    assert.equal(activitySummary.awaiting_payment_due_minor, "0");
    assert.equal(activitySummary.slip_shortfall_minor, "0");
    assert.equal(activitySummary.awaiting_payment_attendees, 0);
    assert.ok(activitySummary.activity.some((item: { action: string; reference: string }) =>
      item.action === "submit_proof" && item.reference === booking.reference));
    assert.ok(activitySummary.activity.some((item: { action: string; reference: string }) =>
      item.action === "create" && item.reference === booking.reference));
    const queue = await fetch(`${eventPrefix}/review-queue`, { headers: staffHeaders });
    assert.equal(queue.status, 200);
    const [queuedSlip] = (await queue.json()).reviews;
    assert.equal(queuedSlip.attempt_id, pending.attempt_id);
    assert.equal(queuedSlip.claimed_payer_name, "สมใจ ทดสอบ");
    const storedAnalysis = await fetch(staffUrl + "/analyze", { method: "POST", headers: staffHeaders });
    assert.equal(storedAnalysis.status, 404);
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
    const updatedFeedResponse=await fetch(eventPrefix+"/summary?activity=1",{headers:staffHeaders});
    assert.equal(updatedFeedResponse.status,200);
    const updatedFeed=(await updatedFeedResponse.json()).summary.activity as Array<{action:string;reference:string}>;
    assert.equal(updatedFeed.filter(item=>item.action==="review_verified"&&item.reference===booking.reference).length,1,
      "approval creates exactly one notification-worthy audit record");
    assert.deepEqual(await (await approve("0812345678")).json(), confirmed);
    assert.equal((await fetchConfirmed())[0].id, booking.id);
    const reportStart = Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" })
      .format(new Date(verifiedTransferAt)) + "T00:00:00+07:00");
    const reportRows = await db.listDailyPaidTransfers(event.id, "org_default", reportStart, reportStart + 86_400_000);
    assert.equal(reportRows.length, 1);
    assert.equal(reportRows[0].attempt_id, pending.attempt_id);
    assert.equal(reportRows[0].status, "verified");
    assert.deepEqual(reportRows[0].attendee_names, ["One Guest", "Two Guest"]);
    assert.equal(Number(reportRows[0].amount_minor), 50000);
    await assert.rejects(db.listDailyPaidTransfers(event.id, "other-org", reportStart, reportStart + 86_400_000), /event_not_found/);
    const reportPath = eventPrefix + "/daily-transfer-report";
    assert.equal((await fetch(reportPath + "?date=2026-02-30", { headers: staffHeaders })).status, 400);
    assert.equal((await fetch(reportPath + "?date=2026-11-18", { headers: headers("test-owner") })).status, 401);
    for (const query of ["from=2026-11-19&to=2026-11-18", "from=2026-11-18", "all=1&date=2026-11-18"]) {
      assert.equal((await fetch(reportPath + "?" + query, { headers: staffHeaders })).status, 400);
    }
    if (process.env.FACEBOT_TEST_REPORT_PDF) {
      const reportDate = new Date(reportStart + 7 * 3_600_000).toISOString().slice(0, 10);
      const result = await fetch(reportPath + "?date=" + reportDate, { headers: staffHeaders });
      assert.equal(result.status, 200, await result.clone().text().then((text) => text.slice(0, 100)));
      const pdf = Buffer.from(await result.arrayBuffer());
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      writeFileSync(process.env.FACEBOT_TEST_REPORT_PDF, pdf);
      for (const [query, filename] of [
        [`from=${reportDate}&to=${reportDate}`, `transfers-${reportDate}.pdf`],
        ["all=1", "transfers-all.pdf"],
      ]) {
        const exportResponse = await fetch(reportPath + "?" + query, { headers: staffHeaders });
        assert.equal(exportResponse.status, 200);
        assert.ok(exportResponse.headers.get("content-disposition")?.includes(filename));
        assert.equal(Buffer.from(await exportResponse.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
      }

    }
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
    const roomsPath = `${eventPrefix}/rooms`;
    const firstRoomPlan = await fetch(roomsPath, { headers: staffHeaders });
    assert.equal(firstRoomPlan.status, 200);
    const { plan: draftPlan } = await firstRoomPlan.json() as { plan: PaidRoomingPlan };
    assert.equal(draftPlan.version, 0);
    assert.ok(draftPlan.guests.length > 0);
    assert.ok(draftPlan.guests.every((guest) => !("customer_email" in guest)));
    const lockedGuest = draftPlan.guests.find(guest => guest.bookingId === manualBooking.id);
    assert.ok(lockedGuest);
    const roomFixture = { id: "room-one", locked: true, number: "", slots: [lockedGuest.id, null] };
    const saveRooms = (version: number, rooms: unknown[]) => fetch(roomsPath, {
      method: "PUT", headers: staffCreateHeaders, body: JSON.stringify({ version, rooms }),
    });
    assert.equal((await saveRooms(0, [{ ...roomFixture, slots: [lockedGuest.id, lockedGuest.id] }])).status, 400);
    assert.equal((await saveRooms(0, [{ ...roomFixture, slots: ["not-an-attendee", null] }])).status, 409);
    assert.equal((await saveRooms(0, [roomFixture])).status, 200);
    assert.equal((await saveRooms(0, [])).status, 409);
    assert.equal((await saveRooms(1, [{ ...roomFixture, slots: [null, lockedGuest.id] }])).status, 409);
    assert.equal((await saveRooms(1, [{ ...roomFixture, number: "301" }])).status, 200);
    const persistedPlan = (await (await fetch(roomsPath, { headers: staffHeaders })).json()).plan;
    assert.equal(persistedPlan.rooms[0].number, "301");
    assert.equal(persistedPlan.rooms[0].slots[0], lockedGuest.id);

    // The same browser can be signed into the staff workspace and the attendee portal.
    const dualSessionHeaders = {
      Cookie: "fbs_session=test-reviewer; fbs_customer_session=test-owner; fbs_customer_csrf=fixture-csrf",
      Origin: origin,
      "Content-Type": "application/json",
    };
    const pair = draftPlan.guests.filter(guest => guest.bookingId === booking.id)
      .map(guest => ({ ...guest, accommodation: "yes" as const }));
    const drafted = draftRoomingPlan([], pair, randomUUID);
    assert.equal(drafted.length, 1);
    const newRoom = { id: randomUUID(), number: "", locked: false, slots: Array(5).fill(null) };
    const updatedRooms = moveRoomingGuest([...drafted, newRoom], pair[0].id, { roomId: newRoom.id, slot: 4 });
    const mixedPlan = { version: persistedPlan.version, rooms: [persistedPlan.rooms[0], ...updatedRooms] };
    const saveMixedPlan = (headers: Record<string, string>) => fetch(roomsPath, {
      method: "PUT", headers, body: JSON.stringify(mixedPlan),
    });
    const rejected = await saveMixedPlan(dualSessionHeaders);
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).error, "CSRF token validation failed");
    const staffCookie = rejected.headers.getSetCookie().find(cookie => cookie.startsWith("fbs_csrf="))?.split(";")[0];
    assert.ok(staffCookie, "the staff write must refresh its own CSRF token even with a customer session");
    const retried = await saveMixedPlan({
      ...dualSessionHeaders,
      Cookie: dualSessionHeaders.Cookie + "; " + staffCookie,
      "x-csrf-token": staffCookie.slice("fbs_csrf=".length),
    });
    assert.equal(retried.status, 200, await retried.clone().text());
    assert.deepEqual((await (await fetch(roomsPath, { headers: staffHeaders })).json()).plan.rooms, mixedPlan.rooms);

    const carpoolPath = `${eventPrefix}/carpool`;
    const initialCarpool = await fetch(carpoolPath, { headers: staffHeaders });
    assert.equal(initialCarpool.status, 200);
    const { plan: carpool } = await initialCarpool.json();
    assert.equal(carpool.version, 0);
    const [{ id: driverId }, { id: passengerId }, { id: otherId }] = carpool.attendees;
    const roles = { [driverId]: "driver", [passengerId]: "passenger", [otherId]: "driver" };
    const car = { driverId, seats: 1, pickup: "Bangkok", passengers: [passengerId] };
    const saveCarpool = (cars: unknown[], version = 0) => fetch(carpoolPath, {
      method: "PUT", headers: staffCreateHeaders, body: JSON.stringify({ version, roles, cars }),
    });
    assert.equal((await saveCarpool([{ ...car, seats: 0 }])).status, 400);
    assert.equal((await saveCarpool([car, { ...car, driverId: otherId }])).status, 400);
    assert.equal((await saveCarpool([{ ...car, passengers: ["another-event"] }])).status, 409);
    assert.equal((await saveCarpool([car])).status, 200);
    assert.equal((await saveCarpool([car])).status, 409);
    const { plan: persistedCarpool } = await (await fetch(carpoolPath, { headers: staffHeaders })).json();
    assert.deepEqual(persistedCarpool.cars, [car]);
    const movedCar = { ...car, driverId: otherId };
    assert.equal((await saveCarpool([{ ...car, passengers: [] }, movedCar], 1)).status, 200);

    const staffSession = async (role: "owner" | "operator" | "checker" | "cashier" | "viewer" | "logistics", eventIds: string[] = []) => {
      const username = `paid-access-${role}-${eventIds.length}`;
      const user = await db.createUser({ username, display_name: username, password_hash: "fixture", role, assigned_event_ids: eventIds });
      await db.createSession(user.id, hashSessionToken(username), new Date(Date.now() + 60_000));
      return { Cookie: `fbs_session=${username}` };
    };
    const ownerAccess = await staffSession("owner");
    const operatorAccess = await staffSession("operator", [event.id]);
    const checkerAccess = await staffSession("checker", [event.id]);
    const unassignedChecker = await staffSession("checker");
    const cashierAccess = await staffSession("cashier", [event.id]);
    const viewerAccess = await staffSession("viewer", [event.id]);
    assert.equal((await fetch(roomsPath, { headers: ownerAccess })).status, 200);
    assert.equal((await fetch(roomsPath, { headers: operatorAccess })).status, 403);
    assert.equal((await fetch(carpoolPath, { headers: ownerAccess })).status, 200);
    assert.equal((await fetch(carpoolPath, { headers: operatorAccess })).status, 403);
    assert.equal((await fetch(carpoolPath, { headers: headers("test-owner") })).status, 401);
    const logisticsAccess = await staffSession("logistics", [event.id]);
    const unassignedLogistics = await staffSession("logistics");
    const logisticsWrite = { ...staffCreateHeaders, Cookie: logisticsAccess.Cookie + "; fbs_csrf=staff-csrf" };
    const logisticsPreview = { ...previewHeaders, [ROLE_PREVIEW_HEADER]: "logistics" };
    const logisticsEvents = await fetch(origin + "/api/events", { headers: logisticsAccess });
    assert.equal(logisticsEvents.status, 200);
    assert.deepEqual((await logisticsEvents.json()).map(({ id }: { id: string }) => id), [event.id]);
    for (const [path, format] of [[roomsPath, "rooms"], [carpoolPath, "carpool"]] as const) {
      const response = await fetch(path, { headers: logisticsAccess });
      assert.equal(response.status, 200, await response.clone().text());
      const plan = (await response.json()).plan;
      const body = JSON.stringify(format === "rooms"
        ? { version: plan.version, rooms: plan.rooms }
        : { version: plan.version, roles: plan.roles, cars: plan.cars });
      const write = { method: "PUT", headers: logisticsWrite, body };
      const savedPlan = await fetch(path, write);
      assert.equal(savedPlan.status, 200, await savedPlan.clone().text());
      assert.equal((await savedPlan.json()).plan.version, plan.version + 1);
      assert.equal((await fetch(path, { headers: logisticsPreview })).status, 200);
      assert.equal((await fetch(path, { ...write, headers: logisticsPreview })).status, 403);
      assert.equal((await fetch(path, { headers: unassignedLogistics })).status, 403);
      assert.equal((await fetch(path.replace(event.id, paidEvent.id), write)).status, 403);
      for (const access of [operatorAccess, unassignedLogistics]) {
        assert.equal((await fetch(path + "/report?language=th", { headers: access })).status, 403);
      }
      if (process.env.FACEBOT_TEST_LOGISTICS_PDF === "1") {
        const report = await fetch(path + "/report?language=th", { headers: logisticsAccess });
        assert.equal(report.status, 200, (await report.clone().text()).slice(0, 200));
        assert.match(report.headers.get("content-type") ?? "", /application\/pdf/);
        assert.equal(Buffer.from(await report.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
      }
    }
    for (const path of [
      `${eventPrefix}/attendees`, `${eventPrefix}/review-queue`,
      `${origin}/api/settings?event_id=${event.id}`, `${origin}/api/registrations/export?event_id=${event.id}`,
      `${origin}/api/auth/users`,
    ]) {
      assert.equal((await fetch(path, { headers: logisticsAccess })).status, 403, path);
    }
    for (const access of [ownerAccess, operatorAccess]) {
      const paidRoster = await fetch(`${eventPrefix}/attendees`, { headers: access });
      assert.equal(paidRoster.status, 200, await paidRoster.clone().text());
      assert.deepEqual(await paidRoster.json(), attendeeRoster);
    }
    const checkerRosterResponse = await fetch(`${eventPrefix}/attendees`, { headers: checkerAccess });
    assert.equal(checkerRosterResponse.status, 200);
    const checkerRoster = await checkerRosterResponse.json();
    assert.equal(checkerRoster.attendees.length, attendeeRoster.attendees.length);
    assert.deepEqual(Object.keys(checkerRoster.attendees[0]).sort(), [
      "attendee_id", "booking_id", "booking_state", "category_label", "checked_in_ms", "event_id", "first_name", "last_name",
    ]);
    assert.equal(checkerRoster.summary.confirmed_bookings, attendeeRoster.summary.confirmed_bookings);
    assert.ok(Object.keys(checkerRoster.summary).every(key => !key.endsWith("_minor")));
    const checkerSummaryOnly = await fetch(`${eventPrefix}/attendees?summary_only=1`, { headers: checkerAccess });
    assert.deepEqual(await checkerSummaryOnly.json(), { attendees: [], summary: checkerRoster.summary });
    for (const access of [unassignedChecker, cashierAccess, viewerAccess]) {
      assert.equal((await fetch(`${eventPrefix}/attendees`, { headers: access })).status, 403);
    }
    for (const suffix of ["settings", "readiness", "coupons", "summary?activity=1", "review-queue"]) {
      assert.equal((await fetch(`${eventPrefix}/${suffix}`, { headers: ownerAccess })).status, 200, `Owner: ${suffix}`);
      assert.equal((await fetch(`${eventPrefix}/${suffix}`, { headers: staffHeaders })).status, 200, `Admin: ${suffix}`);
      assert.equal((await fetch(`${eventPrefix}/${suffix}`, { headers: checkerAccess })).status, 403, `Gatekeeper: ${suffix}`);
    }
    assert.equal((await fetch(notificationPath, { headers: ownerAccess })).status, 200);
    assert.equal((await fetch(notificationPath, { headers: checkerAccess })).status, 403);
    const checkerCsv = await fetch(`${origin}/api/registrations/export?event_id=${event.id}`, { headers: checkerAccess });
    assert.equal(checkerCsv.status, 200);
    const checkerCsvText = await checkerCsv.text();
    assert.equal(checkerCsvText.split(/\r?\n/)[0], '"id","first_name","last_name","status","category"');
    assert.match(checkerCsvText, /"One","Guest","checked-in"/);

    const operatorFeed = await fetch(`${eventPrefix}/summary?activity=1`, { headers: operatorAccess });
    assert.equal(operatorFeed.status, 200);
    assert.ok((await operatorFeed.json()).summary.activity.some((entry: { id: string }) => entry.id === notificationId));
    const otherNotificationPath = `${origin}/api/events/${paidEvent.id}/admin-notifications/state`;
    assert.equal((await fetch(`${externalPrefix}/summary?activity=1`, { headers: operatorAccess })).status, 403);
    assert.equal((await fetch(otherNotificationPath, { headers: operatorAccess })).status, 403);
    const updateOperatorNotifications = (path: string) => fetch(path, {
      method: "POST",
      headers: { Cookie: `${operatorAccess.Cookie}; fbs_csrf=operator-csrf`, Origin: origin,
        "x-csrf-token": "operator-csrf", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive", ids: [notificationId] }),
    });
    assert.equal((await updateOperatorNotifications(otherNotificationPath)).status, 403);
    const operatorState = await fetch(notificationPath, { headers: operatorAccess });
    assert.equal(operatorState.status, 200);
    assert.deepEqual((await operatorState.json()).state.dismissedIds, []);
    const adminBefore = (await (await fetch(notificationPath, { headers: staffHeaders })).json()).state;
    const operatorArchive = await updateOperatorNotifications(notificationPath);
    assert.equal(operatorArchive.status, 200);
    assert.deepEqual((await operatorArchive.json()).state.dismissedIds, [notificationId]);
    assert.deepEqual((await (await fetch(notificationPath, { headers: operatorAccess })).json()).state.dismissedIds, [notificationId]);
    assert.deepEqual((await (await fetch(notificationPath, { headers: staffHeaders })).json()).state, adminBefore);
    assert.equal((await fetch(`${eventPrefix}/review-queue`, { headers: operatorAccess })).status, 403);

    const legacyRosterEvent=await db.createEvent({
      name:"Free Legacy Registration Event",organizer_id:"org_default",
    });
    const legacyFixture=new Database(database);
    legacyFixture.prepare("INSERT INTO registrations (id,event_id,first_name,last_name,status) VALUES (?,?,?,?,?)")
      .run("REG-LEGACY-EXPORT",legacyRosterEvent.id,"Legacy","Guest","checked-in");
    legacyFixture.close();
    const reportFor = (eventId: string) => fetch(
      `${origin}/api/reports/summary?event_id=${eventId}`, { headers: staffHeaders },
    );
    const paidReportResponse = await reportFor(event.id);
    assert.equal(paidReportResponse.status, 200, await paidReportResponse.clone().text());
    const paidReport = await paidReportResponse.json();
    assert.equal(paidReport.registrations.total, 0);
    assert.equal(paidReport.paid_registration.confirmed_attendees, summary.confirmed_attendees);
    assert.equal(paidReport.paid_registration.checked_in_attendees, 1);
    assert.equal(paidReport.paid_registration.accepted_minor, summary.accepted_minor);
    assert.equal(paidReport.paid_registration.by_day.reduce((sum: number, day: { registrations: number }) => sum + day.registrations, 0), 5);
    assert.equal(paidReport.paid_registration.by_day.reduce((sum: number, day: { checked_in: number }) => sum + day.checked_in, 0), 1);
    assert.equal(paidReport.direct_tickets.total, 0);

    const performance = await db.upsertDirectPerformance({ event_id: legacyRosterEvent.id, code: "R1", title: "Round 1", starts_at: "2026-11-20T18:00:00+07:00" });
    const [seat] = await db.importDirectSeats(legacyRosterEvent.id, performance.id, [
      { zone: "A", row_label: "1", seat_label: "01" },
    ]);
    const direct = await db.createDirectTicket({
      event_id: legacyRosterEvent.id, performance_id: performance.id, seat_id: seat.id,
      ticket_class: "General", holder_name: "Direct Ticket Guest", payment_required: false,
    });
    assert.ok(direct.ticket);
    const freeReportResponse = await reportFor(legacyRosterEvent.id);
    assert.equal(freeReportResponse.status, 200, await freeReportResponse.clone().text());
    const freeReport = await freeReportResponse.json();
    assert.equal(freeReport.paid_registration, null);
    assert.equal(freeReport.registrations.total, 1);
    assert.equal(freeReport.registrations.active, 1);
    assert.equal(freeReport.registrations.check_in_rate, 100);
    assert.equal(freeReport.direct_tickets.total, 1);
    assert.equal(freeReport.direct_tickets.seats.issued, 1);
    assert.equal(freeReport.direct_tickets.by_performance[0].issued, 1);
    const directExport = await fetch(
      `${origin}/api/direct-ticketing/tickets/export?event_id=${legacyRosterEvent.id}`, { headers: staffHeaders },
    );
    assert.equal(directExport.status, 200);
    assert.match(await directExport.text(), /Direct Ticket Guest/);
    const gateStaff = await staffSession("checker", [event.id, legacyRosterEvent.id]);
    const directCheckin = await fetch(origin + "/api/direct-ticketing/tickets/" + direct.ticket.id + "/checkin", {
      method: "POST",
      headers: { ...staffCreateHeaders, Cookie: gateStaff.Cookie + "; fbs_csrf=staff-csrf" },
      body: JSON.stringify({ event_id: legacyRosterEvent.id, qr_value: "DIRECT-ADMIN:" + direct.ticket.id }),
    });
    assert.equal(directCheckin.status, 200, await directCheckin.clone().text());
    const gateTicket = (await directCheckin.json()).ticket;
    assert.equal(gateTicket.holder_name, "Direct Ticket Guest");
    assert.equal(gateTicket.status, "checked_in");
    assert.equal(gateTicket.seat_label, "01");
    for (const field of ["price_amount", "payment_status", "payment_reference", "email", "phone", "delivery"]) {
      assert.ok(!Object.hasOwn(gateTicket, field), `Gate ticket must not include ${field}`);
    }

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

    const teamCsvUrl = `${origin}/api/registrations/export?event_id=${event.id}&language=en&roster=`;
    const teamCsv = await fetch(teamCsvUrl + "active", { headers: operatorAccess });
    assert.equal(teamCsv.status, 200, await teamCsv.clone().text());
    assert.match(teamCsv.headers.get("content-disposition") ?? "", /-active\.csv/);
    assert.equal(teamCsv.headers.get("cache-control"), "private, no-store");
    const teamText = await teamCsv.text();
    assert.match(teamText, /"One","Guest","Checked in","Adult","250\.00","","","test-owner@example\.com"/);
    assert.match(teamText, /"Awaiting payment"/);
    assert.doesNotMatch(teamText, /booking_reference|customer_id|Expired|Cancelled/);
    const confirmedCsv = await fetch(teamCsvUrl + "confirmed", { headers: staffHeaders });
    assert.equal(confirmedCsv.status, 200);
    assert.doesNotMatch(await confirmedCsv.text(), /"Awaiting payment"/);
    const pendingCsv = await fetch(teamCsvUrl + "pending", { headers: staffHeaders });
    assert.equal(pendingCsv.status, 200);
    assert.doesNotMatch(await pendingCsv.text(), /"Confirmed"|"Checked in"/);
    assert.equal((await fetch(teamCsvUrl + "active", { headers: checkerAccess })).status, 403);
    assert.equal((await fetch(teamCsvUrl + "unknown", { headers: staffHeaders })).status, 400);

    assert.equal(summary.confirmed_bookings, 2);
    assert.equal(summary.confirmed_attendees, 3);
    assert.equal(summary.checked_in_attendees, 1);
    assert.equal(summary.held_attendees, 2);
    assert.equal(summary.available_attendees, 0);
    assert.equal(summary.accepted_minor, "75000");
    assert.equal(summary.unsettled_due_minor, "50000");
    assert.equal(summary.awaiting_payment_due_minor, "50000");
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
    const reportRoster = await db.listPaidAttendeeRoster(newExternalEvent.id, "org_default", 10001, true);
    const couponReportRow = reportRoster.find(row => row.booking_id === freeBooking.id);
    assert.equal(couponReportRow?.coupon_code, "TESTFREE");
    assert.equal(Number(couponReportRow?.coupon_discount_minor), 65000);
    assert.equal(Number(couponReportRow?.verified_cash_minor), 0);
    const regularRoster = await db.listPaidAttendeeRoster(newExternalEvent.id, "org_default");
    assert.ok(regularRoster.every(row => !Object.hasOwn(row, "coupon_code")));
    const registrationReport = origin + "/api/registrations/report?event_id=" + newExternalEvent.id + "&language=th";
    assert.equal((await fetch(registrationReport + "&kind=bad", { headers: staffCreateHeaders })).status, 400);
    assert.equal((await fetch(registrationReport + "&kind=coupons", { headers: headers("test-owner") })).status, 401);
    if (process.env.FACEBOT_TEST_REPORT_PDF) {
      for (const kind of ["accounting", "coupons", "followup", "attendees"]) {
        const response = await fetch(registrationReport + "&kind=" + kind, { headers: staffCreateHeaders });
        assert.equal(response.status, 200, await response.clone().text().then(body => body.slice(0, 150)));
        assert.match(response.headers.get("content-disposition") ?? "", new RegExp(`registrations-${kind}\\.pdf`));
        assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
      }
    }
    const ticket=await fetch(ownerFreeUrl+"/attendees/"+freeDetails.attendees[0].id+
      "/credential",{headers:headers("test-owner")});
    assert.equal(ticket.status,200);
    const freeEmailQueue=await db.listNotificationDeliveries({
      related_type:"paid_booking",related_id:freeBooking.id});
    assert.ok(freeEmailQueue.some(row=>row.kind==="paid_booking.confirmed"));
    const overLimit=await fetch(couponPage+"/paid-bookings",{
      method:"POST",headers:{...headers("test-owner"),"Content-Type":"application/json",
        "x-csrf-token":"fixture-csrf","Idempotency-Key":"coupon-free-http-2"},
      body:JSON.stringify({...couponPayload,contact:{name:"Coupon Test"},
        attendees:[{...couponPayload.attendees[0],first_name:"Another Coupon"}]}),
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
    const couponBookingAdmin = origin + "/api/events/" + newExternalEvent.id + "/paid-registration/bookings";
    const saveStaffCoupon = async (code: string, kind: "percent" | "free", value: number) => {
      const response = await fetch(couponAdminPath, { method: "PUT", headers: staffCreateHeaders,
        body: JSON.stringify({ ...couponRule, code, kind, value_minor: value }) });
      assert.equal(response.status, 200, await response.clone().text());
    };
    await saveStaffCoupon("STAFF20", "percent", 2000);
    await saveStaffCoupon("INVITED", "free", 0);
    const bookAtFullPrice = async (lastName: string) => {
      const response = await fetch(couponPage + "/paid-bookings", {
        method: "POST", headers: { ...headers("test-owner"), "Content-Type": "application/json",
          "x-csrf-token": "fixture-csrf", "Idempotency-Key": "admin-coupon-booking-" + lastName },
        body: JSON.stringify({ pricing_version: couponPayload.pricing_version, contact: { name: "Coupon Test" },
          attendees: [{ category_id: "general", first_name: "Staff Coupon", last_name: lastName }] }),
      });
      assert.equal(response.status, 201, await response.clone().text());
      return response.json();
    };
    const applyStaffCoupon = (id: string, code: string, version: number, key: string, requestHeaders = staffCreateHeaders) =>
      fetch(couponBookingAdmin + "/" + id + "/manage", {
        method: "POST", headers: { ...requestHeaders, "Idempotency-Key": key },
        body: JSON.stringify({ action: "apply_coupon", coupon_code: code, version, reason: "Organizer discount" }),
      });
    const regularBooking = await bookAtFullPrice("Regular");
    const invitedBooking = await bookAtFullPrice("Invited");
    assert.equal(regularBooking.total_due_minor, 65000);
    const regularLookup = await (await fetch(couponBookingAdmin + "/by-reference/" + regularBooking.reference,
      { headers: staffHeaders })).json();
    assert.equal(regularLookup.booking.can_apply_coupon, true);
    assert.equal((await applyStaffCoupon(regularBooking.id, "STAFF20", regularBooking.version, "customer-coupon-denied",
      { ...headers("test-owner"), "Content-Type": "application/json", "x-csrf-token": "fixture-csrf" })).status, 401);
    const applyDiscount = await applyStaffCoupon(regularBooking.id, " staff20 ", regularBooking.version, "staff-discount");
    assert.equal(applyDiscount.status, 200, await applyDiscount.clone().text());
    const discountReceipt = await applyDiscount.json();
    assert.equal(discountReceipt.total_minor, 52000);
    assert.equal(discountReceipt.status, "awaiting_payment");
    assert.deepEqual(await (await applyStaffCoupon(regularBooking.id, "STAFF20", regularBooking.version, "staff-discount")).json(),
      discountReceipt);
    const stackCoupon = await applyStaffCoupon(regularBooking.id, "INVITED", discountReceipt.version, "no-coupon-stacking");
    assert.equal(stackCoupon.status, 409);
    assert.equal((await stackCoupon.json()).error, "coupon_already_applied");
    const couponLimit = await applyStaffCoupon(invitedBooking.id, "STAFF20", invitedBooking.version, "staff-coupon-limit");
    assert.equal(couponLimit.status, 409);
    assert.equal((await couponLimit.json()).error, "coupon_exhausted");
    const applyInvite = await applyStaffCoupon(invitedBooking.id, "INVITED", invitedBooking.version, "staff-invite");
    assert.equal(applyInvite.status, 200, await applyInvite.clone().text());
    assert.equal((await applyInvite.json()).status, "confirmed");
    const appliedInviteUrl = origin + "/api/customer/paid-bookings/" + newExternalEvent.id + "/" + invitedBooking.id;
    const invitedDetail = await (await fetch(appliedInviteUrl, { headers: headers("test-owner") })).json();
    assert.equal(invitedDetail.total_due_minor, 0);
    assert.deepEqual(invitedDetail.coupon, { code: "INVITED", subtotal_minor: 65000, discount_minor: 65000 });
    assert.equal((await fetch(appliedInviteUrl + "/attendees/" + invitedDetail.attendees[0].id + "/credential",
      { headers: headers("test-owner") })).status, 200);
    const inviteDeliveries = await db.listNotificationDeliveries({ related_type: "paid_booking", related_id: invitedBooking.id });
    assert.equal(inviteDeliveries.filter(row => row.kind === "paid_booking.confirmed").length, 1);
    const alreadyPaid = await applyStaffCoupon(invitedBooking.id, "STAFF20", invitedDetail.version, "staff-coupon-paid");
    assert.equal(alreadyPaid.status, 409);
    assert.equal((await alreadyPaid.json()).error, "state_conflict");
    const preferencesFixture = new Database(database);
    try {
      preferencesFixture.prepare(`INSERT INTO paid_event_forms (event_id,fields_json) VALUES (?,?)
        ON CONFLICT(event_id) DO UPDATE SET fields_json=excluded.fields_json`).run(newExternalEvent.id, JSON.stringify([
        { key: "transport", scope: "booking", required: true, options: ["Shuttle", "Self-arranged"] },
        { key: "food", scope: "attendee", required: true, options: ["มังสวิรัติ", "Regular"] },
        { key: "arrival", scope: "attendee", required: false },
        { key: "room_preference", scope: "attendee", required: true, options: ["Shared", "Single"],
          surcharge: { option: "Single", minor: 130000 } },
      ]));
    } finally {
      preferencesFixture.close();
    }
    const updatePreference = (token: string, input: object, csrf = "fixture-csrf") =>
      fetch(ownerFreeUrl + "/preferences", { method: "PATCH", body: JSON.stringify(input),
        headers: { ...headers(token), "Content-Type": "application/json", "x-csrf-token": csrf } });
    const transport = { key: "transport", value: "Shuttle" };
    const food = { key: "food", attendee_id: freeDetails.attendees[0].id, value: "มังสวิรัติ" };
    assert.equal((await updatePreference("test-owner", transport, "wrong")).status, 403);
    assert.equal((await updatePreference("test-other", transport)).status, 404);
    assert.equal((await updatePreference("test-owner", { ...food, value: "Invalid" })).status, 409);
    assert.equal((await updatePreference("test-owner", transport)).status, 204);
    assert.equal((await updatePreference("test-owner", food)).status, 204);
    const arrival = { ...food, key: "arrival", value: "2026-12-03" };
    assert.equal((await updatePreference("test-owner", arrival)).status, 204);
    assert.equal((await updatePreference("test-owner", { ...food, key: "accommodation", value: "no" })).status, 400);
    const updatedPreferences = await (await fetch(ownerFreeUrl, { headers: headers("test-owner") })).json();
    assert.equal(updatedPreferences.preference_answers.transport, "Shuttle");
    assert.equal(updatedPreferences.attendees[0].preference_answers.food, "มังสวิรัติ");
    assert.equal(updatedPreferences.status, "confirmed");
    assert.equal(updatedPreferences.total_due_minor, freeDetails.total_due_minor);
    assert.deepEqual(updatedPreferences.coupon, freeDetails.coupon);
    assert.equal(updatedPreferences.attendees[0].registration_answers.find(({ key }: { key: string }) => key === "arrival").value, arrival.value);
    assert.equal(updatedPreferences.attendees[0].room_is_default, true);
    assert.equal(updatedPreferences.attendees[0].registration_answers.find(({ key }: { key: string }) => key === "room_preference").value, "Shared");
    const room = { key: "room_preference", attendee_id: freeDetails.attendees[0].id, value: "Single" };
    assert.equal((await updatePreference("test-owner", room)).status, 409);
    const readRecovery = async () => (await fetch(recoveryPath, { headers: headers("test-owner") })).json();
    const beforeRoom = await readRecovery();
    const changeRoom = (value: string) => fetch(recoveryPath + "/preferences", {
      method: "PATCH", headers: { ...headers("test-owner"), "Content-Type": "application/json", "x-csrf-token": "fixture-csrf" },
      body: JSON.stringify({ ...room, attendee_id: beforeRoom.attendees[0].id, value }),
    });
    assert.equal((await changeRoom("Single")).status, 204);
    const singleRoom = await readRecovery();
    assert.equal(singleRoom.total_due_minor, beforeRoom.total_due_minor + 130000);
    assert.equal(singleRoom.version, beforeRoom.version + 1);
    assert.equal((await changeRoom("Single")).status, 204);
    assert.equal((await readRecovery()).total_due_minor, singleRoom.total_due_minor);
    assert.equal((await changeRoom("Shared")).status, 204);
    assert.equal((await readRecovery()).total_due_minor, beforeRoom.total_due_minor);
    await db.upsertSettings({ event_date: "2000-01-01T10:00", event_timezone: "Asia/Bangkok" }, newExternalEvent.id);
    assert.equal((await updatePreference("test-owner", food)).status, 409);
    const closedPreferences = await (await fetch(ownerFreeUrl, { headers: headers("test-owner") })).json();
    assert.deepEqual(closedPreferences.preference_fields, []);
    assert.equal(closedPreferences.attendees[0].preference_answers.food, food.value);

    const assistedPlacement = await fetch(externalPublic + "/paid-bookings", {
      method: "POST", headers: { ...headers("test-owner"), "Content-Type": "application/json",
        "Idempotency-Key": "staff-assisted-booking", "x-csrf-token": "fixture-csrf" },
      body: JSON.stringify({ pricing_version: 2, contact: { name: "Assisted Buyer" },
        attendees: [{ category_id: "general", first_name: "Assisted", last_name: "Guest" }] }),
    });
    assert.equal(assistedPlacement.status, 201, await assistedPlacement.clone().text());
    const assisted = await assistedPlacement.json();
    const paymentActions = () => fetch(origin + "/api/customer/paid-bookings?awaiting_payment=1&reference=" + assisted.reference,
      { headers: headers("test-owner") }).then((response) => response.json());
    assert.equal((await paymentActions()).bookings[0].id, assisted.id);
    const cancelOwned = (id: string, token = "test-owner") => fetch(
      `${origin}/api/customer/paid-bookings/${paidEvent.id}/${id}/cancel`,
      { method: "POST", headers: { ...headers(token), "x-csrf-token": "fixture-csrf" } },
    );
    const assistedPath = externalPrefix + "/bookings/" + assisted.id;
    const staffProofPath = assistedPath + "/proofs";
    const assistedImage = await sharp({ create: { width: 107, height: 151, channels: 3, background: "#daedf0" } }).png().toBuffer();
    const proofHeaders = { "Content-Type": "application/octet-stream", "Idempotency-Key": "staff-assisted-slip",
      "x-booking-version": "1", "x-payment-method": "bank_transfer", "x-proof-mime": "image/png" };
    const staffAnalysis = await fetch(assistedPath + "/proof-analysis", { method: "POST",
      headers: { ...staffCreateHeaders, ...proofHeaders, "x-booking-reference": assisted.reference }, body: Uint8Array.from(assistedImage) });
    assert.equal(staffAnalysis.status, 200, await staffAnalysis.clone().text());
    assert.equal((await staffAnalysis.json()).amountMinor, 50000);
    assert.equal((await fetch(staffProofPath, { method: "POST", headers: { ...headers("test-owner"), ...proofHeaders,
      "x-csrf-token": "fixture-csrf" }, body: Uint8Array.from(assistedImage) })).status, 401);
    const assistedUpload = await fetch(staffProofPath, { method: "POST", headers: { ...staffCreateHeaders, ...proofHeaders }, body: Uint8Array.from(assistedImage) });
    assert.equal(assistedUpload.status, 202, await assistedUpload.clone().text());
    const assistedReceipt = await assistedUpload.json();
    assert.equal(assistedReceipt.status, "verification_pending");
    const couponAfterSlip = await fetch(assistedPath + "/manage", {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "staff-coupon-after-slip" },
      body: JSON.stringify({ action: "apply_coupon", coupon_code: "STAFF20", version: assistedReceipt.version, reason: "Already submitted" }),
    });
    assert.equal(couponAfterSlip.status, 409);
    assert.equal((await couponAfterSlip.json()).error, "state_conflict");
    assert.equal((await cancelOwned(assisted.id)).status, 409);
    assert.deepEqual((await paymentActions()).bookings, []);
    const assistedQueue = await fetch(externalPrefix + "/review-queue?reference=" + assisted.reference, { headers: staffHeaders });
    const [assistedReview] = (await assistedQueue.json()).reviews;
    assert.equal(assistedReview.claimed_minor, null);
    assert.equal(assistedReview.claimed_transfer_ms, null);
    const earlyMs = assistedReview.booking_created_ms - 86_400_000;
    const reviewEarly = (confirm_early_transfer: boolean, timestamp = earlyMs) => fetch(assistedPath + "/review", {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "accept-early-transfer" },
      body: JSON.stringify({
        decision: "approve", attempt_id: assistedReceipt.attempt_id, version: assistedReceipt.version,
        confirm_early_transfer, reason: "Matched the earlier transaction in the bank statement",
        observed: { currency: "THB", amount_minor: 250000, paid_at: new Date(timestamp).toISOString(), reference: "assisted-early-payment", receiver_id: "EXTERNAL_MANUAL" },
      }),
    });
    const refusedEarly = await reviewEarly(false);
    assert.equal(refusedEarly.status, 409);
    assert.equal((await refusedEarly.json()).error, "early_transfer_confirmation_required");
    const refusedFuture = await reviewEarly(true, Date.now() + 60_000);
    assert.equal(refusedFuture.status, 400);
    const approvedEarly = await reviewEarly(true);
    assert.equal(approvedEarly.status, 200, await approvedEarly.clone().text());
    assert.equal((await approvedEarly.json()).status, "confirmed");
    const evidence = new Database(database, { readonly: true });
    try {
      assert.equal(evidence.prepare("SELECT observed_transfer_ms FROM paid_payment_attempts WHERE id=?").pluck().get(assistedReceipt.attempt_id), earlyMs);
      assert.match(String(evidence.prepare("SELECT reason FROM paid_audit_events WHERE booking_id=? AND action='review_verified'").pluck().get(assisted.id)), /^Verified pre-booking transfer:/);
    } finally { evidence.close(); }

    assert.equal((await cancelOwned(assisted.id)).status, 409);
    const placeUnpaid = async (key: string) => {
      const result = await fetch(externalPublic + "/paid-bookings", {
        method: "POST", headers: { ...headers("test-owner"), "Content-Type": "application/json",
          "Idempotency-Key": key, "x-csrf-token": "fixture-csrf" },
        body: JSON.stringify({ pricing_version: 2, contact: { name: "Cancellation test" },
          attendees: [{ category_id: "general", first_name: "Cancel", last_name: "Guest" }] }),
      });
      assert.equal(result.status, 201, await result.clone().text());
      return result.json();
    };
    const heldAttendees = async () => (await (await fetch(externalPrefix + "/summary", { headers: staffHeaders })).json()).summary.held_attendees;
    const customerCancellation = await placeUnpaid("cancel-owned");
    assert.equal((await cancelOwned(customerCancellation.id, "test-other")).status, 404);
    const heldBefore = await heldAttendees();
    for (let retry = 0; retry < 2; retry++) {
      const cancelled = await cancelOwned(customerCancellation.id);
      assert.equal(cancelled.status, 200);
      assert.deepEqual(await cancelled.json(), { status: "cancelled" });
    }
    assert.equal(await heldAttendees(), heldBefore - 1);
    const customerActivity = (await (await fetch(externalPrefix + "/summary?activity=1", { headers: staffHeaders })).json()).summary.activity;
    assert.equal(customerActivity.filter((entry: { action: string; reference: string }) =>
      entry.action === "customer_cancel" && entry.reference === customerCancellation.reference).length, 1);
    const adminCancellation = await placeUnpaid("cancel-by-staff");
    const rosterAfterCancel = await (await fetch(externalPrefix + "/attendees", { headers: staffHeaders })).json();
    const adminRow = rosterAfterCancel.attendees.find((row: { booking_id: string }) => row.booking_id === adminCancellation.id);
    assert.equal(adminRow.booking_version, 1);
    const adminCancelled = await fetch(externalPrefix + "/bookings/" + adminCancellation.id + "/manage", {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "cancel-from-roster" },
      body: JSON.stringify({ action: "cancel", version: adminRow.booking_version, reason: "Requested by the booker" }),
    });
    assert.equal(adminCancelled.status, 200, await adminCancelled.clone().text());
    assert.equal((await adminCancelled.json()).status, "cancelled");

    const balance = async (token: string, eventId = paidEvent.id) => {
      const response = await fetch(`${origin}/api/customer/paid-bookings/${eventId}/credit`, { headers: headers(token) });
      assert.equal(response.status, 200);
      return (await response.json()).available_minor;
    };
    const settle = (id: string, version: number, action: "credit" | "refund", key: string) => fetch(
      `${externalPrefix}/bookings/${id}/manage`,
      { method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": key },
        body: JSON.stringify({ action, version, reason: "Booking moved at the customer’s request",
          ...(action === "refund" ? { refund_reference: "external-refund-test" } : {}) }) },
    );
    assert.equal(await balance("test-owner"), 0);
    const credited = await settle(assisted.id, assistedReceipt.version + 1, "credit", "issue-booking-credit");
    assert.equal(credited.status, 200, await credited.clone().text());
    const creditReceipt = await credited.json();
    assert.equal(creditReceipt.status, "cancelled");
    assert.deepEqual(await (await settle(assisted.id, assistedReceipt.version + 1, "credit", "issue-booking-credit")).json(), creditReceipt);
    assert.equal((await settle(assisted.id, creditReceipt.version, "refund", "no-refund-after-credit")).status, 409);
    assert.equal(await balance("test-owner"), 250000);
    assert.equal(await balance("test-other"), 0);
    assert.equal(await balance("test-owner", event.id), 0);

    const bookWithCredit = (credit_minor: number, key: string, token = "test-owner") => fetch(externalPublic + "/paid-bookings", {
      method: "POST", headers: { ...headers(token), "Content-Type": "application/json", "Idempotency-Key": key, "x-csrf-token": "fixture-csrf" },
      body: JSON.stringify({ pricing_version: 2, credit_minor, contact: { name: "Credit test" },
        attendees: [{ category_id: "general", first_name: "Credit", last_name: key }] }),
    });
    assert.equal((await bookWithCredit(250000, "cannot-spend-other-accounts-credit", "test-other")).status, 409);
    const part = await bookWithCredit(100000, "partial-credit");
    assert.equal(part.status, 201, await part.clone().text());
    const partialBooking = await part.json();
    assert.equal(partialBooking.total_due_minor, 150000);
    assert.equal(await balance("test-owner"), 150000);
    const refusedOverspend = await bookWithCredit(250000, "cannot-spend-held-credit");
    assert.equal(refusedOverspend.status, 409);
    assert.equal((await refusedOverspend.json()).error, "credit_changed");
    assert.equal((await cancelOwned(partialBooking.id)).status, 200);
    assert.equal(await balance("test-owner"), 250000);

    // Simultaneous bookings cannot both spend the same balance.
    const concurrent = await Promise.all([bookWithCredit(250000, "full-credit-one"), bookWithCredit(250000, "full-credit-two")]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 409]);
    const supported = await concurrent.find(response => response.status === 201)!.json();
    assert.equal(supported.status, "confirmed");
    assert.equal(supported.total_due_minor, 0);
    assert.equal(await balance("test-owner"), 0);
    assert.equal((await settle(supported.id, supported.version, "credit", "restore-used-credit")).status, 200);
    assert.equal(await balance("test-owner"), 250000);

    const flagResponse = await fetch(externalPrefix + "/bookings/" + externalSlipBooking.id + "/manage", {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "flag-attendee-price" },
      body: JSON.stringify({ action: "flag_price", reason: "Check participant price",
        attendee_id: externalConfirmedDetail.attendees[0].id, version: phoneUpdated.version }),
    });
    assert.equal(flagResponse.status, 200, await flagResponse.clone().text());
    const flagReceipt = await flagResponse.json();
    assert.equal(flagReceipt.status, "confirmed");
    const flaggedReview = (await (await fetch(externalPrefix + "/review-queue", { headers: staffHeaders })).json()).reviews
      .find((row: { booking_id: string }) => row.booking_id === externalSlipBooking.id);
    assert.equal(flaggedReview.attendees[0].price_flagged, true);
    assert.equal(flaggedReview.total_minor, externalConfirmedDetail.total_due_minor);
    const externalTeamCsv = `${origin}/api/registrations/export?event_id=${paidEvent.id}&language=en&roster=active`;
    const flaggedCsv = await fetch(externalTeamCsv, { headers: staffHeaders });
    assert.equal(flaggedCsv.status, 200);
    assert.ok(!(await flaggedCsv.text()).includes("+66 81 234 5678"));

    const correction = await fetch(externalPrefix + "/bookings/" + externalSlipBooking.id + "/manage", {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "correct-attendee-price" },
      body: JSON.stringify({ action: "correct_price", reason: "Correct the published price",
        attendee_id: externalConfirmedDetail.attendees[0].id, unit_minor: 300000, version: flagReceipt.version }),
    });
    assert.equal(correction.status, 200, await correction.clone().text());
    const correctionResult = await correction.json();
    assert.equal(correctionResult.status, "confirmed");
    assert.equal(correctionResult.balance_due_minor, 50000);
    const [correctedReview] = (await (await fetch(externalPrefix + "/review-queue?reference=" +
      externalSlipBooking.reference, { headers: staffHeaders })).json()).reviews;
    assert.equal(correctedReview.attendees[0].price_flagged, false);
    const correctedCsv = await fetch(externalTeamCsv, { headers: staffHeaders });
    assert.equal(correctedCsv.status, 200);
    assert.match(await correctedCsv.text(), /"3000\.00","[^"]*","'\+66 81 234 5678"/);
    const correctedDetails = await (await fetch(externalOwnedPath, { headers: headers("test-owner") })).json();
    assert.equal(correctedDetails.attendees[0].unit_minor, 300000);
    assert.equal(correctedDetails.attendees[0].phone, "+66 81 234 5678");
    assert.equal(correctedDetails.balance_due_minor, 50000);
    assert.equal((await fetch(externalOwnedPath + "/payment-display", { headers: headers("test-owner") })).status, 200);
    assert.equal((await cancelOwned(externalSlipBooking.id)).status, 409);

    const noticeCommand = {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "request-corrected-balance" },
      body: JSON.stringify({ action: "payment_notice", reason: "Please pay the remaining THB 500.",
        version: correctionResult.version }),
    };
    const manageCorrected = externalPrefix + "/bookings/" + externalSlipBooking.id + "/manage";
    const notice = await fetch(manageCorrected, noticeCommand);
    assert.equal(notice.status, 200, await notice.clone().text());
    const noticeResult = await notice.json();
    assert.deepEqual(await (await fetch(manageCorrected, noticeCommand)).json(), noticeResult);
    const ownedNotice = await (await fetch(externalOwnedPath, { headers: headers("test-owner") })).json();
    assert.equal(ownedNotice.payment_notice, "Please pay the remaining THB 500.");
    const ownedList = await (await fetch(origin + "/api/customer/paid-bookings?reference=" +
      externalSlipBooking.reference, { headers: headers("test-owner") })).json();
    assert.equal(ownedList.bookings[0].payment_notice, ownedNotice.payment_notice);
    assert.equal((await fetch(externalOwnedPath, { headers: headers("test-other") })).status, 404);
    const balanceDeliveries = await db.listNotificationDeliveries({ related_type: "paid_booking", limit: 30 });
    assert.equal(balanceDeliveries.filter(row => row.kind === "paid_booking.balance_reminder" &&
      row.related_id === externalSlipBooking.id).length, 1);

    const attachSupplement = async (version: number, key: string, color: string) => {
      const image = await sharp({ create: { width: 103, height: 151, channels: 3, background: color } }).png().toBuffer();
      return fetch(externalOwnedPath + "/proofs", { method: "POST", body: Uint8Array.from(image), headers: {
        ...headers("test-owner"), "x-csrf-token": "fixture-csrf", "Content-Type": "application/octet-stream",
        "Idempotency-Key": key, "x-booking-version": String(version), "x-payment-method": "bank_transfer", "x-proof-mime": "image/png",
      } });
    };
    const firstSupplement = await attachSupplement(noticeResult.version, "supplement-1", "#f1e4a4");
    assert.equal(firstSupplement.status, 202, await firstSupplement.clone().text());
    const firstSupplementResult = await firstSupplement.json();
    const duplicateSupplement = await attachSupplement(firstSupplementResult.version, "duplicate-supplement", "#f1e4a4");
    assert.equal(duplicateSupplement.status, 409);
    assert.equal((await duplicateSupplement.json()).error, "duplicate_reference_or_proof");
    const secondSupplement = await attachSupplement(firstSupplementResult.version, "supplement-2", "#afdbd3");
    assert.equal(secondSupplement.status, 202, await secondSupplement.clone().text());
    const secondSupplementResult = await secondSupplement.json();
    const supplementReviews = (await (await fetch(externalPrefix + "/review-queue?reference=" +
      externalSlipBooking.reference, { headers: staffHeaders })).json()).reviews;
    assert.equal(supplementReviews.length, 1);
    assert.equal(supplementReviews[0].proofs.length, 2);
    assert.equal(supplementReviews[0].balance_due_minor, 50000);
    assert.equal(supplementReviews[0].attendees[0].id, correctedDetails.attendees[0].id);
    assert.equal(supplementReviews[0].attendees[0].category_label, correctedDetails.attendees[0].category_label);
    assert.equal(supplementReviews[0].attendees[0].unit_minor, 300000);
    const supplementalApproval = await fetch(externalPrefix + "/bookings/" + externalSlipBooking.id + "/review", {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "approve-both-supplements" },
      body: JSON.stringify({ decision: "approve", attempt_id: secondSupplementResult.attempt_id,
        version: secondSupplementResult.version, reason: "Verified both transfers against the bank statement" }),
    });
    assert.equal(supplementalApproval.status, 200, await supplementalApproval.clone().text());
    const fullyPaid = await (await fetch(externalOwnedPath, { headers: headers("test-owner") })).json();
    assert.equal(fullyPaid.status, "confirmed");
    assert.equal(fullyPaid.balance_due_minor, 0);
    assert.equal(fullyPaid.pending_proofs, 0);
    const sameCredential = await fetch(externalOwnedPath + "/attendees/" +
      fullyPaid.attendees[0].id + "/credential", { headers: headers("test-owner") });
    assert.equal(sameCredential.status, 200);
    assert.deepEqual(new Uint8Array(await sameCredential.arrayBuffer()), new Uint8Array(await externalCredential.arrayBuffer()));
    const paidTransfers = await db.listDailyPaidTransfers(paidEvent.id, "org_default", 0, Date.now() + 60_000);
    const correctedTransfers = paidTransfers.filter(row => row.booking_id === externalSlipBooking.id);
    assert.equal(correctedTransfers.length, 3);
    assert.equal(correctedTransfers.reduce((total, row) => total + Number(row.amount_minor ?? 0), 0), 300000);

    const adminLookup = externalPrefix + "/bookings/by-reference/" + externalSlipBooking.reference;
    const paidAdminDetail = await (await fetch(adminLookup, { headers: staffHeaders })).json();
    assert.equal(paidAdminDetail.booking.cash_confirmed, true);
    assert.equal(paidAdminDetail.booking.proofs.length, 3);
    const [verifiedBookingReview] = (await (await fetch(externalPrefix + "/review-queue?reference=" +
      externalSlipBooking.reference, { headers: staffHeaders })).json()).reviews;
    assert.equal(verifiedBookingReview.booking_state, "confirmed");
    assert.equal(verifiedBookingReview.attempt_id, null);
    assert.equal(verifiedBookingReview.attendees[0].unit_minor, 300000);
    assert.deepEqual(verifiedBookingReview.proofs, []);
    assert.equal(verifiedBookingReview.previous_proofs.length, 3);
    assert.equal(verifiedBookingReview.previous_proofs.reduce((sum: number, proof: { observed_minor: number | null }) =>
      sum + (proof.observed_minor ?? 0), 0), 300000);

    const supportingSlip = await sharp({ create: {
      width: 103, height: 151, channels: 3, background: "#b4b0ce",
    } }).png().toBuffer();
    const attachedToPaid = await fetch(manageCorrected.replace(/manage$/, "proofs"), {
      method: "POST", body: Uint8Array.from(supportingSlip),
      headers: { ...staffCreateHeaders, ...proofHeaders, "x-booking-version": String(fullyPaid.version),
        "Idempotency-Key": "attach-to-fully-paid", "x-claimed-minor": "1000" },
    });
    assert.equal(attachedToPaid.status, 202, await attachedToPaid.clone().text());
    const supportingReceipt = await attachedToPaid.json();
    const supportingQueue = await (await fetch(externalPrefix + "/review-queue?reference=" +
      externalSlipBooking.reference, { headers: staffHeaders })).json();
    assert.equal(supportingQueue.reviews[0].booking_state, "confirmed");
    assert.equal(supportingQueue.reviews[0].balance_due_minor, 0);
    assert.equal(supportingQueue.reviews[0].proofs[0].attempt_id, supportingReceipt.attempt_id);
    const approveEvidence = await fetch(manageCorrected.replace(/manage$/, "review"), {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "approve-evidence-fully-paid" },
      body: JSON.stringify({ decision: "approve", attempt_id: supportingReceipt.attempt_id,
        version: supportingReceipt.version, reason: "Supporting evidence for the original payment" }),
    });
    assert.equal(approveEvidence.status, 200, await approveEvidence.clone().text());
    const afterSupporting = await (await fetch(externalOwnedPath, { headers: headers("test-owner") })).json();
    assert.equal(afterSupporting.status, "confirmed");
    assert.equal(afterSupporting.balance_due_minor, 0);
    const actualTransfers = await db.listDailyPaidTransfers(paidEvent.id, "org_default", 0, Date.now() + 60_000);
    assert.equal(actualTransfers.filter(row => row.booking_id === externalSlipBooking.id)
      .reduce((total, row) => total + Number(row.amount_minor ?? 0), 0), 300000);

    const moreDue = await fetch(manageCorrected, {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "correct-with-existing-supporting-slip" },
      body: JSON.stringify({ action: "correct_price", reason: "Update price after the slip was archived",
        attendee_id: afterSupporting.attendees[0].id, unit_minor: 301000, version: afterSupporting.version }),
    });
    assert.equal(moreDue.status, 200, await moreDue.clone().text());
    const newCorrection = await moreDue.json();
    const secondNotice = await fetch(manageCorrected, {
      method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": "reminder-before-supporting-slip-is-applied" },
      body: JSON.stringify({ action: "payment_notice", reason: "Please confirm the additional transfer", version: newCorrection.version }),
    });
    assert.equal(secondNotice.status, 200, await secondNotice.clone().text());
    const updatedVersion = (await secondNotice.json()).version;
    const supportingReview = (await (await fetch(externalPrefix + "/review-queue?reference=" +
      externalSlipBooking.reference, { headers: staffHeaders })).json()).reviews[0];
    assert.equal(supportingReview.attempt_id, null);
    assert.equal(supportingReview.balance_due_minor, 1000);
    assert.equal(supportingReview.previous_proofs.find((proof: { attempt_id: string }) =>
      proof.attempt_id === supportingReceipt.attempt_id).supporting, true);

    const applySupporting = (attemptId: string, amount: number, version: number, key: string) =>
      fetch(manageCorrected.replace(/manage$/, "review"), {
        method: "POST", headers: { ...staffCreateHeaders, "Idempotency-Key": key },
        body: JSON.stringify({ decision: "apply_supporting", attempt_id: attemptId, balance_amount_minor: amount,
          version, reason: "Verified the deposit in bank records" }),
      });
    const excess = await applySupporting(supportingReceipt.attempt_id, 1001, updatedVersion, "excess-supporting");
    assert.equal(excess.status, 409);
    assert.equal((await excess.json()).error, "amount_exceeds_balance");
    const alreadyCounted = await applySupporting(verifiedBookingReview.previous_proofs[0].attempt_id, 1000, updatedVersion, "reuse-settled-slip");
    assert.equal(alreadyCounted.status, 409);
    assert.equal((await alreadyCounted.json()).error, "proof_not_applicable");
    const applied = await applySupporting(supportingReceipt.attempt_id, 1000, updatedVersion, "apply-supporting");
    assert.equal(applied.status, 200, await applied.clone().text());
    const appliedReceipt = await applied.json();
    assert.deepEqual(await (await applySupporting(supportingReceipt.attempt_id, 1000, updatedVersion, "apply-supporting")).json(), appliedReceipt);
    const closedBalance = await (await fetch(externalOwnedPath, { headers: headers("test-owner") })).json();
    assert.equal(closedBalance.status, "confirmed");
    assert.equal(closedBalance.balance_due_minor, 0);
    const appliedTransfers = await db.listDailyPaidTransfers(paidEvent.id, "org_default", 0, Date.now() + 60_000);
    assert.equal(appliedTransfers.filter(row => row.booking_id === externalSlipBooking.id)
      .reduce((total, row) => total + Number(row.amount_minor ?? 0), 0), 301000);
    const afterApplyQueue = (await (await fetch(externalPrefix + "/review-queue?reference=" +
      externalSlipBooking.reference, { headers: staffHeaders })).json()).reviews[0];
    const appliedProof = afterApplyQueue.previous_proofs.find((proof: { attempt_id: string }) =>
      proof.attempt_id === supportingReceipt.attempt_id);
    assert.equal(appliedProof.supporting, false);
    assert.equal(appliedProof.observed_minor, 1000);

    const pendingEmail = "unverified-cleanup@example.com";
    const pendingAccount = await db.createCustomerAccount({
      email: pendingEmail, normalized_email: pendingEmail, password_hash: "fixture", first_name: "Test", last_name: "Pending",
      phone: "", normalized_phone: "", accepted_terms_at: new Date(), accepted_privacy_at: new Date(),
    });
    const deleteAccountPath = `${origin}/api/admin/customers/${pendingAccount.id}`;
    assert.equal((await fetch(deleteAccountPath, { method: "DELETE", headers: { ...staffCreateHeaders, "x-csrf-token": "wrong" } })).status, 403);
    assert.equal((await fetch(deleteAccountPath, { method: "DELETE", headers: staffCreateHeaders })).status, 204);
    assert.equal(await db.getCustomerAccountById(pendingAccount.id), undefined);

    await db.updateEvent(event.id, { status: "cancelled" });
    assert.equal((await fetch(credentialPath(attendees[0].id), { headers: headers("test-owner") })).status, 404);
    assert.equal((await fetch(`${prefix}/paid-registration`)).status, 404);
    assert.equal((await fetch(`${eventPrefix}/summary`, { headers: headers("test-owner") })).status, 401);

    // A verified attendee uses the existing password to activate staff access and can open either workspace.
    const attendeeEmail = "test-owner@example.com";
    const attendeePassword = "Attendee1";
    const dualAccount = (await db.getCustomerAccountByNormalizedEmail(attendeeEmail))!;
    await db.updateCustomerPasswordHash(dualAccount.id, hashPassword(attendeePassword));
    const dualStaff = await db.createUser({
      username: "promoted-attendee", display_name: "Promoted attendee", role: "admin",
      password_hash: hashPassword("OldStaffCredential"), invite_email: attendeeEmail,
    });
    const invite = "fixture-staff-activation";
    assert.equal(await db.stageStaffEmail(dualStaff.id, attendeeEmail, "invite", hashSessionToken(invite),
      new Date(Date.now() + 600_000).toISOString(), new Date().toISOString()), true);
    const jsonPost = (path: string, payload: object) => fetch(origin + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const customerLogin = (password: string) => jsonPost("/api/customer/account/login", { email: attendeeEmail, password });
    const staffLogin = (username: string, password: string) => jsonPost("/api/auth/login", { username, password });
    const activate = (password: string) => jsonPost("/api/auth/staff-email/confirm", { purpose: "invite", token: invite, password, invite_mode: "link_attendee" });
    const switchToAttendee = async (hasStaffAccess: boolean) => {
      const staffCookie = "fbs_session=test-reviewer";
      const login = await fetch(origin + "/api/customer/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: staffCookie, Origin: origin },
        body: JSON.stringify({ email: attendeeEmail, password: attendeePassword, attendee_only: true }),
      });
      assert.equal(login.status, 200, await login.clone().text());
      const sessionCookies = login.headers.getSetCookie().map(cookie => cookie.split(";")[0]);
      assert.ok(sessionCookies.some(cookie => cookie.startsWith("fbs_customer_session=")));
      assert.ok(!sessionCookies.some(cookie => cookie.startsWith("fbs_session=")));
      const customerMe = await fetch(origin + "/api/customer/account/me", {
        headers: { Cookie: [staffCookie, ...sessionCookies].join("; ") },
      });
      assert.equal(customerMe.status, 200);
      const data = await customerMe.json();
      assert.equal(data.account.id, dualAccount.id);
      assert.equal(data.account.has_staff_access, hasStaffAccess);
      assert.equal(data.has_staff_session, true);
      assert.equal((await fetch(origin + "/api/auth/me", { headers: { Cookie: staffCookie } })).status, 200);
      const customerOnly = await fetch(origin + "/api/customer/account/me", {
        headers: { Cookie: sessionCookies.join("; ") },
      });
      assert.equal((await customerOnly.json()).has_staff_session, false);
    };
    assert.equal((await (await customerLogin(attendeePassword)).json()).account.has_staff_access, false);
    await switchToAttendee(false);
    assert.equal((await staffLogin(attendeeEmail, attendeePassword)).status, 401);
    assert.equal((await activate("WrongSeparatePassword")).status, 403);
    assert.equal((await activate(attendeePassword)).status, 200);
    await switchToAttendee(true);
    assert.equal((await activate(attendeePassword)).status, 400);
    assert.equal((await staffLogin("promoted-attendee", "OldStaffCredential")).status, 401);
    const byEmail = await staffLogin(" TEST-OWNER@EXAMPLE.COM ", attendeePassword);
    assert.equal(byEmail.status, 200, await byEmail.clone().text());
    assert.equal((await byEmail.json()).user.id, dualStaff.id);
    assert.equal((await staffLogin("promoted-attendee", attendeePassword)).status, 200);
    const unified = await customerLogin(attendeePassword);
    assert.equal(unified.status, 200, await unified.clone().text());
    assert.equal((await unified.json()).account.has_staff_access, true);
    const cookies = unified.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
    const staffMe = await fetch(origin + "/api/auth/me", { headers: { Cookie: cookies } });
    assert.equal(staffMe.status, 200);
    assert.equal((await staffMe.json()).user.role, "admin");
    const attendeeMe = await fetch(origin + "/api/customer/account/me", { headers: { Cookie: cookies } });
    assert.equal((await attendeeMe.json()).account.id, dualAccount.id);

    const reset = "fixture-unified-password-reset";
    await db.createCustomerAccountToken({ customer_account_id: dualAccount.id, kind: "password_reset",
      token_hash: hashSessionToken(reset), expires_at: new Date(Date.now() + 60_000) });
    assert.equal((await jsonPost("/api/customer/account/reset-password", { token: reset, password: "NewAttendee1" })).status, 200);
    assert.equal((await fetch(origin + "/api/auth/me", { headers: { Cookie: cookies } })).status, 401);
    assert.equal((await staffLogin(attendeeEmail, attendeePassword)).status, 401);
    assert.equal((await staffLogin(attendeeEmail, "NewAttendee1")).status, 200);

    const requestReset = (email: string, scope: "staff" | "attendee") =>
      jsonPost("/api/customer/account/forgot-password", { email, scope });
    const finishReset = (token: string, password: string, scope: "staff" | "attendee") =>
      jsonPost("/api/customer/account/reset-password", { token, password, scope });
    async function getResetFromEmail(email: string, staff: boolean) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const messages = readFileSync(sentEmail, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
        const message = messages.reverse().find(message =>
          message.to.includes(email) && /reset-password/.test(message.text));
        if (message) {
          const link = new URL(message.text.match(/Open link: (\S+)/)[1]);
          assert.equal(link.origin, origin);
          assert.equal(link.pathname, "/account/reset-password");
          assert.equal(link.searchParams.has("token"), false);
          assert.equal(link.searchParams.has("staff"), staff);
          const token = new URLSearchParams(link.hash.slice(1)).get("token");
          assert.ok(token);
          return token;
        }
        await delay(25);
      }
      assert.fail("Reset email never reached provider");
    }
    writeFileSync(sentEmail, "");
    const requested = await requestReset(attendeeEmail, "staff");
    assert.equal(requested.status, 202);
    const linkedToken = await getResetFromEmail(attendeeEmail, true);
    const unknown = await requestReset("unknown@example.com", "staff");
    assert.equal(unknown.status, requested.status);
    assert.deepEqual(await unknown.json(), await requested.json());
    assert.equal((await finishReset(linkedToken, "SharedReset123", "staff")).status, 200);
    assert.equal((await finishReset(linkedToken, "ReplayPassword123", "staff")).status, 400);
    assert.equal((await staffLogin(attendeeEmail, "SharedReset123")).status, 200);
    assert.equal((await customerLogin("SharedReset123")).status, 200);

    const staffOnlyEmail = "staff-only@example.com";
    const staffOnly = await db.createUser({ username: "staff-only", display_name: "Staff only", role: "admin",
      password_hash: hashPassword("OldStaffPassword123"), invite_email: staffOnlyEmail });
    const staffOnlyInvite = hashSessionToken("staff-only-invite");
    const fixtureNow = new Date();
    await db.stageStaffEmail(staffOnly.id, staffOnlyEmail, "invite", staffOnlyInvite,
      new Date(fixtureNow.getTime() + 60_000).toISOString(), fixtureNow.toISOString());
    await db.consumeStaffEmail(staffOnlyInvite, fixtureNow.toISOString(), null, hashPassword("OldStaffPassword123"));
    await db.createSession(staffOnly.id, hashSessionToken("staff-only-session"), new Date(Date.now() + 60_000));
    const staffRequest = await requestReset(staffOnlyEmail, "staff");
    assert.equal(staffRequest.status, 202);
    const staffToken = await getResetFromEmail(staffOnlyEmail, true);
    assert.equal((await finishReset(staffToken, "WrongScope123", "attendee")).status, 400);
    assert.equal((await finishReset(staffToken, "NewStaffPassword123", "staff")).status, 200);
    assert.equal((await staffLogin(staffOnlyEmail, "OldStaffPassword123")).status, 401);
    assert.equal((await staffLogin(staffOnlyEmail, "NewStaffPassword123")).status, 200);
    assert.equal((await fetch(origin + "/api/auth/me", { headers: { Cookie: "fbs_session=staff-only-session" } })).status, 401);

    const attendeeOnlyEmail = "test-other@example.com";
    const attendeeRequest = await requestReset(attendeeOnlyEmail, "attendee");
    assert.equal(attendeeRequest.status, 202);
    const attendeeToken = await getResetFromEmail(attendeeOnlyEmail, false);
    assert.equal((await finishReset(attendeeToken, "WrongScope123", "staff")).status, 400);
    assert.equal((await finishReset(attendeeToken, "NewAttendeePassword123", "attendee")).status, 200);
    assert.equal((await jsonPost("/api/customer/account/login", { email: attendeeOnlyEmail, password: "NewAttendeePassword123" })).status, 200);

    const independentStaff = await db.createUser({ username: "independent-admin", display_name: "Independent staff",
      password_hash: hashPassword("InitialPassword123"), invite_email: attendeeOnlyEmail, role: "admin" });
    const independentInvite = "independent-staff-invite";
    const independentToken = hashSessionToken(independentInvite);
    const invitedAt = new Date();
    assert.equal(await db.stageStaffEmail(independentStaff.id, attendeeOnlyEmail, "invite", independentToken,
      new Date(invitedAt.getTime() + 60_000).toISOString(), invitedAt.toISOString()), true);
    const activateIndependent = (password: string, token = independentInvite) => jsonPost("/api/auth/staff-email/confirm",
      { purpose: "invite", token, password, invite_mode: "new_password" });
    assert.equal((await activateIndependent("NewIndependent123", "invalid-token")).status, 400);
    assert.equal((await activateIndependent("short")).status, 400);
    assert.equal((await activateIndependent("NewIndependent123")).status, 200);
    assert.equal((await activateIndependent("AnotherPassword123")).status, 400);
    assert.equal((await staffLogin(attendeeOnlyEmail, "NewAttendeePassword123")).status, 401);
    const independentLogin = await staffLogin(attendeeOnlyEmail, "NewIndependent123");
    assert.equal(independentLogin.status, 200);
    assert.equal((await independentLogin.json()).user.has_customer_account, false);
    const originalAttendeeLogin = await jsonPost("/api/customer/account/login", { email: attendeeOnlyEmail, password: "NewAttendeePassword123" });
    assert.equal(originalAttendeeLogin.status, 200);
    assert.equal((await originalAttendeeLogin.json()).account.has_staff_access, false);
  } finally {
    if (child && child.exitCode === null) child.kill();
    await exited;
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
