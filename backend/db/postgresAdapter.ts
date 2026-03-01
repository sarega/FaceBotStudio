import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { Pool } from "pg";
import { hashPassword, normalizeUsername } from "../auth";
import { DEFAULT_SETTINGS_ENTRIES } from "./defaultSettings";
import { runPostgresMigrations } from "./migrate";
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
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export class PostgresAppDatabase implements AppDatabase {
  public readonly driver = "postgres" as const;

  private initialized = false;
  private readonly pool: Pool;
  private readonly sqliteBootstrapPath?: string;

  constructor(databaseUrl: string, sqliteBootstrapPath?: string) {
    const shouldUseSsl =
      process.env.PGSSLMODE !== "disable" &&
      !/localhost|127\.0\.0\.1/i.test(databaseUrl);

    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
      max: Number(process.env.PGPOOL_MAX || 10),
    });
    this.sqliteBootstrapPath = sqliteBootstrapPath;
  }

  async initialize() {
    if (this.initialized) return;
    await runPostgresMigrations(this.pool);
    await this.bootstrapFromLegacySqliteIfEmpty();
    await this.seedDefaultSettings();
    await this.ensureDefaultOrganization();
    await this.ensureBootstrapOwner();
    await this.deleteExpiredSessions();
    this.initialized = true;
  }

  async ping() {
    await this.pool.query("SELECT 1");
  }

  async close() {
    await this.pool.end();
  }

  async getSettingsMap() {
    const result = await this.pool.query<SettingRow>("SELECT key, value FROM settings");
    return result.rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);
  }

  async getSettingValue(key: string) {
    const result = await this.pool.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
    return result.rows[0]?.value;
  }

  async upsertSettings(entries: Record<string, string>) {
    const values = Object.entries(entries);
    if (values.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, value] of values) {
        await client.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, String(value)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getRegistrationById(id: string) {
    const result = await this.pool.query<RegistrationRow>(
      "SELECT id, sender_id, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations WHERE id = $1",
      [id],
    );
    return result.rows[0];
  }

  async listRegistrations(limit?: number) {
    const result = typeof limit === "number"
      ? await this.pool.query<RegistrationRow>(
          "SELECT id, sender_id, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations ORDER BY timestamp DESC LIMIT $1",
          [limit],
        )
      : await this.pool.query<RegistrationRow>(
          "SELECT id, sender_id, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations ORDER BY timestamp DESC",
        );
    return result.rows;
  }

  async exportRegistrations() {
    return this.listRegistrations();
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

    const settings = await this.getSettingsMap();
    const countResult = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM registrations WHERE status != 'cancelled'",
    );
    const activeCount = Number.parseInt(countResult.rows[0]?.count || "0", 10);
    const limit = Number.parseInt(settings.reg_limit || "200", 10);
    if (activeCount >= limit) {
      return { statusCode: 400, content: { error: "Registration limit reached" } };
    }

    const now = new Date();
    const start = new Date(settings.reg_start || "");
    const end = new Date(settings.reg_end || "");

    if (!Number.isNaN(start.getTime()) && now < start) {
      return { statusCode: 400, content: { error: "Registration has not started yet" } };
    }
    if (!Number.isNaN(end.getTime()) && now > end) {
      return { statusCode: 400, content: { error: "Registration has closed" } };
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = generateRegistrationId();
      try {
        await this.pool.query(
          `INSERT INTO registrations (id, sender_id, first_name, last_name, phone, email)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, senderId, firstName, lastName, phone, email],
        );
        return { statusCode: 200, content: { id, status: "success" } };
      } catch (error: any) {
        if (error?.code === "23505") continue;
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

    const updated = await this.updateRegistrationStatus(registrationId, "cancelled");
    if (updated) {
      return { statusCode: 200, content: { status: "success" } };
    }
    return { statusCode: 404, content: { error: "Registration not found" } };
  }

  async checkInRegistration(id: string) {
    const result = await this.pool.query(
      "UPDATE registrations SET status = 'checked-in' WHERE id = $1 AND status != 'cancelled'",
      [String(id || "").trim().toUpperCase()],
    );
    return result.rowCount > 0;
  }

  async updateRegistrationStatus(id: string, status: RegistrationStatus) {
    const result = await this.pool.query("UPDATE registrations SET status = $1 WHERE id = $2", [
      status,
      String(id || "").trim().toUpperCase(),
    ]);
    return result.rowCount > 0;
  }

  async saveMessage(senderId: string, text: string, type: MessageType) {
    await this.pool.query(
      "INSERT INTO messages (sender_id, text, type) VALUES ($1, $2, $3)",
      [senderId, text, type],
    );
  }

  async listMessages(limit: number) {
    const result = await this.pool.query<MessageRow>(
      "SELECT id, sender_id, text, timestamp::text AS timestamp, type FROM messages ORDER BY timestamp DESC, id DESC LIMIT $1",
      [limit],
    );
    return result.rows;
  }

  async getMessageHistoryRows(senderId: string, limit: number) {
    const result = await this.pool.query<{ text: string; type: MessageType }>(
      "SELECT text, type FROM messages WHERE sender_id = $1 ORDER BY timestamp DESC, id DESC LIMIT $2",
      [senderId, limit],
    );
    return result.rows;
  }

  async getUserByUsername(username: string) {
    return this.queryAuthUser("u.username = $1", [normalizeUsername(username)]);
  }

  async getUserById(userId: string) {
    return this.queryAuthUser("u.id = $1", [String(userId || "").trim()]);
  }

  async getUserPasswordHash(username: string) {
    const result = await this.pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE username = $1",
      [normalizeUsername(username)],
    );
    return result.rows[0]?.password_hash;
  }

  async listUsers() {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
        u.id,
        u.username,
        u.display_name,
        u.is_active,
        u.created_at::text AS created_at,
        u.last_login_at::text AS last_login_at,
        m.role,
        o.id AS organization_id,
        o.name AS organization_name
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN organizations o ON o.id = m.organization_id
       ORDER BY u.created_at ASC, u.username ASC`,
    );
    return result.rows.map((row) => this.mapAuthUserRow(row));
  }

  async createUser(input: CreateUserInput) {
    const username = normalizeUsername(input.username);
    const displayName = String(input.display_name || "").trim() || username;
    const userId = generateEntityId("usr");
    const membershipId = generateEntityId("mem");
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users (id, username, display_name, password_hash, is_active)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [userId, username, displayName, input.password_hash],
      );
      await client.query(
        `INSERT INTO memberships (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, $4)`,
        [membershipId, DEFAULT_ORGANIZATION_ID, userId, input.role],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const user = await this.getUserById(userId);
    if (!user) {
      throw new Error("Failed to load newly created user");
    }
    return user;
  }

  async updateUserRole(userId: string, role: UserRole) {
    const result = await this.pool.query(
      "UPDATE memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3",
      [role, DEFAULT_ORGANIZATION_ID, String(userId || "").trim()],
    );
    return result.rowCount > 0;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    await this.pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [generateEntityId("ses"), String(userId || "").trim(), tokenHash, expiresAt.toISOString()],
    );
  }

  async getSessionWithUser(tokenHash: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
        s.id AS session_id,
        s.token_hash,
        s.expires_at::text AS expires_at,
        s.last_seen_at::text AS last_seen_at,
        u.id,
        u.username,
        u.display_name,
        u.is_active,
        u.created_at::text AS created_at,
        u.last_login_at::text AS last_login_at,
        m.role,
        o.id AS organization_id,
        o.name AS organization_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = u.id
       JOIN organizations o ON o.id = m.organization_id
       WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [tokenHash],
    );

    const row = result.rows[0];
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
    await this.pool.query("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1", [String(sessionId || "").trim()]);
  }

  async deleteSession(tokenHash: string) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [String(tokenHash || "").trim()]);
  }

  async deleteExpiredSessions() {
    await this.pool.query("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP");
  }

  async updateUserLastLogin(userId: string) {
    await this.pool.query(
      "UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [String(userId || "").trim()],
    );
  }

  async recordAuditLog(entry: AuditLogEntryInput) {
    await this.pool.query(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        entry.actor_user_id || null,
        entry.action,
        entry.target_type || null,
        entry.target_id || null,
        JSON.stringify(entry.metadata || {}),
      ],
    );
  }

  async listAuditLogs(limit: number) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
        a.id,
        a.action,
        a.actor_user_id,
        u.username AS actor_username,
        a.target_type,
        a.target_id,
        a.metadata,
        a.created_at::text AS created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => ({
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

  private async seedDefaultSettings() {
    const entries = Object.entries(DEFAULT_SETTINGS_ENTRIES);
    if (!entries.length) return;

    for (const [key, value] of entries) {
      await this.pool.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
        [key, value],
      );
    }
  }

  private async ensureDefaultOrganization() {
    await this.pool.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_ORGANIZATION_ID, DEFAULT_ORGANIZATION_NAME, DEFAULT_ORGANIZATION_SLUG],
    );
  }

  private async ensureBootstrapOwner() {
    const username = normalizeUsername(process.env.ADMIN_USER);
    const password = String(process.env.ADMIN_PASS || "");
    if (!username || !password) return;

    const displayName = String(process.env.ADMIN_DISPLAY_NAME || username).trim() || username;
    const passwordHash = hashPassword(password);
    const existing = await this.pool.query<{ id: string }>("SELECT id FROM users WHERE username = $1", [username]);

    if (existing.rows[0]?.id) {
      const userId = existing.rows[0].id;
      await this.pool.query(
        `UPDATE users
         SET display_name = $1, password_hash = $2, is_active = TRUE, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [displayName, passwordHash, userId],
      );
      await this.pool.query(
        `INSERT INTO memberships (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'owner')
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [generateEntityId("mem"), DEFAULT_ORGANIZATION_ID, userId],
      );
      await this.pool.query(
        "UPDATE memberships SET role = 'owner' WHERE organization_id = $1 AND user_id = $2",
        [DEFAULT_ORGANIZATION_ID, userId],
      );
      return;
    }

    const userId = generateEntityId("usr");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users (id, username, display_name, password_hash, is_active)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [userId, username, displayName, passwordHash],
      );
      await client.query(
        `INSERT INTO memberships (id, organization_id, user_id, role)
         VALUES ($1, $2, $3, 'owner')`,
        [generateEntityId("mem"), DEFAULT_ORGANIZATION_ID, userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async queryAuthUser(whereClause: string, values: unknown[]) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
        u.id,
        u.username,
        u.display_name,
        u.is_active,
        u.created_at::text AS created_at,
        u.last_login_at::text AS last_login_at,
        m.role,
        o.id AS organization_id,
        o.name AS organization_name
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN organizations o ON o.id = m.organization_id
       WHERE ${whereClause}
       LIMIT 1`,
      values,
    );
    const row = result.rows[0];
    return row ? this.mapAuthUserRow(row) : undefined;
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

  private async bootstrapFromLegacySqliteIfEmpty() {
    if (!this.sqliteBootstrapPath || !existsSync(this.sqliteBootstrapPath)) return;

    const counts = await Promise.all([
      this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM settings"),
      this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM messages"),
      this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM registrations"),
    ]);
    const totalRows = counts.reduce((sum, result) => sum + Number.parseInt(result.rows[0]?.count || "0", 10), 0);
    if (totalRows > 0) return;

    const legacyDb = new Database(this.sqliteBootstrapPath, { readonly: true, fileMustExist: true });
    try {
      const legacySettings = legacyDb.prepare("SELECT key, value FROM settings").all() as SettingRow[];
      const legacyMessages = legacyDb.prepare("SELECT sender_id, text, timestamp, type FROM messages ORDER BY id ASC").all() as Array<{
        sender_id: string;
        text: string;
        timestamp: string;
        type: MessageType;
      }>;
      const legacyRegistrations = legacyDb.prepare(
        "SELECT id, sender_id, first_name, last_name, phone, email, timestamp, status FROM registrations ORDER BY timestamp ASC",
      ).all() as RegistrationRow[];

      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        for (const row of legacySettings) {
          await client.query(
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
            [row.key, row.value],
          );
        }
        for (const row of legacyMessages) {
          await client.query(
            "INSERT INTO messages (sender_id, text, timestamp, type) VALUES ($1, $2, $3, $4)",
            [row.sender_id, row.text, row.timestamp, row.type],
          );
        }
        for (const row of legacyRegistrations) {
          await client.query(
            `INSERT INTO registrations (id, sender_id, first_name, last_name, phone, email, timestamp, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              row.id,
              row.sender_id,
              row.first_name,
              row.last_name,
              row.phone,
              row.email,
              row.timestamp,
              row.status,
            ],
          );
        }
        await client.query("COMMIT");
        console.log(
          `[db] Bootstrapped Postgres from SQLite: ${legacySettings.length} settings, ${legacyMessages.length} messages, ${legacyRegistrations.length} registrations`,
        );
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("[db] Failed to bootstrap Postgres from legacy SQLite:", error);
      throw error;
    } finally {
      legacyDb.close();
    }
  }
}
