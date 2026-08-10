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
  RegistrationInput,
  RegistrationEmailDeliveryRow,
  RegistrationResult,
  RegistrationRow,
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
    available_at: mapSqliteTimestamp(row.available_at),
    locked_at: typeof row.locked_at === "string" && row.locked_at ? mapSqliteTimestamp(row.locked_at) : null,
    locked_by: typeof row.locked_by === "string" && row.locked_by ? row.locked_by : null,
    provider: typeof row.provider === "string" && row.provider ? row.provider : null,
    provider_message_id: typeof row.provider_message_id === "string" && row.provider_message_id ? row.provider_message_id : null,
    last_error: typeof row.last_error === "string" && row.last_error ? row.last_error : null,
    queued_at: mapSqliteTimestamp(row.queued_at),
    sent_at: typeof row.sent_at === "string" && row.sent_at ? mapSqliteTimestamp(row.sent_at) : null,
    updated_at: mapSqliteTimestamp(row.updated_at),
  } satisfies NotificationDeliveryRow;
}

function mapCustomerAccountRow(row?: Record<string, unknown>) {
  if (!row) return undefined;
  return {
    id: String(row.id || ""),
    email: String(row.email || ""),
    normalized_email: String(row.normalized_email || ""),
    password_hash: String(row.password_hash || ""),
    email_verified_at: typeof row.email_verified_at === "string" && row.email_verified_at ? mapSqliteTimestamp(row.email_verified_at) : null,
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
    accepted_terms_at: mapSqliteTimestamp(row.accepted_terms_at),
    accepted_privacy_at: mapSqliteTimestamp(row.accepted_privacy_at),
    status: String(row.status || "pending") as CustomerAccountStatus,
    last_login_at: typeof row.last_login_at === "string" && row.last_login_at ? mapSqliteTimestamp(row.last_login_at) : null,
    created_at: mapSqliteTimestamp(row.created_at),
    updated_at: mapSqliteTimestamp(row.updated_at),
  } satisfies CustomerAccountRow;
}

function mapCustomerAccountTokenRow(row?: Record<string, unknown>) {
  if (!row) return undefined;
  return {
    id: String(row.id || ""),
    customer_account_id: String(row.customer_account_id || ""),
    kind: String(row.kind || "email_verification") as CustomerAccountTokenKind,
    expires_at: mapSqliteTimestamp(row.expires_at),
    created_at: mapSqliteTimestamp(row.created_at),
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
    pricing_policy_enabled: row.pricing_policy_enabled === true || Number(row.pricing_policy_enabled || 0) === 1,
    version: Number(row.version || 1),
    created_at: mapSqliteTimestamp(row.created_at),
    updated_at: mapSqliteTimestamp(row.updated_at),
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

function mapSqliteTimestamp(value: unknown) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
}

function mapDirectPerformanceRow(row: Record<string, unknown>) {
  return { id: String(row.id || ""), event_id: String(row.event_id || ""), code: String(row.code || ""), title: String(row.title || ""), starts_at: String(row.starts_at || ""), ends_at: typeof row.ends_at === "string" ? row.ends_at : null, seat_plan_image_url: typeof row.seat_plan_image_url === "string" ? row.seat_plan_image_url : null, is_active: Boolean(row.is_active), created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at) } satisfies DirectPerformanceRow;
}

function mapDirectSeatRow(row: Record<string, unknown>) {
  return { id: String(row.id || ""), event_id: String(row.event_id || ""), performance_id: String(row.performance_id || ""), zone: String(row.zone || ""), section_label: typeof row.section_label === "string" ? row.section_label : null, row_label: String(row.row_label || ""), seat_label: String(row.seat_label || ""), external_seat_ref: typeof row.external_seat_ref === "string" ? row.external_seat_ref : null, ticket_class: typeof row.ticket_class === "string" && row.ticket_class.trim() ? row.ticket_class : null, face_value: row.face_value == null ? null : Number(row.face_value), x: row.x == null ? null : Number(row.x), y: row.y == null ? null : Number(row.y), status: String(row.status || "available") as DirectSeatRow["status"], allocation_status: String(row.allocation_status || "allocated") as DirectSeatRow["allocation_status"], source_status: String(row.source_status || "unknown") as DirectSeatRow["source_status"], created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at) } satisfies DirectSeatRow;
}

function mapDirectTicketRow(row: Record<string, unknown>) {
  return { id: String(row.id || ""), event_id: String(row.event_id || ""), order_id: typeof row.order_id === "string" && row.order_id ? row.order_id : null, customer_account_id: typeof row.customer_account_id === "string" && row.customer_account_id ? row.customer_account_id : null, performance_id: String(row.performance_id || ""), seat_id: String(row.seat_id || ""), ticket_class: String(row.ticket_class || ""), holder_name: String(row.holder_name || ""), buyer_name: String(row.buyer_name || ""), phone: String(row.phone || ""), email: String(row.email || ""), price_amount: Number(row.price_amount || 0), payment_status: String(row.payment_status || "awaiting_payment") as DirectTicketRow["payment_status"], payment_reference: typeof row.payment_reference === "string" ? row.payment_reference : null, payment_proof_mime: typeof row.payment_proof_mime === "string" ? row.payment_proof_mime : null, payment_proof_base64: typeof row.payment_proof_base64 === "string" ? row.payment_proof_base64 : null, payment_proof_submitted_at: typeof row.payment_proof_submitted_at === "string" ? mapSqliteTimestamp(row.payment_proof_submitted_at) : null, rejection_reason: typeof row.rejection_reason === "string" ? row.rejection_reason : null, hold_expires_at: typeof row.hold_expires_at === "string" ? mapSqliteTimestamp(row.hold_expires_at) : null, source: row.source === "public" ? "public" : "admin", status: String(row.status || "held") as DirectTicketRow["status"], issued_by_user_id: typeof row.issued_by_user_id === "string" ? row.issued_by_user_id : null, payment_verified_by_user_id: typeof row.payment_verified_by_user_id === "string" ? row.payment_verified_by_user_id : null, payment_verified_at: typeof row.payment_verified_at === "string" ? mapSqliteTimestamp(row.payment_verified_at) : null, issued_at: typeof row.issued_at === "string" ? mapSqliteTimestamp(row.issued_at) : null, checked_in_at: typeof row.checked_in_at === "string" ? mapSqliteTimestamp(row.checked_in_at) : null, voided_at: typeof row.voided_at === "string" ? mapSqliteTimestamp(row.voided_at) : null, created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at), performance_code: typeof row.performance_code === "string" ? row.performance_code : undefined, performance_title: typeof row.performance_title === "string" ? row.performance_title : undefined, performance_starts_at: typeof row.performance_starts_at === "string" ? row.performance_starts_at : undefined, performance_ends_at: typeof row.performance_ends_at === "string" ? row.performance_ends_at : undefined, zone: typeof row.zone === "string" ? row.zone : undefined, row_label: typeof row.row_label === "string" ? row.row_label : undefined, seat_label: typeof row.seat_label === "string" ? row.seat_label : undefined } satisfies DirectTicketRow;
}

function mapDirectOrderRow(row: Record<string, unknown>, tickets: DirectTicketRow[] = []) {
  return {
    id: String(row.id || ""), event_id: String(row.event_id || ""), performance_id: String(row.performance_id || ""),
    customer_account_id: typeof row.customer_account_id === "string" && row.customer_account_id ? row.customer_account_id : null,
    buyer_name: String(row.buyer_name || ""), phone: String(row.phone || ""), email: String(row.email || ""),
    currency: String(row.currency || "THB"), subtotal_amount: Number(row.subtotal_amount || 0),
    platform_fee_amount: Number(row.platform_fee_amount || 0), payment_fee_amount: Number(row.payment_fee_amount || 0),
    tax_amount: Number(row.tax_amount || 0), discount_amount: Number(row.discount_amount || 0), total_amount: Number(row.total_amount || 0),
    fee_rule_version: String(row.fee_rule_version || "v1"), tax_snapshot_json: String(row.tax_snapshot_json || "{}"),
    billing_profile_json: String(row.billing_profile_json || "{}"), seller_snapshot_json: String(row.seller_snapshot_json || "{}"),
    seller_organization_id: typeof row.seller_organization_id === "string" && row.seller_organization_id ? row.seller_organization_id : null,
    payment_profile_version: Number(row.payment_profile_version || 1), payment_receiver_snapshot_json: String(row.payment_receiver_snapshot_json || "{}"),
    payout_status: String(row.payout_status || "not_applicable") as DirectOrderRow["payout_status"],
    status: String(row.status || "pending_payment") as DirectOrderRow["status"], payment_reference: typeof row.payment_reference === "string" ? row.payment_reference : null,
    payment_proof_mime: typeof row.payment_proof_mime === "string" ? row.payment_proof_mime : null,
    payment_proof_base64: typeof row.payment_proof_base64 === "string" ? row.payment_proof_base64 : null,
    payment_proof_submitted_at: typeof row.payment_proof_submitted_at === "string" ? mapSqliteTimestamp(row.payment_proof_submitted_at) : null,
    rejection_reason: typeof row.rejection_reason === "string" ? row.rejection_reason : null,
    hold_expires_at: typeof row.hold_expires_at === "string" ? mapSqliteTimestamp(row.hold_expires_at) : null,
    billing_document_status: String(row.billing_document_status || "not_required") as DirectOrderRow["billing_document_status"],
    billing_document_number: typeof row.billing_document_number === "string" ? row.billing_document_number : null,
    created_at: mapSqliteTimestamp(row.created_at), updated_at: mapSqliteTimestamp(row.updated_at), tickets,
    performance_code: typeof row.performance_code === "string" ? row.performance_code : undefined,
    performance_title: typeof row.performance_title === "string" ? row.performance_title : undefined,
    performance_starts_at: typeof row.performance_starts_at === "string" ? row.performance_starts_at : undefined,
    performance_ends_at: typeof row.performance_ends_at === "string" ? row.performance_ends_at : undefined,
  } satisfies DirectOrderRow;
}

function mapCustomerNotificationPreferencesRow(row: Record<string, unknown> | undefined, customerAccountId: string) {
  return {
    customer_account_id: customerAccountId,
    email_transactional_enabled: Boolean(row?.email_transactional_enabled ?? 1),
    sms_transactional_enabled: Boolean(row?.sms_transactional_enabled ?? 0),
    sms_marketing_enabled: Boolean(row?.sms_marketing_enabled ?? 0),
    sms_consent_at: typeof row?.sms_consent_at === "string" ? mapSqliteTimestamp(row.sms_consent_at) : null,
    sms_opted_out_at: typeof row?.sms_opted_out_at === "string" ? mapSqliteTimestamp(row.sms_opted_out_at) : null,
    updated_at: mapSqliteTimestamp(row?.updated_at),
  } satisfies CustomerNotificationPreferencesRow;
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
        channel_platform TEXT,
        channel_external_id TEXT,
        customer_account_id TEXT,
        sms_opt_in_at DATETIME,
        sms_opt_out_at DATETIME,
        sms_consent_source TEXT,
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
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
        kind TEXT NOT NULL,
        recipient TEXT NOT NULL,
        recipient_snapshot TEXT,
        related_type TEXT,
        related_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        locked_at DATETIME,
        locked_by TEXT,
        provider TEXT,
        provider_message_id TEXT,
        last_error TEXT,
        queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      CREATE TABLE IF NOT EXISTS organizer_profiles (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, slug),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS organizer_financial_profiles (
        organizer_id TEXT PRIMARY KEY,
        payment_method TEXT NOT NULL DEFAULT 'promptpay',
        promptpay_id TEXT,
        promptpay_receiver_name TEXT,
        payment_status TEXT NOT NULL DEFAULT 'draft',
        legal_entity_type TEXT NOT NULL DEFAULT 'individual',
        tax_id TEXT,
        vat_status TEXT NOT NULL DEFAULT 'unknown',
        vat_rate_percent REAL NOT NULL DEFAULT 0,
        registered_address TEXT,
        branch_number TEXT,
        billing_document_mode TEXT NOT NULL DEFAULT 'not_required',
        platform_fee_type TEXT NOT NULL DEFAULT 'percent',
        platform_fee_value REAL NOT NULL DEFAULT 0,
        platform_fee_payer TEXT NOT NULL DEFAULT 'customer',
        payment_fee_value REAL NOT NULL DEFAULT 0,
        payout_mode TEXT NOT NULL DEFAULT 'direct_to_organizer',
        payout_schedule TEXT NOT NULL DEFAULT 'manual',
        payout_status TEXT NOT NULL DEFAULT 'not_applicable',
        pricing_policy_enabled INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organizer_id) REFERENCES organizer_profiles(id) ON DELETE CASCADE
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
      CREATE TABLE IF NOT EXISTS customer_accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        normalized_email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified_at DATETIME,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        normalized_phone TEXT NOT NULL DEFAULT '',
        address_line1 TEXT,
        address_line2 TEXT,
        district TEXT,
        subdistrict TEXT,
        province TEXT,
        postal_code TEXT,
        country TEXT,
        accepted_terms_at DATETIME NOT NULL,
        accepted_privacy_at DATETIME NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
        last_login_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS customer_sessions (
        id TEXT PRIMARY KEY,
        customer_account_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS customer_account_tokens (
        id TEXT PRIMARY KEY,
        customer_account_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('email_verification', 'password_reset')),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        used_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS customer_notification_preferences (
        customer_account_id TEXT PRIMARY KEY,
        email_transactional_enabled INTEGER NOT NULL DEFAULT 1,
        sms_transactional_enabled INTEGER NOT NULL DEFAULT 0,
        sms_marketing_enabled INTEGER NOT NULL DEFAULT 0,
        sms_consent_at DATETIME,
        sms_opted_out_at DATETIME,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
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
        row_label TEXT NOT NULL, seat_label TEXT NOT NULL, section_label TEXT, external_seat_ref TEXT, ticket_class TEXT, face_value REAL,
        x REAL, y REAL, status TEXT NOT NULL DEFAULT 'available', allocation_status TEXT NOT NULL DEFAULT 'allocated',
        source_status TEXT NOT NULL DEFAULT 'unknown', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE (performance_id, zone, row_label, seat_label),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (performance_id) REFERENCES event_performances(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS direct_tickets (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL, performance_id TEXT NOT NULL, seat_id TEXT NOT NULL,
        order_id TEXT, customer_account_id TEXT,
        ticket_class TEXT NOT NULL, holder_name TEXT NOT NULL DEFAULT '', buyer_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', price_amount REAL NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL, payment_reference TEXT, status TEXT NOT NULL, issued_by_user_id TEXT,
        payment_verified_by_user_id TEXT, payment_verified_at DATETIME, issued_at DATETIME, checked_in_at DATETIME,
        voided_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (performance_id) REFERENCES event_performances(id) ON DELETE RESTRICT,
        FOREIGN KEY (seat_id) REFERENCES direct_seats(id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS direct_orders (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL, performance_id TEXT NOT NULL, customer_account_id TEXT,
        buyer_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT 'THB', subtotal_amount REAL NOT NULL DEFAULT 0,
        platform_fee_amount REAL NOT NULL DEFAULT 0, payment_fee_amount REAL NOT NULL DEFAULT 0,
        tax_amount REAL NOT NULL DEFAULT 0, discount_amount REAL NOT NULL DEFAULT 0, total_amount REAL NOT NULL DEFAULT 0,
        fee_rule_version TEXT NOT NULL DEFAULT 'v1', tax_snapshot_json TEXT NOT NULL DEFAULT '{}',
        billing_profile_json TEXT NOT NULL DEFAULT '{}', seller_snapshot_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending_payment', payment_reference TEXT, payment_proof_mime TEXT,
        payment_proof_base64 TEXT, payment_proof_submitted_at DATETIME, rejection_reason TEXT,
        hold_expires_at DATETIME, billing_document_status TEXT NOT NULL DEFAULT 'not_required',
        billing_document_number TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (performance_id) REFERENCES event_performances(id) ON DELETE RESTRICT,
        FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS payment_attempts (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL, attempt_number INTEGER NOT NULL DEFAULT 1,
        method TEXT NOT NULL DEFAULT 'promptpay', amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending', transaction_reference TEXT, proof_mime TEXT,
        proof_base64 TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (order_id, attempt_number),
        FOREIGN KEY (order_id) REFERENCES direct_orders(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS organization_financial_profiles (
        organization_id TEXT PRIMARY KEY,
        payment_method TEXT NOT NULL DEFAULT 'promptpay',
        promptpay_id TEXT,
        promptpay_receiver_name TEXT,
        payment_status TEXT NOT NULL DEFAULT 'draft',
        legal_entity_type TEXT NOT NULL DEFAULT 'individual',
        tax_id TEXT,
        vat_status TEXT NOT NULL DEFAULT 'unknown',
        vat_rate_percent REAL NOT NULL DEFAULT 0,
        registered_address TEXT,
        branch_number TEXT,
        billing_document_mode TEXT NOT NULL DEFAULT 'not_required',
        platform_fee_type TEXT NOT NULL DEFAULT 'percent',
        platform_fee_value REAL NOT NULL DEFAULT 0,
        platform_fee_payer TEXT NOT NULL DEFAULT 'customer',
        payment_fee_value REAL NOT NULL DEFAULT 0,
        payout_mode TEXT NOT NULL DEFAULT 'direct_to_organizer',
        payout_schedule TEXT NOT NULL DEFAULT 'manual',
        payout_status TEXT NOT NULL DEFAULT 'not_applicable',
        pricing_policy_enabled INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
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
      CREATE INDEX IF NOT EXISTS idx_customer_sessions_token_hash ON customer_sessions (token_hash);
      CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires_at ON customer_sessions (expires_at);
      CREATE INDEX IF NOT EXISTS idx_customer_account_tokens_token_hash ON customer_account_tokens (token_hash);
      CREATE INDEX IF NOT EXISTS idx_customer_account_tokens_account_kind ON customer_account_tokens (customer_account_id, kind, created_at DESC);
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
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_claim
        ON notification_deliveries (status, available_at, queued_at);
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_related
        ON notification_deliveries (related_type, related_id, queued_at DESC);
      CREATE INDEX IF NOT EXISTS idx_customer_notification_preferences_sms
        ON customer_notification_preferences (sms_transactional_enabled, sms_marketing_enabled);
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
    this.ensureColumn("registrations", "channel_platform", "TEXT");
    this.ensureColumn("registrations", "channel_external_id", "TEXT");
    this.ensureColumn("registrations", "customer_account_id", "TEXT");
    this.ensureColumn("registrations", "sms_opt_in_at", "DATETIME");
    this.ensureColumn("registrations", "sms_opt_out_at", "DATETIME");
    this.ensureColumn("registrations", "sms_consent_source", "TEXT");
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
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_organizer_profiles_organization
        ON organizer_profiles (organization_id, name);
      CREATE INDEX IF NOT EXISTS idx_organizer_financial_profiles_payment_status
        ON organizer_financial_profiles (payment_status);
      INSERT OR IGNORE INTO organizer_profiles (
        id, organization_id, name, slug, legal_name, public_display_name, public_description,
        public_logo_url, public_website_url, public_facebook_url, public_line_url, public_contact_text,
        verification_status, verification_notes
      )
      SELECT
        'orgprof_' || o.id, o.id, o.name, o.slug, o.legal_name, o.public_display_name,
        o.public_description, o.public_logo_url, o.public_website_url, o.public_facebook_url,
        o.public_line_url, o.public_contact_text,
        COALESCE(NULLIF(TRIM(o.verification_status), ''), 'draft'), o.verification_notes
      FROM organizations o;
      INSERT OR IGNORE INTO organizer_financial_profiles (
        organizer_id, payment_method, promptpay_id, promptpay_receiver_name, payment_status,
        legal_entity_type, tax_id, vat_status, vat_rate_percent, registered_address, branch_number,
        billing_document_mode, platform_fee_type, platform_fee_value, platform_fee_payer,
        payment_fee_value, payout_mode, payout_schedule, payout_status, pricing_policy_enabled, version
      )
      SELECT
        p.id, COALESCE(f.payment_method, 'promptpay'), f.promptpay_id, f.promptpay_receiver_name,
        COALESCE(f.payment_status, 'draft'), COALESCE(f.legal_entity_type, 'individual'), f.tax_id,
        COALESCE(f.vat_status, 'unknown'), COALESCE(f.vat_rate_percent, 0), f.registered_address,
        f.branch_number, COALESCE(f.billing_document_mode, 'not_required'),
        COALESCE(f.platform_fee_type, 'percent'), COALESCE(f.platform_fee_value, 0),
        COALESCE(f.platform_fee_payer, 'customer'), COALESCE(f.payment_fee_value, 0),
        COALESCE(f.payout_mode, 'direct_to_organizer'), COALESCE(f.payout_schedule, 'manual'),
        COALESCE(f.payout_status, 'not_applicable'), COALESCE(f.pricing_policy_enabled, 0),
        COALESCE(f.version, 1)
      FROM organizer_profiles p
      LEFT JOIN organization_financial_profiles f ON f.organization_id = p.organization_id;
    `);
    this.ensureColumn("checkin_sessions", "exchanged_at", "DATETIME");
    this.ensureColumn("event_performances", "seat_plan_image_url", "TEXT");
    this.ensureColumn("direct_seats", "allocation_status", "TEXT NOT NULL DEFAULT 'allocated'");
    this.ensureColumn("direct_seats", "source_status", "TEXT NOT NULL DEFAULT 'unknown'");
    this.ensureColumn("direct_seats", "section_label", "TEXT");
    this.ensureColumn("direct_seats", "ticket_class", "TEXT");
    this.ensureColumn("direct_tickets", "hold_expires_at", "DATETIME");
    this.ensureColumn("direct_tickets", "payment_proof_mime", "TEXT");
    this.ensureColumn("direct_tickets", "payment_proof_base64", "TEXT");
    this.ensureColumn("direct_tickets", "payment_proof_submitted_at", "DATETIME");
    this.ensureColumn("direct_tickets", "rejection_reason", "TEXT");
    this.ensureColumn("direct_tickets", "source", "TEXT NOT NULL DEFAULT 'admin'");
    this.ensureColumn("direct_tickets", "order_id", "TEXT");
    this.ensureColumn("direct_tickets", "customer_account_id", "TEXT");
    this.ensureColumn("direct_orders", "customer_account_id", "TEXT");
    this.ensureColumn("direct_orders", "seller_organization_id", "TEXT");
    this.ensureColumn("direct_orders", "payment_profile_version", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("direct_orders", "payment_receiver_snapshot_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("direct_orders", "payout_status", "TEXT NOT NULL DEFAULT 'not_applicable'");
    this.ensureColumn("payment_attempts", "receiver_snapshot_json", "TEXT NOT NULL DEFAULT '{}'");
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
      CREATE INDEX IF NOT EXISTS idx_registrations_customer_account
        ON registrations (customer_account_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_direct_orders_customer
        ON direct_orders (customer_account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_direct_orders_event_status
        ON direct_orders (event_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_direct_tickets_order
        ON direct_tickets (order_id);
      CREATE INDEX IF NOT EXISTS idx_direct_orders_seller_organization
        ON direct_orders (seller_organization_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_organization_financial_profiles_payment_status
        ON organization_financial_profiles (payment_status);

      UPDATE direct_tickets
      SET payment_status = 'awaiting_payment'
      WHERE payment_status = 'pending';

      UPDATE events
      SET organizer_id = '${DEFAULT_ORGANIZATION_ID}'
      WHERE organizer_id IS NULL OR TRIM(organizer_id) = '';

      UPDATE direct_orders
      SET seller_organization_id = (
        SELECT organizer_id FROM events WHERE events.id = direct_orders.event_id
      )
      WHERE seller_organization_id IS NULL OR TRIM(seller_organization_id) = '';

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
    await this.getOrganizerFinancialProfile(DEFAULT_ORGANIZATION_ID);
    await this.ensureDefaultOrganizerDirectory();
    await this.ensureDefaultEvent();
    await this.bootstrapChannelAccounts();
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
      "SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at, sms_opt_out_at, sms_consent_source, first_name, last_name, phone, email, timestamp, status FROM registrations WHERE id = ?",
    ).get(id) as RegistrationRow | undefined;
  }

  async listRegistrations(limit?: number, eventId?: string) {
    if (typeof limit === "number" && eventId) {
      return this.db.prepare(
        "SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at, sms_opt_out_at, sms_consent_source, first_name, last_name, phone, email, timestamp, status FROM registrations WHERE event_id = ? ORDER BY timestamp DESC LIMIT ?",
      ).all(eventId, limit) as RegistrationRow[];
    }
    if (eventId) {
      return this.db.prepare(
        "SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at, sms_opt_out_at, sms_consent_source, first_name, last_name, phone, email, timestamp, status FROM registrations WHERE event_id = ? ORDER BY timestamp DESC",
      ).all(eventId) as RegistrationRow[];
    }
    if (typeof limit === "number") {
      return this.db.prepare(
        "SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at, sms_opt_out_at, sms_consent_source, first_name, last_name, phone, email, timestamp, status FROM registrations ORDER BY timestamp DESC LIMIT ?",
      ).all(limit) as RegistrationRow[];
    }
    return this.db.prepare(
      "SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at, sms_opt_out_at, sms_consent_source, first_name, last_name, phone, email, timestamp, status FROM registrations ORDER BY timestamp DESC",
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
        `SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at, sms_opt_out_at, sms_consent_source, first_name, last_name, phone, email, timestamp, status
         FROM registrations
         WHERE event_id = ? AND sender_id IN (${placeholders})
         ORDER BY timestamp DESC, id DESC`,
      );
      return statement.all(eventId, ...normalizedSenderIds) as RegistrationRow[];
    }

    const statement = this.db.prepare(
      `SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at, sms_opt_out_at, sms_consent_source, first_name, last_name, phone, email, timestamp, status
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
          `INSERT INTO registrations (id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, first_name, last_name, phone, email)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, senderId, eventId, input.customer_account_id || null, channelPlatform, channelExternalId, firstName, lastName, phone, email);
        return { statusCode: 200, content: { id, status: "success" } };
      } catch (error: any) {
        if (String(error?.message || "").includes("UNIQUE")) continue;
        throw error;
      }
    }

    return { statusCode: 500, content: { error: "Failed to generate unique registration ID" } };
  }

  async setRegistrationSmsConsent(id: string, optedIn: boolean, source: string) {
    const result = optedIn
      ? this.db.prepare("UPDATE registrations SET sms_opt_in_at=CURRENT_TIMESTAMP, sms_opt_out_at=NULL, sms_consent_source=? WHERE id=?").run(source, id)
      : this.db.prepare("UPDATE registrations SET sms_opt_out_at=CURRENT_TIMESTAMP, sms_consent_source=? WHERE id=?").run(source, id);
    return result.changes > 0;
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

  async enqueueNotificationDelivery(input: CreateNotificationDeliveryInput) {
    const channel = String(input.channel || "").trim();
    const kind = String(input.kind || "").trim();
    const recipient = String(input.recipient || "").trim();
    const idempotencyKey = String(input.idempotency_key || "").trim();
    if (!channel || !kind || !recipient || !idempotencyKey) return null;

    const id = generateEntityId("ntf");
    const result = this.db.prepare(
      `INSERT OR IGNORE INTO notification_deliveries (
        id, channel, kind, recipient, recipient_snapshot, related_type, related_id,
        payload_json, idempotency_key, provider
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      channel,
      kind,
      recipient,
      input.recipient_snapshot == null ? null : String(input.recipient_snapshot),
      input.related_type == null ? null : String(input.related_type).trim() || null,
      input.related_id == null ? null : String(input.related_id).trim() || null,
      String(input.payload_json || "{}").trim() || "{}",
      idempotencyKey,
      input.provider == null ? null : String(input.provider).trim() || null,
    );
    if (!result.changes) return null;

    const row = this.db.prepare(
      `SELECT id, channel, kind, recipient, recipient_snapshot, related_type, related_id,
              payload_json, idempotency_key, status, attempt_count, available_at, locked_at,
              locked_by, provider, provider_message_id, last_error, queued_at, sent_at, updated_at
       FROM notification_deliveries
       WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;

    return mapNotificationDeliveryRow(row);
  }

  async listNotificationDeliveries(options: { related_type?: string; related_id?: string; kind?: string; limit?: number } = {}) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const relatedType = String(options.related_type || "").trim();
    const relatedId = String(options.related_id || "").trim();
    const kind = String(options.kind || "").trim();
    if (relatedType) {
      clauses.push("related_type = ?");
      params.push(relatedType);
    }
    if (relatedId) {
      clauses.push("related_id = ?");
      params.push(relatedId);
    }
    if (kind) {
      clauses.push("kind = ?");
      params.push(kind);
    }
    const limit = Math.min(Math.max(Number.parseInt(String(options.limit ?? 200), 10) || 200, 1), 1000);
    params.push(limit);
    const rows = this.db.prepare(
      `SELECT * FROM notification_deliveries
       ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY queued_at DESC, id DESC LIMIT ?`,
    ).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => mapNotificationDeliveryRow(row)).filter((row): row is NotificationDeliveryRow => Boolean(row));
  }

  async claimNotificationDeliveries(workerId: string, limit = 10) {
    const normalizedWorkerId = String(workerId || "").trim();
    const normalizedLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 10, 1), 100);
    if (!normalizedWorkerId) return [];

    const claim = this.db.transaction(() => {
      const candidates = this.db.prepare(
        `SELECT id
         FROM notification_deliveries
         WHERE (status = 'queued' AND datetime(available_at) <= CURRENT_TIMESTAMP)
            OR (status = 'processing' AND locked_at IS NOT NULL AND datetime(locked_at) <= datetime('now', '-5 minutes'))
         ORDER BY datetime(available_at) ASC, datetime(queued_at) ASC, id ASC
         LIMIT ?`,
      ).all(normalizedLimit) as Array<{ id: string }>;
      const update = this.db.prepare(
        `UPDATE notification_deliveries
         SET status = 'processing',
             attempt_count = attempt_count + 1,
             locked_at = CURRENT_TIMESTAMP,
             locked_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND ((status = 'queued' AND datetime(available_at) <= CURRENT_TIMESTAMP)
             OR (status = 'processing' AND locked_at IS NOT NULL AND datetime(locked_at) <= datetime('now', '-5 minutes')))`,
      );
      const select = this.db.prepare(
        `SELECT id, channel, kind, recipient, recipient_snapshot, related_type, related_id,
                payload_json, idempotency_key, status, attempt_count, available_at, locked_at,
                locked_by, provider, provider_message_id, last_error, queued_at, sent_at, updated_at
         FROM notification_deliveries
         WHERE id = ?`,
      );
      const claimed: NotificationDeliveryRow[] = [];
      for (const candidate of candidates) {
        if (!update.run(normalizedWorkerId, candidate.id).changes) continue;
        const row = select.get(candidate.id) as Record<string, unknown> | undefined;
        const mapped = mapNotificationDeliveryRow(row);
        if (mapped) claimed.push(mapped);
      }
      return claimed;
    });

    return claim() as NotificationDeliveryRow[];
  }

  async markNotificationDeliverySent(id: string, workerId: string, providerMessageId?: string | null, provider?: string | null) {
    this.db.prepare(
      `UPDATE notification_deliveries
       SET status = 'sent',
           provider = COALESCE(?, provider),
           provider_message_id = COALESCE(?, provider_message_id),
           last_error = NULL,
           sent_at = CURRENT_TIMESTAMP,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'processing' AND locked_by = ?`,
    ).run(
      provider == null ? null : String(provider).trim() || null,
      providerMessageId == null ? null : String(providerMessageId).trim() || null,
      String(id || "").trim(),
      String(workerId || "").trim(),
    );
  }

  async markNotificationDeliveryRetryable(id: string, workerId: string, errorMessage: string, availableAt: string, provider?: string | null) {
    this.db.prepare(
      `UPDATE notification_deliveries
       SET status = 'queued',
           available_at = ?,
           provider = COALESCE(?, provider),
           last_error = ?,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'processing' AND locked_by = ?`,
    ).run(
      String(availableAt || "").trim() || new Date().toISOString(),
      provider == null ? null : String(provider).trim() || null,
      String(errorMessage || "").trim().slice(0, 1000),
      String(id || "").trim(),
      String(workerId || "").trim(),
    );
  }

  async markNotificationDeliveryFailed(id: string, workerId: string, errorMessage: string, provider?: string | null) {
    this.db.prepare(
      `UPDATE notification_deliveries
       SET status = 'failed',
           provider = COALESCE(?, provider),
           last_error = ?,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'processing' AND locked_by = ?`,
    ).run(
      provider == null ? null : String(provider).trim() || null,
      String(errorMessage || "").trim().slice(0, 1000),
      String(id || "").trim(),
      String(workerId || "").trim(),
    );
  }

  async getCustomerAccountById(id: string) {
    const row = this.db.prepare("SELECT * FROM customer_accounts WHERE id = ? LIMIT 1").get(String(id || "").trim()) as Record<string, unknown> | undefined;
    return mapCustomerAccountRow(row);
  }

  async getCustomerAccountByNormalizedEmail(normalizedEmail: string) {
    const row = this.db.prepare("SELECT * FROM customer_accounts WHERE normalized_email = ? LIMIT 1").get(String(normalizedEmail || "").trim()) as Record<string, unknown> | undefined;
    return mapCustomerAccountRow(row);
  }

  async listCustomerAccounts(limit = 200) {
    const normalizedLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 200, 1), 1000);
    const rows = this.db.prepare(
      "SELECT * FROM customer_accounts ORDER BY created_at DESC, id DESC LIMIT ?",
    ).all(normalizedLimit) as Array<Record<string, unknown>>;
    return rows.map((row) => mapCustomerAccountRow(row)).filter((row): row is CustomerAccountRow => Boolean(row));
  }

  async createCustomerAccount(input: CreateCustomerAccountInput) {
    const id = generateEntityId("cst");
    this.db.prepare(
      `INSERT INTO customer_accounts (
        id, email, normalized_email, password_hash, first_name, last_name, phone,
        normalized_phone, accepted_terms_at, accepted_privacy_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
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
    );
    const account = await this.getCustomerAccountById(id);
    if (!account) throw new Error("Failed to create customer account");
    return account;
  }

  async updateCustomerProfile(id: string, input: UpdateCustomerProfileInput) {
    const normalizedId = String(id || "").trim();
    const result = this.db.prepare(
      `UPDATE customer_accounts
       SET first_name = ?, last_name = ?, phone = ?, normalized_phone = ?,
           address_line1 = ?, address_line2 = ?, district = ?, subdistrict = ?,
           province = ?, postal_code = ?, country = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status != 'disabled'`,
    ).run(
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
    );
    return result.changes > 0 ? this.getCustomerAccountById(normalizedId) : undefined;
  }

  async updateCustomerPasswordHash(id: string, passwordHash: string) {
    const result = this.db.prepare(
      "UPDATE customer_accounts SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'disabled'",
    ).run(String(passwordHash || "").trim(), String(id || "").trim());
    return result.changes > 0;
  }

  async verifyCustomerAccountEmail(id: string) {
    const result = this.db.prepare(
      `UPDATE customer_accounts
       SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
           status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status != 'disabled'`,
    ).run(String(id || "").trim());
    return result.changes > 0;
  }

  async updateCustomerAccountLastLogin(id: string) {
    this.db.prepare(
      "UPDATE customer_accounts SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'disabled'",
    ).run(String(id || "").trim());
  }

  async setCustomerAccountStatus(id: string, status: CustomerAccountStatus) {
    const update = this.db.transaction(() => {
      const result = this.db.prepare(
        "UPDATE customer_accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(status, String(id || "").trim());
      if (result.changes > 0 && status === "disabled") {
        this.db.prepare("DELETE FROM customer_sessions WHERE customer_account_id = ?").run(String(id || "").trim());
      }
      return result.changes > 0;
    });
    return update();
  }

  async createCustomerSession(customerAccountId: string, tokenHash: string, expiresAt: Date) {
    this.db.prepare(
      `INSERT INTO customer_sessions (id, customer_account_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run(generateEntityId("cses"), String(customerAccountId || "").trim(), String(tokenHash || "").trim(), expiresAt.toISOString());
  }

  async getCustomerSessionWithAccount(tokenHash: string) {
    const row = this.db.prepare(
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
       WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND c.status != 'disabled'
       LIMIT 1`,
    ).get(String(tokenHash || "").trim()) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const account = mapCustomerAccountRow(row);
    if (!account) return undefined;
    return {
      session_id: String(row.session_id || ""),
      token_hash: String(row.token_hash || ""),
      expires_at: mapSqliteTimestamp(row.session_expires_at),
      last_seen_at: mapSqliteTimestamp(row.session_last_seen_at),
      account,
    } satisfies CustomerAccountSessionRow;
  }

  async touchCustomerSession(sessionId: string) {
    this.db.prepare("UPDATE customer_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(String(sessionId || "").trim());
  }

  async deleteCustomerSession(tokenHash: string) {
    this.db.prepare("DELETE FROM customer_sessions WHERE token_hash = ?").run(String(tokenHash || "").trim());
  }

  async deleteCustomerSessions(customerAccountId: string) {
    this.db.prepare("DELETE FROM customer_sessions WHERE customer_account_id = ?").run(String(customerAccountId || "").trim());
  }

  async deleteExpiredCustomerSessions() {
    this.db.prepare("DELETE FROM customer_sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
  }

  async createCustomerAccountToken(input: CreateCustomerAccountTokenInput) {
    const id = generateEntityId("ctok");
    this.db.prepare(
      `INSERT INTO customer_account_tokens (id, customer_account_id, kind, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      String(input.customer_account_id || "").trim(),
      input.kind,
      String(input.token_hash || "").trim(),
      input.expires_at.toISOString(),
    );
    const row = this.db.prepare("SELECT id, customer_account_id, kind, expires_at, created_at FROM customer_account_tokens WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    const token = mapCustomerAccountTokenRow(row);
    if (!token) throw new Error("Failed to create customer account token");
    return token;
  }

  async consumeCustomerAccountToken(tokenHash: string, kind: CustomerAccountTokenKind) {
    const consume = this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT id, customer_account_id
         FROM customer_account_tokens
         WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND datetime(expires_at) > CURRENT_TIMESTAMP
         ORDER BY created_at DESC
         LIMIT 1`,
      ).get(String(tokenHash || "").trim(), kind) as { id?: string; customer_account_id?: string } | undefined;
      if (!row?.id || !row.customer_account_id) return undefined;
      const result = this.db.prepare(
        "UPDATE customer_account_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL",
      ).run(row.id);
      return result.changes > 0 ? { token_id: row.id, customer_account_id: row.customer_account_id } : undefined;
    });
    return consume();
  }

  async deleteExpiredCustomerAccountTokens() {
    this.db.prepare("DELETE FROM customer_account_tokens WHERE expires_at <= CURRENT_TIMESTAMP OR used_at IS NOT NULL").run();
  }

  async listCustomerRegistrations(customerAccountId: string) {
    return this.db.prepare(
      "SELECT id, sender_id, event_id, customer_account_id, channel_platform, channel_external_id, sms_opt_in_at, sms_opt_out_at, sms_consent_source, first_name, last_name, phone, email, timestamp, status FROM registrations WHERE customer_account_id = ? ORDER BY timestamp DESC",
    ).all(String(customerAccountId || "").trim()) as RegistrationRow[];
  }

  async claimRegistrationToCustomer(input: { registration_id: string; customer_account_id: string; normalized_email?: string; normalized_phone?: string }) {
    const registrationId = String(input.registration_id || "").trim().toUpperCase();
    const accountId = String(input.customer_account_id || "").trim();
    const row = this.db.prepare("SELECT customer_account_id, email, phone FROM registrations WHERE id = ? LIMIT 1").get(registrationId) as { customer_account_id?: string | null; email?: string; phone?: string } | undefined;
    if (!row) return "not_found" as const;
    if (row.customer_account_id && row.customer_account_id !== accountId) return "already_claimed" as const;
    const emailMatches = Boolean(input.normalized_email && String(row.email || "").trim().toLowerCase() === input.normalized_email.trim().toLowerCase());
    const phoneDigits = String(row.phone || "").replace(/\D/g, "");
    const phoneMatches = Boolean(input.normalized_phone && phoneDigits && phoneDigits === input.normalized_phone.replace(/\D/g, ""));
    if (!emailMatches && !phoneMatches) return "contact_mismatch" as const;
    if (row.customer_account_id === accountId) return "already_claimed" as const;
    const updated = this.db.prepare("UPDATE registrations SET customer_account_id = ? WHERE id = ? AND customer_account_id IS NULL").run(accountId, registrationId);
    return updated.changes > 0 ? "claimed" as const : "already_claimed" as const;
  }

  async unlinkRegistrationFromCustomer(registrationId: string, customerAccountId?: string | null) {
    const id = String(registrationId || "").trim().toUpperCase();
    const accountId = customerAccountId == null ? "" : String(customerAccountId).trim();
    const result = this.db.prepare(accountId
      ? "UPDATE registrations SET customer_account_id = NULL WHERE id = ? AND customer_account_id = ?"
      : "UPDATE registrations SET customer_account_id = NULL WHERE id = ? AND customer_account_id IS NOT NULL").run(...(accountId ? [id, accountId] : [id]));
    return result.changes > 0;
  }

  async getCustomerNotificationPreferences(customerAccountId: string) {
    const accountId = String(customerAccountId || "").trim();
    const row = this.db.prepare("SELECT * FROM customer_notification_preferences WHERE customer_account_id = ?").get(accountId) as Record<string, unknown> | undefined;
    return mapCustomerNotificationPreferencesRow(row, accountId);
  }

  async updateCustomerNotificationPreferences(customerAccountId: string, input: UpdateCustomerNotificationPreferencesInput) {
    const accountId = String(customerAccountId || "").trim();
    const current = await this.getCustomerNotificationPreferences(accountId);
    const smsMarketing = input.sms_marketing_enabled ?? current.sms_marketing_enabled;
    const smsTransactional = input.sms_transactional_enabled ?? current.sms_transactional_enabled;
    const smsConsentAt = input.sms_consent_at === undefined ? current.sms_consent_at : input.sms_consent_at?.toISOString() || null;
    const smsOptedOutAt = input.sms_opted_out_at === undefined ? current.sms_opted_out_at : input.sms_opted_out_at?.toISOString() || null;
    this.db.prepare(
      `INSERT INTO customer_notification_preferences (customer_account_id, email_transactional_enabled, sms_transactional_enabled, sms_marketing_enabled, sms_consent_at, sms_opted_out_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(customer_account_id) DO UPDATE SET email_transactional_enabled=excluded.email_transactional_enabled, sms_transactional_enabled=excluded.sms_transactional_enabled, sms_marketing_enabled=excluded.sms_marketing_enabled, sms_consent_at=excluded.sms_consent_at, sms_opted_out_at=excluded.sms_opted_out_at, updated_at=CURRENT_TIMESTAMP`,
    ).run(accountId, input.email_transactional_enabled ?? current.email_transactional_enabled ? 1 : 0, smsTransactional ? 1 : 0, smsMarketing ? 1 : 0, smsConsentAt, smsOptedOutAt);
    return this.getCustomerNotificationPreferences(accountId);
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
      const orders = Number((this.db.prepare("SELECT COUNT(*) AS count FROM direct_orders WHERE performance_id = ? AND event_id = ?").get(performanceId, eventId) as { count?: number })?.count || 0);
      if (orders > 0) return { status: "blocked" as const, tickets: 0, seats: 0 };
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
      const orders = Number((this.db.prepare("SELECT COUNT(*) AS count FROM direct_orders WHERE performance_id = ? AND event_id = ?").get(performanceId, eventId) as { count?: number })?.count || 0);
      if (orders > 0) return { tickets: 0, seats: 0, orders, blocked: true };
      const tickets = Number((this.db.prepare("SELECT COUNT(*) AS count FROM direct_tickets WHERE performance_id = ? AND event_id = ?").get(performanceId, eventId) as { count?: number })?.count || 0);
      const seats = Number((this.db.prepare("SELECT COUNT(*) AS count FROM direct_seats WHERE performance_id = ? AND event_id = ?").get(performanceId, eventId) as { count?: number })?.count || 0);
      this.db.prepare("DELETE FROM direct_tickets WHERE performance_id = ? AND event_id = ?").run(performanceId, eventId);
      this.db.prepare("DELETE FROM direct_seats WHERE performance_id = ? AND event_id = ?").run(performanceId, eventId);
      return { tickets, seats };
    });
    return reset();
  }

  async listDirectSeats(eventId: string, performanceId?: string) {
    await this.releaseExpiredDirectOrderHolds(eventId);
    await this.releaseExpiredDirectTicketHolds(eventId);
    const rows = performanceId ? this.db.prepare("SELECT * FROM direct_seats WHERE event_id = ? AND performance_id = ? ORDER BY zone, row_label, seat_label").all(eventId, performanceId) : this.db.prepare("SELECT * FROM direct_seats WHERE event_id = ? ORDER BY zone, row_label, seat_label").all(eventId);
    return rows.map((row) => mapDirectSeatRow(row as Record<string, unknown>));
  }

  async importDirectSeats(eventId: string, performanceId: string, seats: ImportDirectSeatInput[], options?: { replaceMissing?: boolean; replaceLayout?: boolean }) {
    const layoutUpdate = options?.replaceLayout ? "x=excluded.x,y=excluded.y" : "x=COALESCE(direct_seats.x,excluded.x),y=COALESCE(direct_seats.y,excluded.y)";
    const insert = this.db.prepare(`INSERT INTO direct_seats (id,event_id,performance_id,zone,section_label,row_label,seat_label,external_seat_ref,ticket_class,face_value,x,y,allocation_status,source_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(performance_id,zone,row_label,seat_label) DO UPDATE SET section_label=excluded.section_label,external_seat_ref=excluded.external_seat_ref,ticket_class=excluded.ticket_class,face_value=excluded.face_value,${layoutUpdate},allocation_status=excluded.allocation_status,source_status=excluded.source_status,updated_at=CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM direct_tickets WHERE direct_tickets.seat_id=direct_seats.id AND direct_tickets.status IN ('held','issued','checked_in'))`);
    this.db.transaction((items: ImportDirectSeatInput[]) => items.forEach((seat) => insert.run(generateEntityId("seat"), eventId, performanceId, String(seat.zone).trim(), seat.section_label || null, String(seat.row_label).trim(), String(seat.seat_label).trim(), seat.external_seat_ref || null, seat.ticket_class || null, seat.face_value ?? null, seat.x ?? null, seat.y ?? null, seat.allocation_status === "not_allocated" ? "not_allocated" : "allocated", seat.source_status || "unknown")))(seats);
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

  private directOrderQuery(where: string, params: unknown[]) {
    const rows = this.db.prepare(`SELECT o.*, p.code performance_code, p.title performance_title, p.starts_at performance_starts_at, p.ends_at performance_ends_at FROM direct_orders o JOIN event_performances p ON p.id=o.performance_id ${where}`).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => mapDirectOrderRow(row, this.directTicketQuery("WHERE t.order_id = ? ORDER BY t.created_at ASC", [row.id])));
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
      this.db.prepare(`INSERT INTO direct_tickets (id,event_id,customer_account_id,performance_id,seat_id,ticket_class,holder_name,buyer_name,phone,email,price_amount,payment_status,status,issued_by_user_id,issued_at,hold_expires_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='issued' THEN CURRENT_TIMESTAMP END,CASE WHEN ?='held' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now',?) END,?)`)
        .run(id,input.event_id,input.customer_account_id || null,input.performance_id,input.seat_id,input.ticket_class,String(input.holder_name || ""),String(input.buyer_name || ""),String(input.phone || ""),String(input.email || ""),Number(input.price_amount || 0),paymentStatus,status,input.issued_by_user_id || null,status,status,`+${holdMinutes} minutes`,input.source === "public" ? "public" : "admin");
      this.db.prepare("UPDATE direct_seats SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, input.seat_id);
      return { ticket: this.directTicketQuery("WHERE t.id = ?", [id])[0] };
    });
    return create();
  }

  async createDirectOrder(input: CreateDirectOrderInput) {
    await this.releaseExpiredDirectOrderHolds(input.event_id);
    const seatIds = [...new Set((input.seat_ids || []).map((seatId) => String(seatId || "").trim()).filter(Boolean))];
    if (!seatIds.length || !input.performance_id || !input.event_id) return { error: "invalid_order" as const };
    const create = this.db.transaction(() => {
      for (const seatId of seatIds) {
        const seat = this.db.prepare("SELECT * FROM direct_seats WHERE id=? AND event_id=? AND performance_id=?").get(seatId, input.event_id, input.performance_id) as Record<string, unknown> | undefined;
        if (!seat) return { error: "invalid_seat" as const };
        if (seat.status !== "available" || seat.allocation_status !== "allocated") return { error: "seat_unavailable" as const };
      }
      const orderId = generateEntityId("ord");
      const holdMinutes = Math.min(120, Math.max(5, Math.round(Number(input.hold_minutes) || 15)));
      const totalAmount = Math.max(0, Number(input.total_amount) || 0);
      const subtotalAmount = Math.max(0, Number(input.subtotal_amount) || 0);
      const status = totalAmount === 0 ? "paid" : "pending_payment";
      const billingStatus = String(input.billing_profile_json || "{}").trim() !== "{}" ? "pending" : "not_required";
      this.db.prepare(`INSERT INTO direct_orders (id,event_id,performance_id,customer_account_id,buyer_name,phone,email,currency,subtotal_amount,platform_fee_amount,payment_fee_amount,tax_amount,discount_amount,total_amount,fee_rule_version,tax_snapshot_json,billing_profile_json,seller_snapshot_json,status,hold_expires_at,billing_document_status,seller_organization_id,payment_profile_version,payment_receiver_snapshot_json,payout_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='pending_payment' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now',?) END,?,?,?,?,?)`)
        .run(orderId, input.event_id, input.performance_id, input.customer_account_id || null, String(input.buyer_name || "").trim(), String(input.phone || "").trim(), String(input.email || "").trim(), "THB", subtotalAmount, Math.max(0, Number(input.platform_fee_amount) || 0), Math.max(0, Number(input.payment_fee_amount) || 0), Math.max(0, Number(input.tax_amount) || 0), Math.max(0, Number(input.discount_amount) || 0), totalAmount, String(input.fee_rule_version || "v1"), String(input.tax_snapshot_json || "{}").trim() || "{}", String(input.billing_profile_json || "{}").trim() || "{}", String(input.seller_snapshot_json || "{}").trim() || "{}", status, status, `+${holdMinutes} minutes`, billingStatus, input.seller_organization_id || null, Math.max(1, Number(input.payment_profile_version) || 1), String(input.payment_receiver_snapshot_json || "{}").trim() || "{}", input.payout_status || "not_applicable");
      const ticketInsert = this.db.prepare(`INSERT INTO direct_tickets (id,event_id,order_id,customer_account_id,performance_id,seat_id,ticket_class,holder_name,buyer_name,phone,email,price_amount,payment_status,status,issued_at,hold_expires_at,source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='issued' THEN CURRENT_TIMESTAMP END,CASE WHEN ?='held' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now',?) END,?)`);
      const ticketStatus = status === "paid" ? "issued" : "held";
      const paymentStatus = status === "paid" ? "verified" : "awaiting_payment";
      const seatPrice = seatIds.length ? subtotalAmount / seatIds.length : 0;
      for (const seatId of seatIds) {
        ticketInsert.run(generateEntityId("dtkt"), input.event_id, orderId, input.customer_account_id || null, input.performance_id, seatId, String(input.ticket_class || "Public").trim() || "Public", String(input.buyer_name || "").trim(), String(input.buyer_name || "").trim(), String(input.phone || "").trim(), String(input.email || "").trim(), seatPrice, paymentStatus, ticketStatus, ticketStatus, ticketStatus, `+${holdMinutes} minutes`, input.source === "admin" ? "admin" : "public");
        this.db.prepare("UPDATE direct_seats SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(ticketStatus, seatId);
      }
      this.db.prepare("INSERT INTO payment_attempts (id,order_id,attempt_number,method,amount,status,receiver_snapshot_json) VALUES (?,?,?,?,?,?,?)").run(generateEntityId("pay"), orderId, 1, "promptpay", totalAmount, status === "paid" ? "verified" : "pending", String(input.payment_receiver_snapshot_json || "{}").trim() || "{}");
      return { order: this.directOrderQuery("WHERE o.id = ?", [orderId])[0] };
    });
    try {
      return create();
    } catch (error: any) {
      if (String(error?.message || "").toLowerCase().includes("unique")) return { error: "seat_unavailable" as const };
      throw error;
    }
  }

  async getDirectOrderById(id: string) {
    await this.releaseExpiredDirectOrderHolds();
    return this.directOrderQuery("WHERE o.id = ?", [String(id || "").trim()])[0];
  }

  async listDirectOrders(eventId: string) {
    await this.releaseExpiredDirectOrderHolds(eventId);
    return this.directOrderQuery("WHERE o.event_id = ? ORDER BY o.created_at DESC", [String(eventId || "").trim()]);
  }

  async listCustomerOrders(customerAccountId: string) {
    await this.releaseExpiredDirectOrderHolds();
    return this.directOrderQuery("WHERE o.customer_account_id = ? ORDER BY o.created_at DESC", [String(customerAccountId || "").trim()]);
  }

  async submitDirectOrderPaymentProof(id: string, input: { payment_proof_mime: string; payment_proof_base64: string; payment_reference?: string | null }) {
    await this.releaseExpiredDirectOrderHolds();
    const update = this.db.transaction(() => {
      const order = this.directOrderQuery("WHERE o.id = ?", [id])[0];
      if (!order || !["pending_payment", "payment_submitted"].includes(order.status)) return order;
      this.db.prepare("UPDATE direct_orders SET status='payment_submitted',payment_proof_mime=?,payment_proof_base64=?,payment_proof_submitted_at=CURRENT_TIMESTAMP,payment_reference=?,hold_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours'),updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(input.payment_proof_mime, input.payment_proof_base64, input.payment_reference || null, id);
      this.db.prepare("UPDATE direct_tickets SET payment_status='proof_submitted',payment_proof_mime=?,payment_proof_base64=?,payment_proof_submitted_at=CURRENT_TIMESTAMP,payment_reference=?,hold_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours'),updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='held'")
        .run(input.payment_proof_mime, input.payment_proof_base64, input.payment_reference || null, id);
      this.db.prepare("UPDATE payment_attempts SET status='proof_submitted',proof_mime=?,proof_base64=?,transaction_reference=?,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND attempt_number=(SELECT MAX(attempt_number) FROM payment_attempts WHERE order_id=?)")
        .run(input.payment_proof_mime, input.payment_proof_base64, input.payment_reference || null, id, id);
      return this.directOrderQuery("WHERE o.id = ?", [id])[0];
    });
    return update();
  }

  async updateDirectOrderPayment(id: string, input: { payment_status: "verified" | "rejected" | "refunded"; payment_reference?: string | null; verified_by_user_id?: string | null; rejection_reason?: string | null }) {
    const update = this.db.transaction(() => {
      const order = this.directOrderQuery("WHERE o.id = ?", [id])[0];
      if (!order) return undefined;
      if (order.status === "paid" && input.payment_status === "verified") return order;
      if (!["pending_payment", "payment_submitted"].includes(order.status) && input.payment_status !== "refunded") return order;
      const nextStatus = input.payment_status === "verified" ? "paid" : input.payment_status === "refunded" ? "refunded" : "rejected";
      const ticketStatus = input.payment_status === "verified" ? "issued" : "voided";
      this.db.prepare("UPDATE direct_orders SET status=?,payment_reference=COALESCE(?,payment_reference),rejection_reason=?,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(nextStatus, input.payment_reference || null, input.rejection_reason || null, id);
      if (input.payment_status === "verified") this.db.prepare("UPDATE direct_tickets SET payment_reference=NULL WHERE order_id=?").run(id);
      this.db.prepare("UPDATE direct_tickets SET payment_status=?,payment_verified_by_user_id=?,payment_verified_at=CURRENT_TIMESTAMP,rejection_reason=?,status=?,issued_at=CASE WHEN ?='issued' THEN CURRENT_TIMESTAMP ELSE issued_at END,voided_at=CASE WHEN ?='issued' THEN NULL ELSE CURRENT_TIMESTAMP END,hold_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE order_id=?")
        .run(input.payment_status, input.verified_by_user_id || null, input.rejection_reason || null, ticketStatus, ticketStatus, ticketStatus, id);
      this.db.prepare("UPDATE direct_tickets SET payment_reference=COALESCE(?,payment_reference) WHERE order_id=? AND id=(SELECT id FROM direct_tickets WHERE order_id=? ORDER BY created_at ASC, id ASC LIMIT 1)")
        .run(input.payment_reference || null, id, id);
      this.db.prepare("UPDATE direct_seats SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT seat_id FROM direct_tickets WHERE order_id=?)").run(input.payment_status === "verified" ? "issued" : "available", id);
      this.db.prepare("UPDATE payment_attempts SET status=?,transaction_reference=COALESCE(?,transaction_reference),updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND attempt_number=(SELECT MAX(attempt_number) FROM payment_attempts WHERE order_id=?)")
        .run(input.payment_status, input.payment_reference || null, id, id);
      return this.directOrderQuery("WHERE o.id = ?", [id])[0];
    });
    return update();
  }

  async releaseExpiredDirectOrderHolds(eventId?: string) {
    const run = this.db.transaction(() => {
      const orders = this.db.prepare(`SELECT id FROM direct_orders WHERE status IN ('pending_payment','payment_submitted') AND hold_expires_at IS NOT NULL AND julianday(hold_expires_at) <= julianday('now') ${eventId ? "AND event_id=?" : ""}`).all(...(eventId ? [eventId] : [])) as Array<{ id: string }>;
      if (!orders.length) return 0;
      for (const order of orders) {
        this.db.prepare("UPDATE direct_orders SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
        this.db.prepare("UPDATE direct_tickets SET status='voided',payment_status='expired',voided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='held'").run(order.id);
        this.db.prepare("UPDATE direct_seats SET status='available',updated_at=CURRENT_TIMESTAMP WHERE id IN (SELECT seat_id FROM direct_tickets WHERE order_id=?) AND NOT EXISTS (SELECT 1 FROM direct_tickets other WHERE other.seat_id=direct_seats.id AND other.status IN ('held','issued','checked_in'))").run(order.id);
      }
      return orders.length;
    });
    return run();
  }

  async claimDirectOrderToCustomer(input: { order_id: string; customer_account_id: string; normalized_email?: string; normalized_phone?: string }) {
    const orderId = String(input.order_id || "").trim();
    const accountId = String(input.customer_account_id || "").trim();
    const row = this.db.prepare("SELECT customer_account_id,email,phone FROM direct_orders WHERE id=? LIMIT 1").get(orderId) as { customer_account_id?: string | null; email?: string; phone?: string } | undefined;
    if (!row) return "not_found" as const;
    if (row.customer_account_id && row.customer_account_id !== accountId) return "already_claimed" as const;
    const emailMatches = Boolean(input.normalized_email && String(row.email || "").trim().toLowerCase() === input.normalized_email.trim().toLowerCase());
    const phoneMatches = Boolean(input.normalized_phone && String(row.phone || "").replace(/\D/g, "") === input.normalized_phone.replace(/\D/g, ""));
    if (!emailMatches && !phoneMatches) return "contact_mismatch" as const;
    if (row.customer_account_id === accountId) return "already_claimed" as const;
    const result = this.db.prepare("UPDATE direct_orders SET customer_account_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND customer_account_id IS NULL").run(accountId, orderId);
    this.db.prepare("UPDATE direct_tickets SET customer_account_id=? WHERE order_id=? AND customer_account_id IS NULL").run(accountId, orderId);
    return result.changes > 0 ? "claimed" as const : "already_claimed" as const;
  }

  async unlinkDirectOrderFromCustomer(orderId: string, customerAccountId?: string | null) {
    const id = String(orderId || "").trim();
    const accountId = customerAccountId == null ? "" : String(customerAccountId).trim();
    const where = accountId ? "id = ? AND customer_account_id = ?" : "id = ? AND customer_account_id IS NOT NULL";
    const result = this.db.prepare(`UPDATE direct_orders SET customer_account_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE ${where}`).run(...(accountId ? [id, accountId] : [id]));
    if (result.changes > 0) this.db.prepare("UPDATE direct_tickets SET customer_account_id = NULL WHERE order_id = ?").run(id);
    return result.changes > 0;
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
      const rows = this.db.prepare(`SELECT id,seat_id FROM direct_tickets WHERE order_id IS NULL AND status='held' AND hold_expires_at IS NOT NULL AND julianday(hold_expires_at) <= julianday('now') ${eventId ? "AND event_id=?" : ""}`).all(...(eventId ? [eventId] : [])) as Array<{ id: string; seat_id: string }>;
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
      this.db.prepare(`INSERT INTO direct_tickets (id,event_id,order_id,customer_account_id,performance_id,seat_id,ticket_class,holder_name,buyer_name,phone,email,price_amount,payment_status,payment_reference,status,issued_by_user_id,payment_verified_by_user_id,payment_verified_at,issued_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)`)
        .run(nextId,ticket.event_id,ticket.order_id,ticket.customer_account_id,ticket.performance_id,ticket.seat_id,ticket.ticket_class,ticket.holder_name,ticket.buyer_name,ticket.phone,ticket.email,ticket.price_amount,ticket.payment_status,ticket.payment_reference,"issued",issuedByUserId||null,ticket.payment_verified_by_user_id,ticket.payment_verified_at,ticket.source);
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

  async listEvents(organizationId?: string) {
    const normalizedOrganizationId = String(organizationId || "").trim();
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
       ${normalizedOrganizationId ? "WHERE e.organizer_id = ?" : ""}
       ORDER BY e.is_default DESC, e.created_at ASC`,
    ).all(...(normalizedOrganizationId ? [normalizedOrganizationId] : [])) as Array<Record<string, unknown>>;
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

  async listOrganizerProfiles(organizationId: string) {
    const rows = this.db.prepare(
      `SELECT id, organization_id, name, slug, legal_name, public_display_name, public_description,
              public_logo_url, public_website_url, public_facebook_url, public_line_url,
              public_contact_text, verification_status, verification_notes, created_at, updated_at
       FROM organizer_profiles
       WHERE organization_id = ?
       ORDER BY name COLLATE NOCASE ASC, created_at ASC`,
    ).all(String(organizationId || "").trim()) as Array<Record<string, unknown>>;
    return rows.map((row) => mapOrganizerProfileRow(row)).filter((row): row is OrganizerProfileRow => Boolean(row));
  }

  async getOrganizerProfileById(organizerProfileId: string, organizationId: string) {
    const row = this.db.prepare(
      `SELECT id, organization_id, name, slug, legal_name, public_display_name, public_description,
              public_logo_url, public_website_url, public_facebook_url, public_line_url,
              public_contact_text, verification_status, verification_notes, created_at, updated_at
       FROM organizer_profiles
       WHERE id = ? AND organization_id = ?`,
    ).get(String(organizerProfileId || "").trim(), String(organizationId || "").trim()) as Record<string, unknown> | undefined;
    return mapOrganizerProfileRow(row);
  }

  async createOrganizerProfile(organizationId: string, input: CreateOrganizerProfileInput) {
    const ownerId = String(organizationId || "").trim();
    const name = String(input.name || "").trim() || "New Organizer";
    const baseSlug = slugifyText(input.slug || name);
    let slug = baseSlug;
    let suffix = 2;
    while (this.db.prepare("SELECT 1 FROM organizer_profiles WHERE organization_id = ? AND slug = ? LIMIT 1").get(ownerId, slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const id = generateEntityId("orgp");
    this.db.prepare(
      `INSERT INTO organizer_profiles (
         id, organization_id, name, slug, legal_name, public_display_name, public_description,
         public_logo_url, public_website_url, public_facebook_url, public_line_url, public_contact_text,
         verification_status, verification_notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, ownerId, name, slug,
      input.legal_name ?? null, input.public_display_name ?? null, input.public_description ?? null,
      input.public_logo_url ?? null, input.public_website_url ?? null, input.public_facebook_url ?? null,
      input.public_line_url ?? null, input.public_contact_text ?? null,
      input.verification_status ?? "draft", input.verification_notes ?? null,
    );
    this.db.prepare("INSERT OR IGNORE INTO organizer_financial_profiles (organizer_id) VALUES (?)").run(id);
    const profile = await this.getOrganizerProfileById(id, ownerId);
    if (!profile) throw new Error("Failed to create organizer profile");
    return profile;
  }

  async updateOrganizerProfileById(organizerProfileId: string, organizationId: string, input: UpdateOrganizerProfileInput & { name?: string; slug?: string }) {
    const profileId = String(organizerProfileId || "").trim();
    const ownerId = String(organizationId || "").trim();
    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof input.name === "string" && input.name.trim()) { updates.push("name = ?"); values.push(input.name.trim()); }
    if (typeof input.slug === "string" && input.slug.trim()) { updates.push("slug = ?"); values.push(slugifyText(input.slug)); }
    updates.push(
      "legal_name = ?", "public_display_name = ?", "public_description = ?", "public_logo_url = ?",
      "public_website_url = ?", "public_facebook_url = ?", "public_line_url = ?", "public_contact_text = ?",
      "verification_status = ?", "verification_notes = ?", "updated_at = CURRENT_TIMESTAMP",
    );
    values.push(
      input.legal_name ?? null, input.public_display_name ?? null, input.public_description ?? null,
      input.public_logo_url ?? null, input.public_website_url ?? null, input.public_facebook_url ?? null,
      input.public_line_url ?? null, input.public_contact_text ?? null,
      input.verification_status ?? "draft", input.verification_notes ?? null,
      profileId, ownerId,
    );
    const result = this.db.prepare(`UPDATE organizer_profiles SET ${updates.join(", ")} WHERE id = ? AND organization_id = ?`).run(...values);
    if (result.changes <= 0) return undefined;
    return this.getOrganizerProfileById(profileId, ownerId);
  }

  async getOrganizerFinancialProfile(organizationId: string) {
    const normalizedOrganizationId = String(organizationId || "").trim();
    if (!normalizedOrganizationId) return undefined;
    this.db.prepare("INSERT OR IGNORE INTO organization_financial_profiles (organization_id) VALUES (?)").run(normalizedOrganizationId);
    const row = this.db.prepare("SELECT * FROM organization_financial_profiles WHERE organization_id = ?").get(normalizedOrganizationId) as Record<string, unknown> | undefined;
    return mapOrganizerFinancialProfileRow(row);
  }

  async updateOrganizerFinancialProfile(organizationId: string, input: UpdateOrganizerFinancialProfileInput) {
    const current = await this.getOrganizerFinancialProfile(organizationId);
    if (!current) return undefined;
    const promptpayId = input.clear_promptpay_id ? null : input.promptpay_id === undefined ? current.promptpay_id : input.promptpay_id;
    this.db.prepare(
      `UPDATE organization_financial_profiles SET
        payment_method = ?, promptpay_id = ?, promptpay_receiver_name = ?, payment_status = ?,
        legal_entity_type = ?, tax_id = ?, vat_status = ?, vat_rate_percent = ?, registered_address = ?,
        branch_number = ?, billing_document_mode = ?, platform_fee_type = ?, platform_fee_value = ?,
        platform_fee_payer = ?, payment_fee_value = ?, payout_mode = ?, payout_schedule = ?,
        payout_status = ?, pricing_policy_enabled = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = ?`,
    ).run(
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
      input.pricing_policy_enabled === undefined ? (current.pricing_policy_enabled ? 1 : 0) : input.pricing_policy_enabled ? 1 : 0,
      current.organization_id,
    );
    return this.getOrganizerFinancialProfile(current.organization_id);
  }

  async getOrganizerFinancialProfileByOrganizerId(organizerProfileId: string, organizationId: string) {
    const profile = await this.getOrganizerProfileById(organizerProfileId, organizationId);
    if (!profile) return undefined;
    this.db.prepare("INSERT OR IGNORE INTO organizer_financial_profiles (organizer_id) VALUES (?)").run(profile.id);
    const row = this.db.prepare(
      `SELECT f.*, p.organization_id, p.id AS organizer_profile_id
       FROM organizer_financial_profiles f
       JOIN organizer_profiles p ON p.id = f.organizer_id
       WHERE f.organizer_id = ? AND p.organization_id = ?`,
    ).get(profile.id, profile.organization_id) as Record<string, unknown> | undefined;
    return mapOrganizerFinancialProfileRow(row);
  }

  async updateOrganizerFinancialProfileByOrganizerId(organizerProfileId: string, organizationId: string, input: UpdateOrganizerFinancialProfileInput) {
    const current = await this.getOrganizerFinancialProfileByOrganizerId(organizerProfileId, organizationId);
    if (!current || !current.organizer_profile_id) return undefined;
    const promptpayId = input.clear_promptpay_id ? null : input.promptpay_id === undefined ? current.promptpay_id : input.promptpay_id;
    this.db.prepare(
      `UPDATE organizer_financial_profiles SET
        payment_method = ?, promptpay_id = ?, promptpay_receiver_name = ?, payment_status = ?,
        legal_entity_type = ?, tax_id = ?, vat_status = ?, vat_rate_percent = ?, registered_address = ?,
        branch_number = ?, billing_document_mode = ?, platform_fee_type = ?, platform_fee_value = ?,
        platform_fee_payer = ?, payment_fee_value = ?, payout_mode = ?, payout_schedule = ?,
        payout_status = ?, pricing_policy_enabled = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE organizer_id = ?`,
    ).run(
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
      input.pricing_policy_enabled === undefined ? (current.pricing_policy_enabled ? 1 : 0) : input.pricing_policy_enabled ? 1 : 0,
      current.organizer_profile_id,
    );
    return this.getOrganizerFinancialProfileByOrganizerId(current.organizer_profile_id, organizationId);
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

  async deleteOutreachTarget(id: string, eventId: string) {
    return this.db.prepare("DELETE FROM outreach_targets WHERE id = ? AND event_id = ?").run(id, eventId).changes > 0;
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

  private async ensureDefaultOrganizerDirectory() {
    this.db.prepare(
      `INSERT OR IGNORE INTO organizer_profiles (
         id, organization_id, name, slug, legal_name, public_display_name, public_description,
         public_logo_url, public_website_url, public_facebook_url, public_line_url, public_contact_text,
         verification_status, verification_notes
       )
       SELECT
         'orgprof_' || id, id, name, slug, legal_name, public_display_name, public_description,
         public_logo_url, public_website_url, public_facebook_url, public_line_url, public_contact_text,
         COALESCE(NULLIF(TRIM(verification_status), ''), 'draft'), verification_notes
       FROM organizations
       WHERE id = ?`,
    ).run(DEFAULT_ORGANIZATION_ID);
    this.db.prepare(
      `INSERT OR IGNORE INTO organizer_financial_profiles (
         organizer_id, payment_method, promptpay_id, promptpay_receiver_name, payment_status,
         legal_entity_type, tax_id, vat_status, vat_rate_percent, registered_address, branch_number,
         billing_document_mode, platform_fee_type, platform_fee_value, platform_fee_payer,
         payment_fee_value, payout_mode, payout_schedule, payout_status, pricing_policy_enabled, version
       )
       SELECT
         'orgprof_' || organization_id, payment_method, promptpay_id, promptpay_receiver_name, payment_status,
         legal_entity_type, tax_id, vat_status, vat_rate_percent, registered_address, branch_number,
         billing_document_mode, platform_fee_type, platform_fee_value, platform_fee_payer,
         payment_fee_value, payout_mode, payout_schedule, payout_status, pricing_policy_enabled, version
       FROM organization_financial_profiles
       WHERE organization_id = ?`,
    ).run(DEFAULT_ORGANIZATION_ID);
    this.db.prepare(
      "INSERT OR IGNORE INTO organizer_financial_profiles (organizer_id) VALUES (?)",
    ).run(`orgprof_${DEFAULT_ORGANIZATION_ID}`);
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
