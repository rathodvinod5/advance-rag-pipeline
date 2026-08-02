# 🚀 Advance RAG Pipeline Backend

An enterprise-grade, domain-driven **Advanced Retrieval-Augmented Generation (RAG)** backend service built with **Node.js**, **Express**, **BullMQ**, **Redis**, **Qdrant Vector DB**, and **OpenAI**.

This project provides asynchronous document ingestion, multi-format parsing, multi-query expansion, HyDE (Hypothetical Document Embeddings), Reciprocal Rank Fusion (RRF), and timestamp-aware citations for educational and notebook platforms.

---

## 🌟 Key Features

- **Multi-Format Ingestion**:
  - **PDF Documents** (`.pdf`) via `pdf-parse`.
  - **Subtitles & Transcripts** (`.srt`, `.vtt`) with automatic timestamp preservation and WebVTT speaker tag cleaning.
  - **Plain Text Notes** (`.txt`, `.md`).
- **Async Background Queue & Workers**:
  - Uses **BullMQ** + **Redis** to execute PDF parsing, text chunking, OpenAI vector embeddings, and RAG query processing without blocking HTTP API loops.
- **Advanced RAG Retrieval Architecture**:
  - **Query Rewriting & Expansion**: Decomposes user questions into step-back queries, typo-corrected prompts, and focused sub-queries.
  - **HyDE (Hypothetical Document Embeddings)**: Generates hypothetical document excerpts to improve vector search accuracy.
  - **Reciprocal Rank Fusion (RRF)**: Merges ranked retrieval candidate lists across all expanded queries.
  - **Timestamp Citations**: Preserves subtitle timecodes (`[00:01:10 --> 00:01:45]`) so answers can cite exact video time ranges.
- **Feature-First / Domain-Driven Architecture**:
  - Modular structure separating ingestion (`features/sources`) from chat & retrieval (`features/chat`).

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Runtime & Framework** | Node.js (ESM), Express.js |
| **Vector Database** | Qdrant Vector Search Engine |
| **Queue & Worker Store** | BullMQ & Redis |
| **AI / LLM Models** | OpenAI API (`text-embedding-3-small`, `gpt-4o-mini`) |
| **File Processing** | Multer, `pdf-parse` |

---

## 📁 Directory Structure

```
advance-rag-pipeline/
├── docker-compose.yml            # Docker services (Qdrant & Redis)
├── package.json
├── .env.example
├── uploads/                      # Temporary storage for uploaded source files
└── src/
    ├── config/                   # Centralized configuration & queue constants
    │   └── index.js              # Environment variables & RAG hyperparameters
    │
    ├── services/                 # Infrastructure & client connections
    │   ├── openai.js             # OpenAI SDK & batch embedding helpers
    │   ├── qdrant.js             # Qdrant client & collection initialization
    │   └── redis.js              # Redis connection config for BullMQ
    │
    ├── middleware/               # Express middlewares
    │   ├── upload.js             # Multer disk storage & format validator
    │   └── errorHandler.js       # Centralized error handler
    │
    ├── features/                 # Domain-driven feature slices
    │   │
    │   ├── sources/              # Document Ingestion Domain
    │   │   ├── sources.router.js # POST /index endpoint
    │   │   ├── sources.service.js# PDF, SRT, VTT, TXT parser & Qdrant indexer
    │   │   ├── sources.queue.js  # BullMQ indexing producer
    │   │   └── sources.worker.js # BullMQ indexing worker consumer
    │   │
    │   └── chat/                 # RAG Query & Agent Engine Domain
    │       ├── chat.router.js    # POST /query & GET /query/:id endpoints
    │       ├── chat.service.js   # Multi-query expansion, HyDE, RRF & answer generator
    │       ├── chat.queue.js     # BullMQ query producer
    │       └── chat.worker.js    # BullMQ query worker consumer
    │
    ├── worker.js                 # Unified background worker process entry point
    └── index.js                  # Express API server entry point
```

---

## ⚙️ Environment Variables Setup

Create a `.env` file in the root directory (or copy `.env.example`):

```bash
cp .env.example .env
```

Ensure your `.env` contains your OpenAI API key and service ports:

```env
# Server Port
PORT=8000

# Redis Connection (BullMQ)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Qdrant Vector Database
QDRANT_URL=http://127.0.0.1:6333
QDRANT_COLLECTION=documents

# OpenAI API Key & Models
OPENAI_API_KEY=sk-your-actual-openai-api-key-here
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
CHAT_MODEL=gpt-4o-mini

# Chunking Configuration
CHUNK_SIZE=1000
CHUNK_OVERLAP=200

# RAG Retrieval Parameters
RETRIEVAL_TOP_K=4
RRF_K=60
RETRIEVAL_FINAL_K=5
```

---

## 🚀 How to Run Locally

### 1. Start Qdrant & Redis Containers
Ensure Docker Desktop is running, then start the required database services:

```bash
npm run services:up
```
*(Runs `docker compose up -d` starting Qdrant on port `6333` and Redis on port `6379`)*

---

### 2. Start the Express API Server
In terminal 1:

```bash
npm run dev
```
> 🚀 **Server listening on http://localhost:8000**

---

### 3. Start the Background Queue Workers
In terminal 2:

```bash
npm run worker
```
> 👷 **Workers initialized (indexing + query). Waiting for jobs...**

---

## 📡 API Endpoints

### 1. Health Check
```http
GET /health
```
**Response (200 OK)**:
```json
{ "status": "ok" }
```

---

### 2. Upload & Index Source Document
```http
POST /index
Content-Type: multipart/form-data
```
- **Form Field**: `file` (Supports `.pdf`, `.srt`, `.vtt`, `.txt`, `.md`)

**Response (202 Accepted)**:
```json
{
  "message": "File uploaded and queued for indexing",
  "jobId": "1",
  "file": {
    "originalName": "lecture_01.srt",
    "storedAs": "1722300000000-uuid.srt",
    "size": 2450
  }
}
```

---

### 3. Submit RAG Query
```http
POST /query
Content-Type: application/json
```
**Request Body**:
```json
{
  "query": "What are Binary Search Trees?"
}
```

**Response (202 Accepted)**:
```json
{
  "message": "Query queued",
  "jobId": "1",
  "poll": "/query/1"
}
```

---

### 4. Poll Query Result & Timestamp Citations
```http
GET /query/:id
```
**Response (200 OK when completed)**:
```json
{
  "jobId": "1",
  "status": "completed",
  "result": {
    "query": "What are Binary Search Trees?",
    "answer": "A Binary Search Tree keeps its keys in sorted order so lookup is O(log n). (Discussed between [00:00:11,000 - 00:00:16,300]).",
    "sources": [
      {
        "text": "[00:00:11,000 --> 00:00:16,300] A Binary Search Tree keeps its keys in sorted order...",
        "source": "lecture_01.srt",
        "fileType": "srt",
        "timeRange": {
          "start": "00:00:11,000",
          "end": "00:00:16,300",
          "formatted": "00:00:11,000 - 00:00:16,300"
        },
        "chunkIndex": 0,
        "score": 0.89
      }
    ]
  }
}
```

---

## ⏹️ Stopping Services

To shut down background database services:

```bash
npm run services:down
```
