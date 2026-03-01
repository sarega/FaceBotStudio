import type { ChannelPlatform } from "./db/types";

export type ChannelConfigFieldDefinition = {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  secret?: boolean;
};

export type ChannelPlatformDefinition = {
  id: ChannelPlatform;
  label: string;
  description: string;
  external_id_label: string;
  external_id_placeholder: string;
  access_token_label: string;
  access_token_required: boolean;
  access_token_help?: string;
  config_fields: ChannelConfigFieldDefinition[];
  live_messaging_ready: boolean;
  notes: string[];
};

export const CHANNEL_PLATFORM_DEFINITIONS: Record<ChannelPlatform, ChannelPlatformDefinition> = {
  facebook: {
    id: "facebook",
    label: "Facebook Messenger",
    description: "Meta Page messaging via Facebook webhook + Graph API.",
    external_id_label: "Page ID",
    external_id_placeholder: "Facebook Page ID",
    access_token_label: "Page Access Token",
    access_token_required: false,
    access_token_help: "Optional if PAGE_ACCESS_TOKEN env fallback is still used.",
    config_fields: [
      {
        key: "meta_app_id",
        label: "Meta App ID",
        placeholder: "Optional Meta App ID",
      },
    ],
    live_messaging_ready: true,
    notes: [
      "Currently wired into live inbound/outbound messaging.",
      "Can still fall back to PAGE_ACCESS_TOKEN if a page-level token is not saved.",
    ],
  },
  line_oa: {
    id: "line_oa",
    label: "LINE OA",
    description: "LINE Official Account messaging.",
    external_id_label: "Channel ID / OA ID",
    external_id_placeholder: "LINE channel or OA identifier",
    access_token_label: "Channel Access Token",
    access_token_required: true,
    access_token_help: "Use the long-lived Messaging API channel access token.",
    config_fields: [
      {
        key: "channel_secret",
        label: "Channel Secret",
        placeholder: "LINE Channel Secret",
        required: true,
        secret: true,
      },
    ],
    live_messaging_ready: true,
    notes: [
      "Webhook verification and outbound reply groundwork are wired in this phase.",
      "Keep both access token and channel secret server-side.",
    ],
  },
  instagram: {
    id: "instagram",
    label: "Instagram Messaging",
    description: "Meta Instagram Business messaging via Graph API.",
    external_id_label: "Instagram Business Account ID",
    external_id_placeholder: "Instagram business account ID",
    access_token_label: "Instagram Access Token",
    access_token_required: true,
    access_token_help: "Use a Meta token scoped for the connected Instagram Business account.",
    config_fields: [
      {
        key: "page_id",
        label: "Connected Facebook Page ID",
        placeholder: "Linked Facebook Page ID",
        required: true,
      },
    ],
    live_messaging_ready: true,
    notes: [
      "Instagram webhook + outbound text/image path are wired in this phase.",
      "Use the Instagram business account ID as the channel external ID.",
    ],
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp Business",
    description: "WhatsApp Business Platform / Cloud API.",
    external_id_label: "Phone Number ID",
    external_id_placeholder: "WhatsApp phone number ID",
    access_token_label: "Permanent Access Token",
    access_token_required: true,
    access_token_help: "Use the Cloud API permanent or system-user token.",
    config_fields: [
      {
        key: "business_account_id",
        label: "Business Account ID",
        placeholder: "WhatsApp business account ID",
        required: true,
      },
    ],
    live_messaging_ready: false,
    notes: [
      "Groundwork only in this phase. Webhook and outbound sender are not wired yet.",
      "Phone number ID and business account ID should stay tied to the same event mapping.",
    ],
  },
  telegram: {
    id: "telegram",
    label: "Telegram Bot",
    description: "Telegram bot webhook + outbound API.",
    external_id_label: "Bot Username or Bot ID",
    external_id_placeholder: "@your_bot or numeric bot ID",
    access_token_label: "Bot Token",
    access_token_required: true,
    access_token_help: "Use the bot token from BotFather.",
    config_fields: [
      {
        key: "webhook_secret",
        label: "Webhook Secret",
        placeholder: "Optional webhook secret path/token",
        secret: true,
      },
    ],
    live_messaging_ready: false,
    notes: [
      "Groundwork only in this phase. Telegram webhook/send adapters are not wired yet.",
    ],
  },
  web_chat: {
    id: "web_chat",
    label: "Web Chat Widget",
    description: "Embeddable website chat widget backed by the same event AI flow.",
    external_id_label: "Widget Key",
    external_id_placeholder: "public widget key, e.g. retreat-main-site",
    access_token_label: "",
    access_token_required: false,
    config_fields: [
      {
        key: "allowed_origin",
        label: "Allowed Origin",
        placeholder: "https://example.com",
        help: "Optional. If set, only this website origin can call the public web chat endpoint.",
      },
      {
        key: "welcome_text",
        label: "Welcome Text",
        placeholder: "สวัสดีค่ะ มีอะไรให้ช่วยเกี่ยวกับงานนี้ได้บ้าง",
        help: "Optional default greeting for the future embedded widget.",
      },
      {
        key: "theme_color",
        label: "Theme Color",
        placeholder: "#2563eb",
        help: "Optional accent color for the future widget UI.",
      },
    ],
    live_messaging_ready: true,
    notes: [
      "Public message endpoint is wired in this phase for future embed use.",
      "Use Allowed Origin to lock the widget to your own website.",
    ],
  },
};

export const ALLOWED_CHANNEL_PLATFORMS = Object.keys(
  CHANNEL_PLATFORM_DEFINITIONS,
) as ChannelPlatform[];

export function getChannelPlatformDefinition(platform: ChannelPlatform) {
  return CHANNEL_PLATFORM_DEFINITIONS[platform];
}

export function safeParseChannelConfig(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return {} as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key, item]) => typeof key === "string" && typeof item === "string")
        .map(([key, item]) => [key, String(item).trim()]),
    ) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
}

export function sanitizeChannelConfig(platform: ChannelPlatform, input: unknown) {
  const definition = getChannelPlatformDefinition(platform);
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : safeParseChannelConfig(typeof input === "string" ? input : "");

  const normalized: Record<string, string> = {};
  for (const field of definition.config_fields) {
    const rawValue = source[field.key];
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (!trimmed) continue;
    normalized[field.key] = trimmed;
  }
  return normalized;
}

export function getChannelMissingRequirements(
  platform: ChannelPlatform,
  input: { hasAccessToken: boolean; config: Record<string, string> },
) {
  const definition = getChannelPlatformDefinition(platform);
  const missing: string[] = [];

  if (definition.access_token_required && !input.hasAccessToken) {
    missing.push(definition.access_token_label);
  }

  for (const field of definition.config_fields) {
    if (field.required && !String(input.config[field.key] || "").trim()) {
      missing.push(field.label);
    }
  }

  return missing;
}

export function getChannelConnectionStatus(
  platform: ChannelPlatform,
  input: { hasAccessToken: boolean; config: Record<string, string> },
) {
  const missing = getChannelMissingRequirements(platform, input);
  if (!missing.length) {
    return platform === "facebook" && !input.hasAccessToken ? "partial" : "ready";
  }

  if (platform === "facebook" && missing.length === 0) {
    return "partial";
  }

  return input.hasAccessToken || Object.keys(input.config).length > 0 ? "partial" : "incomplete";
}

export function getChannelConfigSummary(platform: ChannelPlatform, config: Record<string, string>) {
  const definition = getChannelPlatformDefinition(platform);
  return definition.config_fields
    .filter((field) => !field.secret && String(config[field.key] || "").trim())
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: config[field.key],
    }));
}

export function getPresentSecretConfigFields(platform: ChannelPlatform, config: Record<string, string>) {
  const definition = getChannelPlatformDefinition(platform);
  return definition.config_fields
    .filter((field) => field.secret && String(config[field.key] || "").trim())
    .map((field) => field.label);
}
