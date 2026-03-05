import { pipeline, type FeatureExtractionPipeline, type PipelineType } from "@huggingface/transformers";
import {
  type EmbeddingBackendPreference,
  normalizeUnknownError,
  probeWebGpuSupport,
  resolvePreferredBackend,
} from "./backendSelection";
import {
  BROWSER_EMBEDDING_FALLBACK_MODEL,
  DEFAULT_BROWSER_EMBEDDING_MODEL,
} from "./retrievalProfile";

// Skip local model checks since we are running in the browser
import { env } from "@huggingface/transformers";
env.allowLocalModels = false;
env.useBrowserCache = true;

class EmbeddingPipeline {
  static task: PipelineType = "feature-extraction";
  static defaultModelCandidates: Array<{ model: string; dtype: "q8" }> = [
    { model: DEFAULT_BROWSER_EMBEDDING_MODEL, dtype: "q8" },
    { model: BROWSER_EMBEDDING_FALLBACK_MODEL, dtype: "q8" },
  ];
  static preferredBackend: EmbeddingBackendPreference | null = null;
  static modelCandidatesKey: string | null = null;
  static selectedBackend: EmbeddingBackendPreference | null = null;
  static selectedModel: string | null = null;
  static fallbackReason: string | null = null;
  static instance: Promise<FeatureExtractionPipeline> | null = null;

  static buildModelCandidates(overrideModels: string[] | undefined): Array<{ model: string; dtype: "q8" }> {
    if (!overrideModels || overrideModels.length === 0) {
      return this.defaultModelCandidates;
    }
    const normalized = overrideModels
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((model) => ({ model, dtype: "q8" as const }));
    return normalized.length > 0 ? normalized : this.defaultModelCandidates;
  }

  static getModelCandidatesKey(overrideModels: string[] | undefined): string {
    const candidates = this.buildModelCandidates(overrideModels);
    return candidates.map((item) => `${item.model}|${item.dtype}`).join("::");
  }

  static getUniqueModelCandidates(overrideModels: string[] | undefined): Array<{ model: string; dtype: "q8" }> {
    const seen = new Set<string>();
    const unique: Array<{ model: string; dtype: "q8" }> = [];
    for (const candidate of this.buildModelCandidates(overrideModels)) {
      const normalizedModel = candidate.model.trim();
      const key = `${normalizedModel}|${candidate.dtype}`;
      if (!normalizedModel || seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push({
        model: normalizedModel,
        dtype: candidate.dtype,
      });
    }
    return unique;
  }

  static async initWithBackend(backend: EmbeddingBackendPreference, overrideModels: string[] | undefined) {
    const candidates = this.getUniqueModelCandidates(overrideModels);
    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        const instance = (await ((pipeline(this.task, candidate.model, {
          device: backend,
          dtype: candidate.dtype,
        }) as unknown) as Promise<FeatureExtractionPipeline>));
        this.selectedModel = candidate.model;
        return instance;
      } catch (error) {
        const mode = candidate.dtype;
        errors.push(`${candidate.model} (${mode}): ${normalizeUnknownError(error)}`);
      }
    }
    const fallbackDetails = errors[errors.length - 1] ?? "unknown initialization error";
    throw new Error(
      `No compatible browser embedding model could be loaded (${backend}). Last failure: ${fallbackDetails}`,
    );
  }

  static async getInstance(preferredBackend: EmbeddingBackendPreference, overrideModels: string[] | undefined) {
    const nextCandidatesKey = this.getModelCandidatesKey(overrideModels);
    if (
      this.instance !== null &&
      this.preferredBackend === preferredBackend &&
      this.modelCandidatesKey === nextCandidatesKey
    ) {
      return this.instance;
    }

    this.preferredBackend = preferredBackend;
    this.modelCandidatesKey = nextCandidatesKey;
    this.selectedBackend = null;
    this.selectedModel = null;
    this.fallbackReason = null;

    const loader = (async () => {
      if (preferredBackend === "wasm") {
        this.selectedBackend = "wasm";
        return this.initWithBackend("wasm", overrideModels);
      }

      const probe = await probeWebGpuSupport(
        typeof navigator !== "undefined" ? navigator : undefined,
      );
      const resolved = resolvePreferredBackend(preferredBackend, probe);

      if (resolved.backend === "wasm") {
        this.selectedBackend = "wasm";
        this.fallbackReason = resolved.fallbackReason;
        return this.initWithBackend("wasm", overrideModels);
      }

      try {
        this.selectedBackend = "webgpu";
        return await this.initWithBackend("webgpu", overrideModels);
      } catch (error) {
        this.selectedBackend = "wasm";
        this.fallbackReason = `webgpu init failed: ${normalizeUnknownError(error)}`;
        return this.initWithBackend("wasm", overrideModels);
      }
    })();

    this.instance = loader;
    try {
      return await loader;
    } catch (error) {
      this.instance = null;
      this.selectedBackend = null;
      this.selectedModel = null;
      this.modelCandidatesKey = null;
      if (!this.fallbackReason) {
        this.fallbackReason = normalizeUnknownError(error);
      }
      throw error;
    }
  }
}

type BatchTensorLike = {
  data?: Float32Array | number[];
  dims?: number[];
};

function toFloat32Array(value: Float32Array | number[] | undefined): Float32Array | null {
  if (!value) {
    return null;
  }
  if (value instanceof Float32Array) {
    return value;
  }
  if (Array.isArray(value)) {
    return Float32Array.from(value);
  }
  return null;
}

function splitBatchedTensor(output: BatchTensorLike, expectedItems: number): Array<Float32Array | null> | null {
  const data = toFloat32Array(output.data);
  const dims = output.dims;
  if (!data || !dims || dims.length < 2) {
    return null;
  }
  const batch = Number(dims[0]);
  if (!Number.isFinite(batch) || batch < 1 || batch !== expectedItems) {
    return null;
  }
  const dimension = Math.trunc(data.length / batch);
  if (!Number.isFinite(dimension) || dimension < 1 || dimension * batch !== data.length) {
    return null;
  }

  const vectors: Array<Float32Array | null> = [];
  for (let i = 0; i < batch; i += 1) {
    const start = i * dimension;
    const end = start + dimension;
    vectors.push(data.slice(start, end));
  }
  return vectors;
}

function normalizeBatchOutput(output: unknown, expectedItems: number): Array<Float32Array | null> | null {
  if (Array.isArray(output)) {
    if (output.length !== expectedItems) {
      return null;
    }
    return output.map((item) => {
      if (item && typeof item === "object") {
        const tensor = item as BatchTensorLike;
        return toFloat32Array(tensor.data);
      }
      return null;
    });
  }

  if (output && typeof output === "object") {
    const tensor = output as BatchTensorLike;
    const split = splitBatchedTensor(tensor, expectedItems);
    if (split) {
      return split;
    }
    if (expectedItems === 1) {
      return [toFloat32Array(tensor.data)];
    }
  }

  return null;
}

self.addEventListener("message", async (event) => {
  const { id, texts, text, preferredBackend, modelCandidates } = event.data as {
    id: string;
    texts?: string[];
    text?: string;
    preferredBackend?: EmbeddingBackendPreference;
    modelCandidates?: string[];
  };
  const batchTexts = Array.isArray(texts) ? texts : text != null ? [text] : [];
  const preferred = preferredBackend === "wasm" ? "wasm" : "webgpu";
  const preferredModels = Array.isArray(modelCandidates) ? modelCandidates : undefined;

  try {
    const pipe = await EmbeddingPipeline.getInstance(preferred, preferredModels);

    const embeddings: Array<Float32Array | null> = Array.from({ length: batchTexts.length }, () => null);
    const errors: Array<string | null> = Array.from({ length: batchTexts.length }, () => null);

    try {
      const batchOutput = await pipe(batchTexts, { pooling: "mean", normalize: true });
      const normalized = normalizeBatchOutput(batchOutput, batchTexts.length);
      if (!normalized) {
        throw new Error("invalid batched embedding output shape");
      }
      for (let i = 0; i < normalized.length; i += 1) {
        embeddings[i] = normalized[i];
      }
    } catch (batchError) {
      for (let i = 0; i < batchTexts.length; i += 1) {
        const itemText = batchTexts[i];
        try {
          const output = await pipe(itemText, { pooling: "mean", normalize: true });
          const normalized = normalizeBatchOutput(output, 1);
          embeddings[i] = normalized?.[0] ?? null;
        } catch (itemError) {
          errors[i] =
            itemError instanceof Error
              ? itemError.message
              : batchError instanceof Error
                ? batchError.message
                : String(batchError);
        }
      }
    }

    self.postMessage({
      status: "complete",
      id,
      embeddings,
      errors,
      selectedBackend: EmbeddingPipeline.selectedBackend,
      selectedModel: EmbeddingPipeline.selectedModel,
      fallbackReason: EmbeddingPipeline.fallbackReason,
    });
  } catch (error) {
    self.postMessage({
      status: "error",
      id,
      error: normalizeUnknownError(error),
      selectedBackend: EmbeddingPipeline.selectedBackend,
      selectedModel: EmbeddingPipeline.selectedModel,
      fallbackReason: EmbeddingPipeline.fallbackReason,
    });
  }
});
