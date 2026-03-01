import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { DEFAULT_SETTINGS_ENTRIES } from "./defaultSettings";
import { hashPassword, normalizeUsername } from "../auth";
import type {
  AppDatabase,
  AuditLogEntryInput,
  AuditLogRow,
  AuthSessionRow,
  AuthUserRow,
  CreateUserInput,
  MessageRow,
  MessageType,
  RegistrationInput,
  RegistrationResult,
  RegistrationRow,
  RegistrationStatus,
  SettingRow,
  UserRole,
} from "./types";

const DEFAULT_ORGANIZATION_ID = "org_default";
const DEFAULT_ORGANIZATION_NAME = process.env.ORGANIZATION_NAME || "Default Organization";
const DEFAULT_ORGANIZATION_SLUG = "default";

function generateRegistrationId() {
  return `REG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function generateEntityId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
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
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
    `);

    const insertSetting = this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS_ENTRIES)) {
      insertSetting.run(key, value);
    }

    await this.ensureDefaultOrganization();
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

  async getSettingsMap() {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as SettingRow[];
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);
  }

  async getSettingValue(key: string) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value;
  }

  async upsertSettings(entries: Record<string, string>) {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(entries)) {
      stmt.run(key, String(value));
    }
  }

  async getRegistrationById(id: string) {
    return this.db.prepare("SELECT * FROM registrations WHERE id = ?").get(id) as RegistrationRow | undefined;
  }

  async listRegistrations(limit?: number) {
    if (typeof limit === "number") {
      return this.db.prepare("SELECT * FROM registrations ORDER BY timestamp DESC LIMIT ?").all(limit) as RegistrationRow[];
    }
    return this.db.prepare("SELECT * FROM registrations ORDER BY timestamp DESC").all() as RegistrationRow[];
  }

  async exportRegistrations() {
    return this.db.prepare("SELECT * FROM registrations").all() as RegistrationRow[];
  }

  async createRegistration(input: RegistrationInput): Promise<RegistrationResult> {
    const senderId = String(input.sender_id || "").trim();
    const firstName = String(input.first_name || "").trim();
    const lastName = String(input.last_name || "").trim();
    const phone = String(input.phone || "").trim();
    const email = input.email == null ? "" : String(input.email).trim();

    if (!senderId || !firstName || !lastName || !phone) {
      return { statusCode: 400, content: { error: "Missing required registration fields" } };
    }

    const countRow = this.db.prepare("SELECT COUNT(*) as count FROM registrations WHERE status != 'cancelled'").get() as { count: number };
    const limitRow = this.db.prepare("SELECT value FROM settings WHERE key = 'reg_limit'").get() as { value?: string } | undefined;
    const limit = Number.parseInt(limitRow?.value || "200", 10);
    if (countRow.count >= limit) {
      return { statusCode: 400, content: { error: "Registration limit reached" } };
    }

    const startRow = this.db.prepare("SELECT value FROM settings WHERE key = 'reg_start'").get() as { value?: string } | undefined;
    const endRow = this.db.prepare("SELECT value FROM settings WHERE key = 'reg_end'").get() as { value?: string } | undefined;
    const now = new Date();
    const start = new Date(startRow?.value || "");
    const end = new Date(endRow?.value || "");

    if (!Number.isNaN(start.getTime()) && now < start) {
      return { statusCode: 400, content: { error: "Registration has not started yet" } };
    }
    if (!Number.isNaN(end.getTime()) && now > end) {
      return { statusCode: 400, content: { error: "Registration has closed" } };
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = generateRegistrationId();
      try {
        this.db.prepare(
          `INSERT INTO registrations (id, sender_id, first_name, last_name, phone, email)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, senderId, firstName, lastName, phone, email);
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

  async saveMessage(senderId: string, text: string, type: MessageType) {
    this.db.prepare("INSERT INTO messages (sender_id, text, type) VALUES (?, ?, ?)").run(senderId, text, type);
  }

  async listMessages(limit: number) {
    return this.db.prepare("SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?").all(limit) as MessageRow[];
  }

  async getMessageHistoryRows(senderId: string, limit: number) {
    return this.db.prepare(
      "SELECT text, type FROM messages WHERE sender_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
    ).all(senderId, limit) as Array<{ text: string; type: MessageType }>;
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
    const role = input.role;
    const userId = generateEntityId("usr");
    const membershipId = generateEntityId("mem");

    this.db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, is_active)
       VALUES (?, ?, ?, ?, 1)`,
    ).run(userId, username, displayName || username, input.password_hash);

    this.db.prepare(
      `INSERT INTO memberships (id, organization_id, user_id, role)
       VALUES (?, ?, ?, ?)`,
    ).run(membershipId, DEFAULT_ORGANIZATION_ID, userId, role);

    const user = await this.getUserById(userId);
    if (!user) {
      throw new Error("Failed to load newly created user");
    }
    return user;
  }

  async updateUserRole(userId: string, role: UserRole) {
    const result = this.db.prepare(
      "UPDATE memberships SET role = ? WHERE organization_id = ? AND user_id = ?",
    ).run(role, DEFAULT_ORGANIZATION_ID, String(userId || "").trim());
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

  private async ensureDefaultOrganization() {
    this.db.prepare(
      `INSERT OR IGNORE INTO organizations (id, name, slug)
       VALUES (?, ?, ?)`,
    ).run(DEFAULT_ORGANIZATION_ID, DEFAULT_ORGANIZATION_NAME, DEFAULT_ORGANIZATION_SLUG);
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
