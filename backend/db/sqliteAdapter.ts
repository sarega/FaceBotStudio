import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { DEFAULT_EVENT_ID, DEFAULT_SETTINGS_ENTRIES, EVENT_SETTING_KEYS, NEW_EVENT_TEMPLATE_ENTRIES } from "./defaultSettings";
import { hashPassword, normalizeUsername } from "../auth";
import { chunkDocumentContent, getDefaultEmbeddingStatus, getEmbeddingModelName, hashDocumentContent } from "../documents";
import { getEffectiveEventStatus, getEventState } from "../datetime";
import type {
  AppDatabase,
  AuditLogEntryInput,
  AuditLogRow,
  AuthSessionRow,
  AuthUserRow,
  ChannelAccountRow,
  ChannelPlatform,
  CreateEventInput,
  EventDocumentChunkRow,
  EventDocumentRow,
  CreateUserInput,
  EmbeddingStatus,
  EventStatus,
  EventRow,
  FacebookPageRow,
  ManualEventStatus,
  MessageRow,
  MessageType,
  RegistrationInput,
  RegistrationResult,
  RegistrationRow,
  RegistrationStatus,
  SettingRow,
  UpdateEventInput,
  UpsertChannelAccountInput,
  UpsertEventDocumentInput,
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

function mapEventBaseRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    status: (String(row.status || "active") as ManualEventStatus),
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
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

function mapChannelRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    platform: String(row.platform) as ChannelPlatform,
    external_id: String(row.external_id),
    display_name: String(row.display_name),
    event_id: String(row.event_id),
    access_token: typeof row.access_token === "string" ? row.access_token : null,
    config_json: typeof row.config_json === "string" ? row.config_json : "{}",
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  } satisfies ChannelAccountRow;
}

function mapEventDocumentRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    title: String(row.title),
    source_type: String(row.source_type || "note") as EventDocumentRow["source_type"],
    source_url: typeof row.source_url === "string" ? row.source_url : null,
    content: String(row.content || ""),
    is_active: Boolean(row.is_active),
    chunk_count: Number(row.chunk_count || 0),
    content_hash: typeof row.content_hash === "string" ? row.content_hash : null,
    embedding_status: String(row.embedding_status || "pending") as EventDocumentRow["embedding_status"],
    embedding_model: typeof row.embedding_model === "string" ? row.embedding_model : null,
    last_embedded_at: typeof row.last_embedded_at === "string" ? row.last_embedded_at : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  } satisfies EventDocumentRow;
}

function mapEventDocumentChunkRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    document_id: String(row.document_id),
    event_id: String(row.event_id),
    chunk_index: Number(row.chunk_index || 0),
    content: String(row.content || ""),
    content_hash: typeof row.content_hash === "string" ? row.content_hash : null,
    char_count: Number(row.char_count || 0),
    token_estimate: Number(row.token_estimate || 0),
    embedding_status: String(row.embedding_status || "pending") as EventDocumentChunkRow["embedding_status"],
    embedding_model: typeof row.embedding_model === "string" ? row.embedding_model : null,
    embedded_at: typeof row.embedded_at === "string" ? row.embedded_at : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  } satisfies EventDocumentChunkRow;
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
        status TEXT NOT NULL DEFAULT 'active',
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
      CREATE TABLE IF NOT EXISTS channel_accounts (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        event_id TEXT NOT NULL,
        access_token TEXT,
        config_json TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (platform, external_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_documents (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'note',
        source_url TEXT,
        content TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES event_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_event_settings_event_id ON event_settings (event_id);
      CREATE INDEX IF NOT EXISTS idx_facebook_pages_event_id ON facebook_pages (event_id);
      CREATE INDEX IF NOT EXISTS idx_facebook_pages_page_id ON facebook_pages (page_id);
      CREATE INDEX IF NOT EXISTS idx_channel_accounts_event_id ON channel_accounts (event_id);
      CREATE INDEX IF NOT EXISTS idx_channel_accounts_platform ON channel_accounts (platform);
      CREATE INDEX IF NOT EXISTS idx_channel_accounts_external_id ON channel_accounts (external_id);
      CREATE INDEX IF NOT EXISTS idx_event_documents_event_id ON event_documents (event_id);
      CREATE INDEX IF NOT EXISTS idx_event_documents_active ON event_documents (event_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_event_document_chunks_event_id ON event_document_chunks (event_id);
      CREATE INDEX IF NOT EXISTS idx_event_document_chunks_document_id ON event_document_chunks (document_id);
      CREATE INDEX IF NOT EXISTS idx_event_document_chunks_order ON event_document_chunks (document_id, chunk_index);
    `);

    this.ensureColumn("registrations", "event_id", "TEXT");
    this.ensureColumn("messages", "event_id", "TEXT");
    this.ensureColumn("messages", "page_id", "TEXT");
    this.ensureColumn("facebook_pages", "page_access_token", "TEXT");
    this.ensureColumn("channel_accounts", "config_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("event_documents", "source_url", "TEXT");
    this.ensureColumn("event_documents", "content_hash", "TEXT");
    this.ensureColumn("event_documents", "embedding_status", "TEXT DEFAULT 'pending'");
    this.ensureColumn("event_documents", "embedding_model", "TEXT");
    this.ensureColumn("event_documents", "last_embedded_at", "TEXT");
    this.ensureColumn("event_document_chunks", "content_hash", "TEXT");
    this.ensureColumn("event_document_chunks", "char_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("event_document_chunks", "token_estimate", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("event_document_chunks", "embedding_status", "TEXT DEFAULT 'pending'");
    this.ensureColumn("event_document_chunks", "embedding_model", "TEXT");
    this.ensureColumn("event_document_chunks", "embedded_at", "TEXT");
    this.ensureColumn("events", "status", "TEXT NOT NULL DEFAULT 'active'");
    this.db.exec(`
      UPDATE events
      SET status = CASE
        WHEN COALESCE(TRIM(status), '') <> '' THEN status
        WHEN is_active = 1 THEN 'active'
        ELSE 'closed'
      END
    `);

    const insertSetting = this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS_ENTRIES)) {
      insertSetting.run(key, value);
    }

    await this.ensureDefaultOrganization();
    await this.ensureDefaultEvent();
    await this.bootstrapChannelAccounts();
    await this.ensureEventDocumentChunks();
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

  private async hydrateEventRow(baseRow: Record<string, unknown>) {
    const base = mapEventBaseRow(baseRow);
    const settings = await this.getSettingsMap(base.id);
    const effectiveStatus = getEffectiveEventStatus(base.status, settings);
    return {
      ...base,
      effective_status: effectiveStatus,
      is_active: effectiveStatus === "active",
    } satisfies EventRow;
  }

  async getSettingsMap(eventId = DEFAULT_EVENT_ID) {
    const baseRows = this.db.prepare("SELECT key, value FROM settings").all() as SettingRow[];
    const eventRows = this.db.prepare(
      "SELECT key, value FROM event_settings WHERE event_id = ?",
    ).all(eventId) as SettingRow[];

    const settings = baseRows.reduce((acc, row) => {
      if (EVENT_SETTING_KEY_SET.has(row.key)) {
        return acc;
      }
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

    const event = await this.getEventById(eventId);
    if (!event) {
      return { statusCode: 400, content: { error: "Invalid event" } };
    }
    if (event.effective_status === "cancelled") {
      return { statusCode: 400, content: { error: "This event has been cancelled" } };
    }
    if (event.effective_status === "closed") {
      return { statusCode: 400, content: { error: "This event has already ended" } };
    }
    if (event.effective_status === "pending") {
      return { statusCode: 400, content: { error: "This event has not been launched yet" } };
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
    if (eventState.registrationStatus === "invalid") {
      return { statusCode: 400, content: { error: "Registration window is invalid. Close date is earlier than open date." } };
    }
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

  async deleteRegistration(id: string) {
    const result = this.db.prepare("DELETE FROM registrations WHERE id = ?").run(
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
      "SELECT id, name, slug, status, is_default, created_at, updated_at FROM events ORDER BY is_default DESC, created_at ASC",
    ).all() as Array<Record<string, unknown>>;
    return Promise.all(rows.map((row) => this.hydrateEventRow(row)));
  }

  async getEventById(eventId: string) {
    const row = this.db.prepare(
      "SELECT id, name, slug, status, is_default, created_at, updated_at FROM events WHERE id = ?",
    ).get(String(eventId || "").trim()) as Record<string, unknown> | undefined;
    return row ? this.hydrateEventRow(row) : undefined;
  }

  async createEvent(input: CreateEventInput) {
    const id = generateEntityId("evt");
    const baseName = String(input.name || "").trim() || "New Event";
    const slug = this.uniqueEventSlug(baseName);
    this.db.prepare(
      `INSERT INTO events (id, name, slug, status, is_default, is_active, updated_at)
       VALUES (?, ?, ?, 'pending', 0, 1, CURRENT_TIMESTAMP)`,
    ).run(id, baseName, slug);

    await this.upsertSettings(
      Object.fromEntries(EVENT_SETTING_KEYS.map((key) => [key, NEW_EVENT_TEMPLATE_ENTRIES[key] ?? DEFAULT_SETTINGS_ENTRIES[key]])),
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
    if (typeof input.status === "string" && input.status.trim()) {
      updates.push("status = ?");
      values.push(input.status.trim());
    }
    if (!updates.length) return false;
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(String(eventId || "").trim());
    const result = this.db.prepare(`UPDATE events SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  private replaceEventDocumentChunks(documentId: string, eventId: string, content: string, isActive = true) {
    const chunks = chunkDocumentContent(content);
    const embeddingModel = getEmbeddingModelName();
    const embeddingStatus = getDefaultEmbeddingStatus(isActive);
    const deleteStatement = this.db.prepare("DELETE FROM event_document_chunks WHERE document_id = ?");
    const insertStatement = this.db.prepare(
      `INSERT INTO event_document_chunks (
         id, document_id, event_id, chunk_index, content, content_hash, char_count, token_estimate, embedding_status, embedding_model, embedded_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)`,
    );

    const transaction = this.db.transaction(() => {
      deleteStatement.run(documentId);
      for (const chunk of chunks) {
        insertStatement.run(
          generateEntityId("dch"),
          documentId,
          eventId,
          chunk.chunk_index,
          chunk.content,
          chunk.content_hash,
          chunk.char_count,
          chunk.token_estimate,
          embeddingStatus,
          embeddingModel,
        );
      }
    });

    transaction();
  }

  private async ensureEventDocumentChunks() {
    const rows = this.db.prepare(
      `SELECT d.id, d.event_id, d.content, d.is_active
       FROM event_documents d
       LEFT JOIN (
         SELECT document_id, COUNT(*) AS chunk_count
         FROM event_document_chunks
         GROUP BY document_id
       ) counts ON counts.document_id = d.id
       WHERE COALESCE(counts.chunk_count, 0) = 0`,
    ).all() as Array<Record<string, unknown>>;

    for (const row of rows) {
      this.replaceEventDocumentChunks(
        String(row.id),
        String(row.event_id),
        String(row.content || ""),
        Boolean(row.is_active),
      );
    }

    const embeddingModel = getEmbeddingModelName();
    const docsNeedingMetadata = this.db.prepare(
      `SELECT id, content, is_active
       FROM event_documents
       WHERE content_hash IS NULL OR embedding_model IS NULL OR embedding_status IS NULL OR embedding_status = ''`,
    ).all() as Array<Record<string, unknown>>;

    const updateDocumentMetadata = this.db.prepare(
      `UPDATE event_documents
       SET content_hash = ?, embedding_status = ?, embedding_model = ?, last_embedded_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );

    for (const row of docsNeedingMetadata) {
      updateDocumentMetadata.run(
        hashDocumentContent(row.content),
        getDefaultEmbeddingStatus(Boolean(row.is_active)),
        embeddingModel,
        String(row.id),
      );
    }

    const chunksNeedingMetadata = this.db.prepare(
      `SELECT c.id, c.content, d.is_active
       FROM event_document_chunks c
       JOIN event_documents d ON d.id = c.document_id
       WHERE c.content_hash IS NULL
          OR c.char_count = 0
          OR c.token_estimate = 0
          OR c.embedding_model IS NULL
          OR c.embedding_status IS NULL
          OR c.embedding_status = ''`,
    ).all() as Array<Record<string, unknown>>;

    const updateChunkMetadata = this.db.prepare(
      `UPDATE event_document_chunks
       SET content_hash = ?, char_count = ?, token_estimate = ?, embedding_status = ?, embedding_model = ?, embedded_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );

    for (const row of chunksNeedingMetadata) {
      const content = String(row.content || "");
      updateChunkMetadata.run(
        hashDocumentContent(content),
        content.length,
        Math.max(1, Math.ceil(content.length / 4)),
        getDefaultEmbeddingStatus(Boolean(row.is_active)),
        embeddingModel,
        String(row.id),
      );
    }
  }

  async listEventDocuments(eventId: string) {
    const rows = this.db.prepare(
      `SELECT d.id, d.event_id, d.title, d.source_type, d.source_url, d.content, d.is_active,
              d.content_hash, d.embedding_status, d.embedding_model, d.last_embedded_at,
              COALESCE(counts.chunk_count, 0) AS chunk_count,
              d.created_at, d.updated_at
       FROM event_documents d
       LEFT JOIN (
         SELECT document_id, COUNT(*) AS chunk_count
         FROM event_document_chunks
         GROUP BY document_id
       ) counts ON counts.document_id = d.id
       WHERE d.event_id = ?
       ORDER BY d.updated_at DESC, d.created_at DESC`,
    ).all(String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID) as Array<Record<string, unknown>>;
    return rows.map(mapEventDocumentRow);
  }

  async listEventDocumentChunks(eventId: string) {
    const rows = this.db.prepare(
      `SELECT id, document_id, event_id, chunk_index, content, content_hash, char_count, token_estimate,
              embedding_status, embedding_model, embedded_at, created_at, updated_at
       FROM event_document_chunks
       WHERE event_id = ?
       ORDER BY document_id ASC, chunk_index ASC`,
    ).all(String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID) as Array<Record<string, unknown>>;
    return rows.map(mapEventDocumentChunkRow);
  }

  async upsertEventDocument(input: UpsertEventDocumentInput) {
    const id = String(input.id || "").trim() || generateEntityId("doc");
    const eventId = String(input.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const title = String(input.title || "").trim() || "Untitled Document";
    const sourceType = String(input.source_type || "note").trim() || "note";
    const sourceUrl = String(input.source_url || "").trim();
    const content = String(input.content || "").trim();
    const isActive = input.is_active === false ? 0 : 1;
    const contentHash = hashDocumentContent(content);
    const embeddingStatus = getDefaultEmbeddingStatus(Boolean(isActive));
    const embeddingModel = getEmbeddingModelName();

    this.db.prepare(
      `INSERT INTO event_documents (
         id, event_id, title, source_type, source_url, content, is_active, content_hash, embedding_status, embedding_model, last_embedded_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE
       SET event_id = excluded.event_id,
           title = excluded.title,
           source_type = excluded.source_type,
           source_url = excluded.source_url,
           content = excluded.content,
           is_active = excluded.is_active,
           content_hash = excluded.content_hash,
           embedding_status = excluded.embedding_status,
           embedding_model = excluded.embedding_model,
           last_embedded_at = NULL,
           updated_at = CURRENT_TIMESTAMP`,
    ).run(id, eventId, title, sourceType, sourceUrl || null, content, isActive, contentHash, embeddingStatus, embeddingModel);
    this.replaceEventDocumentChunks(id, eventId, content, Boolean(isActive));

    const row = this.db.prepare(
      `SELECT d.id, d.event_id, d.title, d.source_type, d.source_url, d.content, d.is_active,
              d.content_hash, d.embedding_status, d.embedding_model, d.last_embedded_at,
              COALESCE(counts.chunk_count, 0) AS chunk_count,
              d.created_at, d.updated_at
       FROM event_documents d
       LEFT JOIN (
         SELECT document_id, COUNT(*) AS chunk_count
         FROM event_document_chunks
         GROUP BY document_id
       ) counts ON counts.document_id = d.id
       WHERE d.id = ?
       LIMIT 1`,
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Failed to upsert event document");
    return mapEventDocumentRow(row);
  }

  async resetEventKnowledge(eventId: string, options?: { clearContext?: boolean }) {
    const normalizedEventId = String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const clearContext = options?.clearContext !== false;
    let documentsDeleted = 0;
    let chunksDeleted = 0;
    let contextCleared = false;

    const transaction = this.db.transaction(() => {
      const chunkCountRow = this.db.prepare(
        "SELECT COUNT(*) AS count FROM event_document_chunks WHERE event_id = ?",
      ).get(normalizedEventId) as { count?: number } | undefined;
      const documentCountRow = this.db.prepare(
        "SELECT COUNT(*) AS count FROM event_documents WHERE event_id = ?",
      ).get(normalizedEventId) as { count?: number } | undefined;
      let contextChanges = 0;
      if (clearContext) {
        const contextResult = this.db.prepare(
          `INSERT INTO event_settings (event_id, key, value, updated_at)
           VALUES (?, 'context', '', CURRENT_TIMESTAMP)
           ON CONFLICT(event_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        ).run(normalizedEventId);
        contextChanges = contextResult.changes;
      }
      this.db.prepare("DELETE FROM event_document_chunks WHERE event_id = ?").run(normalizedEventId);
      this.db.prepare("DELETE FROM event_documents WHERE event_id = ?").run(normalizedEventId);

      chunksDeleted = Number(chunkCountRow?.count || 0);
      documentsDeleted = Number(documentCountRow?.count || 0);
      contextCleared = clearContext && Boolean(contextChanges);
    });

    transaction();

    return {
      documentsDeleted,
      chunksDeleted,
      contextCleared,
    };
  }

  async setEventDocumentActive(documentId: string, isActive: boolean) {
    const normalizedDocumentId = String(documentId || "").trim();
    const status = getDefaultEmbeddingStatus(isActive);
    const embeddingModel = getEmbeddingModelName();
    let documentResult: Database.RunResult | null = null;
    const transaction = this.db.transaction(() => {
      documentResult = this.db.prepare(
        "UPDATE event_documents SET is_active = ?, embedding_status = ?, embedding_model = COALESCE(embedding_model, ?), last_embedded_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(isActive ? 1 : 0, status, embeddingModel, normalizedDocumentId);
      this.db.prepare(
        "UPDATE event_document_chunks SET embedding_status = ?, embedding_model = COALESCE(embedding_model, ?), embedded_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE document_id = ?",
      ).run(status, embeddingModel, normalizedDocumentId);
    });
    transaction();
    return Boolean(documentResult?.changes);
  }

  async setEventDocumentEmbeddingStatus(
    documentId: string,
    status: EmbeddingStatus,
    options?: { embeddingModel?: string; embeddedAt?: Date | null },
  ) {
    const normalizedDocumentId = String(documentId || "").trim();
    const embeddingModel = String(options?.embeddingModel || getEmbeddingModelName()).trim() || getEmbeddingModelName();
    const embeddedAt = status === "ready" ? (options?.embeddedAt || new Date()).toISOString() : null;
    let documentResult: Database.RunResult | null = null;
    const transaction = this.db.transaction(() => {
      documentResult = this.db.prepare(
        `UPDATE event_documents
         SET embedding_status = ?, embedding_model = ?, last_embedded_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(status, embeddingModel, embeddedAt, normalizedDocumentId);
      this.db.prepare(
        `UPDATE event_document_chunks
         SET embedding_status = ?, embedding_model = ?, embedded_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE document_id = ?`,
      ).run(status, embeddingModel, embeddedAt, normalizedDocumentId);
    });
    transaction();
    return Boolean(documentResult?.changes);
  }

  async listChannelAccounts(platform?: ChannelPlatform) {
    const rows = platform
      ? this.db.prepare(
          "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at, updated_at FROM channel_accounts WHERE platform = ? ORDER BY created_at ASC",
        ).all(platform)
      : this.db.prepare(
          "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at, updated_at FROM channel_accounts ORDER BY created_at ASC",
        ).all();
    return (rows as Array<Record<string, unknown>>).map(mapChannelRow);
  }

  async getChannelAccount(platform: ChannelPlatform, externalId: string) {
    const row = this.db.prepare(
      "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at, updated_at FROM channel_accounts WHERE platform = ? AND external_id = ? LIMIT 1",
    ).get(platform, String(externalId || "").trim()) as Record<string, unknown> | undefined;
    return row ? mapChannelRow(row) : undefined;
  }

  async upsertChannelAccount(input: UpsertChannelAccountInput) {
    const platform = (String(input.platform || "facebook").trim() || "facebook") as ChannelPlatform;
    const externalId = String(input.external_id || "").trim();
    const displayName = String(input.display_name || "").trim() || externalId;
    const eventId = String(input.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const accessToken = String(input.access_token || "").trim();
    const configJson = String(input.config_json || "{}").trim() || "{}";
    const existing = this.db.prepare(
      "SELECT id FROM channel_accounts WHERE platform = ? AND external_id = ?",
    ).get(platform, externalId) as { id?: string } | undefined;
    const id = existing?.id || generateEntityId("chn");

    this.db.prepare(
      `INSERT INTO channel_accounts (id, platform, external_id, display_name, event_id, access_token, config_json, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(platform, external_id) DO UPDATE
       SET display_name = excluded.display_name,
           event_id = excluded.event_id,
           access_token = COALESCE(NULLIF(excluded.access_token, ''), channel_accounts.access_token),
           config_json = excluded.config_json,
           is_active = excluded.is_active,
           updated_at = CURRENT_TIMESTAMP`,
    ).run(id, platform, externalId, displayName, eventId, accessToken, configJson, input.is_active === false ? 0 : 1);

    const row = this.db.prepare(
      "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at, updated_at FROM channel_accounts WHERE platform = ? AND external_id = ? LIMIT 1",
    ).get(platform, externalId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Failed to upsert channel account");
    return mapChannelRow(row);
  }

  async resolveEventIdForChannel(platform: ChannelPlatform, externalId: string) {
    const row = this.db.prepare(
      "SELECT event_id FROM channel_accounts WHERE platform = ? AND external_id = ? AND is_active = 1 LIMIT 1",
    ).get(platform, String(externalId || "").trim()) as { event_id?: string } | undefined;
    return row?.event_id;
  }

  async listFacebookPages() {
    const channels = await this.listChannelAccounts("facebook");
    return channels.map((channel) => ({
      id: channel.id,
      page_id: channel.external_id,
      page_name: channel.display_name,
      event_id: channel.event_id,
      page_access_token: channel.access_token ?? null,
      is_active: channel.is_active,
      created_at: channel.created_at,
      updated_at: channel.updated_at,
    } satisfies FacebookPageRow));
  }

  async getFacebookPageByPageId(pageId: string) {
    const channel = await this.getChannelAccount("facebook", pageId);
    return channel
      ? {
          id: channel.id,
          page_id: channel.external_id,
          page_name: channel.display_name,
          event_id: channel.event_id,
          page_access_token: channel.access_token ?? null,
          is_active: channel.is_active,
          created_at: channel.created_at,
          updated_at: channel.updated_at,
        }
      : undefined;
  }

  async upsertFacebookPage(input: UpsertFacebookPageInput) {
    const channel = await this.upsertChannelAccount({
      platform: "facebook",
      external_id: input.page_id,
      display_name: input.page_name,
      event_id: input.event_id,
      access_token: input.page_access_token,
      is_active: input.is_active,
    });
    return {
      id: channel.id,
      page_id: channel.external_id,
      page_name: channel.display_name,
      event_id: channel.event_id,
      page_access_token: channel.access_token ?? null,
      is_active: channel.is_active,
      created_at: channel.created_at,
      updated_at: channel.updated_at,
    } satisfies FacebookPageRow;
  }

  async resolveEventIdForPage(pageId: string) {
    return this.resolveEventIdForChannel("facebook", pageId);
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
      `INSERT OR IGNORE INTO events (id, name, slug, status, is_default, is_active)
       VALUES (?, ?, ?, 'active', 1, 1)`,
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

  private async bootstrapChannelAccounts() {
    const rows = this.db.prepare(
      "SELECT id, page_id, page_name, event_id, page_access_token, is_active, created_at, updated_at FROM facebook_pages",
    ).all() as Array<Record<string, unknown>>;

    const upsert = this.db.prepare(
      `INSERT INTO channel_accounts (id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at, updated_at)
       VALUES (?, 'facebook', ?, ?, ?, ?, '{}', ?, ?, ?)
       ON CONFLICT(platform, external_id) DO UPDATE
       SET display_name = excluded.display_name,
           event_id = excluded.event_id,
           access_token = COALESCE(NULLIF(excluded.access_token, ''), channel_accounts.access_token),
           is_active = excluded.is_active,
           updated_at = CURRENT_TIMESTAMP`,
    );

    for (const row of rows) {
      upsert.run(
        String(row.id),
        String(row.page_id),
        String(row.page_name),
        String(row.event_id),
        typeof row.page_access_token === "string" ? row.page_access_token : "",
        Boolean(row.is_active) ? 1 : 0,
        String(row.created_at),
        String(row.updated_at),
      );
    }
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
