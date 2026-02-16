
import Worker from "./worker?worker";

export type BatchEmbeddingResultItem = {
  embedding: Float32Array | null;
  error: string | null;
};

export type EmbeddingBackendPreference = "webgpu" | "wasm";

export type EmbeddingRuntimeInfo = {
  preferredBackend: EmbeddingBackendPreference;
  selectedBackend: EmbeddingBackendPreference | null;
  fallbackReason: string | null;
};

type PendingJob = {
  resolve: (result: BatchEmbeddingResultItem[]) => void;
  reject: (error: Error) => void;
};

type EmbedderWorker = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
  terminate: () => void;
};

type EmbedderOptions = {
  workerFactory?: () => EmbedderWorker;
  preferredBackend?: EmbeddingBackendPreference;
};

function coerceFloat32Array(value: unknown): Float32Array | null {
  if (value == null) {
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

export class Embedder {
  private worker: EmbedderWorker;
  private pending = new Map<string, PendingJob>();
  private preferredBackend: EmbeddingBackendPreference;
  private selectedBackend: EmbeddingBackendPreference | null = null;
  private fallbackReason: string | null = null;

  constructor(optionsOrWorkerFactory?: EmbedderOptions | (() => EmbedderWorker)) {
    const options: EmbedderOptions =
      typeof optionsOrWorkerFactory === "function"
        ? { workerFactory: optionsOrWorkerFactory }
        : (optionsOrWorkerFactory ?? {});
    this.preferredBackend = options.preferredBackend ?? "webgpu";
    this.worker = options.workerFactory
      ? options.workerFactory()
      : (new Worker() as unknown as EmbedderWorker);
    this.worker.onmessage = (event) => {
      const { id, status, embeddings, errors, error, selectedBackend, fallbackReason } = event.data as {
        id: string;
        status: "complete" | "error";
        embeddings?: unknown[];
        errors?: unknown[];
        error?: string;
        selectedBackend?: EmbeddingBackendPreference;
        fallbackReason?: string | null;
      };
      if (selectedBackend === "webgpu" || selectedBackend === "wasm") {
        this.selectedBackend = selectedBackend;
      }
      this.fallbackReason = fallbackReason == null ? null : String(fallbackReason);
      const job = this.pending.get(id);

      if (job) {
        this.pending.delete(id);
        if (status === "complete") {
          const normalizedEmbeddings = Array.isArray(embeddings) ? embeddings : [];
          const normalizedErrors = Array.isArray(errors) ? errors : [];
          const resultLength = Math.max(normalizedEmbeddings.length, normalizedErrors.length);
          const results: BatchEmbeddingResultItem[] = [];
          for (let i = 0; i < resultLength; i += 1) {
            const embedding = coerceFloat32Array(normalizedEmbeddings[i]);
            const itemError = normalizedErrors[i] == null ? null : String(normalizedErrors[i]);
            results.push({
              embedding,
              error: itemError,
            });
          }
          job.resolve(results);
        } else {
          job.reject(new Error(error ?? "Embedding worker failed"));
        }
      }
    };
  }

  async embedBatch(texts: string[]): Promise<BatchEmbeddingResultItem[]> {
    if (texts.length === 0) {
      return [];
    }

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, texts, preferredBackend: this.preferredBackend });
    });
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    const first = results[0];
    if (!first || first.error || !first.embedding) {
      throw new Error(first?.error ?? "Embedding worker returned empty vector");
    }

    return first.embedding;
  }

  terminate() {
    this.worker.terminate();
  }

  getRuntimeInfo(): EmbeddingRuntimeInfo {
    return {
      preferredBackend: this.preferredBackend,
      selectedBackend: this.selectedBackend,
      fallbackReason: this.fallbackReason,
    };
  }
}
