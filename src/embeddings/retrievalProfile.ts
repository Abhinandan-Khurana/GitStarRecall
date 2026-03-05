export type RetrievalProfile = {
  queryPrefix: string;
  documentPrefix: string;
};

export const DEFAULT_BROWSER_EMBEDDING_MODEL = "onnx-community/embeddinggemma-300m-ONNX";
export const BROWSER_EMBEDDING_FALLBACK_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:0.6b";
const QWEN3_QUERY_INSTRUCTION_PREFIX =
  "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:";

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

export function isCuratedRetrievalModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  return (
    normalized.includes("qwen3-embedding") ||
    normalized.includes("embeddinggemma") ||
    normalized.includes("mxbai-embed") ||
    normalized.includes("nomic-embed")
  );
}

export function getRetrievalProfile(model: string): RetrievalProfile {
  const normalized = normalizeModelId(model);

  if (normalized.includes("qwen3-embedding")) {
    // Sources:
    // - https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
    // - https://huggingface.co/Qwen/Qwen3-Embedding-4B
    // Retrieval examples use "Instruct: ...\\nQuery: ..." for queries and raw text for passages.
    return {
      queryPrefix: QWEN3_QUERY_INSTRUCTION_PREFIX,
      documentPrefix: "",
    };
  }

  if (normalized.includes("embeddinggemma")) {
    // Source: https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX
    // The model card retrieval examples encode raw text directly ("no task prompt is needed").
    return {
      queryPrefix: "",
      documentPrefix: "",
    };
  }

  if (
    normalized.includes("mxbai-embed") ||
    normalized.includes("nomic-embed")
  ) {
    return {
      queryPrefix: "search_query: ",
      documentPrefix: "search_document: ",
    };
  }

  return {
    queryPrefix: "",
    documentPrefix: "",
  };
}

export function formatForEmbedding(text: string, prefix: string): string {
  const cleanPrefix = prefix.trim();
  if (!cleanPrefix) {
    return text;
  }
  return `${cleanPrefix} ${text}`;
}
