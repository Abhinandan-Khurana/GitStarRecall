export interface SyncProgressIndexingStatusLike {
  phase: string;
  readmesTarget: number;
  readmesCompleted: number;
  embeddingTarget: number;
  embeddingsCreated: number;
}

export interface SyncProgressEmbeddingRunMetricsLike {
  embeddingsProcessed: number;
  queueDepth: number;
}

export function deriveSyncProgressState(
  indexingStatus: SyncProgressIndexingStatusLike | null,
  embeddingRunMetrics: SyncProgressEmbeddingRunMetricsLike | null,
) {
  const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
  const statusEmbeddingTarget = indexingStatus?.embeddingTarget ?? 0;
  const statusEmbeddingsCreated = indexingStatus?.embeddingsCreated ?? 0;
  const metricsEmbeddingTarget = embeddingRunMetrics
    ? embeddingRunMetrics.embeddingsProcessed + embeddingRunMetrics.queueDepth
    : 0;
  const metricsEmbeddingsCreated = embeddingRunMetrics?.embeddingsProcessed ?? 0;
  const embeddingTarget = statusEmbeddingTarget > 0 ? statusEmbeddingTarget : metricsEmbeddingTarget;
  const embeddingsCreated = statusEmbeddingTarget > 0 ? statusEmbeddingsCreated : metricsEmbeddingsCreated;
  const embeddingProgress =
    embeddingTarget > 0 ? clampPercent((embeddingsCreated / embeddingTarget) * 100) : 0;
  const readmeProgress =
    indexingStatus && indexingStatus.readmesTarget > 0
      ? clampPercent((indexingStatus.readmesCompleted / indexingStatus.readmesTarget) * 100)
      : 0;
  const phaseIndicatesReadme = Boolean(indexingStatus?.phase.toLowerCase().includes("readme"));
  const phaseIndicatesEmbedding = Boolean(indexingStatus?.phase.toLowerCase().includes("embedding"));
  const metricsIndicateEmbedding = Boolean(
    embeddingRunMetrics && (embeddingRunMetrics.queueDepth > 0 || embeddingRunMetrics.embeddingsProcessed > 0),
  );
  const embeddingStageActive = phaseIndicatesEmbedding || metricsIndicateEmbedding;
  const hasEmbeddingProgress = embeddingTarget > 0;
  const embeddingInitializing = embeddingStageActive && !hasEmbeddingProgress;
  const hasReadmeProgress = Boolean(
    indexingStatus &&
      indexingStatus.readmesTarget > 0 &&
      (indexingStatus.readmesCompleted < indexingStatus.readmesTarget || phaseIndicatesReadme),
  );

  return {
    embeddingTarget,
    embeddingsCreated,
    embeddingProgress,
    readmeProgress,
    hasReadmeProgress,
    hasEmbeddingProgress,
    embeddingInitializing,
  };
}
