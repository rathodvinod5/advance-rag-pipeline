import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import { sourcesRouter } from "./features/sources/sources.router.js";
import { chatRouter } from "./features/chat/chat.router.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();
app.use(express.json());

app.use(cors({
  origin: config.frontend.url, // Allow only your Next.js app
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Crucial if you pass cookies or session headers later
}));

// Health check endpoint
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Mount feature routers
app.use("/", sourcesRouter);
app.use("/", chatRouter);

// Centralized error handler middleware
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 Server listening on http://localhost:${config.port}`);
});
