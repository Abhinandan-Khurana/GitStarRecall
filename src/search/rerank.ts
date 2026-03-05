import { cosineSimilaritySafe } from "./vectorMath";

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
  denseScore: number;
  capOverride: boolean;
};

export function mmrSelect(params: {
  candidates: DenseCandidate[];
  topK: number;
  lambda: number;
  maxChunksPerRepo: number;
  onVectorMismatch?: () => void;
}): RankedCandidate[] {
  const topK = Math.max(1, Math.trunc(params.topK));
  const lambda = Math.max(0, Math.min(1, params.lambda));
  const maxChunksPerRepo = Math.max(1, Math.trunc(params.maxChunksPerRepo));

  const selected: Array<{
    chunkId: string;
    repoId: number;
    vector: Float32Array;
    score: number;
    denseScore: number;
    capOverride: boolean;
  }> = [];
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
        if (candidate.vector.length !== chosen.vector.length) {
          params.onVectorMismatch?.();
          continue;
        }
        redundancy = Math.max(
          redundancy,
          cosineSimilaritySafe(candidate.vector, chosen.vector, "zero"),
        );
      }

      const mmrScore = lambda * candidate.denseScore - (1 - lambda) * redundancy;
      const isBetter = mmrScore > bestMmr || (mmrScore === bestMmr && candidate.denseScore > bestDense);
      if (isBetter) {
        bestMmr = mmrScore;
        bestDense = candidate.denseScore;
        bestIndex = i;
      }
    }

    let selectedWithCapOverride = false;
    if (bestIndex < 0) {
      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        if (!candidate) {
          continue;
        }

        let redundancy = 0;
        for (const chosen of selected) {
          if (candidate.vector.length !== chosen.vector.length) {
            params.onVectorMismatch?.();
            continue;
          }
          redundancy = Math.max(
            redundancy,
            cosineSimilaritySafe(candidate.vector, chosen.vector, "zero"),
          );
        }

        const mmrScore = lambda * candidate.denseScore - (1 - lambda) * redundancy;
        const isBetter = mmrScore > bestMmr || (mmrScore === bestMmr && candidate.denseScore > bestDense);
        if (isBetter) {
          bestMmr = mmrScore;
          bestDense = candidate.denseScore;
          bestIndex = i;
        }
      }
      selectedWithCapOverride = bestIndex >= 0;
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
      score: bestMmr,
      denseScore: chosen.denseScore,
      capOverride: selectedWithCapOverride,
    });
    repoHits.set(chosen.repoId, (repoHits.get(chosen.repoId) ?? 0) + 1);
  }

  return selected.map((item) => ({
    chunkId: item.chunkId,
    repoId: item.repoId,
    score: item.score,
    denseScore: item.denseScore,
    capOverride: item.capOverride,
  }));
}
