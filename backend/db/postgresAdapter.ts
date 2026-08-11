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
  CreateCustomerAccountInput,
  CreateCustomerAccountTokenInput,
  CreateNotificationDeliveryInput,
  CreateRegistrationEmailDeliveryInput,
  CreateOrganizerProfileInput,
  CreateMessageAttachmentInput,
  CreateEventInput,
  CreateCheckinSessionInput,
  CreateDirectTicketInput,
  CreateDirectOrderInput,
  ExchangeCheckinSessionTokenInput,
  EventDocumentChunkEmbeddingRow,
  EventDocumentChunkRow,
  EventDocumentRow,
  CreateUserInput,
  EmbeddingStatus,
  EventStatus,
  EventRow,
  DirectPerformanceRow,
  DirectOrderRow,
  DirectSeatRow,
  DirectTicketRow,
  FacebookPageRow,
  ManualEventStatus,
  MessageAttachmentRow,
  MessageRow,
  MessageType,
  CustomerAccountRow,
  CustomerAccountSessionRow,
  CustomerAccountTokenRow,
  CustomerAccountTokenKind,
  CustomerAccountStatus,
  CustomerNotificationPreferencesRow,
  UpdateCustomerNotificationPreferencesInput,
  NotificationDeliveryRow,
  LlmUsageModelSummaryRow,
  LlmUsageSummaryRow,
  LlmUsageTotalsRow,
  OrganizerProfileRow,
  OrganizerFinancialProfileRow,
  UpdateOrganizerFinancialProfileInput,
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
  RegistrationActivityByDayRow,
  RegistrationCountsByEventRow,
  RegistrationInput,
  RegistrationEmailDeliveryRow,
  RegistrationResult,
  RegistrationRow,
  RegistrationSearchOptions,
  RegistrationStatus,
  SettingRow,
  UpdateEventInput,
  UpdateCustomerProfileInput,
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
type QueryableClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function generateRegistrationId() {
  return `REG-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
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

function mapNotificationDeliveryRow(row?: Record<string, unknown>) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    channel: String(row.channel || "email") as NotificationDeliveryRow["channel"],
    kind: String(row.kind || ""),
    recipient: String(row.recipient || ""),
    recipient_snapshot: typeof row.recipient_snapshot === "string" && row.recipient_snapshot ? row.recipient_snapshot : null,
    related_type: typeof row.related_type === "string" && row.related_type ? row.related_type : null,
    related_id: typeof row.related_id === "string" && row.related_id ? row.related_id : null,
    payload_json: String(row.payload_json || "{}"),
    idempotency_key: String(row.idempotency_key || ""),
    status: String(row.status || "queued") as NotificationDeliveryRow["status"],
    attempt_count: Number(row.attempt_count || 0),
    available_at: mapPostgresTimestamp(row.available_at) || "",
    locked_at: mapPostgresTimestamp(row.locked_at),
    locked_by: typeof row.locked_by === "string" && row.locked_by ? row.locked_by : null,
    provider: typeof row.provider === "string" && row.provider ? row.provider : null,
    provider_message_id: typeof row.provider_message_id === "string" && row.provider_message_id ? row.provider_message_id : null,
    last_error: typeof row.last_error === "string" && row.last_error ? row.last_error : null,
    queued_at: mapPostgresTimestamp(row.queued_at) || "",
    sent_at: mapPostgresTimestamp(row.sent_at),
    updated_at: mapPostgresTimestamp(row.updated_at) || "",
  } satisfies NotificationDeliveryRow;
}

function mapCustomerAccountRow(row?: Record<string, unknown>) {
  if (!row) return undefined;
  return {
    id: String(row.id || ""),
    email: String(row.email || ""),
    normalized_email: String(row.normalized_email || ""),
    password_hash: String(row.password_hash || ""),
    email_verified_at: mapPostgresTimestamp(row.email_verified_at),
    first_name: String(row.first_name || ""),
    last_name: String(row.last_name || ""),
    phone: String(row.phone || ""),
    normalized_phone: String(row.normalized_phone || ""),
    address_line1: typeof row.address_line1 === "string" && row.address_line1 ? row.address_line1 : null,
    address_line2: typeof row.address_line2 === "string" && row.address_line2 ? row.address_line2 : null,
    district: typeof row.district === "string" && row.district ? row.district : null,
    subdistrict: typeof row.subdistrict === "string" && row.subdistrict ? row.subdistrict : null,
    province: typeof row.province === "string" && row.province ? row.province : null,
    postal_code: typeof row.postal_code === "string" && row.postal_code ? row.postal_code : null,
    country: typeof row.country === "string" && row.country ? row.country : null,
    accepted_terms_at: mapPostgresTimestamp(row.accepted_terms_at) || "",
    accepted_privacy_at: mapPostgresTimestamp(row.accepted_privacy_at) || "",
    status: String(row.status || "pending") as CustomerAccountStatus,
    last_login_at: mapPostgresTimestamp(row.last_login_at),
    created_at: mapPostgresTimestamp(row.created_at) || "",
    updated_at: mapPostgresTimestamp(row.updated_at) || "",
  } satisfies CustomerAccountRow;
}

function mapCustomerAccountTokenRow(row?: Record<string, unknown>) {
  if (!row) return undefined;
  return {
    id: String(row.id || ""),
    customer_account_id: String(row.customer_account_id || ""),
    kind: String(row.kind || "email_verification") as CustomerAccountTokenKind,
    expires_at: mapPostgresTimestamp(row.expires_at) || "",
    created_at: mapPostgresTimestamp(row.created_at) || "",
  } satisfies CustomerAccountTokenRow;
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
    organization_id: String(row.organization_id || row.owner_organization_id || row.id || ""),
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

function mapOrganizerFinancialProfileRow(row?: Record<string, unknown>) {
  if (!row) return undefined;
  return {
    organization_id: String(row.organization_id || ""),
    organizer_profile_id: typeof row.organizer_profile_id === "string" && row.organizer_profile_id ? row.organizer_profile_id : typeof row.organizer_id === "string" && row.organizer_id ? row.organizer_id : undefined,
    payment_method: "promptpay",
    promptpay_id: typeof row.promptpay_id === "string" && row.promptpay_id ? row.promptpay_id : null,
    promptpay_receiver_name: typeof row.promptpay_receiver_name === "string" && row.promptpay_receiver_name ? row.promptpay_receiver_name : null,
    payment_status: String(row.payment_status || "draft") as OrganizerFinancialProfileRow["payment_status"],
    legal_entity_type: String(row.legal_entity_type || "individual") as OrganizerFinancialProfileRow["legal_entity_type"],
    tax_id: typeof row.tax_id === "string" && row.tax_id ? row.tax_id : null,
    vat_status: String(row.vat_status || "unknown") as OrganizerFinancialProfileRow["vat_status"],
    vat_rate_percent: Number(row.vat_rate_percent || 0),
    registered_address: typeof row.registered_address === "string" && row.registered_address ? row.registered_address : null,
    branch_number: typeof row.branch_number === "string" && row.branch_number ? row.branch_number : null,
    billing_document_mode: String(row.billing_document_mode || "not_required") as OrganizerFinancialProfileRow["billing_document_mode"],
    platform_fee_type: String(row.platform_fee_type || "percent") as OrganizerFinancialProfileRow["platform_fee_type"],
    platform_fee_value: Number(row.platform_fee_value || 0),
    platform_fee_payer: String(row.platform_fee_payer || "customer") as OrganizerFinancialProfileRow["platform_fee_payer"],
    payment_fee_value: Number(row.payment_fee_value || 0),
    payout_mode: String(row.payout_mode || "direct_to_organizer") as OrganizerFinancialProfileRow["payout_mode"],
    payout_schedule: String(row.payout_schedule || "manual") as OrganizerFinancialProfileRow["payout_schedule"],
    payout_status: String(row.payout_status || "not_applicable") as OrganizerFinancialProfileRow["payout_status"],
    pricing_policy_enabled: row.pricing_policy_enabled === true,
    version: Number(row.version || 1),
    created_at: mapPostgresTimestamp(row.created_at) || "",
    updated_at: mapPostgresTimestamp(row.updated_at) || "",
  } satisfies OrganizerFinancialProfileRow;
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

function mapDirectPerformanceRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), event_id: String(row.event_id || ""), code: String(row.code || ""),
    title: String(row.title || ""), starts_at: String(row.starts_at || ""), ends_at: typeof row.ends_at === "string" ? row.ends_at : null, seat_plan_image_url: typeof row.seat_plan_image_url === "string" ? row.seat_plan_image_url : null, is_active: Boolean(row.is_active),
    created_at: String(row.created_at || ""), updated_at: String(row.updated_at || ""),
  } satisfies DirectPerformanceRow;
}

function mapDirectSeatRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), event_id: String(row.event_id || ""), performance_id: String(row.performance_id || ""),
    zone: String(row.zone || ""), section_label: typeof row.section_label === "string" ? row.section_label : null, row_label: String(row.row_label || ""), seat_label: String(row.seat_label || ""),
    external_seat_ref: typeof row.external_seat_ref === "string" ? row.external_seat_ref : null,
    ticket_class: typeof row.ticket_class === "string" && row.ticket_class.trim() ? row.ticket_class : null, face_value: row.face_value == null ? null : Number(row.face_value), x: row.x == null ? null : Number(row.x), y: row.y == null ? null : Number(row.y),
    status: String(row.status || "available") as DirectSeatRow["status"],
    allocation_status: String(row.allocation_status || "allocated") as DirectSeatRow["allocation_status"],
    source_status: String(row.source_status || "unknown") as DirectSeatRow["source_status"],
    created_at: String(row.created_at || ""), updated_at: String(row.updated_at || ""),
  } satisfies DirectSeatRow;
}

function mapPostgresTimestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function mapDirectTicketRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), event_id: String(row.event_id || ""), order_id: typeof row.order_id === "string" && row.order_id ? row.order_id : null, customer_account_id: typeof row.customer_account_id === "string" && row.customer_account_id ? row.customer_account_id : null, performance_id: String(row.performance_id || ""), seat_id: String(row.seat_id || ""),
    ticket_class: String(row.ticket_class || ""), holder_name: String(row.holder_name || ""), buyer_name: String(row.buyer_name || ""), phone: String(row.phone || ""), email: String(row.email || ""),
    price_amount: Number(row.price_amount || 0), payment_status: String(row.payment_status || "awaiting_payment") as DirectTicketRow["payment_status"],
    payment_reference: typeof row.payment_reference === "string" ? row.payment_reference : null,
    payment_proof_mime: typeof row.payment_proof_mime === "string" ? row.payment_proof_mime : null,
    payment_proof_base64: typeof row.payment_proof_base64 === "string" ? row.payment_proof_base64 : null,
    payment_proof_submitted_at: mapPostgresTimestamp(row.payment_proof_submitted_at),
    rejection_reason: typeof row.rejection_reason === "string" ? row.rejection_reason : null,
    hold_expires_at: mapPostgresTimestamp(row.hold_expires_at),
    source: row.source === "public" ? "public" : "admin",
    status: String(row.status || "held") as DirectTicketRow["status"], issued_by_user_id: typeof row.issued_by_user_id === "string" ? row.issued_by_user_id : null, issued_at: mapPostgresTimestamp(row.issued_at),
    payment_verified_at: mapPostgresTimestamp(row.payment_verified_at), payment_verified_by_user_id: typeof row.payment_verified_by_user_id === "string" ? row.payment_verified_by_user_id : null,
    checked_in_at: mapPostgresTimestamp(row.checked_in_at), voided_at: mapPostgresTimestamp(row.voided_at),
    created_at: mapPostgresTimestamp(row.created_at) || "", updated_at: mapPostgresTimestamp(row.updated_at) || "",
    performance_code: typeof row.performance_code === "string" ? row.performance_code : undefined, performance_title: typeof row.performance_title === "string" ? row.performance_title : undefined,
    performance_starts_at: typeof row.performance_starts_at === "string" ? row.performance_starts_at : undefined,
    performance_ends_at: typeof row.performance_ends_at === "string" ? row.performance_ends_at : undefined,
    zone: typeof row.zone === "string" ? row.zone : undefined, row_label: typeof row.row_label === "string" ? row.row_label : undefined,
    seat_label: typeof row.seat_label === "string" ? row.seat_label : undefined,
  } satisfies DirectTicketRow;
}

function mapDirectOrderRow(row: Record<string, unknown>, tickets: DirectTicketRow[] = []) {
  return {
    id: String(row.id || ""), event_id: String(row.event_id || ""), performance_id: String(row.performance_id || ""), customer_account_id: typeof row.customer_account_id === "string" && row.customer_account_id ? row.customer_account_id : null,
    buyer_name: String(row.buyer_name || ""), phone: String(row.phone || ""), email: String(row.email || ""), currency: String(row.currency || "THB"),
    subtotal_amount: Number(row.subtotal_amount || 0), platform_fee_amount: Number(row.platform_fee_amount || 0), payment_fee_amount: Number(row.payment_fee_amount || 0), tax_amount: Number(row.tax_amount || 0), discount_amount: Number(row.discount_amount || 0), total_amount: Number(row.total_amount || 0),
    fee_rule_version: String(row.fee_rule_version || "v1"), tax_snapshot_json: String(row.tax_snapshot_json || "{}"), billing_profile_json: String(row.billing_profile_json || "{}"), seller_snapshot_json: String(row.seller_snapshot_json || "{}"),
    seller_organization_id: typeof row.seller_organization_id === "string" && row.seller_organization_id ? row.seller_organization_id : null,
    payment_profile_version: Number(row.payment_profile_version || 1), payment_receiver_snapshot_json: String(row.payment_receiver_snapshot_json || "{}"),
    payout_status: String(row.payout_status || "not_applicable") as DirectOrderRow["payout_status"],
    status: String(row.status || "pending_payment") as DirectOrderRow["status"], payment_reference: typeof row.payment_reference === "string" ? row.payment_reference : null, payment_proof_mime: typeof row.payment_proof_mime === "string" ? row.payment_proof_mime : null, payment_proof_base64: typeof row.payment_proof_base64 === "string" ? row.payment_proof_base64 : null,
    payment_proof_submitted_at: mapPostgresTimestamp(row.payment_proof_submitted_at), rejection_reason: typeof row.rejection_reason === "string" ? row.rejection_reason : null, hold_expires_at: mapPostgresTimestamp(row.hold_expires_at), billing_document_status: String(row.billing_document_status || "not_required") as DirectOrderRow["billing_document_status"], billing_document_number: typeof row.billing_document_number === "string" ? row.billing_document_number : null,
    created_at: mapPostgresTimestamp(row.created_at) || "", updated_at: mapPostgresTimestamp(row.updated_at) || "", tickets,
    performance_code: typeof row.performance_code === "string" ? row.performance_code : undefined, performance_title: typeof row.performance_title === "string" ? row.performance_title : undefined, performance_starts_at: typeof row.performance_starts_at === "string" ? row.performance_starts_at : undefined, performance_ends_at: typeof row.performance_ends_at === "string" ? row.performance_ends_at : undefined,
  } satisfies DirectOrderRow;
}

function mapCustomerNotificationPreferencesRow(row: Record<string, unknown> | undefined, customerAccountId: string) {
  return {
    customer_account_id: customerAccountId,
    email_transactional_enabled: Boolean(row?.email_transactional_enabled ?? true),
    sms_transactional_enabled: Boolean(row?.sms_transactional_enabled ?? false),
    sms_marketing_enabled: Boolean(row?.sms_marketing_enabled ?? false),
    sms_consent_at: mapPostgresTimestamp(row?.sms_consent_at),
    sms_opted_out_at: mapPostgresTimestamp(row?.sms_opted_out_at),
    updated_at: mapPostgresTimestamp(row?.updated_at) || "",
  } satisfies CustomerNotificationPreferencesRow;
}

function mapOutreachCampaignRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), event_id: String(row.event_id || ""), name: String(row.name || ""), description: String(row.description || ""),
    objective: String(row.objective || ""), context: String(row.context || ""), default_instruction: String(row.default_instruction || ""),
    start_date: row.start_date == null ? null : String(row.start_date), end_date: row.end_date == null ? null : String(row.end_date),
    status: String(row.status || "draft") as OutreachCampaignRow["status"], created_by_user_id: row.created_by_user_id == null ? null : String(row.created_by_user_id),
    created_at: mapPostgresTimestamp(row.created_at) || "", updated_at: mapPostgresTimestamp(row.updated_at) || "",
    target_count: Number(row.target_count || 0), needs_action_count: Number(row.needs_action_count || 0), follow_up_due_count: Number(row.follow_up_due_count || 0),
    not_contacted_count: Number(row.not_contacted_count || 0), waiting_count: Number(row.waiting_count || 0), replied_count: Number(row.replied_count || 0),
    press_kit_sent_count: Number(row.press_kit_sent_count || 0), published_count: Number(row.published_count || 0), declined_count: Number(row.declined_count || 0), no_response_count: Number(row.no_response_count || 0),
  } satisfies OutreachCampaignRow;
}

function mapOutreachTargetRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), campaign_id: String(row.campaign_id || ""), event_id: String(row.event_id || ""), name: String(row.name || ""),
    facebook_page_url: String(row.facebook_page_url || ""), facebook_page_id: row.facebook_page_id == null ? null : String(row.facebook_page_id),
    organization_type: String(row.organization_type || "other"), contact_person: row.contact_person == null ? null : String(row.contact_person),
    email: row.email == null ? null : String(row.email), website: row.website == null ? null : String(row.website), notes: String(row.notes || ""),
    priority: String(row.priority || "normal") as OutreachTargetRow["priority"], status: String(row.status || "new") as OutreachTargetRow["status"],
    delivery_mode: String(row.delivery_mode || "manual_first_contact") as OutreachTargetRow["delivery_mode"],
    bound_sender_id: row.bound_sender_id == null ? null : String(row.bound_sender_id), bound_page_id: row.bound_page_id == null ? null : String(row.bound_page_id),
    last_contacted_at: mapPostgresTimestamp(row.last_contacted_at), last_replied_at: mapPostgresTimestamp(row.last_replied_at), next_follow_up_at: mapPostgresTimestamp(row.next_follow_up_at),
    outcome_note: row.outcome_note == null ? null : String(row.outcome_note), assigned_user_id: row.assigned_user_id == null ? null : String(row.assigned_user_id),
    created_at: mapPostgresTimestamp(row.created_at) || "", updated_at: mapPostgresTimestamp(row.updated_at) || "",
  } satisfies OutreachTargetRow;
}

function mapOutreachDraftRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), target_id: String(row.target_id || ""), campaign_id: String(row.campaign_id || ""), event_id: String(row.event_id || ""),
    revision: Number(row.revision || 0), body: String(row.body || ""), kind: String(row.kind || "initial") as OutreachDraftRow["kind"], source_message_id: row.source_message_id == null ? null : Number(row.source_message_id), approval_status: String(row.approval_status || "draft") as OutreachDraftRow["approval_status"],
    approved_by_user_id: row.approved_by_user_id == null ? null : String(row.approved_by_user_id), approved_at: mapPostgresTimestamp(row.approved_at),
    created_by_user_id: row.created_by_user_id == null ? null : String(row.created_by_user_id), created_at: mapPostgresTimestamp(row.created_at) || "", updated_at: mapPostgresTimestamp(row.updated_at) || "",
  } satisfies OutreachDraftRow;
}

function mapOutreachDeliveryRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), target_id: String(row.target_id || ""), campaign_id: String(row.campaign_id || ""), event_id: String(row.event_id || ""),
    draft_id: row.draft_id == null ? null : String(row.draft_id), asset_id: row.asset_id == null ? null : String(row.asset_id),
    kind: String(row.kind || "text") as OutreachDeliveryRow["kind"], channel_platform: String(row.channel_platform || "facebook") as OutreachDeliveryRow["channel_platform"],
    channel_external_id: String(row.channel_external_id || ""), recipient_id: String(row.recipient_id || ""), idempotency_key: String(row.idempotency_key || ""),
    status: String(row.status || "pending") as OutreachDeliveryRow["status"], external_message_id: row.external_message_id == null ? null : String(row.external_message_id),
    error_message: row.error_message == null ? null : String(row.error_message), sent_by_user_id: row.sent_by_user_id == null ? null : String(row.sent_by_user_id),
    sent_at: mapPostgresTimestamp(row.sent_at), created_at: mapPostgresTimestamp(row.created_at) || "", updated_at: mapPostgresTimestamp(row.updated_at) || "",
  } satisfies OutreachDeliveryRow;
}

function mapOutreachAssetRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ""), campaign_id: String(row.campaign_id || ""), event_id: String(row.event_id || ""), name: String(row.name || ""), type: String(row.type || "other"),
    description: String(row.description || ""), url: String(row.url || ""), tags: String(row.tags || ""), is_active: Boolean(row.is_active),
    created_at: mapPostgresTimestamp(row.created_at) || "", updated_at: mapPostgresTimestamp(row.updated_at) || "",
  } satisfies OutreachAssetRow;
}

export class PostgresAppDatabase implements AppDatabase {
  public readonly driver = "postgres" as const;

  private initialized = false;
  private readonly pool: Pool;
  private readonly sqliteBootstrapPath?: string;

  constructor(databaseUrl: string, sqliteBootstrapPath?: string) {
    const sslMode = String(process.env.PGSSLMODE || "require").toLowerCase();
    const shouldUseSsl = sslMode !== "disable" && !/localhost|127\.0\.0\.1/i.test(databaseUrl);

    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl ? { rejectUnauthorized: sslMode === "verify-ca" || sslMode === "verify-full" } : false,
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
    await this.deleteExpiredCustomerSessions();
    await this.deleteExpiredCustomerAccountTokens();
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

  async getEventSettingUpdatedAt(eventId: string, key: string) {
    const result = await this.pool.query<{ updated_at: string }>(
      "SELECT updated_at::text AS updated_at FROM event_settings WHERE event_id = $1 AND key = $2",
      [eventId, key],
    );
    return result.rows[0]?.updated_at || null;
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
      "SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at::text, sms_opt_out_at::text, sms_consent_source, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations WHERE id = $1",
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
        `SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at::text, sms_opt_out_at::text, sms_consent_source, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations ${whereClause} ORDER BY timestamp DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows;
    }

    const result = await this.pool.query<RegistrationRow>(
      `SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at::text, sms_opt_out_at::text, sms_consent_source, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations ${whereClause} ORDER BY timestamp DESC`,
      values,
    );
    return result.rows;
  }

  async getRegistrationCountsByEvent(eventId?: string): Promise<RegistrationCountsByEventRow[]> {
    const normalizedEventId = String(eventId || "").trim();
    const values = normalizedEventId ? [normalizedEventId] : [];
    const whereClause = normalizedEventId ? "WHERE event_id = $1" : "";
    const result = await this.pool.query<{
      event_id: string | null;
      total: string;
      registered: string;
      cancelled: string;
      checked_in: string;
    }>(
      `SELECT event_id,
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status = 'registered')::text AS registered,
              COUNT(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
              COUNT(*) FILTER (WHERE status = 'checked-in')::text AS checked_in
       FROM registrations
       ${whereClause}
       GROUP BY event_id`,
      values,
    );
    return result.rows.map((row) => ({
      event_id: row.event_id,
      total: Number.parseInt(row.total || "0", 10),
      registered: Number.parseInt(row.registered || "0", 10),
      cancelled: Number.parseInt(row.cancelled || "0", 10),
      checked_in: Number.parseInt(row.checked_in || "0", 10),
    }));
  }

  async getRegistrationActivityByDay(eventId: string, limit = 14): Promise<RegistrationActivityByDayRow[]> {
    const normalizedEventId = String(eventId || "").trim();
    const normalizedLimit = Math.min(Math.max(Math.trunc(Number(limit) || 14), 1), 366);
    if (!normalizedEventId) return [];
    const result = await this.pool.query<{
      date: string;
      registrations: string;
      checked_in: string;
    }>(
      `SELECT TO_CHAR(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
              COUNT(*)::text AS registrations,
              COUNT(*) FILTER (WHERE status = 'checked-in')::text AS checked_in
       FROM registrations
       WHERE event_id = $1
       GROUP BY TO_CHAR(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD')
       ORDER BY date DESC
       LIMIT $2`,
      [normalizedEventId, normalizedLimit],
    );
    return result.rows
      .map((row) => ({
        date: String(row.date || ""),
        registrations: Number.parseInt(row.registrations || "0", 10),
        checked_in: Number.parseInt(row.checked_in || "0", 10),
      }))
      .filter((row) => row.date.length > 0)
      .reverse();
  }

  async searchRegistrations(options: RegistrationSearchOptions): Promise<RegistrationRow[]> {
    const eventIds = [...new Set((options.eventIds || []).map((eventId) => String(eventId || "").trim()).filter(Boolean))];
    if (options.eventIds && eventIds.length === 0) return [];
    const limit = Math.min(Math.max(Math.trunc(Number(options.limit) || 30), 1), 200);
    const offset = Math.min(Math.max(Math.trunc(Number(options.offset) || 0), 0), 5000);
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (eventIds.length > 0) {
      values.push(eventIds);
      clauses.push(`event_id = ANY($${values.length}::text[])`);
    }
    if (options.status) {
      values.push(options.status);
      clauses.push(`status = $${values.length}`);
    }
    const query = String(options.query || "").trim().slice(0, 160);
    if (query) {
      const escapedQuery = query.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
      values.push("%" + escapedQuery + "%");
      const queryParam = `$${values.length}`;
      clauses.push(`(
        id ILIKE ${queryParam} ESCAPE E'\\\\' OR
        event_id ILIKE ${queryParam} ESCAPE E'\\\\' OR
        first_name ILIKE ${queryParam} ESCAPE E'\\\\' OR
        last_name ILIKE ${queryParam} ESCAPE E'\\\\' OR
        (first_name || ' ' || last_name) ILIKE ${queryParam} ESCAPE E'\\\\' OR
        phone ILIKE ${queryParam} ESCAPE E'\\\\' OR
        email ILIKE ${queryParam} ESCAPE E'\\\\' OR
        sender_id ILIKE ${queryParam} ESCAPE E'\\\\' OR
        status ILIKE ${queryParam} ESCAPE E'\\\\'
      )`);
    }
    values.push(limit);
    const limitPlaceholder = `$${values.length}`;
    values.push(offset);
    const offsetPlaceholder = `$${values.length}`;
    const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.pool.query<RegistrationRow>(
      `SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at::text, sms_opt_out_at::text, sms_consent_source, first_name, last_name, phone, email, timestamp::text AS timestamp, status
       FROM registrations
       ${whereClause}
       ORDER BY timestamp DESC, id DESC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
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
        `SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at::text, sms_opt_out_at::text, sms_consent_source, first_name, last_name, phone, email, timestamp::text AS timestamp, status
         FROM registrations
         WHERE event_id = $1 AND sender_id = ANY($2::text[])
         ORDER BY timestamp DESC, id DESC`,
        [eventId, normalizedSenderIds],
      );
      return result.rows;
    }

    const result = await this.pool.query<RegistrationRow>(
      `SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at::text, sms_opt_out_at::text, sms_consent_source, first_name, last_name, phone, email, timestamp::text AS timestamp, status
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
    const channelPlatform = String(input.channel_platform || "").trim() || null;
    const channelExternalId = String(input.channel_external_id || "").trim() || null;

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
            `INSERT INTO registrations (id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, first_name, last_name, phone, email)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [id, senderId, eventId, input.customer_account_id || null, channelPlatform, channelExternalId, firstName, lastName, phone, email],
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

  async setRegistrationSmsConsent(id: string, optedIn: boolean, source: string) {
    const result = optedIn
      ? await this.pool.query("UPDATE registrations SET sms_opt_in_at=CURRENT_TIMESTAMP, sms_opt_out_at=NULL, sms_consent_source=$2 WHERE id=$1", [id, source])
      : await this.pool.query("UPDATE registrations SET sms_opt_out_at=CURRENT_TIMESTAMP, sms_consent_source=$2 WHERE id=$1", [id, source]);
    return result.rowCount > 0;
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

  async enqueueNotificationDelivery(input: CreateNotificationDeliveryInput) {
    const channel = String(input.channel || "").trim();
    const kind = String(input.kind || "").trim();
    const recipient = String(input.recipient || "").trim();
    const idempotencyKey = String(input.idempotency_key || "").trim();
    if (!channel || !kind || !recipient || !idempotencyKey) return null;

    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO notification_deliveries (
        id, channel, kind, recipient, recipient_snapshot, related_type, related_id,
        payload_json, idempotency_key, provider
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id, channel, kind, recipient, recipient_snapshot, related_type, related_id,
                payload_json, idempotency_key, status, attempt_count, available_at::text,
                locked_at::text, locked_by, provider, provider_message_id, last_error,
                queued_at::text, sent_at::text, updated_at::text`,
      [
        generateEntityId("ntf"),
        channel,
        kind,
        recipient,
        input.recipient_snapshot == null ? null : String(input.recipient_snapshot),
        input.related_type == null ? null : String(input.related_type).trim() || null,
        input.related_id == null ? null : String(input.related_id).trim() || null,
        String(input.payload_json || "{}").trim() || "{}",
        idempotencyKey,
        input.provider == null ? null : String(input.provider).trim() || null,
      ],
    );

    return mapNotificationDeliveryRow(result.rows[0]);
  }

  async listNotificationDeliveries(options: { related_type?: string; related_id?: string; kind?: string; limit?: number } = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const relatedType = String(options.related_type || "").trim();
    const relatedId = String(options.related_id || "").trim();
    const kind = String(options.kind || "").trim();
    if (relatedType) {
      params.push(relatedType);
      clauses.push(`related_type = $${params.length}`);
    }
    if (relatedId) {
      params.push(relatedId);
      clauses.push(`related_id = $${params.length}`);
    }
    if (kind) {
      params.push(kind);
      clauses.push(`kind = $${params.length}`);
    }
    const limit = Math.min(Math.max(Number.parseInt(String(options.limit ?? 200), 10) || 200, 1), 1000);
    params.push(limit);
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, channel, kind, recipient, recipient_snapshot, related_type, related_id,
              payload_json, idempotency_key, status, attempt_count, available_at::text,
              locked_at::text, locked_by, provider, provider_message_id, last_error,
              queued_at::text, sent_at::text, updated_at::text
       FROM notification_deliveries
       ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY queued_at DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map((row) => mapNotificationDeliveryRow(row)).filter((row): row is NotificationDeliveryRow => Boolean(row));
  }

  async claimNotificationDeliveries(workerId: string, limit = 10) {
    const normalizedWorkerId = String(workerId || "").trim();
    const normalizedLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 10, 1), 100);
    if (!normalizedWorkerId) return [];

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Record<string, unknown>>(
        `WITH candidates AS (
           SELECT id
           FROM notification_deliveries
           WHERE (status = 'queued' AND available_at <= CURRENT_TIMESTAMP)
              OR (status = 'processing' AND locked_at IS NOT NULL AND locked_at <= CURRENT_TIMESTAMP - INTERVAL '5 minutes')
           ORDER BY available_at ASC, queued_at ASC, id ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE notification_deliveries AS deliveries
         SET status = 'processing',
             attempt_count = deliveries.attempt_count + 1,
             locked_at = CURRENT_TIMESTAMP,
             locked_by = $2,
             updated_at = CURRENT_TIMESTAMP
         FROM candidates
         WHERE deliveries.id = candidates.id
         RETURNING deliveries.id, deliveries.channel, deliveries.kind, deliveries.recipient,
                   deliveries.recipient_snapshot, deliveries.related_type, deliveries.related_id,
                   deliveries.payload_json, deliveries.idempotency_key, deliveries.status,
                   deliveries.attempt_count, deliveries.available_at::text, deliveries.locked_at::text,
                   deliveries.locked_by, deliveries.provider, deliveries.provider_message_id,
                   deliveries.last_error, deliveries.queued_at::text, deliveries.sent_at::text,
                   deliveries.updated_at::text`,
        [normalizedLimit, normalizedWorkerId],
      );
      await client.query("COMMIT");
      return result.rows.map((row) => mapNotificationDeliveryRow(row)).filter((row): row is NotificationDeliveryRow => Boolean(row));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markNotificationDeliverySent(id: string, workerId: string, providerMessageId?: string | null, provider?: string | null) {
    await this.pool.query(
      `UPDATE notification_deliveries
       SET status = 'sent',
           provider = COALESCE($1, provider),
           provider_message_id = COALESCE($2, provider_message_id),
           last_error = NULL,
           sent_at = CURRENT_TIMESTAMP,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = 'processing' AND locked_by = $4`,
      [
        provider == null ? null : String(provider).trim() || null,
        providerMessageId == null ? null : String(providerMessageId).trim() || null,
        String(id || "").trim(),
        String(workerId || "").trim(),
      ],
    );
  }

  async markNotificationDeliveryRetryable(id: string, workerId: string, errorMessage: string, availableAt: string, provider?: string | null) {
    await this.pool.query(
      `UPDATE notification_deliveries
       SET status = 'queued',
           available_at = $1,
           provider = COALESCE($2, provider),
           last_error = $3,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND status = 'processing' AND locked_by = $5`,
      [
        String(availableAt || "").trim() || new Date().toISOString(),
        provider == null ? null : String(provider).trim() || null,
        String(errorMessage || "").trim().slice(0, 1000),
        String(id || "").trim(),
        String(workerId || "").trim(),
      ],
    );
  }

  async markNotificationDeliveryFailed(id: string, workerId: string, errorMessage: string, provider?: string | null) {
    await this.pool.query(
      `UPDATE notification_deliveries
       SET status = 'failed',
           provider = COALESCE($1, provider),
           last_error = $2,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = 'processing' AND locked_by = $4`,
      [
        provider == null ? null : String(provider).trim() || null,
        String(errorMessage || "").trim().slice(0, 1000),
        String(id || "").trim(),
        String(workerId || "").trim(),
      ],
    );
  }

  async getCustomerAccountById(id: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM customer_accounts WHERE id = $1 LIMIT 1",
      [String(id || "").trim()],
    );
    return mapCustomerAccountRow(result.rows[0]);
  }

  async getCustomerAccountByNormalizedEmail(normalizedEmail: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM customer_accounts WHERE normalized_email = $1 LIMIT 1",
      [String(normalizedEmail || "").trim()],
    );
    return mapCustomerAccountRow(result.rows[0]);
  }

  async listCustomerAccounts(limit = 200) {
    const normalizedLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 200, 1), 1000);
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM customer_accounts ORDER BY created_at DESC, id DESC LIMIT $1",
      [normalizedLimit],
    );
    return result.rows.map((row) => mapCustomerAccountRow(row)).filter((row): row is CustomerAccountRow => Boolean(row));
  }

  async createCustomerAccount(input: CreateCustomerAccountInput) {
    const id = generateEntityId("cst");
    await this.pool.query(
      `INSERT INTO customer_accounts (
        id, email, normalized_email, password_hash, first_name, last_name, phone,
        normalized_phone, accepted_terms_at, accepted_privacy_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        String(input.email || "").trim(),
        String(input.normalized_email || "").trim(),
        String(input.password_hash || "").trim(),
        String(input.first_name || "").trim(),
        String(input.last_name || "").trim(),
        String(input.phone || "").trim(),
        String(input.normalized_phone || "").trim(),
        input.accepted_terms_at.toISOString(),
        input.accepted_privacy_at.toISOString(),
      ],
    );
    const account = await this.getCustomerAccountById(id);
    if (!account) throw new Error("Failed to create customer account");
    return account;
  }

  async updateCustomerProfile(id: string, input: UpdateCustomerProfileInput) {
    const normalizedId = String(id || "").trim();
    const result = await this.pool.query(
      `UPDATE customer_accounts
       SET first_name = $1, last_name = $2, phone = $3, normalized_phone = $4,
           address_line1 = $5, address_line2 = $6, district = $7, subdistrict = $8,
           province = $9, postal_code = $10, country = $11, updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 AND status != 'disabled'`,
      [
        String(input.first_name || "").trim(),
        String(input.last_name || "").trim(),
        String(input.phone || "").trim(),
        String(input.normalized_phone || "").trim(),
        input.address_line1 || null,
        input.address_line2 || null,
        input.district || null,
        input.subdistrict || null,
        input.province || null,
        input.postal_code || null,
        input.country || null,
        normalizedId,
      ],
    );
    return result.rowCount > 0 ? this.getCustomerAccountById(normalizedId) : undefined;
  }

  async updateCustomerPasswordHash(id: string, passwordHash: string) {
    const result = await this.pool.query(
      "UPDATE customer_accounts SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND status != 'disabled'",
      [String(passwordHash || "").trim(), String(id || "").trim()],
    );
    return result.rowCount > 0;
  }

  async verifyCustomerAccountEmail(id: string) {
    const result = await this.pool.query(
      `UPDATE customer_accounts
       SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
           status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status != 'disabled'`,
      [String(id || "").trim()],
    );
    return result.rowCount > 0;
  }

  async updateCustomerAccountLastLogin(id: string) {
    await this.pool.query(
      "UPDATE customer_accounts SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status != 'disabled'",
      [String(id || "").trim()],
    );
  }

  async setCustomerAccountStatus(id: string, status: CustomerAccountStatus) {
    const normalizedId = String(id || "").trim();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE customer_accounts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [status, normalizedId],
      );
      if (result.rowCount > 0 && status === "disabled") {
        await client.query("DELETE FROM customer_sessions WHERE customer_account_id = $1", [normalizedId]);
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

  async createCustomerSession(customerAccountId: string, tokenHash: string, expiresAt: Date) {
    await this.pool.query(
      `INSERT INTO customer_sessions (id, customer_account_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [generateEntityId("cses"), String(customerAccountId || "").trim(), String(tokenHash || "").trim(), expiresAt.toISOString()],
    );
  }

  async getCustomerSessionWithAccount(tokenHash: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
        s.id AS session_id,
        s.token_hash,
        s.expires_at AS session_expires_at,
        s.last_seen_at AS session_last_seen_at,
        c.id, c.email, c.normalized_email, c.password_hash, c.email_verified_at,
        c.first_name, c.last_name, c.phone, c.normalized_phone, c.address_line1,
        c.address_line2, c.district, c.subdistrict, c.province, c.postal_code,
        c.country, c.accepted_terms_at, c.accepted_privacy_at, c.status,
        c.last_login_at, c.created_at, c.updated_at
       FROM customer_sessions s
       JOIN customer_accounts c ON c.id = s.customer_account_id
       WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP AND c.status != 'disabled'
       LIMIT 1`,
      [String(tokenHash || "").trim()],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const account = mapCustomerAccountRow(row);
    if (!account) return undefined;
    return {
      session_id: String(row.session_id || ""),
      token_hash: String(row.token_hash || ""),
      expires_at: mapPostgresTimestamp(row.session_expires_at) || "",
      last_seen_at: mapPostgresTimestamp(row.session_last_seen_at) || "",
      account,
    } satisfies CustomerAccountSessionRow;
  }

  async touchCustomerSession(sessionId: string) {
    await this.pool.query("UPDATE customer_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1", [String(sessionId || "").trim()]);
  }

  async deleteCustomerSession(tokenHash: string) {
    await this.pool.query("DELETE FROM customer_sessions WHERE token_hash = $1", [String(tokenHash || "").trim()]);
  }

  async deleteCustomerSessions(customerAccountId: string) {
    await this.pool.query("DELETE FROM customer_sessions WHERE customer_account_id = $1", [String(customerAccountId || "").trim()]);
  }

  async deleteExpiredCustomerSessions() {
    await this.pool.query("DELETE FROM customer_sessions WHERE expires_at <= CURRENT_TIMESTAMP");
  }

  async createCustomerAccountToken(input: CreateCustomerAccountTokenInput) {
    const id = generateEntityId("ctok");
    await this.pool.query(
      `INSERT INTO customer_account_tokens (id, customer_account_id, kind, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        String(input.customer_account_id || "").trim(),
        input.kind,
        String(input.token_hash || "").trim(),
        input.expires_at.toISOString(),
      ],
    );
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT id, customer_account_id, kind, expires_at, created_at FROM customer_account_tokens WHERE id = $1",
      [id],
    );
    const token = mapCustomerAccountTokenRow(result.rows[0]);
    if (!token) throw new Error("Failed to create customer account token");
    return token;
  }

  async consumeCustomerAccountToken(tokenHash: string, kind: CustomerAccountTokenKind) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; customer_account_id: string }>(
        `SELECT id, customer_account_id
         FROM customer_account_tokens
         WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [String(tokenHash || "").trim(), kind],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return undefined;
      }
      const updated = await client.query(
        "UPDATE customer_account_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1 AND used_at IS NULL",
        [row.id],
      );
      await client.query("COMMIT");
      return updated.rowCount > 0 ? { token_id: row.id, customer_account_id: row.customer_account_id } : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteExpiredCustomerAccountTokens() {
    await this.pool.query("DELETE FROM customer_account_tokens WHERE expires_at <= CURRENT_TIMESTAMP OR used_at IS NOT NULL");
  }

  async listCustomerRegistrations(customerAccountId: string) {
    const result = await this.pool.query<RegistrationRow>(
      "SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at::text, sms_opt_out_at::text, sms_consent_source, first_name, last_name, phone, email, timestamp::text AS timestamp, status FROM registrations WHERE customer_account_id = $1 ORDER BY timestamp DESC",
      [String(customerAccountId || "").trim()],
    );
    return result.rows;
  }

  async claimRegistrationToCustomer(input: { registration_id: string; customer_account_id: string; normalized_email?: string; normalized_phone?: string }) {
    const registrationId = String(input.registration_id || "").trim().toUpperCase();
    const accountId = String(input.customer_account_id || "").trim();
    const current = await this.pool.query<{ customer_account_id: string | null; email: string; phone: string }>("SELECT customer_account_id,email,phone FROM registrations WHERE id=$1 LIMIT 1", [registrationId]);
    const row = current.rows[0];
    if (!row) return "not_found" as const;
    if (row.customer_account_id && row.customer_account_id !== accountId) return "already_claimed" as const;
    const emailMatches = Boolean(input.normalized_email && String(row.email || "").trim().toLowerCase() === input.normalized_email.trim().toLowerCase());
    const phoneMatches = Boolean(input.normalized_phone && String(row.phone || "").replace(/\D/g, "") === input.normalized_phone.replace(/\D/g, ""));
    if (!emailMatches && !phoneMatches) return "contact_mismatch" as const;
    if (row.customer_account_id === accountId) return "already_claimed" as const;
    const updated = await this.pool.query("UPDATE registrations SET customer_account_id=$1 WHERE id=$2 AND customer_account_id IS NULL", [accountId, registrationId]);
    return updated.rowCount > 0 ? "claimed" as const : "already_claimed" as const;
  }

  async unlinkRegistrationFromCustomer(registrationId: string, customerAccountId?: string | null) {
    const id = String(registrationId || "").trim().toUpperCase();
    const accountId = customerAccountId == null ? "" : String(customerAccountId).trim();
    const result = await this.pool.query(accountId
      ? "UPDATE registrations SET customer_account_id = NULL WHERE id = $1 AND customer_account_id = $2"
      : "UPDATE registrations SET customer_account_id = NULL WHERE id = $1 AND customer_account_id IS NOT NULL", accountId ? [id, accountId] : [id]);
    return (result.rowCount || 0) > 0;
  }

  async getCustomerNotificationPreferences(customerAccountId: string) {
    const accountId = String(customerAccountId || "").trim();
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM customer_notification_preferences WHERE customer_account_id=$1", [accountId]);
    return mapCustomerNotificationPreferencesRow(result.rows[0], accountId);
  }

  async updateCustomerNotificationPreferences(customerAccountId: string, input: UpdateCustomerNotificationPreferencesInput) {
    const accountId = String(customerAccountId || "").trim();
    const current = await this.getCustomerNotificationPreferences(accountId);
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO customer_notification_preferences (customer_account_id,email_transactional_enabled,sms_transactional_enabled,sms_marketing_enabled,sms_consent_at,sms_opted_out_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(customer_account_id) DO UPDATE SET email_transactional_enabled=EXCLUDED.email_transactional_enabled,sms_transactional_enabled=EXCLUDED.sms_transactional_enabled,sms_marketing_enabled=EXCLUDED.sms_marketing_enabled,sms_consent_at=EXCLUDED.sms_consent_at,sms_opted_out_at=EXCLUDED.sms_opted_out_at,updated_at=CURRENT_TIMESTAMP
       RETURNING *`,
      [accountId, input.email_transactional_enabled ?? current.email_transactional_enabled, input.sms_transactional_enabled ?? current.sms_transactional_enabled, input.sms_marketing_enabled ?? current.sms_marketing_enabled, input.sms_consent_at === undefined ? current.sms_consent_at : input.sms_consent_at?.toISOString() || null, input.sms_opted_out_at === undefined ? current.sms_opted_out_at : input.sms_opted_out_at?.toISOString() || null],
    );
    return mapCustomerNotificationPreferencesRow(result.rows[0], accountId);
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

  async listDirectPerformances(eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT id,event_id,code,title,starts_at::text,ends_at::text,seat_plan_image_url,is_active,created_at::text,updated_at::text FROM event_performances WHERE event_id=$1 ORDER BY starts_at", [eventId]);
    return result.rows.map(mapDirectPerformanceRow);
  }

  async upsertDirectPerformance(input: UpsertDirectPerformanceInput) {
    const result = await this.pool.query<Record<string, unknown>>(`INSERT INTO event_performances (id,event_id,code,title,starts_at,ends_at,seat_plan_image_url,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(event_id,code) DO UPDATE SET title=EXCLUDED.title,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,seat_plan_image_url=EXCLUDED.seat_plan_image_url,is_active=EXCLUDED.is_active,updated_at=CURRENT_TIMESTAMP
      RETURNING id,event_id,code,title,starts_at::text,ends_at::text,seat_plan_image_url,is_active,created_at::text,updated_at::text`, [generateEntityId("perf"), input.event_id, input.code.trim(), input.title.trim(), input.starts_at, input.ends_at || null, input.seat_plan_image_url || null, input.is_active !== false]);
    return mapDirectPerformanceRow(result.rows[0]);
  }

  async deleteDirectPerformance(eventId: string, performanceId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const performance = await client.query("SELECT id FROM event_performances WHERE id=$1 AND event_id=$2 FOR UPDATE", [performanceId, eventId]);
      if (!performance.rows[0]) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const ticketCount = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM direct_tickets WHERE performance_id=$1 AND event_id=$2", [performanceId, eventId]);
      const seatCount = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM direct_seats WHERE performance_id=$1 AND event_id=$2", [performanceId, eventId]);
      const tickets = Number(ticketCount.rows[0]?.count || 0);
      const seats = Number(seatCount.rows[0]?.count || 0);
      if (tickets > 0) {
        await client.query("COMMIT");
        return { status: "blocked" as const, tickets, seats };
      }
      await client.query("DELETE FROM direct_seats WHERE performance_id=$1 AND event_id=$2", [performanceId, eventId]);
      await client.query("DELETE FROM event_performances WHERE id=$1 AND event_id=$2", [performanceId, eventId]);
      await client.query("COMMIT");
      return { status: "deleted" as const, tickets, seats };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetDirectPerformance(eventId: string, performanceId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const performance = await client.query("SELECT id FROM event_performances WHERE id=$1 AND event_id=$2 FOR UPDATE", [performanceId, eventId]);
      if (!performance.rows[0]) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const orderCount = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM direct_orders WHERE performance_id=$1 AND event_id=$2", [performanceId, eventId]);
      if (Number(orderCount.rows[0]?.count || 0) > 0) {
        await client.query("COMMIT");
        return { tickets: 0, seats: 0, orders: Number(orderCount.rows[0]?.count || 0), blocked: true };
      }
      const tickets = await client.query("DELETE FROM direct_tickets WHERE performance_id=$1 AND event_id=$2", [performanceId, eventId]);
      const seats = await client.query("DELETE FROM direct_seats WHERE performance_id=$1 AND event_id=$2", [performanceId, eventId]);
      await client.query("COMMIT");
      return { tickets: tickets.rowCount || 0, seats: seats.rowCount || 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDirectSeats(eventId: string, performanceId?: string) {
    await this.releaseExpiredDirectOrderHolds(eventId);
    await this.releaseExpiredDirectTicketHolds(eventId);
    const result = await this.pool.query<Record<string, unknown>>(`SELECT id,event_id,performance_id,zone,section_label,row_label,seat_label,external_seat_ref,ticket_class,face_value,x,y,status,allocation_status,source_status,created_at::text,updated_at::text FROM direct_seats WHERE event_id=$1 ${performanceId ? "AND performance_id=$2" : ""} ORDER BY zone,row_label,seat_label`, performanceId ? [eventId, performanceId] : [eventId]);
    return result.rows.map(mapDirectSeatRow);
  }

  async importDirectSeats(eventId: string, performanceId: string, seats: ImportDirectSeatInput[], options?: { replaceMissing?: boolean; replaceLayout?: boolean }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const layoutUpdate = options?.replaceLayout ? "x=EXCLUDED.x,y=EXCLUDED.y" : "x=COALESCE(direct_seats.x,EXCLUDED.x),y=COALESCE(direct_seats.y,EXCLUDED.y)";
      for (const seat of seats) {
        const allocationStatus = seat.allocation_status === "not_allocated" ? "not_allocated" : "allocated";
        const sourceStatus = seat.source_status || "unknown";
        await client.query(`INSERT INTO direct_seats (id,event_id,performance_id,zone,section_label,row_label,seat_label,external_seat_ref,ticket_class,face_value,x,y,allocation_status,source_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(performance_id,zone,row_label,seat_label) DO UPDATE SET section_label=EXCLUDED.section_label,external_seat_ref=EXCLUDED.external_seat_ref,ticket_class=EXCLUDED.ticket_class,face_value=EXCLUDED.face_value,${layoutUpdate},allocation_status=EXCLUDED.allocation_status,source_status=EXCLUDED.source_status,updated_at=CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM direct_tickets WHERE direct_tickets.seat_id=direct_seats.id AND direct_tickets.status IN ('held','issued','checked_in'))`, [generateEntityId("seat"), eventId, performanceId, String(seat.zone).trim(), seat.section_label || null, String(seat.row_label).trim(), String(seat.seat_label).trim(), seat.external_seat_ref || null, seat.ticket_class || null, seat.face_value ?? null, seat.x ?? null, seat.y ?? null, allocationStatus, sourceStatus]);
      }
      if (options?.replaceMissing && seats.length) {
        const keep = seats.map((_, index) => `(zone=$${index * 3 + 3} AND row_label=$${index * 3 + 4} AND seat_label=$${index * 3 + 5})`).join(" OR ");
        const keepParams = seats.flatMap((seat) => [String(seat.zone).trim(), String(seat.row_label).trim(), String(seat.seat_label).trim()]);
        await client.query(`UPDATE direct_seats SET allocation_status='not_allocated',source_status='unknown',status='voided',updated_at=CURRENT_TIMESTAMP WHERE event_id=$1 AND performance_id=$2 AND NOT EXISTS (SELECT 1 FROM direct_tickets WHERE direct_tickets.seat_id=direct_seats.id AND direct_tickets.status IN ('held','issued','checked_in')) AND NOT (${keep})`, [eventId, performanceId, ...keepParams]);
      }
      await client.query("UPDATE direct_seats SET status=CASE WHEN allocation_status='not_allocated' THEN 'voided' WHEN allocation_status='allocated' AND status='voided' THEN 'available' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE event_id=$1 AND performance_id=$2 AND NOT EXISTS (SELECT 1 FROM direct_tickets WHERE direct_tickets.seat_id=direct_seats.id AND direct_tickets.status IN ('held','issued','checked_in'))", [eventId, performanceId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return this.listDirectSeats(eventId, performanceId);
  }

  private async directTicketRows(where: string, params: unknown[]) {
    const result = await this.pool.query<Record<string, unknown>>(`SELECT t.*,p.code performance_code,p.title performance_title,p.starts_at::text performance_starts_at,p.ends_at::text performance_ends_at,s.zone,s.row_label,s.seat_label FROM direct_tickets t JOIN event_performances p ON p.id=t.performance_id JOIN direct_seats s ON s.id=t.seat_id ${where}`, params); return result.rows.map(mapDirectTicketRow);
  }

  private async directOrderRows(where: string, params: unknown[]) {
    const result = await this.pool.query<Record<string, unknown>>(`SELECT o.*,p.code performance_code,p.title performance_title,p.starts_at::text performance_starts_at,p.ends_at::text performance_ends_at FROM direct_orders o JOIN event_performances p ON p.id=o.performance_id ${where}`, params);
    return Promise.all(result.rows.map(async (row) => mapDirectOrderRow(row, await this.directTicketRows("WHERE t.order_id=$1 ORDER BY t.created_at ASC", [row.id]))));
  }

  async listDirectTickets(eventId: string) { await this.releaseExpiredDirectTicketHolds(eventId); return this.directTicketRows("WHERE t.event_id=$1 ORDER BY t.created_at DESC", [eventId]); }
  async getDirectTicketById(id: string) { return (await this.directTicketRows("WHERE t.id=$1", [id]))[0]; }

  async createDirectTicket(input: CreateDirectTicketInput) {
    await this.releaseExpiredDirectOrderHolds(input.event_id);
    await this.releaseExpiredDirectTicketHolds(input.event_id);
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const seat = await client.query<Record<string, unknown>>("SELECT * FROM direct_seats WHERE id=$1 AND event_id=$2 AND performance_id=$3 FOR UPDATE", [input.seat_id,input.event_id,input.performance_id]); if (!seat.rows[0]) { await client.query("ROLLBACK"); return { error: "invalid_seat" as const }; } if (seat.rows[0].status !== "available" || seat.rows[0].allocation_status !== "allocated") { await client.query("ROLLBACK"); return { error: "seat_unavailable" as const }; } const paymentStatus = input.payment_required === false ? "not_required" : "awaiting_payment"; const status = paymentStatus === "not_required" ? "issued" : "held"; const id=generateEntityId("dtkt"); const holdMinutes=Math.min(120,Math.max(5,Math.round(Number(input.hold_minutes)||15))); await client.query(`INSERT INTO direct_tickets (id,event_id,customer_account_id,performance_id,seat_id,ticket_class,holder_name,buyer_name,phone,email,price_amount,payment_status,status,issued_by_user_id,issued_at,hold_expires_at,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $13='issued' THEN CURRENT_TIMESTAMP END,CASE WHEN $13='held' THEN CURRENT_TIMESTAMP + ($15 * INTERVAL '1 minute') END,$16)`,[id,input.event_id,input.customer_account_id || null,input.performance_id,input.seat_id,input.ticket_class,String(input.holder_name || ""),String(input.buyer_name || ""),String(input.phone || ""),String(input.email || ""),Number(input.price_amount || 0),paymentStatus,status,input.issued_by_user_id || null,holdMinutes,input.source === "public" ? "public" : "admin"]); await client.query("UPDATE direct_seats SET status=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",[status,input.seat_id]); await client.query("COMMIT"); return { ticket: await this.getDirectTicketById(id) }; } catch (error) { await client.query("ROLLBACK"); if ((error as { code?: string }).code === "23505") return { error: "seat_unavailable" as const }; throw error; } finally { client.release(); }
  }

  async createDirectOrder(input: CreateDirectOrderInput) {
    await this.releaseExpiredDirectOrderHolds(input.event_id);
    const seatIds = [...new Set((input.seat_ids || []).map((seatId) => String(seatId || "").trim()).filter(Boolean))];
    if (!seatIds.length || !input.event_id || !input.performance_id) return { error: "invalid_order" as const };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const seats = await client.query<Record<string, unknown>>("SELECT * FROM direct_seats WHERE id=ANY($1::text[]) AND event_id=$2 AND performance_id=$3 FOR UPDATE", [seatIds, input.event_id, input.performance_id]);
      if (seats.rows.length !== seatIds.length) { await client.query("ROLLBACK"); return { error: "invalid_seat" as const }; }
      if (seats.rows.some((seat) => seat.status !== "available" || seat.allocation_status !== "allocated")) { await client.query("ROLLBACK"); return { error: "seat_unavailable" as const }; }
      const orderId = generateEntityId("ord");
      const holdMinutes = Math.min(120, Math.max(5, Math.round(Number(input.hold_minutes) || 15)));
      const totalAmount = Math.max(0, Number(input.total_amount) || 0);
      const subtotalAmount = Math.max(0, Number(input.subtotal_amount) || 0);
      const status = totalAmount === 0 ? "paid" : "pending_payment";
      const billingStatus = String(input.billing_profile_json || "{}").trim() !== "{}" ? "pending" : "not_required";
      await client.query(`INSERT INTO direct_orders (id,event_id,performance_id,customer_account_id,buyer_name,phone,email,currency,subtotal_amount,platform_fee_amount,payment_fee_amount,tax_amount,discount_amount,total_amount,fee_rule_version,tax_snapshot_json,billing_profile_json,seller_snapshot_json,status,hold_expires_at,billing_document_status,seller_organization_id,payment_profile_version,payment_receiver_snapshot_json,payout_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,CASE WHEN $19='pending_payment' THEN CURRENT_TIMESTAMP + ($20 * INTERVAL '1 minute') END,$21,$22,$23,$24,$25)`, [orderId,input.event_id,input.performance_id,input.customer_account_id || null,String(input.buyer_name || "").trim(),String(input.phone || "").trim(),String(input.email || "").trim(),"THB",subtotalAmount,Math.max(0,Number(input.platform_fee_amount)||0),Math.max(0,Number(input.payment_fee_amount)||0),Math.max(0,Number(input.tax_amount)||0),Math.max(0,Number(input.discount_amount)||0),totalAmount,String(input.fee_rule_version || "v1"),String(input.tax_snapshot_json || "{}").trim() || "{}",String(input.billing_profile_json || "{}").trim() || "{}",String(input.seller_snapshot_json || "{}").trim() || "{}",status,holdMinutes,billingStatus,input.seller_organization_id || null,Math.max(1,Number(input.payment_profile_version)||1),String(input.payment_receiver_snapshot_json || "{}").trim() || "{}",input.payout_status || "not_applicable"]);
      const seatPrice = seatIds.length ? subtotalAmount / seatIds.length : 0;
      const ticketStatus = status === "paid" ? "issued" : "held";
      const paymentStatus = status === "paid" ? "verified" : "awaiting_payment";
      for (const seat of seats.rows) {
        await client.query(`INSERT INTO direct_tickets (id,event_id,order_id,customer_account_id,performance_id,seat_id,ticket_class,holder_name,buyer_name,phone,email,price_amount,payment_status,status,issued_at,hold_expires_at,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $14='issued' THEN CURRENT_TIMESTAMP END,CASE WHEN $14='held' THEN CURRENT_TIMESTAMP + ($15 * INTERVAL '1 minute') END,$16)`, [generateEntityId("dtkt"),input.event_id,orderId,input.customer_account_id || null,input.performance_id,seat.id,String(input.ticket_class || "Public").trim() || "Public",String(input.buyer_name || "").trim(),String(input.buyer_name || "").trim(),String(input.phone || "").trim(),String(input.email || "").trim(),seatPrice,paymentStatus,ticketStatus,holdMinutes,input.source === "admin" ? "admin" : "public"]);
        await client.query("UPDATE direct_seats SET status=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [ticketStatus, seat.id]);
      }
      await client.query("INSERT INTO payment_attempts (id,order_id,attempt_number,method,amount,status,receiver_snapshot_json) VALUES ($1,$2,1,'promptpay',$3,$4,$5)", [generateEntityId("pay"),orderId,totalAmount,status === "paid" ? "verified" : "pending",String(input.payment_receiver_snapshot_json || "{}").trim() || "{}"]);
      await client.query("COMMIT");
      return { order: await this.getDirectOrderById(orderId) };
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") return { error: "seat_unavailable" as const };
      throw error;
    } finally { client.release(); }
  }

  async getDirectOrderById(id: string) {
    await this.releaseExpiredDirectOrderHolds();
    return (await this.directOrderRows("WHERE o.id=$1", [String(id || "").trim()]))[0];
  }

  async listDirectOrders(eventId: string) {
    await this.releaseExpiredDirectOrderHolds(eventId);
    return this.directOrderRows("WHERE o.event_id=$1 ORDER BY o.created_at DESC", [String(eventId || "").trim()]);
  }

  async listCustomerOrders(customerAccountId: string) {
    await this.releaseExpiredDirectOrderHolds();
    return this.directOrderRows("WHERE o.customer_account_id=$1 ORDER BY o.created_at DESC", [String(customerAccountId || "").trim()]);
  }

  async submitDirectOrderPaymentProof(id: string, input: { payment_proof_mime: string; payment_proof_base64: string; payment_reference?: string | null }) {
    await this.releaseExpiredDirectOrderHolds();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query("SELECT id,status FROM direct_orders WHERE id=$1 FOR UPDATE", [id]);
      const order = current.rows[0];
      if (!order || !["pending_payment", "payment_submitted"].includes(String(order.status))) { await client.query("ROLLBACK"); return this.getDirectOrderById(id); }
      await client.query("UPDATE direct_orders SET status='payment_submitted',payment_proof_mime=$1,payment_proof_base64=$2,payment_proof_submitted_at=CURRENT_TIMESTAMP,payment_reference=$3,hold_expires_at=CURRENT_TIMESTAMP+INTERVAL '24 hours',updated_at=CURRENT_TIMESTAMP WHERE id=$4", [input.payment_proof_mime,input.payment_proof_base64,input.payment_reference || null,id]);
      await client.query("UPDATE direct_tickets SET payment_status='proof_submitted',payment_proof_mime=$1,payment_proof_base64=$2,payment_proof_submitted_at=CURRENT_TIMESTAMP,payment_reference=$3,hold_expires_at=CURRENT_TIMESTAMP+INTERVAL '24 hours',updated_at=CURRENT_TIMESTAMP WHERE order_id=$4 AND status='held'", [input.payment_proof_mime,input.payment_proof_base64,input.payment_reference || null,id]);
      await client.query("UPDATE payment_attempts SET status='proof_submitted',proof_mime=$1,proof_base64=$2,transaction_reference=$3,updated_at=CURRENT_TIMESTAMP WHERE order_id=$4 AND attempt_number=(SELECT MAX(attempt_number) FROM payment_attempts WHERE order_id=$4)", [input.payment_proof_mime,input.payment_proof_base64,input.payment_reference || null,id]);
      await client.query("COMMIT");
      return this.getDirectOrderById(id);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async updateDirectOrderPayment(id: string, input: { payment_status: "verified" | "rejected" | "refunded"; payment_reference?: string | null; verified_by_user_id?: string | null; rejection_reason?: string | null }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<Record<string, unknown>>("SELECT * FROM direct_orders WHERE id=$1 FOR UPDATE", [id]);
      const order = current.rows[0];
      if (!order) { await client.query("ROLLBACK"); return undefined; }
      if (order.status === "paid" && input.payment_status === "verified") { await client.query("ROLLBACK"); return this.getDirectOrderById(id); }
      if (!["pending_payment", "payment_submitted"].includes(String(order.status)) && input.payment_status !== "refunded") { await client.query("ROLLBACK"); return this.getDirectOrderById(id); }
      const nextStatus = input.payment_status === "verified" ? "paid" : input.payment_status === "refunded" ? "refunded" : "rejected";
      const ticketStatus = input.payment_status === "verified" ? "issued" : "voided";
      await client.query("UPDATE direct_orders SET status=$1,payment_reference=COALESCE($2,payment_reference),rejection_reason=$3,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$4", [nextStatus,input.payment_reference || null,input.rejection_reason || null,id]);
      if (input.payment_status === "verified") await client.query("UPDATE direct_tickets SET payment_reference=NULL WHERE order_id=$1", [id]);
      await client.query("UPDATE direct_tickets SET payment_status=$1,payment_verified_by_user_id=$2,payment_verified_at=CURRENT_TIMESTAMP,rejection_reason=$3,status=$4,issued_at=CASE WHEN $4='issued' THEN CURRENT_TIMESTAMP ELSE issued_at END,voided_at=CASE WHEN $4='issued' THEN NULL ELSE CURRENT_TIMESTAMP END,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE order_id=$5", [input.payment_status,input.verified_by_user_id || null,input.rejection_reason || null,ticketStatus,id]);
      await client.query("UPDATE direct_tickets SET payment_reference=COALESCE($1,payment_reference) WHERE order_id=$2 AND id=(SELECT id FROM direct_tickets WHERE order_id=$2 ORDER BY created_at ASC, id ASC LIMIT 1)", [input.payment_reference || null,id]);
      await client.query("UPDATE direct_seats SET status=$1,updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT seat_id FROM direct_tickets WHERE order_id=$2)", [input.payment_status === "verified" ? "issued" : "available",id]);
      await client.query("UPDATE payment_attempts SET status=$1,transaction_reference=COALESCE($2,transaction_reference),updated_at=CURRENT_TIMESTAMP WHERE order_id=$3 AND attempt_number=(SELECT MAX(attempt_number) FROM payment_attempts WHERE order_id=$3)", [input.payment_status,input.payment_reference || null,id]);
      await client.query("COMMIT");
      return this.getDirectOrderById(id);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async releaseExpiredDirectOrderHolds(eventId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(`SELECT id FROM direct_orders WHERE status IN ('pending_payment','payment_submitted') AND hold_expires_at IS NOT NULL AND hold_expires_at<=CURRENT_TIMESTAMP ${eventId ? "AND event_id=$1" : ""} FOR UPDATE`, eventId ? [eventId] : []);
      for (const row of result.rows) {
        await client.query("UPDATE direct_orders SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.id]);
        await client.query("UPDATE direct_tickets SET status='voided',payment_status='expired',voided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1 AND status='held'", [row.id]);
        await client.query("UPDATE direct_seats SET status='available',updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT seat_id FROM direct_tickets WHERE order_id=$1) AND NOT EXISTS (SELECT 1 FROM direct_tickets other WHERE other.seat_id=direct_seats.id AND other.status IN ('held','issued','checked_in'))", [row.id]);
      }
      await client.query("COMMIT");
      return result.rowCount || 0;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async claimDirectOrderToCustomer(input: { order_id: string; customer_account_id: string; normalized_email?: string; normalized_phone?: string }) {
    const orderId = String(input.order_id || "").trim();
    const accountId = String(input.customer_account_id || "").trim();
    const result = await this.pool.query<{ customer_account_id: string | null; email: string; phone: string }>("SELECT customer_account_id,email,phone FROM direct_orders WHERE id=$1 LIMIT 1", [orderId]);
    const row = result.rows[0];
    if (!row) return "not_found" as const;
    if (row.customer_account_id && row.customer_account_id !== accountId) return "already_claimed" as const;
    const emailMatches = Boolean(input.normalized_email && String(row.email || "").trim().toLowerCase() === input.normalized_email.trim().toLowerCase());
    const phoneMatches = Boolean(input.normalized_phone && String(row.phone || "").replace(/\D/g, "") === input.normalized_phone.replace(/\D/g, ""));
    if (!emailMatches && !phoneMatches) return "contact_mismatch" as const;
    if (row.customer_account_id === accountId) return "already_claimed" as const;
    const updated = await this.pool.query("UPDATE direct_orders SET customer_account_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND customer_account_id IS NULL", [accountId,orderId]);
    await this.pool.query("UPDATE direct_tickets SET customer_account_id=$1 WHERE order_id=$2 AND customer_account_id IS NULL", [accountId,orderId]);
    return updated.rowCount > 0 ? "claimed" as const : "already_claimed" as const;
  }

  async unlinkDirectOrderFromCustomer(orderId: string, customerAccountId?: string | null) {
    const id = String(orderId || "").trim();
    const accountId = customerAccountId == null ? "" : String(customerAccountId).trim();
    const result = await this.pool.query(accountId
      ? "UPDATE direct_orders SET customer_account_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND customer_account_id = $2"
      : "UPDATE direct_orders SET customer_account_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND customer_account_id IS NOT NULL", accountId ? [id, accountId] : [id]);
    if ((result.rowCount || 0) > 0) await this.pool.query("UPDATE direct_tickets SET customer_account_id = NULL WHERE order_id = $1", [id]);
    return (result.rowCount || 0) > 0;
  }

  async updateDirectTicketPayment(id: string, input: { payment_status: "verified" | "rejected" | "refunded"; payment_reference?: string | null; verified_by_user_id?: string | null; rejection_reason?: string | null }) {
    const client=await this.pool.connect(); try { await client.query("BEGIN"); const current=await client.query<Record<string,unknown>>("SELECT * FROM direct_tickets WHERE id=$1 FOR UPDATE",[id]); const ticket=current.rows[0]; if(!ticket || (ticket.status!=="held" && input.payment_status!=="refunded")) { await client.query("ROLLBACK"); return this.getDirectTicketById(id); } const issued=input.payment_status==="verified"; await client.query(`UPDATE direct_tickets SET payment_status=$1,payment_reference=COALESCE($2,payment_reference),payment_verified_by_user_id=$3,payment_verified_at=CURRENT_TIMESTAMP,rejection_reason=$4,status=$5,issued_at=CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE issued_at END,voided_at=CASE WHEN $6 THEN NULL ELSE CURRENT_TIMESTAMP END,updated_at=CURRENT_TIMESTAMP WHERE id=$7`,[input.payment_status,input.payment_reference||null,input.verified_by_user_id||null,input.rejection_reason||null,issued?"issued":"voided",issued,id]); await client.query("UPDATE direct_seats SET status=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",[issued?"issued":"available",ticket.seat_id]); await client.query("COMMIT"); return this.getDirectTicketById(id); } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async submitDirectTicketPaymentProof(id: string, input: { payment_proof_mime: string; payment_proof_base64: string; payment_reference?: string | null }) {
    await this.releaseExpiredDirectTicketHolds();
    const result=await this.pool.query<Record<string,unknown>>(`UPDATE direct_tickets SET payment_status='proof_submitted',payment_proof_mime=$1,payment_proof_base64=$2,payment_proof_submitted_at=CURRENT_TIMESTAMP,payment_reference=$3,hold_expires_at=CURRENT_TIMESTAMP+INTERVAL '24 hours',updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND status='held' RETURNING id`,[input.payment_proof_mime,input.payment_proof_base64,input.payment_reference||null,id]);
    return result.rows[0] ? this.getDirectTicketById(id) : undefined;
  }

  async releaseExpiredDirectTicketHolds(eventId?: string) {
    const result=await this.pool.query(`WITH expired AS (UPDATE direct_tickets SET status='voided',payment_status='expired',voided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id IS NULL AND status='held' AND hold_expires_at IS NOT NULL AND hold_expires_at<=CURRENT_TIMESTAMP ${eventId ? "AND event_id=$1" : ""} RETURNING seat_id) UPDATE direct_seats SET status='available',updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT seat_id FROM expired)`,eventId?[eventId]:[]);
    return result.rowCount||0;
  }

  async voidDirectTicket(id: string, options?: { releaseSeat?: boolean }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<Record<string, unknown>>("SELECT * FROM direct_tickets WHERE id=$1 FOR UPDATE", [id]);
      const ticket = current.rows[0];
      if (!ticket) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query("UPDATE direct_tickets SET status='voided',voided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [id]);
      const replacement = await client.query("SELECT 1 FROM direct_tickets WHERE seat_id=$1 AND id<>$2 AND status IN ('held','issued','checked_in') LIMIT 1", [ticket.seat_id, id]);
      if (!replacement.rows[0]) await client.query("UPDATE direct_seats SET status=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [options?.releaseSeat === false ? "voided" : "available", ticket.seat_id]);
      await client.query("COMMIT");
      return this.getDirectTicketById(id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async reissueDirectTicket(id: string, issuedByUserId?: string | null) {
    const client=await this.pool.connect(); try { await client.query("BEGIN"); const current=await client.query<Record<string,unknown>>("SELECT * FROM direct_tickets WHERE id=$1 FOR UPDATE",[id]); const ticket=current.rows[0]; if(!ticket || !["issued","checked_in"].includes(String(ticket.status))) { await client.query("ROLLBACK"); return undefined; } const nextId=generateEntityId("dtkt"); await client.query("UPDATE direct_tickets SET status='voided',voided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1",[id]); await client.query(`INSERT INTO direct_tickets (id,event_id,order_id,customer_account_id,performance_id,seat_id,ticket_class,holder_name,buyer_name,phone,email,price_amount,payment_status,payment_reference,status,issued_by_user_id,payment_verified_by_user_id,payment_verified_at,issued_at,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'issued',$15,$16,$17,CURRENT_TIMESTAMP,$18)`,[nextId,ticket.event_id,ticket.order_id,ticket.customer_account_id,ticket.performance_id,ticket.seat_id,ticket.ticket_class,ticket.holder_name,ticket.buyer_name,ticket.phone,ticket.email,ticket.price_amount,ticket.payment_status,ticket.payment_reference,issuedByUserId||null,ticket.payment_verified_by_user_id,ticket.payment_verified_at,ticket.source]); await client.query("UPDATE direct_seats SET status='issued',updated_at=CURRENT_TIMESTAMP WHERE id=$1",[ticket.seat_id]); await client.query("COMMIT"); return this.getDirectTicketById(nextId); } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async checkInDirectTicket(id: string) { const ticket=await this.getDirectTicketById(id); if (!ticket) return { ticket: undefined, alreadyCheckedIn: false }; if (ticket.status === "checked_in") return { ticket, alreadyCheckedIn: true }; if (ticket.status !== "issued") return { ticket, alreadyCheckedIn: false }; await this.pool.query("UPDATE direct_tickets SET status='checked_in',checked_in_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1",[id]); return { ticket: await this.getDirectTicketById(id), alreadyCheckedIn: false }; }

  async saveMessage(senderId: string, text: string, type: MessageType, eventId?: string, pageId?: string) {
    const result = await this.pool.query<{ id: number }>(
      "INSERT INTO messages (sender_id, event_id, page_id, text, type) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [senderId, eventId || DEFAULT_EVENT_ID, pageId || null, text, type],
    );
    return Number(result.rows[0]?.id || 0);
  }

  async saveMessageAttachments(messageId: number, attachments: CreateMessageAttachmentInput[]) {
    const normalizedMessageId = Math.trunc(Number(messageId) || 0);
    if (normalizedMessageId <= 0 || !Array.isArray(attachments) || attachments.length === 0) {
      return [] as MessageAttachmentRow[];
    }

    const client = await this.pool.connect();
    const createdIds: string[] = [];
    try {
      await client.query("BEGIN");
      for (const attachment of attachments) {
        const url = String(attachment?.url || "").trim();
        if (!url) continue;
        const id = generateEntityId("msgatt");
        await client.query(
          `INSERT INTO message_attachments
             (id, message_id, kind, url, absolute_url, mime_type, name, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            normalizedMessageId,
            "image",
            url,
            attachment?.absolute_url == null ? null : String(attachment.absolute_url || "").trim() || null,
            attachment?.mime_type == null ? null : String(attachment.mime_type || "").trim() || null,
            attachment?.name == null ? null : String(attachment.name || "").trim() || null,
            Number.isFinite(Number(attachment?.size_bytes)) ? Math.max(0, Math.trunc(Number(attachment.size_bytes))) : null,
          ],
        );
        createdIds.push(id);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (createdIds.length === 0) {
      return [] as MessageAttachmentRow[];
    }

    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, message_id, kind, url, absolute_url, mime_type, name, size_bytes, created_at::text AS created_at
       FROM message_attachments
       WHERE message_id = $1 AND id = ANY($2::text[])
       ORDER BY created_at ASC, id ASC`,
      [normalizedMessageId, createdIds],
    );
    return result.rows.map(mapMessageAttachmentRow);
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

    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, message_id, kind, url, absolute_url, mime_type, name, size_bytes, created_at::text AS created_at
       FROM message_attachments
       WHERE message_id = ANY($1::int[])
       ORDER BY message_id ASC, created_at ASC, id ASC`,
      [normalizedIds],
    );
    return result.rows.map(mapMessageAttachmentRow);
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

  async getMessageHistoryRows(senderId: string, limit: number, eventId?: string, pageId?: string) {
    if (eventId) {
      if (pageId) {
        const result = await this.pool.query<{ text: string; type: MessageType }>(
          "SELECT text, type FROM messages WHERE sender_id = $1 AND event_id = $2 AND page_id = $3 ORDER BY timestamp DESC, id DESC LIMIT $4",
          [senderId, eventId, pageId, limit],
        );
        return result.rows;
      }
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

  async getConversationRowsForSender(senderId: string, limit: number, eventId?: string, pageId?: string) {
    if (eventId) {
      if (pageId) {
        const result = await this.pool.query<MessageRow>(
          "SELECT id, sender_id, event_id, page_id, text, timestamp::text AS timestamp, type FROM messages WHERE sender_id = $1 AND event_id = $2 AND page_id = $3 ORDER BY timestamp DESC, id DESC LIMIT $4",
          [senderId, eventId, pageId, limit],
        );
        return result.rows;
      }
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

  async listEvents(organizationId?: string) {
    const normalizedOrganizationId = String(organizationId || "").trim();
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
         e.id,
         e.name,
         e.slug,
         e.status,
         e.organizer_id,
         o.name AS organizer_name,
         e.is_default,
         e.created_at::text AS created_at,
         e.updated_at::text AS updated_at
       FROM events e
       LEFT JOIN organizations o ON o.id = e.organizer_id
       ${normalizedOrganizationId ? "WHERE e.organizer_id = $1" : ""}
       ORDER BY e.is_default DESC, e.created_at ASC`,
      normalizedOrganizationId ? [normalizedOrganizationId] : [],
    );
    return Promise.all(result.rows.map((row) => this.hydrateEventRow(row)));
  }

  async getEventById(eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT
         e.id,
         e.name,
         e.slug,
         e.status,
         e.organizer_id,
         o.name AS organizer_name,
         e.is_default,
         e.created_at::text AS created_at,
         e.updated_at::text AS updated_at
       FROM events e
       LEFT JOIN organizations o ON o.id = e.organizer_id
       WHERE e.id = $1`,
      [String(eventId || "").trim()],
    );
    return result.rows[0] ? this.hydrateEventRow(result.rows[0]) : undefined;
  }

  async createEvent(input: CreateEventInput) {
    const id = generateEntityId("evt");
    const baseName = String(input.name || "").trim() || "New Event";
    const slug = await this.uniqueEventSlug(baseName);
    const organizerId = String(input.organizer_id || DEFAULT_ORGANIZATION_ID).trim() || DEFAULT_ORGANIZATION_ID;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO events (id, name, slug, status, organizer_id, is_default)
         VALUES ($1, $2, $3, 'pending', $4, FALSE)`,
        [id, baseName, slug, organizerId],
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
    if (typeof input.organizer_id === "string" && input.organizer_id.trim()) {
      values.push(input.organizer_id.trim());
      updates.push(`organizer_id = $${values.length}`);
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

  async getOrganizerProfile(organizationId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
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
         created_at::text AS created_at,
         updated_at::text AS updated_at
       FROM organizations
       WHERE id = $1`,
      [String(organizationId || "").trim()],
    );
    return mapOrganizerProfileRow(result.rows[0]);
  }

  async updateOrganizerProfile(organizationId: string, input: UpdateOrganizerProfileInput) {
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE organizations
       SET legal_name = $2,
           public_display_name = $3,
           public_description = $4,
           public_logo_url = $5,
           public_website_url = $6,
           public_facebook_url = $7,
           public_line_url = $8,
           public_contact_text = $9,
           verification_status = $10,
           verification_notes = $11,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING
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
         created_at::text AS created_at,
         updated_at::text AS updated_at`,
      [
        String(organizationId || "").trim(),
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
      ],
    );
    return mapOrganizerProfileRow(result.rows[0]);
  }

  async listOrganizerProfiles(organizationId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, organization_id, name, slug, legal_name, public_display_name, public_description,
              public_logo_url, public_website_url, public_facebook_url, public_line_url,
              public_contact_text, verification_status, verification_notes,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM organizer_profiles
       WHERE organization_id = $1
       ORDER BY name ASC, created_at ASC`,
      [String(organizationId || "").trim()],
    );
    return result.rows.map((row) => mapOrganizerProfileRow(row)).filter((row): row is OrganizerProfileRow => Boolean(row));
  }

  async getOrganizerProfileById(organizerProfileId: string, organizationId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, organization_id, name, slug, legal_name, public_display_name, public_description,
              public_logo_url, public_website_url, public_facebook_url, public_line_url,
              public_contact_text, verification_status, verification_notes,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM organizer_profiles
       WHERE id = $1 AND organization_id = $2`,
      [String(organizerProfileId || "").trim(), String(organizationId || "").trim()],
    );
    return mapOrganizerProfileRow(result.rows[0]);
  }

  async createOrganizerProfile(organizationId: string, input: CreateOrganizerProfileInput) {
    const ownerId = String(organizationId || "").trim();
    const name = String(input.name || "").trim() || "New Organizer";
    const baseSlug = slugifyText(input.slug || name);
    const slugResult = await this.pool.query<{ slug: string }>(
      "SELECT slug FROM organizer_profiles WHERE organization_id = $1 AND (slug = $2 OR slug LIKE $3)",
      [ownerId, baseSlug, `${baseSlug}-%`],
    );
    const usedSlugs = new Set(slugResult.rows.map((row) => row.slug));
    let slug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const id = generateEntityId("orgp");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO organizer_profiles (
           id, organization_id, name, slug, legal_name, public_display_name, public_description,
           public_logo_url, public_website_url, public_facebook_url, public_line_url, public_contact_text,
           verification_status, verification_notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id, ownerId, name, slug,
          input.legal_name ?? null, input.public_display_name ?? null, input.public_description ?? null,
          input.public_logo_url ?? null, input.public_website_url ?? null, input.public_facebook_url ?? null,
          input.public_line_url ?? null, input.public_contact_text ?? null,
          input.verification_status ?? "draft", input.verification_notes ?? null,
        ],
      );
      await client.query("INSERT INTO organizer_financial_profiles (organizer_id) VALUES ($1) ON CONFLICT (organizer_id) DO NOTHING", [id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const profile = await this.getOrganizerProfileById(id, ownerId);
    if (!profile) throw new Error("Failed to create organizer profile");
    return profile;
  }

  async updateOrganizerProfileById(organizerProfileId: string, organizationId: string, input: UpdateOrganizerProfileInput & { name?: string; slug?: string }) {
    const profileId = String(organizerProfileId || "").trim();
    const ownerId = String(organizationId || "").trim();
    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof input.name === "string" && input.name.trim()) { values.push(input.name.trim()); updates.push(`name = $${values.length}`); }
    if (typeof input.slug === "string" && input.slug.trim()) { values.push(slugifyText(input.slug)); updates.push(`slug = $${values.length}`); }
    values.push(input.legal_name ?? null); updates.push(`legal_name = $${values.length}`);
    values.push(input.public_display_name ?? null); updates.push(`public_display_name = $${values.length}`);
    values.push(input.public_description ?? null); updates.push(`public_description = $${values.length}`);
    values.push(input.public_logo_url ?? null); updates.push(`public_logo_url = $${values.length}`);
    values.push(input.public_website_url ?? null); updates.push(`public_website_url = $${values.length}`);
    values.push(input.public_facebook_url ?? null); updates.push(`public_facebook_url = $${values.length}`);
    values.push(input.public_line_url ?? null); updates.push(`public_line_url = $${values.length}`);
    values.push(input.public_contact_text ?? null); updates.push(`public_contact_text = $${values.length}`);
    values.push(input.verification_status ?? "draft"); updates.push(`verification_status = $${values.length}`);
    values.push(input.verification_notes ?? null); updates.push(`verification_notes = $${values.length}`);
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(profileId, ownerId);
    const result = await this.pool.query(
      `UPDATE organizer_profiles SET ${updates.join(", ")} WHERE id = $${values.length - 1} AND organization_id = $${values.length}`,
      values,
    );
    if (!result.rowCount) return undefined;
    return this.getOrganizerProfileById(profileId, ownerId);
  }

  async getOrganizerFinancialProfile(organizationId: string) {
    const normalizedOrganizationId = String(organizationId || "").trim();
    if (!normalizedOrganizationId) return undefined;
    await this.pool.query("INSERT INTO organization_financial_profiles (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING", [normalizedOrganizationId]);
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM organization_financial_profiles WHERE organization_id = $1", [normalizedOrganizationId]);
    return mapOrganizerFinancialProfileRow(result.rows[0]);
  }

  async updateOrganizerFinancialProfile(organizationId: string, input: UpdateOrganizerFinancialProfileInput) {
    const current = await this.getOrganizerFinancialProfile(organizationId);
    if (!current) return undefined;
    const promptpayId = input.clear_promptpay_id ? null : input.promptpay_id === undefined ? current.promptpay_id : input.promptpay_id;
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE organization_financial_profiles
       SET payment_method = $2,
           promptpay_id = $3,
           promptpay_receiver_name = $4,
           payment_status = $5,
           legal_entity_type = $6,
           tax_id = $7,
           vat_status = $8,
           vat_rate_percent = $9,
           registered_address = $10,
           branch_number = $11,
           billing_document_mode = $12,
           platform_fee_type = $13,
           platform_fee_value = $14,
           platform_fee_payer = $15,
           payment_fee_value = $16,
           payout_mode = $17,
           payout_schedule = $18,
           payout_status = $19,
           pricing_policy_enabled = $20,
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1
       RETURNING *`,
      [
        current.organization_id,
        input.payment_method || current.payment_method,
        promptpayId,
        input.promptpay_receiver_name === undefined ? current.promptpay_receiver_name : input.promptpay_receiver_name,
        input.payment_status || current.payment_status,
        input.legal_entity_type || current.legal_entity_type,
        input.tax_id === undefined ? current.tax_id : input.tax_id,
        input.vat_status || current.vat_status,
        Number.isFinite(input.vat_rate_percent) ? input.vat_rate_percent : current.vat_rate_percent,
        input.registered_address === undefined ? current.registered_address : input.registered_address,
        input.branch_number === undefined ? current.branch_number : input.branch_number,
        input.billing_document_mode || current.billing_document_mode,
        input.platform_fee_type || current.platform_fee_type,
        Number.isFinite(input.platform_fee_value) ? input.platform_fee_value : current.platform_fee_value,
        input.platform_fee_payer || current.platform_fee_payer,
        Number.isFinite(input.payment_fee_value) ? input.payment_fee_value : current.payment_fee_value,
        input.payout_mode || current.payout_mode,
        input.payout_schedule || current.payout_schedule,
        input.payout_status || current.payout_status,
        input.pricing_policy_enabled === undefined ? current.pricing_policy_enabled : input.pricing_policy_enabled,
      ],
    );
    return mapOrganizerFinancialProfileRow(result.rows[0]);
  }

  async getOrganizerFinancialProfileByOrganizerId(organizerProfileId: string, organizationId: string) {
    const profile = await this.getOrganizerProfileById(organizerProfileId, organizationId);
    if (!profile) return undefined;
    await this.pool.query("INSERT INTO organizer_financial_profiles (organizer_id) VALUES ($1) ON CONFLICT (organizer_id) DO NOTHING", [profile.id]);
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT f.*, p.organization_id, p.id AS organizer_profile_id
       FROM organizer_financial_profiles f
       JOIN organizer_profiles p ON p.id = f.organizer_id
       WHERE f.organizer_id = $1 AND p.organization_id = $2`,
      [profile.id, profile.organization_id],
    );
    return mapOrganizerFinancialProfileRow(result.rows[0]);
  }

  async updateOrganizerFinancialProfileByOrganizerId(organizerProfileId: string, organizationId: string, input: UpdateOrganizerFinancialProfileInput) {
    const current = await this.getOrganizerFinancialProfileByOrganizerId(organizerProfileId, organizationId);
    if (!current || !current.organizer_profile_id) return undefined;
    const promptpayId = input.clear_promptpay_id ? null : input.promptpay_id === undefined ? current.promptpay_id : input.promptpay_id;
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE organizer_financial_profiles
       SET payment_method = $2, promptpay_id = $3, promptpay_receiver_name = $4, payment_status = $5,
           legal_entity_type = $6, tax_id = $7, vat_status = $8, vat_rate_percent = $9,
           registered_address = $10, branch_number = $11, billing_document_mode = $12,
           platform_fee_type = $13, platform_fee_value = $14, platform_fee_payer = $15,
           payment_fee_value = $16, payout_mode = $17, payout_schedule = $18, payout_status = $19,
           pricing_policy_enabled = $20, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE organizer_id = $1
       RETURNING *`,
      [
        current.organizer_profile_id,
        input.payment_method || current.payment_method,
        promptpayId,
        input.promptpay_receiver_name === undefined ? current.promptpay_receiver_name : input.promptpay_receiver_name,
        input.payment_status || current.payment_status,
        input.legal_entity_type || current.legal_entity_type,
        input.tax_id === undefined ? current.tax_id : input.tax_id,
        input.vat_status || current.vat_status,
        Number.isFinite(input.vat_rate_percent) ? input.vat_rate_percent : current.vat_rate_percent,
        input.registered_address === undefined ? current.registered_address : input.registered_address,
        input.branch_number === undefined ? current.branch_number : input.branch_number,
        input.billing_document_mode || current.billing_document_mode,
        input.platform_fee_type || current.platform_fee_type,
        Number.isFinite(input.platform_fee_value) ? input.platform_fee_value : current.platform_fee_value,
        input.platform_fee_payer || current.platform_fee_payer,
        Number.isFinite(input.payment_fee_value) ? input.payment_fee_value : current.payment_fee_value,
        input.payout_mode || current.payout_mode,
        input.payout_schedule || current.payout_schedule,
        input.payout_status || current.payout_status,
        input.pricing_policy_enabled === undefined ? current.pricing_policy_enabled : input.pricing_policy_enabled,
      ],
    );
    if (!result.rows[0]) return undefined;
    return this.getOrganizerFinancialProfileByOrganizerId(current.organizer_profile_id, organizationId);
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

  private async outreachCampaignQuery(where: string, params: unknown[]) {
    const result = await this.pool.query<Record<string, unknown>>(`
      SELECT c.*,
        COUNT(t.id)::int AS target_count,
        COUNT(t.id) FILTER (WHERE t.status = 'replied')::int AS needs_action_count,
        COUNT(t.id) FILTER (WHERE t.status IN ('new','drafted','approved'))::int AS not_contacted_count,
        COUNT(t.id) FILTER (WHERE t.status = 'waiting_reply')::int AS waiting_count,
        COUNT(t.id) FILTER (WHERE t.status = 'replied')::int AS replied_count,
        COUNT(t.id) FILTER (WHERE t.status = 'press_kit_sent')::int AS press_kit_sent_count,
        COUNT(t.id) FILTER (WHERE t.status = 'published')::int AS published_count,
        COUNT(t.id) FILTER (WHERE t.status = 'declined')::int AS declined_count,
        COUNT(t.id) FILTER (WHERE t.status = 'no_response')::int AS no_response_count,
        COUNT(t.id) FILTER (WHERE t.next_follow_up_at IS NOT NULL AND t.next_follow_up_at <= CURRENT_TIMESTAMP AND t.status NOT IN ('published', 'declined', 'no_response'))::int AS follow_up_due_count
      FROM outreach_campaigns c
      LEFT JOIN outreach_targets t ON t.campaign_id = c.id
      ${where}
      GROUP BY c.id
      ORDER BY c.updated_at DESC, c.id DESC
    `, params);
    return result.rows.map(mapOutreachCampaignRow);
  }

  async listOutreachCampaigns(eventId: string) {
    return this.outreachCampaignQuery("WHERE c.event_id = $1", [eventId]);
  }

  async getOutreachCampaign(id: string, eventId: string) {
    return (await this.outreachCampaignQuery("WHERE c.id = $1 AND c.event_id = $2", [id, eventId]))[0];
  }

  async createOutreachCampaign(input: CreateOutreachCampaignInput) {
    const id = generateEntityId("ocamp");
    await this.pool.query(`INSERT INTO outreach_campaigns (id,event_id,name,description,objective,context,default_instruction,start_date,end_date,status,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
      id, input.event_id, input.name.trim(), String(input.description || "").trim(), String(input.objective || "").trim(), String(input.context || "").trim(), String(input.default_instruction || "").trim(), input.start_date || null, input.end_date || null, input.status || "draft", input.created_by_user_id || null,
    ]);
    const campaign = await this.getOutreachCampaign(id, input.event_id);
    if (!campaign) throw new Error("Outreach campaign was not created");
    return campaign;
  }

  async updateOutreachCampaign(id: string, eventId: string, input: UpdateOutreachCampaignInput) {
    const result = await this.pool.query(`UPDATE outreach_campaigns SET name=$1,description=$2,objective=$3,context=$4,default_instruction=$5,start_date=$6,end_date=$7,status=$8,updated_at=CURRENT_TIMESTAMP WHERE id=$9 AND event_id=$10`, [
      input.name.trim(), String(input.description || "").trim(), String(input.objective || "").trim(), String(input.context || "").trim(), String(input.default_instruction || "").trim(), input.start_date || null, input.end_date || null, input.status, id, eventId,
    ]);
    return (result.rowCount || 0) > 0 ? this.getOutreachCampaign(id, eventId) : undefined;
  }

  async listOutreachTargets(eventId: string, campaignId: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM outreach_targets WHERE event_id = $1 AND campaign_id = $2 ORDER BY updated_at DESC, id DESC", [eventId, campaignId]);
    return result.rows.map(mapOutreachTargetRow);
  }

  async listOutreachTargetsForEvent(eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM outreach_targets WHERE event_id = $1 ORDER BY updated_at DESC, id DESC", [eventId]);
    return result.rows.map(mapOutreachTargetRow);
  }

  async getOutreachTarget(id: string, eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM outreach_targets WHERE id = $1 AND event_id = $2", [id, eventId]);
    return result.rows[0] ? mapOutreachTargetRow(result.rows[0]) : undefined;
  }

  async createOutreachTarget(input: CreateOutreachTargetInput) {
    const id = generateEntityId("otgt");
    await this.pool.query(`INSERT INTO outreach_targets (id,campaign_id,event_id,name,facebook_page_url,facebook_page_id,organization_type,contact_person,email,website,notes,priority,status,delivery_mode,next_follow_up_at,outcome_note,assigned_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
      id, input.campaign_id, input.event_id, input.name.trim(), String(input.facebook_page_url || "").trim(), String(input.facebook_page_id || "").trim() || null, String(input.organization_type || "other").trim(), String(input.contact_person || "").trim() || null, String(input.email || "").trim() || null, String(input.website || "").trim() || null, String(input.notes || "").trim(), input.priority || "normal", input.status || "new", input.delivery_mode || "manual_first_contact", input.next_follow_up_at || null, String(input.outcome_note || "").trim() || null,
      input.assigned_user_id || null,
    ]);
    const target = await this.getOutreachTarget(id, input.event_id);
    if (!target) throw new Error("Outreach target was not created");
    return target;
  }

  async updateOutreachTarget(id: string, eventId: string, input: UpdateOutreachTargetInput) {
    const result = await this.pool.query(`UPDATE outreach_targets SET name=$1,facebook_page_url=$2,facebook_page_id=$3,organization_type=$4,contact_person=$5,email=$6,website=$7,notes=$8,priority=$9,status=$10,delivery_mode=$11,next_follow_up_at=$12,outcome_note=$13,assigned_user_id=$14,last_contacted_at=CASE WHEN $10 IN ('contacted','waiting_reply') THEN COALESCE(last_contacted_at,CURRENT_TIMESTAMP) ELSE last_contacted_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$15 AND event_id=$16`, [
      input.name.trim(), String(input.facebook_page_url || "").trim(), String(input.facebook_page_id || "").trim() || null, String(input.organization_type || "other").trim(), String(input.contact_person || "").trim() || null, String(input.email || "").trim() || null, String(input.website || "").trim() || null, String(input.notes || "").trim(), input.priority, input.status, input.delivery_mode, input.next_follow_up_at || null, String(input.outcome_note || "").trim() || null, input.assigned_user_id || null, id, eventId,
    ]);
    return (result.rowCount || 0) > 0 ? this.getOutreachTarget(id, eventId) : undefined;
  }

  async deleteOutreachTarget(id: string, eventId: string) {
    const result = await this.pool.query("DELETE FROM outreach_targets WHERE id = $1 AND event_id = $2", [id, eventId]);
    return (result.rowCount || 0) > 0;
  }

  async bindOutreachTargetIdentity(id: string, eventId: string, pageId: string, senderId: string) {
    const result = await this.pool.query("UPDATE outreach_targets SET bound_page_id=$1,bound_sender_id=$2,delivery_mode='manual_only',updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND event_id=$4", [pageId.trim(), senderId.trim(), id, eventId]);
    return (result.rowCount || 0) > 0 ? this.getOutreachTarget(id, eventId) : undefined;
  }

  async findOutreachTargetIdentityMatches(pageId: string, senderId: string, eventIds: string[] = []) {
    const normalizedEventIds = eventIds.map((value) => String(value || "").trim()).filter(Boolean);
    const params: unknown[] = [pageId.trim(), senderId.trim()];
    const eventClause = normalizedEventIds.length > 0
      ? ` AND t.event_id IN (${normalizedEventIds.map((_, index) => `$${index + 3}`).join(",")})`
      : "";
    params.push(...normalizedEventIds);
    const result = await this.pool.query<Record<string, unknown>>(`
      SELECT t.*
      FROM outreach_targets t
      JOIN outreach_campaigns c ON c.id = t.campaign_id AND c.event_id = t.event_id
      WHERE t.bound_page_id = $1 AND t.bound_sender_id = $2
        AND c.status <> 'archived'
        AND t.status NOT IN ('declined','no_response')
        ${eventClause}
      ORDER BY t.updated_at DESC, t.id DESC
    `, params);
    return result.rows.map(mapOutreachTargetRow);
  }

  async markOutreachTargetReplied(id: string, eventId: string, repliedAt = new Date().toISOString()) {
    const result = await this.pool.query<Record<string, unknown>>(`UPDATE outreach_targets
      SET status='replied', delivery_mode='api_reply_eligible', last_replied_at=$1, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND event_id=$3
      RETURNING *`, [repliedAt, id, eventId]);
    return result.rows[0] ? mapOutreachTargetRow(result.rows[0]) : undefined;
  }

  async listOutreachDrafts(targetId: string, eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM outreach_drafts WHERE target_id = $1 AND event_id = $2 ORDER BY revision DESC", [targetId, eventId]);
    return result.rows.map(mapOutreachDraftRow);
  }

  async getOutreachDraft(id: string, eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM outreach_drafts WHERE id = $1 AND event_id = $2", [id, eventId]);
    return result.rows[0] ? mapOutreachDraftRow(result.rows[0]) : undefined;
  }

  async createOutreachDraft(input: CreateOutreachDraftInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query<Record<string, unknown>>("SELECT campaign_id FROM outreach_targets WHERE id=$1 AND event_id=$2 FOR UPDATE", [input.target_id, input.event_id]);
      if (!target.rows[0]) throw new Error("Outreach target was not found");
      const latest = await client.query<{ revision: number }>("SELECT COALESCE(MAX(revision),0)::int AS revision FROM outreach_drafts WHERE target_id=$1 AND event_id=$2", [input.target_id, input.event_id]);
      const id = generateEntityId("odrf");
      const revision = Number(latest.rows[0]?.revision || 0) + 1;
      const result = await client.query<Record<string, unknown>>("INSERT INTO outreach_drafts (id,target_id,campaign_id,event_id,revision,body,kind,source_message_id,approval_status,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) RETURNING *", [id, input.target_id, target.rows[0].campaign_id, input.event_id, revision, input.body.trim(), input.kind || "initial", input.source_message_id || null, input.created_by_user_id || null]);
      await client.query("COMMIT");
      return mapOutreachDraftRow(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async approveOutreachDraft(id: string, eventId: string, userId: string) {
    const result = await this.pool.query<Record<string, unknown>>("UPDATE outreach_drafts SET approval_status='approved',approved_by_user_id=$1,approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND event_id=$3 RETURNING *", [userId || null, id, eventId]);
    return result.rows[0] ? mapOutreachDraftRow(result.rows[0]) : undefined;
  }

  async listOutreachAssets(eventId: string, campaignId: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM outreach_assets WHERE event_id = $1 AND campaign_id = $2 ORDER BY is_active DESC, updated_at DESC, id DESC", [eventId, campaignId]);
    return result.rows.map(mapOutreachAssetRow);
  }

  async createOutreachAsset(input: CreateOutreachAssetInput) {
    const id = generateEntityId("oast");
    const result = await this.pool.query<Record<string, unknown>>("INSERT INTO outreach_assets (id,campaign_id,event_id,name,type,description,url,tags,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *", [id, input.campaign_id, input.event_id, input.name.trim(), String(input.type || "other").trim(), String(input.description || "").trim(), input.url.trim(), String(input.tags || "").trim(), input.is_active !== false]);
    return mapOutreachAssetRow(result.rows[0]);
  }

  async listOutreachDeliveries(targetId: string, eventId: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM outreach_deliveries WHERE target_id=$1 AND event_id=$2 ORDER BY created_at DESC, id DESC", [targetId, eventId]);
    return result.rows.map(mapOutreachDeliveryRow);
  }

  async getOutreachDeliveryByIdempotency(eventId: string, idempotencyKey: string) {
    const result = await this.pool.query<Record<string, unknown>>("SELECT * FROM outreach_deliveries WHERE event_id=$1 AND idempotency_key=$2", [eventId, idempotencyKey]);
    return result.rows[0] ? mapOutreachDeliveryRow(result.rows[0]) : undefined;
  }

  async createOutreachDelivery(input: CreateOutreachDeliveryInput) {
    const id = generateEntityId("odlv");
    const result = await this.pool.query<Record<string, unknown>>(`INSERT INTO outreach_deliveries (id,target_id,campaign_id,event_id,draft_id,asset_id,kind,channel_platform,channel_external_id,recipient_id,idempotency_key,status,external_message_id,error_message,sent_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [
      id, input.target_id, input.campaign_id, input.event_id, input.draft_id || null, input.asset_id || null, input.kind, input.channel_platform, input.channel_external_id.trim(), input.recipient_id.trim(), input.idempotency_key.trim(), input.status || "pending", input.external_message_id || null, input.error_message || null, input.sent_by_user_id || null,
    ]);
    return mapOutreachDeliveryRow(result.rows[0]);
  }

  async updateOutreachDelivery(id: string, eventId: string, input: Partial<Pick<OutreachDeliveryRow, "status" | "external_message_id" | "error_message" | "sent_by_user_id">>) {
    const status = input.status || "pending";
    const result = await this.pool.query<Record<string, unknown>>(`UPDATE outreach_deliveries
      SET status=$1, external_message_id=$2, error_message=$3, sent_by_user_id=$4,
          sent_at=CASE WHEN $1='sent' THEN COALESCE(sent_at,CURRENT_TIMESTAMP) ELSE sent_at END,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=$5 AND event_id=$6 RETURNING *`, [status, input.external_message_id || null, input.error_message || null, input.sent_by_user_id || null, id, eventId]);
    return result.rows[0] ? mapOutreachDeliveryRow(result.rows[0]) : undefined;
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
          sql: `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, ca.organizer_id, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
                FROM channel_accounts ca
                LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
                WHERE ca.platform = $1
                ORDER BY ca.created_at ASC`,
          values: [platform],
        }
      : {
          sql: `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, ca.organizer_id, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
                FROM channel_accounts ca
                LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
                ORDER BY ca.created_at ASC`,
          values: [] as unknown[],
        };
    const result = await this.pool.query<Record<string, unknown>>(query.sql, query.values);
    return collapseChannelRows(result.rows);
  }

  async getChannelAccount(platform: ChannelPlatform, externalId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ca.id, ca.platform, ca.external_id, ca.display_name, ca.organizer_id, cea.event_id, ca.access_token, ca.config_json, ca.is_active, ca.created_at::text AS created_at, ca.updated_at::text AS updated_at
       FROM channel_accounts ca
       LEFT JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       WHERE ca.platform = $1 AND ca.external_id = $2
       ORDER BY cea.created_at ASC`,
      [platform, String(externalId || "").trim()],
    );
    return collapseChannelRows(result.rows)[0];
  }

  async upsertChannelAccount(input: UpsertChannelAccountInput) {
    const platform = (String(input.platform || "facebook").trim() || "facebook") as ChannelPlatform;
    const externalId = String(input.external_id || "").trim();
    const displayName = String(input.display_name || "").trim() || externalId;
    const hasEventId = Object.prototype.hasOwnProperty.call(input, "event_id");
    const eventId = String(input.event_id || "").trim();
    const storageEventId = eventId || DEFAULT_EVENT_ID;
    const requestedOrganizerId = String(input.organizer_id || "").trim();
    const eventOrganizerResult = eventId
      ? await this.pool.query<{ organizer_id: string }>("SELECT organizer_id FROM events WHERE id = $1 LIMIT 1", [eventId])
      : undefined;
    const organizerId = requestedOrganizerId || eventOrganizerResult?.rows[0]?.organizer_id || DEFAULT_ORGANIZATION_ID;
    const accessToken = String(input.access_token || "").trim();
    const configJson = String(input.config_json || "{}").trim() || "{}";
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id FROM channel_accounts WHERE platform = $1 AND external_id = $2",
      [platform, externalId],
    );
    const id = existing.rows[0]?.id || generateEntityId("chn");

    await this.pool.query(
      `INSERT INTO channel_accounts (id, platform, external_id, display_name, organizer_id, event_id, access_token, config_json, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (platform, external_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           organizer_id = COALESCE(NULLIF(EXCLUDED.organizer_id, ''), channel_accounts.organizer_id),
           event_id = channel_accounts.event_id,
           access_token = COALESCE(NULLIF(EXCLUDED.access_token, ''), channel_accounts.access_token),
           config_json = EXCLUDED.config_json,
           is_active = EXCLUDED.is_active,
           updated_at = CURRENT_TIMESTAMP`,
      [id, platform, externalId, displayName, organizerId, storageEventId, accessToken, configJson, input.is_active === false ? false : true],
    );

    if (hasEventId) {
      if (eventId) {
        if (platform !== "facebook") {
          await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1", [id]);
        }
        await this.pool.query(
          `INSERT INTO channel_event_assignments (channel_id, event_id)
           VALUES ($1, $2)
           ON CONFLICT (channel_id, event_id) DO UPDATE
           SET updated_at = CURRENT_TIMESTAMP`,
          [id, eventId],
        );
      } else {
        await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1", [id]);
      }
    }

    const channel = await this.getChannelAccount(platform, externalId);
    if (!channel) throw new Error("Failed to upsert channel account");
    return channel;
  }

  async updateChannelAccount(originalPlatform: ChannelPlatform, originalExternalId: string, input: UpsertChannelAccountInput) {
    const sourcePlatform = (String(originalPlatform || "facebook").trim() || "facebook") as ChannelPlatform;
    const sourceExternalId = String(originalExternalId || "").trim();
    const originalResult = await this.pool.query<Record<string, unknown>>(
      "SELECT id, platform, external_id, display_name, organizer_id, event_id, access_token, config_json, is_active, created_at::text AS created_at, updated_at::text AS updated_at FROM channel_accounts WHERE platform = $1 AND external_id = $2 LIMIT 1",
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
    const requestedOrganizerId = String(input.organizer_id || "").trim();
    const eventOrganizerResult = eventId
      ? await this.pool.query<{ organizer_id: string }>("SELECT organizer_id FROM events WHERE id = $1 LIMIT 1", [eventId])
      : undefined;
    const organizerId = requestedOrganizerId || eventOrganizerResult?.rows[0]?.organizer_id || original.organizer_id || DEFAULT_ORGANIZATION_ID;
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
           organizer_id = $4,
           access_token = $5,
           config_json = $6,
           is_active = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING id, platform, external_id, display_name, organizer_id, access_token, config_json, is_active, created_at::text AS created_at, updated_at::text AS updated_at`,
      [platform, externalId, displayName, organizerId, accessToken, configJson, input.is_active === false ? false : true, original.id],
    );
    if (!result.rows[0]) throw new Error("Failed to update channel account");

    if (hasEventId) {
      if (eventId) {
        if (platform !== "facebook") {
          await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1", [original.id]);
        }
        await this.pool.query(
          `INSERT INTO channel_event_assignments (channel_id, event_id)
           VALUES ($1, $2)
           ON CONFLICT (channel_id, event_id) DO UPDATE
           SET updated_at = CURRENT_TIMESTAMP`,
          [original.id, eventId],
        );
      } else {
        await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1", [original.id]);
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
    const identityResult = await this.pool.query<{ platform: ChannelPlatform; external_id: string }>(
      "SELECT platform, external_id FROM channel_accounts WHERE id = $1 LIMIT 1",
      [normalizedChannelId],
    );
    const channelIdentity = identityResult.rows[0];
    if (!channelIdentity) return undefined;
    const eventOrganizerResult = await this.pool.query<{ organizer_id: string }>(
      "SELECT organizer_id FROM events WHERE id = $1 LIMIT 1",
      [normalizedEventId],
    );
    const eventOrganizerId = eventOrganizerResult.rows[0]?.organizer_id || DEFAULT_ORGANIZATION_ID;
    await this.pool.query(
      `UPDATE channel_accounts
       SET organizer_id = COALESCE(NULLIF(BTRIM(organizer_id), ''), $1),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [eventOrganizerId, normalizedChannelId],
    );
    if (channelIdentity.platform !== "facebook") {
      await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1", [normalizedChannelId]);
    }
    await this.pool.query(
      `INSERT INTO channel_event_assignments (channel_id, event_id)
       VALUES ($1, $2)
       ON CONFLICT (channel_id, event_id) DO UPDATE
       SET updated_at = CURRENT_TIMESTAMP`,
      [normalizedChannelId, normalizedEventId],
    );
    return this.getChannelAccount(channelIdentity.platform, channelIdentity.external_id);
  }

  async unassignChannelAccount(channelId: string, eventId?: string) {
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedChannelId) return undefined;
    const identityResult = await this.pool.query<{ platform: ChannelPlatform; external_id: string }>(
      "SELECT platform, external_id FROM channel_accounts WHERE id = $1 LIMIT 1",
      [normalizedChannelId],
    );
    const channelIdentity = identityResult.rows[0];
    if (!channelIdentity) return undefined;
    const normalizedEventId = String(eventId || "").trim();
    if (normalizedEventId) {
      await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1 AND event_id = $2", [normalizedChannelId, normalizedEventId]);
      await this.pool.query("DELETE FROM channel_sender_event_selections WHERE channel_id = $1 AND event_id = $2", [normalizedChannelId, normalizedEventId]);
    } else {
      await this.pool.query("DELETE FROM channel_event_assignments WHERE channel_id = $1", [normalizedChannelId]);
      await this.pool.query("DELETE FROM channel_sender_event_selections WHERE channel_id = $1", [normalizedChannelId]);
    }
    return this.getChannelAccount(channelIdentity.platform, channelIdentity.external_id);
  }

  async listEventIdsForChannel(platform: ChannelPlatform, externalId: string) {
    const result = await this.pool.query<{ event_id: string }>(
      `SELECT cea.event_id
       FROM channel_accounts ca
       JOIN channel_event_assignments cea ON cea.channel_id = ca.id
       JOIN events e ON e.id = cea.event_id
       WHERE ca.platform = $1 AND ca.external_id = $2 AND ca.is_active = TRUE
       ORDER BY e.created_at ASC`,
      [platform, String(externalId || "").trim()],
    );
    return result.rows.map((row) => row.event_id);
  }

  async getChannelSenderEventSelection(channelId: string, senderId: string) {
    const result = await this.pool.query<{ event_id: string }>(
      "SELECT event_id FROM channel_sender_event_selections WHERE channel_id = $1 AND sender_id = $2 LIMIT 1",
      [String(channelId || "").trim(), String(senderId || "").trim()],
    );
    return result.rows[0]?.event_id;
  }

  async setChannelSenderEventSelection(channelId: string, senderId: string, eventId?: string) {
    const normalizedChannelId = String(channelId || "").trim();
    const normalizedSenderId = String(senderId || "").trim();
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedChannelId || !normalizedSenderId) return;
    if (!normalizedEventId) {
      await this.pool.query(
        "DELETE FROM channel_sender_event_selections WHERE channel_id = $1 AND sender_id = $2",
        [normalizedChannelId, normalizedSenderId],
      );
      return;
    }
    await this.pool.query(
      `INSERT INTO channel_sender_event_selections (channel_id, sender_id, event_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (channel_id, sender_id) DO UPDATE
       SET event_id = EXCLUDED.event_id, updated_at = CURRENT_TIMESTAMP`,
      [normalizedChannelId, normalizedSenderId, normalizedEventId],
    );
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
    const eventId = result.rows[0]?.event_id;
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

  async getUserPreferences(userId: string) {
    const result = await this.pool.query<UserPreferencesRow>(
      "SELECT user_id, language, timezone, updated_at::text AS updated_at FROM user_preferences WHERE user_id = $1",
      [String(userId || "").trim()],
    );
    return result.rows[0];
  }

  async upsertUserPreferences(userId: string, input: { language: "th" | "en"; timezone: string }) {
    const result = await this.pool.query<UserPreferencesRow>(
      `INSERT INTO user_preferences (user_id, language, timezone, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET language = EXCLUDED.language, timezone = EXCLUDED.timezone, updated_at = CURRENT_TIMESTAMP
       RETURNING user_id, language, timezone, updated_at::text AS updated_at`,
      [String(userId || "").trim(), input.language, input.timezone],
    );
    const preferences = result.rows[0];
    if (!preferences) throw new Error("Failed to save user preferences");
    return preferences;
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
        JSON.stringify({ ...getSystemAuditMetadata(), ...(entry.metadata || {}) }),
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
      `INSERT INTO events (id, name, slug, status, organizer_id, is_default)
       VALUES ($1, $2, $3, 'active', $4, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_EVENT_ID, defaultName, "default-event", DEFAULT_ORGANIZATION_ID],
    );
    await this.pool.query(
      `UPDATE events
       SET name = $1,
           organizer_id = COALESCE(NULLIF(BTRIM(organizer_id), ''), $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [defaultName, DEFAULT_ORGANIZATION_ID, DEFAULT_EVENT_ID],
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
    await this.pool.query(
      "UPDATE events SET organizer_id = $1 WHERE organizer_id IS NULL OR BTRIM(organizer_id) = ''",
      [DEFAULT_ORGANIZATION_ID],
    );
  }

  private async ensureChannelAccountsBootstrap() {
    await this.pool.query(
      `INSERT INTO channel_accounts (id, platform, external_id, display_name, organizer_id, event_id, access_token, config_json, is_active, created_at, updated_at)
       SELECT fp.id, 'facebook', fp.page_id, fp.page_name, COALESCE(e.organizer_id, $1), fp.event_id, fp.page_access_token, '{}', fp.is_active, fp.created_at, fp.updated_at
       FROM facebook_pages fp
       LEFT JOIN events e ON e.id = fp.event_id
       ON CONFLICT (platform, external_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           organizer_id = COALESCE(NULLIF(EXCLUDED.organizer_id, ''), channel_accounts.organizer_id),
           event_id = EXCLUDED.event_id,
           access_token = COALESCE(NULLIF(EXCLUDED.access_token, ''), channel_accounts.access_token),
           is_active = EXCLUDED.is_active,
           updated_at = CURRENT_TIMESTAMP`,
      [DEFAULT_ORGANIZATION_ID],
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
       ON CONFLICT (channel_id, event_id) DO NOTHING`,
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
