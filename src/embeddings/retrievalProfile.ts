export type RetrievalProfile = {
  queryPrefix: string;
  documentPrefix: string;
};

export const DEFAULT_BROWSER_EMBEDDING_MODEL = "onnx-community/embeddinggemma-300m-ONNX";
export const BROWSER_EMBEDDING_FALLBACK_MODEL = "Xenova/all-MiniLM-L6-v2";
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:0.6b";

export function getRetrievalProfile(model: string): RetrievalProfile {
  const normalized = model.trim().toLowerCase();

  if (normalized.includes("qwen3-embedding")) {
    return {
      queryPrefix: "query: ",
      documentPrefix: "passage: ",
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
