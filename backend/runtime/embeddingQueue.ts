import { Queue, Worker } from "bullmq";
import { getBullConnectionOptions, isRedisConfigured } from "./redis";

export type EmbeddingJob = {
  eventId: string;
  documentId: string;
  contentHash: string;
};

const EMBEDDING_QUEUE = "event-document-embeddings";

let embeddingQueue: Queue | null | undefined;
let embeddedEmbeddingWorker: Worker | null | undefined;

export function canUseEmbeddingQueue() {
  return isRedisConfigured();
}

export async function enqueueEmbeddingJob(job: EmbeddingJob) {
  if (!canUseEmbeddingQueue()) {
    return false;
  }

  if (!embeddingQueue) {
    const connection = getBullConnectionOptions();
    if (!connection) return false;
    embeddingQueue = new Queue(EMBEDDING_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 4,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }

  await embeddingQueue.add("embed-document", job satisfies EmbeddingJob, {
    jobId: `${job.documentId}:${job.contentHash}`,
  });
  return true;
}

export async function startEmbeddedEmbeddingWorker(
  processor: (job: EmbeddingJob) => Promise<void>,
  options?: { enabled?: boolean },
) {
  if (options?.enabled === false || embeddedEmbeddingWorker || !canUseEmbeddingQueue()) {
    return embeddedEmbeddingWorker || null;
  }

  const connection = getBullConnectionOptions();
  if (!connection) return null;

  embeddedEmbeddingWorker = new Worker(
    EMBEDDING_QUEUE,
    async (job) => {
      await processor(job.data as EmbeddingJob);
    },
    {
      connection,
      concurrency: Math.max(1, Number.parseInt(process.env.EMBEDDING_WORKER_CONCURRENCY || "2", 10) || 2),
    },
  );

  embeddedEmbeddingWorker.on("failed", (job, error) => {
    console.error("Embedding worker job failed:", job?.id, error);
  });

  embeddedEmbeddingWorker.on("error", (error) => {
    console.error("Embedding worker error:", error);
  });

  return embeddedEmbeddingWorker;
}
