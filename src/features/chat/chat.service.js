import { config } from "../../config/index.js";
import { qdrant } from "../../services/qdrant.js";
import { openai, embedText, embedTexts } from "../../services/openai.js";

/**
 * Rewrite a user's query into several variants to improve retrieval:
 *  - stepBack:   a broader, more general question (step-back prompting)
 *  - rewritten:  the same query with typos/grammar fixed and made explicit
 *  - subQueries: the query decomposed into 3 focused sub-questions
 *
 * @param {string} query
 * @returns {Promise<{ stepBack: string, rewritten: string, subQueries: string[] }>}
 */
export async function queryRewriting(query) {
  const completion = await openai.chat.completions.create({
    model: config.openai.chatModel,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "query_rewriting",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            stepBack: {
              type: "string",
              description:
                "A broader, higher-level 'step-back' question whose answer gives useful background for the original query.",
            },
            rewritten: {
              type: "string",
              description:
                "The original query with spelling/grammar fixed and made clear and self-contained. Preserve the original intent.",
            },
            subQueries: {
              type: "array",
              description: "Exactly 3 focused sub-questions the original query can be decomposed into.",
              items: { type: "string" },
            },
          },
          required: ["stepBack", "rewritten", "subQueries"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "You are a query understanding assistant for a retrieval system. " +
          "Given a user's question, produce query variants that help retrieve relevant documents. " +
          "Apply three techniques: (1) step-back prompting -> one broader background question; " +
          "(2) query rewriting -> fix typos/grammar and make the query explicit and self-contained; " +
          "(3) sub-query decomposition -> break the query into exactly 3 focused sub-questions. " +
          "Respond ONLY with the structured JSON.",
      },
      { role: "user", content: query },
    ],
  });

  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");

  return {
    stepBack: parsed.stepBack ?? "",
    rewritten: parsed.rewritten ?? query,
    // Guard against the model returning more/fewer than 3.
    subQueries: Array.isArray(parsed.subQueries) ? parsed.subQueries.slice(0, 3) : [],
  };
}

/**
 * HyDE (Hypothetical Document Embeddings): ask the model to write a short,
 * plausible passage that answers the query as if it were an excerpt from a
 * relevant document.
 *
 * @param {string} query
 * @returns {Promise<string>}
 */
export async function hydeDocument(query) {
  const completion = await openai.chat.completions.create({
    model: config.openai.chatModel,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "You are an expert writer. Write a concise, factual passage (3-5 sentences) that directly answers " +
          "the user's question, as if it were an excerpt from a relevant reference document. " +
          "Write confidently in a neutral, encyclopedic tone. Do not add disclaimers or say you are unsure.",
      },
      { role: "user", content: query },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

/** Search Qdrant for the chunks most similar to a single embedding vector. */
async function searchByVector(vector) {
  return qdrant.search(config.qdrant.collection, {
    vector,
    limit: config.retrieval.topK,
    with_payload: true,
  });
}

/**
 * Reciprocal Rank Fusion: combine several ranked result lists into one.
 *
 * @param {Array<{ label: string, hits: any[] }>} rankedLists
 * @param {number} k
 */
function reciprocalRankFusion(rankedLists, k = config.retrieval.rrfK) {
  const fused = new Map();

  for (const { label, hits } of rankedLists) {
    hits.forEach((h, index) => {
      const rank = index + 1; // 1-based
      const contribution = 1 / (k + rank);
      const existing = fused.get(h.id);

      if (existing) {
        existing.rrfScore += contribution;
        existing.bestScore = Math.max(existing.bestScore, h.score);
        existing.matchedBy.push(label);
      } else {
        fused.set(h.id, {
          id: h.id,
          text: h.payload?.text ?? "",
          source: h.payload?.source ?? null,
          fileType: h.payload?.fileType ?? null,
          chunkIndex: h.payload?.chunkIndex ?? null,
          bestScore: h.score,
          rrfScore: contribution,
          matchedBy: [label],
        });
      }
    });
  }

  return [...fused.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Multi-query retrieval with Reciprocal Rank Fusion.
 *
 * @param {string} query
 */
export async function retrieveChunks(query) {
  const [{ stepBack, rewritten, subQueries }, hyde] = await Promise.all([
    queryRewriting(query),
    hydeDocument(query),
  ]);

  const labelled = [
    { label: "rewritten", text: rewritten },
    { label: "stepBack", text: stepBack },
    { label: "hyde", text: hyde },
    ...subQueries.map((q, i) => ({ label: `subQuery${i + 1}`, text: q })),
  ].filter((q) => typeof q.text === "string" && q.text.trim().length > 0);

  const vectors = await embedTexts(labelled.map((q) => q.text));
  const resultsPerQuery = await Promise.all(vectors.map((v) => searchByVector(v)));

  const rankedLists = labelled.map((q, i) => ({ label: q.label, hits: resultsPerQuery[i] }));
  const fused = reciprocalRankFusion(rankedLists);
  const chunks = fused.slice(0, config.retrieval.finalK);

  return {
    queries: { original: query, rewritten, stepBack, hyde, subQueries },
    chunks,
  };
}

/**
 * Grounded RAG query answer generation.
 * @param {string} query
 */
export async function answerQuery(query) {
  const collection = config.qdrant.collection;

  // 1. Check if Qdrant collection exists first
  try {
    const exists = await qdrant.collectionExists(collection);
    if (!exists.exists) {
      return {
        query,
        answer: "No class materials have been indexed yet in the vector database. Please upload at least one source file (PDF, SRT, WebVTT, or TXT) before asking questions.",
        sources: [],
        noCollection: true,
      };
    }
  } catch (err) {
    console.error("Failed checking Qdrant collection existence:", err?.message || err);
  }

  // 2. Embed query and search Qdrant
  let hits = [];
  try {
    const vector = await embedText(query);
    hits = await qdrant.search(collection, {
      vector,
      limit: config.retrieval.topK,
      with_payload: true,
    });
  } catch (err) {
    console.error("Qdrant search error:", err?.message || err);
    return {
      query,
      answer: "No class materials have been indexed yet in the vector database. Please upload at least one source file (PDF, SRT, WebVTT, or TXT) before asking questions.",
      sources: [],
      noCollection: true,
    };
  }

  const sources = hits.map((h) => {
    const text = h.payload?.text ?? "";
    const source = h.payload?.source ?? null;
    const fileType =
      h.payload?.fileType ??
      (source?.endsWith(".srt") ? "srt" : source?.endsWith(".vtt") ? "vtt" : "pdf");

    // Extract start & end timestamps if present in chunk text
    let timeRange = null;
    if (fileType === "srt" || fileType === "vtt" || text.includes("-->")) {
      const matches = [...text.matchAll(/\[(.*?) *--> *(.*?)\]/g)];
      if (matches.length > 0) {
        const startTime = matches[0][1].trim();
        const endTime = matches[matches.length - 1][2].trim();
        timeRange = {
          start: startTime,
          end: endTime,
          formatted: `${startTime} - ${endTime}`,
        };
      }
    }

    return {
      text,
      source,
      fileType,
      timeRange,
      chunkIndex: h.payload?.chunkIndex ?? null,
      score: h.score,
    };
  });

  if (sources.length === 0) {
    return {
      query,
      answer: "I couldn't find anything relevant in the indexed documents. Please try rephrasing your question or upload additional class sources.",
      sources: [],
      noSourcesFound: true,
    };
  }

  const context = sources
    .map((s, i) => {
      const header = s.timeRange
        ? `[Chunk ${i + 1}] (source: ${s.source}, timeRange: ${s.timeRange.formatted})`
        : `[Chunk ${i + 1}] (source: ${s.source})`;
      return `${header}\n${s.text}`;
    })
    .join("\n\n");

  const completion = await openai.chat.completions.create({
    model: config.openai.chatModel,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant for class material retrieval. " +
          "Answer the user's question using ONLY the provided context. " +
          "When referencing content from subtitle or video files (.srt / .vtt), explicitly mention the time range where the topic is discussed (e.g. 'Discussed between [00:01:10 - 00:01:45]'). " +
          "If the answer is not contained in the context, say you don't know. Be concise.",
      },
      {
        role: "user",
        content: `Context:\n${context}\n\nQuestion: ${query}`,
      },
    ],
  });

  const answer = completion.choices[0]?.message?.content?.trim() ?? "";

  return { query, answer, sources };
}
