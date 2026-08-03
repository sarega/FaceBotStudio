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
  CreateMessageAttachmentInput,
  CreateEventInput,
  CreateCheckinSessionInput,
  CreateDirectTicketInput,
  ExchangeCheckinSessionTokenInput,
  EventDocumentChunkEmbeddingRow,
  EventDocumentChunkRow,
  EventDocumentRow,
  CreateUserInput,
  EmbeddingStatus,
  EventStatus,
  EventRow,
  DirectPerformanceRow,
  DirectSeatRow,
  DirectTicketRow,
  FacebookPageRow,
  ManualEventStatus,
  MessageAttachmentRow,
  MessageRow,
  MessageType,
  LlmUsageModelSummaryRow,
  LlmUsageSummaryRow,
  LlmUsageTotalsRow,
  OrganizerProfileRow,
  OrganizerVerificationStatus,
  OutreachAssetRow,
  OutreachCampaignRow,
  OutreachDeliveryRow,
  OutreachDraftRow,
  OutreachTargetRow,
  CreateOutreachAssetInput,
  CreateOutreachCampaignInput,
  CreateOutreachDraftInput,
  CreateOutreachDeliveryInput,
  CreateOutreachTargetInput,
  UpdateOutreachCampaignInput,
  UpdateOutreachTargetInput,
  PersistChunkEmbeddingInput,
  RecordLlmUsageInput,
  RegistrationInput,
  RegistrationEmailDeliveryRow,
  RegistrationResult,
  RegistrationRow,
  RegistrationStatus,
  SettingRow,
  UpdateEventInput,
  UpsertDirectPerformanceInput,
  ImportDirectSeatInput,
  UpdateOrganizerProfileInput,
  UpsertChannelAccountInput,
  UpsertEventDocumentInput,
  UpsertFacebookPageInput,
  UserRole,
  UserPreferencesRow,
} from "./types";
import { getSystemAuditMetadata } from "../runtime/systemInfo";

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
    organizer_id: typeof row.organizer_id === "string" && row.organizer_id.trim() ? row.organizer_id : DEFAULT_ORGANIZATION_ID,
    organizer_name: typeof row.organizer_name === "string" && row.organizer_name.trim() ? row.organizer_name : DEFAULT_ORGANIZATION_NAME,
    status: (String(row.status || "active") as ManualEventStatus),
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapOrganizerProfileRow(row?: Record<string, unknown>) {
  if (!row) return undefined;
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    slug: String(row.slug || ""),
    legal_name: typeof row.legal_name === "string" && row.legal_name ? row.legal_name : null,
    public_display_name: typeof row.public_display_name === "string" && row.public_display_name ? row.public_display_name : null,
    public_description: typeof row.public_description === "string" && row.public_description ? row.public_description : null,
    public_logo_url: typeof row.public_logo_url === "string" && row.public_logo_url ? row.public_logo_url : null,
    public_website_url: typeof row.public_website_url === "string" && row.public_website_url ? row.public_website_url : null,
    public_facebook_url: typeof row.public_facebook_url === "string" && row.public_facebook_url ? row.public_facebook_url : null,
    public_line_url: typeof row.public_line_url === "string" && row.public_line_url ? row.public_line_url : null,
    public_contact_text: typeof row.public_contact_text === "string" && row.public_contact_text ? row.public_contact_text : null,
    verification_status: String(row.verification_status || "draft") as OrganizerVerificationStatus,
    verification_notes: typeof row.verification_notes === "string" && row.verification_notes ? row.verification_notes : null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || row.created_at || ""),
  } satisfies OrganizerProfileRow;
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

function mapMessageAttachmentRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""),
    message_id: Number(row.message_id || 0),
    kind: "image",
    url: String(row.url || ""),
    absolute_url: typeof row.absolute_url === "string" ? row.absolute_url : null,
    mime_type: typeof row.mime_type === "string" ? row.mime_type : null,
    name: typeof row.name === "string" ? row.name : null,
    size_bytes: Number.isFinite(Number(row.size_bytes)) ? Number(row.size_bytes) : null,
    created_at: String(row.created_at || ""),
  } satisfies MessageAttachmentRow;
}

function mapChannelRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    platform: String(row.platform) as ChannelPlatform,
    external_id: String(row.external_id),
    display_name: String(row.display_name),
    organizer_id: typeof row.organizer_id === "string" && row.organizer_id.trim() ? row.organizer_id : DEFAULT_ORGANIZATION_ID,
    event_id: row.event_id == null ? null : String(row.event_id),
    access_token: typeof row.access_token === "string" ? row.access_token : null,
    config_json: typeof row.config_json === "string" ? row.config_json : "{}",
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  } satisfies ChannelAccountRow;
}

function collapseChannelRows(rows: Array<Record<string, unknown>>) {
  const channels = new Map<string, ChannelAccountRow>();
  for (const row of rows) {
    const mapped = mapChannelRow(row);
    const channel = channels.get(mapped.id) || { ...mapped, event_ids: [] };
    if (mapped.event_id && !channel.event_ids?.includes(mapped.event_id)) {
      channel.event_ids?.push(mapped.event_id);
    }
    channel.event_id = channel.event_ids?.[0] || null;
    channels.set(mapped.id, channel);
  }
  return [...channels.values()];
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

function mapSqliteTimestamp(value: unknown) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
}

function mapDirectPerformanceRow(row: Record<string, unknown>) {
  return { id: String(row.id || ""), event_id: String(row.event_id || ""), code: String(row.code || ""), title: String(row.title || ""), starts_at: String(row.starts_at || ""), ends_at: typeof row.ends_at === "string" ? row.ends_at : null, seat_plan_image_url: typeof row.seat_plan_image_url === "string" ? row.seat_plan_image_url : null, is_active: Boolean(row.is_active), created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at) } satisfies DirectPerformanceRow;
}

function mapDirectSeatRow(row: Record<string, unknown>) {
  return { id: String(row.id || ""), event_id: String(row.event_id || ""), performance_id: String(row.performance_id || ""), zone: String(row.zone || ""), section_label: typeof row.section_label === "string" ? row.section_label : null, row_label: String(row.row_label || ""), seat_label: String(row.seat_label || ""), external_seat_ref: typeof row.external_seat_ref === "string" ? row.external_seat_ref : null, face_value: row.face_value == null ? null : Number(row.face_value), x: row.x == null ? null : Number(row.x), y: row.y == null ? null : Number(row.y), status: String(row.status || "available") as DirectSeatRow["status"], allocation_status: String(row.allocation_status || "allocated") as DirectSeatRow["allocation_status"], source_status: String(row.source_status || "unknown") as DirectSeatRow["source_status"], created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at) } satisfies DirectSeatRow;
}

function mapDirectTicketRow(row: Record<string, unknown>) {
  return { id: String(row.id || ""), event_id: String(row.event_id || ""), performance_id: String(row.performance_id || ""), seat_id: String(row.seat_id || ""), ticket_class: String(row.ticket_class || ""), holder_name: String(row.holder_name || ""), buyer_name: String(row.buyer_name || ""), phone: String(row.phone || ""), email: String(row.email || ""), price_amount: Number(row.price_amount || 0), payment_status: String(row.payment_status || "awaiting_payment") as DirectTicketRow["payment_status"], payment_reference: typeof row.payment_reference === "string" ? row.payment_reference : null, payment_proof_mime: typeof row.payment_proof_mime === "string" ? row.payment_proof_mime : null, payment_proof_base64: typeof row.payment_proof_base64 === "string" ? row.payment_proof_base64 : null, payment_proof_submitted_at: typeof row.payment_proof_submitted_at === "string" ? mapSqliteTimestamp(row.payment_proof_submitted_at) : null, rejection_reason: typeof row.rejection_reason === "string" ? row.rejection_reason : null, hold_expires_at: typeof row.hold_expires_at === "string" ? mapSqliteTimestamp(row.hold_expires_at) : null, source: row.source === "public" ? "public" : "admin", status: String(row.status || "held") as DirectTicketRow["status"], issued_by_user_id: typeof row.issued_by_user_id === "string" ? row.issued_by_user_id : null, payment_verified_by_user_id: typeof row.payment_verified_by_user_id === "string" ? row.payment_verified_by_user_id : null, payment_verified_at: typeof row.payment_verified_at === "string" ? mapSqliteTimestamp(row.payment_verified_at) : null, issued_at: typeof row.issued_at === "string" ? mapSqliteTimestamp(row.issued_at) : null, checked_in_at: typeof row.checked_in_at === "string" ? mapSqliteTimestamp(row.checked_in_at) : null, voided_at: typeof row.voided_at === "string" ? mapSqliteTimestamp(row.voided_at) : null, created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at), performance_code: typeof row.performance_code === "string" ? row.performance_code : undefined, performance_title: typeof row.performance_title === "string" ? row.performance_title : undefined, performance_starts_at: typeof row.performance_starts_at === "string" ? row.performance_starts_at : undefined, performance_ends_at: typeof row.performance_ends_at === "string" ? row.performance_ends_at : undefined, zone: typeof row.zone === "string" ? row.zone : undefined, row_label: typeof row.row_label === "string" ? row.row_label : undefined, seat_label: typeof row.seat_label === "string" ? row.seat_label : undefined } satisfies DirectTicketRow;
}

function mapOutreachCampaignRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), event_id: String(row.event_id || ""), name: String(row.name || ""),
    description: String(row.description || ""), objective: String(row.objective || ""), context: String(row.context || ""),
    default_instruction: String(row.default_instruction || ""), start_date: typeof row.start_date === "string" ? row.start_date : null,
    end_date: typeof row.end_date === "string" ? row.end_date : null, status: String(row.status || "draft") as OutreachCampaignRow["status"],
    created_by_user_id: typeof row.created_by_user_id === "string" ? row.created_by_user_id : null,
    created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at),
    target_count: Number(row.target_count || 0), needs_action_count: Number(row.needs_action_count || 0), follow_up_due_count: Number(row.follow_up_due_count || 0),
    not_contacted_count: Number(row.not_contacted_count || 0), waiting_count: Number(row.waiting_count || 0), replied_count: Number(row.replied_count || 0),
    press_kit_sent_count: Number(row.press_kit_sent_count || 0), published_count: Number(row.published_count || 0), declined_count: Number(row.declined_count || 0), no_response_count: Number(row.no_response_count || 0),
  } satisfies OutreachCampaignRow;
}

function mapOutreachTargetRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), campaign_id: String(row.campaign_id || ""), event_id: String(row.event_id || ""), name: String(row.name || ""),
    facebook_page_url: String(row.facebook_page_url || ""), facebook_page_id: typeof row.facebook_page_id === "string" ? row.facebook_page_id : null,
    organization_type: String(row.organization_type || "other"), contact_person: typeof row.contact_person === "string" ? row.contact_person : null,
    email: typeof row.email === "string" ? row.email : null, website: typeof row.website === "string" ? row.website : null, notes: String(row.notes || ""),
    priority: String(row.priority || "normal") as OutreachTargetRow["priority"], status: String(row.status || "new") as OutreachTargetRow["status"],
    delivery_mode: String(row.delivery_mode || "manual_first_contact") as OutreachTargetRow["delivery_mode"],
    bound_sender_id: typeof row.bound_sender_id === "string" ? row.bound_sender_id : null, bound_page_id: typeof row.bound_page_id === "string" ? row.bound_page_id : null,
    last_contacted_at: typeof row.last_contacted_at === "string" ? mapSqliteTimestamp(row.last_contacted_at) : null,
    last_replied_at: typeof row.last_replied_at === "string" ? mapSqliteTimestamp(row.last_replied_at) : null,
    next_follow_up_at: typeof row.next_follow_up_at === "string" ? mapSqliteTimestamp(row.next_follow_up_at) : null,
    outcome_note: typeof row.outcome_note === "string" ? row.outcome_note : null, assigned_user_id: typeof row.assigned_user_id === "string" ? row.assigned_user_id : null,
    created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at),
  } satisfies OutreachTargetRow;
}

function mapOutreachDraftRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), target_id: String(row.target_id || ""), campaign_id: String(row.campaign_id || ""), event_id: String(row.event_id || ""),
    revision: Number(row.revision || 0), body: String(row.body || ""), kind: String(row.kind || "initial") as OutreachDraftRow["kind"], source_message_id: row.source_message_id == null ? null : Number(row.source_message_id), approval_status: String(row.approval_status || "draft") as OutreachDraftRow["approval_status"],
    approved_by_user_id: typeof row.approved_by_user_id === "string" ? row.approved_by_user_id : null, approved_at: typeof row.approved_at === "string" ? mapSqliteTimestamp(row.approved_at) : null,
    created_by_user_id: typeof row.created_by_user_id === "string" ? row.created_by_user_id : null, created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at),
  } satisfies OutreachDraftRow;
}

function mapOutreachDeliveryRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), target_id: String(row.target_id || ""), campaign_id: String(row.campaign_id || ""), event_id: String(row.event_id || ""),
    draft_id: typeof row.draft_id === "string" ? row.draft_id : null, asset_id: typeof row.asset_id === "string" ? row.asset_id : null,
    kind: String(row.kind || "text") as OutreachDeliveryRow["kind"], channel_platform: String(row.channel_platform || "facebook") as OutreachDeliveryRow["channel_platform"],
    channel_external_id: String(row.channel_external_id || ""), recipient_id: String(row.recipient_id || ""), idempotency_key: String(row.idempotency_key || ""),
    status: String(row.status || "pending") as OutreachDeliveryRow["status"], external_message_id: typeof row.external_message_id === "string" ? row.external_message_id : null,
    error_message: typeof row.error_message === "string" ? row.error_message : null, sent_by_user_id: typeof row.sent_by_user_id === "string" ? row.sent_by_user_id : null,
    sent_at: typeof row.sent_at === "string" ? mapSqliteTimestamp(row.sent_at) : null, created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at),
  } satisfies OutreachDeliveryRow;
}

function mapOutreachAssetRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), campaign_id: String(row.campaign_id || ""), event_id: String(row.event_id || ""), name: String(row.name || ""),
    type: String(row.type || "other"), description: String(row.description || ""), url: String(row.url || ""), tags: String(row.tags || ""),
    is_active: Boolean(row.is_active), created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at),
  } satisfies OutreachAssetRow;
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
      CREATE TABLE IF NOT EXISTS message_attachments (
        id TEXT PRIMARY KEY,
        message_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'image',
        url TEXT NOT NULL,
        absolute_url TEXT,
        mime_type TEXT,
        name TEXT,
        size_bytes INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
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
        legal_name TEXT,
        public_display_name TEXT,
        public_description TEXT,
        public_logo_url TEXT,
        public_website_url TEXT,
        public_facebook_url TEXT,
        public_line_url TEXT,
        public_contact_text TEXT,
        verification_status TEXT NOT NULL DEFAULT 'draft',
        verification_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        language TEXT NOT NULL DEFAULT 'th' CHECK (language IN ('th', 'en')),
        timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
        organizer_id TEXT NOT NULL DEFAULT 'org_default',
        is_default INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organizer_id) REFERENCES organizations(id) ON DELETE RESTRICT
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
        organizer_id TEXT,
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
        channel_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, event_id),
        FOREIGN KEY (channel_id) REFERENCES channel_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS channel_sender_event_selections (
        channel_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, sender_id),
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
      CREATE TABLE IF NOT EXISTS outreach_campaigns (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        objective TEXT NOT NULL DEFAULT '',
        context TEXT NOT NULL DEFAULT '',
        default_instruction TEXT NOT NULL DEFAULT '',
        start_date TEXT,
        end_date TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
        created_by_user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS outreach_targets (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        facebook_page_url TEXT NOT NULL DEFAULT '',
        facebook_page_id TEXT,
        organization_type TEXT NOT NULL DEFAULT 'other',
        contact_person TEXT,
        email TEXT,
        website TEXT,
        notes TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'drafted', 'approved', 'contacted', 'waiting_reply', 'replied', 'press_kit_sent', 'follow_up', 'published', 'declined', 'no_response')),
        delivery_mode TEXT NOT NULL DEFAULT 'manual_first_contact' CHECK (delivery_mode IN ('manual_first_contact', 'api_reply_eligible', 'manual_only', 'unavailable')),
        bound_sender_id TEXT,
        bound_page_id TEXT,
        last_contacted_at DATETIME,
        last_replied_at DATETIME,
        next_follow_up_at DATETIME,
        outcome_note TEXT,
        assigned_user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS outreach_drafts (
        id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        body TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial', 'suggested_reply')),
        source_message_id INTEGER,
        approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'approved')),
        approved_by_user_id TEXT,
        approved_at DATETIME,
        created_by_user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (target_id, revision),
        FOREIGN KEY (target_id) REFERENCES outreach_targets(id) ON DELETE CASCADE,
        FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS outreach_assets (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        description TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS outreach_deliveries (
        id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        draft_id TEXT,
        asset_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('text', 'asset')),
        channel_platform TEXT NOT NULL,
        channel_external_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
        external_message_id TEXT,
        error_message TEXT,
        sent_by_user_id TEXT,
        sent_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (event_id, idempotency_key),
        FOREIGN KEY (target_id) REFERENCES outreach_targets(id) ON DELETE CASCADE,
        FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (draft_id) REFERENCES outreach_drafts(id) ON DELETE SET NULL,
        FOREIGN KEY (asset_id) REFERENCES outreach_assets(id) ON DELETE SET NULL,
        FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS event_performances (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL,
        starts_at DATETIME NOT NULL, ends_at DATETIME, is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (event_id, code), FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS direct_seats (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL, performance_id TEXT NOT NULL, zone TEXT NOT NULL,
        row_label TEXT NOT NULL, seat_label TEXT NOT NULL, section_label TEXT, external_seat_ref TEXT, face_value REAL,
        x REAL, y REAL, status TEXT NOT NULL DEFAULT 'available', allocation_status TEXT NOT NULL DEFAULT 'allocated',
        source_status TEXT NOT NULL DEFAULT 'unknown', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE (performance_id, zone, row_label, seat_label),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (performance_id) REFERENCES event_performances(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS direct_tickets (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL, performance_id TEXT NOT NULL, seat_id TEXT NOT NULL,
        ticket_class TEXT NOT NULL, holder_name TEXT NOT NULL DEFAULT '', buyer_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', price_amount REAL NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL, payment_reference TEXT, status TEXT NOT NULL, issued_by_user_id TEXT,
        payment_verified_by_user_id TEXT, payment_verified_at DATETIME, issued_at DATETIME, checked_in_at DATETIME,
        voided_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (performance_id) REFERENCES event_performances(id) ON DELETE RESTRICT,
        FOREIGN KEY (seat_id) REFERENCES direct_seats(id) ON DELETE RESTRICT
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
      CREATE INDEX IF NOT EXISTS idx_channel_sender_event_selections_event_id ON channel_sender_event_selections (event_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments (message_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_event_documents_event_id ON event_documents (event_id);
      CREATE INDEX IF NOT EXISTS idx_event_documents_active ON event_documents (event_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_event_updated ON outreach_campaigns (event_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_outreach_targets_campaign_status ON outreach_targets (campaign_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_outreach_targets_identity ON outreach_targets (event_id, bound_page_id, bound_sender_id);
      CREATE INDEX IF NOT EXISTS idx_outreach_targets_follow_up ON outreach_targets (event_id, next_follow_up_at);
      CREATE INDEX IF NOT EXISTS idx_outreach_drafts_target_revision ON outreach_drafts (target_id, revision DESC);
      CREATE INDEX IF NOT EXISTS idx_outreach_assets_campaign ON outreach_assets (campaign_id, is_active, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_event_document_chunks_event_id ON event_document_chunks (event_id);
      CREATE INDEX IF NOT EXISTS idx_event_document_chunks_document_id ON event_document_chunks (document_id);
      CREATE INDEX IF NOT EXISTS idx_event_document_chunks_order ON event_document_chunks (document_id, chunk_index);
      CREATE INDEX IF NOT EXISTS idx_user_event_assignments_user_id ON user_event_assignments (user_id);
      CREATE INDEX IF NOT EXISTS idx_user_event_assignments_event_id ON user_event_assignments (event_id);
      CREATE INDEX IF NOT EXISTS idx_direct_seats_event_performance ON direct_seats (event_id, performance_id, status);
      CREATE INDEX IF NOT EXISTS idx_direct_tickets_event ON direct_tickets (event_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_tickets_active_seat ON direct_tickets (seat_id) WHERE status IN ('held', 'issued', 'checked_in');
    `);

    this.ensureColumn("registrations", "event_id", "TEXT");
    this.ensureColumn("messages", "event_id", "TEXT");
    this.ensureColumn("messages", "page_id", "TEXT");
    this.ensureColumn("facebook_pages", "page_access_token", "TEXT");
    this.ensureColumn("channel_accounts", "organizer_id", "TEXT");
    this.ensureColumn("channel_accounts", "config_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("event_documents", "source_url", "TEXT");
    this.ensureColumn("event_documents", "content_hash", "TEXT");
    this.ensureColumn("outreach_targets", "last_replied_at", "DATETIME");
    this.ensureColumn("outreach_targets", "assigned_user_id", "TEXT");
    this.ensureColumn("outreach_drafts", "kind", "TEXT NOT NULL DEFAULT 'initial'");
    this.ensureColumn("outreach_drafts", "source_message_id", "INTEGER");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_outreach_targets_replied ON outreach_targets (event_id, last_replied_at DESC);
      CREATE INDEX IF NOT EXISTS idx_outreach_targets_assignee ON outreach_targets (event_id, assigned_user_id, status);
      CREATE INDEX IF NOT EXISTS idx_outreach_deliveries_target ON outreach_deliveries (event_id, target_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_outreach_deliveries_idempotency ON outreach_deliveries (event_id, idempotency_key);
    `);
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
    this.ensureColumn("events", "organizer_id", "TEXT");
    this.ensureColumn("organizations", "legal_name", "TEXT");
    this.ensureColumn("organizations", "public_display_name", "TEXT");
    this.ensureColumn("organizations", "public_description", "TEXT");
    this.ensureColumn("organizations", "public_logo_url", "TEXT");
    this.ensureColumn("organizations", "public_website_url", "TEXT");
    this.ensureColumn("organizations", "public_facebook_url", "TEXT");
    this.ensureColumn("organizations", "public_line_url", "TEXT");
    this.ensureColumn("organizations", "public_contact_text", "TEXT");
    this.ensureColumn("organizations", "verification_status", "TEXT NOT NULL DEFAULT 'draft'");
    this.ensureColumn("organizations", "verification_notes", "TEXT");
    this.ensureColumn("organizations", "updated_at", "DATETIME");
    this.ensureColumn("checkin_sessions", "exchanged_at", "DATETIME");
    this.ensureColumn("event_performances", "seat_plan_image_url", "TEXT");
    this.ensureColumn("direct_seats", "allocation_status", "TEXT NOT NULL DEFAULT 'allocated'");
    this.ensureColumn("direct_seats", "source_status", "TEXT NOT NULL DEFAULT 'unknown'");
    this.ensureColumn("direct_seats", "section_label", "TEXT");
    this.ensureColumn("direct_tickets", "hold_expires_at", "DATETIME");
    this.ensureColumn("direct_tickets", "payment_proof_mime", "TEXT");
    this.ensureColumn("direct_tickets", "payment_proof_base64", "TEXT");
    this.ensureColumn("direct_tickets", "payment_proof_submitted_at", "DATETIME");
    this.ensureColumn("direct_tickets", "rejection_reason", "TEXT");
    this.ensureColumn("direct_tickets", "source", "TEXT NOT NULL DEFAULT 'admin'");
    this.migrateChannelEventAssignmentsToMany();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_organizer_id ON events (organizer_id);
      CREATE INDEX IF NOT EXISTS idx_channel_accounts_organizer_id ON channel_accounts (organizer_id);
      CREATE INDEX IF NOT EXISTS idx_channel_event_assignments_event_id ON channel_event_assignments (event_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_tickets_verified_payment_reference
        ON direct_tickets (payment_reference)
        WHERE payment_status = 'verified' AND payment_reference IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_direct_tickets_review_queue
        ON direct_tickets (event_id, payment_status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_direct_tickets_expiring_holds
        ON direct_tickets (hold_expires_at)
        WHERE status = 'held';

      UPDATE direct_tickets
      SET payment_status = 'awaiting_payment'
      WHERE payment_status = 'pending';

      UPDATE events
      SET organizer_id = '${DEFAULT_ORGANIZATION_ID}'
      WHERE organizer_id IS NULL OR TRIM(organizer_id) = '';

      UPDATE organizations
      SET verification_status = 'draft'
      WHERE verification_status IS NULL OR TRIM(verification_status) = '';

      UPDATE organizations
      SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
      WHERE updated_at IS NULL OR TRIM(updated_at) = '';

      INSERT OR IGNORE INTO channel_event_assignments (channel_id, event_id)
      SELECT id, event_id
      FROM channel_accounts
      WHERE event_id IS NOT NULL AND TRIM(event_id) <> '';

      UPDATE channel_accounts
      SET organizer_id = COALESCE(
        NULLIF(TRIM(organizer_id), ''),
        (SELECT events.organizer_id FROM events WHERE events.id = channel_accounts.event_id),
        '${DEFAULT_ORGANIZATION_ID}'
      )
      WHERE organizer_id IS NULL OR TRIM(organizer_id) = '';

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

  async getEventSettingUpdatedAt(eventId: string, key: string) {
    const row = this.db.prepare(
      "SELECT updated_at FROM event_settings WHERE event_id = ? AND key = ?",
    ).get(eventId, key) as { updated_at?: string } | undefined;
    return row?.updated_at || null;
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
    if (event.effective_status === "archived") {
      return { statusCode: 400, content: { error: "This event has been archived" } };
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

  async listDirectPerformances(eventId: string) {
    return this.db.prepare("SELECT * FROM event_performances WHERE event_id = ? ORDER BY starts_at").all(eventId).map((row) => mapDirectPerformanceRow(row as Record<string, unknown>));
  }

  async upsertDirectPerformance(input: UpsertDirectPerformanceInput) {
    const eventId = String(input.event_id || "").trim();
    const code = String(input.code || "").trim();
    const existing = this.db.prepare("SELECT id FROM event_performances WHERE event_id = ? AND code = ?").get(eventId, code) as { id?: string } | undefined;
    const id = existing?.id || generateEntityId("perf");
    this.db.prepare(`INSERT INTO event_performances (id, event_id, code, title, starts_at, ends_at, seat_plan_image_url, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id, code) DO UPDATE SET title=excluded.title, starts_at=excluded.starts_at, ends_at=excluded.ends_at, seat_plan_image_url=excluded.seat_plan_image_url, is_active=excluded.is_active, updated_at=CURRENT_TIMESTAMP`)
      .run(id, eventId, code, String(input.title || "").trim(), input.starts_at, input.ends_at || null, input.seat_plan_image_url || null, input.is_active === false ? 0 : 1);
    return mapDirectPerformanceRow(this.db.prepare("SELECT * FROM event_performances WHERE id = ?").get(id) as Record<string, unknown>);
  }

  async deleteDirectPerformance(eventId: string, performanceId: string) {
    const result = this.db.transaction(() => {
      const performance = this.db.prepare("SELECT id FROM event_performances WHERE id = ? AND event_id = ?").get(performanceId, eventId);
      if (!performance) return undefined;
      const tickets = Number((this.db.prepare("SELECT COUNT(*) AS count FROM direct_tickets WHERE performance_id = ? AND event_id = ?").get(performanceId, eventId) as { count?: number })?.count || 0);
      const seats = Number((this.db.prepare("SELECT COUNT(*) AS count FROM direct_seats WHERE performance_id = ? AND event_id = ?").get(performanceId, eventId) as { count?: number })?.count || 0);
      if (tickets > 0) return { status: "blocked" as const, tickets, seats };
      this.db.prepare("DELETE FROM direct_seats WHERE performance_id = ? AND event_id = ?").run(performanceId, eventId);
      this.db.prepare("DELETE FROM event_performances WHERE id = ? AND event_id = ?").run(performanceId, eventId);
      return { status: "deleted" as const, tickets, seats };
    });
    return result();
  }

  async resetDirectPerformance(eventId: string, performanceId: string) {
    const reset = this.db.transaction(() => {
      const performance = this.db.prepare("SELECT id FROM event_performances WHERE id = ? AND event_id = ?").get(performanceId, eventId);
      if (!performance) return undefined;
      const tickets = Number((this.db.prepare("SELECT COUNT(*) AS count FROM direct_tickets WHERE performance_id = ? AND event_id = ?").get(performanceId, eventId) as { count?: number })?.count || 0);
      const seats = Number((this.db.prepare("SELECT COUNT(*) AS count FROM direct_seats WHERE performance_id = ? AND event_id = ?").get(performanceId, eventId) as { count?: number })?.count || 0);
      this.db.prepare("DELETE FROM direct_tickets WHERE performance_id = ? AND event_id = ?").run(performanceId, eventId);
      this.db.prepare("DELETE FROM direct_seats WHERE performance_id = ? AND event_id = ?").run(performanceId, eventId);
      return { tickets, seats };
    });
    return reset();
  }

  async listDirectSeats(eventId: string, performanceId?: string) {
    await this.releaseExpiredDirectTicketHolds(eventId);
    const rows = performanceId ? this.db.prepare("SELECT * FROM direct_seats WHERE event_id = ? AND performance_id = ? ORDER BY zone, row_label, seat_label").all(eventId, performanceId) : this.db.prepare("SELECT * FROM direct_seats WHERE event_id = ? ORDER BY zone, row_label, seat_label").all(eventId);
    return rows.map((row) => mapDirectSeatRow(row as Record<string, unknown>));
  }

  async importDirectSeats(eventId: string, performanceId: string, seats: ImportDirectSeatInput[], options?: { replaceMissing?: boolean }) {
    const insert = this.db.prepare(`INSERT INTO direct_seats (id,event_id,performance_id,zone,section_label,row_label,seat_label,external_seat_ref,face_value,x,y,allocation_status,source_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(performance_id,zone,row_label,seat_label) DO UPDATE SET section_label=excluded.section_label,external_seat_ref=excluded.external_seat_ref,face_value=excluded.face_value,x=excluded.x,y=excluded.y,allocation_status=excluded.allocation_status,source_status=excluded.source_status,updated_at=CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM direct_tickets WHERE direct_tickets.seat_id=direct_seats.id AND direct_tickets.status IN ('held','issued','checked_in'))`);
    this.db.transaction((items: ImportDirectSeatInput[]) => items.forEach((seat) => insert.run(generateEntityId("seat"), eventId, performanceId, String(seat.zone).trim(), seat.section_label || null, String(seat.row_label).trim(), String(seat.seat_label).trim(), seat.external_seat_ref || null, seat.face_value ?? null, seat.x ?? null, seat.y ?? null, seat.allocation_status === "not_allocated" ? "not_allocated" : "allocated", seat.source_status || "unknown")))(seats);
    if (options?.replaceMissing && seats.length) {
      const keep = seats.map(() => "(zone=? AND row_label=? AND seat_label=?)").join(" OR ");
      const keepParams = seats.flatMap((seat) => [String(seat.zone).trim(), String(seat.row_label).trim(), String(seat.seat_label).trim()]);
      this.db.prepare(`UPDATE direct_seats SET allocation_status='not_allocated',source_status='unknown',status='voided',updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND performance_id=? AND NOT EXISTS (SELECT 1 FROM direct_tickets WHERE direct_tickets.seat_id=direct_seats.id AND direct_tickets.status IN ('held','issued','checked_in')) AND NOT (${keep})`).run(eventId, performanceId, ...keepParams);
    }
    this.db.prepare("UPDATE direct_seats SET status=CASE WHEN allocation_status='not_allocated' THEN 'voided' WHEN allocation_status='allocated' AND status='voided' THEN 'available' ELSE status END, updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND performance_id=? AND NOT EXISTS (SELECT 1 FROM direct_tickets WHERE direct_tickets.seat_id=direct_seats.id AND direct_tickets.status IN ('held','issued','checked_in'))").run(eventId, performanceId);
    return this.listDirectSeats(eventId, performanceId);
  }

  private directTicketQuery(where: string, params: unknown[]) {
    return this.db.prepare(`SELECT t.*, p.code performance_code, p.title performance_title, p.starts_at performance_starts_at, p.ends_at performance_ends_at, s.zone, s.row_label, s.seat_label FROM direct_tickets t JOIN event_performances p ON p.id=t.performance_id JOIN direct_seats s ON s.id=t.seat_id ${where}`).all(...params).map((row) => mapDirectTicketRow(row as Record<string, unknown>));
  }

  async listDirectTickets(eventId: string) { await this.releaseExpiredDirectTicketHolds(eventId); return this.directTicketQuery("WHERE t.event_id = ? ORDER BY t.created_at DESC", [eventId]); }
  async getDirectTicketById(id: string) { return this.directTicketQuery("WHERE t.id = ?", [id])[0]; }

  async createDirectTicket(input: CreateDirectTicketInput) {
    await this.releaseExpiredDirectTicketHolds(input.event_id);
    const create = this.db.transaction(() => {
      const seat = this.db.prepare("SELECT * FROM direct_seats WHERE id=? AND event_id=? AND performance_id=?").get(input.seat_id, input.event_id, input.performance_id) as Record<string, unknown> | undefined;
      if (!seat) return { error: "invalid_seat" as const };
      if (seat.status !== "available" || seat.allocation_status !== "allocated") return { error: "seat_unavailable" as const };
      const paymentStatus = input.payment_required === false ? "not_required" : "awaiting_payment";
      const status = paymentStatus === "not_required" ? "issued" : "held";
      const id = generateEntityId("dtkt");
      const holdMinutes = Math.min(120, Math.max(5, Math.round(Number(input.hold_minutes) || 15)));
      this.db.prepare(`INSERT INTO direct_tickets (id,event_id,performance_id,seat_id,ticket_class,holder_name,buyer_name,phone,email,price_amount,payment_status,status,issued_by_user_id,issued_at,hold_expires_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='issued' THEN CURRENT_TIMESTAMP END,CASE WHEN ?='held' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now',?) END,?)`)
        .run(id,input.event_id,input.performance_id,input.seat_id,input.ticket_class,String(input.holder_name || ""),String(input.buyer_name || ""),String(input.phone || ""),String(input.email || ""),Number(input.price_amount || 0),paymentStatus,status,input.issued_by_user_id || null,status,status,`+${holdMinutes} minutes`,input.source === "public" ? "public" : "admin");
      this.db.prepare("UPDATE direct_seats SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, input.seat_id);
      return { ticket: this.directTicketQuery("WHERE t.id = ?", [id])[0] };
    });
    return create();
  }

  async updateDirectTicketPayment(id: string, input: { payment_status: "verified" | "rejected" | "refunded"; payment_reference?: string | null; verified_by_user_id?: string | null; rejection_reason?: string | null }) {
    const update = this.db.transaction(() => {
      const ticket = this.directTicketQuery("WHERE t.id = ?", [id])[0]; if (!ticket || (ticket.status !== "held" && input.payment_status !== "refunded")) return ticket;
      const issued = input.payment_status === "verified";
      this.db.prepare(`UPDATE direct_tickets SET payment_status=?, payment_reference=COALESCE(?,payment_reference), payment_verified_by_user_id=?, payment_verified_at=CURRENT_TIMESTAMP, rejection_reason=?, status=?, issued_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE issued_at END, voided_at=CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(input.payment_status,input.payment_reference || null,input.verified_by_user_id || null,input.rejection_reason || null,issued ? "issued" : "voided",issued ? 1 : 0,issued ? 1 : 0,id);
      this.db.prepare("UPDATE direct_seats SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(issued ? "issued" : "available", ticket.seat_id);
      return this.directTicketQuery("WHERE t.id = ?", [id])[0];
    }); return update();
  }

  async submitDirectTicketPaymentProof(id: string, input: { payment_proof_mime: string; payment_proof_base64: string; payment_reference?: string | null }) {
    await this.releaseExpiredDirectTicketHolds();
    const ticket = this.directTicketQuery("WHERE t.id = ?", [id])[0];
    if (!ticket || ticket.status !== "held") return ticket;
    this.db.prepare(`UPDATE direct_tickets SET payment_status='proof_submitted',payment_proof_mime=?,payment_proof_base64=?,payment_proof_submitted_at=CURRENT_TIMESTAMP,payment_reference=?,hold_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours'),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(input.payment_proof_mime, input.payment_proof_base64, input.payment_reference || null, id);
    return this.directTicketQuery("WHERE t.id = ?", [id])[0];
  }

  async releaseExpiredDirectTicketHolds(eventId?: string) {
    const run = this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT id,seat_id FROM direct_tickets WHERE status='held' AND hold_expires_at IS NOT NULL AND julianday(hold_expires_at) <= julianday('now') ${eventId ? "AND event_id=?" : ""}`).all(...(eventId ? [eventId] : [])) as Array<{ id: string; seat_id: string }>;
      if (!rows.length) return 0;
      const updateTicket = this.db.prepare("UPDATE direct_tickets SET status='voided',payment_status='expired',voided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?");
      const releaseSeat = this.db.prepare("UPDATE direct_seats SET status='available',updated_at=CURRENT_TIMESTAMP WHERE id=?");
      for (const row of rows) { updateTicket.run(row.id); releaseSeat.run(row.seat_id); }
      return rows.length;
    });
    return run();
  }

  async voidDirectTicket(id: string, options?: { releaseSeat?: boolean }) {
    const run = this.db.transaction(() => {
      const ticket = this.directTicketQuery("WHERE t.id = ?", [id])[0];
      if (!ticket) return undefined;
      if (ticket.status !== "voided") this.db.prepare("UPDATE direct_tickets SET status='voided', voided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      const activeReplacement = this.db.prepare("SELECT 1 FROM direct_tickets WHERE seat_id = ? AND id != ? AND status IN ('held','issued','checked_in') LIMIT 1").get(ticket.seat_id, id);
      if (!activeReplacement) this.db.prepare("UPDATE direct_seats SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(options?.releaseSeat === false ? "voided" : "available", ticket.seat_id);
      return this.directTicketQuery("WHERE t.id = ?", [id])[0];
    });
    return run();
  }

  async reissueDirectTicket(id: string, issuedByUserId?: string | null) {
    const run = this.db.transaction(() => {
      const ticket = this.directTicketQuery("WHERE t.id = ?", [id])[0];
      if (!ticket || !["issued", "checked_in"].includes(ticket.status)) return undefined;
      const nextId = generateEntityId("dtkt");
      this.db.prepare("UPDATE direct_tickets SET status='voided',voided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      this.db.prepare(`INSERT INTO direct_tickets (id,event_id,performance_id,seat_id,ticket_class,holder_name,buyer_name,phone,email,price_amount,payment_status,payment_reference,status,issued_by_user_id,payment_verified_by_user_id,payment_verified_at,issued_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`)
        .run(nextId,ticket.event_id,ticket.performance_id,ticket.seat_id,ticket.ticket_class,ticket.holder_name,ticket.buyer_name,ticket.phone,ticket.email,ticket.price_amount,ticket.payment_status,ticket.payment_reference,"issued",issuedByUserId||null,ticket.payment_verified_by_user_id,ticket.payment_verified_at,ticket.source);
      this.db.prepare("UPDATE direct_seats SET status='issued',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(ticket.seat_id);
      return this.directTicketQuery("WHERE t.id = ?", [nextId])[0];
    });
    return run();
  }

  async checkInDirectTicket(id: string) {
    const run = this.db.transaction(() => { const ticket = this.directTicketQuery("WHERE t.id = ?", [id])[0]; if (!ticket) return { ticket: undefined, alreadyCheckedIn: false }; if (ticket.status === "checked_in") return { ticket, alreadyCheckedIn: true }; if (ticket.status !== "issued") return { ticket, alreadyCheckedIn: false }; this.db.prepare("UPDATE direct_tickets SET status='checked_in', checked_in_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id); return { ticket: this.directTicketQuery("WHERE t.id = ?", [id])[0], alreadyCheckedIn: false }; }); return run();
  }

  async saveMessage(senderId: string, text: string, type: MessageType, eventId?: string, pageId?: string) {
    const result = this.db.prepare(
      "INSERT INTO messages (sender_id, event_id, page_id, text, type) VALUES (?, ?, ?, ?, ?)",
    ).run(senderId, eventId || DEFAULT_EVENT_ID, pageId || null, text, type);
    return Number(result.lastInsertRowid || 0);
  }

  async saveMessageAttachments(messageId: number, attachments: CreateMessageAttachmentInput[]) {
    const normalizedMessageId = Math.trunc(Number(messageId) || 0);
    if (normalizedMessageId <= 0 || !Array.isArray(attachments) || attachments.length === 0) {
      return [] as MessageAttachmentRow[];
    }

    const createdIds = this.db.transaction((items: CreateMessageAttachmentInput[]) => {
      const ids: string[] = [];
      const insert = this.db.prepare(
        `INSERT INTO message_attachments
           (id, message_id, kind, url, absolute_url, mime_type, name, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const attachment of items) {
        const url = String(attachment?.url || "").trim();
        if (!url) continue;
        const id = generateEntityId("msgatt");
        insert.run(
          id,
          normalizedMessageId,
          "image",
          url,
          attachment?.absolute_url == null ? null : String(attachment.absolute_url || "").trim() || null,
          attachment?.mime_type == null ? null : String(attachment.mime_type || "").trim() || null,
          attachment?.name == null ? null : String(attachment.name || "").trim() || null,
          Number.isFinite(Number(attachment?.size_bytes)) ? Math.max(0, Math.trunc(Number(attachment.size_bytes))) : null,
        );
        ids.push(id);
      }
      return ids;
    })(attachments);

    if (createdIds.length === 0) {
      return [] as MessageAttachmentRow[];
    }

    const placeholders = createdIds.map(() => "?").join(", ");
    const rows = this.db.prepare(
      `SELECT id, message_id, kind, url, absolute_url, mime_type, name, size_bytes, created_at
       FROM message_attachments
       WHERE message_id = ? AND id IN (${placeholders})
       ORDER BY created_at ASC, id ASC`,
    ).all(normalizedMessageId, ...createdIds) as Record<string, unknown>[];
    return rows.map(mapMessageAttachmentRow);
  }

  async listMessageAttachments(messageIds: number[]) {
    const normalizedIds = [...new Set(
      messageIds
        .map((messageId) => Math.trunc(Number(messageId) || 0))
        .filter((messageId) => messageId > 0),
    )];
    if (normalizedIds.length === 0) {
      return [] as MessageAttachmentRow[];
    }

    const placeholders = normalizedIds.map(() => "?").join(", ");
    const rows = this.db.prepare(
      `SELECT id, message_id, kind, url, absolute_url, mime_type, name, size_bytes, created_at
       FROM message_attachments
       WHERE message_id IN (${placeholders})
       ORDER BY message_id ASC, created_at ASC, id ASC`,
    ).all(...normalizedIds) as Record<string, unknown>[];
    return rows.map(mapMessageAttachmentRow);
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

  async getMessageHistoryRows(senderId: string, limit: number, eventId?: string, pageId?: string) {
    if (eventId) {
      if (pageId) {
        return this.db.prepare(
          "SELECT text, type FROM messages WHERE sender_id = ? AND event_id = ? AND page_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
        ).all(senderId, eventId, pageId, limit) as Array<{ text: string; type: MessageType }>;
      }
      return this.db.prepare(
        "SELECT text, type FROM messages WHERE sender_id = ? AND event_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
      ).all(senderId, eventId, limit) as Array<{ text: string; type: MessageType }>;
    }
    return this.db.prepare(
      "SELECT text, type FROM messages WHERE sender_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
    ).all(senderId, limit) as Array<{ text: string; type: MessageType }>;
  }

  async getConversationRowsForSender(senderId: string, limit: number, eventId?: string, pageId?: string) {
    if (eventId) {
      if (pageId) {
        return this.db.prepare(
          "SELECT id, sender_id, event_id, page_id, text, timestamp, type FROM messages WHERE sender_id = ? AND event_id = ? AND page_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?",
        ).all(senderId, eventId, pageId, limit) as MessageRow[];
      }
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
      `SELECT
         e.id,
         e.name,
         e.slug,
         e.status,
         e.organizer_id,
         o.name AS organizer_name,
         e.is_default,
         e.created_at,
         e.updated_at
       FROM events e
       LEFT JOIN organizations o ON o.id = e.organizer_id
       ORDER BY e.is_default DESC, e.created_at ASC`,
    ).all() as Array<Record<string, unknown>>;
    return Promise.all(rows.map((row) => this.hydrateEventRow(row)));
  }

  async getEventById(eventId: string) {
    const row = this.db.prepare(
      `SELECT
         e.id,
         e.name,
         e.slug,
         e.status,
         e.organizer_id,
         o.name AS organizer_name,
         e.is_default,
         e.created_at,
         e.updated_at
       FROM events e
       LEFT JOIN organizations o ON o.id = e.organizer_id
       WHERE e.id = ?`,
    ).get(String(eventId || "").trim()) as Record<string, unknown> | undefined;
    return row ? this.hydrateEventRow(row) : undefined;
  }

  async createEvent(input: CreateEventInput) {
    const id = generateEntityId("evt");
    const baseName = String(input.name || "").trim() || "New Event";
    const slug = this.uniqueEventSlug(baseName);
    const organizerId = String(input.organizer_id || DEFAULT_ORGANIZATION_ID).trim() || DEFAULT_ORGANIZATION_ID;
    this.db.prepare(
      `INSERT INTO events (id, name, slug, status, organizer_id, is_default, is_active, updated_at)
       VALUES (?, ?, ?, 'pending', ?, 0, 1, CURRENT_TIMESTAMP)`,
    ).run(id, baseName, slug, organizerId);

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
    if (typeof input.organizer_id === "string" && input.organizer_id.trim()) {
      updates.push("organizer_id = ?");
      values.push(input.organizer_id.trim());
    }
    if (!updates.length) return false;
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(String(eventId || "").trim());
    const result = this.db.prepare(`UPDATE events SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  async getOrganizerProfile(organizationId: string) {
    const row = this.db.prepare(
      `SELECT
         id,
         name,
         slug,
         legal_name,
         public_display_name,
         public_description,
         public_logo_url,
         public_website_url,
         public_facebook_url,
         public_line_url,
         public_contact_text,
         verification_status,
         verification_notes,
         created_at,
         updated_at
       FROM organizations
       WHERE id = ?`,
    ).get(String(organizationId || "").trim()) as Record<string, unknown> | undefined;
    return mapOrganizerProfileRow(row);
  }

  async updateOrganizerProfile(organizationId: string, input: UpdateOrganizerProfileInput) {
    const updates = [
      "legal_name = ?",
      "public_display_name = ?",
      "public_description = ?",
      "public_logo_url = ?",
      "public_website_url = ?",
      "public_facebook_url = ?",
      "public_line_url = ?",
      "public_contact_text = ?",
      "verification_status = ?",
      "verification_notes = ?",
      "updated_at = CURRENT_TIMESTAMP",
    ];
    const values = [
      input.legal_name ?? null,
      input.public_display_name ?? null,
      input.public_description ?? null,
      input.public_logo_url ?? null,
      input.public_website_url ?? null,
      input.public_facebook_url ?? null,
      input.public_line_url ?? null,
      input.public_contact_text ?? null,
      input.verification_status ?? "draft",
      input.verification_notes ?? null,
      String(organizationId || "").trim(),
    ];
    const result = this.db.prepare(
      `UPDATE organizations SET ${updates.join(", ")} WHERE id = ?`,
    ).run(...values);
    if (result.changes <= 0) return undefined;
    return this.getOrganizerProfile(organizationId);
  }

  async getEventDeletionImpact(eventId: string) {
    const normalizedEventId = String(eventId || "").trim();
    const registrationRow = this.db.prepare(
      "SELECT COUNT(*) AS count FROM registrations WHERE event_id = ?",
    ).get(normalizedEventId) as { count?: number | null };
    const messageRow = this.db.prepare(
      "SELECT COUNT(*) AS count FROM messages WHERE event_id = ?",
    ).get(normalizedEventId) as { count?: number | null };
    const documentRow = this.db.prepare(
      "SELECT COUNT(*) AS count FROM event_documents WHERE event_id = ?",
    ).get(normalizedEventId) as { count?: number | null };
    const checkinRow = this.db.prepare(
      "SELECT COUNT(*) AS count FROM checkin_sessions WHERE event_id = ?",
    ).get(normalizedEventId) as { count?: number | null };
    const channelRow = this.db.prepare(
      "SELECT COUNT(*) AS count FROM channel_event_assignments WHERE event_id = ?",
    ).get(normalizedEventId) as { count?: number | null };
    const pageRow = this.db.prepare(
      "SELECT COUNT(*) AS count FROM facebook_pages WHERE event_id = ?",
    ).get(normalizedEventId) as { count?: number | null };
    return {
      registrations: Number(registrationRow.count || 0),
      messages: Number(messageRow.count || 0),
      documents: Number(documentRow.count || 0),
      checkin_sessions: Number(checkinRow.count || 0),
      assigned_channels: Number(channelRow.count || 0),
      legacy_pages: Number(pageRow.count || 0),
    };
  }

  async deleteEvent(eventId: string) {
    const normalizedEventId = String(eventId || "").trim();
    const result = this.db.prepare("DELETE FROM events WHERE id = ? AND is_default = 0").run(normalizedEventId);
    return result.changes > 0;
  }

  private outreachCampaignQuery(where: string, params: unknown[]) {
    return this.db.prepare(`
      SELECT c.*,
        COUNT(t.id) AS target_count,
        SUM(CASE WHEN t.status = 'replied' THEN 1 ELSE 0 END) AS needs_action_count,
        SUM(CASE WHEN t.status IN ('new','drafted','approved') THEN 1 ELSE 0 END) AS not_contacted_count,
        SUM(CASE WHEN t.status = 'waiting_reply' THEN 1 ELSE 0 END) AS waiting_count,
        SUM(CASE WHEN t.status = 'replied' THEN 1 ELSE 0 END) AS replied_count,
        SUM(CASE WHEN t.status = 'press_kit_sent' THEN 1 ELSE 0 END) AS press_kit_sent_count,
        SUM(CASE WHEN t.status = 'published' THEN 1 ELSE 0 END) AS published_count,
        SUM(CASE WHEN t.status = 'declined' THEN 1 ELSE 0 END) AS declined_count,
        SUM(CASE WHEN t.status = 'no_response' THEN 1 ELSE 0 END) AS no_response_count,
        SUM(CASE WHEN t.next_follow_up_at IS NOT NULL AND julianday(t.next_follow_up_at) <= julianday('now') AND t.status NOT IN ('published', 'declined', 'no_response') THEN 1 ELSE 0 END) AS follow_up_due_count
      FROM outreach_campaigns c
      LEFT JOIN outreach_targets t ON t.campaign_id = c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.updated_at DESC, c.id DESC
    `).all(...params).map((row) => mapOutreachCampaignRow(row as Record<string, unknown>));
  }

  private outreachTargetQuery(where: string, params: unknown[]) {
    return this.db.prepare(`SELECT * FROM outreach_targets ${where} ORDER BY updated_at DESC, id DESC`).all(...params).map((row) => mapOutreachTargetRow(row as Record<string, unknown>));
  }

  async listOutreachCampaigns(eventId: string) {
    return this.outreachCampaignQuery("WHERE c.event_id = ?", [eventId]);
  }

  async getOutreachCampaign(id: string, eventId: string) {
    return this.outreachCampaignQuery("WHERE c.id = ? AND c.event_id = ?", [id, eventId])[0];
  }

  async createOutreachCampaign(input: CreateOutreachCampaignInput) {
    const id = generateEntityId("ocamp");
    this.db.prepare(`INSERT INTO outreach_campaigns (id,event_id,name,description,objective,context,default_instruction,start_date,end_date,status,created_by_user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.event_id, input.name.trim(), String(input.description || "").trim(), String(input.objective || "").trim(), String(input.context || "").trim(),
      String(input.default_instruction || "").trim(), input.start_date || null, input.end_date || null, input.status || "draft", input.created_by_user_id || null,
    );
    const campaign = await this.getOutreachCampaign(id, input.event_id);
    if (!campaign) throw new Error("Outreach campaign was not created");
    return campaign;
  }

  async updateOutreachCampaign(id: string, eventId: string, input: UpdateOutreachCampaignInput) {
    const result = this.db.prepare(`UPDATE outreach_campaigns SET name=?,description=?,objective=?,context=?,default_instruction=?,start_date=?,end_date=?,status=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND event_id=?`).run(
      input.name.trim(), String(input.description || "").trim(), String(input.objective || "").trim(), String(input.context || "").trim(), String(input.default_instruction || "").trim(),
      input.start_date || null, input.end_date || null, input.status, id, eventId,
    );
    return result.changes > 0 ? this.getOutreachCampaign(id, eventId) : undefined;
  }

  async listOutreachTargets(eventId: string, campaignId: string) {
    return this.outreachTargetQuery("WHERE event_id = ? AND campaign_id = ?", [eventId, campaignId]);
  }

  async listOutreachTargetsForEvent(eventId: string) {
    return this.outreachTargetQuery("WHERE event_id = ?", [eventId]);
  }

  async getOutreachTarget(id: string, eventId: string) {
    return this.outreachTargetQuery("WHERE id = ? AND event_id = ?", [id, eventId])[0];
  }

  async createOutreachTarget(input: CreateOutreachTargetInput) {
    const id = generateEntityId("otgt");
    this.db.prepare(`INSERT INTO outreach_targets (id,campaign_id,event_id,name,facebook_page_url,facebook_page_id,organization_type,contact_person,email,website,notes,priority,status,delivery_mode,next_follow_up_at,outcome_note,assigned_user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.campaign_id, input.event_id, input.name.trim(), String(input.facebook_page_url || "").trim(), String(input.facebook_page_id || "").trim() || null,
      String(input.organization_type || "other").trim(), String(input.contact_person || "").trim() || null, String(input.email || "").trim() || null, String(input.website || "").trim() || null,
      String(input.notes || "").trim(), input.priority || "normal", input.status || "new", input.delivery_mode || "manual_first_contact", input.next_follow_up_at || null, String(input.outcome_note || "").trim() || null, input.assigned_user_id || null,
    );
    const target = await this.getOutreachTarget(id, input.event_id);
    if (!target) throw new Error("Outreach target was not created");
    return target;
  }

  async updateOutreachTarget(id: string, eventId: string, input: UpdateOutreachTargetInput) {
    const result = this.db.prepare(`UPDATE outreach_targets SET name=?,facebook_page_url=?,facebook_page_id=?,organization_type=?,contact_person=?,email=?,website=?,notes=?,priority=?,status=?,delivery_mode=?,next_follow_up_at=?,outcome_note=?,assigned_user_id=?,last_contacted_at=CASE WHEN ? IN ('contacted','waiting_reply') THEN COALESCE(last_contacted_at,CURRENT_TIMESTAMP) ELSE last_contacted_at END,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND event_id=?`).run(
      input.name.trim(), String(input.facebook_page_url || "").trim(), String(input.facebook_page_id || "").trim() || null, String(input.organization_type || "other").trim(),
      String(input.contact_person || "").trim() || null, String(input.email || "").trim() || null, String(input.website || "").trim() || null, String(input.notes || "").trim(),
      input.priority, input.status, input.delivery_mode, input.next_follow_up_at || null, String(input.outcome_note || "").trim() || null, input.assigned_user_id || null, input.status, id, eventId,
    );
    return result.changes > 0 ? this.getOutreachTarget(id, eventId) : undefined;
  }

  async bindOutreachTargetIdentity(id: string, eventId: string, pageId: string, senderId: string) {
    const result = this.db.prepare("UPDATE outreach_targets SET bound_page_id=?,bound_sender_id=?,delivery_mode='manual_only',updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=?").run(pageId.trim(), senderId.trim(), id, eventId);
    return result.changes > 0 ? this.getOutreachTarget(id, eventId) : undefined;
  }

  async findOutreachTargetIdentityMatches(pageId: string, senderId: string, eventIds: string[] = []) {
    const normalizedEventIds = eventIds.map((value) => String(value || "").trim()).filter(Boolean);
    const clauses = ["t.bound_page_id = ?", "t.bound_sender_id = ?", "c.status <> 'archived'", "t.status NOT IN ('declined','no_response')"];
    const params: unknown[] = [pageId.trim(), senderId.trim()];
    if (normalizedEventIds.length > 0) {
      clauses.push(`t.event_id IN (${normalizedEventIds.map(() => "?").join(",")})`);
      params.push(...normalizedEventIds);
    }
    return this.db.prepare(`SELECT t.* FROM outreach_targets t JOIN outreach_campaigns c ON c.id = t.campaign_id AND c.event_id = t.event_id WHERE ${clauses.join(" AND ")} ORDER BY t.updated_at DESC, t.id DESC`).all(...params).map((row) => mapOutreachTargetRow(row as Record<string, unknown>));
  }

  async markOutreachTargetReplied(id: string, eventId: string, repliedAt = new Date().toISOString()) {
    const result = this.db.prepare("UPDATE outreach_targets SET status='replied',delivery_mode='api_reply_eligible',last_replied_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=?").run(repliedAt, id, eventId);
    return result.changes > 0 ? this.getOutreachTarget(id, eventId) : undefined;
  }

  async listOutreachDrafts(targetId: string, eventId: string) {
    return this.db.prepare("SELECT * FROM outreach_drafts WHERE target_id = ? AND event_id = ? ORDER BY revision DESC").all(targetId, eventId).map((row) => mapOutreachDraftRow(row as Record<string, unknown>));
  }

  async getOutreachDraft(id: string, eventId: string) {
    const row = this.db.prepare("SELECT * FROM outreach_drafts WHERE id = ? AND event_id = ?").get(id, eventId) as Record<string, unknown> | undefined;
    return row ? mapOutreachDraftRow(row) : undefined;
  }

  async createOutreachDraft(input: CreateOutreachDraftInput) {
    const draft = this.db.transaction(() => {
      const latest = this.db.prepare("SELECT COALESCE(MAX(revision), 0) AS revision FROM outreach_drafts WHERE target_id = ? AND event_id = ?").get(input.target_id, input.event_id) as { revision?: number } | undefined;
      const id = generateEntityId("odrf");
      const revision = Number(latest?.revision || 0) + 1;
      this.db.prepare("INSERT INTO outreach_drafts (id,target_id,campaign_id,event_id,revision,body,kind,source_message_id,approval_status,created_by_user_id) SELECT ?,?,campaign_id,event_id,?,?,?,?,?,? FROM outreach_targets WHERE id=? AND event_id=?")
        .run(id, input.target_id, revision, input.body.trim(), input.kind || "initial", input.source_message_id || null, "draft", input.created_by_user_id || null, input.target_id, input.event_id);
      return this.db.prepare("SELECT * FROM outreach_drafts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    })();
    if (!draft) throw new Error("Outreach target was not found");
    return mapOutreachDraftRow(draft);
  }

  async approveOutreachDraft(id: string, eventId: string, userId: string) {
    const result = this.db.prepare("UPDATE outreach_drafts SET approval_status='approved',approved_by_user_id=?,approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=?").run(userId || null, id, eventId);
    return result.changes > 0 ? mapOutreachDraftRow(this.db.prepare("SELECT * FROM outreach_drafts WHERE id = ?").get(id) as Record<string, unknown>) : undefined;
  }

  async listOutreachAssets(eventId: string, campaignId: string) {
    return this.db.prepare("SELECT * FROM outreach_assets WHERE event_id = ? AND campaign_id = ? ORDER BY is_active DESC, updated_at DESC, id DESC").all(eventId, campaignId).map((row) => mapOutreachAssetRow(row as Record<string, unknown>));
  }

  async createOutreachAsset(input: CreateOutreachAssetInput) {
    const id = generateEntityId("oast");
    this.db.prepare("INSERT INTO outreach_assets (id,campaign_id,event_id,name,type,description,url,tags,is_active) VALUES (?,?,?,?,?,?,?,?,?)").run(
      id, input.campaign_id, input.event_id, input.name.trim(), String(input.type || "other").trim(), String(input.description || "").trim(), input.url.trim(), String(input.tags || "").trim(), input.is_active !== false ? 1 : 0,
    );
    const row = this.db.prepare("SELECT * FROM outreach_assets WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Outreach asset was not created");
    return mapOutreachAssetRow(row);
  }

  async listOutreachDeliveries(targetId: string, eventId: string) {
    return this.db.prepare("SELECT * FROM outreach_deliveries WHERE target_id = ? AND event_id = ? ORDER BY created_at DESC, id DESC").all(targetId, eventId).map((row) => mapOutreachDeliveryRow(row as Record<string, unknown>));
  }

  async getOutreachDeliveryByIdempotency(eventId: string, idempotencyKey: string) {
    const row = this.db.prepare("SELECT * FROM outreach_deliveries WHERE event_id = ? AND idempotency_key = ?").get(eventId, idempotencyKey) as Record<string, unknown> | undefined;
    return row ? mapOutreachDeliveryRow(row) : undefined;
  }

  async createOutreachDelivery(input: CreateOutreachDeliveryInput) {
    const id = generateEntityId("odlv");
    this.db.prepare("INSERT INTO outreach_deliveries (id,target_id,campaign_id,event_id,draft_id,asset_id,kind,channel_platform,channel_external_id,recipient_id,idempotency_key,status,external_message_id,error_message,sent_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      id, input.target_id, input.campaign_id, input.event_id, input.draft_id || null, input.asset_id || null, input.kind, input.channel_platform, input.channel_external_id.trim(), input.recipient_id.trim(), input.idempotency_key.trim(), input.status || "pending", input.external_message_id || null, input.error_message || null, input.sent_by_user_id || null,
    );
    const row = this.db.prepare("SELECT * FROM outreach_deliveries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Outreach delivery was not created");
    return mapOutreachDeliveryRow(row);
  }

  async updateOutreachDelivery(id: string, eventId: string, input: Partial<Pick<OutreachDeliveryRow, "status" | "external_message_id" | "error_message" | "sent_by_user_id">>) {
    const status = input.status || "pending";
    const result = this.db.prepare("UPDATE outreach_deliveries SET status=?,external_message_id=?,error_message=?,sent_by_user_id=?,sent_at=CASE WHEN ?='sent' THEN COALESCE(sent_at,CURRENT_TIMESTAMP) ELSE sent_at END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND event_id=?").run(
      status, input.external_message_id || null, input.error_message || null, input.sent_by_user_id || null, status, id, eventId,
    );
    return result.changes > 0 ? mapOutreachDeliveryRow(this.db.prepare("SELECT * FROM outreach_deliveries WHERE id = ?").get(id) as Record<string, unknown>) : undefined;
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
          `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, ca.organizer_id, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
           FROM channel_accounts ca
           LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
           WHERE ca.platform = ?
           ORDER BY ca.created_at ASC`,
        ).all(platform)
      : this.db.prepare(
          `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, ca.organizer_id, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
           FROM channel_accounts ca
           LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
           ORDER BY ca.created_at ASC`,
        ).all();
    return collapseChannelRows(rows as Array<Record<string, unknown>>);
  }

  async getChannelAccount(platform: ChannelPlatform, externalId: string) {
    const rows = this.db.prepare(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, ca.organizer_id, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at, ca.updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.platform = ? AND ca.external_id = ?
       ORDER BY cea.created_at ASC`,
    ).all(platform, String(externalId || "").trim()) as Array<Record<string, unknown>>;
    return collapseChannelRows(rows)[0];
  }

  async upsertChannelAccount(input: UpsertChannelAccountInput) {
    const platform = (String(input.platform || "facebook").trim() || "facebook") as ChannelPlatform;
    const externalId = String(input.external_id || "").trim();
    const displayName = String(input.display_name || "").trim() || externalId;
    const hasEventId = Object.prototype.hasOwnProperty.call(input, "event_id");
    const eventId = String(input.event_id || "").trim();
    const storageEventId = eventId || DEFAULT_EVENT_ID;
    const requestedOrganizerId = String(input.organizer_id || "").trim();
    const eventOrganizerRow = eventId
      ? this.db.prepare("SELECT organizer_id FROM events WHERE id = ? LIMIT 1").get(eventId) as { organizer_id?: string } | undefined
      : undefined;
    const organizerId = requestedOrganizerId || String(eventOrganizerRow?.organizer_id || "").trim() || DEFAULT_ORGANIZATION_ID;
    const accessToken = String(input.access_token || "").trim();
    const configJson = String(input.config_json || "{}").trim() || "{}";
    const existing = this.db.prepare(
      "SELECT id FROM channel_accounts WHERE platform = ? AND external_id = ?",
    ).get(platform, externalId) as { id?: string } | undefined;
    const id = existing?.id || generateEntityId("chn");

    this.db.prepare(
      `INSERT INTO channel_accounts (id, platform, external_id, display_name, organizer_id, event_id, access_token, config_json, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(platform, external_id) DO UPDATE
       SET display_name = excluded.display_name,
           organizer_id = COALESCE(NULLIF(excluded.organizer_id, ''), channel_accounts.organizer_id),
           event_id = channel_accounts.event_id,
           access_token = COALESCE(NULLIF(excluded.access_token, ''), channel_accounts.access_token),
           config_json = excluded.config_json,
           is_active = excluded.is_active,
           updated_at = CURRENT_TIMESTAMP`,
    ).run(id, platform, externalId, displayName, organizerId, storageEventId, accessToken, configJson, input.is_active === false ? 0 : 1);

    if (hasEventId) {
      if (eventId) {
        if (platform !== "facebook") {
          this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ?").run(id);
        }
        this.db.prepare(
          `INSERT INTO channel_event_assignments (channel_id, event_id, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(channel_id, event_id) DO UPDATE
           SET updated_at = CURRENT_TIMESTAMP`,
        ).run(id, eventId);
      } else {
        this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ?").run(id);
      }
    }

    const channel = await this.getChannelAccount(platform, externalId);
    if (!channel) throw new Error("Failed to upsert channel account");
    return channel;
  }

  async updateChannelAccount(originalPlatform: ChannelPlatform, originalExternalId: string, input: UpsertChannelAccountInput) {
    const sourcePlatform = (String(originalPlatform || "facebook").trim() || "facebook") as ChannelPlatform;
    const sourceExternalId = String(originalExternalId || "").trim();
    const originalRow = this.db.prepare(
      "SELECT id, platform, external_id, display_name, organizer_id, event_id, access_token, config_json, is_active, created_at, updated_at FROM channel_accounts WHERE platform = ? AND external_id = ? LIMIT 1",
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
    const requestedOrganizerId = String(input.organizer_id || "").trim();
    const eventOrganizerRow = eventId
      ? this.db.prepare("SELECT organizer_id FROM events WHERE id = ? LIMIT 1").get(eventId) as { organizer_id?: string } | undefined
      : undefined;
    const organizerId = requestedOrganizerId || String(eventOrganizerRow?.organizer_id || "").trim() || original.organizer_id || DEFAULT_ORGANIZATION_ID;
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
           organizer_id = ?,
           event_id = event_id,
           access_token = ?,
           config_json = ?,
           is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(platform, externalId, displayName, organizerId, accessToken, configJson, input.is_active === false ? 0 : 1, original.id);

    if (hasEventId) {
      if (eventId) {
        if (platform !== "facebook") {
          this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ?").run(original.id);
        }
        this.db.prepare(
          `INSERT INTO channel_event_assignments (channel_id, event_id, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(channel_id, event_id) DO UPDATE
           SET updated_at = CURRENT_TIMESTAMP`,
        ).run(original.id, eventId);
      } else {
        this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ?").run(original.id);
      }
    }

    const channel = await this.getChannelAccount(platform, externalId);
    if (!channel) throw new Error("Failed to update channel account");
    return channel;
  }

  async assignChannelAccount(channelId: string, eventId: string) {
    const normalizedChannelId = String(channelId || "").trim();
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedChannelId || !normalizedEventId) return undefined;
    const channelIdentity = this.db.prepare(
      "SELECT platform, external_id FROM channel_accounts WHERE id = ? LIMIT 1",
    ).get(normalizedChannelId) as { platform?: ChannelPlatform; external_id?: string } | undefined;
    if (!channelIdentity?.platform || !channelIdentity.external_id) return undefined;
    const eventOrganizerRow = this.db.prepare("SELECT organizer_id FROM events WHERE id = ? LIMIT 1").get(normalizedEventId) as { organizer_id?: string } | undefined;
    const eventOrganizerId = String(eventOrganizerRow?.organizer_id || "").trim() || DEFAULT_ORGANIZATION_ID;
    this.db.prepare(
      `UPDATE channel_accounts
       SET organizer_id = COALESCE(NULLIF(TRIM(organizer_id), ''), ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(eventOrganizerId, normalizedChannelId);
    if (channelIdentity.platform !== "facebook") {
      this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ?").run(normalizedChannelId);
    }
    this.db.prepare(
      `INSERT INTO channel_event_assignments (channel_id, event_id, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id, event_id) DO UPDATE
       SET updated_at = CURRENT_TIMESTAMP`,
    ).run(normalizedChannelId, normalizedEventId);
    return this.getChannelAccount(channelIdentity.platform, channelIdentity.external_id);
  }

  async unassignChannelAccount(channelId: string, eventId?: string) {
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedChannelId) return undefined;
    const channelIdentity = this.db.prepare(
      "SELECT platform, external_id FROM channel_accounts WHERE id = ? LIMIT 1",
    ).get(normalizedChannelId) as { platform?: ChannelPlatform; external_id?: string } | undefined;
    if (!channelIdentity?.platform || !channelIdentity.external_id) return undefined;
    const normalizedEventId = String(eventId || "").trim();
    if (normalizedEventId) {
      this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ? AND event_id = ?").run(normalizedChannelId, normalizedEventId);
      this.db.prepare("DELETE FROM channel_sender_event_selections WHERE channel_id = ? AND event_id = ?").run(normalizedChannelId, normalizedEventId);
    } else {
      this.db.prepare("DELETE FROM channel_event_assignments WHERE channel_id = ?").run(normalizedChannelId);
      this.db.prepare("DELETE FROM channel_sender_event_selections WHERE channel_id = ?").run(normalizedChannelId);
    }
    return this.getChannelAccount(channelIdentity.platform, channelIdentity.external_id);
  }

  async listEventIdsForChannel(platform: ChannelPlatform, externalId: string) {
    const rows = this.db.prepare(
      `SELECT cea.event_id
       FROM channel_accounts ca
       JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       JOIN events e ON e.id = cea.event_id
       WHERE ca.platform = ? AND ca.external_id = ? AND ca.is_active = 1
       ORDER BY e.created_at ASC`,
    ).all(platform, String(externalId || "").trim()) as Array<{ event_id?: string }>;
    return rows.map((row) => String(row.event_id || "").trim()).filter(Boolean);
  }

  async getChannelSenderEventSelection(channelId: string, senderId: string) {
    const row = this.db.prepare(
      "SELECT event_id FROM channel_sender_event_selections WHERE channel_id = ? AND sender_id = ? LIMIT 1",
    ).get(String(channelId || "").trim(), String(senderId || "").trim()) as { event_id?: string } | undefined;
    return row?.event_id;
  }

  async setChannelSenderEventSelection(channelId: string, senderId: string, eventId?: string) {
    const normalizedChannelId = String(channelId || "").trim();
    const normalizedSenderId = String(senderId || "").trim();
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedChannelId || !normalizedSenderId) return;
    if (!normalizedEventId) {
      this.db.prepare("DELETE FROM channel_sender_event_selections WHERE channel_id = ? AND sender_id = ?").run(normalizedChannelId, normalizedSenderId);
      return;
    }
    this.db.prepare(
      `INSERT INTO channel_sender_event_selections (channel_id, sender_id, event_id, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id, sender_id) DO UPDATE
       SET event_id = excluded.event_id, updated_at = CURRENT_TIMESTAMP`,
    ).run(normalizedChannelId, normalizedSenderId, normalizedEventId);
  }

  async resolveEventIdForChannel(platform: ChannelPlatform, externalId: string) {
    const row = this.db.prepare(
      `SELECT cea.event_id
       FROM channel_accounts ca
       JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.platform = ? AND ca.external_id = ? AND ca.is_active = 1
       LIMIT 1`,
    ).get(platform, String(externalId || "").trim()) as { event_id?: string } | undefined;
    const eventId = row?.event_id;
    if (!eventId) return undefined;

    const event = await this.getEventById(eventId);
    return event?.effective_status === "active" ? event.id : undefined;
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

  async getUserPreferences(userId: string) {
    return this.db.prepare(
      "SELECT user_id, language, timezone, updated_at FROM user_preferences WHERE user_id = ?",
    ).get(String(userId || "").trim()) as UserPreferencesRow | undefined;
  }

  async upsertUserPreferences(userId: string, input: { language: "th" | "en"; timezone: string }) {
    const normalizedUserId = String(userId || "").trim();
    this.db.prepare(
      `INSERT INTO user_preferences (user_id, language, timezone, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET language = excluded.language, timezone = excluded.timezone, updated_at = CURRENT_TIMESTAMP`,
    ).run(normalizedUserId, input.language, input.timezone);
    const preferences = await this.getUserPreferences(normalizedUserId);
    if (!preferences) throw new Error("Failed to save user preferences");
    return preferences;
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
      JSON.stringify({ ...getSystemAuditMetadata(), ...(entry.metadata || {}) }),
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

  private migrateChannelEventAssignmentsToMany() {
    const columns = this.db.prepare("PRAGMA table_info(channel_event_assignments)").all() as Array<{ name: string; pk: number }>;
    if (columns.find((column) => column.name === "event_id")?.pk) return;

    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE channel_event_assignments_many (
          channel_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (channel_id, event_id),
          FOREIGN KEY (channel_id) REFERENCES channel_accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );
        INSERT INTO channel_event_assignments_many (channel_id, event_id, created_at, updated_at)
        SELECT channel_id, event_id, created_at, updated_at FROM channel_event_assignments;
        DROP TABLE channel_event_assignments;
        ALTER TABLE channel_event_assignments_many RENAME TO channel_event_assignments;
      `);
    })();
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
      `INSERT OR IGNORE INTO events (id, name, slug, status, organizer_id, is_default, is_active)
       VALUES (?, ?, ?, 'active', ?, 1, 1)`,
    ).run(DEFAULT_EVENT_ID, defaultName, "default-event", DEFAULT_ORGANIZATION_ID);
    this.db.prepare(
      `UPDATE events
       SET name = ?,
           organizer_id = COALESCE(NULLIF(TRIM(organizer_id), ''), ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(defaultName, DEFAULT_ORGANIZATION_ID, DEFAULT_EVENT_ID);

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
    this.db.prepare(
      "UPDATE events SET organizer_id = ? WHERE organizer_id IS NULL OR TRIM(organizer_id) = ''",
    ).run(DEFAULT_ORGANIZATION_ID);
  }

  private async bootstrapChannelAccounts() {
    const rows = this.db.prepare(
      "SELECT id, page_id, page_name, event_id, page_access_token, is_active, created_at, updated_at FROM facebook_pages",
    ).all() as Array<Record<string, unknown>>;

    const upsert = this.db.prepare(
      `INSERT INTO channel_accounts (id, platform, external_id, display_name, organizer_id, event_id, access_token, config_json, is_active, created_at, updated_at)
       VALUES (?, 'facebook', ?, ?, COALESCE((SELECT organizer_id FROM events WHERE id = ?), ?), ?, ?, '{}', ?, ?, ?)
       ON CONFLICT(platform, external_id) DO UPDATE
       SET display_name = excluded.display_name,
           organizer_id = COALESCE(NULLIF(excluded.organizer_id, ''), channel_accounts.organizer_id),
           event_id = excluded.event_id,
           access_token = COALESCE(NULLIF(excluded.access_token, ''), channel_accounts.access_token),
           is_active = excluded.is_active,
           updated_at = CURRENT_TIMESTAMP`,
    );
    const assign = this.db.prepare(
      `INSERT INTO channel_event_assignments (channel_id, event_id, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(channel_id, event_id) DO UPDATE
       SET updated_at = CURRENT_TIMESTAMP`,
    );

    for (const row of rows) {
      const eventId = String(row.event_id || "").trim();
      upsert.run(
        String(row.id),
        String(row.page_id),
        String(row.page_name),
        eventId || DEFAULT_EVENT_ID,
        DEFAULT_ORGANIZATION_ID,
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
