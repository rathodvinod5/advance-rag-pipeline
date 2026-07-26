import { Queue } from "bullmq";
import { QUERY_QUEUE } from "../../config/index.js";
import { connection } from "../../services/redis.js";

export const queryQueue = new Queue(QUERY_QUEUE, { connection });

/**
 * Enqueue a query job. Completed/failed jobs are kept for polling.
 * @param {{ query: string }} payload
 */
export async function enqueueQueryJob(payload) {
  return queryQueue.add("run-query", payload, {
    attempts: 2,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 }, // keep 1h for polling
    removeOnFail: { age: 3600, count: 1000 },
  });
}
