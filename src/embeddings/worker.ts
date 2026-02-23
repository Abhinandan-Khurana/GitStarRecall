
import { pipeline, type FeatureExtractionPipeline, type PipelineType } from "@xenova/transformers";
import { executionProviders } from "@xenova/transformers/src/backends/onnx.js";
import {
  type EmbeddingBackendPreference,
  normalizeUnknownError,
  probeWebGpuSupport,
  resolvePreferredBackend,
} from "./backendSelection";

// Skip local model checks since we are running in the browser
import { env } from "@xenova/transformers";
env.allowLocalModels = false;
env.useBrowserCache = true;

class EmbeddingPipeline {
  static task: PipelineType = "feature-extraction";
  static model = "Xenova/all-MiniLM-L6-v2";
  static preferredBackend: EmbeddingBackendPreference | null = null;
  static selectedBackend: EmbeddingBackendPreference | null = null;
  static fallbackReason: string | null = null;
  static instance: Promise<FeatureExtractionPipeline> | null = null;

  static setExecutionProvider(backend: EmbeddingBackendPreference) {
    executionProviders.splice(0, executionProviders.length, backend);
  }

  static async initWithBackend(backend: EmbeddingBackendPreference) {
    this.setExecutionProvider(backend);
    return (pipeline(this.task, this.model, {
      quantized: true,
    }) as unknown) as Promise<FeatureExtractionPipeline>;
  }

  static async getInstance(preferredBackend: EmbeddingBackendPreference) {
    if (this.instance !== null && this.preferredBackend === preferredBackend) {
      return this.instance;
    }

    this.preferredBackend = preferredBackend;
    this.selectedBackend = null;
    this.fallbackReason = null;

    const loader = (async () => {
      if (preferredBackend === "wasm") {
        this.selectedBackend = "wasm";
        return this.initWithBackend("wasm");
      }

      const probe = await probeWebGpuSupport(
        typeof navigator !== "undefined" ? navigator : undefined,
      );
      const resolved = resolvePreferredBackend(preferredBackend, probe);

      if (resolved.backend === "wasm") {
        this.selectedBackend = "wasm";
        this.fallbackReason = resolved.fallbackReason;
        return this.initWithBackend("wasm");
      }

      try {
        this.selectedBackend = "webgpu";
        return await this.initWithBackend("webgpu");
      } catch (error) {
        this.selectedBackend = "wasm";
        this.fallbackReason = `webgpu init failed: ${normalizeUnknownError(error)}`;
        return this.initWithBackend("wasm");
      }
    })();

    this.instance = loader;
    try {
      return await loader;
    } catch (error) {
      this.instance = null;
      this.selectedBackend = null;
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
  const { id, texts, text, preferredBackend } = event.data as {
    id: string;
    texts?: string[];
    text?: string;
    preferredBackend?: EmbeddingBackendPreference;
  };
  const batchTexts = Array.isArray(texts) ? texts : text != null ? [text] : [];
  const preferred = preferredBackend === "wasm" ? "wasm" : "webgpu";

  try {
    const pipe = await EmbeddingPipeline.getInstance(preferred);

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
      fallbackReason: EmbeddingPipeline.fallbackReason,
    });
  } catch (error) {
    self.postMessage({
      status: "error",
      id,
      error: normalizeUnknownError(error),
      selectedBackend: EmbeddingPipeline.selectedBackend,
      fallbackReason: EmbeddingPipeline.fallbackReason,
    });
  }
});
