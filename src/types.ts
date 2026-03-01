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
export type ChannelPlatform = "facebook" | "line_oa" | "whatsapp" | "telegram";

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

export interface EventRecord {
  id: string;
  name: string;
  slug: string;
  status: ManualEventStatus;
  effective_status: EventStatus;
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
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}

export interface EventDocumentChunkRecord {
  id: string;
  document_id: string;
  event_id: string;
  chunk_index: number;
  content: string;
  created_at: string;
  updated_at: string;
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
