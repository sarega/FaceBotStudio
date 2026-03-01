import { Queue, Worker } from "bullmq";
import { createHash } from "crypto";
import { getBullConnectionOptions, getRedisClient, isRedisConfigured } from "./redis";

export type FacebookInboundJob = {
  dedupKey: string;
  senderId: string;
  pageId: string | null;
  text: string;
  messageMid: string | null;
  eventTimestamp: number;
};

const FACEBOOK_INBOUND_QUEUE = "facebook-inbound-events";
const DEDUP_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.FACEBOOK_WEBHOOK_DEDUP_TTL_SECONDS || "21600", 10) || 21600);
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

export function buildFacebookWebhookDedupKey(webhookEvent: any) {
  const messageMid = typeof webhookEvent?.message?.mid === "string" ? webhookEvent.message.mid.trim() : "";
  if (messageMid) {
    return `fb-mid:${messageMid}`;
  }

  const senderId = String(webhookEvent?.sender?.id || "").trim();
  const pageId = String(webhookEvent?.recipient?.id || "").trim();
  const text = String(webhookEvent?.message?.text || "").trim();
  const timestamp = Number(webhookEvent?.timestamp || 0);
  const hash = createHash("sha256")
    .update(`${senderId}|${pageId}|${timestamp}|${text}`)
    .digest("hex");
  return `fb-hash:${hash}`;
}

export async function acquireFacebookWebhookDedup(dedupKey: string) {
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

export function canUseFacebookWebhookQueue() {
  return isRedisConfigured();
}

export async function enqueueFacebookInboundJob(job: FacebookInboundJob) {
  if (!canUseFacebookWebhookQueue()) {
    return false;
  }

  if (!inboundQueue) {
    const connection = getBullConnectionOptions();
    if (!connection) return false;
    inboundQueue = new Queue(FACEBOOK_INBOUND_QUEUE, {
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

  await inboundQueue.add("facebook-message", job satisfies FacebookInboundJob, {
    jobId: job.dedupKey,
  });
  return true;
}

export async function startEmbeddedFacebookWorker(
  processor: (job: FacebookInboundJob) => Promise<void>,
  options?: { enabled?: boolean },
) {
  if (options?.enabled === false || embeddedWorker || !canUseFacebookWebhookQueue()) {
    return embeddedWorker || null;
  }

  const connection = getBullConnectionOptions();
  if (!connection) return null;

  embeddedWorker = new Worker(
    FACEBOOK_INBOUND_QUEUE,
    async (job) => {
      await processor(job.data as FacebookInboundJob);
    },
    {
      connection,
      concurrency: Math.max(1, Number.parseInt(process.env.WEBHOOK_WORKER_CONCURRENCY || "4", 10) || 4),
    },
  );

  embeddedWorker.on("failed", (job, error) => {
    console.error("Facebook inbound worker job failed:", job?.id, error);
  });

  embeddedWorker.on("error", (error) => {
    console.error("Facebook inbound worker error:", error);
  });

  return embeddedWorker;
}
