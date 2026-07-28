import { createIndexingWorker } from "./features/sources/sources.worker.js";
import { createQueryWorker } from "./features/chat/chat.worker.js";

console.log("👷 Starting background queue workers...");

const indexingWorker = createIndexingWorker();
const queryWorker = createQueryWorker();

console.log("🚀 Workers initialized (indexing + query). Waiting for jobs...");

// Graceful shutdown handler
async function shutdown() {
  console.log("\n🛑 Gracefully shutting down workers...");
  await Promise.all([
    indexingWorker.close(),
    queryWorker.close(),
  ]);
  console.log("👋 Workers closed gracefully. Exiting process.");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
