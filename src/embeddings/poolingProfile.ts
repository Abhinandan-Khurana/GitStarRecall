export type EmbeddingPooling = "none" | "mean" | "cls" | "first_token" | "eos" | "last_token";

/**
 * Resolve pooling strategy for browser embedding models.
 * Source for embeddinggemma mean pooling guidance:
 * https://github.com/huggingface/text-embeddings-inference/releases/tag/v1.8.1
 * (ONNX Runtime example for `onnx-community/embeddinggemma-300m-ONNX` uses
 * `--pooling mean`).
 *
 * Current browser model set is standardized on mean pooling.
 * If a future model requires a different pooling strategy, extend this helper.
 */
export function resolveEmbeddingPooling(model: string | null | undefined): EmbeddingPooling {
  void model;
  return "mean";
}
