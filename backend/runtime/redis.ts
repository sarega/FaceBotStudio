import IORedis from "ioredis";

let generalRedis: IORedis | null | undefined;
let warnedRedisLocalBypass = false;
let lastRedisErrorLogAt = 0;
const REDIS_ERROR_LOG_THROTTLE_MS = 30_000;

function isRunningOnRailway() {
  return Boolean(
    String(process.env.RAILWAY_ENVIRONMENT || "").trim()
    || String(process.env.RAILWAY_PROJECT_ID || "").trim()
    || String(process.env.RAILWAY_SERVICE_ID || "").trim(),
  );
}

function isRailwayInternalRedisUrl(redisUrl: string) {
  try {
    const parsed = new URL(redisUrl);
    return parsed.hostname.endsWith(".railway.internal");
  } catch {
    return false;
  }
}

export function getRedisUrl() {
  const value = String(process.env.REDIS_URL || "").trim();
  if (!value) {
    return null;
  }
  if (!isRunningOnRailway() && isRailwayInternalRedisUrl(value)) {
    if (!warnedRedisLocalBypass) {
      warnedRedisLocalBypass = true;
      console.warn("[redis] REDIS_URL points to Railway private DNS outside Railway runtime; Redis features are disabled and in-memory fallback is used.");
    }
    return null;
  }
  return value;
}

function buildRedisClient() {
  const url = getRedisUrl();
  if (!url) return null;

  const client = new IORedis(url, {
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  });
  client.on("error", (error) => {
    const now = Date.now();
    if (now - lastRedisErrorLogAt < REDIS_ERROR_LOG_THROTTLE_MS) {
      return;
    }
    lastRedisErrorLogAt = now;
    console.error("[redis] Connection error:", error);
  });
  return client;
}

async function ensureConnected(client: IORedis | null | undefined) {
  if (!client) return null;
  if (client.status === "wait" || client.status === "end") {
    try {
      await client.connect();
    } catch {
      return null;
    }
  }
  return client;
}

export function isRedisConfigured() {
  return Boolean(getRedisUrl());
}

export async function getRedisClient() {
  if (generalRedis === undefined) {
    generalRedis = buildRedisClient();
  }
  const connected = await ensureConnected(generalRedis);
  if (!connected && generalRedis) {
    generalRedis.disconnect();
    generalRedis = null;
  }
  return connected;
}

export function getBullConnectionOptions() {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;

  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname && parsed.pathname !== "/" ? Number(parsed.pathname.slice(1)) || 0 : 0,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export async function pingRedis() {
  const client = await getRedisClient();
  if (!client) {
    return { configured: false, healthy: false };
  }

  try {
    const pong = await client.ping();
    return {
      configured: true,
      healthy: pong === "PONG",
    };
  } catch {
    return {
      configured: true,
      healthy: false,
    };
  }
}
