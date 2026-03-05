export type EmbeddingPooling = "none" | "mean" | "cls" | "first_token" | "eos" | "last_token";

type PoolingRule = {
  matches: (normalizedModel: string) => boolean;
  pooling: EmbeddingPooling;
};

const POOLING_RULES: PoolingRule[] = [
  {
    matches: (normalizedModel) => normalizedModel.includes("embeddinggemma"),
    pooling: "mean",
  },
];

/**
 * Resolve pooling strategy for browser embedding models.
 * Source for embeddinggemma mean pooling guidance:
 * https://github.com/huggingface/text-embeddings-inference/releases/tag/v1.8.1
 * (ONNX Runtime example for `onnx-community/embeddinggemma-300m-ONNX` uses
 * `--pooling mean`).
 */
export function resolveEmbeddingPooling(model: string | null | undefined): EmbeddingPooling {
  const normalized = model?.trim().toLowerCase() ?? "";
  for (const rule of POOLING_RULES) {
    if (rule.matches(normalized)) {
      return rule.pooling;
    }
  }
  return "mean";
}
