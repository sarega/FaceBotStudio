export interface Message {
  id?: number;
  sender_id: string;
  text: string;
  timestamp: string;
  type: "incoming" | "outgoing";
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
