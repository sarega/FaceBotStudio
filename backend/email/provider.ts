import { assertEmailConfigReady, getEmailConfig, type EmailConfig, type EmailProviderName } from "./config";

export type ProviderEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
};

export type ProviderEmailSendResult = {
  provider: EmailProviderName;
  providerMessageId: string | null;
  responseBody: unknown;
};

function extractProviderErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = [record.message, record.error, record.name]
      .find((value) => typeof value === "string" && value.trim());
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }

  return fallback;
}

async function parseProviderResponseBody(response: Response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return {};

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

async function sendWithResend(config: EmailConfig, input: ProviderEmailInput): Promise<ProviderEmailSendResult> {
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.fromAddress,
      to: recipients,
      subject: input.subject,
      text: input.text,
      html: input.html,
      reply_to: config.replyToAddress,
    }),
  });

  const responseBody = await parseProviderResponseBody(response);
  if (!response.ok) {
    throw new Error(
      extractProviderErrorMessage(responseBody, "Failed to send email via Resend"),
    );
  }

  const payload = responseBody && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};

  return {
    provider: "resend",
    providerMessageId: typeof payload.id === "string" ? payload.id.trim() || null : null,
    responseBody,
  };
}

export async function sendProviderEmail(
  input: ProviderEmailInput,
  config: EmailConfig = getEmailConfig(),
): Promise<ProviderEmailSendResult> {
  assertEmailConfigReady(config);

  switch (config.provider) {
    case "resend":
      return sendWithResend(config, input);
    default: {
      const provider = config.provider satisfies never;
      throw new Error(`Unsupported email provider: ${provider}`);
    }
  }
}
