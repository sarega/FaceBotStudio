export type SmsProviderConfig = {
  enabled: boolean;
  url: string;
  token: string;
  senderId: string;
  ready: boolean;
  errorMessage: string | null;
};

export type ProviderSmsInput = {
  to: string;
  message: string;
};

export type ProviderSmsSendResult = {
  provider: string;
  providerMessageId: string | null;
  responseBody: unknown;
};

function text(value: unknown) {
  return String(value || "").trim();
}

function enabled(value: unknown) {
  return ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
}

export function getSmsConfig(env: NodeJS.ProcessEnv = process.env): SmsProviderConfig {
  const isEnabled = enabled(env.SMS_NOTIFICATION_ENABLED);
  const url = text(env.SMS_PROVIDER_URL);
  const token = text(env.SMS_PROVIDER_TOKEN);
  const senderId = text(env.SMS_SENDER_ID);
  const missing = [
    !url ? "SMS_PROVIDER_URL" : "",
    !token ? "SMS_PROVIDER_TOKEN" : "",
    !senderId ? "SMS_SENDER_ID" : "",
  ].filter(Boolean);
  return {
    enabled: isEnabled,
    url,
    token,
    senderId,
    ready: isEnabled && missing.length === 0,
    errorMessage: !isEnabled
      ? "SMS notifications are disabled"
      : missing.length > 0
        ? `SMS provider is not configured. Missing: ${missing.join(", ")}`
        : null,
  };
}

async function readResponseBody(response: Response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function providerMessageId(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["id", "message_id", "messageId"]) {
    const value = text(record[key]);
    if (value) return value;
  }
  return null;
}

function providerError(body: unknown) {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      const value = text(record[key]);
      if (value) return value;
    }
  }
  return "SMS provider request failed";
}

export async function sendProviderSms(
  input: ProviderSmsInput,
  config: SmsProviderConfig = getSmsConfig(),
): Promise<ProviderSmsSendResult> {
  if (!config.ready) throw new Error(config.errorMessage || "SMS provider is not configured");
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: input.to,
      message: input.message,
      sender_id: config.senderId,
    }),
  });
  const responseBody = await readResponseBody(response);
  if (!response.ok) throw new Error(providerError(responseBody));
  return {
    provider: "generic_sms",
    providerMessageId: providerMessageId(responseBody),
    responseBody,
  };
}
