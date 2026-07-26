import { Queue } from "bullmq";
import { INDEXING_QUEUE } from "../../config/index.js";
import { connection } from "../../services/redis.js";

export const indexingQueue = new Queue(INDEXING_QUEUE, { connection });

/**
 * Enqueue a job telling the worker to index an uploaded PDF.
 * @param {{ filePath: string, originalName: string, mimeType: string, size: number }} payload
 */
export async function enqueueIndexingJob(payload) {
  return indexingQueue.add("index-file", payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}
