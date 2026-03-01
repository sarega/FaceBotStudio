import Database from "better-sqlite3";
import { DEFAULT_SETTINGS_ENTRIES } from "./defaultSettings";
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
    `);

    const insertSetting = this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS_ENTRIES)) {
      insertSetting.run(key, value);
    }

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
}
