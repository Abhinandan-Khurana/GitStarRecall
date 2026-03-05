import {
  Embedder,
  type BatchEmbeddingResultItem,
  type BrowserEmbeddingModelCandidates,
  type EmbeddingBackendPreference,
  type EmbeddingRuntimeInfo,
} from "./Embedder";

type EmbedderLike = {
  embedBatch: (texts: string[]) => Promise<BatchEmbeddingResultItem[]>;
  terminate: () => void;
  getRuntimeInfo?: () => EmbeddingRuntimeInfo;
};

type EmbeddingWorkerPoolOptions = {
  poolSize?: number;
  maxPoolSize?: number;
  maxQueueSize?: number;
  downshiftErrorThreshold?: number;
  workerBatchSize?: number;
  preferredBackend?: EmbeddingBackendPreference;
  modelCandidates?: BrowserEmbeddingModelCandidates;
  createEmbedder?: () => EmbedderLike;
};

type EmbeddingWorkerPoolStatus = {
  configuredPoolSize: number;
  activePoolSize: number;
  maxQueueSize: number;
  downshifted: boolean;
  downshiftReason: string | null;
  errorCount: number;
  preferredBackend: EmbeddingBackendPreference;
  selectedBackend: EmbeddingBackendPreference | null;
  selectedModel: string | null;
  backendFallbackReason: string | null;
};

const DEFAULT_POOL_SIZE = 2;
const DEFAULT_MAX_POOL_SIZE = 2;
const DEFAULT_MAX_QUEUE_SIZE = 1024;
const DEFAULT_DOWNSHIFT_ERROR_THRESHOLD = 3;
const DEFAULT_WORKER_BATCH_SIZE = 8;

function clampPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.trunc(parsed));
}

function normalizeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMemoryPressureError(errorMessage: string | null): boolean {
  if (!errorMessage) {
    return false;
  }
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes("out of memory") ||
    normalized.includes("memory") ||
    normalized.includes("oom") ||
    normalized.includes("allocation failed")
  );
}

export class EmbeddingWorkerPool {
  private readonly createEmbedder: () => EmbedderLike;
  private readonly maxQueueSize: number;
  private readonly maxPoolSize: number;
  private readonly downshiftErrorThreshold: number;
  private readonly configuredPoolSize: number;
  private readonly workerBatchSize: number;
  private readonly preferredBackend: EmbeddingBackendPreference;
  private readonly modelCandidates: BrowserEmbeddingModelCandidates;
  private activePoolSize: number;
  private embedders: EmbedderLike[] = [];
  private errorCount = 0;
  private downshiftReason: string | null = null;

  constructor(options: EmbeddingWorkerPoolOptions = {}) {
    const configuredPoolSize = clampPositiveInt(options.poolSize, DEFAULT_POOL_SIZE);
    const maxPoolSize = clampPositiveInt(options.maxPoolSize, DEFAULT_MAX_POOL_SIZE);
    this.configuredPoolSize = configuredPoolSize;
    this.maxPoolSize = Math.max(1, maxPoolSize);
    this.activePoolSize = Math.min(configuredPoolSize, this.maxPoolSize);
    this.maxQueueSize = clampPositiveInt(options.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE);
    this.downshiftErrorThreshold = clampPositiveInt(
      options.downshiftErrorThreshold,
      DEFAULT_DOWNSHIFT_ERROR_THRESHOLD,
    );
    this.workerBatchSize = clampPositiveInt(options.workerBatchSize, DEFAULT_WORKER_BATCH_SIZE);
    this.preferredBackend = options.preferredBackend ?? "webgpu";
    this.modelCandidates = options.modelCandidates ?? [];
    this.createEmbedder =
      options.createEmbedder ??
      (() =>
        new Embedder({
          preferredBackend: this.preferredBackend,
          modelCandidates: this.modelCandidates,
        }));
  }

  private ensureWorkers(): void {
    while (this.embedders.length < this.activePoolSize) {
      this.embedders.push(this.createEmbedder());
    }
  }

  private downshiftToSingle(reason: string): void {
    this.activePoolSize = 1;
    if (!this.downshiftReason) {
      this.downshiftReason = reason;
    }
  }

  setConcurrency(targetPoolSize: number): void {
    const normalized = clampPositiveInt(targetPoolSize, 1);
    this.activePoolSize = Math.max(1, Math.min(normalized, this.maxPoolSize, this.configuredPoolSize));
    if (this.activePoolSize > 1) {
      this.downshiftReason = null;
    }
  }

  private updateConcurrencyForRuntime(): void {
    const status = this.getStatus();
    if (status.selectedBackend === "webgpu") {
      this.setConcurrency(1);
      return;
    }

    if (!status.downshifted && this.activePoolSize < this.configuredPoolSize) {
      this.setConcurrency(this.configuredPoolSize);
    }
  }

  getStatus(): EmbeddingWorkerPoolStatus {
    const runtimeInfos = this.embedders
      .map((embedder) => embedder.getRuntimeInfo?.())
      .filter((info): info is EmbeddingRuntimeInfo => info != null);
    const selectedBackend =
      runtimeInfos.find((info) => info.selectedBackend != null)?.selectedBackend ?? null;
    const selectedModel =
      runtimeInfos.find((info) => info.selectedModel != null)?.selectedModel ?? null;
    const backendFallbackReason =
      runtimeInfos.find((info) => info.fallbackReason != null)?.fallbackReason ?? null;

    return {
      configuredPoolSize: this.configuredPoolSize,
      activePoolSize: this.activePoolSize,
      maxQueueSize: this.maxQueueSize,
      downshifted: this.activePoolSize < this.configuredPoolSize,
      downshiftReason: this.downshiftReason,
      errorCount: this.errorCount,
      preferredBackend: this.preferredBackend,
      selectedBackend,
      selectedModel,
      backendFallbackReason,
    };
  }

  async embedBatch(texts: string[]): Promise<BatchEmbeddingResultItem[]> {
    if (texts.length === 0) {
      return [];
    }

    if (texts.length > this.maxQueueSize) {
      throw new Error(`embedding queue overflow: ${texts.length} > ${this.maxQueueSize}`);
    }

    this.ensureWorkers();
    this.updateConcurrencyForRuntime();
    const results: BatchEmbeddingResultItem[] = Array.from({ length: texts.length }, () => ({
      embedding: null,
      error: "embedding job was not executed",
    }));

    const jobs: Array<{ offset: number; texts: string[] }> = [];
    for (let offset = 0; offset < texts.length; offset += this.workerBatchSize) {
      jobs.push({
        offset,
        texts: texts.slice(offset, offset + this.workerBatchSize),
      });
    }
    let cursor = 0;
    const workerCount = Math.min(this.activePoolSize, jobs.length);

    const runWorker = async (workerIndex: number) => {
      const embedder = this.embedders[workerIndex];
      if (!embedder) {
        return;
      }

      while (true) {
        const nextIndex = cursor;
        if (nextIndex >= jobs.length) {
          break;
        }
        cursor += 1;

        const job = jobs[nextIndex];
        if (!job) {
          break;
        }
        try {
          const itemResults = await embedder.embedBatch(job.texts);
          if (itemResults.length !== job.texts.length) {
            throw new Error(
              `embedding batch length mismatch: expected ${job.texts.length}, got ${itemResults.length}`,
            );
          }

          for (let i = 0; i < itemResults.length; i += 1) {
            const targetIndex = job.offset + i;
            const item = itemResults[i] ?? { embedding: null, error: "missing batch item result" };
            results[targetIndex] = item;
            if (item.error) {
              this.errorCount += 1;
              if (
                isMemoryPressureError(item.error) ||
                this.errorCount >= this.downshiftErrorThreshold
              ) {
                this.downshiftToSingle(item.error);
              }
            }
          }
        } catch (error) {
          const message = normalizeError(error);
          for (let i = 0; i < job.texts.length; i += 1) {
            const targetIndex = job.offset + i;
            this.errorCount += 1;
            results[targetIndex] = { embedding: null, error: message };
          }
          if (isMemoryPressureError(message) || this.errorCount >= this.downshiftErrorThreshold) {
            this.downshiftToSingle(message);
          }
        }

        if (this.activePoolSize === 1 && workerIndex > 0) {
          // Exit extra workers once pool is downshifted.
          break;
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, (_, index) => runWorker(index)));
    return results;
  }

  terminate(): void {
    for (const embedder of this.embedders) {
      embedder.terminate();
    }
    this.embedders = [];
  }
}
