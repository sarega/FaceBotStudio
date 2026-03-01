import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { Pool } from "pg";
import { hashPassword, normalizeUsername } from "../auth";
import { getEffectiveEventStatus, getEventState } from "../datetime";
import { DEFAULT_EVENT_ID, DEFAULT_SETTINGS_ENTRIES, EVENT_SETTING_KEYS } from "./defaultSettings";
import { runPostgresMigrations } from "./migrate";
import type {
  AppDatabase,
  AuditLogEntryInput,
  AuditLogRow,
  AuthSessionRow,
  AuthUserRow,
  ChannelAccountRow,
  ChannelPlatform,
  CreateEventInput,
  EventDocumentRow,
  CreateUserInput,
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
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  } satisfies EventDocumentRow;
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
    const baseResult = await this.pool.query<SettingRow>("SELECT key, value FROM settings");
    const eventResult = await this.pool.query<SettingRow>(
      "SELECT key, value FROM event_settings WHERE event_id = $1",
      [eventId],
    );
    const settings = baseResult.rows.reduce((acc, row) => {
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

    const settings = await this.getSettingsMap(eventId);
    const countResult = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM registrations WHERE event_id = $1 AND status != 'cancelled'",
      [eventId],
    );
    const activeCount = Number.parseInt(countResult.rows[0]?.count || "0", 10);
    const limit = Number.parseInt(settings.reg_limit || "200", 10);
    if (activeCount >= limit) {
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
        await this.pool.query(
          `INSERT INTO registrations (id, sender_id, event_id, first_name, last_name, phone, email)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, senderId, eventId, firstName, lastName, phone, email],
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

  async saveMessage(senderId: string, text: string, type: MessageType, eventId?: string, pageId?: string) {
    await this.pool.query(
      "INSERT INTO messages (sender_id, event_id, page_id, text, type) VALUES ($1, $2, $3, $4, $5)",
      [senderId, eventId || DEFAULT_EVENT_ID, pageId || null, text, type],
    );
  }

  async listMessages(limit: number, eventId?: string) {
    if (eventId) {
      const result = await this.pool.query<MessageRow>(
        "SELECT id, sender_id, event_id, page_id, text, timestamp::text AS timestamp, type FROM messages WHERE event_id = $1 ORDER BY timestamp DESC, id DESC LIMIT $2",
        [eventId, limit],
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
      const templateSettings = await this.getSettingsMap(DEFAULT_EVENT_ID);
      for (const key of EVENT_SETTING_KEYS) {
        await client.query(
          `INSERT INTO event_settings (event_id, key, value)
           VALUES ($1, $2, $3)
           ON CONFLICT (event_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [id, key, templateSettings[key] || DEFAULT_SETTINGS_ENTRIES[key]],
        );
      }
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

  async listEventDocuments(eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT id, event_id, title, source_type, source_url, content, is_active, created_at::text AS created_at, updated_at::text AS updated_at FROM event_documents WHERE event_id = $1 ORDER BY updated_at DESC, created_at DESC",
      [String(eventId || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID],
    );
    return result.rows.map(mapEventDocumentRow);
  }

  async upsertEventDocument(input: UpsertEventDocumentInput) {
    const id = String(input.id || "").trim() || generateEntityId("doc");
    const eventId = String(input.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
    const title = String(input.title || "").trim() || "Untitled Document";
    const sourceType = String(input.source_type || "note").trim() || "note";
    const sourceUrl = String(input.source_url || "").trim();
    const content = String(input.content || "").trim();
    const isActive = input.is_active === false ? false : true;

    await this.pool.query(
      `INSERT INTO event_documents (id, event_id, title, source_type, source_url, content, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
       SET event_id = EXCLUDED.event_id,
           title = EXCLUDED.title,
           source_type = EXCLUDED.source_type,
           source_url = EXCLUDED.source_url,
           content = EXCLUDED.content,
           is_active = EXCLUDED.is_active,
           updated_at = CURRENT_TIMESTAMP`,
      [id, eventId, title, sourceType, sourceUrl || null, content, isActive],
    );

    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT id, event_id, title, source_type, source_url, content, is_active, created_at::text AS created_at, updated_at::text AS updated_at FROM event_documents WHERE id = $1 LIMIT 1",
      [id],
    );
    if (!result.rows[0]) throw new Error("Failed to upsert event document");
    return mapEventDocumentRow(result.rows[0]);
  }

  async setEventDocumentActive(documentId: string, isActive: boolean) {
    const result = await this.pool.query(
      "UPDATE event_documents SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [isActive, String(documentId || "").trim()],
    );
    return result.rowCount > 0;
  }

  async listChannelAccounts(platform?: ChannelPlatform) {
    const query = platform
      ? {
          sql: "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at::text AS created_at, updated_at::text AS updated_at FROM channel_accounts WHERE platform = $1 ORDER BY created_at ASC",
          values: [platform],
        }
      : {
          sql: "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at::text AS created_at, updated_at::text AS updated_at FROM channel_accounts ORDER BY created_at ASC",
          values: [] as unknown[],
        };
    const result = await this.pool.query<Record<string, unknown>>(query.sql, query.values);
    return result.rows.map(mapChannelRow);
  }

  async getChannelAccount(platform: ChannelPlatform, externalId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at::text AS created_at, updated_at::text AS updated_at FROM channel_accounts WHERE platform = $1 AND external_id = $2 LIMIT 1",
      [platform, String(externalId || "").trim()],
    );
    return result.rows[0] ? mapChannelRow(result.rows[0]) : undefined;
  }

  async upsertChannelAccount(input: UpsertChannelAccountInput) {
    const platform = (String(input.platform || "facebook").trim() || "facebook") as ChannelPlatform;
    const externalId = String(input.external_id || "").trim();
    const displayName = String(input.display_name || "").trim() || externalId;
    const eventId = String(input.event_id || DEFAULT_EVENT_ID).trim() || DEFAULT_EVENT_ID;
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
           event_id = EXCLUDED.event_id,
           access_token = COALESCE(NULLIF(EXCLUDED.access_token, ''), channel_accounts.access_token),
           config_json = EXCLUDED.config_json,
           is_active = EXCLUDED.is_active,
           updated_at = CURRENT_TIMESTAMP`,
      [id, platform, externalId, displayName, eventId, accessToken, configJson, input.is_active === false ? false : true],
    );

    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT id, platform, external_id, display_name, event_id, access_token, config_json, is_active, created_at::text AS created_at, updated_at::text AS updated_at FROM channel_accounts WHERE platform = $1 AND external_id = $2 LIMIT 1",
      [platform, externalId],
    );
    if (!result.rows[0]) throw new Error("Failed to upsert channel account");
    return mapChannelRow(result.rows[0]);
  }

  async resolveEventIdForChannel(platform: ChannelPlatform, externalId: string) {
    const result = await this.pool.query<{ event_id: string }>(
      "SELECT event_id FROM channel_accounts WHERE platform = $1 AND external_id = $2 AND is_active = TRUE LIMIT 1",
      [platform, String(externalId || "").trim()],
    );
    return result.rows[0]?.event_id || DEFAULT_EVENT_ID;
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
    if (!user) throw new Error("Failed to load newly created user");
    return user;
  }

  async updateUserRole(userId: string, role: UserRole) {
    const result = await this.pool.query(
      "UPDATE memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3",
      [role, DEFAULT_ORGANIZATION_ID, String(userId || "").trim()],
    );
    return result.rowCount > 0;
  }

  async setUserActive(userId: string, isActive: boolean) {
    const result = await this.pool.query(
      "UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [isActive, String(userId || "").trim()],
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
    const defaultName = String((await this.getSettingValue("event_name", DEFAULT_EVENT_ID)) || DEFAULT_SETTINGS_ENTRIES.event_name);
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

    const templateSettings = await this.getSettingsMap(DEFAULT_EVENT_ID);
    for (const key of EVENT_SETTING_KEYS) {
      await this.pool.query(
        `INSERT INTO event_settings (event_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [DEFAULT_EVENT_ID, key, templateSettings[key] || DEFAULT_SETTINGS_ENTRIES[key]],
      );
    }

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
