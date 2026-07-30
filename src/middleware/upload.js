import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "..", "..", "uploads");

// Ensure the uploads directory exists.
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomUUID()}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = [".pdf", ".srt", ".vtt", ".txt", ".md"];
    const allowedMimes = [
      "application/pdf",
      "text/plain",
      "application/x-subrip",
      "text/srt",
      "text/vtt",
      "text/markdown",
      "application/octet-stream",
    ];

    if (allowedExts.includes(ext) || allowedMimes.includes(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error("Only PDF, SRT, WebVTT, and Plain Text (.txt, .md) files are allowed"));
  },
});
