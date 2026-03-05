import { describe, expect, it } from "vitest";
import { mmrSelect, type DenseCandidate } from "./rerank";

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("mmrSelect", () => {
  it("enforces per repo cap", () => {
    const candidates: DenseCandidate[] = [
      { chunkId: "a1", repoId: 1, vector: vec([1, 0]), denseScore: 0.9 },
      { chunkId: "a2", repoId: 1, vector: vec([0.99, 0.01]), denseScore: 0.89 },
      { chunkId: "b1", repoId: 2, vector: vec([0.5, 0.5]), denseScore: 0.7 },
    ];

    const selected = mmrSelect({ candidates, topK: 3, lambda: 0.72, maxChunksPerRepo: 1 });
    expect(selected.map((item) => item.chunkId)).toEqual(["a1", "b1", "a2"]);
    expect(selected.map((item) => item.capOverride)).toEqual([false, false, true]);
  });

  it("does not throw when candidate vectors have mismatched dimensions", () => {
    const candidates: DenseCandidate[] = [
      { chunkId: "a1", repoId: 1, vector: vec([1, 0, 0]), denseScore: 0.95 },
      { chunkId: "b1", repoId: 2, vector: vec([1, 0]), denseScore: 0.8 },
      { chunkId: "c1", repoId: 3, vector: vec([0, 1, 0]), denseScore: 0.7 },
    ];

    expect(() => mmrSelect({ candidates, topK: 3, lambda: 0.72, maxChunksPerRepo: 2 })).not.toThrow();
  });

  it("returns mmr decision score instead of raw dense score", () => {
    const candidates: DenseCandidate[] = [
      { chunkId: "a1", repoId: 1, vector: vec([1, 0]), denseScore: 0.95 },
      { chunkId: "a2", repoId: 2, vector: vec([1, 0]), denseScore: 0.9 },
      { chunkId: "b1", repoId: 3, vector: vec([0, 1]), denseScore: 0.88 },
    ];

    const selected = mmrSelect({ candidates, topK: 3, lambda: 0.5, maxChunksPerRepo: 2 });
    const second = selected[1];
    expect(second).toBeDefined();
    if (!second) {
      return;
    }

    const denseScore = (second as { denseScore?: number }).denseScore;
    expect(denseScore).toBeTypeOf("number");
    if (denseScore == null) {
      return;
    }
    expect(second.score).toBeLessThan(denseScore);
  });

  it("fills topK with cap override when all remaining candidates hit repo cap", () => {
    const candidates: DenseCandidate[] = [
      { chunkId: "r1-a", repoId: 1, vector: vec([1, 0, 0]), denseScore: 0.95 },
      { chunkId: "r1-b", repoId: 1, vector: vec([0.99, 0.01, 0]), denseScore: 0.9 },
      { chunkId: "r2-a", repoId: 2, vector: vec([0.2, 0.8, 0]), denseScore: 0.85 },
      { chunkId: "r2-b", repoId: 2, vector: vec([0.15, 0.85, 0]), denseScore: 0.83 },
    ];

    const selected = mmrSelect({ candidates, topK: 4, lambda: 0.72, maxChunksPerRepo: 1 });
    expect(selected).toHaveLength(4);
    expect(selected.filter((item) => item.capOverride)).toHaveLength(2);
  });
});
