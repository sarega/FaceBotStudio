export interface Message {
  id?: number;
  sender_id: string;
  text: string;
  timestamp: string;
  type: "incoming" | "outgoing";
}

export type UserRole = "owner" | "admin" | "operator" | "checker" | "viewer";

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

export interface Settings {
  context: string;
  llm_model: string;
  verify_token: string;
  event_name: string;
  event_location: string;
  event_map_url: string;
  event_date: string;
  event_description: string;
  event_travel: string;
  reg_limit: string;
  reg_start: string;
  reg_end: string;
}
