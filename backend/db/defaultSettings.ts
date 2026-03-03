export const DEFAULT_SETTINGS_ENTRIES = {
  context: "",
  llm_model: "",
  global_system_prompt: "You are a helpful assistant for an event registration system. Be polite, concise, and operationally accurate.",
  global_llm_model: process.env.OPENROUTER_DEFAULT_MODEL || "google/gemini-3-flash-preview",
  verify_token: "my_secret_verify_token",
  event_name: "AI Innovation Summit 2026",
  event_timezone: process.env.EVENT_TIMEZONE || "Asia/Bangkok",
  event_location: "Grand Ballroom, Tech Plaza",
  event_map_url: "https://maps.app.goo.gl/example",
  event_date: "2026-05-15T09:00",
  event_end_date: "2026-05-15T17:00",
  event_description: "A gathering of AI enthusiasts and experts.",
  event_travel: "Take the SkyTrain to Tech Station, Exit 3.",
  confirmation_email_enabled: "0",
  confirmation_email_subject: "Your registration for {{event_name}}",
  reg_limit: "200",
  reg_start: "2026-02-01T00:00",
  reg_end: "2026-05-01T23:59",
} as const;

export const NEW_EVENT_TEMPLATE_ENTRIES = {
  context: "",
  llm_model: "",
  event_name: "",
  event_timezone: process.env.EVENT_TIMEZONE || "Asia/Bangkok",
  event_location: "",
  event_map_url: "",
  event_date: "",
  event_end_date: "",
  event_description: "",
  event_travel: "",
  confirmation_email_enabled: DEFAULT_SETTINGS_ENTRIES.confirmation_email_enabled,
  confirmation_email_subject: DEFAULT_SETTINGS_ENTRIES.confirmation_email_subject,
  reg_limit: DEFAULT_SETTINGS_ENTRIES.reg_limit,
  reg_start: "",
  reg_end: "",
} as const;

export const EVENT_SETTING_KEYS = [
  "context",
  "llm_model",
  "event_name",
  "event_timezone",
  "event_location",
  "event_map_url",
  "event_date",
  "event_end_date",
  "event_description",
  "event_travel",
  "confirmation_email_enabled",
  "confirmation_email_subject",
  "reg_limit",
  "reg_start",
  "reg_end",
] as const;

export const GLOBAL_SETTING_KEYS = ["verify_token", "global_system_prompt", "global_llm_model"] as const;

export const DEFAULT_EVENT_ID = "evt_default";
