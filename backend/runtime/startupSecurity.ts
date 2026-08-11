export type AppRuntimeMode = "all" | "web" | "worker";
export type TrustProxySetting = boolean | number | string | string[];

export type StartupSecurityConfig = {
  appRuntime: AppRuntimeMode;
  runWebServer: boolean;
  runEmbeddedWorker: boolean;
  trustProxy: TrustProxySetting;
  warnings: string[];
};

type StartupEnv = {
  [key: string]: string | undefined;
  NODE_ENV?: string;
  APP_RUNTIME?: string;
  TRUST_PROXY?: string;
  RAILWAY_ENVIRONMENT?: string;
  RAILWAY_PROJECT_ID?: string;
  RAILWAY_SERVICE_ID?: string;
  APP_URL?: string;
  DATABASE_URL?: string;
  REDIS_URL?: string;
  OPENROUTER_API_KEY?: string;
  TICKET_ACCESS_SECRET?: string;
  MEDIA_ACCESS_SECRET?: string;
  PUBLIC_CHAT_SESSION_SECRET?: string;
  RATE_LIMIT_FALLBACK_MODE?: string;
  RATE_LIMIT_SINGLE_INSTANCE?: string;
  DIRECT_TICKET_SECRET?: string;
  PUBLIC_DIRECT_TICKETING_ENABLED?: string;
  SESSION_TTL_DAYS?: string;
  FACEBOOK_APP_SECRET?: string;
};

function normalizeEnvironment(value: unknown) {
  return String(value || "").trim().toLowerCase() || "development";
}

function normalizeString(value: unknown) {
  return String(value || "").trim();
}

function isProductionEnvironment(nodeEnv: string) {
  return nodeEnv === "production";
}

function isRunningOnRailway(env: StartupEnv) {
  return Boolean(
    normalizeString(env.RAILWAY_ENVIRONMENT)
    || normalizeString(env.RAILWAY_PROJECT_ID)
    || normalizeString(env.RAILWAY_SERVICE_ID),
  );
}

function isLikelyPlaceholderSecret(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "api_key_here"
    || normalized === "your_api_key_here"
    || normalized === "replace_me"
    || normalized === "changeme"
    || normalized.includes("placeholder")
  );
}

export function resolveAppRuntimeMode(value: unknown): AppRuntimeMode {
  const runtime = normalizeString(value).toLowerCase() || "all";
  if (runtime === "all" || runtime === "web" || runtime === "worker") {
    return runtime;
  }
  throw new Error(`APP_RUNTIME must be one of: all, web, worker (received "${runtime || "<empty>"}")`);
}

export function resolveTrustProxySetting(value: unknown): TrustProxySetting {
  const raw = normalizeString(value);
  if (!raw) {
    return false;
  }

  const normalized = raw.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  if (/^\d+$/.test(raw)) {
    const hops = Number.parseInt(raw, 10);
    if (!Number.isFinite(hops) || hops < 0) {
      throw new Error("TRUST_PROXY numeric value must be a non-negative integer");
    }
    return hops;
  }

  if (raw.includes(",")) {
    const values = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (values.length === 0) {
      throw new Error("TRUST_PROXY list cannot be empty");
    }
    return values;
  }

  return raw;
}

function validateSessionTtlDays(rawValue: string, warnings: string[]) {
  const ttlRaw = rawValue || "14";
  const ttlDays = Number.parseInt(ttlRaw, 10);
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    throw new Error("SESSION_TTL_DAYS must be a positive integer");
  }
  if (ttlDays > 90) {
    warnings.push("SESSION_TTL_DAYS is set above 90 days; consider reducing for tighter session security.");
  }
}

function validateAppUrl(rawValue: string, requireHttps: boolean) {
  const value = rawValue.trim();
  if (!value) {
    throw new Error("APP_URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("APP_URL must be a valid absolute URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("APP_URL must use http:// or https://");
  }
  if (requireHttps && parsed.protocol !== "https:") {
    throw new Error("APP_URL must use https:// in production");
  }
}

export function resolveStartupSecurityConfig(env: StartupEnv): StartupSecurityConfig {
  const warnings: string[] = [];
  const nodeEnv = normalizeEnvironment(env.NODE_ENV);
  const isProduction = isProductionEnvironment(nodeEnv);
  const appRuntime = resolveAppRuntimeMode(env.APP_RUNTIME);
  const runWebServer = appRuntime !== "worker";
  const runEmbeddedWorker = appRuntime === "all" || appRuntime === "worker";
  const trustProxyRaw = normalizeString(env.TRUST_PROXY);
  const runningOnRailway = isRunningOnRailway(env);
  const appUrlRaw = normalizeString(env.APP_URL);
  const databaseUrl = normalizeString(env.DATABASE_URL);
  const redisUrl = normalizeString(env.REDIS_URL);
  const openRouterApiKey = normalizeString(env.OPENROUTER_API_KEY);
  const ticketAccessSecret = normalizeString(env.TICKET_ACCESS_SECRET);
  const mediaAccessSecret = normalizeString(env.MEDIA_ACCESS_SECRET);
  const publicChatSessionSecret = normalizeString(env.PUBLIC_CHAT_SESSION_SECRET);
  const rateLimitFallbackMode = normalizeString(env.RATE_LIMIT_FALLBACK_MODE).toLowerCase();
  const rateLimitSingleInstance = ["1", "true", "yes", "on"].includes(normalizeString(env.RATE_LIMIT_SINGLE_INSTANCE).toLowerCase());
  const directTicketSecret = normalizeString(env.DIRECT_TICKET_SECRET);
  const effectiveTicketAccessSecret = ticketAccessSecret || directTicketSecret;
  const effectivePublicChatSessionSecret = publicChatSessionSecret || mediaAccessSecret || effectiveTicketAccessSecret;
  const publicDirectTicketingEnabled = ["1", "true", "yes", "on"].includes(normalizeString(env.PUBLIC_DIRECT_TICKETING_ENABLED).toLowerCase());
  const facebookAppSecret = normalizeString(env.FACEBOOK_APP_SECRET);
  const sessionTtlDaysRaw = normalizeString(env.SESSION_TTL_DAYS);
  let trustProxy = resolveTrustProxySetting(env.TRUST_PROXY);

  if (rateLimitFallbackMode && !["fail_closed", "memory_single_instance"].includes(rateLimitFallbackMode)) {
    throw new Error("RATE_LIMIT_FALLBACK_MODE must be fail_closed or memory_single_instance");
  }
  if (isProduction && rateLimitFallbackMode === "memory_single_instance" && !rateLimitSingleInstance) {
    throw new Error("RATE_LIMIT_FALLBACK_MODE=memory_single_instance requires RATE_LIMIT_SINGLE_INSTANCE=1 in production.");
  }

  validateSessionTtlDays(sessionTtlDaysRaw, warnings);

  if (isProduction) {
    if ((runWebServer || runEmbeddedWorker) && !databaseUrl) {
      warnings.push("DATABASE_URL is not configured; the app is using SQLite fallback. Use PostgreSQL for multi-instance production.");
    }
    if ((runWebServer || runEmbeddedWorker) && !redisUrl && rateLimitFallbackMode !== "memory_single_instance") {
      warnings.push("REDIS_URL is not configured; production readiness will fail closed until Redis is available or single-instance fallback is explicitly enabled.");
    }
    if (runWebServer && !trustProxyRaw) {
      if (runningOnRailway) {
        trustProxy = 1;
        warnings.push("TRUST_PROXY was not set; defaulting to 1 for Railway proxy deployments. Set TRUST_PROXY explicitly to remove this warning.");
      } else {
        throw new Error("TRUST_PROXY must be explicitly set in production (for example: 1, false, loopback, or CIDR list).");
      }
    }
    if (runWebServer) {
      validateAppUrl(appUrlRaw, true);
    } else if (appUrlRaw) {
      validateAppUrl(appUrlRaw, true);
    }
    if (runEmbeddedWorker) {
      if (!openRouterApiKey) {
        throw new Error("OPENROUTER_API_KEY is required in production when APP_RUNTIME includes worker.");
      }
      if (isLikelyPlaceholderSecret(openRouterApiKey)) {
        throw new Error("OPENROUTER_API_KEY appears to be a placeholder value.");
      }
    }
    if (publicDirectTicketingEnabled) {
      if (!directTicketSecret) {
        throw new Error("DIRECT_TICKET_SECRET is required in production when public direct ticketing is enabled.");
      }
      if (directTicketSecret.length < 32 || isLikelyPlaceholderSecret(directTicketSecret)) {
        throw new Error("DIRECT_TICKET_SECRET must be an independently generated secret of at least 32 characters.");
      }
    }
    if (runWebServer || runEmbeddedWorker) {
      if (!effectiveTicketAccessSecret) {
        warnings.push("TICKET_ACCESS_SECRET is not configured; public registration ticket links are disabled until a production secret is provided.");
      } else if (effectiveTicketAccessSecret.length < 32 || isLikelyPlaceholderSecret(effectiveTicketAccessSecret)) {
        throw new Error("TICKET_ACCESS_SECRET must be a generated secret of at least 32 characters.");
      } else if (!ticketAccessSecret && directTicketSecret) {
        warnings.push("TICKET_ACCESS_SECRET is not configured; DIRECT_TICKET_SECRET is being used for ticket-link compatibility. Set an independent TICKET_ACCESS_SECRET.");
      }
    }
    if (mediaAccessSecret && (mediaAccessSecret.length < 32 || isLikelyPlaceholderSecret(mediaAccessSecret))) {
      throw new Error("MEDIA_ACCESS_SECRET must be a generated secret of at least 32 characters.");
    }
    if (publicChatSessionSecret && (publicChatSessionSecret.length < 32 || isLikelyPlaceholderSecret(publicChatSessionSecret))) {
      throw new Error("PUBLIC_CHAT_SESSION_SECRET must be a generated secret of at least 32 characters.");
    }
    if (rateLimitFallbackMode === "memory_single_instance") {
      warnings.push("Rate limits are using the in-memory single-instance fallback; do not use this mode with multiple web instances.");
    }
    if (runWebServer && !effectivePublicChatSessionSecret) {
      warnings.push("PUBLIC_CHAT_SESSION_SECRET, MEDIA_ACCESS_SECRET, and ticket secrets are not configured; public chat sessions are disabled until a production secret is provided.");
    } else if (runWebServer && !publicChatSessionSecret) {
      warnings.push("PUBLIC_CHAT_SESSION_SECRET is not configured; public chat sessions are reusing an existing ticket/media secret. Set an independent secret for stronger isolation.");
    }
    if (!facebookAppSecret && runWebServer) {
      warnings.push("FACEBOOK_APP_SECRET is not configured; webhook signature verification is disabled.");
    }
  } else if (appUrlRaw) {
    validateAppUrl(appUrlRaw, false);
  }

  if (trustProxy === true) {
    warnings.push("TRUST_PROXY=true trusts all proxies; prefer a hop count (for example: 1) or explicit trusted list.");
  }

  return {
    appRuntime,
    runWebServer,
    runEmbeddedWorker,
    trustProxy,
    warnings,
  };
}
