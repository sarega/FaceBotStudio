export type MessageType = "incoming" | "outgoing";
export type RegistrationStatus = "registered" | "cancelled" | "checked-in";
export type DirectSeatStatus = "available" | "held" | "issued" | "voided";
export type DirectSeatAllocationStatus = "allocated" | "not_allocated";
export type DirectSeatSourceStatus = "available" | "sold" | "generated" | "blocked" | "unknown";
export type DirectTicketStatus = "held" | "issued" | "checked_in" | "voided";
export type DirectTicketPaymentStatus = "awaiting_payment" | "proof_submitted" | "verified" | "not_required" | "rejected" | "expired" | "refunded";
export type UserRole = "owner" | "admin" | "operator" | "checker" | "viewer";
export type ManualEventStatus = "pending" | "active" | "inactive" | "cancelled" | "archived";
export type EventStatus = ManualEventStatus | "closed";
export type ChannelPlatform = "facebook" | "line_oa" | "instagram" | "whatsapp" | "telegram" | "web_chat";
export type EmbeddingStatus = "pending" | "ready" | "failed" | "skipped";
export type OrganizerVerificationStatus = "draft" | "pending_review" | "verified" | "rejected" | "needs_update";
export type OutreachCampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type OutreachTargetStatus = "new" | "drafted" | "approved" | "contacted" | "waiting_reply" | "replied" | "press_kit_sent" | "follow_up" | "published" | "declined" | "no_response";
export type OutreachPriority = "low" | "normal" | "high";
export type OutreachDeliveryMode = "manual_first_contact" | "api_reply_eligible" | "manual_only" | "unavailable";
export type OutreachDraftApprovalStatus = "draft" | "approved";
export type OutreachDraftKind = "initial" | "suggested_reply";
export type OutreachDeliveryKind = "text" | "asset";
export type OutreachDeliveryStatus = "pending" | "sent" | "failed";

export interface OutreachCampaignRow {
  id: string;
  event_id: string;
  name: string;
  description: string;
  objective: string;
  context: string;
  default_instruction: string;
  start_date: string | null;
  end_date: string | null;
  status: OutreachCampaignStatus;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  target_count: number;
  needs_action_count: number;
  follow_up_due_count: number;
  not_contacted_count: number;
  waiting_count: number;
  replied_count: number;
  press_kit_sent_count: number;
  published_count: number;
  declined_count: number;
  no_response_count: number;
}

export interface OutreachTargetRow {
  id: string;
  campaign_id: string;
  event_id: string;
  name: string;
  facebook_page_url: string;
  facebook_page_id: string | null;
  organization_type: string;
  contact_person: string | null;
  email: string | null;
  website: string | null;
  notes: string;
  priority: OutreachPriority;
  status: OutreachTargetStatus;
  delivery_mode: OutreachDeliveryMode;
  bound_sender_id: string | null;
  bound_page_id: string | null;
  last_contacted_at: string | null;
  last_replied_at: string | null;
  next_follow_up_at: string | null;
  outcome_note: string | null;
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachDraftRow {
  id: string;
  target_id: string;
  campaign_id: string;
  event_id: string;
  revision: number;
  body: string;
  kind: OutreachDraftKind;
  source_message_id: number | null;
  approval_status: OutreachDraftApprovalStatus;
  approved_by_user_id: string | null;
  approved_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachDeliveryRow {
  id: string;
  target_id: string;
  campaign_id: string;
  event_id: string;
  draft_id: string | null;
  asset_id: string | null;
  kind: OutreachDeliveryKind;
  channel_platform: ChannelPlatform;
  channel_external_id: string;
  recipient_id: string;
  idempotency_key: string;
  status: OutreachDeliveryStatus;
  external_message_id: string | null;
  error_message: string | null;
  sent_by_user_id: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachAssetRow {
  id: string;
  campaign_id: string;
  event_id: string;
  name: string;
  type: string;
  description: string;
  url: string;
  tags: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateOutreachCampaignInput {
  event_id: string;
  name: string;
  description?: string | null;
  objective?: string | null;
  context?: string | null;
  default_instruction?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: OutreachCampaignStatus;
  created_by_user_id?: string | null;
}

export interface UpdateOutreachCampaignInput extends CreateOutreachCampaignInput {
  status: OutreachCampaignStatus;
}

export interface CreateOutreachTargetInput {
  event_id: string;
  campaign_id: string;
  name: string;
  facebook_page_url?: string | null;
  facebook_page_id?: string | null;
  organization_type?: string | null;
  contact_person?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  priority?: OutreachPriority;
  status?: OutreachTargetStatus;
  delivery_mode?: OutreachDeliveryMode;
  next_follow_up_at?: string | null;
  outcome_note?: string | null;
  assigned_user_id?: string | null;
}

export interface UpdateOutreachTargetInput extends CreateOutreachTargetInput {
  status: OutreachTargetStatus;
  delivery_mode: OutreachDeliveryMode;
}

export interface CreateOutreachDraftInput {
  event_id: string;
  target_id: string;
  body: string;
  kind?: OutreachDraftKind;
  source_message_id?: number | null;
  created_by_user_id?: string | null;
}

export interface CreateOutreachAssetInput {
  event_id: string;
  campaign_id: string;
  name: string;
  type?: string | null;
  description?: string | null;
  url: string;
  tags?: string | null;
  is_active?: boolean;
}

export interface CreateOutreachDeliveryInput {
  target_id: string;
  campaign_id: string;
  event_id: string;
  draft_id?: string | null;
  asset_id?: string | null;
  kind: OutreachDeliveryKind;
  channel_platform: ChannelPlatform;
  channel_external_id: string;
  recipient_id: string;
  idempotency_key: string;
  status?: OutreachDeliveryStatus;
  external_message_id?: string | null;
  error_message?: string | null;
  sent_by_user_id?: string | null;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface MessageRow {
  id: number;
  sender_id: string;
  event_id?: string | null;
  page_id?: string | null;
  text: string;
  timestamp: string;
  type: MessageType;
  attachments?: MessageAttachmentRow[];
}

export interface MessageAttachmentRow {
  id: string;
  message_id: number;
  kind: "image";
  url: string;
  absolute_url?: string | null;
  mime_type?: string | null;
  name?: string | null;
  size_bytes?: number | null;
  created_at: string;
}

export interface CreateMessageAttachmentInput {
  kind: "image";
  url: string;
  absolute_url?: string | null;
  mime_type?: string | null;
  name?: string | null;
  size_bytes?: number | null;
}

export interface RegistrationRow {
  id: string;
  sender_id: string;
  event_id?: string | null;
  customer_account_id?: string | null;
  channel_platform?: ChannelPlatform | null;
  channel_external_id?: string | null;
  sms_opt_in_at?: string | null;
  sms_opt_out_at?: string | null;
  sms_consent_source?: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  timestamp: string;
  status: RegistrationStatus;
}

export interface RegistrationInput {
  sender_id: string;
  event_id?: string;
  customer_account_id?: string | null;
  channel_platform?: ChannelPlatform | null;
  channel_external_id?: string | null;
  first_name: unknown;
  last_name: unknown;
  phone: unknown;
  email?: unknown;
}

export interface RegistrationResult {
  statusCode: number;
  content: Record<string, unknown>;
}

export interface DirectPerformanceRow {
  id: string;
  event_id: string;
  code: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  seat_plan_image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DirectPerformanceDeleteResult {
  status: "deleted" | "blocked";
  tickets: number;
  seats: number;
}

export interface DirectPerformanceResetResult {
  tickets: number;
  seats: number;
  orders?: number;
  blocked?: boolean;
}

export interface DirectSeatRow {
  id: string;
  event_id: string;
  performance_id: string;
  zone: string;
  section_label: string | null;
  row_label: string;
  seat_label: string;
  external_seat_ref: string | null;
  ticket_class: string | null;
  face_value: number | null;
  x: number | null;
  y: number | null;
  status: DirectSeatStatus;
  allocation_status: DirectSeatAllocationStatus;
  source_status: DirectSeatSourceStatus;
  created_at: string;
  updated_at: string;
}

export interface DirectTicketRow {
  id: string;
  event_id: string;
  order_id: string | null;
  customer_account_id: string | null;
  performance_id: string;
  seat_id: string;
  ticket_class: string;
  holder_name: string;
  buyer_name: string;
  phone: string;
  email: string;
  price_amount: number;
  payment_status: DirectTicketPaymentStatus;
  payment_reference: string | null;
  payment_proof_mime: string | null;
  payment_proof_base64: string | null;
  payment_proof_submitted_at: string | null;
  rejection_reason: string | null;
  hold_expires_at: string | null;
  source: "admin" | "public";
  status: DirectTicketStatus;
  issued_by_user_id: string | null;
  payment_verified_by_user_id: string | null;
  payment_verified_at: string | null;
  issued_at: string | null;
  checked_in_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  performance_code?: string;
  performance_title?: string;
  performance_starts_at?: string;
  performance_ends_at?: string;
  zone?: string;
  row_label?: string;
  seat_label?: string;
}

export interface UpsertDirectPerformanceInput {
  event_id: string;
  code: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  seat_plan_image_url?: string | null;
  is_active?: boolean;
}

export interface ImportDirectSeatInput {
  zone: string;
  section_label?: string | null;
  row_label: string;
  seat_label: string;
  external_seat_ref?: string | null;
  ticket_class?: string | null;
  face_value?: number | null;
  x?: number | null;
  y?: number | null;
  allocation_status?: DirectSeatAllocationStatus;
  source_status?: DirectSeatSourceStatus;
}

export interface CreateDirectTicketInput {
  event_id: string;
  performance_id: string;
  seat_id: string;
  ticket_class: string;
  holder_name?: string | null;
  buyer_name?: string | null;
  phone?: string | null;
  email?: string | null;
  price_amount?: number | null;
  payment_required?: boolean;
  hold_minutes?: number | null;
  source?: "admin" | "public";
  issued_by_user_id?: string | null;
  customer_account_id?: string | null;
}

export type DirectOrderStatus = "pending_payment" | "payment_submitted" | "paid" | "rejected" | "expired" | "refunded" | "cancelled";
export type PaymentAttemptStatus = "pending" | "proof_submitted" | "verified" | "rejected" | "refunded";
export type OrganizerPaymentStatus = "draft" | "active" | "suspended";
export type OrganizerVatStatus = "not_registered" | "registered" | "exempt" | "unknown";
export type OrganizerBillingDocumentMode = "not_required" | "receipt" | "tax_invoice" | "e_tax";
export type OrganizerFeeType = "percent" | "fixed";
export type OrganizerFeePayer = "customer" | "organizer";
export type OrganizerPayoutMode = "direct_to_organizer" | "platform_settlement";
export type OrganizerPayoutSchedule = "manual" | "daily" | "weekly" | "monthly";
export type OrganizerPayoutStatus = "not_applicable" | "ready" | "blocked";
export type DirectOrderPayoutStatus = OrganizerPayoutStatus | "pending" | "paid";

export interface DirectOrderRow {
  id: string;
  event_id: string;
  performance_id: string;
  customer_account_id: string | null;
  buyer_name: string;
  phone: string;
  email: string;
  currency: string;
  subtotal_amount: number;
  platform_fee_amount: number;
  payment_fee_amount: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  fee_rule_version: string;
  tax_snapshot_json: string;
  billing_profile_json: string;
  seller_snapshot_json: string;
  seller_organization_id: string | null;
  payment_profile_version: number;
  payment_receiver_snapshot_json: string;
  payout_status: DirectOrderPayoutStatus;
  status: DirectOrderStatus;
  payment_reference: string | null;
  payment_proof_mime: string | null;
  payment_proof_base64: string | null;
  payment_proof_submitted_at: string | null;
  rejection_reason: string | null;
  hold_expires_at: string | null;
  billing_document_status: "not_required" | "pending" | "issued";
  billing_document_number: string | null;
  created_at: string;
  updated_at: string;
  performance_code?: string;
  performance_title?: string;
  performance_starts_at?: string;
  performance_ends_at?: string;
  tickets: DirectTicketRow[];
}

export interface CreateDirectOrderInput {
  event_id: string;
  performance_id: string;
  seat_ids: string[];
  customer_account_id?: string | null;
  buyer_name: string;
  phone: string;
  email: string;
  subtotal_amount: number;
  platform_fee_amount?: number;
  payment_fee_amount?: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount: number;
  fee_rule_version?: string;
  tax_snapshot_json?: string;
  billing_profile_json?: string;
  seller_snapshot_json?: string;
  seller_organization_id?: string | null;
  payment_profile_version?: number | null;
  payment_receiver_snapshot_json?: string;
  payout_status?: DirectOrderPayoutStatus;
  hold_minutes?: number;
  ticket_class?: string;
  source?: "admin" | "public";
}

export interface PaymentAttemptRow {
  id: string;
  order_id: string;
  attempt_number: number;
  method: "promptpay" | "scb_qr" | "manual";
  amount: number;
  status: PaymentAttemptStatus;
  transaction_reference: string | null;
  proof_mime: string | null;
  proof_base64: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerNotificationPreferencesRow {
  customer_account_id: string;
  email_transactional_enabled: boolean;
  sms_transactional_enabled: boolean;
  sms_marketing_enabled: boolean;
  sms_consent_at: string | null;
  sms_opted_out_at: string | null;
  updated_at: string;
}

export interface UpdateCustomerNotificationPreferencesInput {
  email_transactional_enabled?: boolean;
  sms_transactional_enabled?: boolean;
  sms_marketing_enabled?: boolean;
  sms_consent_at?: Date | null;
  sms_opted_out_at?: Date | null;
}

export type RegistrationEmailDeliveryStatus = "queued" | "sent" | "failed";

export interface RegistrationEmailDeliveryRow {
  id: string;
  registration_id: string;
  event_id: string;
  recipient_email: string;
  kind: string;
  provider: string | null;
  status: RegistrationEmailDeliveryStatus;
  subject: string;
  error_message: string | null;
  queued_at: string;
  sent_at: string | null;
  updated_at: string;
}

export interface CreateRegistrationEmailDeliveryInput {
  registration_id: string;
  event_id: string;
  recipient_email: string;
  kind: string;
  subject: string;
  provider?: string | null;
}

export type NotificationChannel = "email" | "sms";
export type NotificationDeliveryStatus = "queued" | "processing" | "sent" | "failed";

export interface NotificationDeliveryRow {
  id: string;
  channel: NotificationChannel;
  kind: string;
  recipient: string;
  recipient_snapshot: string | null;
  related_type: string | null;
  related_id: string | null;
  payload_json: string;
  idempotency_key: string;
  status: NotificationDeliveryStatus;
  attempt_count: number;
  available_at: string;
  locked_at: string | null;
  locked_by: string | null;
  provider: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  queued_at: string;
  sent_at: string | null;
  updated_at: string;
}

export interface CreateNotificationDeliveryInput {
  channel: NotificationChannel;
  kind: string;
  recipient: string;
  recipient_snapshot?: string | null;
  related_type?: string | null;
  related_id?: string | null;
  payload_json?: string | null;
  idempotency_key: string;
  provider?: string | null;
}

export type CustomerAccountStatus = "pending" | "active" | "disabled";
export type CustomerAccountTokenKind = "email_verification" | "password_reset";

export interface CustomerAccountRow {
  id: string;
  email: string;
  normalized_email: string;
  password_hash: string;
  email_verified_at: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  normalized_phone: string;
  address_line1: string | null;
  address_line2: string | null;
  district: string | null;
  subdistrict: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  accepted_terms_at: string;
  accepted_privacy_at: string;
  status: CustomerAccountStatus;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerAccountInput {
  email: string;
  normalized_email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string;
  normalized_phone: string;
  accepted_terms_at: Date;
  accepted_privacy_at: Date;
}

export interface UpdateCustomerProfileInput {
  first_name: string;
  last_name: string;
  phone: string;
  normalized_phone: string;
  address_line1?: string | null;
  address_line2?: string | null;
  district?: string | null;
  subdistrict?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface CustomerAccountSessionRow {
  session_id: string;
  token_hash: string;
  expires_at: string;
  last_seen_at: string;
  account: CustomerAccountRow;
}

export interface CreateCustomerAccountTokenInput {
  customer_account_id: string;
  kind: CustomerAccountTokenKind;
  token_hash: string;
  expires_at: Date;
}

export interface CustomerAccountTokenRow {
  id: string;
  customer_account_id: string;
  kind: CustomerAccountTokenKind;
  expires_at: string;
  created_at: string;
}

export interface AuthUserRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  organization_id: string;
  organization_name: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface UserPreferencesRow {
  user_id: string;
  language: "th" | "en";
  timezone: string;
  updated_at: string;
}

export interface AuthSessionRow {
  session_id: string;
  token_hash: string;
  expires_at: string;
  last_seen_at: string;
  user: AuthUserRow;
}

export interface CreateUserInput {
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
}

export interface AuditLogEntryInput {
  actor_user_id?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRow {
  id: number;
  action: string;
  actor_user_id: string | null;
  actor_username: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CheckinSessionRow {
  id: string;
  event_id: string;
  created_by_user_id: string | null;
  label: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  exchanged_at: string | null;
  revoked_at: string | null;
  is_active: boolean;
}

export interface CheckinAccessSessionRow {
  id: string;
  checkin_session_id: string;
  event_id: string;
  label: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  is_active: boolean;
}

export interface EventRow {
  id: string;
  name: string;
  slug: string;
  organizer_id: string;
  organizer_name?: string;
  status: ManualEventStatus;
  effective_status: EventStatus;
  event_date?: string;
  event_end_date?: string;
  event_timezone?: string;
  registration_availability?: "open" | "not_started" | "closed" | "invalid" | "full";
  registration_limit?: number | null;
  active_registration_count?: number;
  cancelled_registration_count?: number;
  remaining_seats?: number | null;
  is_capacity_full?: boolean;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventDeletionImpact {
  registrations: number;
  messages: number;
  documents: number;
  checkin_sessions: number;
  assigned_channels: number;
  legacy_pages: number;
}

export interface FacebookPageRow {
  id: string;
  page_id: string;
  page_name: string;
  event_id?: string | null;
  page_access_token?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChannelAccountRow {
  id: string;
  platform: ChannelPlatform;
  external_id: string;
  display_name: string;
  organizer_id: string;
  event_id?: string | null;
  event_ids?: string[];
  access_token?: string | null;
  is_active: boolean;
  config_json?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventDocumentRow {
  id: string;
  event_id: string;
  title: string;
  source_type: "note" | "document" | "url";
  source_url?: string | null;
  content: string;
  is_active: boolean;
  chunk_count?: number;
  content_hash?: string | null;
  embedding_status?: EmbeddingStatus;
  embedding_model?: string | null;
  last_embedded_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventDocumentChunkRow {
  id: string;
  document_id: string;
  event_id: string;
  chunk_index: number;
  content: string;
  content_hash?: string | null;
  char_count?: number;
  token_estimate?: number;
  embedding_status?: EmbeddingStatus;
  embedding_model?: string | null;
  embedded_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventDocumentChunkEmbeddingRow extends EventDocumentChunkRow {
  embedding_vector: number[] | null;
  embedding_dimensions: number | null;
}

export interface PersistChunkEmbeddingInput {
  chunk_id: string;
  content_hash?: string | null;
  embedding: number[];
}

export interface CreateEventInput {
  name: string;
  organizer_id?: string;
}

export interface UpdateEventInput {
  name?: string;
  status?: ManualEventStatus;
  organizer_id?: string;
}

export interface OrganizerProfileRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  public_display_name: string | null;
  public_description: string | null;
  public_logo_url: string | null;
  public_website_url: string | null;
  public_facebook_url: string | null;
  public_line_url: string | null;
  public_contact_text: string | null;
  verification_status: OrganizerVerificationStatus;
  verification_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizerFinancialProfileRow {
  organization_id: string;
  organizer_profile_id?: string;
  payment_method: "promptpay";
  promptpay_id: string | null;
  promptpay_receiver_name: string | null;
  payment_status: OrganizerPaymentStatus;
  legal_entity_type: "individual" | "company" | "partnership" | "other";
  tax_id: string | null;
  vat_status: OrganizerVatStatus;
  vat_rate_percent: number;
  registered_address: string | null;
  branch_number: string | null;
  billing_document_mode: OrganizerBillingDocumentMode;
  platform_fee_type: OrganizerFeeType;
  platform_fee_value: number;
  platform_fee_payer: OrganizerFeePayer;
  payment_fee_value: number;
  payout_mode: OrganizerPayoutMode;
  payout_schedule: OrganizerPayoutSchedule;
  payout_status: OrganizerPayoutStatus;
  pricing_policy_enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface UpdateOrganizerFinancialProfileInput {
  payment_method?: "promptpay";
  promptpay_id?: string | null;
  promptpay_receiver_name?: string | null;
  payment_status?: OrganizerPaymentStatus;
  legal_entity_type?: OrganizerFinancialProfileRow["legal_entity_type"];
  tax_id?: string | null;
  vat_status?: OrganizerVatStatus;
  vat_rate_percent?: number;
  registered_address?: string | null;
  branch_number?: string | null;
  billing_document_mode?: OrganizerBillingDocumentMode;
  platform_fee_type?: OrganizerFeeType;
  platform_fee_value?: number;
  platform_fee_payer?: OrganizerFeePayer;
  payment_fee_value?: number;
  payout_mode?: OrganizerPayoutMode;
  payout_schedule?: OrganizerPayoutSchedule;
  payout_status?: OrganizerPayoutStatus;
  pricing_policy_enabled?: boolean;
  clear_promptpay_id?: boolean;
}

export interface UpdateOrganizerProfileInput {
  legal_name?: string | null;
  public_display_name?: string | null;
  public_description?: string | null;
  public_logo_url?: string | null;
  public_website_url?: string | null;
  public_facebook_url?: string | null;
  public_line_url?: string | null;
  public_contact_text?: string | null;
  verification_status?: OrganizerVerificationStatus;
  verification_notes?: string | null;
}

export interface CreateOrganizerProfileInput extends UpdateOrganizerProfileInput {
  name: string;
  slug?: string;
}

export interface UpsertFacebookPageInput {
  page_id: string;
  page_name: string;
  event_id: string;
  page_access_token?: string;
  is_active?: boolean;
}

export interface UpsertChannelAccountInput {
  platform: ChannelPlatform;
  external_id: string;
  display_name: string;
  organizer_id?: string | null;
  event_id?: string | null;
  access_token?: string;
  is_active?: boolean;
  config_json?: string;
}

export interface UpsertEventDocumentInput {
  id?: string;
  event_id: string;
  title: string;
  source_type: "note" | "document" | "url";
  source_url?: string;
  content: string;
  is_active?: boolean;
}

export interface CreateCheckinSessionInput {
  event_id: string;
  label: string;
  created_by_user_id?: string | null;
  expires_at: Date;
  token_hash: string;
}

export interface ExchangeCheckinSessionTokenInput {
  checkin_token_hash: string;
  access_token_hash: string;
  max_session_ttl_ms: number;
}

export interface RecordLlmUsageInput {
  event_id?: string | null;
  actor_user_id?: string | null;
  source: string;
  provider: string;
  model: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  estimated_cost_usd?: number;
  metadata?: Record<string, unknown>;
}

export interface LlmUsageTotalsRow {
  request_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  last_used_at: string | null;
}

export interface LlmUsageModelSummaryRow extends LlmUsageTotalsRow {
  provider: string;
  model: string;
}

export interface LlmUsageSummaryRow {
  overall: LlmUsageTotalsRow;
  selected_event: LlmUsageTotalsRow;
  overall_models: LlmUsageModelSummaryRow[];
  selected_event_models: LlmUsageModelSummaryRow[];
}

export interface AppDatabase {
  driver: "postgres" | "sqlite";
  initialize(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
  getSettingsMap(eventId?: string): Promise<Record<string, string>>;
  getSettingValue(key: string, eventId?: string): Promise<string | undefined>;
  upsertSettings(entries: Record<string, string>, eventId?: string): Promise<void>;
  getRegistrationById(id: string): Promise<RegistrationRow | undefined>;
  listRegistrations(limit?: number, eventId?: string): Promise<RegistrationRow[]>;
  listRegistrationsBySenderIds(senderIds: string[], eventId?: string): Promise<RegistrationRow[]>;
  exportRegistrations(eventId?: string): Promise<RegistrationRow[]>;
  createRegistration(input: RegistrationInput): Promise<RegistrationResult>;
  listCustomerRegistrations(customerAccountId: string): Promise<RegistrationRow[]>;
  claimRegistrationToCustomer(input: { registration_id: string; customer_account_id: string; normalized_email?: string; normalized_phone?: string }): Promise<"claimed" | "already_claimed" | "not_found" | "contact_mismatch">;
  unlinkRegistrationFromCustomer(registrationId: string, customerAccountId?: string | null): Promise<boolean>;
  setRegistrationSmsConsent(id: string, optedIn: boolean, source: string): Promise<boolean>;
  createRegistrationEmailDelivery(input: CreateRegistrationEmailDeliveryInput): Promise<RegistrationEmailDeliveryRow | null>;
  markRegistrationEmailDeliverySent(id: string, provider?: string | null): Promise<void>;
  markRegistrationEmailDeliveryFailed(id: string, errorMessage: string, provider?: string | null): Promise<void>;
  enqueueNotificationDelivery(input: CreateNotificationDeliveryInput): Promise<NotificationDeliveryRow | null>;
  listNotificationDeliveries(options?: { related_type?: string; related_id?: string; kind?: string; limit?: number }): Promise<NotificationDeliveryRow[]>;
  claimNotificationDeliveries(workerId: string, limit?: number): Promise<NotificationDeliveryRow[]>;
  markNotificationDeliverySent(id: string, workerId: string, providerMessageId?: string | null, provider?: string | null): Promise<void>;
  markNotificationDeliveryRetryable(id: string, workerId: string, errorMessage: string, availableAt: string, provider?: string | null): Promise<void>;
  markNotificationDeliveryFailed(id: string, workerId: string, errorMessage: string, provider?: string | null): Promise<void>;
  getCustomerAccountById(id: string): Promise<CustomerAccountRow | undefined>;
  getCustomerAccountByNormalizedEmail(normalizedEmail: string): Promise<CustomerAccountRow | undefined>;
  listCustomerAccounts(limit?: number): Promise<CustomerAccountRow[]>;
  createCustomerAccount(input: CreateCustomerAccountInput): Promise<CustomerAccountRow>;
  updateCustomerProfile(id: string, input: UpdateCustomerProfileInput): Promise<CustomerAccountRow | undefined>;
  updateCustomerPasswordHash(id: string, passwordHash: string): Promise<boolean>;
  verifyCustomerAccountEmail(id: string): Promise<boolean>;
  updateCustomerAccountLastLogin(id: string): Promise<void>;
  setCustomerAccountStatus(id: string, status: CustomerAccountStatus): Promise<boolean>;
  createCustomerSession(customerAccountId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getCustomerSessionWithAccount(tokenHash: string): Promise<CustomerAccountSessionRow | undefined>;
  touchCustomerSession(sessionId: string): Promise<void>;
  deleteCustomerSession(tokenHash: string): Promise<void>;
  deleteCustomerSessions(customerAccountId: string): Promise<void>;
  deleteExpiredCustomerSessions(): Promise<void>;
  createCustomerAccountToken(input: CreateCustomerAccountTokenInput): Promise<CustomerAccountTokenRow>;
  consumeCustomerAccountToken(tokenHash: string, kind: CustomerAccountTokenKind): Promise<{ token_id: string; customer_account_id: string } | undefined>;
  deleteExpiredCustomerAccountTokens(): Promise<void>;
  getCustomerNotificationPreferences(customerAccountId: string): Promise<CustomerNotificationPreferencesRow>;
  updateCustomerNotificationPreferences(customerAccountId: string, input: UpdateCustomerNotificationPreferencesInput): Promise<CustomerNotificationPreferencesRow>;
  cancelRegistration(id: unknown): Promise<RegistrationResult>;
  checkInRegistration(id: string): Promise<boolean>;
  updateRegistrationStatus(id: string, status: RegistrationStatus): Promise<boolean>;
  deleteRegistration(id: string): Promise<boolean>;
  listDirectPerformances(eventId: string): Promise<DirectPerformanceRow[]>;
  upsertDirectPerformance(input: UpsertDirectPerformanceInput): Promise<DirectPerformanceRow>;
  deleteDirectPerformance(eventId: string, performanceId: string): Promise<DirectPerformanceDeleteResult | undefined>;
  resetDirectPerformance(eventId: string, performanceId: string): Promise<DirectPerformanceResetResult | undefined>;
  listDirectSeats(eventId: string, performanceId?: string): Promise<DirectSeatRow[]>;
  importDirectSeats(eventId: string, performanceId: string, seats: ImportDirectSeatInput[], options?: { replaceMissing?: boolean; replaceLayout?: boolean }): Promise<DirectSeatRow[]>;
  listDirectTickets(eventId: string): Promise<DirectTicketRow[]>;
  getDirectTicketById(id: string): Promise<DirectTicketRow | undefined>;
  createDirectTicket(input: CreateDirectTicketInput): Promise<{ ticket?: DirectTicketRow; error?: "seat_unavailable" | "invalid_seat" }>;
  createDirectOrder(input: CreateDirectOrderInput): Promise<{ order?: DirectOrderRow; error?: "seat_unavailable" | "invalid_seat" | "invalid_order" }>;
  getDirectOrderById(id: string): Promise<DirectOrderRow | undefined>;
  listDirectOrders(eventId: string): Promise<DirectOrderRow[]>;
  listCustomerOrders(customerAccountId: string): Promise<DirectOrderRow[]>;
  submitDirectOrderPaymentProof(id: string, input: { payment_proof_mime: string; payment_proof_base64: string; payment_reference?: string | null }): Promise<DirectOrderRow | undefined>;
  updateDirectOrderPayment(id: string, input: { payment_status: "verified" | "rejected" | "refunded"; payment_reference?: string | null; verified_by_user_id?: string | null; rejection_reason?: string | null }): Promise<DirectOrderRow | undefined>;
  releaseExpiredDirectOrderHolds(eventId?: string): Promise<number>;
  claimDirectOrderToCustomer(input: { order_id: string; customer_account_id: string; normalized_email?: string; normalized_phone?: string }): Promise<"claimed" | "already_claimed" | "not_found" | "contact_mismatch">;
  unlinkDirectOrderFromCustomer(orderId: string, customerAccountId?: string | null): Promise<boolean>;
  updateDirectTicketPayment(
    id: string,
    input: { payment_status: "verified" | "rejected" | "refunded"; payment_reference?: string | null; verified_by_user_id?: string | null; rejection_reason?: string | null },
  ): Promise<DirectTicketRow | undefined>;
  submitDirectTicketPaymentProof(
    id: string,
    input: { payment_proof_mime: string; payment_proof_base64: string; payment_reference?: string | null },
  ): Promise<DirectTicketRow | undefined>;
  releaseExpiredDirectTicketHolds(eventId?: string): Promise<number>;
  voidDirectTicket(id: string, options?: { releaseSeat?: boolean }): Promise<DirectTicketRow | undefined>;
  reissueDirectTicket(id: string, issuedByUserId?: string | null): Promise<DirectTicketRow | undefined>;
  checkInDirectTicket(id: string): Promise<{ ticket?: DirectTicketRow; alreadyCheckedIn: boolean }>;
  saveMessage(senderId: string, text: string, type: MessageType, eventId?: string, pageId?: string): Promise<number>;
  saveMessageAttachments(messageId: number, attachments: CreateMessageAttachmentInput[]): Promise<MessageAttachmentRow[]>;
  listMessageAttachments(messageIds: number[]): Promise<MessageAttachmentRow[]>;
  listMessages(limit: number, eventId?: string, beforeId?: number): Promise<MessageRow[]>;
  getMessageHistoryRows(senderId: string, limit: number, eventId?: string, pageId?: string): Promise<Array<{ text: string; type: MessageType }>>;
  getConversationRowsForSender(senderId: string, limit: number, eventId?: string, pageId?: string): Promise<MessageRow[]>;
  getEventSettingUpdatedAt(eventId: string, key: string): Promise<string | null>;
  listEvents(organizationId?: string): Promise<EventRow[]>;
  getEventById(eventId: string): Promise<EventRow | undefined>;
  createEvent(input: CreateEventInput): Promise<EventRow>;
  updateEvent(eventId: string, input: UpdateEventInput): Promise<boolean>;
  getOrganizerProfile(organizationId: string): Promise<OrganizerProfileRow | undefined>;
  updateOrganizerProfile(organizationId: string, input: UpdateOrganizerProfileInput): Promise<OrganizerProfileRow | undefined>;
  listOrganizerProfiles(organizationId: string): Promise<OrganizerProfileRow[]>;
  getOrganizerProfileById(organizerProfileId: string, organizationId: string): Promise<OrganizerProfileRow | undefined>;
  createOrganizerProfile(organizationId: string, input: CreateOrganizerProfileInput): Promise<OrganizerProfileRow>;
  updateOrganizerProfileById(organizerProfileId: string, organizationId: string, input: UpdateOrganizerProfileInput & { name?: string; slug?: string }): Promise<OrganizerProfileRow | undefined>;
  getOrganizerFinancialProfile(organizationId: string): Promise<OrganizerFinancialProfileRow | undefined>;
  updateOrganizerFinancialProfile(organizationId: string, input: UpdateOrganizerFinancialProfileInput): Promise<OrganizerFinancialProfileRow | undefined>;
  getOrganizerFinancialProfileByOrganizerId(organizerProfileId: string, organizationId: string): Promise<OrganizerFinancialProfileRow | undefined>;
  updateOrganizerFinancialProfileByOrganizerId(organizerProfileId: string, organizationId: string, input: UpdateOrganizerFinancialProfileInput): Promise<OrganizerFinancialProfileRow | undefined>;
  getEventDeletionImpact(eventId: string): Promise<EventDeletionImpact>;
  deleteEvent(eventId: string): Promise<boolean>;
  listOutreachCampaigns(eventId: string): Promise<OutreachCampaignRow[]>;
  getOutreachCampaign(id: string, eventId: string): Promise<OutreachCampaignRow | undefined>;
  createOutreachCampaign(input: CreateOutreachCampaignInput): Promise<OutreachCampaignRow>;
  updateOutreachCampaign(id: string, eventId: string, input: UpdateOutreachCampaignInput): Promise<OutreachCampaignRow | undefined>;
  listOutreachTargets(eventId: string, campaignId: string): Promise<OutreachTargetRow[]>;
  listOutreachTargetsForEvent(eventId: string): Promise<OutreachTargetRow[]>;
  getOutreachTarget(id: string, eventId: string): Promise<OutreachTargetRow | undefined>;
  createOutreachTarget(input: CreateOutreachTargetInput): Promise<OutreachTargetRow>;
  updateOutreachTarget(id: string, eventId: string, input: UpdateOutreachTargetInput): Promise<OutreachTargetRow | undefined>;
  deleteOutreachTarget(id: string, eventId: string): Promise<boolean>;
  bindOutreachTargetIdentity(id: string, eventId: string, pageId: string, senderId: string): Promise<OutreachTargetRow | undefined>;
  findOutreachTargetIdentityMatches(pageId: string, senderId: string, eventIds?: string[]): Promise<OutreachTargetRow[]>;
  markOutreachTargetReplied(id: string, eventId: string, repliedAt?: string): Promise<OutreachTargetRow | undefined>;
  listOutreachDrafts(targetId: string, eventId: string): Promise<OutreachDraftRow[]>;
  getOutreachDraft(id: string, eventId: string): Promise<OutreachDraftRow | undefined>;
  createOutreachDraft(input: CreateOutreachDraftInput): Promise<OutreachDraftRow>;
  approveOutreachDraft(id: string, eventId: string, userId: string): Promise<OutreachDraftRow | undefined>;
  listOutreachAssets(eventId: string, campaignId: string): Promise<OutreachAssetRow[]>;
  createOutreachAsset(input: CreateOutreachAssetInput): Promise<OutreachAssetRow>;
  listOutreachDeliveries(targetId: string, eventId: string): Promise<OutreachDeliveryRow[]>;
  getOutreachDeliveryByIdempotency(eventId: string, idempotencyKey: string): Promise<OutreachDeliveryRow | undefined>;
  createOutreachDelivery(input: CreateOutreachDeliveryInput): Promise<OutreachDeliveryRow>;
  updateOutreachDelivery(id: string, eventId: string, input: Partial<Pick<OutreachDeliveryRow, "status" | "external_message_id" | "error_message" | "sent_by_user_id">>): Promise<OutreachDeliveryRow | undefined>;
  listEventDocuments(eventId: string): Promise<EventDocumentRow[]>;
  listEventDocumentChunks(eventId: string): Promise<EventDocumentChunkRow[]>;
  listEventDocumentChunkEmbeddings(eventId: string): Promise<EventDocumentChunkEmbeddingRow[]>;
  upsertEventDocument(input: UpsertEventDocumentInput): Promise<EventDocumentRow>;
  resetEventKnowledge(
    eventId: string,
    options?: { clearContext?: boolean },
  ): Promise<{ documentsDeleted: number; chunksDeleted: number; contextCleared: boolean }>;
  setEventDocumentActive(documentId: string, isActive: boolean): Promise<boolean>;
  setEventDocumentEmbeddingStatus(
    documentId: string,
    status: EmbeddingStatus,
    options?: { embeddingModel?: string; embeddedAt?: Date | null },
  ): Promise<boolean>;
  saveEventDocumentChunkEmbeddings(
    documentId: string,
    embeddings: PersistChunkEmbeddingInput[],
    options?: { embeddingModel?: string; embeddedAt?: Date | null },
  ): Promise<number>;
  listChannelAccounts(platform?: ChannelPlatform): Promise<ChannelAccountRow[]>;
  getChannelAccount(platform: ChannelPlatform, externalId: string): Promise<ChannelAccountRow | undefined>;
  upsertChannelAccount(input: UpsertChannelAccountInput): Promise<ChannelAccountRow>;
  updateChannelAccount(
    originalPlatform: ChannelPlatform,
    originalExternalId: string,
    input: UpsertChannelAccountInput,
  ): Promise<ChannelAccountRow>;
  assignChannelAccount(channelId: string, eventId: string): Promise<ChannelAccountRow | undefined>;
  unassignChannelAccount(channelId: string, eventId?: string): Promise<ChannelAccountRow | undefined>;
  listEventIdsForChannel(platform: ChannelPlatform, externalId: string): Promise<string[]>;
  getChannelSenderEventSelection(channelId: string, senderId: string): Promise<string | undefined>;
  setChannelSenderEventSelection(channelId: string, senderId: string, eventId?: string): Promise<void>;
  resolveEventIdForChannel(platform: ChannelPlatform, externalId: string): Promise<string | undefined>;
  listFacebookPages(): Promise<FacebookPageRow[]>;
  getFacebookPageByPageId(pageId: string): Promise<FacebookPageRow | undefined>;
  upsertFacebookPage(input: UpsertFacebookPageInput): Promise<FacebookPageRow>;
  resolveEventIdForPage(pageId: string): Promise<string | undefined>;
  getUserByUsername(username: string): Promise<AuthUserRow | undefined>;
  getUserById(userId: string): Promise<AuthUserRow | undefined>;
  isUserAssignedToEvent(userId: string, eventId: string): Promise<boolean>;
  getUserPasswordHash(username: string): Promise<string | undefined>;
  updateUserPasswordHash(userId: string, passwordHash: string): Promise<boolean>;
  getUserPreferences(userId: string): Promise<UserPreferencesRow | undefined>;
  upsertUserPreferences(userId: string, input: { language: "th" | "en"; timezone: string }): Promise<UserPreferencesRow>;
  listUsers(): Promise<AuthUserRow[]>;
  createUser(input: CreateUserInput): Promise<AuthUserRow>;
  updateUserRole(userId: string, role: UserRole): Promise<boolean>;
  setUserActive(userId: string, isActive: boolean): Promise<boolean>;
  removeUser(userId: string): Promise<boolean>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getSessionWithUser(tokenHash: string): Promise<AuthSessionRow | undefined>;
  touchSession(sessionId: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;
  updateUserLastLogin(userId: string): Promise<void>;
  recordAuditLog(entry: AuditLogEntryInput): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogRow[]>;
  recordLlmUsage(entry: RecordLlmUsageInput): Promise<void>;
  getLlmUsageSummary(eventId?: string): Promise<LlmUsageSummaryRow>;
  listCheckinSessions(eventId: string): Promise<CheckinSessionRow[]>;
  createCheckinSession(input: CreateCheckinSessionInput): Promise<CheckinSessionRow>;
  getCheckinSessionByTokenHash(tokenHash: string): Promise<CheckinSessionRow | undefined>;
  exchangeCheckinSessionToken(input: ExchangeCheckinSessionTokenInput): Promise<CheckinAccessSessionRow | undefined>;
  getCheckinAccessSessionByTokenHash(tokenHash: string): Promise<CheckinAccessSessionRow | undefined>;
  touchCheckinAccessSession(sessionId: string): Promise<void>;
  touchCheckinSession(sessionId: string): Promise<void>;
  revokeCheckinSession(sessionId: string): Promise<boolean>;
  deleteExpiredCheckinSessions(): Promise<void>;
  deleteExpiredCheckinAccessSessions(): Promise<void>;
}
