import type { EmailTemplateKind } from "./lib/emailTemplateCatalog";

export interface Message {
  id?: number;
  sender_id: string;
  event_id?: string | null;
  page_id?: string | null;
  platform?: ChannelPlatform | null;
  channel_display_name?: string | null;
  sender_name?: string | null;
  sender_phone?: string | null;
  sender_email?: string | null;
  registration_id?: string | null;
  text: string;
  timestamp: string;
  type: "incoming" | "outgoing";
}

export type UserRole = "owner" | "admin" | "operator" | "checker" | "viewer";
export type ManualEventStatus = "pending" | "active" | "inactive" | "cancelled" | "archived";
export type EventStatus = ManualEventStatus | "closed";
export type ChannelPlatform = "facebook" | "line_oa" | "instagram" | "whatsapp" | "telegram" | "web_chat";
export type EmbeddingStatus = "pending" | "ready" | "failed" | "skipped";

export interface AuthUser {
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

export interface CheckinSessionRecord {
  id: string;
  event_id: string;
  created_by_user_id: string | null;
  label: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  exchanged_at?: string | null;
  revoked_at: string | null;
  is_active: boolean;
}

export interface CheckinAccessSession {
  id: string;
  label: string;
  event_id: string;
  event_name: string;
  event_location: string;
  event_timezone: string;
  event_date: string;
  event_end_date?: string;
  event_status: EventStatus;
  expires_at: string;
  last_used_at: string | null;
}

export interface EventRecord {
  id: string;
  name: string;
  slug: string;
  poster_url?: string;
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

export interface FacebookPageRecord {
  id: string;
  page_id: string;
  page_name: string;
  event_id?: string | null;
  is_active: boolean;
  has_page_access_token?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChannelAccountRecord {
  id: string;
  platform: ChannelPlatform;
  external_id: string;
  display_name: string;
  event_id?: string | null;
  is_active: boolean;
  has_access_token?: boolean;
  platform_label?: string;
  platform_description?: string;
  live_messaging_ready?: boolean;
  connection_status?: "ready" | "partial" | "incomplete";
  missing_requirements?: string[];
  config?: Record<string, string>;
  config_summary?: Array<{ key: string; label: string; value: string }>;
  secret_config_fields_present?: string[];
  created_at: string;
  updated_at: string;
}

export interface ChannelPlatformFieldDefinition {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  secret?: boolean;
}

export interface ChannelPlatformDefinition {
  id: ChannelPlatform;
  label: string;
  description: string;
  external_id_label: string;
  external_id_placeholder: string;
  access_token_label: string;
  access_token_required: boolean;
  access_token_help?: string;
  config_fields: ChannelPlatformFieldDefinition[];
  live_messaging_ready: boolean;
  notes: string[];
}

export interface EventDocumentRecord {
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

export interface EventDocumentChunkRecord {
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

export interface RetrievalDebugMatch {
  rank: number;
  score: number;
  lexical_score?: number;
  vector_score?: number | null;
  strategy?: "lexical" | "vector" | "hybrid";
  document_id: string;
  document_title: string;
  source_type: "note" | "document" | "url";
  source_url?: string | null;
  chunk_index: number;
  chunk_content: string;
}

export interface RetrievalDebugResponse {
  event_id: string;
  query: string;
  layers: {
    global_system_prompt_present: boolean;
    global_system_prompt_chars: number;
    event_context_present: boolean;
    event_context_chars: number;
    retrieval_mode?: "none" | "lexical" | "hybrid";
    query_embedding_model?: string | null;
    active_document_count: number;
    active_chunk_count: number;
    vector_ready_chunk_count?: number;
  };
  matches: RetrievalDebugMatch[];
  composed_knowledge_context: string;
}

export interface EmbeddingPreviewChunk {
  id: string;
  chunk_index: number;
  content: string;
  content_hash?: string | null;
  char_count?: number;
  token_estimate?: number;
  embedding_status?: EmbeddingStatus;
  embedding_model?: string | null;
}

export interface EmbeddingPreviewResponse {
  event_id: string;
  embedding_model: string;
  document: EventDocumentRecord;
  chunks: EmbeddingPreviewChunk[];
  payload: {
    event_id: string;
    document_id: string;
    document_title: string;
    source_type: string;
    source_url?: string | null;
    document_content_hash?: string | null;
    embedding_model: string;
    items: Array<{
      chunk_id: string;
      chunk_index: number;
      text: string;
      metadata: {
        event_id: string;
        document_id: string;
        document_title: string;
        source_type: string;
        source_url?: string | null;
        content_hash?: string | null;
        char_count: number;
        token_estimate: number;
        embedding_status: EmbeddingStatus;
      };
    }>;
  };
}

export interface Settings {
  context: string;
  llm_model: string;
  global_system_prompt: string;
  global_llm_model: string;
  admin_agent_enabled: string;
  admin_agent_system_prompt: string;
  admin_agent_model: string;
  admin_agent_default_event_id: string;
  admin_agent_policy_read_event: string;
  admin_agent_policy_manage_event_setup: string;
  admin_agent_policy_manage_event_status: string;
  admin_agent_policy_manage_event_context: string;
  admin_agent_policy_read_registration: string;
  admin_agent_policy_manage_registration: string;
  admin_agent_policy_message_user: string;
  admin_agent_policy_search_all_events: string;
  admin_agent_telegram_enabled: string;
  admin_agent_telegram_bot_token: string;
  admin_agent_telegram_webhook_secret: string;
  admin_agent_telegram_allowed_chat_ids: string;
  admin_agent_notification_enabled: string;
  admin_agent_notification_on_registration_created: string;
  admin_agent_notification_on_registration_status_changed: string;
  admin_agent_notification_scope: string;
  admin_agent_notification_event_id: string;
  verify_token: string;
  event_name: string;
  event_timezone: string;
  event_venue_name: string;
  event_room_detail: string;
  event_location: string;
  event_map_url: string;
  event_date: string;
  event_end_date: string;
  event_description: string;
  event_travel: string;
  event_public_page_enabled: string;
  event_public_show_seat_availability: string;
  event_public_slug: string;
  event_public_poster_url: string;
  event_public_summary: string;
  event_public_registration_enabled: string;
  event_public_ticket_recovery_mode: string;
  event_public_bot_enabled: string;
  event_public_success_message: string;
  event_public_cta_label: string;
  event_public_privacy_enabled: string;
  event_public_privacy_label: string;
  event_public_privacy_text: string;
  event_public_contact_enabled: string;
  event_public_contact_intro: string;
  event_public_contact_messenger_url: string;
  event_public_contact_line_url: string;
  event_public_contact_phone: string;
  event_public_contact_hours: string;
  confirmation_email_enabled: string;
  confirmation_email_subject: string;
  email_template_registration_confirmation_subject: string;
  email_template_registration_confirmation_html: string;
  email_template_registration_confirmation_text: string;
  email_template_ticket_delivery_subject: string;
  email_template_ticket_delivery_html: string;
  email_template_ticket_delivery_text: string;
  email_template_payment_confirmation_subject: string;
  email_template_payment_confirmation_html: string;
  email_template_payment_confirmation_text: string;
  email_template_event_update_subject: string;
  email_template_event_update_html: string;
  email_template_event_update_text: string;
  email_template_magic_link_login_subject: string;
  email_template_magic_link_login_html: string;
  email_template_magic_link_login_text: string;
  reg_unique_name: string;
  reg_limit: string;
  reg_start: string;
  reg_end: string;
}

export interface AdminEmailTestResult {
  eventId: string;
  kind: EmailTemplateKind;
  to: string;
  subject: string;
  provider: string;
  success: boolean;
  attemptedAt: string;
  error: string | null;
}

export interface AdminEmailStatusResponse {
  provider: string;
  configured: boolean;
  hasApiKey: boolean;
  hasFrom: boolean;
  hasReplyTo: boolean;
  hasAppUrl: boolean;
  missingFields: string[];
  fromAddress: string;
  replyToAddress: string;
  appUrl: string;
  readiness: "ready" | "missing_config" | "invalid_config";
  errorMessage: string | null;
  lastTestResult: AdminEmailTestResult | null;
}

export interface AdminEmailTestResponse {
  success: boolean;
  kind: EmailTemplateKind;
  provider: string;
  to: string;
  subject: string;
  sentAt: string;
  error: string | null;
}

export interface LlmUsageTotals {
  request_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  last_used_at: string | null;
}

export interface LlmUsageModelSummary extends LlmUsageTotals {
  provider: string;
  model: string;
}

export interface LlmUsageSummary {
  overall: LlmUsageTotals;
  selected_event: LlmUsageTotals;
  overall_models: LlmUsageModelSummary[];
  selected_event_models: LlmUsageModelSummary[];
}

export interface PublicEventPageResponse {
  event: {
    id: string;
    name: string;
    slug: string;
    status: EventStatus;
    summary: string;
    description: string;
    poster_url: string;
    cta_label: string;
    success_message: string;
    date: string;
    end_date: string;
    date_label: string;
    timezone: string;
    registration_enabled: boolean;
    ticket_recovery_mode: "shared_contact" | "verified_contact";
    show_seat_availability: boolean;
    registration_availability: "open" | "not_started" | "closed" | "invalid" | "full";
    registration_limit: number | null;
    active_registration_count: number;
    remaining_seats: number | null;
    is_capacity_full: boolean;
    confirmation_email_enabled: boolean;
  };
  location: {
    venue_name: string;
    room_detail: string;
    address: string;
    title: string;
    address_line: string;
    compact: string;
    travel_info: string;
    map_url: string;
  };
  privacy: {
    enabled: boolean;
    label: string;
    text: string;
  };
  contact: {
    enabled: boolean;
    intro: string;
    messenger_url: string;
    line_url: string;
    phone: string;
    hours: string;
  };
  support: {
    bot_enabled: boolean;
  };
}

export interface PublicEventRecoveredRegistrationResponse {
  status: "success" | "duplicate" | "recovered";
  message: string;
  success_message: string;
  recovery_mode: "shared_contact" | "verified_contact";
  email_backup_enabled: boolean;
  map_url: string;
  registration: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
  };
  ticket: {
    png_url: string;
    svg_url: string;
  };
  event: {
    name: string;
    date_label: string;
    location: string;
  };
}

export interface PublicEventNameVerificationRequiredResponse {
  status: "name_verification_required";
  message: string;
  recovery_mode: "shared_contact";
  requires_name_verification: true;
  candidate_count: number;
}

export interface PublicEventVerificationRequiredResponse {
  status: "verification_required";
  message: string;
  recovery_mode: "verified_contact";
  verification_channel: "otp_or_reference";
}

export type PublicEventRegistrationResponse =
  | PublicEventRecoveredRegistrationResponse
  | PublicEventNameVerificationRequiredResponse
  | PublicEventVerificationRequiredResponse;

export interface PublicEventChatResponse {
  status: "ok";
  reply_text: string;
  map_url: string | null;
  latest_message_id: number | null;
  tickets: Array<{
    registration_id: string;
    summary_text: string;
    png_url: string | null;
    svg_url: string | null;
  }>;
}

export interface PublicEventChatHistoryResponse {
  sender_id: string;
  latest_message_id: number | null;
  items: Message[];
}

export type PublicInboxConversationStatus = "open" | "waiting-admin" | "waiting-user" | "resolved";

export interface PublicInboxConversationSummary {
  sender_id: string;
  event_id: string;
  public_slug: string;
  participant_label: string;
  sender_name: string | null;
  sender_phone: string | null;
  sender_email: string | null;
  registration_id: string | null;
  status: PublicInboxConversationStatus;
  needs_attention: boolean;
  attention_reason: string | null;
  last_message_text: string;
  last_message_type: "incoming" | "outgoing";
  last_message_at: string;
  last_incoming_at: string | null;
  last_outgoing_at: string | null;
  message_count: number;
}

export interface PublicInboxConversationDetailResponse {
  conversation: PublicInboxConversationSummary;
  messages: Message[];
}

export interface PublicInboxReplyResponse {
  status: "ok";
  sender_id: string;
  conversation_status: PublicInboxConversationStatus;
  message: Message;
}
