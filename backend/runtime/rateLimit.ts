import type { NextFunction, Request, Response } from "express";
import { getRedisClient } from "./redis";

type RateLimitConfig = {
  name: string;
  windowMs: number;
  max: number;
  keyFn: (req: Request) => string;
  errorMessage: string;
};

type MemoryEntry = {
  count: number;
  resetAt: number;
};

const memoryStore = new Map<string, MemoryEntry>();

async function incrementWithRedis(key: string, windowMs: number) {
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

  return { count, resetAt: Date.now() + ttlMs };
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

export function createRateLimitMiddleware(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scopeKey = config.keyFn(req) || "unknown";
      const storeKey = `ratelimit:${config.name}:${scopeKey}`;
      const result = (await incrementWithRedis(storeKey, config.windowMs)) || incrementInMemory(storeKey, config.windowMs);

      if (result.count > config.max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
        res.setHeader("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({ error: config.errorMessage });
      }

      return next();
    } catch (error) {
      console.error(`Rate limiter ${config.name} failed:`, error);
      return next();
    }
  };
}

