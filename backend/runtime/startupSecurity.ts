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
  APP_URL?: string;
  OPENROUTER_API_KEY?: string;
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
  const appUrlRaw = normalizeString(env.APP_URL);
  const openRouterApiKey = normalizeString(env.OPENROUTER_API_KEY);
  const facebookAppSecret = normalizeString(env.FACEBOOK_APP_SECRET);
  const sessionTtlDaysRaw = normalizeString(env.SESSION_TTL_DAYS);
  const trustProxy = resolveTrustProxySetting(env.TRUST_PROXY);

  validateSessionTtlDays(sessionTtlDaysRaw, warnings);

  if (isProduction) {
    if (runWebServer && !trustProxyRaw) {
      throw new Error("TRUST_PROXY must be explicitly set in production (for example: 1, false, loopback, or CIDR list).");
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
