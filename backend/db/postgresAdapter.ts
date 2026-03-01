import Database from "better-sqlite3";
import { existsSync } from "fs";
import { Pool } from "pg";
import { DEFAULT_SETTINGS_ENTRIES } from "./defaultSettings";
import { runPostgresMigrations } from "./migrate";
import type {
  AppDatabase,
  MessageRow,
  MessageType,
  RegistrationInput,
  RegistrationResult,
  RegistrationRow,
  RegistrationStatus,
  SettingRow,
} from "./types";

function generateRegistrationId() {
  return `REG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)` ,
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
