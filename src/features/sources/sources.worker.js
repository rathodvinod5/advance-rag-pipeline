import { Worker } from "bullmq";
import { INDEXING_QUEUE } from "../../config/index.js";
import { connection } from "../../services/redis.js";
import { indexPdf } from "./sources.service.js";

export function createIndexingWorker() {
  const worker = new Worker(
    INDEXING_QUEUE,
    async (job) => {
      console.log(`📥 Indexing job ${job.id}: ${job.data.originalName}`);

      const result = await indexPdf({
        filePath: job.data.filePath,
        originalName: job.data.originalName,
      });

      console.log(`   → ${result.chunks} chunk(s) indexed`);
      return result;
    },
    { connection, concurrency: 2 }
  );

  worker.on("completed", (job) => console.log(`✅ [indexing] job ${job.id} completed`));
  worker.on("failed", (job, err) => console.error(`❌ [indexing] job ${job?.id} failed:`, err.message));

  return worker;
}
