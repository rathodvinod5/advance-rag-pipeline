import { Router } from "express";
import { enqueueQueryJob, queryQueue } from "./chat.queue.js";
import { config } from "../../config/index.js";
export const chatRouter = Router();

// --- POST /query : enqueue a RAG query job, return job id to poll ---
chatRouter.post("/query", async (req, res, next) => {
  const query = req.body?.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    return res
      .status(400)
      .json({ error: "Body must include a non-empty 'query' string" });
  }
  console.log("/query called: ", query);
  try {
    const job = await enqueueQueryJob({ query: query.trim() });
    return res.status(202).json({
      message: "Query queued",
      jobId: job.id,
      // poll: `${config.frontend.url}/query/${job.id}`,
      poll: `/query/${job.id}`,
    });
  } catch (err) {
    next(err);
  }
});

// --- GET /query/:id : poll for the status/result of a query job ---
chatRouter.get("/query/:id", async (req, res, next) => {
  try {
    const job = await queryQueue.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const state = await job.getState();

    if (state === "completed") {
      return res.json({
        jobId: job.id,
        status: state,
        result: job.returnvalue,
      });
    }
    if (state === "failed") {
      return res
        .status(200)
        .json({ jobId: job.id, status: state, error: job.failedReason });
    }

    // waiting | active | delayed | paused
    return res.json({ jobId: job.id, status: state });
  } catch (err) {
    next(err);
  }
});
