import { ChevronDown, ChevronUp, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { deriveSyncProgressState } from "./syncProgress";
import type { IndexingStatus } from "../sync/status";

interface EmbeddingRunMetrics {
  backendIdentity: string;
  configuredPoolSize: number;
  activePoolSize: number;
  poolDownshifted: boolean;
  poolDownshiftReason: string | null;
  batchCount: number;
  embeddingsProcessed: number;
  embeddingsPerSecond: number;
  avgBatchEmbedLatencyMs: number;
  lastBatchEmbedLatencyMs: number;
  avgDbCheckpointMs: number;
  lastDbCheckpointMs: number;
  checkpointEveryEmbeddings: number;
  checkpointEveryMs: number;
  pendingEmbeddingsSinceCheckpoint: number;
  lastCheckpointAt: number | null;
  queueDepth: number;
  peakQueueDepth: number;
  updatedAt: number;
}

interface SyncStatusBarProps {
  indexingStatus: IndexingStatus | null;
  embeddingRunMetrics: EmbeddingRunMetrics | null;
  starsSummary: string | null;
  dbStorageMode: string | null;
  indexDetailsExpanded: boolean;
  onToggleDetails: () => void;
  historyLoadState: string;
  historyDataSource: string | null;
  historyLastRestoredAt: number | null;
  onRetryHistory: () => void;
}

export function SyncStatusBar({
  indexingStatus,
  embeddingRunMetrics,
  starsSummary,
  dbStorageMode,
  indexDetailsExpanded,
  onToggleDetails,
  historyLoadState,
  historyDataSource,
  historyLastRestoredAt,
  onRetryHistory,
}: SyncStatusBarProps) {
  const hasContent = indexingStatus || starsSummary || dbStorageMode;
  if (!hasContent && historyLoadState === "idle") return null;

  const {
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
  } = deriveSyncProgressState(indexingStatus, embeddingRunMetrics);
  const embeddingGenerating =
    indexingStatus?.primaryStage === "embedding" || indexingStatus?.primaryStage === "embedding-init";

  return (
    <div className="animate-fade-in space-y-2">
      {indexingStatus && (
        <div className="rounded-lg border border-border/50 bg-secondary/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-accent" />
              <span className="truncate text-xs font-medium text-foreground">
                {indexingStatus.phase}
              </span>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {indexingStatus.repoTotal} repos
              {indexingStatus.elapsedSeconds != null && ` / ${indexingStatus.elapsedSeconds}s`}
            </span>
          </div>

          {(hasReadmeProgress || hasChunkingProgress || hasEmbeddingProgress || embeddingInitializing) && (
            <div className="space-y-2">
              {hasReadmeProgress && (
                <div className="space-y-1">
                  <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      READMEs: {indexingStatus.readmesCompleted} / {indexingStatus.readmesTarget}
                    </span>
                  </div>
                  <Progress value={readmeProgress} />
                </div>
              )}
              {hasChunkingProgress && (
                <div className="space-y-1">
                  <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="min-w-0">
                      Chunking repositories: {indexingStatus.chunkingCompleted} / {indexingStatus.chunkingTarget}
                    </span>
                    <span className="shrink-0">
                      {indexingStatus.embeddingActive
                        ? `${chunkingRemaining} still pending`
                        : `${chunkingRemaining} remaining before embeddings`}
                    </span>
                  </div>
                  <Progress value={chunkingProgress} />
                </div>
              )}
              {(hasEmbeddingProgress || embeddingInitializing) && (
                <div className="space-y-1">
                  <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {embeddingGenerating
                        ? "Embedding in progress"
                        : hasEmbeddingProgress
                          ? indexingStatus.embeddingWindowed
                            ? `Embeddings: ${Math.min(embeddingsCreated, embeddingTarget)} processed`
                            : `Embeddings: ${Math.min(embeddingsCreated, embeddingTarget)} / ${embeddingTarget}`
                          : "Embeddings: initializing…"}
                    </span>
                    {!embeddingGenerating && hasEmbeddingProgress && (
                      <span className="shrink-0">
                        {indexingStatus.embeddingWindowed
                          ? `${embeddingRemaining} queued overall`
                          : `${embeddingRemaining} remaining`}
                      </span>
                    )}
                  </div>
                  <Progress
                    value={embeddingProgress}
                    indeterminate={embeddingGenerating || embeddingInitializing}
                  />
                  {embeddingGenerating && (
                    <p className="text-[11px] text-muted-foreground">
                      Large indexes can take longer. Rough guide: about 30s for 300 chunks, around 2m for 200
                      repos, and roughly 5-60m for large starred libraries depending on the embedding model and
                      machine.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Expandable details */}
          {embeddingRunMetrics && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-0 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={onToggleDetails}
              >
                {indexDetailsExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {indexDetailsExpanded ? "Hide" : "Show"} details
              </Button>
              {indexDetailsExpanded && (
                <div className="animate-fade-in rounded-md border border-border/30 bg-background/50 p-2 text-[11px] text-muted-foreground space-y-0.5">
                  <p>
                    Backend: {embeddingRunMetrics.backendIdentity} -- pool{" "}
                    {embeddingRunMetrics.activePoolSize}/{embeddingRunMetrics.configuredPoolSize}
                    {embeddingRunMetrics.poolDownshifted
                      ? ` (downshifted: ${embeddingRunMetrics.poolDownshiftReason ?? "yes"})`
                      : ""}
                  </p>
                  <p>
                    Speed: {embeddingRunMetrics.embeddingsPerSecond.toFixed(2)}/s -- queue{" "}
                    {embeddingRunMetrics.queueDepth} (peak {embeddingRunMetrics.peakQueueDepth})
                  </p>
                  <p>
                    Latency: batch avg {embeddingRunMetrics.avgBatchEmbedLatencyMs.toFixed(0)}ms -- DB
                    checkpoint {embeddingRunMetrics.avgDbCheckpointMs.toFixed(0)}ms
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!indexingStatus && (starsSummary || dbStorageMode) && (
        <div className="rounded-lg border border-border/50 bg-secondary/30 p-3 text-[11px] text-foreground space-y-1">
          {starsSummary && <p className="text-primary">{starsSummary}</p>}
          {dbStorageMode && <p className="text-muted-foreground">Storage: {dbStorageMode}</p>}
        </div>
      )}

      {historyLoadState === "loading" && (
        <p className="text-xs text-muted-foreground animate-pulse">Loading local chat history...</p>
      )}
      {historyLoadState === "error" && (
        <div className="flex items-center gap-2 text-xs">
          <p className="text-destructive">Failed to load local chat history.</p>
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={onRetryHistory}>
            Retry
          </Button>
        </div>
      )}

      {historyLoadState === "done" && (historyDataSource || historyLastRestoredAt) && (
        <p className="text-[11px] text-muted-foreground">
          History: {historyLoadState}
          {historyDataSource ? ` \u00b7 source: ${historyDataSource}` : ""}
          {historyLastRestoredAt ? ` \u00b7 ${new Date(historyLastRestoredAt).toLocaleString()}` : ""}
        </p>
      )}
    </div>
  );
}
