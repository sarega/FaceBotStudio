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
  CheckinAccessSessionRow,
  CheckinSessionRow,
  CreateRegistrationEmailDeliveryInput,
  CreateEventInput,
  CreateCheckinSessionInput,
  ExchangeCheckinSessionTokenInput,
  EventDocumentChunkEmbeddingRow,
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
  LlmUsageModelSummaryRow,
  LlmUsageSummaryRow,
  LlmUsageTotalsRow,
  PersistChunkEmbeddingInput,
  RecordLlmUsageInput,
  RegistrationInput,
  RegistrationEmailDeliveryRow,
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
const EVENT_ASSIGNMENT_RESTRICTED_ROLES: UserRole[] = ["operator", "checker", "viewer"];

function generateRegistrationId() {
  return `REG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function generateEntityId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function parseRegistrationLimit(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeRegistrationNamePart(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeRegistrationNameKey(firstName: unknown, lastName: unknown) {
  return `${normalizeRegistrationNamePart(firstName).toLowerCase()}|${normalizeRegistrationNamePart(lastName).toLowerCase()}`;
}

function isTruthySettingValue(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
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

function parseEmbeddingVector(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const vector = parsed
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    return vector.length > 0 ? vector : null;
  } catch {
    return null;
  }
}

function emptyLlmUsageTotals(): LlmUsageTotalsRow {
  return {
    request_count: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    last_used_at: null,
  };
}

function mapLlmUsageTotalsRow(row?: Record<string, unknown>) {
  if (!row) return emptyLlmUsageTotals();
  return {
    request_count: Number(row.request_count || 0),
    prompt_tokens: Number(row.prompt_tokens || 0),
    completion_tokens: Number(row.completion_tokens || 0),
    total_tokens: Number(row.total_tokens || 0),
    estimated_cost_usd: Number(row.estimated_cost_usd || 0),
    last_used_at: typeof row.last_used_at === "string" ? row.last_used_at : null,
  } satisfies LlmUsageTotalsRow;
}

function mapLlmUsageModelSummaryRow(row: Record<string, unknown>) {
  return {
    provider: String(row.provider || "openrouter"),
    model: String(row.model || ""),
    ...mapLlmUsageTotalsRow(row),
  } satisfies LlmUsageModelSummaryRow;
}

function mapRegistrationEmailDeliveryRow(row?: Record<string, unknown>) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    registration_id: String(row.registration_id || ""),
    event_id: String(row.event_id || ""),
    recipient_email: String(row.recipient_email || ""),
    kind: String(row.kind || ""),
    provider: typeof row.provider === "string" && row.provider ? row.provider : null,
    status: String(row.status || "queued") as RegistrationEmailDeliveryRow["status"],
    subject: String(row.subject || ""),
    error_message: typeof row.error_message === "string" && row.error_message ? row.error_message : null,
    queued_at: String(row.queued_at || ""),
    sent_at: typeof row.sent_at === "string" && row.sent_at ? row.sent_at : null,
    updated_at: String(row.updated_at || row.queued_at || ""),
  } satisfies RegistrationEmailDeliveryRow;
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
    event_id: row.event_id == null ? null : String(row.event_id),
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
    event_id: row.event_id == null ? null : String(row.event_id),
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

function mapEventDocumentChunkEmbeddingRow(row: Record<string, unknown>) {
  const vector = parseEmbeddingVector(row.embedding_vector);
  return {
    ...mapEventDocumentChunkRow(row),
    embedding_vector: vector,
    embedding_dimensions: Number(row.embedding_dimensions || vector?.length || 0) || null,
  } satisfies EventDocumentChunkEmbeddingRow;
}

function mapCheckinSessionRow(row: Record<string, unknown>) {
  const revokedAt = typeof row.revoked_at === "string" ? row.revoked_at : null;
  const exchangedAt = typeof row.exchanged_at === "string" ? row.exchanged_at : null;
  const expiresAt = String(row.expires_at || "");
  const expiresAtMs = Number.isFinite(Date.parse(expiresAt)) ? Date.parse(expiresAt) : 0;
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    created_by_user_id: typeof row.created_by_user_id === "string" ? row.created_by_user_id : null,
    label: String(row.label || ""),
    created_at: String(row.created_at || ""),
    expires_at: expiresAt,
    last_used_at: typeof row.last_used_at === "string" ? row.last_used_at : null,
    exchanged_at: exchangedAt,
    revoked_at: revokedAt,
    is_active: !revokedAt && !exchangedAt && expiresAtMs > Date.now(),
  } satisfies CheckinSessionRow;
}

function mapCheckinAccessSessionRow(row: Record<string, unknown>) {
  const revokedAt = typeof row.revoked_at === "string" ? row.revoked_at : null;
  const expiresAt = String(row.expires_at || "");
  const expiresAtMs = Number.isFinite(Date.parse(expiresAt)) ? Date.parse(expiresAt) : 0;
  return {
    id: String(row.id),
    checkin_session_id: String(row.checkin_session_id || ""),
    event_id: String(row.event_id || ""),
    label: String(row.label || ""),
    created_at: String(row.created_at || ""),
    expires_at: expiresAt,
    last_used_at: typeof row.last_used_at === "string" ? row.last_used_at : null,
    revoked_at: revokedAt,
    is_active: !revokedAt && expiresAtMs > Date.now(),
  } satisfies CheckinAccessSessionRow;
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
      CREATE TABLE IF NOT EXISTS registration_email_deliveries (
        id TEXT PRIMARY KEY,
        registration_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        kind TEXT NOT NULL,
        provider TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        subject TEXT NOT NULL DEFAULT '',
        error_message TEXT,
        queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (registration_id, kind),
        FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
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
      CREATE TABLE IF NOT EXISTS user_event_assignments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, event_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
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
      CREATE TABLE IF NOT EXISTS checkin_sessions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        created_by_user_id TEXT,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        last_used_at DATETIME,
        exchanged_at DATETIME,
        revoked_at DATETIME,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS checkin_access_sessions (
        id TEXT PRIMARY KEY,
        checkin_session_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        last_used_at DATETIME,
        revoked_at DATETIME,
        FOREIGN KEY (checkin_session_id) REFERENCES checkin_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
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
      CREATE TABLE IF NOT EXISTS llm_usage_events (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        actor_user_id TEXT,
        source TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
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
      CREATE TABLE IF NOT EXISTS channel_event_assignments (
        channel_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (channel_id) REFERENCES channel_accounts(id) ON DELETE CASCADE,
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
      CREATE INDEX IF NOT EXISTS idx_checkin_sessions_token_hash ON checkin_sessions (token_hash);
      CREATE INDEX IF NOT EXISTS idx_checkin_sessions_expires_at ON checkin_sessions (expires_at);
      CREATE INDEX IF NOT EXISTS idx_checkin_sessions_event_id ON checkin_sessions (event_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_checkin_access_sessions_token_hash ON checkin_access_sessions (token_hash);
      CREATE INDEX IF NOT EXISTS idx_checkin_access_sessions_session_id ON checkin_access_sessions (checkin_session_id);
      CREATE INDEX IF NOT EXISTS idx_checkin_access_sessions_expires_at ON checkin_access_sessions (expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_events_event_created_at ON llm_usage_events (event_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_events_created_at ON llm_usage_events (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_events_model ON llm_usage_events (provider, model);
      CREATE INDEX IF NOT EXISTS idx_registration_email_deliveries_event_status
        ON registration_email_deliveries (event_id, status, queued_at DESC);
      CREATE INDEX IF NOT EXISTS idx_event_settings_event_id ON event_settings (event_id);
      CREATE INDEX IF NOT EXISTS idx_facebook_pages_event_id ON facebook_pages (event_id);
      CREATE INDEX IF NOT EXISTS idx_facebook_pages_page_id ON facebook_pages (page_id);
      CREATE INDEX IF NOT EXISTS idx_channel_accounts_event_id ON channel_accounts (event_id);
      CREATE INDEX IF NOT EXISTS idx_channel_accounts_platform ON channel_accounts (platform);
      CREATE INDEX IF NOT EXISTS idx_channel_accounts_external_id ON channel_accounts (external_id);
      CREATE INDEX IF NOT EXISTS idx_channel_event_assignments_event_id ON channel_event_assignments (event_id);
      CREATE INDEX IF NOT EXISTS idx_event_documents_event_id ON event_documents (event_id);
      CREATE INDEX IF NOT EXISTS idx_event_documents_active ON event_documents (event_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_event_document_chunks_event_id ON event_document_chunks (event_id);
      CREATE INDEX IF NOT EXISTS idx_event_document_chunks_document_id ON event_document_chunks (document_id);
      CREATE INDEX IF NOT EXISTS idx_event_document_chunks_order ON event_document_chunks (document_id, chunk_index);
      CREATE INDEX IF NOT EXISTS idx_user_event_assignments_user_id ON user_event_assignments (user_id);
      CREATE INDEX IF NOT EXISTS idx_user_event_assignments_event_id ON user_event_assignments (event_id);
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
    this.ensureColumn("event_document_chunks", "embedding_vector", "TEXT");
    this.ensureColumn("event_document_chunks", "embedding_dimensions", "INTEGER");
    this.ensureColumn("events", "status", "TEXT NOT NULL DEFAULT 'active'");
    this.ensureColumn("checkin_sessions", "exchanged_at", "DATETIME");
    this.db.exec(`
      INSERT OR IGNORE INTO channel_event_assignments (channel_id, event_id)
      SELECT id, event_id
      FROM channel_accounts
      WHERE event_id IS NOT NULL AND TRIM(event_id) <> '';

      UPDATE events
      SET status = CASE
        WHEN COALESCE(TRIM(status), '') <> '' THEN status
        WHEN is_active = 1 THEN 'active'
        ELSE 'closed'
      END
    `);
    this.db.exec(`
      UPDATE event_document_chunks
      SET embedding_status = 'pending',
          embedded_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE embedding_status = 'ready'
        AND (embedding_vector IS NULL OR COALESCE(embedding_dimensions, 0) = 0);

      UPDATE event_documents
      SET embedding_status = 'pending',
          last_embedded_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE embedding_status = 'ready'
        AND EXISTS (
          SELECT 1
          FROM event_document_chunks c
          WHERE c.document_id = event_documents.id
            AND (c.embedding_vector IS NULL OR COALESCE(c.embedding_dimensions, 0) = 0)
        );
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
    await this.bootstrapEventAssignmentsIfEmpty();
    await this.deleteExpiredSessions();
    await this.deleteExpiredCheckinSessions();
    await this.deleteExpiredCheckinAccessSessions();

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
    const eventState = getEventState(settings);
    const counts = this.db.prepare(
      `SELECT
         SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS active_count,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
       FROM registrations
       WHERE event_id = ?`,
    ).get(base.id) as { active_count?: number | null; cancelled_count?: number | null };
    const activeCount = Number(counts.active_count || 0);
    const cancelledCount = Number(counts.cancelled_count || 0);
    const registrationLimit = parseRegistrationLimit(settings.reg_limit);
    const isCapacityFull = registrationLimit !== null && activeCount >= registrationLimit;
    const remainingSeats = registrationLimit === null ? null : Math.max(registrationLimit - activeCount, 0);
    return {
      ...base,
      effective_status: effectiveStatus,
      registration_availability: eventState.registrationStatus === "open" && isCapacityFull ? "full" : eventState.registrationStatus,
      registration_limit: registrationLimit,
      active_registration_count: activeCount,
      cancelled_registration_count: cancelledCount,
      remaining_seats: remainingSeats,
      is_capacity_full: isCapacityFull,
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

  async listRegistrationsBySenderIds(senderIds: string[], eventId?: string) {
    const normalizedSenderIds = [...new Set(
      senderIds
        .map((senderId) => String(senderId || "").trim())
        .filter(Boolean),
    )];
    if (normalizedSenderIds.length === 0) {
      return [] as RegistrationRow[];
    }

    const placeholders = normalizedSenderIds.map(() => "?").join(", ");
    if (eventId) {
      const statement = this.db.prepare(
        `SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp, status
         FROM registrations
         WHERE event_id = ? AND sender_id IN (${placeholders})
         ORDER BY timestamp DESC, id DESC`,
      );
      return statement.all(eventId, ...normalizedSenderIds) as RegistrationRow[];
    }

    const statement = this.db.prepare(
      `SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp, status
       FROM registrations
       WHERE sender_id IN (${placeholders})
       ORDER BY timestamp DESC, id DESC`,
    );
    return statement.all(...normalizedSenderIds) as RegistrationRow[];
  }

  async exportRegistrations(eventId?: string) {
    return this.listRegistrations(undefined, eventId);
  }

  async createRegistration(input: RegistrationInput): Promise<RegistrationResult> {
    const senderId = String(input.sender_id || "").trim();
    const eventId = String(input.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const firstName = normalizeRegistrationNamePart(input.first_name);
    const lastName = normalizeRegistrationNamePart(input.last_name);
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
    if (event.effective_status === "inactive") {
      return { statusCode: 400, content: { error: "This event is currently inactive" } };
    }

    const settings = await this.getSettingsMap(eventId);
    const activeRows = this.db.prepare(
      "SELECT id, first_name, last_name FROM registrations WHERE event_id = ? AND status != 'cancelled'",
    ).all(eventId) as Array<{ id: string; first_name: string; last_name: string }>;
    const enforceUniqueName = settings.reg_unique_name == null || isTruthySettingValue(settings.reg_unique_name);
    if (enforceUniqueName) {
      const nameKey = normalizeRegistrationNameKey(firstName, lastName);
      const duplicate = activeRows.find((row) => normalizeRegistrationNameKey(row.first_name, row.last_name) === nameKey);
      if (duplicate?.id) {
        return {
          statusCode: 409,
          content: {
            error: "An attendee with this first and last name is already registered for this event",
            duplicate_registration_id: String(duplicate.id || "").trim().toUpperCase(),
          },
        };
      }
    }

    const limit = parseRegistrationLimit(settings.reg_limit);
    if (limit !== null && activeRows.length >= limit) {
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

  async createRegistrationEmailDelivery(input: CreateRegistrationEmailDeliveryInput) {
    const registrationId = String(input.registration_id || "").trim().toUpperCase();
    const eventId = String(input.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const recipientEmail = String(input.recipient_email || "").trim();
    const kind = String(input.kind || "").trim() || "confirmation";
    const subject = String(input.subject || "").trim();
    const provider = input.provider == null ? null : String(input.provider).trim() || null;
    if (!registrationId || !recipientEmail || !subject) return null;

    const id = generateEntityId("eml");
    const result = this.db.prepare(
      `INSERT OR IGNORE INTO registration_email_deliveries (
        id, registration_id, event_id, recipient_email, kind, provider, status, subject
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
    ).run(id, registrationId, eventId, recipientEmail, kind, provider, subject);
    if (!result.changes) {
      return null;
    }

    const row = this.db.prepare(
      `SELECT id, registration_id, event_id, recipient_email, kind, provider, status, subject, error_message, queued_at, sent_at, updated_at
       FROM registration_email_deliveries
       WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;

    return mapRegistrationEmailDeliveryRow(row);
  }

  async markRegistrationEmailDeliverySent(id: string, provider?: string | null) {
    this.db.prepare(
      `UPDATE registration_email_deliveries
       SET status = 'sent',
           provider = COALESCE(?, provider),
           error_message = NULL,
           sent_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(provider == null ? null : String(provider).trim() || null, String(id || "").trim());
  }

  async markRegistrationEmailDeliveryFailed(id: string, errorMessage: string, provider?: string | null) {
    this.db.prepare(
      `UPDATE registration_email_deliveries
       SET status = 'failed',
           provider = COALESCE(?, provider),
           error_message = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      provider == null ? null : String(provider).trim() || null,
      String(errorMessage || "").trim().slice(0, 1000),
      String(id || "").trim(),
    );
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

  async listMessages(limit: number, eventId?: string, beforeId?: number) {
    const hasBeforeId = Number.isFinite(beforeId) && Number(beforeId) > 0;
    const normalizedBeforeId = hasBeforeId ? Math.trunc(Number(beforeId)) : 0;
    if (eventId) {
      if (hasBeforeId) {
        return this.db.prepare(
          "SELECT id, sender_id, event_id, page_id, text, timestamp, type FROM messages WHERE event_id = ? AND id < ? ORDER BY timestamp DESC, id DESC LIMIT ?",
        ).all(eventId, normalizedBeforeId, limit) as MessageRow[];
      }
      return this.db.prepare(
        "SELECT id, sender_id, event_id, page_id, text, timestamp, type FROM messages WHERE event_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
      ).all(eventId, limit) as MessageRow[];
    }
    if (hasBeforeId) {
      return this.db.prepare(
        "SELECT id, sender_id, event_id, page_id, text, timestamp, type FROM messages WHERE id < ? ORDER BY timestamp DESC, id DESC LIMIT ?",
      ).all(normalizedBeforeId, limit) as MessageRow[];
    }
    return this.db.prepare(
      "SELECT id, sender_id, event_id, page_id, text, timestamp, type FROM messages ORDER BY timestamp DESC, id DESC LIMIT ?",
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

  async getConversationRowsForSender(senderId: string, limit: number, eventId?: string) {
    if (eventId) {
      return this.db.prepare(
        "SELECT id, sender_id, event_id, page_id, text, timestamp, type FROM messages WHERE sender_id = ? AND event_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
      ).all(senderId, eventId, limit) as MessageRow[];
    }
    return this.db.prepare(
      "SELECT id, sender_id, event_id, page_id, text, timestamp, type FROM messages WHERE sender_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
    ).all(senderId, limit) as MessageRow[];
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
    await this.assignEventToAllRestrictedUsers(id);

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

  async listEventDocumentChunkEmbeddings(eventId: string) {
    const rows = this.db.prepare(
      `SELECT id, document_id, event_id, chunk_index, content, content_hash, char_count, token_estimate,
              embedding_status, embedding_model, embedded_at, embedding_vector, embedding_dimensions,
              created_at, updated_at
       FROM event_document_chunks
       WHERE event_id = ?
       ORDER BY document_id ASC, chunk_index ASC`,
    ).all(String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID) as Array<Record<string, unknown>>;
    return rows.map(mapEventDocumentChunkEmbeddingRow);
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

  async saveEventDocumentChunkEmbeddings(
    documentId: string,
    embeddings: PersistChunkEmbeddingInput[],
    options?: { embeddingModel?: string; embeddedAt?: Date | null },
  ) {
    const normalizedDocumentId = String(documentId || "").trim();
    const embeddingModel = String(options?.embeddingModel || getEmbeddingModelName()).trim() || getEmbeddingModelName();
    const embeddedAt = (options?.embeddedAt || new Date()).toISOString();
    if (!normalizedDocumentId || embeddings.length === 0) return 0;

    const updateChunk = this.db.prepare(
      `UPDATE event_document_chunks
       SET embedding_vector = ?,
           embedding_dimensions = ?,
           embedding_status = 'ready',
           embedding_model = ?,
           embedded_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND document_id = ?
         AND (? IS NULL OR content_hash = ?)`,
    );
    const countMissing = this.db.prepare(
      `SELECT COUNT(*) AS count
       FROM event_document_chunks
       WHERE document_id = ?
         AND (embedding_status != 'ready' OR embedding_vector IS NULL OR COALESCE(embedding_dimensions, 0) = 0)`,
    );
    const updateDocument = this.db.prepare(
      `UPDATE event_documents
       SET embedding_status = ?,
           embedding_model = ?,
           last_embedded_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );

    let updatedCount = 0;
    const transaction = this.db.transaction(() => {
      for (const item of embeddings) {
        const vector = Array.isArray(item.embedding)
          ? item.embedding.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry))
          : [];
        if (vector.length === 0) continue;
        const result = updateChunk.run(
          JSON.stringify(vector),
          vector.length,
          embeddingModel,
          embeddedAt,
          String(item.chunk_id || "").trim(),
          normalizedDocumentId,
          item.content_hash || null,
          item.content_hash || null,
        );
        updatedCount += result.changes;
      }

      const missingRow = countMissing.get(normalizedDocumentId) as { count?: number } | undefined;
      const isReady = Number(missingRow?.count || 0) === 0;
      updateDocument.run(isReady ? "ready" : "pending", embeddingModel, isReady ? embeddedAt : null, normalizedDocumentId);
    });

    transaction();
    return updatedCount;
  }

  async listChannelAccounts(platform?: ChannelPlatform) {
    const rows = platform
      ? this.db.prepare(
          `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
           FROM channel_accounts ca
           LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
           WHERE ca.platform = ?
           ORDER BY ca.created_at ASC`,
        ).all(platform)
      : this.db.prepare(
          `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
           FROM channel_accounts ca
           LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
           ORDER BY ca.created_at ASC`,
        ).all();
    return (rows as Array<Record<string, unknown>>).map(mapChannelRow);
  }

  async getChannelAccount(platform: ChannelPlatform, externalId: string) {
    const row = this.db.prepare(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.platform = ? AND ca.external_id = ? LIMIT 1`,
    ).get(platform, String(externalId || "").trim()) as Record<string, unknown> | undefined;
    return row ? mapChannelRow(row) : undefined;
  }

  async upsertChannelAccount(input: UpsertChannelAccountInput) {
    const platform = (String(input.platform || "facebook").trim() || "facebook") as ChannelPlatform;
    const externalId = String(input.external_id || "").trim();
    const displayName = String(input.display_name || "").trim() || externalId;
    const hasEventId = Object.prototype.hasOwnProperty.call(input, "event_id");
    const eventId = String(input.event_id || "").trim();
    const storageEventId = eventId || DEFAULT_EVENT_ID;
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
           event_id = channel_accounts.event_id,
           access_token = COALESCE(NULLIF(excluded.access_token, ''), channel_accounts.access_token),
           config_json = excluded.config_json,
           is_active = excluded.is_active,
           updated_at = CURRENT_TIMESTAMP`,
    ).run(id, platform, externalId, displayName, storageEventId, accessToken, configJson, input.is_active === false ? 0 : 1);

    if (hasEventId) {
      if (eventId) {
        this.db.prepare(
          `INSERT INTO channel_event_assignments (channel_id, event_id, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(channel_id) DO UPDATE
           SET event_id = excluded.event_id,
               updated_at = CURRENT_TIMESTAMP`,
        ).run(id, eventId);
      } else {
        this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ?").run(id);
      }
    }

    const row = this.db.prepare(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.platform = ? AND ca.external_id = ? LIMIT 1`,
    ).get(platform, externalId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Failed to upsert channel account");
    return mapChannelRow(row);
  }

  async updateChannelAccount(originalPlatform: ChannelPlatform, originalExternalId: string, input: UpsertChannelAccountInput) {
    const sourcePlatform = (String(originalPlatform || "facebook").trim() || "facebook") as ChannelPlatform;
    const sourceExternalId = String(originalExternalId || "").trim();
    const originalRow = this.db.prepare(
      "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at, updated_at FROM channel_accounts WHERE platform = ? AND external_id = ? LIMIT 1",
    ).get(sourcePlatform, sourceExternalId) as Record<string, unknown> | undefined;
    if (!originalRow) {
      throw new Error("Channel account not found");
    }

    const original = mapChannelRow(originalRow);
    const platform = (String(input.platform || "facebook").trim() || "facebook") as ChannelPlatform;
    const externalId = String(input.external_id || "").trim();
    const displayName = String(input.display_name || "").trim() || externalId;
    const hasEventId = Object.prototype.hasOwnProperty.call(input, "event_id");
    const eventId = String(input.event_id || "").trim();
    const accessToken = String(input.access_token || "").trim();
    const configJson = String(input.config_json || "{}").trim() || "{}";
    const conflicting = this.db.prepare(
      "SELECT id FROM channel_accounts WHERE platform = ? AND external_id = ? AND id <> ? LIMIT 1",
    ).get(platform, externalId, original.id) as { id?: string } | undefined;
    if (conflicting?.id) {
      throw new Error("Channel account already exists");
    }

    this.db.prepare(
      `UPDATE channel_accounts
       SET platform = ?,
           external_id = ?,
           display_name = ?,
           event_id = event_id,
           access_token = ?,
           config_json = ?,
           is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(platform, externalId, displayName, accessToken, configJson, input.is_active === false ? 0 : 1, original.id);

    if (hasEventId) {
      if (eventId) {
        this.db.prepare(
          `INSERT INTO channel_event_assignments (channel_id, event_id, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(channel_id) DO UPDATE
           SET event_id = excluded.event_id,
               updated_at = CURRENT_TIMESTAMP`,
        ).run(original.id, eventId);
      } else {
        this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ?").run(original.id);
      }
    }

    const row = this.db.prepare(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.id = ? LIMIT 1`,
    ).get(original.id) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Failed to update channel account");
    return mapChannelRow(row);
  }

  async assignChannelAccount(channelId: string, eventId: string) {
    const normalizedChannelId = String(channelId || "").trim();
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedChannelId || !normalizedEventId) return undefined;
    this.db.prepare(
      `INSERT INTO channel_event_assignments (channel_id, event_id, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id) DO UPDATE
       SET event_id = excluded.event_id,
           updated_at = CURRENT_TIMESTAMP`,
    ).run(normalizedChannelId, normalizedEventId);
    const row = this.db.prepare(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.id = ? LIMIT 1`,
    ).get(normalizedChannelId) as Record<string, unknown> | undefined;
    return row ? mapChannelRow(row) : undefined;
  }

  async unassignChannelAccount(channelId: string) {
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedChannelId) return undefined;
    this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ?").run(normalizedChannelId);
    const row = this.db.prepare(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.id = ? LIMIT 1`,
    ).get(normalizedChannelId) as Record<string, unknown> | undefined;
    return row ? mapChannelRow(row) : undefined;
  }

  async resolveEventIdForChannel(platform: ChannelPlatform, externalId: string) {
    const row = this.db.prepare(
      `SELECT cea.event_id
       FROM channel_accounts ca
       JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.platform = ? AND ca.external_id = ? AND ca.is_active = 1
       LIMIT 1`,
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

  async isUserAssignedToEvent(userId: string, eventId: string) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedUserId || !normalizedEventId) return false;
    const row = this.db.prepare(
      "SELECT 1 FROM user_event_assignments WHERE user_id = ? AND event_id = ? LIMIT 1",
    ).get(normalizedUserId, normalizedEventId) as { 1?: number } | undefined;
    return Boolean(row);
  }

  async getUserPasswordHash(username: string) {
    const row = this.db.prepare("SELECT password_hash FROM users WHERE username = ?").get(
      normalizeUsername(username),
    ) as { password_hash?: string } | undefined;
    return row?.password_hash;
  }

  async updateUserPasswordHash(userId: string, passwordHash: string) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedPasswordHash = String(passwordHash || "").trim();
    if (!normalizedUserId || !normalizedPasswordHash) return false;
    const result = this.db.prepare(
      "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(normalizedPasswordHash, normalizedUserId);
    return result.changes > 0;
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
    if (EVENT_ASSIGNMENT_RESTRICTED_ROLES.includes(input.role)) {
      await this.assignUserToAllEvents(userId);
    }

    const user = await this.getUserById(userId);
    if (!user) throw new Error("Failed to load newly created user");
    return user;
  }

  async updateUserRole(userId: string, role: UserRole) {
    const result = this.db.prepare(
      "UPDATE memberships SET role = ? WHERE organization_id = ? AND user_id = ?",
    ).run(role, DEFAULT_ORGANIZATION_ID, String(userId || "").trim());
    if (result.changes > 0 && EVENT_ASSIGNMENT_RESTRICTED_ROLES.includes(role)) {
      await this.assignUserToAllEvents(userId);
    }
    return result.changes > 0;
  }

  async setUserActive(userId: string, isActive: boolean) {
    const result = this.db.prepare(
      "UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(isActive ? 1 : 0, String(userId || "").trim());
    return result.changes > 0;
  }

  async removeUser(userId: string) {
    const result = this.db.prepare(
      "DELETE FROM users WHERE id = ?",
    ).run(String(userId || "").trim());
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

  async recordLlmUsage(entry: RecordLlmUsageInput) {
    this.db.prepare(
      `INSERT INTO llm_usage_events (
        id, event_id, actor_user_id, source, provider, model,
        prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      generateEntityId("llm"),
      entry.event_id || null,
      entry.actor_user_id || null,
      String(entry.source || "unknown"),
      String(entry.provider || "openrouter"),
      String(entry.model || ""),
      Math.max(0, Number(entry.prompt_tokens || 0)),
      Math.max(0, Number(entry.completion_tokens || 0)),
      Math.max(0, Number(entry.total_tokens || 0)),
      Math.max(0, Number(entry.estimated_cost_usd || 0)),
      JSON.stringify(entry.metadata || {}),
    );
  }

  async getLlmUsageSummary(eventId?: string) {
    const overallRow = this.db.prepare(
      `SELECT
        COUNT(*) AS request_count,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
        MAX(created_at) AS last_used_at
       FROM llm_usage_events`,
    ).get() as Record<string, unknown> | undefined;

    const selectedEventRow = eventId
      ? this.db.prepare(
          `SELECT
            COUNT(*) AS request_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
            MAX(created_at) AS last_used_at
           FROM llm_usage_events
           WHERE event_id = ?`,
        ).get(String(eventId || "").trim()) as Record<string, unknown> | undefined
      : undefined;

    const overallModels = this.db.prepare(
      `SELECT
        provider,
        model,
        COUNT(*) AS request_count,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
        MAX(created_at) AS last_used_at
       FROM llm_usage_events
       GROUP BY provider, model
       ORDER BY total_tokens DESC, estimated_cost_usd DESC, request_count DESC
       LIMIT 5`,
    ).all() as Array<Record<string, unknown>>;

    const selectedEventModels = eventId
      ? this.db.prepare(
          `SELECT
            provider,
            model,
            COUNT(*) AS request_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
            MAX(created_at) AS last_used_at
           FROM llm_usage_events
           WHERE event_id = ?
           GROUP BY provider, model
           ORDER BY total_tokens DESC, estimated_cost_usd DESC, request_count DESC
           LIMIT 5`,
        ).all(String(eventId || "").trim()) as Array<Record<string, unknown>>
      : [];

    return {
      overall: mapLlmUsageTotalsRow(overallRow),
      selected_event: mapLlmUsageTotalsRow(selectedEventRow),
      overall_models: overallModels.map((row) => mapLlmUsageModelSummaryRow(row)),
      selected_event_models: selectedEventModels.map((row) => mapLlmUsageModelSummaryRow(row)),
    } satisfies LlmUsageSummaryRow;
  }

  async listCheckinSessions(eventId: string) {
    const rows = this.db.prepare(
      `SELECT
        id,
        event_id,
        created_by_user_id,
        label,
        created_at,
        expires_at,
        last_used_at,
        exchanged_at,
        revoked_at
       FROM checkin_sessions
       WHERE event_id = ?
       ORDER BY created_at DESC`,
    ).all(String(eventId || "").trim()) as Array<Record<string, unknown>>;
    return rows.map(mapCheckinSessionRow);
  }

  async createCheckinSession(input: CreateCheckinSessionInput) {
    const id = generateEntityId("cki");
    this.db.prepare(
      `INSERT INTO checkin_sessions (id, event_id, created_by_user_id, label, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      String(input.event_id || "").trim(),
      input.created_by_user_id || null,
      String(input.label || "").trim(),
      String(input.token_hash || "").trim(),
      input.expires_at.toISOString(),
    );

    const row = this.db.prepare(
      `SELECT
        id,
        event_id,
        created_by_user_id,
        label,
        created_at,
        expires_at,
        last_used_at,
        exchanged_at,
        revoked_at
       FROM checkin_sessions
       WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error("Failed to load created check-in session");
    }
    return mapCheckinSessionRow(row);
  }

  async getCheckinSessionByTokenHash(tokenHash: string) {
    const row = this.db.prepare(
      `SELECT
        id,
        event_id,
        created_by_user_id,
        label,
        created_at,
        expires_at,
        last_used_at,
        exchanged_at,
        revoked_at
       FROM checkin_sessions
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND exchanged_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    ).get(String(tokenHash || "").trim()) as Record<string, unknown> | undefined;

    return row ? mapCheckinSessionRow(row) : undefined;
  }

  async exchangeCheckinSessionToken(input: ExchangeCheckinSessionTokenInput) {
    const checkinTokenHash = String(input.checkin_token_hash || "").trim();
    const accessTokenHash = String(input.access_token_hash || "").trim();
    const maxSessionTtlMs = Math.max(60_000, Number(input.max_session_ttl_ms || 0));
    if (!checkinTokenHash || !accessTokenHash) {
      return undefined;
    }

    const selectCheckinStatement = this.db.prepare(
      `SELECT
        id,
        event_id,
        label,
        expires_at
       FROM checkin_sessions
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND exchanged_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    );
    const markExchangedStatement = this.db.prepare(
      `UPDATE checkin_sessions
       SET exchanged_at = CURRENT_TIMESTAMP,
           last_used_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND revoked_at IS NULL
         AND exchanged_at IS NULL`,
    );
    const insertAccessSessionStatement = this.db.prepare(
      `INSERT INTO checkin_access_sessions (
        id, checkin_session_id, event_id, label, token_hash, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const getAccessSessionStatement = this.db.prepare(
      `SELECT
        id,
        checkin_session_id,
        event_id,
        label,
        created_at,
        expires_at,
        last_used_at,
        revoked_at
       FROM checkin_access_sessions
       WHERE id = ?
       LIMIT 1`,
    );

    const exchangeTransaction = this.db.transaction((sourceTokenHash: string, nextTokenHash: string, ttlMs: number) => {
      const source = selectCheckinStatement.get(sourceTokenHash) as Record<string, unknown> | undefined;
      if (!source) return undefined;

      const now = Date.now();
      const sourceExpiresAtMs = Date.parse(String(source.expires_at || ""));
      if (!Number.isFinite(sourceExpiresAtMs) || sourceExpiresAtMs <= now) {
        return undefined;
      }

      const accessExpiresAtMs = Math.min(sourceExpiresAtMs, now + ttlMs);
      if (accessExpiresAtMs <= now) {
        return undefined;
      }

      const marked = markExchangedStatement.run(String(source.id || "").trim());
      if (marked.changes <= 0) {
        return undefined;
      }

      const accessSessionId = generateEntityId("cas");
      insertAccessSessionStatement.run(
        accessSessionId,
        String(source.id || "").trim(),
        String(source.event_id || "").trim(),
        String(source.label || "").trim(),
        nextTokenHash,
        new Date(accessExpiresAtMs).toISOString(),
      );

      const row = getAccessSessionStatement.get(accessSessionId) as Record<string, unknown> | undefined;
      return row ? mapCheckinAccessSessionRow(row) : undefined;
    });

    return exchangeTransaction(checkinTokenHash, accessTokenHash, maxSessionTtlMs);
  }

  async getCheckinAccessSessionByTokenHash(tokenHash: string) {
    const row = this.db.prepare(
      `SELECT
        id,
        checkin_session_id,
        event_id,
        label,
        created_at,
        expires_at,
        last_used_at,
        revoked_at
       FROM checkin_access_sessions
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    ).get(String(tokenHash || "").trim()) as Record<string, unknown> | undefined;
    return row ? mapCheckinAccessSessionRow(row) : undefined;
  }

  async touchCheckinSession(sessionId: string) {
    this.db.prepare(
      "UPDATE checkin_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(String(sessionId || "").trim());
  }

  async touchCheckinAccessSession(sessionId: string) {
    this.db.prepare(
      "UPDATE checkin_access_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(String(sessionId || "").trim());
  }

  async revokeCheckinSession(sessionId: string) {
    const revokeTransaction = this.db.transaction((normalizedSessionId: string) => {
      const result = this.db.prepare(
        "UPDATE checkin_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL",
      ).run(normalizedSessionId);
      if (result.changes > 0) {
        this.db.prepare(
          "UPDATE checkin_access_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE checkin_session_id = ? AND revoked_at IS NULL",
        ).run(normalizedSessionId);
      }
      return result.changes > 0;
    });
    return revokeTransaction(String(sessionId || "").trim());
  }

  async deleteExpiredCheckinSessions() {
    this.db.prepare("DELETE FROM checkin_sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
  }

  async deleteExpiredCheckinAccessSessions() {
    this.db.prepare("DELETE FROM checkin_access_sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
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
    const existingEventSettings = this.db.prepare(
      "SELECT key, value FROM event_settings WHERE event_id = ?",
    ).all(DEFAULT_EVENT_ID) as SettingRow[];
    const legacyGlobalEventSettings = this.db.prepare(
      `SELECT key, value FROM settings WHERE key IN (${EVENT_SETTING_KEYS.map(() => "?").join(", ")})`,
    ).all(...EVENT_SETTING_KEYS) as SettingRow[];
    const defaultName =
      String(
        existingEventSettings.find((row) => row.key === "event_name")?.value
        || legacyGlobalEventSettings.find((row) => row.key === "event_name")?.value
        || DEFAULT_SETTINGS_ENTRIES.event_name,
      );
    this.db.prepare(
      `INSERT OR IGNORE INTO events (id, name, slug, status, is_default, is_active)
       VALUES (?, ?, ?, 'active', 1, 1)`,
    ).run(DEFAULT_EVENT_ID, defaultName, "default-event");
    this.db.prepare(
      `UPDATE events SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(defaultName, DEFAULT_EVENT_ID);

    const existingEventSettingsMap = Object.fromEntries(existingEventSettings.map((row) => [row.key, row.value])) as Record<string, string>;
    const legacyGlobalSettingsMap = Object.fromEntries(legacyGlobalEventSettings.map((row) => [row.key, row.value])) as Record<string, string>;
    const insertEventSetting = this.db.prepare(
      `INSERT INTO event_settings (event_id, key, value)
       VALUES (?, ?, ?)
       ON CONFLICT(event_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    );
    for (const key of EVENT_SETTING_KEYS) {
      const value = existingEventSettingsMap[key] || legacyGlobalSettingsMap[key] || DEFAULT_SETTINGS_ENTRIES[key];
      insertEventSetting.run(DEFAULT_EVENT_ID, key, value);
    }
    this.db.prepare(
      `DELETE FROM settings WHERE key IN (${EVENT_SETTING_KEYS.map(() => "?").join(", ")})`,
    ).run(...EVENT_SETTING_KEYS);

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
    const assign = this.db.prepare(
      `INSERT INTO channel_event_assignments (channel_id, event_id, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id) DO UPDATE
       SET event_id = excluded.event_id,
           updated_at = CURRENT_TIMESTAMP`,
    );

    for (const row of rows) {
      const eventId = String(row.event_id || "").trim();
      upsert.run(
        String(row.id),
        String(row.page_id),
        String(row.page_name),
        eventId || DEFAULT_EVENT_ID,
        typeof row.page_access_token === "string" ? row.page_access_token : "",
        Boolean(row.is_active) ? 1 : 0,
        String(row.created_at),
        String(row.updated_at),
      );
      if (eventId) {
        assign.run(String(row.id), eventId);
      }
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

  private async assignUserToEvent(userId: string, eventId: string) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedUserId || !normalizedEventId) return;
    this.db.prepare(
      `INSERT OR IGNORE INTO user_event_assignments (id, user_id, event_id)
       VALUES (?, ?, ?)`,
    ).run(generateEntityId("uea"), normalizedUserId, normalizedEventId);
  }

  private async assignUserToAllEvents(userId: string) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return;
    const events = this.db.prepare("SELECT id FROM events").all() as Array<{ id: string }>;
    for (const event of events) {
      await this.assignUserToEvent(normalizedUserId, event.id);
    }
  }

  private async assignEventToAllRestrictedUsers(eventId: string) {
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) return;
    const placeholders = EVENT_ASSIGNMENT_RESTRICTED_ROLES.map(() => "?").join(", ");
    const rows = this.db.prepare(
      `SELECT user_id
       FROM memberships
       WHERE organization_id = ?
         AND role IN (${placeholders})`,
    ).all(DEFAULT_ORGANIZATION_ID, ...EVENT_ASSIGNMENT_RESTRICTED_ROLES) as Array<{ user_id: string }>;
    for (const row of rows) {
      await this.assignUserToEvent(row.user_id, normalizedEventId);
    }
  }

  private async bootstrapEventAssignmentsIfEmpty() {
    const existing = this.db.prepare("SELECT COUNT(*) AS total FROM user_event_assignments").get() as { total?: number };
    if (Number(existing.total || 0) > 0) return;
    const placeholders = EVENT_ASSIGNMENT_RESTRICTED_ROLES.map(() => "?").join(", ");
    const users = this.db.prepare(
      `SELECT user_id
       FROM memberships
       WHERE organization_id = ?
         AND role IN (${placeholders})`,
    ).all(DEFAULT_ORGANIZATION_ID, ...EVENT_ASSIGNMENT_RESTRICTED_ROLES) as Array<{ user_id: string }>;
    const events = this.db.prepare("SELECT id FROM events").all() as Array<{ id: string }>;
    for (const user of users) {
      for (const event of events) {
        await this.assignUserToEvent(user.user_id, event.id);
      }
    }
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
