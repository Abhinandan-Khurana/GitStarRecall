export function clampResultScoreForDisplay(score: number): number {
  const safeScore = Number.isFinite(score) ? score : 0;
  return Math.max(0, safeScore);
}

export function getResultScoreBand(displayScore: number): "High" | "Medium" | "Low" {
  if (displayScore >= 0.6) {
    return "High";
  }
  if (displayScore >= 0.35) {
    return "Medium";
  }
  return "Low";
}
