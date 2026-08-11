import type { NextFunction, Request, Response } from "express";
import { getRedisClient } from "./redis";

type RateLimitConfig = {
  name: string;
  windowMs: number;
  max: number;
  keyFn: (req: Request) => string;
  errorMessage: string;
  onBlocked?: (context: RateLimitBlockedContext) => Promise<void> | void;
};

type MemoryEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitFallbackMode = "fail_closed" | "memory_single_instance";

export type RateLimitBlockedContext = {
  req: Request;
  res: Response;
  scopeKey: string;
  storeKey: string;
  count: number;
  max: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const memoryStore = new Map<string, MemoryEntry>();

function buildStoreKey(name: string, scopeKey: string) {
  return `ratelimit:${name}:${scopeKey}`;
}

async function incrementWithRedis(key: string, windowMs: number) {
  try {
    const client = await getRedisClient();
    if (!client) return null;

    const multi = client.multi();
    multi.incr(key);
    multi.pttl(key);
    const result = await multi.exec();
    if (!result || !result[0] || !result[1]) {
      return null;
    }

    const count = Number(result[0][1] || 0);
    let ttlMs = Number(result[1][1] || -1);

    if (count === 1 || ttlMs < 0) {
      await client.pexpire(key, windowMs);
      ttlMs = windowMs;
    }

    if (!Number.isFinite(count) || !Number.isFinite(ttlMs) || ttlMs < 0) {
      return null;
    }
    return { count, resetAt: Date.now() + ttlMs };
  } catch (error) {
    console.error("Redis rate limiter unavailable:", error);
    return null;
  }
}

function incrementInMemory(key: string, windowMs: number) {
  const now = Date.now();
  const current = memoryStore.get(key);
  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs };
    memoryStore.set(key, next);
    return next;
  }

  current.count += 1;
  memoryStore.set(key, current);
  return current;
}

export function resolveRateLimitFallbackMode(env: Record<string, unknown> = process.env): RateLimitFallbackMode {
  const configured = String(env.RATE_LIMIT_FALLBACK_MODE || "").trim().toLowerCase();
  if (configured === "fail_closed") return "fail_closed";
  if (configured === "memory_single_instance") return "memory_single_instance";

  return String(env.NODE_ENV || "").trim().toLowerCase() === "production"
    ? "fail_closed"
    : "memory_single_instance";
}

export function createRateLimitMiddleware(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scopeKey = config.keyFn(req) || "unknown";
      const storeKey = buildStoreKey(config.name, scopeKey);
      const redisResult = await incrementWithRedis(storeKey, config.windowMs);
      const result = redisResult || (
        resolveRateLimitFallbackMode() === "memory_single_instance"
          ? incrementInMemory(storeKey, config.windowMs)
          : null
      );

      if (!result) {
        res.setHeader("Retry-After", "30");
        return res.status(503).json({ error: "Rate limiting service unavailable. Please retry shortly." });
      }

      if (result.count > config.max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
        res.setHeader("Retry-After", String(retryAfterSeconds));
        if (typeof config.onBlocked === "function") {
          try {
            await config.onBlocked({
              req,
              res,
              scopeKey,
              storeKey,
              count: result.count,
              max: config.max,
              resetAt: result.resetAt,
              retryAfterSeconds,
            });
          } catch (hookError) {
            console.error(`Rate limiter ${config.name} onBlocked hook failed:`, hookError);
          }
        }
        return res.status(429).json({ error: config.errorMessage });
      }

      return next();
    } catch (error) {
      console.error(`Rate limiter ${config.name} failed:`, error);
      res.setHeader("Retry-After", "30");
      return res.status(503).json({ error: "Rate limiting service unavailable. Please retry shortly." });
    }
  };
}

export async function resetRateLimitCounter(name: string, scopeKey: string) {
  const normalizedName = String(name || "").trim();
  const normalizedScopeKey = String(scopeKey || "").trim();
  if (!normalizedName || !normalizedScopeKey) return;

  const storeKey = buildStoreKey(normalizedName, normalizedScopeKey);
  memoryStore.delete(storeKey);

  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.del(storeKey);
  } catch (error) {
    console.error(`Failed to reset rate limiter key ${storeKey}:`, error);
  }
}
