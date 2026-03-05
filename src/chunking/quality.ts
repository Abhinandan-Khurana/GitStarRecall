export function chunkQualityScore(text: string): number {
  const len = Math.max(text.length, 1);
  const headingHits = (text.match(/^#{1,6}\s/mg) ?? []).length;
  const codeFenceHits = (text.match(/```/g) ?? []).length;
  const linkHits = (text.match(/https?:\/\//g) ?? []).length;
  const tablePipeHits = (text.match(/\|/g) ?? []).length;

  const headingBoost = Math.min(0.25, headingHits * 0.03);
  const codePenalty = Math.min(0.35, codeFenceHits * 0.05);
  const linkPenalty = Math.min(0.2, (linkHits / len) * 220);
  const tablePenalty = Math.min(0.2, (tablePipeHits / len) * 240);

  return Math.max(0, 0.6 + headingBoost - codePenalty - linkPenalty - tablePenalty);
}
