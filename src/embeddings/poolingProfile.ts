export type EmbeddingPooling = "none" | "mean" | "cls" | "first_token" | "eos" | "last_token";

/**
 * Resolve pooling strategy for browser embedding models.
 * Source for embeddinggemma mean pooling guidance:
 * https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX
 * (Text Embeddings Inference example uses `--pooling mean`).
 */
export function resolveEmbeddingPooling(model: string | null | undefined): EmbeddingPooling {
  const normalized = model?.trim().toLowerCase() ?? "";
  if (normalized.includes("embeddinggemma")) {
    return "mean";
  }
  return "mean";
}
