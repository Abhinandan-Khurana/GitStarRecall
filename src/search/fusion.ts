export type RankedId = { id: string };

export function reciprocalRankFusion(rankings: RankedId[][], k: number = 60): Array<{ id: string; score: number }> {
  const safeK = Math.max(1, Math.trunc(k));
  const scoreById = new Map<string, number>();

  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i += 1) {
      const item = ranking[i];
      if (!item) {
        continue;
      }
      const score = 1 / (safeK + i + 1);
      scoreById.set(item.id, (scoreById.get(item.id) ?? 0) + score);
    }
  }

  return Array.from(scoreById.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
