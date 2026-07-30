import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
// Import the lib entry directly to avoid pdf-parse's debug-mode file read on import.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { config } from "../../config/index.js";
import { qdrant, ensureCollection } from "../../services/qdrant.js";
import { embedTexts } from "../../services/openai.js";

/** Read a PDF from disk and return its raw text. */
async function readPdfText(filePath) {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Parse raw SRT string content into structured subtitle blocks.
 * @param {string} srtContent
 * @returns {Array<{ id: number, startTime: string, endTime: string, text: string }>}
 */
export function parseSrt(srtContent) {
  const normalized = srtContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.trim().split(/\n\s*\n/);
  const subtitles = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].trim().split("\n");
    if (lines.length >= 2) {
      let index = i + 1;
      let timeIndex = 0;

      if (/^\d+$/.test(lines[0].trim())) {
        index = parseInt(lines[0].trim(), 10);
        timeIndex = 1;
      }

      const timeLine = lines[timeIndex];
      if (timeLine && timeLine.includes("-->")) {
        const [startTime, endTime] = timeLine.split("-->").map((s) => s.trim());
        const text = lines.slice(timeIndex + 1).join(" ");
        if (text.trim()) {
          subtitles.push({
            id: index,
            startTime: startTime || "",
            endTime: endTime || "",
            text: text.trim(),
          });
        }
      }
    }
  }

  return subtitles;
}

/** Read an SRT file from disk and return formatted text with timestamps. */
async function readSrtText(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  const subtitles = parseSrt(content);

  // Format each subtitle line with its timestamp: [00:00:01 --> 00:00:04] Hello world
  return subtitles
    .map((sub) => `[${sub.startTime} --> ${sub.endTime}] ${sub.text}`)
    .join("\n");
}

/**
 * Split text into overlapping chunks (~chunkSize chars, chunkOverlap overlap),
 * breaking on whitespace boundaries where possible.
 */
export function chunkText(text, chunkSize = config.chunking.chunkSize, overlap = config.chunking.chunkOverlap) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);

    // Try to end on a space so we don't cut words in half.
    if (end < clean.length) {
      const lastSpace = clean.lastIndexOf(" ", end);
      if (lastSpace > start) end = lastSpace;
    }

    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= clean.length) break;
    start = end - overlap; // step forward with overlap
    if (start < 0) start = 0;
  }

  return chunks;
}

/**
 * Full indexing pipeline for an uploaded PDF or SRT file:
 * read -> chunk -> embed -> upsert into Qdrant.
 */
export async function indexFile({ filePath, originalName, mimeType }) {
  const collection = await ensureCollection();
  const ext = path.extname(originalName).toLowerCase();

  let text = "";
  let fileType = "pdf";

  if (ext === ".srt" || mimeType?.includes("subrip") || mimeType?.includes("srt")) {
    fileType = "srt";
    text = await readSrtText(filePath);
  } else {
    fileType = "pdf";
    text = await readPdfText(filePath);
  }

  const chunks = chunkText(text);

  if (chunks.length === 0) {
    return { chunks: 0, message: `No extractable text found in ${fileType.toUpperCase()} file` };
  }

  const vectors = await embedTexts(chunks);

  const points = chunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    vector: vectors[i],
    payload: {
      text: chunk,
      source: originalName,
      filePath,
      fileType,
      chunkIndex: i,
    },
  }));

  await qdrant.upsert(collection, { wait: true, points });

  return { chunks: chunks.length, collection, fileType };
}

/** Alias for backwards compatibility */
export const indexPdf = indexFile;
