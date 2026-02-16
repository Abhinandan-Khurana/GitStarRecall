import { describe, expect, test } from "vitest";
import { EmbeddingWorkerPool } from "./WorkerPool";

type FakeEmbedder = {
  embedBatch: (texts: string[]) => Promise<Array<{ embedding: Float32Array | null; error: string | null }>>;
  terminate: () => void;
};

describe("EmbeddingWorkerPool", () => {
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
  });
});
