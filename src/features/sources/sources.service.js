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

/** Read a plain text file (.txt or .md) from disk and return its content. */
async function readTxtText(filePath) {
  return fs.readFile(filePath, "utf-8");
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
 * Parse raw WebVTT string content into structured subtitle blocks.
 * @param {string} vttContent
 * @returns {Array<{ id: number|string, startTime: string, endTime: string, text: string }>}
 */
export function parseVtt(vttContent) {
  const normalized = vttContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Strip WebVTT header line (e.g., WEBVTT - Lesson 1) and NOTE comment blocks
  const cleanedContent = normalized
    .replace(/^WEBVTT[^\n]*/i, "")
    .replace(/^NOTE(?:\s+[^\n]*)?(?:\n[^\n]+)*/gm, "");

  const blocks = cleanedContent.trim().split(/\n\s*\n/);
  const subtitles = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].trim().split("\n");
    let timeIndex = -1;

    for (let j = 0; j < lines.length; j++) {
      if (lines[j].includes("-->")) {
        timeIndex = j;
        break;
      }
    }

    if (timeIndex !== -1) {
      const cueId = timeIndex > 0 ? lines[0].trim() : i + 1;
      const timeLine = lines[timeIndex];

      // Separate timestamp pair from trailing cue settings (e.g. line:80% position:50% align:center)
      const [startPart, endAndSettings] = timeLine.split("-->").map((s) => s.trim());
      const startTime = startPart;
      const endTime = endAndSettings ? endAndSettings.split(/\s+/)[0] : "";

      let rawText = lines.slice(timeIndex + 1).join(" ");

      // Convert voice tags <v Speaker Name>Text</v> or <v Speaker Name>Text to "Speaker Name: Text"
      rawText = rawText.replace(/<v\s+([^>]+)>(.*?)<\/v>/gi, "$1: $2");
      rawText = rawText.replace(/<v\s+([^>]+)>(.*)/gi, "$1: $2");

      // Strip remaining HTML / VTT formatting tags (e.g., <b>, <i>, <00:00:01.234>, etc.)
      const text = rawText.replace(/<[^>]+>/g, "").trim();

      if (text) {
        subtitles.push({
          id: cueId,
          startTime: startTime || "",
          endTime: endTime || "",
          text,
        });
      }
    }
  }

  return subtitles;
}

/** Read a WebVTT file from disk and return formatted text with timestamps. */
async function readVttText(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  const subtitles = parseVtt(content);

  // Format each subtitle line with its timestamp: [00:00:01.500 --> 00:00:04.200] Speaker: Hello world
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
 * Full indexing pipeline for an uploaded PDF, SRT, WebVTT, or Plain Text file:
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
  } else if (ext === ".vtt" || mimeType?.includes("vtt")) {
    fileType = "vtt";
    text = await readVttText(filePath);
  } else if (ext === ".txt" || ext === ".md" || mimeType === "text/plain" || mimeType === "text/markdown") {
    fileType = "txt";
    text = await readTxtText(filePath);
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
