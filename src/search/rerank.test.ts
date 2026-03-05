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
    expect(selected.map((item) => item.chunkId)).toEqual(["a1", "b1"]);
  });
});
