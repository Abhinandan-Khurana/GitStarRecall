export function cosineSimilaritySafe(
  a: Float32Array,
  b: Float32Array,
  onDimMismatch: "throw" | "zero" = "throw",
): number {
  if (a.length !== b.length) {
    if (onDimMismatch === "throw") {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }
    return 0;
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

  const score = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(score) ? score : 0;
}

