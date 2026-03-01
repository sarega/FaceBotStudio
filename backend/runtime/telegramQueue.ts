import { Queue, Worker } from "bullmq";
import { createHash } from "crypto";
import { getBullConnectionOptions, getRedisClient, isRedisConfigured } from "./redis";

export type TelegramInboundJob = {
  dedupKey: string;
  senderId: string;
  botKey: string;
  text: string;
  updateId: string | null;
  eventTimestamp: number;
};

const TELEGRAM_INBOUND_QUEUE = "telegram-inbound-events";
const DEDUP_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.TELEGRAM_WEBHOOK_DEDUP_TTL_SECONDS || "21600", 10) || 21600);
const memoryDedup = new Map<string, number>();

let inboundQueue: Queue | null | undefined;
let embeddedWorker: Worker | null | undefined;

function cleanupMemoryDedup(now = Date.now()) {
  for (const [key, expiresAt] of memoryDedup.entries()) {
    if (expiresAt <= now) {
      memoryDedup.delete(key);
    }
  }
}

export function buildTelegramWebhookDedupKey(update: any, botKey?: string) {
  const updateId = Number.isFinite(Number(update?.update_id)) ? String(update.update_id) : "";
  if (updateId) {
    return `tg-update:${updateId}`;
  }

  const senderId = String(update?.message?.chat?.id || update?.message?.from?.id || "").trim();
  const resolvedBotKey = String(botKey || "").trim();
  const text = String(update?.message?.text || "").trim();
  const timestamp = Number(update?.message?.date || 0);
  const hash = createHash("sha256")
    .update(`${senderId}|${resolvedBotKey}|${timestamp}|${text}`)
    .digest("hex");
  return `tg-hash:${hash}`;
}

export async function acquireTelegramWebhookDedup(dedupKey: string) {
  const normalizedKey = String(dedupKey || "").trim();
  if (!normalizedKey) return false;

  const redis = await getRedisClient();
  if (redis) {
    const result = await redis.set(`dedup:${normalizedKey}`, "1", "EX", DEDUP_TTL_SECONDS, "NX");
    return result === "OK";
  }

  cleanupMemoryDedup();
  if (memoryDedup.has(normalizedKey)) {
    return false;
  }
  memoryDedup.set(normalizedKey, Date.now() + DEDUP_TTL_SECONDS * 1000);
  return true;
}

export function canUseTelegramWebhookQueue() {
  return isRedisConfigured();
}

export async function enqueueTelegramInboundJob(job: TelegramInboundJob) {
  if (!canUseTelegramWebhookQueue()) {
    return false;
  }

  if (!inboundQueue) {
    const connection = getBullConnectionOptions();
    if (!connection) return false;
    inboundQueue = new Queue(TELEGRAM_INBOUND_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 4,
        backoff: {
          type: "exponential",
          delay: 1500,
        },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }

  await inboundQueue.add("telegram-message", job satisfies TelegramInboundJob, {
    jobId: job.dedupKey,
  });
  return true;
}

export async function startEmbeddedTelegramWorker(
  processor: (job: TelegramInboundJob) => Promise<void>,
  options?: { enabled?: boolean },
) {
  if (options?.enabled === false || embeddedWorker || !canUseTelegramWebhookQueue()) {
    return embeddedWorker || null;
  }

  const connection = getBullConnectionOptions();
  if (!connection) return null;

  embeddedWorker = new Worker(
    TELEGRAM_INBOUND_QUEUE,
    async (job) => {
      await processor(job.data as TelegramInboundJob);
    },
    {
      connection,
      concurrency: Math.max(1, Number.parseInt(process.env.TELEGRAM_WEBHOOK_WORKER_CONCURRENCY || "4", 10) || 4),
    },
  );

  embeddedWorker.on("failed", (job, error) => {
    console.error("Telegram inbound worker job failed:", job?.id, error);
  });

  embeddedWorker.on("error", (error) => {
    console.error("Telegram inbound worker error:", error);
  });

  return embeddedWorker;
}
