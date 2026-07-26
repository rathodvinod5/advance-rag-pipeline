import { Worker } from "bullmq";
import { QUERY_QUEUE } from "../../config/index.js";
import { connection } from "../../services/redis.js";
import { answerQuery } from "./chat.service.js";

export function createQueryWorker() {
  const worker = new Worker(
    QUERY_QUEUE,
    async (job) => {
      console.log(`🔎 Query job ${job.id}: ${JSON.stringify(job.data.query)}`);
      const result = await answerQuery(job.data.query);
      console.log(`   → answered using ${result.sources.length} chunk(s)`);
      return result;
    },
    { connection, concurrency: 4 }
  );

  worker.on("completed", (job) => console.log(`✅ [query] job ${job.id} completed`));
  worker.on("failed", (job, err) => console.error(`❌ [query] job ${job?.id} failed:`, err.message));

  return worker;
}
