import { Router } from "express";
import { upload } from "../../middleware/upload.js";
import { enqueueIndexingJob } from "./sources.queue.js";

export const sourcesRouter = Router();

// --- POST /index : upload a PDF, SRT, WebVTT, or TXT file and enqueue an indexing job ---
sourcesRouter.post("/index", upload.single("file"), async (req, res, next) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ error: "No file uploaded (field: 'file'). Supported formats: PDF, SRT, VTT, TXT, MD" });
  }

  try {
    const job = await enqueueIndexingJob({
      filePath: req.file.path,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });

    return res.status(202).json({
      message: "File uploaded and queued for indexing",
      jobId: job.id,
      file: {
        originalName: req.file.originalname,
        storedAs: req.file.filename,
        size: req.file.size,
      },
    });
  } catch (err) {
    next(err);
  }
});
