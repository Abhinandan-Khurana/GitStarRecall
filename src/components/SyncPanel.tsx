import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  RefreshCw,
  ChevronDown,
  Server,
  Wifi,
  WifiOff,
  Loader2,
  Shield,
} from "lucide-react";
import { useState } from "react";

type IndexingStatus = {
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
};

type EmbeddingRunMetrics = {
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
};

type OllamaConnectionStatus = "idle" | "testing" | "connected" | "failed" | "inactive";

interface SyncPanelProps {
  fetchingStars: boolean;
  fetchPhase: string | null;
  onFetchStars: () => void;
  allowOllamaEmbedding: boolean;
  onAllowOllamaChange: (checked: boolean) => void;
  ollamaConnectionStatus: OllamaConnectionStatus;
  ollamaBaseUrl: string;
  ollamaModel: string;
  onOllamaBaseUrlChange: (value: string) => void;
  onOllamaModelChange: (value: string) => void;
  onTestOllamaConnection: () => void;
  ollamaConnectionMessage: string | null;
  indexingStatus: IndexingStatus | null;
  starsSummary: string | null;
  dbStorageMode: string | null;
  embeddingRunMetrics: EmbeddingRunMetrics | null;
  historyLoadState: string;
  historyDataSource: string | null;
  historyLastRestoredAt: number | null;
  onRetryHistory: () => void;
}

function getOllamaStatusIcon(status: OllamaConnectionStatus) {
  switch (status) {
    case "connected": return <Wifi className="h-3 w-3 text-primary" />;
    case "testing": return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
    case "failed": return <WifiOff className="h-3 w-3 text-destructive" />;
    default: return <Server className="h-3 w-3 text-muted-foreground" />;
  }
}

function getOllamaStatusLabel(status: OllamaConnectionStatus) {
  switch (status) {
    case "connected": return "ollama-active";
    case "testing": return "testing";
    case "inactive": return "fallback-browser";
    case "failed": return "failed";
    default: return "browser";
  }
}

export function SyncPanel({
  fetchingStars,
  fetchPhase,
  onFetchStars,
  allowOllamaEmbedding,
  onAllowOllamaChange,
  ollamaConnectionStatus,
  ollamaBaseUrl,
  ollamaModel,
  onOllamaBaseUrlChange,
  onOllamaModelChange,
  onTestOllamaConnection,
  ollamaConnectionMessage,
  indexingStatus,
  starsSummary,
  dbStorageMode,
  embeddingRunMetrics,
  historyLoadState,
  historyDataSource,
  historyLastRestoredAt,
  onRetryHistory,
}: SyncPanelProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [ollamaExpanded, setOllamaExpanded] = useState(false);

  const progressPct = indexingStatus && indexingStatus.embeddingTarget > 0
    ? Math.round((indexingStatus.embeddingsCreated / indexingStatus.embeddingTarget) * 100)
    : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/50 bg-card/40 p-4">
      {/* Top row: Fetch + Status */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={onFetchStars}
          disabled={fetchingStars}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${fetchingStars ? "animate-spin" : ""}`} />
          {fetchingStars ? (fetchPhase ?? "Syncing...") : "Fetch Stars"}
        </Button>

        <div className="flex items-center gap-1.5">
          <Checkbox
            id="ollama-embedding"
            checked={allowOllamaEmbedding}
            onCheckedChange={(checked) => onAllowOllamaChange(checked === true)}
          />
          <Label htmlFor="ollama-embedding" className="cursor-pointer text-xs text-muted-foreground">
            Use Ollama embeddings
          </Label>
        </div>

        <Badge variant="outline" className="gap-1.5 text-xs font-normal">
          {getOllamaStatusIcon(ollamaConnectionStatus)}
          {getOllamaStatusLabel(ollamaConnectionStatus)}
        </Badge>
      </div>

      {/* Privacy note */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Shield className="h-3 w-3 shrink-0" />
        Requests go only to localhost. No GitHub token is sent.
      </div>

      {/* Ollama config (collapsible) */}
      <Collapsible open={ollamaExpanded} onOpenChange={setOllamaExpanded}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <Server className="h-3 w-3" />
            Ollama Configuration
            <ChevronDown className={`h-3 w-3 transition-transform ${ollamaExpanded ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 grid gap-2 rounded-lg border border-border/50 bg-muted/10 p-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ollama-base-url" className="text-xs text-muted-foreground">Ollama URL</Label>
              <Input
                id="ollama-base-url"
                value={ollamaBaseUrl}
                onChange={(e) => onOllamaBaseUrlChange(e.target.value)}
                placeholder="http://localhost:11434"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ollama-model" className="text-xs text-muted-foreground">Embedding model</Label>
              <Input
                id="ollama-model"
                value={ollamaModel}
                onChange={(e) => onOllamaModelChange(e.target.value)}
                placeholder="nomic-embed-text"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={onTestOllamaConnection}
                disabled={ollamaConnectionStatus === "testing"}
              >
                {ollamaConnectionStatus === "testing" ? "Testing..." : "Test"}
              </Button>
            </div>
          </div>
          {ollamaConnectionMessage ? (
            <p className={`mt-1.5 text-xs ${
              ollamaConnectionStatus === "failed" || ollamaConnectionStatus === "inactive"
                ? "text-destructive"
                : "text-muted-foreground"
            }`}>
              {ollamaConnectionMessage}
            </p>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

      {/* Index Status */}
      {indexingStatus ? (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/10 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-foreground">
              Index: <span className="text-primary">{indexingStatus.phase}</span>
            </p>
            {indexingStatus.elapsedSeconds != null ? (
              <Badge variant="secondary" className="text-xs tabular-nums">{indexingStatus.elapsedSeconds}s</Badge>
            ) : null}
          </div>
          {progressPct !== null ? (
            <Progress value={progressPct} className="h-1.5" />
          ) : null}
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <span>Repos: {indexingStatus.repoTotal}</span>
            <span>Chunks: {indexingStatus.chunkTotal}</span>
            <span>READMEs: {indexingStatus.readmesCompleted}/{indexingStatus.readmesTarget}</span>
            <span>Embeddings: {indexingStatus.embeddingsCreated}{indexingStatus.embeddingTarget > 0 ? ` / ${indexingStatus.embeddingTarget}` : ""}</span>
          </div>
          {starsSummary ? <p className="text-xs text-primary">{starsSummary}</p> : null}
          {dbStorageMode ? <p className="text-xs text-muted-foreground">Storage: {dbStorageMode}</p> : null}
        </div>
      ) : starsSummary || dbStorageMode ? (
        <div className="flex flex-col gap-1 rounded-lg border border-primary/10 bg-primary/5 p-3 text-xs">
          {starsSummary ? <p className="text-primary">{starsSummary}</p> : null}
          {dbStorageMode ? <p className="text-muted-foreground">Storage: {dbStorageMode}</p> : null}
        </div>
      ) : null}

      {/* Embedding metrics (expandable) */}
      {embeddingRunMetrics ? (
        <Collapsible open={detailsExpanded} onOpenChange={setDetailsExpanded}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline">
              {detailsExpanded ? "Hide" : "Show"} embedding details
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1.5 rounded-lg border border-border/50 bg-muted/20 p-2.5 font-mono text-xs text-muted-foreground">
              <p>Backend: {embeddingRunMetrics.backendIdentity} | pool {embeddingRunMetrics.activePoolSize}/{embeddingRunMetrics.configuredPoolSize}{embeddingRunMetrics.poolDownshifted ? ` (${embeddingRunMetrics.poolDownshiftReason ?? "downshifted"})` : ""}</p>
              <p>Batches: {embeddingRunMetrics.batchCount} | {embeddingRunMetrics.embeddingsPerSecond.toFixed(1)}/s | queue {embeddingRunMetrics.queueDepth} (peak {embeddingRunMetrics.peakQueueDepth})</p>
              <p>Latency: batch avg {embeddingRunMetrics.avgBatchEmbedLatencyMs.toFixed(0)}ms | DB avg {embeddingRunMetrics.avgDbCheckpointMs.toFixed(0)}ms</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {/* History restore status */}
      <Separator />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>History: {historyLoadState}</span>
        {historyDataSource ? <span>| {historyDataSource}</span> : null}
        {historyLastRestoredAt ? <span>| {new Date(historyLastRestoredAt).toLocaleString()}</span> : null}
        {historyLoadState === "loading" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : null}
        {historyLoadState === "error" ? (
          <Button variant="outline" size="sm" className="h-5 px-1.5 text-xs" onClick={onRetryHistory}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
