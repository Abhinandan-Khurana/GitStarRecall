import type { IndexingStatus } from "../sync/status";

export interface SyncProgressIndexingStatusLike {
  primaryStage: IndexingStatus["primaryStage"];
  readmeActive: boolean;
  chunkingActive: boolean;
  embeddingActive: boolean;
  embeddingWindowed: boolean;
  readmesTarget: number;
  readmesCompleted: number;
  chunkingTarget: number;
  chunkingCompleted: number;
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
  const embeddingRemaining = Math.max(embeddingTarget - embeddingsCreated, 0);
  const readmeProgress =
    indexingStatus && indexingStatus.readmesTarget > 0
      ? clampPercent((indexingStatus.readmesCompleted / indexingStatus.readmesTarget) * 100)
      : 0;
  const chunkingTarget = indexingStatus?.chunkingTarget ?? 0;
  const chunkingCompleted = indexingStatus?.chunkingCompleted ?? 0;
  const chunkingProgress =
    chunkingTarget > 0 ? clampPercent((chunkingCompleted / chunkingTarget) * 100) : 0;
  const chunkingRemaining = Math.max(chunkingTarget - chunkingCompleted, 0);
  const metricsIndicateEmbedding = Boolean(
    embeddingRunMetrics && (embeddingRunMetrics.queueDepth > 0 || embeddingRunMetrics.embeddingsProcessed > 0),
  );
  const readmeStageActive = Boolean(indexingStatus?.readmeActive);
  const chunkingStageActive = Boolean(indexingStatus?.chunkingActive);
  const embeddingStageActive = Boolean(indexingStatus?.embeddingActive) || metricsIndicateEmbedding;
  const hasEmbeddingProgress = embeddingTarget > 0;
  const embeddingInitializing = embeddingStageActive && !hasEmbeddingProgress;
  const hasReadmeProgress = Boolean(
    indexingStatus &&
      indexingStatus.readmesTarget > 0 &&
      (indexingStatus.readmesCompleted < indexingStatus.readmesTarget || readmeStageActive),
  );
  const hasChunkingProgress = Boolean(
    indexingStatus &&
      chunkingTarget > 0 &&
      (chunkingCompleted < chunkingTarget || chunkingStageActive),
  );

  return {
    embeddingTarget,
    embeddingsCreated,
    embeddingProgress,
    embeddingRemaining,
    readmeProgress,
    chunkingProgress,
    chunkingRemaining,
    hasReadmeProgress,
    hasChunkingProgress,
    hasEmbeddingProgress,
    embeddingInitializing,
  };
}
