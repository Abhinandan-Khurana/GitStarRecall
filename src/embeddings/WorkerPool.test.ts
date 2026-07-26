import { describe, expect, test, vi } from "vitest";
import { EmbeddingWorkerError } from "./Embedder";
import { EmbeddingWorkerPool } from "./WorkerPool";

type FakeEmbedder = {
  embedBatch: (
    texts: string[],
  ) => Promise<Array<{ embedding: Float32Array | null; error: string | null }>>;
  terminate: () => void;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("EmbeddingWorkerPool", () => {
  test("returns an empty batch without creating a worker", async () => {
    const createEmbedder = vi.fn();
    const pool = new EmbeddingWorkerPool({ createEmbedder });

    await expect(pool.embedBatch([])).resolves.toEqual([]);
    expect(createEmbedder).not.toHaveBeenCalled();
  });

  test("rejects a batch that exceeds the configured queue bound", async () => {
    const createEmbedder = vi.fn();
    const pool = new EmbeddingWorkerPool({ maxQueueSize: 1, createEmbedder });

    await expect(pool.embedBatch(["first", "second"])).rejects.toThrow(
      "embedding queue overflow: 2 > 1",
    );
    expect(createEmbedder).not.toHaveBeenCalled();
  });

  test("reduces worker calls by micro-batching texts", async () => {
    let callCount = 0;
    const pool = new EmbeddingWorkerPool({
      poolSize: 1,
      workerBatchSize: 4,
      createEmbedder: () => ({
        embedBatch: async (texts) => {
          callCount += 1;
          return texts.map((text) => ({
            embedding: Float32Array.from([text.length]),
            error: null,
          }));
        },
        terminate: () => {
          // noop
        },
      }),
    });

    const inputs = Array.from({ length: 10 }, (_, index) => `text-${index}`);
    const result = await pool.embedBatch(inputs);
    expect(result).toHaveLength(10);
    expect(callCount).toBe(3);
  });

  test("processes queue to completion and preserves result ordering", async () => {
    let workerIdCounter = 0;
    let maxBatchSizeObserved = 0;
    const pool = new EmbeddingWorkerPool({
      poolSize: 2,
      workerBatchSize: 2,
      createEmbedder: () => {
        const workerId = workerIdCounter;
        workerIdCounter += 1;
        const fake: FakeEmbedder = {
          embedBatch: async (texts) => {
            maxBatchSizeObserved = Math.max(maxBatchSizeObserved, texts.length);
            // Stagger responses so workers interleave.
            await new Promise((resolve) => setTimeout(resolve, workerId === 0 ? 3 : 1));
            return texts.map((text) => ({
              embedding: Float32Array.from([text.length, workerId]),
              error: null,
            }));
          },
          terminate: () => {
            // noop
          },
        };
        return fake;
      },
    });

    const inputs = ["a", "bb", "ccc", "dddd", "eeeee"];
    const results = await pool.embedBatch(inputs);
    expect(results).toHaveLength(inputs.length);
    expect(results.every((item) => item.error === null && item.embedding !== null)).toBe(true);
    expect(Array.from(results[0]?.embedding ?? [])).toEqual([1, expect.any(Number)]);
    expect(Array.from(results[1]?.embedding ?? [])).toEqual([2, expect.any(Number)]);
    expect(Array.from(results[4]?.embedding ?? [])).toEqual([5, expect.any(Number)]);
    expect(maxBatchSizeObserved).toBeGreaterThan(1);
  });

  test("downshifts pool to one worker after memory-pressure errors", async () => {
    let workerIdCounter = 0;
    const callCounts: number[] = [];
    const pool = new EmbeddingWorkerPool({
      poolSize: 2,
      downshiftErrorThreshold: 10,
      createEmbedder: () => {
        const workerId = workerIdCounter;
        workerIdCounter += 1;
        callCounts[workerId] = 0;
        const fake: FakeEmbedder = {
          embedBatch: async (texts) => {
            callCounts[workerId] += 1;
            if (workerId === 0 && callCounts[workerId] === 1) {
              return texts.map(() => ({
                embedding: null,
                error: "out of memory while running model",
              }));
            }
            return texts.map(() => ({
              embedding: Float32Array.from([1, workerId]),
              error: null,
            }));
          },
          terminate: () => {
            // noop
          },
        };
        return fake;
      },
    });

    await pool.embedBatch(["first", "second", "third", "fourth"]);
    const statusAfterFailure = pool.getStatus();
    expect(statusAfterFailure.downshifted).toBe(true);
    expect(statusAfterFailure.activePoolSize).toBe(1);

    const worker1CallsBefore = callCounts[1] ?? 0;
    await pool.embedBatch(["next-1", "next-2", "next-3"]);
    const worker1CallsAfter = callCounts[1] ?? 0;
    expect(worker1CallsAfter).toBe(worker1CallsBefore);

    pool.setConcurrency(2);
    expect(pool.getStatus()).toMatchObject({
      activePoolSize: 2,
      downshifted: false,
      downshiftReason: null,
    });
    await pool.embedBatch(["restored-1", "restored-2"]);
    expect(pool.getStatus()).toMatchObject({ activePoolSize: 2, downshifted: false });
  });

  test("setConcurrency retires surplus idle embedders", async () => {
    const terminationCounts = [0, 0];
    let nextWorkerId = 0;
    const pool = new EmbeddingWorkerPool({
      poolSize: 2,
      workerBatchSize: 1,
      createEmbedder: () => {
        const workerId = nextWorkerId;
        nextWorkerId += 1;
        return {
          embedBatch: async (texts) =>
            texts.map((text) => ({ embedding: Float32Array.from([text.length]), error: null })),
          terminate: () => {
            terminationCounts[workerId] += 1;
          },
        };
      },
    });

    await pool.embedBatch(["first", "second"]);
    expect(nextWorkerId).toBe(2);

    pool.setConcurrency(1);

    expect(pool.getStatus().activePoolSize).toBe(1);
    expect(terminationCounts).toEqual([0, 1]);
    await pool.embedBatch(["third"]);
    expect(nextWorkerId).toBe(2);
    expect(terminationCounts).toEqual([0, 1]);
    expect(pool.getStatus().activePoolSize).toBe(1);
  });

  test("defers retirement until active jobs finish without losing their results", async () => {
    const operations = [
      deferred<Array<{ embedding: Float32Array | null; error: string | null }>>(),
      deferred<Array<{ embedding: Float32Array | null; error: string | null }>>(),
    ];
    const terminationCounts = [0, 0];
    let nextWorkerId = 0;
    const pool = new EmbeddingWorkerPool({
      poolSize: 2,
      workerBatchSize: 1,
      createEmbedder: () => {
        const workerId = nextWorkerId;
        nextWorkerId += 1;
        return {
          embedBatch: () => operations[workerId].promise,
          terminate: () => {
            terminationCounts[workerId] += 1;
          },
        };
      },
    });

    const pending = pool.embedBatch(["first", "second"]);
    pool.setConcurrency(1);
    expect(terminationCounts).toEqual([0, 0]);

    operations[0].resolve([{ embedding: Float32Array.from([1]), error: null }]);
    operations[1].resolve([{ embedding: Float32Array.from([2]), error: null }]);
    const results = await pending;

    expect(results.map((item) => Array.from(item.embedding ?? []))).toEqual([[1], [2]]);
    expect(terminationCounts).toEqual([0, 1]);
    expect(pool.getStatus().activePoolSize).toBe(1);
  });

  test("removes the exact crashed embedder and retains the healthy worker during downshift", async () => {
    const callCounts = [0, 0, 0];
    const terminationCounts = [0, 0, 0];
    const terminated = [false, false, false];
    let nextWorkerId = 0;
    const pool = new EmbeddingWorkerPool({
      poolSize: 2,
      workerBatchSize: 1,
      downshiftErrorThreshold: 1,
      createEmbedder: () => {
        const workerId = nextWorkerId;
        nextWorkerId += 1;
        const terminate = () => {
          if (terminated[workerId]) {
            return;
          }
          terminated[workerId] = true;
          terminationCounts[workerId] += 1;
        };
        return {
          embedBatch: async (texts: string[]) => {
            callCounts[workerId] += 1;
            if (workerId === 0) {
              terminate();
              throw new EmbeddingWorkerError("worker_error", "worker zero crashed");
            }
            return texts.map(() => ({
              embedding: Float32Array.from([workerId]),
              error: null,
            }));
          },
          terminate,
        };
      },
    });

    const firstResults = await pool.embedBatch([
      "crash",
      "healthy-1",
      "healthy-2",
      "healthy-3",
      "healthy-4",
    ]);
    expect(firstResults[0]).toEqual({ embedding: null, error: "worker zero crashed" });
    expect(firstResults.slice(1).map((item) => Array.from(item.embedding ?? []))).toEqual([
      [1],
      [1],
      [1],
      [1],
    ]);
    expect(firstResults.some((item) => item.error === "embedding job was not executed")).toBe(
      false,
    );
    expect(pool.getStatus().activePoolSize).toBe(1);
    expect(terminationCounts).toEqual([1, 0, 0]);

    const downshiftedResult = await pool.embedBatch(["still healthy"]);
    expect(downshiftedResult[0]?.embedding).toEqual(Float32Array.from([1]));
    expect(callCounts[0]).toBe(1);

    pool.setConcurrency(2);
    const restoredResults = await pool.embedBatch(["healthy", "replacement"]);
    expect(restoredResults.map((item) => Array.from(item.embedding ?? []))).toEqual([[1], [2]]);
    expect(nextWorkerId).toBe(3);
    expect(terminationCounts).toEqual([1, 0, 0]);
  });

  test("turns a batch-length mismatch into item errors and threshold downshifts", async () => {
    const terminationCounts = [0, 0];
    let nextWorkerId = 0;
    const pool = new EmbeddingWorkerPool({
      poolSize: 2,
      workerBatchSize: 2,
      downshiftErrorThreshold: 2,
      createEmbedder: () => {
        const workerId = nextWorkerId;
        nextWorkerId += 1;
        return {
          embedBatch: async () => [],
          terminate: () => {
            terminationCounts[workerId] += 1;
          },
        };
      },
    });

    const results = await pool.embedBatch(["first", "second"]);

    expect(results).toEqual([
      { embedding: null, error: "embedding batch length mismatch: expected 2, got 0" },
      { embedding: null, error: "embedding batch length mismatch: expected 2, got 0" },
    ]);
    expect(pool.getStatus()).toMatchObject({
      activePoolSize: 1,
      downshifted: true,
      errorCount: 2,
    });
    expect(terminationCounts).toEqual([0, 1]);
  });

  test("downshifts after repeated non-memory item errors", async () => {
    const pool = new EmbeddingWorkerPool({
      poolSize: 2,
      workerBatchSize: 2,
      downshiftErrorThreshold: 2,
      createEmbedder: () => ({
        embedBatch: async (texts: string[]) =>
          texts.map(() => ({ embedding: null, error: "temporary inference failure" })),
        terminate: () => undefined,
      }),
    });

    const results = await pool.embedBatch(["first", "second"]);

    expect(results.every((item) => item.error === "temporary inference failure")).toBe(true);
    expect(pool.getStatus()).toMatchObject({
      activePoolSize: 1,
      downshiftReason: "temporary inference failure",
      errorCount: 2,
    });
  });

  test("converts a sparse batch result into an explicit missing-item error", async () => {
    const pool = new EmbeddingWorkerPool({
      poolSize: 1,
      workerBatchSize: 2,
      createEmbedder: () => ({
        embedBatch: async () => {
          const sparse = new Array<{
            embedding: Float32Array | null;
            error: string | null;
          }>(2);
          sparse[0] = { embedding: Float32Array.from([1]), error: null };
          return sparse;
        },
        terminate: () => undefined,
      }),
    });

    const results = await pool.embedBatch(["first", "second"]);

    expect(results[0]?.embedding).toEqual(Float32Array.from([1]));
    expect(results[1]).toEqual({ embedding: null, error: "missing batch item result" });
  });

  test("uses one worker for WebGPU and retires the unused surplus worker after the batch", async () => {
    const calls = [0, 0];
    const terminationCounts = [0, 0];
    let nextWorkerId = 0;
    const pool = new EmbeddingWorkerPool({
      poolSize: 2,
      workerBatchSize: 1,
      createEmbedder: () => {
        const workerId = nextWorkerId;
        nextWorkerId += 1;
        return {
          embedBatch: async (texts: string[]) => {
            calls[workerId] += 1;
            return texts.map(() => ({ embedding: Float32Array.from([workerId]), error: null }));
          },
          terminate: () => {
            terminationCounts[workerId] += 1;
          },
          getRuntimeInfo: () => ({
            preferredBackend: "webgpu" as const,
            selectedBackend: "webgpu" as const,
            selectedModel: "webgpu-model",
            fallbackReason: null,
          }),
        };
      },
    });

    const results = await pool.embedBatch(["first", "second"]);

    expect(results).toHaveLength(2);
    expect(calls).toEqual([2, 0]);
    expect(terminationCounts).toEqual([0, 1]);
    expect(pool.getStatus()).toMatchObject({ activePoolSize: 1, selectedBackend: "webgpu" });
  });

  test("reports worker runtime diagnostics and terminates every created embedder", async () => {
    const terminate = [vi.fn(), vi.fn()];
    let nextWorkerId = 0;
    const pool = new EmbeddingWorkerPool({
      poolSize: 2,
      workerBatchSize: 1,
      preferredBackend: "webgpu",
      createEmbedder: () => {
        const workerId = nextWorkerId;
        nextWorkerId += 1;
        return {
          embedBatch: async (texts: string[]) =>
            texts.map(() => ({ embedding: Float32Array.from([workerId]), error: null })),
          terminate: terminate[workerId],
          getRuntimeInfo: () => ({
            preferredBackend: "webgpu" as const,
            selectedBackend: workerId === 0 ? ("wasm" as const) : null,
            selectedModel: workerId === 0 ? "fallback-model" : null,
            fallbackReason: workerId === 0 ? "webgpu unavailable" : null,
          }),
        };
      },
    });

    await pool.embedBatch(["first", "second"]);
    expect(pool.getStatus()).toMatchObject({
      preferredBackend: "webgpu",
      selectedBackend: "wasm",
      selectedModel: "fallback-model",
      backendFallbackReason: "webgpu unavailable",
    });

    pool.terminate();
    pool.terminate();
    expect(terminate[0]).toHaveBeenCalledOnce();
    expect(terminate[1]).toHaveBeenCalledOnce();
  });
});
