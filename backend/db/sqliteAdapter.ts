import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { DEFAULT_EVENT_ID, DEFAULT_SETTINGS_ENTRIES, EVENT_SETTING_KEYS } from "./defaultSettings";
import { hashPassword, normalizeUsername } from "../auth";
import { getEventState } from "../datetime";
import type {
  AppDatabase,
  AuditLogEntryInput,
  AuditLogRow,
  AuthSessionRow,
  AuthUserRow,
  CreateEventInput,
  CreateUserInput,
  EventRow,
  FacebookPageRow,
  MessageRow,
  MessageType,
  RegistrationInput,
  RegistrationResult,
  RegistrationRow,
  RegistrationStatus,
  SettingRow,
  UpdateEventInput,
  UpsertFacebookPageInput,
  UserRole,
} from "./types";

const DEFAULT_ORGANIZATION_ID = "org_default";
const DEFAULT_ORGANIZATION_NAME = process.env.ORGANIZATION_NAME || "Default Organization";
const DEFAULT_ORGANIZATION_SLUG = "default";
const EVENT_SETTING_KEY_SET = new Set<string>(EVENT_SETTING_KEYS);

function generateRegistrationId() {
  return `REG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function generateEntityId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function slugifyText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, "-")
    .replace(/^-+|-+$/g, "") || "event";
}

function parseAuditMetadata(value: unknown) {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function mapEventRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    is_default: Boolean(row.is_default),
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  } satisfies EventRow;
}

function mapPageRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    page_id: String(row.page_id),
    page_name: String(row.page_name),
    event_id: String(row.event_id),
    page_access_token: typeof row.page_access_token === "string" ? row.page_access_token : null,
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  } satisfies FacebookPageRow;
}

export class SqliteAppDatabase implements AppDatabase {
  public readonly driver = "sqlite" as const;

  private initialized = false;
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  async initialize() {
    if (this.initialized) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT,
        text TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        type TEXT
      );
      CREATE TABLE IF NOT EXISTS registrations (
        id TEXT PRIMARY KEY,
        sender_id TEXT,
        first_name TEXT,
        last_name TEXT,
        phone TEXT,
        email TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'registered'
      );
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME
      );
      CREATE TABLE IF NOT EXISTS memberships (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, user_id),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS event_settings (
        event_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (event_id, key),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS facebook_pages (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL UNIQUE,
        page_name TEXT NOT NULL,
        event_id TEXT NOT NULL,
        page_access_token TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_event_settings_event_id ON event_settings (event_id);
      CREATE INDEX IF NOT EXISTS idx_facebook_pages_event_id ON facebook_pages (event_id);
      CREATE INDEX IF NOT EXISTS idx_facebook_pages_page_id ON facebook_pages (page_id);
    `);

    this.ensureColumn("registrations", "event_id", "TEXT");
    this.ensureColumn("messages", "event_id", "TEXT");
    this.ensureColumn("messages", "page_id", "TEXT");
    this.ensureColumn("facebook_pages", "page_access_token", "TEXT");

    const insertSetting = this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS_ENTRIES)) {
      insertSetting.run(key, value);
    }

    await this.ensureDefaultOrganization();
    await this.ensureDefaultEvent();
    await this.ensureBootstrapOwner();
    await this.deleteExpiredSessions();

    this.initialized = true;
  }

  async ping() {
    this.db.prepare("SELECT 1").get();
  }

  async close() {
    this.db.close();
  }

  async getSettingsMap(eventId = DEFAULT_EVENT_ID) {
    const baseRows = this.db.prepare("SELECT key, value FROM settings").all() as SettingRow[];
    const eventRows = this.db.prepare(
      "SELECT key, value FROM event_settings WHERE event_id = ?",
    ).all(eventId) as SettingRow[];

    const settings = baseRows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);
    for (const row of eventRows) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  async getSettingValue(key: string, eventId = DEFAULT_EVENT_ID) {
    if (EVENT_SETTING_KEY_SET.has(key)) {
      const row = this.db.prepare(
        "SELECT value FROM event_settings WHERE event_id = ? AND key = ?",
      ).get(eventId, key) as { value?: string } | undefined;
      if (row?.value != null) return row.value;
    }

    const globalRow = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
    return globalRow?.value;
  }

  async upsertSettings(entries: Record<string, string>, eventId = DEFAULT_EVENT_ID) {
    const eventStmt = this.db.prepare(
      `INSERT INTO event_settings (event_id, key, value, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(event_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    );
    const globalStmt = this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");

    for (const [key, value] of Object.entries(entries)) {
      if (EVENT_SETTING_KEY_SET.has(key)) {
        eventStmt.run(eventId, key, String(value));
      } else {
        globalStmt.run(key, String(value));
      }
    }
  }

  async getRegistrationById(id: string) {
    return this.db.prepare(
      "SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp, status FROM registrations WHERE id = ?",
    ).get(id) as RegistrationRow | undefined;
  }

  async listRegistrations(limit?: number, eventId?: string) {
    if (typeof limit === "number" && eventId) {
      return this.db.prepare(
        "SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp, status FROM registrations WHERE event_id = ? ORDER BY timestamp DESC LIMIT ?",
      ).all(eventId, limit) as RegistrationRow[];
    }
    if (eventId) {
      return this.db.prepare(
        "SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp, status FROM registrations WHERE event_id = ? ORDER BY timestamp DESC",
      ).all(eventId) as RegistrationRow[];
    }
    if (typeof limit === "number") {
      return this.db.prepare(
        "SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp, status FROM registrations ORDER BY timestamp DESC LIMIT ?",
      ).all(limit) as RegistrationRow[];
    }
    return this.db.prepare(
      "SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp, status FROM registrations ORDER BY timestamp DESC",
    ).all() as RegistrationRow[];
  }

  async exportRegistrations(eventId?: string) {
    return this.listRegistrations(undefined, eventId);
  }

  async createRegistration(input: RegistrationInput): Promise<RegistrationResult> {
    const senderId = String(input.sender_id || "").trim();
    const eventId = String(input.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const firstName = String(input.first_name || "").trim();
    const lastName = String(input.last_name || "").trim();
    const phone = String(input.phone || "").trim();
    const email = input.email == null ? "" : String(input.email).trim();

    if (!senderId || !firstName || !lastName || !phone) {
      return { statusCode: 400, content: { error: "Missing required registration fields" } };
    }

    const countRow = this.db.prepare(
      "SELECT COUNT(*) as count FROM registrations WHERE event_id = ? AND status != 'cancelled'",
    ).get(eventId) as { count: number };
    const settings = await this.getSettingsMap(eventId);
    const limit = Number.parseInt(settings.reg_limit || "200", 10);
    if (countRow.count >= limit) {
      return { statusCode: 400, content: { error: "Registration limit reached" } };
    }

    const eventState = getEventState(settings);
    if (eventState.registrationStatus === "not_started") {
      return { statusCode: 400, content: { error: "Registration has not started yet" } };
    }
    if (eventState.registrationStatus === "closed") {
      return { statusCode: 400, content: { error: "Registration has closed" } };
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = generateRegistrationId();
      try {
        this.db.prepare(
          `INSERT INTO registrations (id, sender_id, event_id, first_name, last_name, phone, email)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, senderId, eventId, firstName, lastName, phone, email);
        return { statusCode: 200, content: { id, status: "success" } };
      } catch (error: any) {
        if (String(error?.message || "").includes("UNIQUE")) continue;
        throw error;
      }
    }

    return { statusCode: 500, content: { error: "Failed to generate unique registration ID" } };
  }

  async cancelRegistration(id: unknown): Promise<RegistrationResult> {
    const registrationId = String(id || "").trim();
    if (!registrationId) {
      return { statusCode: 400, content: { error: "Registration ID is required" } };
    }

    const result = this.db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").run(registrationId);
    if (result.changes > 0) {
      return { statusCode: 200, content: { status: "success" } };
    }
    return { statusCode: 404, content: { error: "Registration not found" } };
  }

  async checkInRegistration(id: string) {
    const result = this.db.prepare("UPDATE registrations SET status = 'checked-in' WHERE id = ? AND status != 'cancelled'").run(
      String(id || "").trim().toUpperCase(),
    );
    return result.changes > 0;
  }

  async updateRegistrationStatus(id: string, status: RegistrationStatus) {
    const result = this.db.prepare("UPDATE registrations SET status = ? WHERE id = ?").run(
      status,
      String(id || "").trim().toUpperCase(),
    );
    return result.changes > 0;
  }

  async saveMessage(senderId: string, text: string, type: MessageType, eventId?: string, pageId?: string) {
    this.db.prepare(
      "INSERT INTO messages (sender_id, event_id, page_id, text, type) VALUES (?, ?, ?, ?, ?)",
    ).run(senderId, eventId || DEFAULT_EVENT_ID, pageId || null, text, type);
  }

  async listMessages(limit: number, eventId?: string) {
    if (eventId) {
      return this.db.prepare(
        "SELECT id, sender_id, event_id, page_id, text, timestamp, type FROM messages WHERE event_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
      ).all(eventId, limit) as MessageRow[];
    }
    return this.db.prepare(
      "SELECT id, sender_id, event_id, page_id, text, timestamp, type FROM messages ORDER BY timestamp DESC LIMIT ?",
    ).all(limit) as MessageRow[];
  }

  async getMessageHistoryRows(senderId: string, limit: number, eventId?: string) {
    if (eventId) {
      return this.db.prepare(
        "SELECT text, type FROM messages WHERE sender_id = ? AND event_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
      ).all(senderId, eventId, limit) as Array<{ text: string; type: MessageType }>;
    }
    return this.db.prepare(
      "SELECT text, type FROM messages WHERE sender_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
    ).all(senderId, limit) as Array<{ text: string; type: MessageType }>;
  }

  async listEvents() {
    const rows = this.db.prepare(
      "SELECT id, name, slug, is_default, is_active, created_at, updated_at FROM events ORDER BY is_default DESC, created_at ASC",
    ).all() as Array<Record<string, unknown>>;
    return rows.map(mapEventRow);
  }

  async getEventById(eventId: string) {
    const row = this.db.prepare(
      "SELECT id, name, slug, is_default, is_active, created_at, updated_at FROM events WHERE id = ?",
    ).get(String(eventId || "").trim()) as Record<string, unknown> | undefined;
    return row ? mapEventRow(row) : undefined;
  }

  async createEvent(input: CreateEventInput) {
    const id = generateEntityId("evt");
    const baseName = String(input.name || "").trim() || "New Event";
    const slug = this.uniqueEventSlug(baseName);
    this.db.prepare(
      `INSERT INTO events (id, name, slug, is_default, is_active, updated_at)
       VALUES (?, ?, ?, 0, 1, CURRENT_TIMESTAMP)`,
    ).run(id, baseName, slug);

    const templateSettings = await this.getSettingsMap(DEFAULT_EVENT_ID);
    await this.upsertSettings(
      Object.fromEntries(EVENT_SETTING_KEYS.map((key) => [key, templateSettings[key] || DEFAULT_SETTINGS_ENTRIES[key]])),
      id,
    );

    const event = await this.getEventById(id);
    if (!event) throw new Error("Failed to create event");
    return event;
  }

  async updateEvent(eventId: string, input: UpdateEventInput) {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof input.name === "string" && input.name.trim()) {
      updates.push("name = ?");
      values.push(input.name.trim());
      updates.push("slug = ?");
      values.push(this.uniqueEventSlug(input.name.trim(), eventId));
    }
    if (typeof input.is_active === "boolean") {
      updates.push("is_active = ?");
      values.push(input.is_active ? 1 : 0);
    }
    if (!updates.length) return false;
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(String(eventId || "").trim());
    const result = this.db.prepare(`UPDATE events SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  async listFacebookPages() {
    const rows = this.db.prepare(
      "SELECT id, page_id, page_name, event_id, page_access_token, is_active, created_at, updated_at FROM facebook_pages ORDER BY created_at ASC",
    ).all() as Array<Record<string, unknown>>;
    return rows.map(mapPageRow);
  }

  async getFacebookPageByPageId(pageId: string) {
    const row = this.db.prepare(
      "SELECT id, page_id, page_name, event_id, page_access_token, is_active, created_at, updated_at FROM facebook_pages WHERE page_id = ? LIMIT 1",
    ).get(String(pageId || "").trim()) as Record<string, unknown> | undefined;
    return row ? mapPageRow(row) : undefined;
  }

  async upsertFacebookPage(input: UpsertFacebookPageInput) {
    const pageId = String(input.page_id || "").trim();
    const pageName = String(input.page_name || "").trim() || pageId;
    const eventId = String(input.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const pageAccessToken = String(input.page_access_token || "").trim();
    const existing = this.db.prepare(
      "SELECT id FROM facebook_pages WHERE page_id = ?",
    ).get(pageId) as { id?: string } | undefined;
    const id = existing?.id || generateEntityId("fbp");

    this.db.prepare(
      `INSERT INTO facebook_pages (id, page_id, page_name, event_id, page_access_token, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(page_id) DO UPDATE SET page_name = excluded.page_name, event_id = excluded.event_id, page_access_token = COALESCE(NULLIF(excluded.page_access_token, ''), facebook_pages.page_access_token), is_active = excluded.is_active, updated_at = CURRENT_TIMESTAMP`,
    ).run(id, pageId, pageName, eventId, pageAccessToken, input.is_active === false ? 0 : 1);

    const row = this.db.prepare(
      "SELECT id, page_id, page_name, event_id, page_access_token, is_active, created_at, updated_at FROM facebook_pages WHERE page_id = ?",
    ).get(pageId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Failed to upsert Facebook page");
    return mapPageRow(row);
  }

  async resolveEventIdForPage(pageId: string) {
    const row = this.db.prepare(
      "SELECT event_id FROM facebook_pages WHERE page_id = ? AND is_active = 1 LIMIT 1",
    ).get(String(pageId || "").trim()) as { event_id?: string } | undefined;
    return row?.event_id || DEFAULT_EVENT_ID;
  }

  async getUserByUsername(username: string) {
    return this.queryAuthUser("u.username = ?", [normalizeUsername(username)]);
  }

  async getUserById(userId: string) {
    return this.queryAuthUser("u.id = ?", [String(userId || "").trim()]);
  }

  async getUserPasswordHash(username: string) {
    const row = this.db.prepare("SELECT password_hash FROM users WHERE username = ?").get(
      normalizeUsername(username),
    ) as { password_hash?: string } | undefined;
    return row?.password_hash;
  }

  async listUsers() {
    const rows = this.db.prepare(
      `SELECT
        u.id,
        u.username,
        u.display_name,
        u.is_active,
        u.created_at,
        u.last_login_at,
        m.role,
        o.id AS organization_id,
        o.name AS organization_name
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN organizations o ON o.id = m.organization_id
       ORDER BY u.created_at ASC, u.username ASC`,
    ).all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapAuthUserRow(row));
  }

  async createUser(input: CreateUserInput) {
    const username = normalizeUsername(input.username);
    const displayName = String(input.display_name || "").trim();
    const userId = generateEntityId("usr");
    const membershipId = generateEntityId("mem");

    this.db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, is_active)
       VALUES (?, ?, ?, ?, 1)`,
    ).run(userId, username, displayName || username, input.password_hash);

    this.db.prepare(
      `INSERT INTO memberships (id, organization_id, user_id, role)
       VALUES (?, ?, ?, ?)`,
    ).run(membershipId, DEFAULT_ORGANIZATION_ID, userId, input.role);

    const user = await this.getUserById(userId);
    if (!user) throw new Error("Failed to load newly created user");
    return user;
  }

  async updateUserRole(userId: string, role: UserRole) {
    const result = this.db.prepare(
      "UPDATE memberships SET role = ? WHERE organization_id = ? AND user_id = ?",
    ).run(role, DEFAULT_ORGANIZATION_ID, String(userId || "").trim());
    return result.changes > 0;
  }

  async setUserActive(userId: string, isActive: boolean) {
    const result = this.db.prepare(
      "UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(isActive ? 1 : 0, String(userId || "").trim());
    return result.changes > 0;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    this.db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run(generateEntityId("ses"), String(userId || "").trim(), tokenHash, expiresAt.toISOString());
  }

  async getSessionWithUser(tokenHash: string) {
    const row = this.db.prepare(
      `SELECT
        s.id AS session_id,
        s.token_hash,
        s.expires_at,
        s.last_seen_at,
        u.id,
        u.username,
        u.display_name,
        u.is_active,
        u.created_at,
        u.last_login_at,
        m.role,
        o.id AS organization_id,
        o.name AS organization_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = u.id
       JOIN organizations o ON o.id = m.organization_id
       WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    ).get(tokenHash) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return {
      session_id: String(row.session_id),
      token_hash: String(row.token_hash),
      expires_at: String(row.expires_at),
      last_seen_at: String(row.last_seen_at),
      user: this.mapAuthUserRow(row),
    } satisfies AuthSessionRow;
  }

  async touchSession(sessionId: string) {
    this.db.prepare("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(String(sessionId || "").trim());
  }

  async deleteSession(tokenHash: string) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(String(tokenHash || "").trim());
  }

  async deleteSessionsForUser(userId: string) {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(String(userId || "").trim());
  }

  async deleteExpiredSessions() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
  }

  async updateUserLastLogin(userId: string) {
    this.db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      String(userId || "").trim(),
    );
  }

  async recordAuditLog(entry: AuditLogEntryInput) {
    this.db.prepare(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      entry.actor_user_id || null,
      entry.action,
      entry.target_type || null,
      entry.target_id || null,
      JSON.stringify(entry.metadata || {}),
    );
  }

  async listAuditLogs(limit: number) {
    const rows = this.db.prepare(
      `SELECT
        a.id,
        a.action,
        a.actor_user_id,
        u.username AS actor_username,
        a.target_type,
        a.target_id,
        a.metadata,
        a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
    ).all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      action: String(row.action),
      actor_user_id: row.actor_user_id == null ? null : String(row.actor_user_id),
      actor_username: row.actor_username == null ? null : String(row.actor_username),
      target_type: row.target_type == null ? null : String(row.target_type),
      target_id: row.target_id == null ? null : String(row.target_id),
      metadata: parseAuditMetadata(row.metadata),
      created_at: String(row.created_at),
    } satisfies AuditLogRow));
  }

  private ensureColumn(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  private uniqueEventSlug(baseName: string, excludeId?: string) {
    const base = slugifyText(baseName);
    let candidate = base;
    let attempt = 1;
    while (true) {
      const row = excludeId
        ? this.db.prepare("SELECT id FROM events WHERE slug = ? AND id != ?").get(candidate, excludeId)
        : this.db.prepare("SELECT id FROM events WHERE slug = ?").get(candidate);
      if (!row) return candidate;
      attempt += 1;
      candidate = `${base}-${attempt}`;
    }
  }

  private async ensureDefaultOrganization() {
    this.db.prepare(
      `INSERT OR IGNORE INTO organizations (id, name, slug)
       VALUES (?, ?, ?)`,
    ).run(DEFAULT_ORGANIZATION_ID, DEFAULT_ORGANIZATION_NAME, DEFAULT_ORGANIZATION_SLUG);
  }

  private async ensureDefaultEvent() {
    const defaultName = String((this.db.prepare("SELECT value FROM settings WHERE key = 'event_name'").get() as { value?: string } | undefined)?.value || DEFAULT_SETTINGS_ENTRIES.event_name);
    this.db.prepare(
      `INSERT OR IGNORE INTO events (id, name, slug, is_default, is_active)
       VALUES (?, ?, ?, 1, 1)`,
    ).run(DEFAULT_EVENT_ID, defaultName, "default-event");
    this.db.prepare(
      `UPDATE events SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(defaultName, DEFAULT_EVENT_ID);

    const templateSettings = this.db.prepare("SELECT key, value FROM settings").all() as SettingRow[];
    const insertEventSetting = this.db.prepare(
      `INSERT INTO event_settings (event_id, key, value)
       VALUES (?, ?, ?)
       ON CONFLICT(event_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    );
    for (const key of EVENT_SETTING_KEYS) {
      const value = templateSettings.find((row) => row.key === key)?.value || DEFAULT_SETTINGS_ENTRIES[key];
      insertEventSetting.run(DEFAULT_EVENT_ID, key, value);
    }

    this.db.prepare("UPDATE registrations SET event_id = ? WHERE event_id IS NULL OR TRIM(event_id) = ''").run(DEFAULT_EVENT_ID);
    this.db.prepare("UPDATE messages SET event_id = ? WHERE event_id IS NULL OR TRIM(event_id) = ''").run(DEFAULT_EVENT_ID);
  }

  private async ensureBootstrapOwner() {
    const username = normalizeUsername(process.env.ADMIN_USER);
    const password = String(process.env.ADMIN_PASS || "");
    if (!username || !password) return;

    const displayName = String(process.env.ADMIN_DISPLAY_NAME || username).trim() || username;
    const passwordHash = hashPassword(password);
    const existing = this.db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id?: string } | undefined;

    if (existing?.id) {
      this.db.prepare(
        `UPDATE users
         SET display_name = ?, password_hash = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(displayName, passwordHash, existing.id);

      this.db.prepare(
        `INSERT OR IGNORE INTO memberships (id, organization_id, user_id, role)
         VALUES (?, ?, ?, 'owner')`,
      ).run(generateEntityId("mem"), DEFAULT_ORGANIZATION_ID, existing.id);

      this.db.prepare(
        `UPDATE memberships
         SET role = 'owner'
         WHERE organization_id = ? AND user_id = ?`,
      ).run(DEFAULT_ORGANIZATION_ID, existing.id);
      return;
    }

    const userId = generateEntityId("usr");
    this.db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, is_active)
       VALUES (?, ?, ?, ?, 1)`,
    ).run(userId, username, displayName, passwordHash);
    this.db.prepare(
      `INSERT INTO memberships (id, organization_id, user_id, role)
       VALUES (?, ?, ?, 'owner')`,
    ).run(generateEntityId("mem"), DEFAULT_ORGANIZATION_ID, userId);
  }

  private queryAuthUser(whereClause: string, params: unknown[]) {
    const row = this.db.prepare(
      `SELECT
        u.id,
        u.username,
        u.display_name,
        u.is_active,
        u.created_at,
        u.last_login_at,
        m.role,
        o.id AS organization_id,
        o.name AS organization_name
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN organizations o ON o.id = m.organization_id
       WHERE ${whereClause}
       LIMIT 1`,
    ).get(...params) as Record<string, unknown> | undefined;

    if (!row) return undefined;
    return this.mapAuthUserRow(row);
  }

  private mapAuthUserRow(row: Record<string, unknown>) {
    return {
      id: String(row.id),
      username: String(row.username),
      display_name: String(row.display_name),
      role: String(row.role) as UserRole,
      organization_id: String(row.organization_id),
      organization_name: String(row.organization_name),
      is_active: Boolean(row.is_active),
      created_at: String(row.created_at),
      last_login_at: row.last_login_at == null ? null : String(row.last_login_at),
    } satisfies AuthUserRow;
  }
}
