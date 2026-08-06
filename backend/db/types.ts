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

export interface DirectSeatRow {
  id: string;
  event_id: string;
  performance_id: string;
  zone: string;
  section_label: string | null;
  row_label: string;
  seat_label: string;
  external_seat_ref: string | null;
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
  createRegistrationEmailDelivery(input: CreateRegistrationEmailDeliveryInput): Promise<RegistrationEmailDeliveryRow | null>;
  markRegistrationEmailDeliverySent(id: string, provider?: string | null): Promise<void>;
  markRegistrationEmailDeliveryFailed(id: string, errorMessage: string, provider?: string | null): Promise<void>;
  cancelRegistration(id: unknown): Promise<RegistrationResult>;
  checkInRegistration(id: string): Promise<boolean>;
  updateRegistrationStatus(id: string, status: RegistrationStatus): Promise<boolean>;
  deleteRegistration(id: string): Promise<boolean>;
  listDirectPerformances(eventId: string): Promise<DirectPerformanceRow[]>;
  upsertDirectPerformance(input: UpsertDirectPerformanceInput): Promise<DirectPerformanceRow>;
  deleteDirectPerformance(eventId: string, performanceId: string): Promise<DirectPerformanceDeleteResult | undefined>;
  resetDirectPerformance(eventId: string, performanceId: string): Promise<{ tickets: number; seats: number } | undefined>;
  listDirectSeats(eventId: string, performanceId?: string): Promise<DirectSeatRow[]>;
  importDirectSeats(eventId: string, performanceId: string, seats: ImportDirectSeatInput[], options?: { replaceMissing?: boolean; replaceLayout?: boolean }): Promise<DirectSeatRow[]>;
  listDirectTickets(eventId: string): Promise<DirectTicketRow[]>;
  getDirectTicketById(id: string): Promise<DirectTicketRow | undefined>;
  createDirectTicket(input: CreateDirectTicketInput): Promise<{ ticket?: DirectTicketRow; error?: "seat_unavailable" | "invalid_seat" }>;
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
  listEvents(): Promise<EventRow[]>;
  getEventById(eventId: string): Promise<EventRow | undefined>;
  createEvent(input: CreateEventInput): Promise<EventRow>;
  updateEvent(eventId: string, input: UpdateEventInput): Promise<boolean>;
  getOrganizerProfile(organizationId: string): Promise<OrganizerProfileRow | undefined>;
  updateOrganizerProfile(organizationId: string, input: UpdateOrganizerProfileInput): Promise<OrganizerProfileRow | undefined>;
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
