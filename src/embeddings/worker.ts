
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

    const embeddings: Array<Float32Array | null> = [];
    const errors: Array<string | null> = [];

    // Generate embeddings for a batch in request order.
    // Per-item errors are captured and returned without dropping the whole batch.
    for (const itemText of batchTexts) {
      try {
        const output = await pipe(itemText, { pooling: "mean", normalize: true });
        const embedding = (output as { data: Float32Array }).data;
        embeddings.push(embedding);
        errors.push(null);
      } catch (itemError) {
        embeddings.push(null);
        errors.push(itemError instanceof Error ? itemError.message : String(itemError));
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
