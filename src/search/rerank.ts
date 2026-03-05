export type DenseCandidate = {
  chunkId: string;
  repoId: number;
  vector: Float32Array;
  denseScore: number;
};

export type RankedCandidate = {
  chunkId: string;
  repoId: number;
  score: number;
};

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch in rerank: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function mmrSelect(params: {
  candidates: DenseCandidate[];
  topK: number;
  lambda: number;
  maxChunksPerRepo: number;
}): RankedCandidate[] {
  const topK = Math.max(1, Math.trunc(params.topK));
  const lambda = Math.max(0, Math.min(1, params.lambda));
  const maxChunksPerRepo = Math.max(1, Math.trunc(params.maxChunksPerRepo));

  const selected: Array<{ chunkId: string; repoId: number; vector: Float32Array; score: number }> = [];
  const remaining = [...params.candidates];
  const repoHits = new Map<number, number>();

  while (selected.length < topK && remaining.length > 0) {
    let bestIndex = -1;
    let bestMmr = Number.NEGATIVE_INFINITY;
    let bestDense = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      if (!candidate) {
        continue;
      }
      const hitCount = repoHits.get(candidate.repoId) ?? 0;
      if (hitCount >= maxChunksPerRepo) {
        continue;
      }

      let redundancy = 0;
      for (const chosen of selected) {
        redundancy = Math.max(redundancy, cosineSimilarity(candidate.vector, chosen.vector));
      }

      const mmrScore = lambda * candidate.denseScore - (1 - lambda) * redundancy;
      const isBetter = mmrScore > bestMmr || (mmrScore === bestMmr && candidate.denseScore > bestDense);
      if (isBetter) {
        bestMmr = mmrScore;
        bestDense = candidate.denseScore;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) {
      break;
    }

    const chosen = remaining.splice(bestIndex, 1)[0];
    if (!chosen) {
      break;
    }

    selected.push({
      chunkId: chosen.chunkId,
      repoId: chosen.repoId,
      vector: chosen.vector,
      score: chosen.denseScore,
    });
    repoHits.set(chosen.repoId, (repoHits.get(chosen.repoId) ?? 0) + 1);
  }

  return selected.map((item) => ({ chunkId: item.chunkId, repoId: item.repoId, score: item.score }));
}
