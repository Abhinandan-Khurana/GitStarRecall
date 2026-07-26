import Worker from "./worker?worker";

export type BatchEmbeddingResultItem = {
  embedding: Float32Array | null;
  error: string | null;
};

export type EmbeddingBackendPreference = "webgpu" | "wasm";
export type BrowserEmbeddingModelCandidates = string[];

export type EmbeddingRuntimeInfo = {
  preferredBackend: EmbeddingBackendPreference;
  selectedBackend: EmbeddingBackendPreference | null;
  selectedModel: string | null;
  fallbackReason: string | null;
};

type PendingJob = {
  resolve: (result: BatchEmbeddingResultItem[]) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type EmbedderWorker = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => unknown) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
  terminate: () => void;
};

type EmbedderOptions = {
  workerFactory?: () => EmbedderWorker;
  preferredBackend?: EmbeddingBackendPreference;
  modelCandidates?: BrowserEmbeddingModelCandidates;
  requestTimeoutMs?: number;
};

export type EmbeddingWorkerErrorCode =
  | "worker_error"
  | "worker_response_error"
  | "message_error"
  | "malformed_response"
  | "request_timeout"
  | "terminated"
  | "post_message_failed";

export class EmbeddingWorkerError extends Error {
  constructor(
    public readonly code: EmbeddingWorkerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EmbeddingWorkerError";
  }
}

export function isFatalEmbeddingWorkerError(error: unknown): error is EmbeddingWorkerError {
  return (
    error instanceof EmbeddingWorkerError &&
    (error.code === "worker_error" ||
      error.code === "message_error" ||
      error.code === "malformed_response" ||
      error.code === "terminated")
  );
}

// A first request may include model download and initialization, so the shared
// bound is deliberately longer than an ordinary already-warm worker request.
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

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
  private modelCandidates: BrowserEmbeddingModelCandidates;
  private selectedBackend: EmbeddingBackendPreference | null = null;
  private selectedModel: string | null = null;
  private fallbackReason: string | null = null;
  private readonly requestTimeoutMs: number;
  private terminated = false;

  constructor(optionsOrWorkerFactory?: EmbedderOptions | (() => EmbedderWorker)) {
    const options: EmbedderOptions =
      typeof optionsOrWorkerFactory === "function"
        ? { workerFactory: optionsOrWorkerFactory }
        : (optionsOrWorkerFactory ?? {});
    this.preferredBackend = options.preferredBackend ?? "webgpu";
    this.modelCandidates = options.modelCandidates ?? [];
    this.requestTimeoutMs =
      Number.isFinite(options.requestTimeoutMs) && Number(options.requestTimeoutMs) > 0
        ? Math.trunc(Number(options.requestTimeoutMs))
        : DEFAULT_REQUEST_TIMEOUT_MS;
    this.worker = options.workerFactory
      ? options.workerFactory()
      : (new Worker() as unknown as EmbedderWorker);
    this.worker.onmessage = (event) => this.handleMessage(event);
    this.worker.onerror = (event) => {
      this.failWorker(
        new EmbeddingWorkerError(
          "worker_error",
          event.message || "Embedding worker crashed",
          event.error === undefined ? undefined : { cause: event.error },
        ),
      );
    };
    this.worker.onmessageerror = () => {
      this.failWorker(
        new EmbeddingWorkerError("message_error", "Embedding worker message could not be decoded"),
      );
    };
  }

  private handleMessage(event: MessageEvent): void {
    const data = event.data;
    if (data == null || typeof data !== "object") {
      this.failWorker(
        new EmbeddingWorkerError(
          "malformed_response",
          "Embedding worker returned a malformed response",
        ),
      );
      return;
    }

    const {
      id,
      status,
      embeddings,
      errors,
      error,
      selectedBackend,
      selectedModel,
      fallbackReason,
    } = data as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      (status !== "complete" && status !== "error")
    ) {
      this.failWorker(
        new EmbeddingWorkerError(
          "malformed_response",
          "Embedding worker returned a malformed response",
        ),
      );
      return;
    }

    const job = this.pending.get(id);
    if (!job) {
      // A timed-out request may still produce a late response. It must not
      // affect a newer request using the same worker.
      return;
    }

    if (status === "complete" && (!Array.isArray(embeddings) || !Array.isArray(errors))) {
      this.failWorker(
        new EmbeddingWorkerError(
          "malformed_response",
          "Embedding worker returned a malformed response",
        ),
      );
      return;
    }

    clearTimeout(job.timeoutId);
    this.pending.delete(id);
    if (selectedBackend === "webgpu" || selectedBackend === "wasm") {
      this.selectedBackend = selectedBackend;
    }
    this.selectedModel =
      typeof selectedModel === "string" && selectedModel.trim().length > 0
        ? selectedModel.trim()
        : null;
    this.fallbackReason = fallbackReason == null ? null : String(fallbackReason);

    if (status === "complete") {
      const normalizedEmbeddings = embeddings as unknown[];
      const normalizedErrors = errors as unknown[];
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
      return;
    }

    job.reject(
      new EmbeddingWorkerError(
        "worker_response_error",
        typeof error === "string" && error.length > 0 ? error : "Embedding worker failed",
      ),
    );
  }

  private rejectPending(error: EmbeddingWorkerError): void {
    const jobs = [...this.pending.values()];
    this.pending.clear();
    for (const job of jobs) {
      clearTimeout(job.timeoutId);
      job.reject(error);
    }
  }

  private failWorker(error: EmbeddingWorkerError): void {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    this.rejectPending(error);
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate();
  }

  async embedBatch(texts: string[]): Promise<BatchEmbeddingResultItem[]> {
    if (texts.length === 0) {
      return [];
    }

    if (this.terminated) {
      throw new EmbeddingWorkerError("terminated", "Embedding worker has been terminated");
    }

    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!this.pending.delete(id)) {
          return;
        }
        reject(
          new EmbeddingWorkerError(
            "request_timeout",
            `Embedding worker request timed out after ${this.requestTimeoutMs}ms`,
          ),
        );
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeoutId });
      try {
        this.worker.postMessage({
          id,
          texts,
          preferredBackend: this.preferredBackend,
          modelCandidates: this.modelCandidates,
        });
      } catch (error) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(
          new EmbeddingWorkerError(
            "post_message_failed",
            "Embedding worker request could not be sent",
            {
              cause: error,
            },
          ),
        );
      }
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

  terminate(): void {
    this.failWorker(new EmbeddingWorkerError("terminated", "Embedding worker was terminated"));
  }

  getRuntimeInfo(): EmbeddingRuntimeInfo {
    return {
      preferredBackend: this.preferredBackend,
      selectedBackend: this.selectedBackend,
      selectedModel: this.selectedModel,
      fallbackReason: this.fallbackReason,
    };
  }
}
