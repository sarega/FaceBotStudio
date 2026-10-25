import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import puppeteer from "puppeteer";
import { SqliteAppDatabase } from "./db/sqliteAdapter";
import { hashSessionToken } from "./auth";

test("organizer create, switch, reload and permission workflow", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "meetrix-organizer-"));
  const db = new SqliteAppDatabase(join(dir, "test.db"));
  await db.initialize();
  for (const role of ["owner", "viewer"] as const) {
    const user = await db.createUser({ username: `test-${role}`, display_name: role, password_hash: "unused", role });
    await db.createSession(user.id, hashSessionToken(`test-${role}`), new Date(Date.now() + 60000));
  }
  const first = await db.createOrganizerProfile("org_default", { name: "First" });
  const second = await db.createOrganizerProfile("org_default", { name: "Second" });
  const raw = new Database(join(dir, "test.db"));
  raw.prepare("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)").run("other-org", "Other", "other");
  raw.close();
  const foreign = await db.createOrganizerProfile("other-org", { name: "Foreign" });
  const foreignEvent = await db.createEvent({ name: "Foreign event", organizer_id: "other-org" });
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    env: { ...process.env, NODE_ENV: "development", APP_RUNTIME: "web", DB_PATH: join(dir, "test.db"), DATABASE_URL: "", REDIS_URL: "", PORT: "3197" },
    stdio: "ignore",
  });
  const request = async (path: string, body?: object, role = "owner") => {
    const res = await fetch(`http://localhost:3197${path}`, {
      method: body ? "POST" : "GET",
      headers: { Cookie: `fbs_session=test-${role}; fbs_csrf=test`, Origin: "http://localhost:3197", "x-csrf-token": "test", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };
  try {
    for (let i = 0; i < 100; i++) {
      try { await fetch("http://localhost:3197/api/health"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
    }
    const directory = await request("/api/organizers");
    assert.equal(directory.status, 200);
    assert.ok(directory.data.some((p: { id: string }) => p.id === second.id));
    assert.equal((await request("/api/events", { name: "Blocked" }, "viewer")).status, 403);
    assert.equal((await request("/api/settings", { event_id: foreignEvent.id, event_public_organizer_profile_id: first.id })).status, 403);
    const before = (await db.listEvents()).length;
    assert.equal((await request("/api/events", { name: "Invalid", event_public_organizer_profile_id: foreign.id })).status, 400);
    assert.equal((await db.listEvents()).length, before);
    const created = await request("/api/events", { name: "Organizer workflow", event_public_organizer_profile_id: first.id });
    assert.equal(created.status, 201);
    const eventId = created.data.id;
    assert.equal((await request(`/api/settings?event_id=${eventId}`)).data.event_public_organizer_profile_id, first.id);
    assert.equal((await request("/api/settings", { event_id: eventId, event_location: "Keep this venue", event_description: "Keep description" })).status, 200);
    const saved = await db.getSettingsMap(eventId);
    assert.equal((await request("/api/settings", { event_id: eventId, event_public_organizer_profile_id: second.id })).status, 200);
    const reloaded = (await request(`/api/settings?event_id=${eventId}`)).data;
    assert.equal(reloaded.event_public_organizer_profile_id, second.id);
    assert.equal(reloaded.event_location, "Keep this venue");
    assert.equal(reloaded.event_description, "Keep description");
    assert.deepEqual(await db.getSettingsMap(eventId), { ...saved, event_public_organizer_profile_id: second.id });
    assert.equal((await request(`/api/organizer-profile?event_id=${eventId}`)).data.organizer_profile_id, second.id);
    assert.equal((await request("/api/settings", { event_id: eventId, event_public_organizer_profile_id: foreign.id })).status, 400);
    assert.equal((await request("/api/settings", { event_id: eventId, event_public_organizer_profile_id: first.id }, "viewer")).status, 403);
    assert.equal((await request("/api/organizers", undefined, "viewer")).status, 403);
    assert.equal((await db.getEventById(eventId))?.organizer_id, "org_default");
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      page.on("dialog", (dialog) => void dialog.accept());
      await page.setCookie({ name: "fbs_session", value: "test-owner", url: "http://localhost:3197" });
      await page.goto("http://localhost:3197", { waitUntil: "networkidle0" });
      await page.waitForSelector('select[aria-label="Event organizer"]');
      const choices = await page.$eval('select[aria-label="Event organizer"]', (select) => Array.from((select as HTMLSelectElement).options, (option) => option.value));
      assert.ok(choices.includes(first.id));
      assert.ok(choices.includes(second.id));
      assert.ok(!choices.includes(foreign.id));
      console.log("Browser: selecting organizer");
      await page.select('select[aria-label="Event organizer"]', first.id);
      const saving = page.waitForResponse((response) => response.url().endsWith("/api/settings") && response.request().method() === "POST");
      await page.evaluate(() => (Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Save Event Setup")) as HTMLButtonElement).click());
      assert.equal((await saving).status(), 200);
      console.log("Browser: saved organizer");
      await page.reload({ waitUntil: "domcontentloaded" });
      console.log("Browser: reloaded");
      await page.waitForSelector('select[aria-label="Event organizer"]');
      await page.waitForFunction((id) => (document.querySelector('select[aria-label="Event organizer"]') as HTMLSelectElement)?.value === id, {}, first.id);
      await page.evaluate(() => (Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("New Event")) as HTMLButtonElement).click());
      await page.waitForSelector('select[aria-label="New event organizer"]');
      console.log("Browser: creating event");
      await page.type('input[placeholder="New event name"]', "Browser created event");
      await page.select('select[aria-label="New event organizer"]', second.id);
      console.log(await page.$$eval('input[placeholder="New event name"]', (inputs) => inputs.map((input) => ({ value: (input as HTMLInputElement).value, visible: (input as HTMLElement).offsetParent !== null }))));
      const creating = page.waitForResponse((response) => response.url().endsWith("/api/events") && response.request().method() === "POST");
      await page.evaluate(() => (Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Create Event") as HTMLButtonElement).click());
      const response = await creating;
      assert.equal(response.status(), 201);
      const browserEvent = await response.json();
      assert.equal((await db.getSettingsMap(browserEvent.id)).event_public_organizer_profile_id, second.id);
      console.log("Browser: create, switch, Save Event Setup and reload passed; foreign organizer excluded");
    } finally { await browser.close(); }
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
