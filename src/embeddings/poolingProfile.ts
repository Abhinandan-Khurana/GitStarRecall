export type EmbeddingPooling = "none" | "mean" | "cls" | "first_token" | "eos" | "last_token";

const KNOWN_MEAN_POOLING_MODEL_HINTS = [
  "embeddinggemma",
  "all-minilm",
  "qwen3-embedding",
  "mxbai-embed",
  "nomic-embed",
] as const;
const warnedUnknownModelPoolings = new Set<string>();

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
  const normalizedModel = model?.trim().toLowerCase() ?? "";
  if (!normalizedModel) {
    return "mean";
  }
  if (KNOWN_MEAN_POOLING_MODEL_HINTS.some((hint) => normalizedModel.includes(hint))) {
    return "mean";
  }
  if (!warnedUnknownModelPoolings.has(normalizedModel)) {
    warnedUnknownModelPoolings.add(normalizedModel);
    console.warn(
      `Unknown embedding model '${normalizedModel}' for pooling profile; defaulting to mean pooling.`,
    );
  }
  return "mean";
}
