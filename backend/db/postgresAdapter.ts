import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { Pool, type PoolClient } from "pg";
import { hashPassword, normalizeUsername } from "../auth";
import { chunkDocumentContent, getDefaultEmbeddingStatus, getEmbeddingModelName, hashDocumentContent } from "../documents";
import { getEffectiveEventStatus, getEventState } from "../datetime";
import { DEFAULT_EVENT_ID, DEFAULT_SETTINGS_ENTRIES, EVENT_SETTING_KEYS, NEW_EVENT_TEMPLATE_ENTRIES } from "./defaultSettings";
import { runPostgresMigrations } from "./migrate";
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
type QueryableClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

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
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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

export class PostgresAppDatabase implements AppDatabase {
  public readonly driver = "postgres" as const;

  private initialized = false;
  private readonly pool: Pool;
  private readonly sqliteBootstrapPath?: string;

  constructor(databaseUrl: string, sqliteBootstrapPath?: string) {
    const shouldUseSsl = process.env.PGSSLMODE !== "disable" && !/localhost|127\.0\.0\.1/i.test(databaseUrl);

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
    await this.ensureDefaultEvent();
    await this.ensureChannelAccountsBootstrap();
    await this.ensureChannelEventAssignmentsBootstrap();
    await this.ensureEventDocumentChunks();
    await this.ensureBootstrapOwner();
    await this.bootstrapEventAssignmentsIfEmpty();
    await this.deleteExpiredSessions();
    await this.deleteExpiredCheckinSessions();
    await this.deleteExpiredCheckinAccessSessions();
    this.initialized = true;
  }

  async ping() {
    await this.pool.query("SELECT 1");
  }

  async close() {
    await this.pool.end();
  }

  private async hydrateEventRow(baseRow: Record<string, unknown>) {
    const base = mapEventBaseRow(baseRow);
    const settings = await this.getSettingsMap(base.id);
    const effectiveStatus = getEffectiveEventStatus(base.status, settings);
    const eventState = getEventState(settings);
    const countsResult = await this.pool.query<{ active_count: string | null; cancelled_count: string | null }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END), 0)::text AS active_count,
         COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0)::text AS cancelled_count
       FROM registrations
       WHERE event_id = $1`,
      [base.id],
    );
    const activeCount = Number.parseInt(countsResult.rows[0]?.active_count || "0", 10);
    const cancelledCount = Number.parseInt(countsResult.rows[0]?.cancelled_count || "0", 10);
    const registrationLimit = parseRegistrationLimit(settings.reg_limit);
    const isCapacityFull = registrationLimit !== null && activeCount >= registrationLimit;
    const remainingSeats = registrationLimit === null ? null : Math.max(registrationLimit - activeCount, 0);
    return {
      ...base,
      effective_status: effectiveStatus,
      event_date: settings.event_date || "",
      event_end_date: settings.event_end_date || "",
      event_timezone: settings.event_timezone || "",
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
    const baseResult = await this.pool.query<SettingRow>("SELECT key, value FROM settings");
    const eventResult = await this.pool.query<SettingRow>(
      "SELECT key, value FROM event_settings WHERE event_id = $1",
      [eventId],
    );
    const settings = baseResult.rows.reduce((acc, row) => {
      if (EVENT_SETTING_KEY_SET.has(row.key)) {
        return acc;
      }
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);
    for (const row of eventResult.rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  async getSettingValue(key: string, eventId = DEFAULT_EVENT_ID) {
    if (EVENT_SETTING_KEY_SET.has(key)) {
      const row = await this.pool.query<{ value: string }>(
        "SELECT value FROM event_settings WHERE event_id = $1 AND key = $2",
        [eventId, key],
      );
      if (row.rows[0]?.value != null) return row.rows[0].value;
    }

    const globalRow = await this.pool.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
    return globalRow.rows[0]?.value;
  }

  async upsertSettings(entries: Record<string, string>, eventId = DEFAULT_EVENT_ID) {
    const values = Object.entries(entries);
    if (!values.length) return;

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, value] of values) {
        if (EVENT_SETTING_KEY_SET.has(key)) {
          await client.query(
            `INSERT INTO event_settings (event_id, key, value)
             VALUES ($1, $2, $3)
             ON CONFLICT (event_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [eventId, key, String(value)],
          );
        } else {
          await client.query(
            `INSERT INTO settings (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [key, String(value)],
          );
        }
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
      "SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations WHERE id = $1",
      [id],
    );
    return result.rows[0];
  }

  async listRegistrations(limit?: number, eventId?: string) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (eventId) {
      values.push(eventId);
      clauses.push(`event_id = $${values.length}`);
    }
    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    if (typeof limit === "number") {
      values.push(limit);
      const result = await this.pool.query<RegistrationRow>(
        `SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations ${whereClause} ORDER BY timestamp DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows;
    }

    const result = await this.pool.query<RegistrationRow>(
      `SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations ${whereClause} ORDER BY timestamp DESC`,
      values,
    );
    return result.rows;
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

    if (eventId) {
      const result = await this.pool.query<RegistrationRow>(
        `SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp::text AS timestamp, status
         FROM registrations
         WHERE event_id = $1 AND sender_id = ANY($2::text[])
         ORDER BY timestamp DESC, id DESC`,
        [eventId, normalizedSenderIds],
      );
      return result.rows;
    }

    const result = await this.pool.query<RegistrationRow>(
      `SELECT id, sender_id, event_id, first_name, last_name, phone, email, timestamp::text AS timestamp, status
       FROM registrations
       WHERE sender_id = ANY($1::text[])
       ORDER BY timestamp DESC, id DESC`,
      [normalizedSenderIds],
    );
    return result.rows;
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
    if (event.effective_status === "archived") {
      return { statusCode: 400, content: { error: "This event has been archived" } };
    }

    const settings = await this.getSettingsMap(eventId);
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

    const limit = parseRegistrationLimit(settings.reg_limit);
    const enforceUniqueName = settings.reg_unique_name == null || isTruthySettingValue(settings.reg_unique_name);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);

      const activeRowsResult = await client.query<{ id: string; first_name: string; last_name: string }>(
        "SELECT id, first_name, last_name FROM registrations WHERE event_id = $1 AND status != 'cancelled'",
        [eventId],
      );
      const activeRows = activeRowsResult.rows || [];

      if (enforceUniqueName) {
        const nameKey = normalizeRegistrationNameKey(firstName, lastName);
        const duplicate = activeRows.find((row) => normalizeRegistrationNameKey(row.first_name, row.last_name) === nameKey);
        if (duplicate?.id) {
          await client.query("ROLLBACK");
          return {
            statusCode: 409,
            content: {
              error: "An attendee with this first and last name is already registered for this event",
              duplicate_registration_id: String(duplicate.id || "").trim().toUpperCase(),
            },
          };
        }
      }

      if (limit !== null && activeRows.length >= limit) {
        await client.query("ROLLBACK");
        return { statusCode: 400, content: { error: "Registration limit reached" } };
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const id = generateRegistrationId();
        try {
          await client.query(
            `INSERT INTO registrations (id, sender_id, event_id, first_name, last_name, phone, email)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, senderId, eventId, firstName, lastName, phone, email],
          );
          await client.query("COMMIT");
          return { statusCode: 200, content: { id, status: "success" } };
        } catch (error: any) {
          if (error?.code === "23505") continue;
          throw error;
        }
      }

      await client.query("ROLLBACK");
    } finally {
      client.release();
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

    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO registration_email_deliveries (
        id, registration_id, event_id, recipient_email, kind, provider, status, subject
      ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
      ON CONFLICT (registration_id, kind) DO NOTHING
      RETURNING id, registration_id, event_id, recipient_email, kind, provider, status, subject, error_message, queued_at::text, sent_at::text, updated_at::text`,
      [generateEntityId("eml"), registrationId, eventId, recipientEmail, kind, provider, subject],
    );

    return mapRegistrationEmailDeliveryRow(result.rows[0]);
  }

  async markRegistrationEmailDeliverySent(id: string, provider?: string | null) {
    await this.pool.query(
      `UPDATE registration_email_deliveries
       SET status = 'sent',
           provider = COALESCE($1, provider),
           error_message = NULL,
           sent_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [provider == null ? null : String(provider).trim() || null, String(id || "").trim()],
    );
  }

  async markRegistrationEmailDeliveryFailed(id: string, errorMessage: string, provider?: string | null) {
    await this.pool.query(
      `UPDATE registration_email_deliveries
       SET status = 'failed',
           provider = COALESCE($1, provider),
           error_message = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [
        provider == null ? null : String(provider).trim() || null,
        String(errorMessage || "").trim().slice(0, 1000),
        String(id || "").trim(),
      ],
    );
  }

  async cancelRegistration(id: unknown): Promise<RegistrationResult> {
    const registrationId = String(id || "").trim();
    if (!registrationId) {
      return { statusCode: 400, content: { error: "Registration ID is required" } };
    }

    const updated = await this.updateRegistrationStatus(registrationId, "cancelled");
    if (updated) return { statusCode: 200, content: { status: "success" } };
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

  async deleteRegistration(id: string) {
    const result = await this.pool.query("DELETE FROM registrations WHERE id = $1", [
      String(id || "").trim().toUpperCase(),
    ]);
    return result.rowCount > 0;
  }

  async saveMessage(senderId: string, text: string, type: MessageType, eventId?: string, pageId?: string) {
    await this.pool.query(
      "INSERT INTO messages (sender_id, event_id, page_id, text, type) VALUES ($1, $2, $3, $4, $5)",
      [senderId, eventId || DEFAULT_EVENT_ID, pageId || null, text, type],
    );
  }

  async listMessages(limit: number, eventId?: string, beforeId?: number) {
    const hasBeforeId = Number.isFinite(beforeId) && Number(beforeId) > 0;
    const normalizedBeforeId = hasBeforeId ? Math.trunc(Number(beforeId)) : 0;
    if (eventId) {
      if (hasBeforeId) {
        const result = await this.pool.query<MessageRow>(
          "SELECT id, sender_id, event_id, page_id, text, timestamp::text AS timestamp, type FROM messages WHERE event_id = $1 AND id < $2 ORDER BY timestamp DESC, id DESC LIMIT $3",
          [eventId, normalizedBeforeId, limit],
        );
        return result.rows;
      }
      const result = await this.pool.query<MessageRow>(
        "SELECT id, sender_id, event_id, page_id, text, timestamp::text AS timestamp, type FROM messages WHERE event_id = $1 ORDER BY timestamp DESC, id DESC LIMIT $2",
        [eventId, limit],
      );
      return result.rows;
    }
    if (hasBeforeId) {
      const result = await this.pool.query<MessageRow>(
        "SELECT id, sender_id, event_id, page_id, text, timestamp::text AS timestamp, type FROM messages WHERE id < $1 ORDER BY timestamp DESC, id DESC LIMIT $2",
        [normalizedBeforeId, limit],
      );
      return result.rows;
    }
    const result = await this.pool.query<MessageRow>(
      "SELECT id, sender_id, event_id, page_id, text, timestamp::text AS timestamp, type FROM messages ORDER BY timestamp DESC, id DESC LIMIT $1",
      [limit],
    );
    return result.rows;
  }

  async getMessageHistoryRows(senderId: string, limit: number, eventId?: string) {
    if (eventId) {
      const result = await this.pool.query<{ text: string; type: MessageType }>(
        "SELECT text, type FROM messages WHERE sender_id = $1 AND event_id = $2 ORDER BY timestamp DESC, id DESC LIMIT $3",
        [senderId, eventId, limit],
      );
      return result.rows;
    }
    const result = await this.pool.query<{ text: string; type: MessageType }>(
      "SELECT text, type FROM messages WHERE sender_id = $1 ORDER BY timestamp DESC, id DESC LIMIT $2",
      [senderId, limit],
    );
    return result.rows;
  }

  async getConversationRowsForSender(senderId: string, limit: number, eventId?: string) {
    if (eventId) {
      const result = await this.pool.query<MessageRow>(
        "SELECT id, sender_id, event_id, page_id, text, timestamp::text AS timestamp, type FROM messages WHERE sender_id = $1 AND event_id = $2 ORDER BY timestamp DESC, id DESC LIMIT $3",
        [senderId, eventId, limit],
      );
      return result.rows;
    }
    const result = await this.pool.query<MessageRow>(
      "SELECT id, sender_id, event_id, page_id, text, timestamp::text AS timestamp, type FROM messages WHERE sender_id = $1 ORDER BY timestamp DESC, id DESC LIMIT $2",
      [senderId, limit],
    );
    return result.rows;
  }

  async listEvents() {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT id, name, slug, status, is_default, created_at::text AS created_at, updated_at::text AS updated_at FROM events ORDER BY is_default DESC, created_at ASC",
    );
    return Promise.all(result.rows.map((row) => this.hydrateEventRow(row)));
  }

  async getEventById(eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT id, name, slug, status, is_default, created_at::text AS created_at, updated_at::text AS updated_at FROM events WHERE id = $1",
      [String(eventId || "").trim()],
    );
    return result.rows[0] ? this.hydrateEventRow(result.rows[0]) : undefined;
  }

  async createEvent(input: CreateEventInput) {
    const id = generateEntityId("evt");
    const baseName = String(input.name || "").trim() || "New Event";
    const slug = await this.uniqueEventSlug(baseName);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO events (id, name, slug, status, is_default)
         VALUES ($1, $2, $3, 'pending', FALSE)`,
        [id, baseName, slug],
      );
      for (const key of EVENT_SETTING_KEYS) {
        await client.query(
          `INSERT INTO event_settings (event_id, key, value)
           VALUES ($1, $2, $3)
           ON CONFLICT (event_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [id, key, NEW_EVENT_TEMPLATE_ENTRIES[key] ?? DEFAULT_SETTINGS_ENTRIES[key]],
        );
      }
      await this.assignEventToAllRestrictedUsers(id, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const event = await this.getEventById(id);
    if (!event) throw new Error("Failed to create event");
    return event;
  }

  async updateEvent(eventId: string, input: UpdateEventInput) {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof input.name === "string" && input.name.trim()) {
      values.push(input.name.trim());
      updates.push(`name = $${values.length}`);
      values.push(await this.uniqueEventSlug(input.name.trim(), eventId));
      updates.push(`slug = $${values.length}`);
    }
    if (typeof input.status === "string" && input.status.trim()) {
      values.push(input.status.trim());
      updates.push(`status = $${values.length}`);
    }
    if (!updates.length) return false;
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(String(eventId || "").trim());
    const result = await this.pool.query(
      `UPDATE events SET ${updates.join(", ")} WHERE id = $${values.length}`,
      values,
    );
    return result.rowCount > 0;
  }

  async getEventDeletionImpact(eventId: string) {
    const normalizedEventId = String(eventId || "").trim();
    const [registrationResult, messageResult, documentResult, checkinResult, channelResult, pageResult] = await Promise.all([
      this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM registrations WHERE event_id = $1", [normalizedEventId]),
      this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM messages WHERE event_id = $1", [normalizedEventId]),
      this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM event_documents WHERE event_id = $1", [normalizedEventId]),
      this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM checkin_sessions WHERE event_id = $1", [normalizedEventId]),
      this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM channel_event_assignments WHERE event_id = $1", [normalizedEventId]),
      this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM facebook_pages WHERE event_id = $1", [normalizedEventId]),
    ]);
    return {
      registrations: Number.parseInt(registrationResult.rows[0]?.count || "0", 10),
      messages: Number.parseInt(messageResult.rows[0]?.count || "0", 10),
      documents: Number.parseInt(documentResult.rows[0]?.count || "0", 10),
      checkin_sessions: Number.parseInt(checkinResult.rows[0]?.count || "0", 10),
      assigned_channels: Number.parseInt(channelResult.rows[0]?.count || "0", 10),
      legacy_pages: Number.parseInt(pageResult.rows[0]?.count || "0", 10),
    };
  }

  async deleteEvent(eventId: string) {
    const normalizedEventId = String(eventId || "").trim();
    const result = await this.pool.query(
      "DELETE FROM events WHERE id = $1 AND is_default = FALSE",
      [normalizedEventId],
    );
    return result.rowCount > 0;
  }

  private async replaceEventDocumentChunks(documentId: string, eventId: string, content: string, isActive = true) {
    const chunks = chunkDocumentContent(content);
    const embeddingModel = getEmbeddingModelName();
    const embeddingStatus = getDefaultEmbeddingStatus(isActive);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM event_document_chunks WHERE document_id = $1", [documentId]);
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO event_document_chunks (
             id, document_id, event_id, chunk_index, content, content_hash, char_count, token_estimate, embedding_status, embedding_model
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
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
          ],
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

  private async ensureEventDocumentChunks() {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT d.id, d.event_id, d.content, d.is_active
       FROM event_documents d
       LEFT JOIN (
         SELECT document_id, COUNT(*)::int AS chunk_count
         FROM event_document_chunks
         GROUP BY document_id
       ) counts ON counts.document_id = d.id
       WHERE COALESCE(counts.chunk_count, 0) = 0`,
    );

    for (const row of result.rows) {
      await this.replaceEventDocumentChunks(
        String(row.id),
        String(row.event_id),
        String(row.content || ""),
        Boolean(row.is_active),
      );
    }

    await this.pool.query(
      `UPDATE event_documents
       SET
         content_hash = COALESCE(content_hash, encode(digest(COALESCE(content, ''), 'sha256'), 'hex')),
         embedding_status = CASE WHEN is_active THEN 'pending' ELSE 'skipped' END,
         embedding_model = COALESCE(embedding_model, $1)
       WHERE content_hash IS NULL OR embedding_model IS NULL`,
      [getEmbeddingModelName()],
    );

    await this.pool.query(
      `UPDATE event_document_chunks c
       SET
         content_hash = COALESCE(c.content_hash, encode(digest(COALESCE(c.content, ''), 'sha256'), 'hex')),
         char_count = CASE WHEN COALESCE(c.char_count, 0) > 0 THEN c.char_count ELSE LENGTH(COALESCE(c.content, '')) END,
         token_estimate = CASE WHEN COALESCE(c.token_estimate, 0) > 0 THEN c.token_estimate ELSE GREATEST(1, CEIL(LENGTH(COALESCE(c.content, '')) / 4.0)::int) END,
         embedding_status = CASE WHEN d.is_active THEN 'pending' ELSE 'skipped' END,
         embedding_model = COALESCE(c.embedding_model, $1)
       FROM event_documents d
       WHERE d.id = c.document_id
         AND (
           c.content_hash IS NULL
           OR COALESCE(c.char_count, 0) = 0
           OR COALESCE(c.token_estimate, 0) = 0
           OR c.embedding_model IS NULL
           OR c.embedding_status IS NULL
           OR c.embedding_status = ''
         )`,
      [getEmbeddingModelName()],
    );
  }

  async listEventDocuments(eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT d.id, d.event_id, d.title, d.source_type, d.source_url, d.content, d.is_active,
              d.content_hash, d.embedding_status, d.embedding_model, d.last_embedded_at::text AS last_embedded_at,
              COALESCE(counts.chunk_count, 0)::text AS chunk_count,
              d.created_at::text AS created_at, d.updated_at::text AS updated_at
       FROM event_documents d
       LEFT JOIN (
         SELECT document_id, COUNT(*)::int AS chunk_count
         FROM event_document_chunks
         GROUP BY document_id
       ) counts ON counts.document_id = d.id
       WHERE d.event_id = $1
       ORDER BY d.updated_at DESC, d.created_at DESC`,
      [String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID],
    );
    return result.rows.map(mapEventDocumentRow);
  }

  async listEventDocumentChunks(eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, document_id, event_id, chunk_index, content, content_hash, char_count, token_estimate,
              embedding_status, embedding_model, embedded_at::text AS embedded_at,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM event_document_chunks
       WHERE event_id = $1
       ORDER BY document_id ASC, chunk_index ASC`,
      [String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID],
    );
    return result.rows.map(mapEventDocumentChunkRow);
  }

  async listEventDocumentChunkEmbeddings(eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, document_id, event_id, chunk_index, content, content_hash, char_count, token_estimate,
              embedding_status, embedding_model, embedded_at::text AS embedded_at,
              embedding_vector, embedding_dimensions,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM event_document_chunks
       WHERE event_id = $1
       ORDER BY document_id ASC, chunk_index ASC`,
      [String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID],
    );
    return result.rows.map(mapEventDocumentChunkEmbeddingRow);
  }

  async upsertEventDocument(input: UpsertEventDocumentInput) {
    const id = String(input.id || "").trim() || generateEntityId("doc");
    const eventId = String(input.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const title = String(input.title || "").trim() || "Untitled Document";
    const sourceType = String(input.source_type || "note").trim() || "note";
    const sourceUrl = String(input.source_url || "").trim();
    const content = String(input.content || "").trim();
    const isActive = input.is_active === false ? false : true;
    const contentHash = hashDocumentContent(content);
    const embeddingModel = getEmbeddingModelName();
    const embeddingStatus = getDefaultEmbeddingStatus(isActive);

    await this.pool.query(
      `INSERT INTO event_documents (
         id, event_id, title, source_type, source_url, content, is_active, content_hash, embedding_status, embedding_model, last_embedded_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)
       ON CONFLICT (id) DO UPDATE
       SET event_id = EXCLUDED.event_id,
           title = EXCLUDED.title,
           source_type = EXCLUDED.source_type,
           source_url = EXCLUDED.source_url,
           content = EXCLUDED.content,
           is_active = EXCLUDED.is_active,
           content_hash = EXCLUDED.content_hash,
           embedding_status = EXCLUDED.embedding_status,
           embedding_model = EXCLUDED.embedding_model,
           last_embedded_at = NULL,
           updated_at = CURRENT_TIMESTAMP`,
      [id, eventId, title, sourceType, sourceUrl || null, content, isActive, contentHash, embeddingStatus, embeddingModel],
    );
    await this.replaceEventDocumentChunks(id, eventId, content, isActive);

    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT d.id, d.event_id, d.title, d.source_type, d.source_url, d.content, d.is_active,
              d.content_hash, d.embedding_status, d.embedding_model, d.last_embedded_at::text AS last_embedded_at,
              COALESCE(counts.chunk_count, 0)::text AS chunk_count,
              d.created_at::text AS created_at, d.updated_at::text AS updated_at
       FROM event_documents d
       LEFT JOIN (
         SELECT document_id, COUNT(*)::int AS chunk_count
         FROM event_document_chunks
         GROUP BY document_id
       ) counts ON counts.document_id = d.id
       WHERE d.id = $1
       LIMIT 1`,
      [id],
    );
    if (!result.rows[0]) throw new Error("Failed to upsert event document");
    return mapEventDocumentRow(result.rows[0]);
  }

  async resetEventKnowledge(eventId: string, options?: { clearContext?: boolean }) {
    const normalizedEventId = String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const clearContext = options?.clearContext !== false;
    const client = await this.pool.connect();
    let documentsDeleted = 0;
    let chunksDeleted = 0;
    let contextCleared = false;
    try {
      await client.query("BEGIN");
      const chunkCountResult = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM event_document_chunks WHERE event_id = $1",
        [normalizedEventId],
      );
      const documentCountResult = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM event_documents WHERE event_id = $1",
        [normalizedEventId],
      );
      let contextResult = { rowCount: 0 };
      if (clearContext) {
        contextResult = await client.query(
          `INSERT INTO event_settings (event_id, key, value)
           VALUES ($1, 'context', '')
           ON CONFLICT (event_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [normalizedEventId],
        );
      }
      await client.query("DELETE FROM event_document_chunks WHERE event_id = $1", [normalizedEventId]);
      await client.query("DELETE FROM event_documents WHERE event_id = $1", [normalizedEventId]);
      await client.query("COMMIT");

      chunksDeleted = Number.parseInt(chunkCountResult.rows[0]?.count || "0", 10) || 0;
      documentsDeleted = Number.parseInt(documentCountResult.rows[0]?.count || "0", 10) || 0;
      contextCleared = clearContext && (contextResult.rowCount || 0) > 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

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
    const client = await this.pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      result = await client.query(
        "UPDATE event_documents SET is_active = $1, embedding_status = $2, embedding_model = COALESCE(embedding_model, $3), last_embedded_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $4",
        [isActive, status, embeddingModel, normalizedDocumentId],
      );
      await client.query(
        "UPDATE event_document_chunks SET embedding_status = $1, embedding_model = COALESCE(embedding_model, $2), embedded_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE document_id = $3",
        [status, embeddingModel, normalizedDocumentId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return result.rowCount > 0;
  }

  async setEventDocumentEmbeddingStatus(
    documentId: string,
    status: EmbeddingStatus,
    options?: { embeddingModel?: string; embeddedAt?: Date | null },
  ) {
    const normalizedDocumentId = String(documentId || "").trim();
    const embeddingModel = String(options?.embeddingModel || getEmbeddingModelName()).trim() || getEmbeddingModelName();
    const embeddedAt = status === "ready" ? (options?.embeddedAt || new Date()) : null;
    const client = await this.pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      result = await client.query(
        `UPDATE event_documents
         SET embedding_status = $1,
             embedding_model = $2,
             last_embedded_at = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [status, embeddingModel, embeddedAt, normalizedDocumentId],
      );
      await client.query(
        `UPDATE event_document_chunks
         SET embedding_status = $1,
             embedding_model = $2,
             embedded_at = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE document_id = $4`,
        [status, embeddingModel, embeddedAt, normalizedDocumentId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return result.rowCount > 0;
  }

  async saveEventDocumentChunkEmbeddings(
    documentId: string,
    embeddings: PersistChunkEmbeddingInput[],
    options?: { embeddingModel?: string; embeddedAt?: Date | null },
  ) {
    const normalizedDocumentId = String(documentId || "").trim();
    const embeddingModel = String(options?.embeddingModel || getEmbeddingModelName()).trim() || getEmbeddingModelName();
    const embeddedAt = options?.embeddedAt || new Date();
    if (!normalizedDocumentId || embeddings.length === 0) return 0;

    const client = await this.pool.connect();
    let updatedCount = 0;
    try {
      await client.query("BEGIN");
      for (const item of embeddings) {
        const vector = Array.isArray(item.embedding)
          ? item.embedding.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry))
          : [];
        if (vector.length === 0) continue;
        const result = await client.query(
          `UPDATE event_document_chunks
           SET embedding_vector = $1,
               embedding_dimensions = $2,
               embedding_status = 'ready',
               embedding_model = $3,
               embedded_at = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $5
             AND document_id = $6
             AND ($7::text IS NULL OR content_hash = $8)`,
          [
            JSON.stringify(vector),
            vector.length,
            embeddingModel,
            embeddedAt,
            String(item.chunk_id || "").trim(),
            normalizedDocumentId,
            item.content_hash || null,
            item.content_hash || null,
          ],
        );
        updatedCount += result.rowCount || 0;
      }

      const missingResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM event_document_chunks
         WHERE document_id = $1
           AND (embedding_status != 'ready' OR embedding_vector IS NULL OR COALESCE(embedding_dimensions, 0) = 0)`,
        [normalizedDocumentId],
      );
      const isReady = Number.parseInt(missingResult.rows[0]?.count || "0", 10) === 0;
      await client.query(
        `UPDATE event_documents
         SET embedding_status = $1,
             embedding_model = $2,
             last_embedded_at = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [isReady ? "ready" : "pending", embeddingModel, isReady ? embeddedAt : null, normalizedDocumentId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return updatedCount;
  }

  async listChannelAccounts(platform?: ChannelPlatform) {
    const query = platform
      ? {
          sql: `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
                FROM channel_accounts ca
                LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
                WHERE ca.platform = $1
                ORDER BY ca.created_at ASC`,
          values: [platform],
        }
      : {
          sql: `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
                FROM channel_accounts ca
                LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
                ORDER BY ca.created_at ASC`,
          values: [] as unknown[],
        };
    const result = await this.pool.query<Record<string, unknown>>(query.sql, query.values);
    return result.rows.map(mapChannelRow);
  }

  async getChannelAccount(platform: ChannelPlatform, externalId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.platform = $1 AND ca.external_id = $2
       LIMIT 1`,
      [platform, String(externalId || "").trim()],
    );
    return result.rows[0] ? mapChannelRow(result.rows[0]) : undefined;
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
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id FROM channel_accounts WHERE platform = $1 AND external_id = $2",
      [platform, externalId],
    );
    const id = existing.rows[0]?.id || generateEntityId("chn");

    await this.pool.query(
      `INSERT INTO channel_accounts (id, platform, external_id, display_name, event_id, access_token, config_json, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (platform, external_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           event_id = channel_accounts.event_id,
           access_token = COALESCE(NULLIF(EXCLUDED.access_token, ''), channel_accounts.access_token),
           config_json = EXCLUDED.config_json,
           is_active = EXCLUDED.is_active,
           updated_at = CURRENT_TIMESTAMP`,
      [id, platform, externalId, displayName, storageEventId, accessToken, configJson, input.is_active === false ? false : true],
    );

    if (hasEventId) {
      if (eventId) {
        await this.pool.query(
          `INSERT INTO channel_event_assignments (channel_id, event_id)
           VALUES ($1, $2)
           ON CONFLICT (channel_id) DO UPDATE
           SET event_id = EXCLUDED.event_id,
               updated_at = CURRENT_TIMESTAMP`,
          [id, eventId],
        );
      } else {
        await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1", [id]);
      }
    }

    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.platform = $1 AND ca.external_id = $2
       LIMIT 1`,
      [platform, externalId],
    );
    if (!result.rows[0]) throw new Error("Failed to upsert channel account");
    return mapChannelRow(result.rows[0]);
  }

  async updateChannelAccount(originalPlatform: ChannelPlatform, originalExternalId: string, input: UpsertChannelAccountInput) {
    const sourcePlatform = (String(originalPlatform || "facebook").trim() || "facebook") as ChannelPlatform;
    const sourceExternalId = String(originalExternalId || "").trim();
    const originalResult = await this.pool.query<Record<string, unknown>>(
      "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at::text AS created_at, updated_at::text AS updated_at FROM channel_accounts WHERE platform = $1 AND external_id = $2 LIMIT 1",
      [sourcePlatform, sourceExternalId],
    );
    if (!originalResult.rows[0]) {
      throw new Error("Channel account not found");
    }

    const original = mapChannelRow(originalResult.rows[0]);
    const platform = (String(input.platform || "facebook").trim() || "facebook") as ChannelPlatform;
    const externalId = String(input.external_id || "").trim();
    const displayName = String(input.display_name || "").trim() || externalId;
    const hasEventId = Object.prototype.hasOwnProperty.call(input, "event_id");
    const eventId = String(input.event_id || "").trim();
    const accessToken = String(input.access_token || "").trim();
    const configJson = String(input.config_json || "{}").trim() || "{}";
    const conflicting = await this.pool.query<{ id: string }>(
      "SELECT id FROM channel_accounts WHERE platform = $1 AND external_id = $2 AND id <> $3 LIMIT 1",
      [platform, externalId, original.id],
    );
    if (conflicting.rows[0]?.id) {
      throw new Error("Channel account already exists");
    }

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE channel_accounts
       SET platform = $1,
           external_id = $2,
           display_name = $3,
           access_token = $4,
           config_json = $5,
           is_active = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, platform, external_id, display_name, access_token, config_json, is_active, created_at::text AS created_at, updated_at::text AS updated_at`,
      [platform, externalId, displayName, accessToken, configJson, input.is_active === false ? false : true, original.id],
    );
    if (!result.rows[0]) throw new Error("Failed to update channel account");

    if (hasEventId) {
      if (eventId) {
        await this.pool.query(
          `INSERT INTO channel_event_assignments (channel_id, event_id)
           VALUES ($1, $2)
           ON CONFLICT (channel_id) DO UPDATE
           SET event_id = EXCLUDED.event_id,
               updated_at = CURRENT_TIMESTAMP`,
          [original.id, eventId],
        );
      } else {
        await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1", [original.id]);
      }
    }

    const refreshed = await this.pool.query<Record<string, unknown>>(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.id = $1
       LIMIT 1`,
      [original.id],
    );
    if (!refreshed.rows[0]) throw new Error("Failed to update channel account");
    return mapChannelRow(refreshed.rows[0]);
  }

  async assignChannelAccount(channelId: string, eventId: string) {
    const normalizedChannelId = String(channelId || "").trim();
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedChannelId || !normalizedEventId) return undefined;
    await this.pool.query(
      `INSERT INTO channel_event_assignments (channel_id, event_id)
       VALUES ($1, $2)
       ON CONFLICT (channel_id) DO UPDATE
       SET event_id = EXCLUDED.event_id,
           updated_at = CURRENT_TIMESTAMP`,
      [normalizedChannelId, normalizedEventId],
    );
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.id = $1
       LIMIT 1`,
      [normalizedChannelId],
    );
    return result.rows[0] ? mapChannelRow(result.rows[0]) : undefined;
  }

  async unassignChannelAccount(channelId: string) {
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedChannelId) return undefined;
    await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1", [normalizedChannelId]);
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.id = $1
       LIMIT 1`,
      [normalizedChannelId],
    );
    return result.rows[0] ? mapChannelRow(result.rows[0]) : undefined;
  }

  async resolveEventIdForChannel(platform: ChannelPlatform, externalId: string) {
    const result = await this.pool.query<{ event_id: string }>(
      `SELECT cea.event_id
       FROM channel_accounts ca
       JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.platform = $1 AND ca.external_id = $2 AND ca.is_active = TRUE
       LIMIT 1`,
      [platform, String(externalId || "").trim()],
    );
    return result.rows[0]?.event_id;
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
    return this.queryAuthUser("u.username = $1", [normalizeUsername(username)]);
  }

  async getUserById(userId: string) {
    return this.queryAuthUser("u.id = $1", [String(userId || "").trim()]);
  }

  async isUserAssignedToEvent(userId: string, eventId: string) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedUserId || !normalizedEventId) return false;
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM user_event_assignments
         WHERE user_id = $1 AND event_id = $2
       ) AS exists`,
      [normalizedUserId, normalizedEventId],
    );
    return Boolean(result.rows[0]?.exists);
  }

  async getUserPasswordHash(username: string) {
    const result = await this.pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE username = $1",
      [normalizeUsername(username)],
    );
    return result.rows[0]?.password_hash;
  }

  async updateUserPasswordHash(userId: string, passwordHash: string) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedPasswordHash = String(passwordHash || "").trim();
    if (!normalizedUserId || !normalizedPasswordHash) return false;
    const result = await this.pool.query(
      "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [normalizedPasswordHash, normalizedUserId],
    );
    return result.rowCount > 0;
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
      if (EVENT_ASSIGNMENT_RESTRICTED_ROLES.includes(input.role)) {
        await this.assignUserToAllEvents(userId, client);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const user = await this.getUserById(userId);
    if (!user) throw new Error("Failed to load newly created user");
    return user;
  }

  async updateUserRole(userId: string, role: UserRole) {
    const result = await this.pool.query(
      "UPDATE memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3",
      [role, DEFAULT_ORGANIZATION_ID, String(userId || "").trim()],
    );
    if (result.rowCount > 0 && EVENT_ASSIGNMENT_RESTRICTED_ROLES.includes(role)) {
      await this.assignUserToAllEvents(userId);
    }
    return result.rowCount > 0;
  }

  async setUserActive(userId: string, isActive: boolean) {
    const result = await this.pool.query(
      "UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [isActive, String(userId || "").trim()],
    );
    return result.rowCount > 0;
  }

  async removeUser(userId: string) {
    const result = await this.pool.query(
      "DELETE FROM users WHERE id = $1",
      [String(userId || "").trim()],
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

  async deleteSessionsForUser(userId: string) {
    await this.pool.query("DELETE FROM sessions WHERE user_id = $1", [String(userId || "").trim()]);
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

  async recordLlmUsage(entry: RecordLlmUsageInput) {
    await this.pool.query(
      `INSERT INTO llm_usage_events (
        id, event_id, actor_user_id, source, provider, model,
        prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
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
      ],
    );
  }

  async getLlmUsageSummary(eventId?: string) {
    const overallResult = await this.pool.query<Record<string, unknown>>(
      `SELECT
        COUNT(*) AS request_count,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
        MAX(created_at)::text AS last_used_at
       FROM llm_usage_events`,
    );

    const selectedEventResult = eventId
      ? await this.pool.query<Record<string, unknown>>(
          `SELECT
            COUNT(*) AS request_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
            MAX(created_at)::text AS last_used_at
           FROM llm_usage_events
           WHERE event_id = $1`,
          [String(eventId || "").trim()],
        )
      : null;

    const overallModelsResult = await this.pool.query<Record<string, unknown>>(
      `SELECT
        provider,
        model,
        COUNT(*) AS request_count,
        COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
        MAX(created_at)::text AS last_used_at
       FROM llm_usage_events
       GROUP BY provider, model
       ORDER BY total_tokens DESC, estimated_cost_usd DESC, request_count DESC
       LIMIT 5`,
    );

    const selectedEventModelsResult = eventId
      ? await this.pool.query<Record<string, unknown>>(
          `SELECT
            provider,
            model,
            COUNT(*) AS request_count,
            COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
            MAX(created_at)::text AS last_used_at
           FROM llm_usage_events
           WHERE event_id = $1
           GROUP BY provider, model
           ORDER BY total_tokens DESC, estimated_cost_usd DESC, request_count DESC
           LIMIT 5`,
          [String(eventId || "").trim()],
        )
      : null;

    return {
      overall: mapLlmUsageTotalsRow(overallResult.rows[0]),
      selected_event: mapLlmUsageTotalsRow(selectedEventResult?.rows[0]),
      overall_models: overallModelsResult.rows.map((row) => mapLlmUsageModelSummaryRow(row)),
      selected_event_models: (selectedEventModelsResult?.rows || []).map((row) => mapLlmUsageModelSummaryRow(row)),
    } satisfies LlmUsageSummaryRow;
  }

  async listCheckinSessions(eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
        id,
        event_id,
        created_by_user_id,
        label,
        created_at::text AS created_at,
        expires_at::text AS expires_at,
        last_used_at::text AS last_used_at,
        exchanged_at::text AS exchanged_at,
        revoked_at::text AS revoked_at
       FROM checkin_sessions
       WHERE event_id = $1
       ORDER BY created_at DESC`,
      [String(eventId || "").trim()],
    );
    return result.rows.map(mapCheckinSessionRow);
  }

  async createCheckinSession(input: CreateCheckinSessionInput) {
    const id = generateEntityId("cki");
    await this.pool.query(
      `INSERT INTO checkin_sessions (
        id, event_id, created_by_user_id, label, token_hash, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        String(input.event_id || "").trim(),
        input.created_by_user_id || null,
        String(input.label || "").trim(),
        String(input.token_hash || "").trim(),
        input.expires_at.toISOString(),
      ],
    );
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
        id,
        event_id,
        created_by_user_id,
        label,
        created_at::text AS created_at,
        expires_at::text AS expires_at,
        last_used_at::text AS last_used_at,
        exchanged_at::text AS exchanged_at,
        revoked_at::text AS revoked_at
       FROM checkin_sessions
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to load created check-in session");
    }
    return mapCheckinSessionRow(row);
  }

  async getCheckinSessionByTokenHash(tokenHash: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
        id,
        event_id,
        created_by_user_id,
        label,
        created_at::text AS created_at,
        expires_at::text AS expires_at,
        last_used_at::text AS last_used_at,
        exchanged_at::text AS exchanged_at,
        revoked_at::text AS revoked_at
       FROM checkin_sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND exchanged_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [String(tokenHash || "").trim()],
    );
    return result.rows[0] ? mapCheckinSessionRow(result.rows[0]) : undefined;
  }

  async exchangeCheckinSessionToken(input: ExchangeCheckinSessionTokenInput) {
    const checkinTokenHash = String(input.checkin_token_hash || "").trim();
    const accessTokenHash = String(input.access_token_hash || "").trim();
    const maxSessionTtlMs = Math.max(60_000, Number(input.max_session_ttl_ms || 0));
    if (!checkinTokenHash || !accessTokenHash) {
      return undefined;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const sourceResult = await client.query<Record<string, unknown>>(
        `SELECT
          id,
          event_id,
          label,
          expires_at::text AS expires_at
         FROM checkin_sessions
         WHERE token_hash = $1
           AND revoked_at IS NULL
           AND exchanged_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP
         LIMIT 1
         FOR UPDATE`,
        [checkinTokenHash],
      );
      const source = sourceResult.rows[0];
      if (!source) {
        await client.query("ROLLBACK");
        return undefined;
      }

      const now = Date.now();
      const sourceExpiresAtMs = Date.parse(String(source.expires_at || ""));
      if (!Number.isFinite(sourceExpiresAtMs) || sourceExpiresAtMs <= now) {
        await client.query("ROLLBACK");
        return undefined;
      }

      const accessExpiresAtMs = Math.min(sourceExpiresAtMs, now + maxSessionTtlMs);
      if (accessExpiresAtMs <= now) {
        await client.query("ROLLBACK");
        return undefined;
      }

      const markResult = await client.query(
        `UPDATE checkin_sessions
         SET exchanged_at = CURRENT_TIMESTAMP,
             last_used_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND revoked_at IS NULL
           AND exchanged_at IS NULL`,
        [String(source.id || "").trim()],
      );
      if (markResult.rowCount <= 0) {
        await client.query("ROLLBACK");
        return undefined;
      }

      const accessSessionId = generateEntityId("cas");
      await client.query(
        `INSERT INTO checkin_access_sessions (
          id, checkin_session_id, event_id, label, token_hash, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          accessSessionId,
          String(source.id || "").trim(),
          String(source.event_id || "").trim(),
          String(source.label || "").trim(),
          accessTokenHash,
          new Date(accessExpiresAtMs).toISOString(),
        ],
      );

      const accessResult = await client.query<Record<string, unknown>>(
        `SELECT
          id,
          checkin_session_id,
          event_id,
          label,
          created_at::text AS created_at,
          expires_at::text AS expires_at,
          last_used_at::text AS last_used_at,
          revoked_at::text AS revoked_at
         FROM checkin_access_sessions
         WHERE id = $1
         LIMIT 1`,
        [accessSessionId],
      );

      await client.query("COMMIT");
      return accessResult.rows[0] ? mapCheckinAccessSessionRow(accessResult.rows[0]) : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getCheckinAccessSessionByTokenHash(tokenHash: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
        id,
        checkin_session_id,
        event_id,
        label,
        created_at::text AS created_at,
        expires_at::text AS expires_at,
        last_used_at::text AS last_used_at,
        revoked_at::text AS revoked_at
       FROM checkin_access_sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [String(tokenHash || "").trim()],
    );
    return result.rows[0] ? mapCheckinAccessSessionRow(result.rows[0]) : undefined;
  }

  async touchCheckinSession(sessionId: string) {
    await this.pool.query(
      "UPDATE checkin_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1",
      [String(sessionId || "").trim()],
    );
  }

  async touchCheckinAccessSession(sessionId: string) {
    await this.pool.query(
      "UPDATE checkin_access_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1",
      [String(sessionId || "").trim()],
    );
  }

  async revokeCheckinSession(sessionId: string) {
    const normalizedSessionId = String(sessionId || "").trim();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE checkin_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1 AND revoked_at IS NULL",
        [normalizedSessionId],
      );
      if (result.rowCount > 0) {
        await client.query(
          "UPDATE checkin_access_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE checkin_session_id = $1 AND revoked_at IS NULL",
          [normalizedSessionId],
        );
      }
      await client.query("COMMIT");
      return result.rowCount > 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteExpiredCheckinSessions() {
    await this.pool.query(
      "DELETE FROM checkin_sessions WHERE expires_at <= CURRENT_TIMESTAMP",
    );
  }

  async deleteExpiredCheckinAccessSessions() {
    await this.pool.query(
      "DELETE FROM checkin_access_sessions WHERE expires_at <= CURRENT_TIMESTAMP",
    );
  }

  private async uniqueEventSlug(baseName: string, excludeId?: string) {
    const base = slugifyText(baseName);
    let candidate = base;
    let attempt = 1;
    while (true) {
      const values: unknown[] = [candidate];
      let sql = "SELECT id FROM events WHERE slug = $1";
      if (excludeId) {
        values.push(excludeId);
        sql += ` AND id != $${values.length}`;
      }
      const result = await this.pool.query<{ id: string }>(sql, values);
      if (!result.rows[0]) return candidate;
      attempt += 1;
      candidate = `${base}-${attempt}`;
    }
  }

  private async seedDefaultSettings() {
    const entries = Object.entries(DEFAULT_SETTINGS_ENTRIES);
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

  private async ensureDefaultEvent() {
    const existingEventSettingsResult = await this.pool.query<SettingRow>(
      "SELECT key, value FROM event_settings WHERE event_id = $1",
      [DEFAULT_EVENT_ID],
    );
    const legacyGlobalEventSettingsResult = await this.pool.query<SettingRow>(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[])`,
      [EVENT_SETTING_KEYS],
    );
    const existingEventSettings = existingEventSettingsResult.rows;
    const legacyGlobalEventSettings = legacyGlobalEventSettingsResult.rows;
    const existingEventSettingsMap = Object.fromEntries(existingEventSettings.map((row) => [row.key, row.value])) as Record<string, string>;
    const legacyGlobalSettingsMap = Object.fromEntries(legacyGlobalEventSettings.map((row) => [row.key, row.value])) as Record<string, string>;
    const defaultName = String(
      existingEventSettingsMap.event_name
      || legacyGlobalSettingsMap.event_name
      || DEFAULT_SETTINGS_ENTRIES.event_name,
    );
    await this.pool.query(
      `INSERT INTO events (id, name, slug, status, is_default)
       VALUES ($1, $2, $3, 'active', TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_EVENT_ID, defaultName, "default-event"],
    );
    await this.pool.query(
      "UPDATE events SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [defaultName, DEFAULT_EVENT_ID],
    );

    for (const key of EVENT_SETTING_KEYS) {
      await this.pool.query(
        `INSERT INTO event_settings (event_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [DEFAULT_EVENT_ID, key, existingEventSettingsMap[key] || legacyGlobalSettingsMap[key] || DEFAULT_SETTINGS_ENTRIES[key]],
      );
    }
    await this.pool.query(
      `DELETE FROM settings WHERE key = ANY($1::text[])`,
      [EVENT_SETTING_KEYS],
    );

    await this.pool.query(
      "UPDATE registrations SET event_id = $1 WHERE event_id IS NULL OR BTRIM(event_id) = ''",
      [DEFAULT_EVENT_ID],
    );
    await this.pool.query(
      "UPDATE messages SET event_id = $1 WHERE event_id IS NULL OR BTRIM(event_id) = ''",
      [DEFAULT_EVENT_ID],
    );
  }

  private async ensureChannelAccountsBootstrap() {
    await this.pool.query(
      `INSERT INTO channel_accounts (id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at, updated_at)
       SELECT id, 'facebook', page_id, page_name, event_id, page_access_token, '{}', is_active, created_at, updated_at
       FROM facebook_pages
       ON CONFLICT (platform, external_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           event_id = EXCLUDED.event_id,
           access_token = COALESCE(NULLIF(EXCLUDED.access_token, ''), channel_accounts.access_token),
           is_active = EXCLUDED.is_active,
           updated_at = CURRENT_TIMESTAMP`,
    );
  }

  private async ensureChannelEventAssignmentsBootstrap() {
    await this.pool.query(
      `INSERT INTO channel_event_assignments (channel_id, event_id)
       SELECT ca.id, ca.event_id
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE cea.channel_id IS NULL
         AND ca.event_id IS NOT NULL
         AND BTRIM(ca.event_id) <> ''
       ON CONFLICT (channel_id) DO NOTHING`,
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

  private async assignUserToEvent(userId: string, eventId: string, client: QueryableClient = this.pool) {
    const normalizedUserId = String(userId || "").trim();
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedUserId || !normalizedEventId) return;
    await client.query(
      `INSERT INTO user_event_assignments (id, user_id, event_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, event_id) DO NOTHING`,
      [generateEntityId("uea"), normalizedUserId, normalizedEventId],
    );
  }

  private async assignUserToAllEvents(userId: string, client: QueryableClient = this.pool) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return;
    const eventsResult = await client.query<{ id: string }>("SELECT id FROM events");
    for (const row of eventsResult.rows) {
      await this.assignUserToEvent(normalizedUserId, row.id, client);
    }
  }

  private async assignEventToAllRestrictedUsers(eventId: string, client: QueryableClient = this.pool) {
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) return;
    const usersResult = await client.query<{ user_id: string }>(
      `SELECT user_id
       FROM memberships
       WHERE organization_id = $1
         AND role = ANY($2::text[])`,
      [DEFAULT_ORGANIZATION_ID, EVENT_ASSIGNMENT_RESTRICTED_ROLES],
    );
    for (const row of usersResult.rows) {
      await this.assignUserToEvent(row.user_id, normalizedEventId, client);
    }
  }

  private async bootstrapEventAssignmentsIfEmpty() {
    const countResult = await this.pool.query<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM user_event_assignments",
    );
    if (Number.parseInt(countResult.rows[0]?.total || "0", 10) > 0) {
      return;
    }

    const usersResult = await this.pool.query<{ user_id: string }>(
      `SELECT user_id
       FROM memberships
       WHERE organization_id = $1
         AND role = ANY($2::text[])`,
      [DEFAULT_ORGANIZATION_ID, EVENT_ASSIGNMENT_RESTRICTED_ROLES],
    );
    const eventsResult = await this.pool.query<{ id: string }>("SELECT id FROM events");
    for (const userRow of usersResult.rows) {
      for (const eventRow of eventsResult.rows) {
        await this.assignUserToEvent(userRow.user_id, eventRow.id);
      }
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
            "INSERT INTO messages (sender_id, event_id, text, timestamp, type) VALUES ($1, $2, $3, $4, $5)",
            [row.sender_id, DEFAULT_EVENT_ID, row.text, row.timestamp, row.type],
          );
        }
        for (const row of legacyRegistrations) {
          await client.query(
            `INSERT INTO registrations (id, sender_id, event_id, first_name, last_name, phone, email, timestamp, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              row.id,
              row.sender_id,
              DEFAULT_EVENT_ID,
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
        console.log(`[db] Bootstrapped Postgres from SQLite: ${legacySettings.length} settings, ${legacyMessages.length} messages, ${legacyRegistrations.length} registrations`);
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
