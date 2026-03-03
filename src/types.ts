export interface Message {
  id?: number;
  sender_id: string;
  event_id?: string | null;
  page_id?: string | null;
  text: string;
  timestamp: string;
  type: "incoming" | "outgoing";
}

export type UserRole = "owner" | "admin" | "operator" | "checker" | "viewer";
export type ManualEventStatus = "pending" | "active" | "cancelled";
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
  event_status: EventStatus;
  expires_at: string;
  last_used_at: string | null;
}

export interface EventRecord {
  id: string;
  name: string;
  slug: string;
  status: ManualEventStatus;
  effective_status: EventStatus;
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
  event_id: string;
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
  event_id: string;
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
  verify_token: string;
  event_name: string;
  event_timezone: string;
  event_location: string;
  event_map_url: string;
  event_date: string;
  event_description: string;
  event_travel: string;
  reg_limit: string;
  reg_start: string;
  reg_end: string;
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
