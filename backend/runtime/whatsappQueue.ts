import { Queue, Worker } from "bullmq";
import { createHash } from "crypto";
import { getBullConnectionOptions, getRedisClient, isRedisConfigured } from "./redis";

export type WhatsAppInboundJob = {
  dedupKey: string;
  senderId: string;
  phoneNumberId: string;
  text: string;
  messageId: string | null;
  eventTimestamp: number;
};

const WHATSAPP_INBOUND_QUEUE = "whatsapp-inbound-events";
const DEDUP_TTL_SECONDS = Math.max(60, Number.parseInt(process.env.WHATSAPP_WEBHOOK_DEDUP_TTL_SECONDS || "21600", 10) || 21600);
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

export function buildWhatsAppWebhookDedupKey(message: any, phoneNumberId?: string) {
  const messageId = typeof message?.id === "string" ? message.id.trim() : "";
  if (messageId) {
    return `wa-msg:${messageId}`;
  }

  const senderId = String(message?.from || "").trim();
  const targetId = String(phoneNumberId || "").trim();
  const text = String(message?.text?.body || "").trim();
  const timestamp = Number(message?.timestamp || 0);
  const hash = createHash("sha256")
    .update(`${senderId}|${targetId}|${timestamp}|${text}`)
    .digest("hex");
  return `wa-hash:${hash}`;
}

export async function acquireWhatsAppWebhookDedup(dedupKey: string) {
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

export function canUseWhatsAppWebhookQueue() {
  return isRedisConfigured();
}

export async function enqueueWhatsAppInboundJob(job: WhatsAppInboundJob) {
  if (!canUseWhatsAppWebhookQueue()) {
    return false;
  }

  if (!inboundQueue) {
    const connection = getBullConnectionOptions();
    if (!connection) return false;
    inboundQueue = new Queue(WHATSAPP_INBOUND_QUEUE, {
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

  await inboundQueue.add("whatsapp-message", job satisfies WhatsAppInboundJob, {
    jobId: buildSafeQueueJobId(job.dedupKey),
  });
  return true;
}

export async function startEmbeddedWhatsAppWorker(
  processor: (job: WhatsAppInboundJob) => Promise<void>,
  options?: { enabled?: boolean },
) {
  if (options?.enabled === false || embeddedWorker || !canUseWhatsAppWebhookQueue()) {
    return embeddedWorker || null;
  }

  const connection = getBullConnectionOptions();
  if (!connection) return null;

  embeddedWorker = new Worker(
    WHATSAPP_INBOUND_QUEUE,
    async (job) => {
      await processor(job.data as WhatsAppInboundJob);
    },
    {
      connection,
      concurrency: Math.max(1, Number.parseInt(process.env.WHATSAPP_WEBHOOK_WORKER_CONCURRENCY || "4", 10) || 4),
    },
  );

  embeddedWorker.on("failed", (job, error) => {
    console.error("WhatsApp inbound worker job failed:", job?.id, error);
  });

  embeddedWorker.on("error", (error) => {
    console.error("WhatsApp inbound worker error:", error);
  });

  return embeddedWorker;
}
