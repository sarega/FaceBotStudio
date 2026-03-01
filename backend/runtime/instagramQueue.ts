import { Queue, Worker } from "bullmq";
import { createHash } from "crypto";
import { getBullConnectionOptions, getRedisClient, isRedisConfigured } from "./redis";

export type InstagramInboundJob = {
  dedupKey: string;
  senderId: string;
  accountId: string;
  text: string;
  messageMid: string | null;
  eventTimestamp: number;
};

const INSTAGRAM_INBOUND_QUEUE = "instagram-inbound-events";
const DEDUP_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.INSTAGRAM_WEBHOOK_DEDUP_TTL_SECONDS || "21600", 10) || 21600);
const memoryDedup = new Map<string, number>();

let inboundQueue: Queue | null | undefined;
let embeddedWorker: Worker | null | undefined;

function buildSafeQueueJobId(value: string) {
  return createHash("sha256").update(String(value || "").trim()).digest("hex");
}

function cleanupMemoryDedup(now = Date.now()) {
  for (const [key, expiresAt] of memoryDedup.entries()) {
    if (expiresAt <= now) {
      memoryDedup.delete(key);
    }
  }
}

export function buildInstagramWebhookDedupKey(webhookEvent: any, fallbackAccountId?: string) {
  const messageMid = typeof webhookEvent?.message?.mid === "string" ? webhookEvent.message.mid.trim() : "";
  if (messageMid) {
    return `ig-mid:${messageMid}`;
  }

  const messageId = typeof webhookEvent?.message?.id === "string" ? webhookEvent.message.id.trim() : "";
  if (messageId) {
    return `ig-msg:${messageId}`;
  }

  const senderId = String(webhookEvent?.sender?.id || "").trim();
  const accountId = String(webhookEvent?.recipient?.id || fallbackAccountId || "").trim();
  const text = String(webhookEvent?.message?.text || "").trim();
  const timestamp = Number(webhookEvent?.timestamp || 0);
  const hash = createHash("sha256")
    .update(`${senderId}|${accountId}|${timestamp}|${text}`)
    .digest("hex");
  return `ig-hash:${hash}`;
}

export async function acquireInstagramWebhookDedup(dedupKey: string) {
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

export function canUseInstagramWebhookQueue() {
  return isRedisConfigured();
}

export async function enqueueInstagramInboundJob(job: InstagramInboundJob) {
  if (!canUseInstagramWebhookQueue()) {
    return false;
  }

  if (!inboundQueue) {
    const connection = getBullConnectionOptions();
    if (!connection) return false;
    inboundQueue = new Queue(INSTAGRAM_INBOUND_QUEUE, {
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

  await inboundQueue.add("instagram-message", job satisfies InstagramInboundJob, {
    jobId: buildSafeQueueJobId(job.dedupKey),
  });
  return true;
}

export async function startEmbeddedInstagramWorker(
  processor: (job: InstagramInboundJob) => Promise<void>,
  options?: { enabled?: boolean },
) {
  if (options?.enabled === false || embeddedWorker || !canUseInstagramWebhookQueue()) {
    return embeddedWorker || null;
  }

  const connection = getBullConnectionOptions();
  if (!connection) return null;

  embeddedWorker = new Worker(
    INSTAGRAM_INBOUND_QUEUE,
    async (job) => {
      await processor(job.data as InstagramInboundJob);
    },
    {
      connection,
      concurrency: Math.max(1, Number.parseInt(process.env.INSTAGRAM_WEBHOOK_WORKER_CONCURRENCY || "4", 10) || 4),
    },
  );

  embeddedWorker.on("failed", (job, error) => {
    console.error("Instagram inbound worker job failed:", job?.id, error);
  });

  embeddedWorker.on("error", (error) => {
    console.error("Instagram inbound worker error:", error);
  });

  return embeddedWorker;
}
