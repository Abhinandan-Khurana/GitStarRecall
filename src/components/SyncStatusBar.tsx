import { ChevronDown, ChevronUp, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface IndexingStatus {
  phase: string;
  startedAt: number;
  repoTotal: number;
  readmesTarget: number;
  readmesCompleted: number;
  readmesMissing: number;
  readmesFailed: number;
  chunkTotal: number;
  embeddingsCreated: number;
  embeddingTarget: number;
  duplicateEmbeddingHits: number;
  elapsedSeconds?: number;
}

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

  const embeddingProgress =
    indexingStatus && indexingStatus.embeddingTarget > 0
      ? (indexingStatus.embeddingsCreated / indexingStatus.embeddingTarget) * 100
      : 0;

  return (
    <div className="animate-fade-in space-y-2">
      {indexingStatus && (
        <div className="rounded-lg border border-border/50 bg-secondary/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-medium text-foreground">
                {indexingStatus.phase}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {indexingStatus.repoTotal} repos
              {indexingStatus.elapsedSeconds != null && ` / ${indexingStatus.elapsedSeconds}s`}
            </span>
          </div>

          {indexingStatus.embeddingTarget > 0 && (
            <div className="space-y-1">
              <Progress value={embeddingProgress} />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>
                  Embeddings: {indexingStatus.embeddingsCreated} / {indexingStatus.embeddingTarget}
                </span>
                <span>
                  READMEs: {indexingStatus.readmesCompleted} / {indexingStatus.readmesTarget}
                </span>
              </div>
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
    </div>
  );
}
