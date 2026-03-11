export type EmailProviderName = "resend";
export type EmailConfigFieldName = "RESEND_API_KEY" | "EMAIL_FROM" | "EMAIL_REPLY_TO" | "APP_URL";
export type EmailReadinessState = "ready" | "missing_config" | "invalid_config";

export type EmailConfig = {
  provider: EmailProviderName;
  apiKey: string;
  fromAddress: string;
  replyToAddress: string;
  appUrl: string;
  hasApiKey: boolean;
  hasFrom: boolean;
  hasReplyTo: boolean;
  hasAppUrl: boolean;
  configured: boolean;
  ready: boolean;
  readiness: EmailReadinessState;
  missingFields: EmailConfigFieldName[];
  errorMessage: string | null;
};

function normalizeEnvValue(value: unknown) {
  return String(value || "").trim();
}

function buildMissingFieldMessage(fields: EmailConfigFieldName[]) {
  return `Email is not configured. Missing: ${fields.join(", ")}`;
}

function validateAppUrl(value: string) {
  if (!value) return "APP_URL is required";

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "APP_URL must use http:// or https://";
    }
    return null;
  } catch {
    return "APP_URL must be a valid absolute URL";
  }
}

export function getEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const apiKey = normalizeEnvValue(env.RESEND_API_KEY);
  const fromAddress = normalizeEnvValue(env.EMAIL_FROM);
  const replyToAddress = normalizeEnvValue(env.EMAIL_REPLY_TO);
  const appUrl = normalizeEnvValue(env.APP_URL);

  const missingFields: EmailConfigFieldName[] = [];
  if (!apiKey) missingFields.push("RESEND_API_KEY");
  if (!fromAddress) missingFields.push("EMAIL_FROM");
  if (!replyToAddress) missingFields.push("EMAIL_REPLY_TO");
  if (!appUrl) missingFields.push("APP_URL");

  const appUrlError = appUrl ? validateAppUrl(appUrl) : null;
  const errorMessage =
    missingFields.length > 0
      ? buildMissingFieldMessage(missingFields)
      : appUrlError;
  const ready = missingFields.length === 0 && !appUrlError;

  return {
    provider: "resend",
    apiKey,
    fromAddress,
    replyToAddress,
    appUrl,
    hasApiKey: Boolean(apiKey),
    hasFrom: Boolean(fromAddress),
    hasReplyTo: Boolean(replyToAddress),
    hasAppUrl: Boolean(appUrl),
    configured: ready,
    ready,
    readiness: ready ? "ready" : (missingFields.length > 0 ? "missing_config" : "invalid_config"),
    missingFields,
    errorMessage,
  };
}

export function assertEmailConfigReady(config: EmailConfig = getEmailConfig()): asserts config is EmailConfig & { ready: true } {
  if (!config.ready) {
    throw new Error(config.errorMessage || "Email is not configured");
  }
}

export function buildAbsoluteAppUrl(appUrl: string, pathname: string) {
  const url = new URL(appUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function logEmailStartupDiagnostics(env: NodeJS.ProcessEnv = process.env, logger: Pick<Console, "log" | "warn"> = console) {
  const config = getEmailConfig(env);
  if (config.ready) {
    logger.log(
      `[startup] Email provider ${config.provider} ready (from: ${config.fromAddress}; reply-to: ${config.replyToAddress})`,
    );
  } else {
    logger.warn(
      `[startup] Email provider ${config.provider} not ready: ${config.errorMessage || "configuration incomplete"}`,
    );
  }
  return config;
}
