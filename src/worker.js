import { createIndexingWorker } from "./features/sources/sources.worker.js";
import { createQueryWorker } from "./features/chat/chat.worker.js";

console.log("👷 Starting background queue workers...");

const indexingWorker = createIndexingWorker();
const queryWorker = createQueryWorker();

console.log("🚀 Workers initialized (indexing + query). Waiting for jobs...");
