import { Queue, Worker } from "bullmq";
import { createHash } from "crypto";
import { getBullConnectionOptions, getRedisClient, isRedisConfigured } from "./redis";

export type LineInboundJob = {
  dedupKey: string;
  senderId: string;
  destination: string;
  replyToken: string | null;
  text: string;
  eventTimestamp: number;
  webhookEventId: string | null;
};

const LINE_INBOUND_QUEUE = "line-inbound-events";
const DEDUP_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.LINE_WEBHOOK_DEDUP_TTL_SECONDS || "21600", 10) || 21600);
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

export function buildLineWebhookDedupKey(webhookEvent: any, destination: string) {
  const webhookEventId = typeof webhookEvent?.webhookEventId === "string" ? webhookEvent.webhookEventId.trim() : "";
  if (webhookEventId) {
    return `line-event:${webhookEventId}`;
  }

  const messageId = typeof webhookEvent?.message?.id === "string" ? webhookEvent.message.id.trim() : "";
  if (messageId) {
    return `line-msg:${messageId}`;
  }

  const senderId = String(webhookEvent?.source?.userId || "").trim();
  const text = String(webhookEvent?.message?.text || "").trim();
  const timestamp = Number(webhookEvent?.timestamp || 0);
  const hash = createHash("sha256")
    .update(`${senderId}|${destination}|${timestamp}|${text}`)
    .digest("hex");
  return `line-hash:${hash}`;
}

export async function acquireLineWebhookDedup(dedupKey: string) {
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

export function canUseLineWebhookQueue() {
  return isRedisConfigured();
}

export async function enqueueLineInboundJob(job: LineInboundJob) {
  if (!canUseLineWebhookQueue()) {
    return false;
  }

  if (!inboundQueue) {
    const connection = getBullConnectionOptions();
    if (!connection) return false;
    inboundQueue = new Queue(LINE_INBOUND_QUEUE, {
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

  await inboundQueue.add("line-message", job satisfies LineInboundJob, {
    jobId: buildSafeQueueJobId(job.dedupKey),
  });
  return true;
}

export async function startEmbeddedLineWorker(
  processor: (job: LineInboundJob) => Promise<void>,
  options?: { enabled?: boolean },
) {
  if (options?.enabled === false || embeddedWorker || !canUseLineWebhookQueue()) {
    return embeddedWorker || null;
  }

  const connection = getBullConnectionOptions();
  if (!connection) return null;

  embeddedWorker = new Worker(
    LINE_INBOUND_QUEUE,
    async (job) => {
      await processor(job.data as LineInboundJob);
    },
    {
      connection,
      concurrency: Math.max(1, Number.parseInt(process.env.LINE_WEBHOOK_WORKER_CONCURRENCY || "4", 10) || 4),
    },
  );

  embeddedWorker.on("failed", (job, error) => {
    console.error("LINE inbound worker job failed:", job?.id, error);
  });

  embeddedWorker.on("error", (error) => {
    console.error("LINE inbound worker error:", error);
  });

  return embeddedWorker;
}
