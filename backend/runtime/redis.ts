import IORedis from "ioredis";

let generalRedis: IORedis | null | undefined;

export function getRedisUrl() {
  const value = String(process.env.REDIS_URL || "").trim();
  return value || null;
}

function buildRedisClient() {
  const url = getRedisUrl();
  if (!url) return null;

  return new IORedis(url, {
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  });
}

async function ensureConnected(client: IORedis | null | undefined) {
  if (!client) return null;
  if (client.status === "wait") {
    await client.connect();
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
  return ensureConnected(generalRedis);
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
